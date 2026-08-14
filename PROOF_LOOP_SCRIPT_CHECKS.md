# ProsaBuddy Proof Loop：大模型与脚本协作时序及全部主要检查规则

本文按一个证明任务进入系统后的真实运行顺序，整理当前工作树中 proof loop 的主要脚本检查点。重点回答：

- 当前由大模型做什么，由脚本做什么；
- 每项检查位于哪里、何时触发；
- 什么算通过，什么算不通过；
- 通过后进入哪一步，不通过后进入哪一步；
- 哪些是代码硬门，哪些只是 prompt 提醒；
- lemma worker、repair worker 和主 prover 如何交接状态；
- 编译成功、局部认证、最终证明成功为什么是三个不同概念。

本文以当前 working tree 为准。当前 proof-loop 文件存在未提交修改，因此这里描述的是工作区中的实际实现，不是假定的历史版本。

---

## 1. 先看结论：大模型与脚本怎样分工

大模型负责“提出动作”，脚本负责“决定动作能否发生以及结果是否可信”。

大模型主要做：

1. 阅读 theorem、`proof.tex`、库定义和当前 Coq goal；
2. 提交结构化 `proof_plan`；
3. 把 accepted DAG 写成 theorem skeleton 和 `proof_region`；
4. 在允许的 region 内生成、试验和修改 tactic；
5. 根据编译错误决定局部修复、拆分或升级；
6. 在所有局部 region 解决后完成父 theorem composition 和 `Qed.`；
7. lemma worker 返回结构化 `proof_result`，而不是自己宣称“我已经证明完”。

脚本主要做：

1. 绑定唯一 `.v` 文件和 theorem；
2. 恢复 staged proof transaction；
3. 给模型注入当前 workflow、队列、证书、repair 和 liveness 提醒；
4. 审查 proof DAG、候选引理接口、依赖、composition dataflow 和失败路线复用；
5. 限制模型只能改授权 theorem/region；
6. 解析 `proof_region`，生成严格按文件顺序执行的队列；
7. 自动派发或恢复 lemma/repair 子任务；
8. 检查 lemma 的编辑范围、顺序、目标和返回格式；
9. 调 Coq 编译器，把“模型认为成功”转换为 compiler certificate；
10. 维护 `pending/running/split/unvalidated/solved/escalated` 状态；
11. 只有 compiler-backed committable snapshot 才能最终原子写回工作区。

因此，模型输出不是事实来源。脚本状态和编译器证书才是 proof loop 的裁判。

---

## 2. 总体时间顺序

```text
用户证明任务
  |
  v
[脚本] 自动绑定 .v 文件/位置
  |
  v
[脚本] 进入 SessionPrompt.loop
  |
  +--> 恢复 proof transaction？--是--> 强制先 read staged revision
  |                              否
  |
  +--> 已有可调度 region/repair？--是--> 自动启动子模型任务
  |                              否
  |
  +--> fallback/liveness 已触发？--是--> 提醒、限制工具或停止/交回父 prover
  |                              否
  v
[脚本] 组装 proof context、工具和 prompt
  |
  v
[大模型] read / 精确检索 / live-goal 检查
  |
  v
[大模型] 提交 structured proof_plan
  |
  v
[脚本] DAG + theorem binding + candidate audit + route ledger 审查
  |
  +--> hard error --> 拒绝；有预算则修 DAG，无预算则终止规划
  |
  +--> warning only / ready --> 接受并锁定 semantic DAG
  v
[大模型] materialize theorem skeleton + proof_region markers
  |
  v
[脚本] 文件范围、样式、事务、region 解析、plan/materialization 一致性检查
  |
  +--> 不匹配 --> 修 marker/metadata，或有证据时做一次 accepted-plan repair
  |
  +--> 匹配 --> refresh queue
  v
[脚本] 选择文件中第一个 unresolved region
  |
  +--> locality/scaffold/sibling 检查失败 --> escalated -> repair worker/父 prover
  |
  +--> 通过 --> 自动派发 lemma worker
  v
[脚本] transaction 从 parent 转交 child，scope 缩到 proof_region
  |
  v
[lemma 大模型] read staged source -> coq_session -> 小步 tactic -> edit -> checkpoint/coqc
  |
  v
[脚本] 每次 edit 检查 region、顺序、target、style、stale view
  |
  v
[lemma 大模型] 返回 structured proof_result: solved | split | escalate
  |
  v
[脚本] schema + locality + proof_text + scaffold + source hash + region parse 验收
  |
  +--> solved 且认证 --> region=solved，调度下一个 region
  +--> split --> 同一个 lemma session 按 DFS-LIFO 恢复
  +--> escalate/验收失败 --> region=escalated，调 theorem repair
  v
[脚本/大模型] 重复直到全部 region solved
  |
  v
[主 prover 大模型] 完成 parent composition 和最终 Qed.
  |
  v
[脚本] coqc/checkpoint + finalTheoremGate
  |
  +--> 编译成功但 final gate 失败 --> 回主 prover继续
  +--> final Qed + 无洞 --> hard final receipt
  v
[脚本] transaction finalize：验证磁盘 base hash -> atomic commit
```

---

## 3. 核心状态机

### 3.1 Workflow phase

代码：`packages/opencode/src/session/proof-workflow.ts:124`、`:1980-1984`

| phase | 含义 | 如何进入下一阶段 |
|---|---|---|
| `architect` | 尚无可执行 region，或正在规划/materialize skeleton | accepted plan 被正确写成 region 并刷新队列 |
| `delegating` | 第一个 unresolved region 可由 lemma 处理 | region solved 后继续 delegating；升级后转 prover |
| `prover` | 当前第一个 unresolved region 已 escalated，或所有 region 完成但 theorem 还未最终关闭 | theorem-level repair、parent composition、最终编译 |
| `complete` | 队列完成且最终 theorem gate 已满足 | transaction finalize/结束 loop |

`computePhase()` 只看队列：没有未解决项时，有队列则 `complete`；第一个未解决项不是 `escalated` 时为 `delegating`；否则为 `prover`。最终调度处还会用 `finalTheoremGate()` 把“region 全 solved 但没有最终 Qed”改回 `prover`。

### 3.2 proof_region status

代码：`packages/opencode/src/session/proof-workflow.ts:46`、队列刷新约 `:2037-2808`

| status | 含义 | 典型下一步 |
|---|---|---|
| `pending` | region 有 hole，尚未派发 | 通过 dispatch gate 后启动 fresh lemma |
| `running` | lemma task 已持有 region 和 lease | 等结构化结果；超时则恢复、释放或升级 |
| `split` | lemma 请求在同一任务中继续处理更小 blocker | 使用原 `task_id` 恢复同一 lemma session |
| `unvalidated` | region 文本看似完成，但尚需 compiler lifecycle 判定 | 自动 scaffold/checkpoint；通过变 solved，失败变 escalated |
| `solved` | 当前 source 上存在有效 compiler certificate | 冻结该前缀，选择下一个 region |
| `escalated` | 不是该 lemma region 内可安全完成的问题 | 调 theorem-level repair 或交回主 prover |

`solved` 不是永久标签。只要 source、region fingerprint 或编译结果使 certificate 失效，它可以被重开。

---

## 4. 按真实时间顺序的检查点

## T00. 用户任务进入：自动绑定 proof 文件和位置

- 大模型正在做什么：此时还没有调用模型。
- 脚本入口：`SessionPrompt.prompt()`。
- 代码：
  - `packages/opencode/src/session/prompt.ts:710-747`
  - `ProofContext.setBinding(...)`
  - `SessionProof.set(...)`
- 触发时机：每次新的用户 prompt 进入。
- 限制解释：脚本从显式命名的 `.v`、附件或已有 session binding 推断当前 proof 文件；显式目标可以替换自动生成的占位 binding。
- 通过条件：找到有效 `.v` 路径，记录 file、line、character 和 binding source。
- 通过后：创建用户消息，进入 `SessionPrompt.loop()`。
- 不通过条件：prompt 中无法推断 `.v`，且 session 没有已有 binding。
- 不通过后：普通对话仍可能运行，但 theorem scope、proof workflow、自动调度和 proof transaction 等专用硬门不会完整生效；后续需要显式绑定 proof 文件。

## T01. Loop 启动与并发会话检查

- 大模型正在做什么：尚未运行，或者在已有相同 session loop 中继续等待。
- 脚本入口：`SessionPrompt.loop()`。
- 代码：`packages/opencode/src/session/prompt.ts:858-896`
- 触发时机：`prompt()` 完成消息创建后。
- 限制解释：同一 session 只维护一个 active loop；重复调用不会再创建第二个 proof controller，而是挂回调等待当前 loop 输出。
- 通过条件：成功取得新的或恢复的 AbortSignal。
- 通过后：读取消息历史、当前 user/assistant/subtask 状态。
- 不通过条件：已有 loop 正在运行。
- 不通过后：调用方等待现有 loop 完成，不并发启动第二条 proof orchestration。

## T02. 恢复 proof edit transaction

- 大模型正在做什么：尚未看到本轮 prompt。
- 脚本入口：`recoverProofEditTransaction()` -> `ProofEditTransaction.recoverLatest()`。
- 代码：
  - `packages/opencode/src/session/prompt.ts:145-167`、`:905`
  - `packages/opencode/src/session/proof-edit-transaction.ts:807-960`
  - 恢复候选排序：`:304-389`
  - 切回最佳认证基线：`:392-430`
- 触发时机：主 `prover` 每次 loop 迭代开始；有绑定 `.v` 且能定位 theorem。
- 限制解释：工作区磁盘文件可能比事务 journal 旧。脚本只恢复 `active/recoverable`、同 workspace/file/theorem、且 `base_hash` 与当前磁盘一致的事务。
- 恢复候选优先级：
  1. compiler-certified region 数量更多；
  2. unresolved semantic debt 更少；
  3. `hard` 证据优于 `structural`；
  4. revision 更新；
  5. 候选事务之间再以 scope 宽度和更新时间做 tie-break。
- 通过条件：找到结构合法且授权 scope 与当前 theorem 一致的事务；必要时从最新失败 draft 切回 `bestRecoverySource`。
- 通过后：staged source 成为权威源；主 prover 恢复时最低 scope 扩为 `theorem_body`，避免保留旧 lemma 的窄 `proof_region` scope。
- 不通过条件：base hash 不同、theorem 不同、journal 损坏、scope 不合法，或事务正由另一个 busy session 持有。
- 不通过后：不恢复该事务，继续以当前磁盘 source 运行或等待占用者。

## T03. 恢复后必须先 read staged revision

- 大模型正在做什么：收到 recovery reminder，必须先读目标 `.v`。
- 脚本入口：
  - `ProofEditTransaction.requiresStagedRead()`
  - `assertStagedReadSynchronized()`
  - `ReadTool` 的 `acknowledgeStagedRead()`
- 代码：
  - `packages/opencode/src/session/proof-edit-transaction.ts:1089-1114`
  - `packages/opencode/src/tool/read.ts:221-225`
  - 提醒注入：`packages/opencode/src/session/prompt.ts:1257` 附近
- 触发时机：恢复事务后，`synchronizedRevision !== revision`；在 proof_plan、派发、coq_session、edit/apply_patch 等动作前检查。
- 通过条件：使用 `read` 工具读取目标文件；read 返回 staged source，而不是旧磁盘文件，并记录当前 revision 已同步。
- 通过后：允许规划、编辑、Coq session 和调度继续。
- 不通过条件：模型试图直接 edit、patch、plan、open Coq session 或派发 child，而未先 read。
- 不通过后：抛出 `proof_transaction_resync_required`；要求 read 后从返回的精确 source 重新计算动作。

## T04. 在调用大模型前，脚本先尝试自动调度

- 大模型正在做什么：如果已有可执行 subtask，本轮主 prover 不先思考，而由脚本直接派发 child。
- 脚本入口：`SessionProofWorkflow.planNextSubtask()`。
- 代码：
  - assistant 已 finish 时：`packages/opencode/src/session/prompt.ts:916-923`
  - 正常模型调用前：`:1241-1247`
  - 调度器主体：`packages/opencode/src/session/proof-workflow.ts:6522-6910`
- 触发时机：每次 loop 迭代，在退出判断和正常模型调用前各检查一次。
- 通过条件：存在 live binding、文件存在、无需 staged read，且调度器产生 `ScheduledSubtask`。
- 通过后：脚本 enqueue subtask 并 `continue` loop；下一轮执行 child model，不调用主 prover。
- 不通过条件：没有 region、当前 repair worker 是叶子、等待 running task、状态需主 prover处理、或 dispatch gate 不满足。
- 不通过后：继续 fallback guard 和主模型调用。

## T05. Repair/fallback guard 在主模型调用前判定是否允许继续

- 大模型正在做什么：尚未开始本轮生成。
- 脚本入口：`assessFallbackGuard()`。
- 代码：
  - 调用：`packages/opencode/src/session/prompt.ts:1169-1238`
  - 主体：`packages/opencode/src/session/proof-workflow.ts:5835-6154`
- 触发时机：proof agent 每轮正式调用模型之前。
- 通过条件：没有 active blocker，或 blocker 已因 source 实质变化/compiler receipt 被释放，或计数未触阈值。
- 通过后：继续 scheduler 或主模型。
- 不通过后：分三类：
  - 普通 parent fallback：生成 synthetic stop，要求 theorem-level edit/remodel；
  - repair child 达硬阈值：`yieldStalledRepair()`，把最佳 certified/base snapshot 交回父 prover并停止 child；
  - cross-session/repair-yield lock：不再派发相同 repair，父 prover必须先产生实质变化。
- 具体阈值见 T20。

## T06. 脚本构造模型上下文、提醒和工具门

- 大模型正在做什么：接收当前状态投影，而不是直接读取脚本内部 Map/数据库。
- 脚本入口：`insertReminders()`、proof projection、工具装配。
- 代码：
  - `packages/opencode/src/session/prompt.ts:1249` 之后
  - accepted-plan gate：`:76-139`、`:1460`、`:1548-1582`
  - proof projection：`packages/opencode/src/session/proof-projection.ts`
- 触发时机：即将调用 LLM。
- 注入内容通常包括：binding、workflow phase、queue、active region、accepted plan、materialization review、compiler certificate、route failure ledger、repair assignment、transaction revision、live Coq state和下一动作提醒。
- 通过条件：上下文和工具成功构造。
- 通过后：调用 prover/lemma/repair 模型；模型只能通过工具提出实际动作。
- 不通过条件：accepted-plan lookup hard gate 命中时，不是上下文构造失败，而是部分工具的 `execute` 被替换为确定性 gate 返回。
- 不通过后：模型必须先做一次可逆 proof edit 或 active proof-session step，才能恢复被 gate 的 lookup 工具。

## T07. 规划前 read/evidence 顺序

这一阶段混合了 prompt 规则和少数脚本硬门，必须区分。

### 7.1 有 `proof.tex`

- Prompt 要求位置：`packages/opencode/src/session/prompt.ts:1510-1545` 附近。
- 硬门位置：`packages/opencode/src/tool/task.ts:428-490`。
- 触发：目标目录向上找到 `proof.tex`。
- 规则：prover 在 lemma delegation 前必须通过 `read` 读过 `proof.tex`。
- 通过：消息历史中存在对该文件的 completed `read`。
- 通过后：可以将 proof.tex 用作 semantic spine 依据，再提交 plan/materialize。
- 不通过：直接调用 lemma。
- 不通过后：`assertProverLemmaDelegationReadiness()` 抛错，lemma 不启动。

### 7.2 没有 `proof.tex`

- Prompt 位置：`packages/opencode/src/session/prompt.ts:1590-1645` 附近。
- 规则：先 read theorem file，再做一次与 theorem conclusion/hypotheses 直接相关的 bounded semantic inspection，然后调用 structured `proof_plan`。
- 这是主要由 prompt 驱动的顺序；grep 列表本身不算强 evidence。
- 真正的后续硬门是：没有 accepted plan/materialized locality contract 时，decomposition dispatch 会失败。

### 7.3 Whole-lemma 模式

- Prompt 位置：`packages/opencode/src/session/prompt.ts:1750-1824`。
- 顺序：先 read theorem file，再做一次 targeted lookup/live-goal inspection，然后进入 proof action。
- 连续 5 次 lookup 无 edit 时会收到强提醒，但此处是 prompt liveness，不是 T20 的 parent fallback hard stop。

## T08. 大模型调用 `proof_plan`，脚本先绑定真实 theorem/root goal

- 大模型正在做什么：提交文本草案或 structured nodes/edges。
- 脚本入口：`ProofPlanTool.execute()`。
- 代码：`packages/opencode/src/tool/proof-plan.ts:648-1017`
- 触发时机：模型调用 `proof_plan`。
- 限制解释：若 session 已绑定真实 `.v`，脚本从当前 staged source 和 binding position 解析 theorem/root goal，不能由模型随意改名或改根命题。
- 通过条件：绑定位置解析到唯一 theorem；submitted theorem/root_goal 与真实值一致。
- 通过后：进入 candidate audit、DAG review 和 plan persistence。
- 不通过条件及错误：
  - `bound_theorem_unresolved`：绑定位置无法解析到一个有显式 proof body 的 theorem；
  - `bound_theorem_mismatch`：模型提交的 theorem 名与绑定 theorem 不同；
  - `bound_root_goal_mismatch`：提交的 root goal 与实际 theorem conclusion 不同。
- 不通过后：这些进入 hard errors，`materialization_allowed=false`，不得据此写 skeleton。

## T09. 文本 plan 只算 draft；bound proof 要 structured nodes

- 代码：`packages/opencode/src/tool/proof-plan.ts:889-921`
- 触发：绑定 proof 文件时只传 `text`，未传非空 `nodes`，且 plan 尚未 accepted/exhausted。
- 通过条件：提交 structured `nodes`，包含可审查字段。
- 通过后：plan 才进入持久化的 semantic attempt/budget 状态。
- 不通过条件：只有自然语言文本。
- 不通过后：返回 `submission_kind=text_draft`、`planning_status=draft`、`recommended_action=submit_structured_plan`；抽出的线性 nodes 仅供参考，不获得 materialization 权限。

## T10. `proof_plan` DAG 和 composition 全量硬规则

- 核心函数：`reviewProofPlan()`、`reviewCompositionDataflow()`。
- 代码：`packages/opencode/src/tool/proof-plan.ts:247-618`
- 触发：每个 structured proof plan。
- 总判定：
  - 存在任何 hard error：`status=reject`，`materialization_allowed=false`；
  - 无 hard error但有 warning：`status=revise`，但 `materialization_allowed=true`；
  - 都没有：`status=ready`，允许 materialize。

### 10.0 Structured Prosa/MathComp candidate 的机械 premise audit

- 函数：`auditPlanLibraryCandidates()`、`auditCandidateLemma()`。
- 代码：`packages/opencode/src/tool/proof-premise-audit.ts:109-250`
- 调用位置：`packages/opencode/src/tool/proof-plan.ts:677-685`
- 触发条件：bound proof 上提交 structured nodes，且节点填写了 `prosa_candidate_lemmas` 或 `mathcomp_candidate_lemmas`。
- 脚本实际动作：
  1. 从当前 source 中隔离并重命名目标 theorem declaration；
  2. 在临时 Coq probe 中 `Check` 候选 lemma；
  3. 对节点 `formal_goal` 建立 assertion；
  4. `eapply` 候选，随后只用 live context 中的 `assumption/reflexivity` 尝试消除显然 premise；
  5. 把剩余 goals 记录成 residual premises 和 fingerprints；
  6. 计算 lemma type、target contract、instantiation 和 compiler output fingerprints。
- 资源限制：节点 audit 串行，单个节点内候选并发最多 2，防止候选列表放大成无界编译进程。
- 通过分支：
  - `usable`：候选能应用，且 live context 消除了所有 residual premises；
  - `bridge_required`：候选结论兼容，但仍有 residual premises；只有每个 premise 映射到显式 dependency 或当前 compiler certificate 后，整体 plan 才能通过。
- 不通过分支：
  - `interface_mismatch`：Coq 无法把候选应用于 target；
  - `audit_error`：无法隔离 theorem、进程/环境异常或其他 audit 失败。
- 通过后：脚本用生成的 audit 覆盖/补充 candidate 数据，再进入下列 plan hard rules；不能仅凭模型自述“这个引理可用”。
- 不通过后：转成 `candidate_interface_mismatch` 或 `candidate_premise_audit_error` hard error，禁止 materialization。

### 10.1 图结构硬错误

| 错误码 | 触发/不通过 | 如何通过 | 失败后的下一步 |
|---|---|---|---|
| `empty_plan` | nodes 为空 | 至少一个真实语义节点 | 补结构化节点后重交 |
| `duplicate_node_id` | node ID 重复 | 每个 node ID 唯一 | 修 ID 和所有 edge/dependency 引用 |
| `unknown_edge_endpoint` | edge 指向不存在节点 | edge 两端都在 nodes | 修 edge 或补节点 |
| `self_cycle` | 节点依赖自己 | 移除自环 | 重构依赖 |
| `dependency_cycle` | 整体 DAG 有环 | 必须为有向无环图 | 重构 semantic dependency |
| `parent_equivalent_leaf` | delegation leaf 的 target 等价 theorem root | root 留在 Layer 1，暴露严格更小子义务 | 改 decomposition，而非让 lemma 接管整 theorem |
| `disconnected_leaf` | delegation leaf 无 outgoing edge 且无 consumer | 声明 DAG edge 或 parent consumer | 连接到实际组合路径 |

### 10.2 composition certificate 硬错误

这些主要用于 medium/high-risk semantic 节点，或会消费 branch premise/semantic dependency 的节点。

| 错误码 | 触发/不通过 | 如何通过 | 失败后的下一步 |
|---|---|---|---|
| `composition_certificate_missing` | 风险节点没有 composition steps | 给出从输入到精确 target 的步骤证书 | 补 dataflow，不得直接 materialize |
| `duplicate_composition_step` | `step_id` 重复 | step ID 唯一 | 重编号并保持顺序 |
| `required_hypothesis_unmapped` | required hypothesis 没被任何 step 输入消费 | 在 `input_refs` 中显式消费 | 补输入映射 |
| `dependency_use_missing` | depends_on 节点没有 output anchor 映射 | 每个 producer dependency 写 `dependency_uses` | 补映射 |
| `dependency_output_anchor_mismatch` | 声称的 anchor 不是 producer 输出 | anchor 必须匹配 producer formal goal/normal form/output fact | 修 producer contract 或 anchor |
| `dependency_not_consumed` | anchor 声明了但 composition step 未使用 | 某 step 的 input_refs 消费它 | 补消费步骤 |
| `dependency_use_unknown_producer` | use 指向未知或非 declared dependency | producer 存在且在 depends_on | 修依赖声明 |
| `composition_target_mismatch` | 最后一步输出不等于节点精确 target | final output proposition 与 normal form/formal goal 相等 | 修最后组合步骤或节点 target |

### 10.3 候选引理/残余 premise 硬错误

候选库引理会先经过机械 `Check`/application audit；相关 schema 在 `packages/opencode/src/tool/proof-schema.ts:27-158`。

| 错误码 | 触发/不通过 | 如何通过 | 失败后的下一步 |
|---|---|---|---|
| `candidate_interface_mismatch` | 候选结论无法匹配 target | 更换 lemma/instantiation/target shape | 不得 materialize 此路线 |
| `candidate_premise_audit_error` | 机械 audit 自身失败 | 修候选引用或环境后重审 | 不能把未知结果当可用 |
| `candidate_unresolved_premise` | residual premise 没有可用来源 | 映射 dependency 或有效 compiler certificate | 新增真实 dependency/证书 |
| `candidate_premise_local_evidence_invalid` | audit 仍暴露 premise，却自称 exact/convertible local | 由依赖节点证明或提供当前证书 | 不接受自我声明 |
| `candidate_premise_dependency_missing` | premise 指向不存在或未依赖的 node | dependency 存在且列入 depends_on | 修 DAG |
| `candidate_premise_dependency_target_mismatch` | dependency 不导出精确 premise fingerprint | 重写 dependency target 或用等价 bridge 证书 | 修 contract |
| `candidate_premise_certificate_missing` | 标记 compiler-certified 却无 ID | 提供 live certificate ID | 不能通过文本声明认证 |
| `candidate_premise_certificate_invalid` | ID 不是当前 theorem/source/target 的有效证书 | 使用 live structured handoff 中精确匹配的证书 | 重新编译对应 region 或改为 dependency |

### 10.4 Bound plan 完整性硬错误

| 错误码 | 触发/不通过 | 如何通过 | 失败后 |
|---|---|---|---|
| `no_delegation_or_layer1_closure` | structured bound plan 既无 delegation candidate，也无 non-delegated root closure | 至少暴露一个局部义务或明确 Layer-1 closure | 重做 plan |

### 10.5 Warnings：不会阻断 materialization

| warning | 含义 | 建议动作 |
|---|---|---|
| `claim_delta_missing` | semantic leaf 未说明与 parent claim 的差异 | 补 claim delta，便于审查 |
| `compound_leaf` | 一个 leaf 有多种 transformation | 若不是单一输出/依赖边界，应拆分；否则可保留 |
| `evidence_unconfirmed` | 无精确接口、定义或 negative-search receipt | 做 targeted evidence 检查 |
| `candidate_premise_audit_missing` | 候选 lemma 没有机械 audit | 建议补 audit；单独出现时不是 hard block |
| `no_delegation_candidates` | 没标 lemma-ready leaf | 只在确有有意义局部义务时标，不为凑数拆 tactic leaf |
| `parent_composition_unspecified` | 未说明谁关闭 theorem root | 补 Layer-1 consumer/composition |

通过 warning-only plan 后，下一步仍是 materialize accepted DAG；warning 不应导致无限 planning loop。

## T11. 已验证失败路线不能原样重用

- 函数：`ProofRouteLedger.assessKnownRouteReuse()`。
- 代码：
  - `packages/opencode/src/session/proof-route-ledger.ts:446-541`
  - 接入 plan：`packages/opencode/src/tool/proof-plan.ts:792-870`
- 触发：同 workspace/file/theorem/theorem-context 下存在 `confidence=verified` 的 route failure，新的 plan 再次使用相同 lemma/target/instantiation/missing-premise route。
- 不通过错误：
  - `verified_failed_route_reuse`：机械审计确认是同一失败路线；
  - `verified_failed_route_requires_audit`：看似同路线，但新候选没带足够 audit，无法证明它不同。
- 通过条件：
  - 换 lemma 或 target route；
  - `different_instantiation`：机械 fingerprint 证明 instantiation 真不同；
  - `missing_premise_certified`：当前 region certificate 证明原缺 premise；
  - `failure_audit_invalidated`：compiler-backed 证据使旧 audit 失效。
- 不通过条件：只写自由文本 override，或没有机器可验证证据。
- 通过后：记录 structured override，plan 继续审查。
- 不通过后：作为 hard plan error，禁止 materialization。

## T12. Plan revision budget、accepted lock 和实现中的真实数值

- 函数：`recordDecompositionPlanAttempt()`。
- 代码：
  - `packages/opencode/src/session/proof-workflow.ts:2382-2580`
  - `packages/opencode/src/tool/proof-plan.ts:609-618`、`:923-1014`
  - `packages/opencode/src/tool/proof-schema.ts:169-176`
- semantic fingerprint：忽略纯说明文字变化，防止靠改注释/证据措辞伪造新 DAG。
- 当前运行时真实预算：`max_semantic_revisions=4`，即初始 DAG + 4 次不同 semantic revisions，最多 5 个不同 semantic fingerprints。
- 通过条件：当前 plan 无 hard errors，并且未越预算；状态变 `accepted`，保存 `accepted_plan` 和 fingerprint。
- 通过后：accepted semantic DAG 锁定；通常返回 `materialize_once` 或 `materialize_accepted_plan`。
- 不通过但仍有预算：状态 `planning`，返回 `revise_semantic_dag` 或针对 route 的 `repair_plan_route`。
- 不通过且预算耗尽/重复同一失败 fingerprint：状态 `exhausted`，写 `terminal_verdict`，返回 `stop_and_report_best_plan`。
- accepted 后再提交 plan：
  - 同 fingerprint：不替换 accepted plan，只要求 materialize；
  - 没有 compiler/remodel/drift 证据：accepted plan 保持锁定；
  - 有证据时最多允许一次 accepted-plan repair revision；
  - marker-only drift 通常走一次 administrative reconciliation，不应重做 semantic DAG。
- 重要实现差异：prompt 仍写“最多 2 次 revisions/3 个 DAG”，见 `packages/opencode/src/session/prompt.ts:1540`、`:1638`、`:1651-1654` 附近；代码硬门实际是 4 次 revisions/5 个 DAG。应以运行时代码为准。

## T13. Accepted plan 后的 lookup liveness gate

- 函数：`applyAcceptedPlanMaterializationToolGate()`。
- 代码：`packages/opencode/src/session/prompt.ts:76-139`、`:1548-1582`
- 触发：accepted plan 已存在，但连续 passive lookup/inspection，没有 proof-file edit 或 active proof step。
- 12 次：软提醒开始，要求 materialize 最小可逆 skeleton 或做一个 active proof step。
- 16 次：硬 gate。
- 硬 gate 暂时替换的工具：`read`、`grep`、`glob`、`lsp`、`coqtop`、`codesearch`、`list`、`bash`、`batch`、`task`、`skill`、`proof_plan`、`coq-proof-dag`、`pdf-read`。
- 通过条件：发生目标 proof edit，或 active `coq_session`/等价 proof step。
- 通过后：lookup streak 重置，精确 blocker lookup 可恢复。
- 不通过条件：继续调用被 gate 的工具。
- 不通过后：工具不执行原操作，只返回 `accepted_plan_materialization_gate` 和 required next action。
- 注意：它不要求 proof step 必须成功，只要求从纯查找转为具体 proof attempt。

## T14. Materialize skeleton 时的 theorem/file 硬范围检查

- 函数：`assertBoundProofBodyMutationAllowed()`。
- 代码：`packages/opencode/src/session/proof-workflow.ts:674-882`
- 调用者：`edit`、`write`、`apply_patch`。
- 触发：编辑命中绑定 `.v` 文件。
- 初始化 canonical scope 的要求：
  - 绑定位置位于唯一 theorem；
  - theorem 有且只有一个显式 `Proof.`；
  - theorem 有且只有一个 terminator；
  - 绑定位置与 theorem proof span 一致；
  - canonical source 存在且 position 有效。
- 每次 mutation 必须保持：
  - 不能 move、用另一路径替换、或移走 bound proof file；
  - theorem 前的 protected prefix 不变；
  - theorem 后的 protected suffix 不变，只有 EOF 空白有有限容忍；
  - proof 中仍恰好一个 `Proof.` 和一个 terminator，且顺序正确；
  - 不能把 `End X.` 复制进 proof；
  - terminator 后不能有 tactic/command；
  - 注释和字符串必须闭合。
- decomposition 模式额外规则：如果已经存在 plan state，则它必须为 accepted 且含 accepted plan/fingerprint，才能 materialize；否则抛 `decomposition_plan_materialization_rejection`。注意代码条件是“plan state 存在时检查”，不是无条件要求 plan object 必须存在。
- 通过后：继续事务 scope/style/permission/写入步骤。
- 不通过后：抛 `proof_scope_integrity_rejection` 或 `proof_scope_integrity`，编辑完全不应用。

## T15. Proof style 硬规则

- 函数：
  - `assertNoRewriteBang()`
  - `assertNoIntuition()`
- 代码：`packages/opencode/src/tool/coq-style-guard.ts:1-37`
- 触发：`.v` 文件 edit/write/apply_patch/compile，以及 `coq_session step` tactic。
- 不允许：
  - ssreflect repeat rewrite：`rewrite !...`、`rewrite -!...` 等匹配形式；
  - `intuition` tactic。
- 通过条件：显式逐步 rewrite，或使用命名 bridge/normalization lemma；逻辑证明使用 `left/right/split/apply/exact` 等显式 tactics。
- 通过后：继续其他 edit/compile gate。
- 不通过后：立即抛错；source 不更新、tactic 不提交。

## T16. 通用 read-before-write、stale edit 和 transaction stage

### 16.1 FileTime：写前必须 read

- 代码：`packages/opencode/src/file/time.ts:56-68`
- 触发：普通磁盘 edit/write。
- 通过：本 session 读过文件，且磁盘 mtime 没有比 read 时间新超过 50ms 容忍值。
- 不通过：未 read，或外部修改发生在 read 之后。
- 不通过后：拒绝写，要求重新 read。

### 16.2 连续 stale edit conflict

- 代码：`packages/opencode/src/tool/edit-conflict-guard.ts:11-83`
- 阈值：同一 source 连续 3 次 oldString/context 冲突。
- 通过：edit/patch 能基于当前精确 source 匹配，或重新 read 后清除 conflict state。
- 不通过：第三次后触发 `stale_edit_livelock`。
- 不通过后：该 source 上进一步 edit 被阻断，必须 read 当前文件/region 后重算 edit。

### 16.3 Active transaction 的 stale-view 和单文件限制

- 代码：
  - `ProofEditTransaction.assertPatchTargets()`：`packages/opencode/src/session/proof-edit-transaction.ts:1116-1125`
  - `ProofEditTransaction.stage()`：`:1127-1152`
  - `assertAuthorized()`：`:574-623`
- 通过：
  - patch 只更新事务授权的一个 `.v` 文件；
  - 不能 add/delete/move；
  - edit 的 `before` 精确等于当前 `stagedSource`；
  - after source 满足当前 `proof_region/theorem_body/theorem_spine` scope。
- 通过后：只增加 transaction revision 并写 journal，不立即覆盖 workspace 文件。
- 不通过：多文件 patch、移动文件、stale before、越 scope、marker 被删/复制、结构失效。
- 不通过后：抛 `proof_transaction_scope_rejection`、`proof_transaction_stale_view` 或 structure rejection。

### 16.4 三种 transaction scope

- `proof_region`：lemma child，只能改 begin/end marker 之间，marker 必须原样且各出现一次。
- `theorem_body`：普通 repair/root composition，可改 `Proof.` 后的 proof body和 terminator，但不能改 theorem declaration/外部文件结构。
- `theorem_spine`：只有明确 `needs_theorem_spine_change` 或 `should_lift_to_theorem_level` repair 才使用；允许改 theorem segment，但仍必须保护周围 module/file prefix/suffix，不能复制 `End`。

### 16.5 当前 `write` 工具的实现边界

- `edit` 会执行 staged-read 检查并调用 `ProofEditTransaction.stage()`：`packages/opencode/src/tool/edit.ts:62`、`:109`、`:205`。
- `apply_patch` 有 active transaction 时会检查单文件并调用 `stage()`：`packages/opencode/src/tool/apply_patch.ts:53-69`、`:267-274`。
- 但 `write` 当前只做 FileTime、style、lemma scope、wide takeover、bound theorem guard，然后直接 `Filesystem.write()`：`packages/opencode/src/tool/write.ts:21-89`。
- `write` 没有调用 `ProofEditTransaction.assertStagedReadSynchronized()` 或 `stage()`；通用 `Tool.define()` 也没有替它包装事务。
- 因此不能笼统声称“所有 write 都只改 staged source”。这是当前实现不一致/潜在缺陷；在 active proof transaction 中应优先使用 transaction-aware `edit` 或 `apply_patch`，直到实现补齐。

## T17. `proof_region` 解析：什么 region 会进入队列

- 函数：`parseRegions()`、`parseProofObligations()`。
- 代码：`packages/opencode/src/session/proof-workflow.ts:1489-1633`
- 触发：source refresh、materialization review、scheduler、compiler lifecycle。
- 合法 region 必须满足：
  - begin marker 能解析 `owner: lemma`；
  - 有非空 `admit_id`；
  - begin marker 位于某个物理 theorem 的 `Proof.` 与 terminator 之间；
  - marker 的 `theorem` 属性若存在，必须等于物理 theorem；
  - 找到匹配 end marker；若 end 写 `admit_id`，必须匹配；
  - 同 ID 不能在前面仍处于 open 状态；
  - region 内不能嵌套同 ID begin；
  - regions 不能互相重叠；
  - 同 theorem + admit_id 不能重复。
- pending hole 判定：`by admit.`、`admit.` 或空 `{ ... }` proof block。
- 通过后：按物理位置排序并编号 `order=1..n`，进入 queue refresh。
- 不通过后：多数 parser 异常不是立即抛错，而是该 region 被静默排除；后续会表现为 missing plan node、queue 为空、marker unavailable 或 locality failure。这一点排查时很重要。

## T18. Accepted plan 与 materialized regions 必须一一匹配

- 函数：
  - `materializationPreviewFromBlocks()`
  - `classifyDecompositionCheckpoint()`
  - `decompositionDispatchCheck()`
- 代码：`packages/opencode/src/session/proof-workflow.ts:1679-1977`
- 触发：skeleton 写入后、checkpoint/coqc、每次 lemma dispatch 前。
- 检查内容：
  - accepted plan 中每个 `delegation_candidate` 必须恰有一个 region；
  - region begin marker 必须把 `plan_node` 写在实际 marker 属性中；邻近普通注释不能替代；
  - 不得 missing、duplicate 或 unexpected pending region；
  - `depends_on` 必须与 accepted node 一致；
  - `kind`、`layer`、`target normal form` 必须匹配；
  - region 必须属于 accepted theorem；
  - 只有 accepted delegation node 可派发。
- review 状态：
  - `partial`：有 expected node 尚未 materialize；
  - `drifted`：duplicate/unexpected/dependency/metadata 不匹配；
  - `matched`：完全一致。
- 通过条件：review 当前 source-bound，`matched`，至少一个 expected node，所有 mismatch 列表为空。
- 通过后：decomposition checkpoint 返回 `ready`；scheduler 可继续 locality/compile 检查。
- 不通过后：
  - compile 即使成功也可返回 `decomposition_incomplete`；
  - lemma dispatch 被阻止；
  - marker-only 问题可用一次 administrative reconciliation；
  - 有 compiler/remodel/post-reconciliation drift 证据时，可能开放一次 accepted-plan structural repair revision。

## T19. Queue refresh 与 certificate 当前性

- 函数：`mergeQueue()`、`refresh()`、`validationCertificateCurrent()`。
- 代码：
  - `packages/opencode/src/session/proof-workflow.ts:1150` 附近
  - `:2037-2808`
- 触发：文件 source 变化、调度、编译、任务结果持久化。
- 通过/保留 solved 的条件：同 file、admit_id、region fingerprint、source hash 和 compiler signature 上 certificate 仍 current。
- 通过后：solved 状态和证书可保留，queue 合并 task/repair 信息。
- 不通过条件：region 被改、source hash 不符、certificate 不再 current、parser 找不到 region，或编译错误回退到已认证范围。
- 不通过后：certificate 清除，region 变回 pending/unvalidated/escalated；后续 region 也可能因前缀失效而重开。

## T20. Fresh lemma dispatch 的所有主要硬门

- 手动 task 入口：`packages/opencode/src/tool/task.ts:791-862`
- 自动 scheduler：`packages/opencode/src/session/proof-workflow.ts:6522-6910`
- order/locality：
  - `assertFreshLemmaAssignmentOrder()`：`:2843-2877`
  - `assertFreshLemmaAssignmentLocality()`：`:2879-2941`
  - `localityGate()`：`:3110-3146`

按实际执行顺序，fresh lemma 必须满足：

1. 调用者规则：lemma agent 不能再 launch lemma child；本 assistant turn 只能 launch 一个 fresh lemma。
2. 参数规则：fresh lemma 必须带 `lemma_assignment`；resume 必须带原 `task_id`。
3. recovered transaction 已 read 同步。
4. 目标 `.v` 文件存在。
5. 若有 `proof.tex`，prover 已 read。
6. 文件里至少有一个显式 gap；不能对隐式 theorem idea 直接派 lemma。
7. 首次 delegation 前，要么调用过 proof_plan，要么已持久化明确 theorem split；只有一个裸 admit 且无 plan/edit 不够。
8. queue 非空，且 assignment 正好是文件顺序中第一个 unresolved region。
9. 第一个 unresolved 必须为 `pending`；不能跳过 running/split/unvalidated/escalated。
10. region 可被 parser 找到。
11. 若定义了 `target_name`，目标 statement 必须在 marker 内。
12. accepted plan 存在时，live materialization review 必须通过。
13. locality contract 完整：
    - `kind` 不是 `unknown`；
    - `kind` 不能是 `paper_bridge`；
    - 有 `plan_node`；
    - 显式声明 `depends_on`，即使为空也要有；
    - 有 `source`；
    - `input` 非空；
    - 有 `output`；
    - `layer` 属于 lemma-ready 集合；
    - 有 `expected`；
    - 有 `normal_form`；
    - target statement 与 normal form shape 匹配；
    - 有 grounded proof evidence。
14. 可下放 layer：`semantic`、`shape`、`prosa`、`mathcomp`、`coq_shape`、`local_arithmetic`。
15. 不可下放：`paper`、`theorem_spine`，以及 planning placeholder `paper_bridge`；必须先由 Layer 1 refine。
16. dispatch 前 scaffold 不能有非预期错误；允许“当前 theorem 因保留 admits/Qed 不完整”这一预期 scaffold 情形。
17. sibling syntax blocker 不能位于当前 region 之外并阻止其可靠验证。

- 全部通过后：`markRunning()`，设置 30 分钟默认 lease，生成 `ScheduledSubtask {agent: lemma}`。
- 任一不通过后：
  - 手动 task 调用通常直接抛错；
  - 自动 scheduler 对 contract/scaffold/sibling 问题通常把 region `escalated`，生成 `needs_subgoal_remodel`、`blocked_by_sibling_syntax` 等 repair；
  - 对 plan materialization 不匹配通常保持不派发，等待主 prover修 skeleton。

## T21. Task 创建时 transaction 如何从父模型交给子模型

- 函数：`beginProofEditTransaction()`。
- 代码：
  - `packages/opencode/src/tool/task.ts:275-338`
  - child 执行/收尾：`:975-1112`
  - transfer：`packages/opencode/src/session/proof-edit-transaction.ts:964-995`
  - begin：`:998-1070`
- 触发：启动 proof-producing child：lemma、repair prover、fixer、whole-lemma 等。
- scope 选择：
  - 有 lemma editable markers：`proof_region`；
  - repair 明确要求 theorem spine：`theorem_spine`；
  - 普通 repair：`theorem_body`。
- 交接顺序：先尝试从 parent `transfer()` 同一 transaction；没有才 `begin()`/恢复。
- repair child 设置 `preferCertifiedBaseline=true`，优先从最佳 compiler-certified recovery source 开始，不从最新失败 draft 盲目继续。
- 通过后：transaction owner 改为 child，`synchronizedRevision` 清空，child 必须先 read；父工作区磁盘仍可保持旧版本。
- 不通过：child 已拥有另一个 transaction、file/theorem 不同、scope reauthorization 跨 theorem、授权结构不合法。
- 不通过后：抛 transaction conflict/scope error，child 不启动或不能编辑。
- child 正常结束或异常：都调用 `finalize(...handoffToSessionID=parent)`；即使最终结构化回答损坏，也尽量把 certified snapshot 或 staged journal 交回父 session，避免丢失长时间 proof work。

## T22. Lemma worker 的局部、顺序和目标编辑限制

- 函数：`assertLemmaSequentialEditAllowed()`。
- 代码：`packages/opencode/src/session/proof-workflow.ts:6321-6405`
- 触发：agent=`lemma` 修改 assigned `.v`。
- 必须满足：
  1. assignment 的 begin/end marker 在 before 和 after 中都存在；
  2. marker 外全部文本逐字不变；
  3. 只改当前第一个 unresolved local hole；
  4. 当前 hole 未经 checkpoint/coqc 验证前，后面的文本/后续 `have/assert/suff` 不能改；
  5. 当前 hole 是空 `{}` block 时必须保留 partition braces，只填内部；
  6. exported `target_name` 必须保留；
  7. target proposition 的 normalized shape 必须保持；错误 target 应返回 `needs_subgoal_remodel`，不能静默改 contract；
  8. resume session 若没有 trusted validated prefix baseline，必须先成功 checkpoint/coqc。
- 通过后：edit 可 stage，接着应小步 `coq_session` 或 checkpoint/coqc 验证。
- 不通过后：抛明确错误；source 不更新。模型必须回当前 first hole 修复，或结构化 escalate。

## T23. Wide prover/fixer 对 solved/running region 的限制

- 代码：
  - solved prefix freeze：`packages/opencode/src/session/proof-workflow.ts:6420-6448`
  - running region takeover：`:6450-6519`
- 触发：主 prover、fixer、whole-lemma 等 wide proof agent 编辑有 workflow 的 `.v`。
- solved prefix：第一个 unresolved region 之前的 solved regions 被冻结，wide repair 只能改其后文本。
- running region：默认不能改 lemma 正在持有的 region。
- 通过普通编辑：不触碰 solved prefix 和 running region。
- 通过 takeover：显式传 `takeover_running_region=true` 且 `takeover_reason` 非空。
- takeover 后：对应 region `running -> pending`，清 task ID、lease和 active 指针，记录 takeover agent/reason/time。
- 不通过：未声明 takeover 却改 running region，或改已认证 prefix。
- 不通过后：编辑拒绝；原 lemma ownership/certificate 保持。

## T24. `coq_session open`：进入 live goal 前的检查

- 代码：
  - 工具入口：`packages/opencode/src/tool/coq-session.ts:393-568`
  - region context 函数 `assignedRegionSessionContext()`：`packages/opencode/src/session/proof-workflow.ts:2660-2701`
- 触发：模型调用 `coq_session {op: open}`。
- 必须满足：
  - 有 `file` 和 `theorem`；
  - recovered staged revision 已 read；
  - lemma worker 有 live assignment 时不能用 `scope=theorem`；
  - `assigned_region` 要有 live lemma assignment 或显式 `proof_position`；
  - 目标 region 前面的所有 region 都必须 `solved`/compiler-certified；
  - 从 certified prefix 打开的实际 goal 与 expected goal/fingerprint 匹配。
- goal 匹配兼容：会考虑 full/conclusion fingerprint，以及 `>=` 与反向 `<=` 等规范化等价形式。
- 通过后：建立 session，返回 goal、hypotheses、fingerprint、section variables；允许 step。
- 不通过但仍可建立的情形：entry goal mismatch，session 标为 `session_state_desync`，初始 `desync_count=2`，tactic 暂时 blocked。
- 其他不通过：直接抛错，不创建可用 session。

## T25. `coq_session step/inspect` 的限制

- 代码：`packages/opencode/src/tool/coq-session.ts:345-390`、`:571-746`

### 25.1 自动同步

- 每次 step/goal/inspect 前最多尝试 2 次 `synchronizeSession()`。
- 检查 assignment 是否仍 live、source/region/certified prefix fingerprint 是否变化，以及当前 goal 是否匹配。
- 同步通过：更新 context/goal，继续操作。
- 同步失败：tactic/inspect 不提交，返回 `session_state_desync`；要求重新检查 certified prefix 和 assignment goal 后 reopen。

### 25.2 Step

- 必须有已 open session 和 tactic。
- 每次最多 3 个 tactic sentences；更多直接拒绝，要求拆小。
- 同样禁止 rewrite-bang 和 `intuition`。
- Coq 返回 proof progress：更新 goal、hypotheses、fingerprint和 tactic history。
- Coq 返回 failure：保留旧 focused goal，记录错误，交给模型做同一 blocker 的局部修复。
- `coq_session` 成功一步只是交互证据；必须把有效 tactic 写回 `.v` 并经过 compiler lifecycle，才成为持久 proof progress。

### 25.3 Inspect

- 必须同时有 `left_expression` 和 `right_expression`。
- 每个 expression：最大 1000 字符、单行、无控制字符/字符串/`;`、无 Coq command/tactic 关键字、括号平衡、不能包含可充当 sentence terminator 的点。
- symbols 最多 8 个，且必须是合法 qualified identifiers。
- audit cache：每 session 最多 16 条，全局最多 256 个 sessions；超出删除最旧项。
- 通过后：返回 `convertible/not_convertible/inconclusive` 等 diagnostic receipt。
- 注意：inspect 只算诊断证据，不算 proof completion 或 compiler certificate。

## T26. Lemma 的 structured `proof_result` schema

- schema：`packages/opencode/src/tool/task.ts:51-226`
- 验证：`inspectProofResult()`，`:697-733`
- 触发：lemma child 返回最终文本，TaskTool 从中抽取 structured proof result。
- 全局限制：
  - `stack_mode` 必须为 `dfs_lifo`；
  - 最大 recursion depth 4；
  - 每次 split 最大 children 1；
  - child 必须有 ID、title、statement、为何更小、在 parent 中角色、连续 order，以及 source/paper reference。

### `status=solved`

- 通过：`split_required=false`、children 为空、无 remodel request、`proof_text` 非空。
- 失败：任何字段矛盾。
- 通过后：仍进入 T27 solved validation，不因 JSON 写了 solved 就直接认证。

### `status=split`

- 通过：`split_required=true`、`split_reason` 非空、恰有 1 个 immediate child、`proof_text` 为空、order 从 1 连续、当前 depth < 4。
- 失败：达到 depth 4、children 超 1、order 重复/不连续、同时返回 proof text。
- 通过后：region 变 `split`，保留 `task_id`，scheduler 恢复同一个 lemma session；lemma 不得新建另一个 lemma subagent。

### `status=escalate`

- 通过：`split_required=false`、children 为空、reason 非空、`escalation_type` 必填；若类型为 `needs_subgoal_remodel`，必须有 `remodel_request`。
- 失败：字段矛盾或缺少 required evidence。
- 通过后：父 workflow 记录 escalation、attempt report/route failure，并调 theorem repair。

### Schema 无效或完全没有 structured result

- Task metadata 中记录 validation errors；running task 若完成却始终没有 structured result，lease 到期后释放/重调度，marker 被破坏时升级为 `not_local`。

## T27. `solved` 声明的二次脚本验收

- 函数：`assignedSolvedGate()`、`solvedValidationGate()`。
- 代码：`packages/opencode/src/session/proof-workflow.ts:3280-3307`、`:3793-3888`
- 触发：结构化 result 声明 `solved`。
- 必须全部满足：
  1. assigned marker 仍存在；
  2. assigned region 中无 admit/空 block；
  3. exported target 仍存在；
  4. 返回 `proof_text` 非空；
  5. normalized `proof_text` 必须精确等于完整 assigned region，不能带 region 外文本；
  6. region 内含匹配 `informal proof` 的注释；
  7. scaffold 成功，或失败仅为预期 incomplete Qed，或 compiler 已越过该 region；
  8. 验证期间 transaction/source hash 未变化；
  9. 最终 source 解析出恰当、hole-free 的该 region。
- 通过后：生成 `ValidationCertificate`，region 真正变 `solved`；parent scheduler 可以处理下一个 region。
- 不通过后：result 被改判为 `escalated`，常见类型：
  - marker/范围/返回文本问题：`not_local`；
  - 仍有 hole：`blocked_by_sibling_syntax`；
  - target 被删：`needs_subgoal_remodel`；
  - scaffold/compiler 问题：由 `validationEscalation()` 分类后进入 repair。

## T28. 编译器 lifecycle：certificate 如何产生、失效和向后传播

- 函数：`recordCompilerResult()`。
- 代码：`packages/opencode/src/session/proof-workflow.ts:4055-4460` 附近。
- 调用者：
  - `packages/opencode/src/tool/coqc.ts:123`、`:245`
  - `packages/opencode/src/tool/checkpoint.ts:135`、`:301`
- 触发：每次 `coqc`/checkpoint 成功或失败。

### 编译成功

- hole-free、当前 source 上未认证的 region 可以变 `solved` 并获得 certificate。
- lifecycle 返回 `certified` 时，当前或最靠前的新 region 获得认证。
- 如果没有新 region certificate、没有 semantic debt reduction、没有 structural split receipt、也没有 final Qed，则只是 `baseline` 或 `stalled`，不算 accepted progress。

### 整体编译失败但错误已越过 region

- 编译器可以证明前缀 region 已被接受，即便最终 theorem 在后面失败。
- lifecycle 可返回 `certified`，该 region 获得证书。
- 但完整失败 draft 的 `workspace_committable=false`；它只能进入 `bestRecoverySource`，不能作为整文件直接提交。

### 错误回退到已认证区域

- 当前及其后的 certificate 被清除，状态重开；running 后续任务可被释放。
- 下一步回到最早失效 region 修复，不能继续把后续结果当有效。

### Source 在验证期间变化

- 返回 `source_changed`，不把旧编译结果绑定到新 source。
- 下一步必须对当前 staged source 重新验证。

### 错误无法映射

- 返回 `unmapped_failure`，保存 failure 信息但不伪造 region certificate；主 prover根据 first error/repair gate继续。

## T29. Proof progress 分类：什么才会重置 liveness 和获得可提交快照

- 函数：`proofProgressFor()`、`classifyCoqcSuccess()`、`classifyCoqcFailure()`。
- 代码：`packages/opencode/src/session/proof-workflow.ts:3471-3791`
- hard progress：
  - `final_qed`；
  - `region_certified`；
  - `missing_premise_certified`；
  - `semantic_debt_reduced`，且被移除 debt 都有 compiler certificate。
- structural progress：
  - `locality_validated_split`，accepted repair 被 materialize 成 matched dependency-complete DAG 并编译。
- debug only：
  - `first_error_advanced`；只说明最早编译错误向后推进，不证明语义义务已解决。
- 不算 progress：
  - 只减少 admit 文本但没有证书；
  - compile success 但无新证书/final Qed；
  - syntax 恢复、comment/marker 改名、route 描述变化；
  - inspect 可转换结论。
- 通过 hard/structural 且完整 source 可提交：调用 `markAccepted()`。
- 通过 compiler-backed prefix 但完整编译失败：调用 `markCertifiedRecovery()`。
- 只有 debug：调用 `markDebug()`。
- stalled/regressed：保留 journal，要求继续修当前 blocker，不重置为完成。

## T30. `bestCommittableSource` 与 `bestRecoverySource` 是两套状态

- 代码：
  - 字段：`packages/opencode/src/session/proof-edit-transaction.ts:45-76`
  - recovery 排序：`:265-389`
  - `markAccepted()`：`:1155-1207`
  - `markCertifiedRecovery()`：`:1209-1249`
- `bestCommittableSource`：允许 transaction finalize 后写入 workspace 的完整 snapshot。
- `bestRecoverySource`：repair/恢复时最佳 compiler-certified 起点；可能整个文件仍编译失败，因此不一定能直接提交。
- `markAccepted()` 同时更新 committable 和 recovery candidate。
- `markCertifiedRecovery()` 只更新 recovery candidate。
- 通过后的下一步：repair child/新 session 可从最佳 certified baseline 继续，同时保留最新失败 draft revision/hash供审计。
- 不这样分离的风险：若把“前缀 region 已认证但整 theorem 后面失败”的 draft 当 committable，会把失败整文件写回 workspace；当前实现明确避免了这一点。

## T31. 编译工具本身的运行限制和返回分支

- 代码：
  - `packages/opencode/src/tool/coqc.ts:90-325`
  - `packages/opencode/src/tool/checkpoint.ts:95-380`
- 默认超时：120 秒，可由对应环境变量覆盖。
- timeout：杀进程组并抛错；不产生 proof certificate。
- abort：杀进程组并抛错。
- subprocess output 超上限：杀进程组并抛错。
- compile success：仍要运行 region lifecycle、proof progress、decomposition checkpoint 和 final theorem gate。
- compile success + decomposition incomplete：工具可返回 `decomposition_incomplete`，说明 Coq 编译成功不等于 skeleton/dispatch contract 完成。
- compile success + nonfinal：返回 `compile_success_nonfinal`，下一步必须获得新 region certificate或完成 final Qed。
- compile failure + lemma prefix complete：可返回 `lemma_prefix_success_full_compile_failed`；lemma 可以前进到下一个 local hole，但整 theorem仍未完成。
- compile failure + current prefix incomplete：继续修第一个 local proof block，不能跳去无关 broad lookup。
- `checkpoint` 额外要求 `reason` 只能是 `node_completed`、`bridge_lemma` 或 `milestone`，见 `packages/opencode/src/tool/checkpoint.ts:45-68`；非法 reason 直接拒绝，不运行编译。
- `checkpoint` 会对“file + 完整 source + first error 文件/行/消息”计算错误 hash，见 `packages/opencode/src/tool/checkpoint.ts:277-299`：
  - hash 不同：返回新的 first error，模型应针对它修改当前节点；
  - hash 相同：返回 `SAME AS PREVIOUS`/`same_as_previous=true`，说明重复编译没有改变 source 或错误锚点；下一步必须先更新 proof/node state，不能用重复 checkpoint 冒充进展。

## T32. Escalation、context strengthening 与 repair task

- 结果持久化：`persistOutcome()`，`packages/opencode/src/session/proof-workflow.ts:5006-5101`
- repair 生成：`repairAssignment()`/`scheduledRepair()`，约 `:5330-5558`
- route context escalation：`routeContextEscalation()`，`:4857` 附近
- 触发：lemma 明确 escalate，或 solved validation/scaffold/locality 失败。
- 普通局部 context mismatch：允许最多一次 same-session targeted context-normalization retry；必须有实际 audit/失败 bridge 证据，不能无限 resume。
- 已验证 `not_convertible` 且有 failed local bridge：可以直接接受 structured escalation。
- repair worker 责任：改 theorem-level contract、加现有 context 可支持的 bridge、或按 evidence remodel outer spine；不能在 unchanged lemma-owned region 内继续偷偷证明，也不能靠重命名 admit_id制造“变化”。
- repair 通过条件：
  - assigned obligation 获证书；或
  - theorem 获新的 accepted compiler-backed progress receipt；或
  - substantive remodel 经 scaffold/accepted-plan materialization重新验证。
- repair 不通过：只有 syntax/comment/marker/source 文本变化而无 receipt，仍归 `structured_escalation`，repair state不重置。

## T33. Repair/proof task 嵌套派发限制

- 函数：`assertProofTaskDispatchAllowed()`。
- 代码：`packages/opencode/src/session/proof-workflow.ts:5655-5833`
- 触发：任意 proof-producing task 创建前。
- 硬规则：
  - theorem repair worker 是叶子，不能再 launch nested proof-producing task；
  -一般 proof task worker 只能下放 locality-validated lemma assignment，或一个更窄 fixer；不能开启无 scope 的 wide theorem prover；
  - lemma assignment file/theorem/admit_id 必须是 live bound region；
  - active repair 未解决时，新 task 要么携带精确 matching `proof_repair_assignment`，要么明确针对不同 theorem/file；
  - fallback 已 tripped 时，禁止再次派相同 proof task；
  - source 实质变化、region 消失、region solved 或新 receipt 可释放 stale repair lock。
- 通过后：允许 task 创建并进入 transaction handoff。
- 不通过后：抛 `proof_task_dispatch_blocked`；父 prover必须先产生实质 edit/receipt或更换明确 scope。

## T34. Cross-session identical repair lock

- 函数：`matchingCrossSessionRepair()`、`scheduleRepairOrLock()`。
- 代码：`packages/opencode/src/session/proof-workflow.ts:5571-5633`
- 触发：准备调 repair child。
- 不通过条件：另一个 session 已在同 file/theorem/admit_id、相同 escalation type/reason、相同 source/theorem fingerprint 上处理同一 repair，且尚无新 receipt。
- 不通过后：不启动重复 child，记录 `dispatch_lock_scope=cross_session`；要求先有 theorem proof/contract 实质变化或 compiler progress。
- 通过条件：不存在相同 active repair，或旧 repair 已有 receipt/source 已变化。
- 通过后：标记 repairing，调 `prover` repair child。

## T35. Fallback 与 repair-child liveness 的当前真实阈值

### 35.1 Parent prover passive fallback

- 常量：`FALLBACK_LOOKUP_STREAK_LIMIT=5`。
- 代码：`packages/opencode/src/session/proof-workflow.ts:458`、`:6122-6154`
- 触发：同 blocker、theorem/source/region fingerprint 未变，连续 passive lookup，无 target edit或 accepted progress。
- 5 次后：guard tripped，loop synthetic stop；下一步必须 theorem-level edit、bridge或 remodel，不能再 broad fallback。
- source 实质变化或新 compiler receipt：释放 guard。

### 35.2 Repair child non-materialization

- 常量：
  - warning 16；
  - hard stop 32。
- 代码：`packages/opencode/src/session/proof-workflow.ts:462-463`、`:5835-5895`
- 计数 epoch：从最近一次 accepted compiler progress receipt 后重新计数连续 tool actions。
- `<16`：不启用 guard。
- `16..31`：软警告；仍允许探索，但下一里程碑必须是 region/missing premise/debt/final Qed 的新 compiler certificate。
- `>=32`：hard stop，标记 `repair_child_no_materialization`，调用 `yieldStalledRepair()`。
- hard stop 后：
  - 若有 `bestRecoverySource`，切回它；
  - 否则回 base source；
  - 最新失败 draft 的 revision/hash仍保留；
  - transaction 交回 parent theorem_body scope；
  - 同一 unchanged repair child 不得再派，父 prover直接 materialize 诊断出的 remodel。

## T36. 所有 region solved 后，脚本为什么仍可能继续调用主 prover

- 代码：`packages/opencode/src/session/proof-workflow.ts:6769-6781`
- 触发：`firstUnresolved(queue)` 返回空。
- 脚本动作：运行 `finalTheoremGate()`。
- 通过：final gate ok，phase=`complete`，scheduler 不再派 lemma。
- 不通过：phase=`prover`，scheduler也不派 lemma；loop 调主 prover完成 parent composition、清除剩余 terminator问题并编译。
- 解释：局部 lemmas 只负责 DAG leaves；主 prover始终拥有 theorem root、局部事实的组合和最终 terminator。

## T37. Final theorem gate

- 函数：`finalTheoremGate()`。
- 代码：`packages/opencode/src/session/proof-workflow.ts:3314-3347`
- 触发：编译成功分类、队列全 solved、最终收尾。
- 必须满足：
  - 能找到目标 theorem；
  - 注释/字符串可解析；
  - 最后的有效 terminator 必须是 `Qed.`；
  - theorem 内无 `admit`、`by admit.`、空 proof block、`Admitted.`、`Abort.`。
- `Defined.` 不满足这个 gate；它不会被当成最终 `Qed.` 成功。
- 通过后：生成 `final_qed` hard receipt，`workspace_committable=true`，phase 可 complete。
- 不通过后：即使 `coqc` code=0，也返回 `compile_success_nonfinal`/final gate fail；主 prover继续修改，不能宣告完成。

## T38. Transaction finalize 与最终原子提交

- 函数：`ProofEditTransaction.finalize()`。
- 代码：`packages/opencode/src/session/proof-edit-transaction.ts:1350-1415`
- loop 最终调用：`packages/opencode/src/session/prompt.ts:1945`
- 触发：child 返回、异常 cleanup、主 loop 退出；final handed-off accepted 也可由 coqc/checkpoint 提前 finalize。

### 没有 `bestCommittableSource`

- 有 parent handoff：transaction 转给 parent，状态 `handed_off`；不写磁盘。
- 无 handoff：journal 标 `recoverable`，从内存释放；不写磁盘。

### 有 committable snapshot 但等于 base

- 返回 `unchanged`，不做文件写入。

### 有新的 committable snapshot

- 在 file lock 内重新读磁盘；磁盘 hash 必须仍等于 transaction `baseHash`。
- 通过：`Filesystem.writeAtomic()` 写最佳 committable source；刷新 workflow、FileTime和文件事件；状态 `committed`。
- 不通过：磁盘已被外部/其他事务改变，抛 `transaction_conflict`，标 `conflicted`，绝不覆盖新磁盘内容。

---

## 5. 通用 loop 级限制

## 5.1 相同工具调用 doom loop

- 代码：`packages/opencode/src/session/processor.ts:21`、`:158-183`
- 阈值：最近 3 个 part 是同一 tool、相同 JSON input、且非 pending。
- 触发后：请求 `doom_loop` permission。
- 默认 permission deny 时，processor 停止当前处理；只有 `experimental.continue_loop_on_deny=true` 才继续。
- 目的：阻止模型无变化地重复同一工具调用。

## 5.2 Proof epoch rotation

- 代码：`packages/opencode/src/session/prompt.ts:78-79`、`:203-296`、`:1849-1888`
- 默认阈值：projected context > 320,000 chars，并且至少 16 个 finished turns；若 > 640,000 chars，则不等满 16 turns也可 rotation。
- 通过 rotation 后：生成 deterministic proof-repair handoff，保留 transaction、workflow queue、certificates、live proof state等权威数据，进入新 epoch。
- 它不是 proof progress，也不改变 accepted DAG或certificate。

## 5.3 Running lease

- 默认：30 分钟，`packages/opencode/src/session/proof-workflow.ts:454-456` 附近。
- running task 无 outcome 且 lease 未过：scheduler等待，不重复派发。
- lease 过期：
  - completed 但无 structured result：release 后重新路由；
  - task error：release 后重试/升级；
  - marker 被破坏：`not_local` repair；
  - 有 task_id 且 assignment仍合法：恢复同一 task；
  - 都不满足：release running，再按当前 queue决定下一步。

---

## 6. Prompt-only 规则与代码硬门的区别

以下内容主要是写进 system/runtime prompt 的行为要求，单独违反时未必立即由 AST/脚本拒绝：

- 没有 `proof.tex` 时，先 read theorem file；
- 第一次 skeleton 前做 bounded semantic inspection；
- 下一非验证动作应为 `proof_plan`；
- accepted plan 后尽快 materialize；
- whole-lemma 先做 targeted lookup；
- broad lookup 后必须尽快转 proof action；
- context strengthening 不应请求新的 theorem assumptions；
- “最多 2 次 semantic revisions/3 个 DAG”的旧文案。

真正会机械阻止动作或改变状态的硬门包括：

- 有 `proof.tex` 却未 read 时，lemma delegation 拒绝；
- recovered transaction 未通过 read resync；
- accepted plan 后 16 次 passive lookup 的工具 gate；
- structured proof-plan DAG/candidate/route hard errors；
- plan revision runtime budget；
- bound theorem/file mutation scope；
- style guard；
- region parser、materialization match和 locality gate；
- file-order dispatch；
- transaction scope/stale view；
- lemma sequential edit和 target preservation；
- structured proof_result schema和 solved validation；
- compiler lifecycle/certificate；
- final theorem gate；
- fallback/repair-child/cross-session locks；
- atomic finalize base-hash conflict。

实际排错时应先问：这是 prompt 警告，还是工具抛错/状态迁移？二者的修复优先级完全不同。

---

## 7. 一个完整任务的典型交互样例

下面不是具体 theorem 的 tactic，而是控制流示例。

1. 用户要求证明 `foo.v` 中的 `Theorem X`。
2. 脚本绑定 `foo.v` 和 theorem 位置，进入 loop。
3. 脚本恢复旧 transaction；若恢复成功，prover 的第一动作必须 `read foo.v`。
4. 脚本发现没有可调度 region，调用主 prover。
5. 主 prover read theorem、proof.tex/相关定义，并做一个精确 goal/lemma inspection。
6. 主 prover调用 structured `proof_plan`。
7. 脚本机械 audit 候选 lemma、DAG、composition 和 route ledger：
   - hard error：返回具体错误；模型修 DAG；
   - warning only/ready：plan accepted并锁定。
8. 主 prover用 edit/apply_patch 写 theorem skeleton 和 `proof_region`。
9. 编辑工具先检查 style、bound theorem scope、running/solved ownership和transaction；通过后写 staged revision。
10. 脚本解析 regions，对比 accepted nodes和metadata，refresh queue。
11. 下一轮 loop 在调用主 prover之前，scheduler选择第一个 pending region。
12. scheduler 先验证 order、locality、scaffold和 sibling syntax；通过后生成 lemma assignment。
13. TaskTool 把 transaction 从 parent 交给 lemma child，scope 缩为该 proof_region。
14. Lemma child read staged source，open assigned-region Coq session，小步试 tactic。
15. 每个有效 tactic写回 region；edit guard保证不能越 region或提前改后一个 hole。
16. Lemma child checkpoint/coqc；脚本记录 prefix/certificate状态。
17. Lemma child返回 structured solved result。
18. 父脚本再次检查 proof_text、marker、target、informal comment、scaffold和source hash；通过才把 region标 solved。
19. transaction handoff回 parent；scheduler派下一个 region。
20. 如果某 region escalate，脚本不跳过它，而是创建 theorem-level repair assignment。
21. Repair child从最佳 certified baseline开始，修改 contract/bridge/spine并编译；无 compiler receipt 的文本变化不算完成。
22. 所有 region solved 后，主 prover组合这些已认证事实，关闭 theorem root并写 `Qed.`。
23. `coqc` 成功后，final gate检查无洞且以 `Qed.` 结束，生成 `final_qed` hard receipt。
24. transaction finalize重新验证磁盘 base hash，原子提交最佳 committable source。

---

## 8. 当前实现中应特别注意的差异/风险

1. Plan budget 文案与代码不同：prompt 是 2 次 revision，运行时是 4 次；硬门以运行时为准。
2. `write` 绕过 transaction stage：它会做大部分 proof guard，但直接写磁盘；active transaction 下优先用 `edit`/`apply_patch`。
3. Repair child 阈值当前是 16/32，不是旧实现中的更大数值。
4. Recovery snapshot 不等于 committable snapshot：编译失败但认证前缀时，只能作为恢复起点，不能提交整份失败 draft。
5. 非法 region 可能被 parser 静默排除，而不是在 edit 当场报错；应查看 materialization review/queue，而不只看编辑工具是否成功。
6. `coqc` exit 0 不等于 proof workflow complete：还要经过 decomposition checkpoint、proof progress receipt 和 final theorem gate。
7. 模型返回 `status=solved` 不等于 solved：还要经过 structured schema、locality、scaffold和 compiler certificate。

---

## 9. 最短诊断索引

| 现象 | 首先检查 |
|---|---|
| 模型不能继续 read/grep/task | accepted-plan 16 次 lookup gate，`prompt.ts:76-139` |
| edit 说必须先 read | recovered staged revision 或 FileTime，`proof-edit-transaction.ts:1089-1109` / `file/time.ts:56-68` |
| region 写了却不进队列 | parser 合法性，`proof-workflow.ts:1489-1623` |
| plan accepted 但 lemma 不启动 | materialization match/locality/scaffold，`:1679-1977`、`:3110-3146`、`:6891-6909` |
| lemma 不能改后面的 block | first unresolved local hole 顺序，`:6321-6405` |
| lemma 说 solved 但变 escalated | solved validation，`:3793-3888` |
| 编译失败但显示 region certified | prefix certificate；只更新 recovery snapshot，`coqc.ts:245-269` |
| 编译成功但不结束 | `compile_success_nonfinal` 或 decomposition incomplete，`:3600-3641` |
| repair child突然停止 | 32 次无 compiler-backed progress，`:5835-5895` |
| 同一 repair 不再派 | cross-session/repair-yield/fallback lock，`:5595-5633`、`:5655-5833` |
| 最后没有写回磁盘 | 没有 committable snapshot，或 transaction base-hash conflict，`proof-edit-transaction.ts:1350-1415` |
