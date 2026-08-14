# `src/tool` 综合说明

这个目录实现了 opencode 暴露给模型调用的工具层。每个工具本质上都是一个 `Tool.Info`：有工具 ID、描述、Zod 参数 schema、执行函数、权限请求、运行结果和元数据。工具由 [registry.ts](registry.ts) 统一注册，再由会话/Agent 层按当前 agent 权限初始化并暴露给模型。

## 目录分层

1. 工具框架：工具协议、注册表、输出截断、外部目录权限检查。
2. 文件与搜索工具：读文件、列目录、glob、grep、写入、局部编辑、多处编辑、patch。
3. 执行与语言服务工具：shell 命令、LSP 查询。
4. Web 与外部知识工具：抓网页、网页搜索、代码/API 文档搜索。
5. 会话编排工具：子代理、并行工具调用、技能加载、todo、提问、计划模式切换。
6. Coq/Rocq 证明工具：编译、coqtop 查询、交互式 proof session、Petanque、checkpoint、proof plan 抽取。
7. 描述文件：同名 `.txt` 大多是工具描述 prompt，被对应 `.ts` 文件 import。

## 核心框架

| 文件 | 作用 |
| --- | --- |
| [tool.ts](tool.ts) | 定义统一工具协议。`Tool.define()` 包装工具执行：先用 Zod 校验参数，支持自定义校验错误格式，然后执行工具。若返回 metadata 里没有 `truncated` 字段，会自动调用 `Truncate.output()` 截断大输出。 |
| [registry.ts](registry.ts) | 工具注册入口。`all()` 返回已注册工具列表，`ids()` 返回工具 ID，`tools()` 会按当前 agent 初始化每个工具并返回描述、参数 schema 和执行函数。 |
| [truncation.ts](truncation.ts) | 统一截断工具输出。默认最多 2000 行或 50 KB，超出的完整输出写入全局 `tool-output` 目录，并有 7 天清理任务。 |
| [external-directory.ts](external-directory.ts) | 如果工具访问 workspace 外路径，就通过 `ctx.ask({ permission: "external_directory" })` 请求权限。 |
| [invalid.ts](invalid.ts) | 兜底工具，提示某次工具调用参数非法；注册了但描述是 `Do not use`。 |

`Tool.Context` 里最关键的是：

- `sessionID/messageID/agent/callID`：标识本次调用所在会话、消息、agent 和工具调用。
- `abort`：外层取消信号，长任务需要监听。
- `metadata()`：实时更新 UI 元数据，比如 bash 实时输出。
- `ask()`：请求权限，读写、bash、web、task、skill、外部目录等敏感动作基本都会走这里。

## 已注册工具总览

[registry.ts](registry.ts) 当前注册的工具顺序如下：

| 工具 ID | 实现文件 | 主要用途 |
| --- | --- | --- |
| `invalid` | [invalid.ts](invalid.ts) | 非法工具调用兜底提示。 |
| `read` | [read.ts](read.ts) | 读取文件或目录。支持 offset/limit、图片/PDF attachment、二进制检测、读取后 warm LSP 和加载 instruction prompt。 |
| `glob` | [glob.ts](glob.ts) | 用 ripgrep 的文件扫描按 glob 找文件，默认限制 100 个结果，并按修改时间排序。 |
| `grep` | [grep.ts](grep.ts) | 用 ripgrep 对文件内容做正则搜索，支持 include glob，默认限制 100 个 match，并按文件修改时间排序。 |
| `edit` | [edit.ts](edit.ts) | 单文件字符串替换。会做 FileTime 防覆盖检查、权限确认、diff 元数据、LSP diagnostics，并内置多种 fallback 匹配策略。 |
| `multiedit` | [multiedit.ts](multiedit.ts) | 对同一个文件顺序执行多个 `edit`。内部直接初始化并调用 `EditTool`。 |
| `write` | [write.ts](write.ts) | 完整写入文件。会生成 diff、请求 edit 权限、发布文件事件、触发 LSP diagnostics。 |
| `bash` | [bash.ts](bash.ts) | 运行 shell 命令。会用 tree-sitter 解析命令、请求 bash/外部目录权限、合并 stdout/stderr、支持 timeout 和 abort。禁止用 bash 直接跑 Coq/Rocq 编译器或 proof shell。 |
| `task` | [task.ts](task.ts) | 创建或恢复子代理任务。对 prover/lemma 证明工作流有专门门禁和 structured result 校验。 |
| `todowrite` | [todo.ts](todo.ts) | 写入当前 session 的 todo list。 |
| `todoread` | [todo.ts](todo.ts) | 读取当前 session 的 todo list。 |
| `list` | [ls.ts](ls.ts) | 列出目录树。基于 ripgrep 文件扫描，默认忽略 `node_modules`、`.git`、`dist`、`.venv` 等目录，限制 100 个文件。 |
| `lsp` | [lsp.ts](lsp.ts) | 调用 LSP 能力：定义、引用、hover、symbols、call hierarchy、implementation、Rocq/Coq proof goals。 |
| `plan_exit` | [plan.ts](plan.ts) | 计划完成后询问用户是否切换到 build agent，并插入 synthetic user message。 |
| `question` | [question.ts](question.ts) | 向用户提问并把答案返回给模型。 |
| `webfetch` | [webfetch.ts](webfetch.ts) | 获取 URL 内容，支持 text/markdown/html，HTML 可转 markdown/text，图片作为 attachment 返回。 |
| `websearch` | [websearch.ts](websearch.ts) | 通过 Exa MCP 做网页搜索，返回搜索结果上下文。 |
| `codesearch` | [codesearch.ts](codesearch.ts) | 通过 Exa MCP 获取库/API/SDK 相关代码和文档上下文。 |
| `batch` | [batch.ts](batch.ts) | 并行执行多个已注册工具调用。最多 25 个，不允许嵌套 `batch`，不能 batch 外部 MCP/environment 工具。 |
| `skill` | [skill.ts](skill.ts) | 加载可用 skill 的完整说明，并抽样列出 skill 目录内文件。会按 agent 权限过滤 skill。 |
| `apply_patch` | [apply_patch.ts](apply_patch.ts) | 应用 opencode 自定义 patch 格式，支持 add/update/delete/move，多文件统一权限请求、文件事件、LSP diagnostics。 |
| `coqc` | [coqc.ts](coqc.ts) | 编译 `.v` 文件。自动读取 `_CoqProject`/`_RocqProject` flags，Rocq 环境优先用 `rocq c`，默认 120s 超时。 |
| `coqtop` | [coqtop.ts](coqtop.ts) | 用 `coqtop`/`rocq top` 执行 `check/search/print/state/eval`，支持 context 和 project flags。 |
| `proof_plan` | [proof-plan.ts](proof-plan.ts) | 把自然语言 proof text 粗略抽取成 `ProofPlanStep[]`，供 theorem-level 分解使用。 |
| `coq_session` | [coq-session.ts](coq-session.ts) | 基于 coqtop batch 重放的交互式证明 session。支持 open/step/goal/snapshot/undo/close/status。 |
| `checkpoint` | [checkpoint.ts](checkpoint.ts) | checkpoint-only 编译检查。要求 reason 是 `node_completed`、`bridge_lemma` 或 `milestone`，并判断错误是否和上次相同。 |
| `petanque` | [petanque.ts](petanque.ts) | 通过 rocq-lsp Petanque API 做增量 proof step，比 `coq_session` 更接近 LSP 服务器状态。 |

注意：[plan.ts](plan.ts) 里还有 `PlanEnterTool` 的代码，但目前整段被注释，且没有在 [registry.ts](registry.ts) 注册；实际可用的是 `plan_exit`。

## 文件与编辑工具

### `read`

[read.ts](read.ts) 支持读文件和读目录。目录会返回 entries；文本文件按 1-indexed 行号返回，并支持 `offset` 和 `limit`。它会限制单行长度、总输出字节数，并拒绝常见二进制文件。图片和 PDF 不直接展开内容，而是作为 message attachment 返回。

它还会调用 `InstructionPrompt.resolve()`，因此读取某些文件时可能把匹配的 instruction prompt 附加到输出后面。

### `list`、`glob`、`grep`

- `list` 是快速目录树视图，适合先看结构，默认忽略依赖/构建/缓存目录。
- `glob` 是按文件名模式找文件，适合 `**/*.ts` 这类路径搜索。
- `grep` 是内容正则搜索，适合找 symbol、配置项、报错文本等。

三者都会先请求权限，再做 workspace 外路径检查。`glob` 和 `grep` 都基于内部 `Ripgrep` 工具。

### `edit`、`multiedit`、`write`、`apply_patch`

这些工具都会走 edit 权限，并发布 `File.Event.Edited`、`FileWatcher.Event.Updated`，再触发 LSP diagnostics。

- `edit` 用 `oldString/newString` 做局部替换。除了精确匹配，还会尝试行 trim、首尾锚点、空白归一、缩进归一、转义归一、上下文匹配等 fallback。若匹配不到会报错；若匹配多处且没有 `replaceAll`，会要求提供更多上下文。
- `multiedit` 是同一个文件上的多次顺序 `edit`。
- `write` 是完整写入。适合新文件或重写整个文件。
- `apply_patch` 是多文件结构化 patch。它先解析 hunk，推导所有新内容，统一请求一次权限，再实际写入/删除/移动文件。

所有会写 `.v` 文件的工具都会调用 [coq-style-guard.ts](coq-style-guard.ts)，拒绝 ssreflect repeat-rewrite 形式 `rewrite !...` 和 `rewrite -!...`。

## Bash 工具

[bash.ts](bash.ts) 不是简单的 `spawn(command)` 封装，它做了几层约束：

- 用 tree-sitter bash 解析命令，提取命令名、参数、重定向文本。
- 对 `cd/rm/cp/mv/mkdir/touch/chmod/chown/cat` 等路径型命令解析参数，若触达 workspace 外目录会请求 `external_directory` 权限。
- 对每条非 `cd` 命令请求 `bash` 权限，并用 `BashArity.prefix()` 生成 allow-always pattern。
- 通过 plugin hook `shell.env` 注入 shell 环境。
- stdout/stderr 合并采集，同时把最多 30,000 字符的输出写进 metadata 供 UI 实时显示。
- timeout 默认来自 `OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS`，否则是 2 分钟；超时或 abort 会杀进程树。

特别重要：它会拒绝直接或包装后的 `coqc`、`coqtop`、`rocq c`，包括 `timeout ... coqc`、`bash -c "coqc ..."` 这类形式。Coq/Rocq 必须用专用工具，这样才能强制超时、进程清理和 proof trace 约束。

## LSP 工具

[lsp.ts](lsp.ts) 暴露这些 operation：

- `goToDefinition`
- `findReferences`
- `hover`
- `documentSymbol`
- `workspaceSymbol`
- `goToImplementation`
- `prepareCallHierarchy`
- `incomingCalls`
- `outgoingCalls`
- `proofGoals`

调用前会确认文件存在、对应语言有 LSP client，并 touch 文件。`proofGoals` 还会更新 `ProofContext` 和 `SessionProof`，把当前 Coq/Rocq proof 位置绑定到会话里。

## Web 与外部知识工具

| 工具 | 说明 |
| --- | --- |
| `webfetch` | 只接受 `http://` 或 `https://`。最大响应 5 MB，默认 30s，最多 120s。markdown 模式下 HTML 会用 Turndown 转 markdown；text 模式下会抽取可见文本。图片作为 attachment 返回。 |
| `websearch` | 调 Exa MCP 的 `web_search_exa`，支持 `numResults`、`livecrawl`、`type`、`contextMaxCharacters`。解析 SSE response。 |
| `codesearch` | 调 Exa MCP 的 `get_code_context_exa`，用于查库/API/SDK 文档和示例，`tokensNum` 范围 1000 到 50000。 |

## 会话与编排工具

### `task`

[task.ts](task.ts) 用于启动或恢复子代理 session。一般参数是：

- `description`：3 到 5 个词的短描述。
- `prompt`：子代理任务正文。
- `subagent_type`：目标 agent 名称。
- `task_id`：恢复旧子任务时使用。
- `lemma_assignment`：fresh lemma 任务必需。

普通子任务会创建 parent 为当前 session 的新 session，继承模型，按 agent 权限决定能否继续用 `task`，并默认禁用子代理自己的 todo 工具。

证明场景里它额外实现了 prover/lemma 调度约束：

- fresh `lemma` task 必须带完整 `lemma_assignment`：`file`、`theorem`、`admit_id`、`goal`、`replace`、`skeleton`、`done`；`admit_id` 用来定位整个 proof_region，替换单位也是整个 region。region 应包住导出的 local target 命题声明和完整 `{ ... }` 证明块，而不是只包住大括号内部；但该 target 命题声明是 prover 拆分出的子目标契约，lemma 应尽量保留，只在 proof body、注释和 same-region helper 上写东西，目标形状错了再 escalate/remodel。
- fresh `lemma` task 必须严格按 proof_region 文件顺序调度：当前第一个未 solved 的 region 是唯一可启动对象；前面的 region 只要还是 pending、running、split 或 escalated，就会阻塞后面的 region。
- `prover` 调 fresh `lemma` 前，如果附近有 `proof.tex`，必须已经读过它。
- `prover` 必须先用 `proof_plan` 或把 theorem-level skeleton 写进目标 `.v` 文件，让 gap 显式化。
- 同一个 assistant turn 只允许启动一个 fresh lemma task。
- `lemma` 可以在自己的 proof_region 所有权内选择直证、添加 same-region helper，或拆成更小的 child obligations；它不能再调用新的 `lemma` subagent，`split` 只表示同一个 lemma session 后续按 DFS/LIFO 继续。
- lemma 输出若包含 `<proof_result>...</proof_result>`，会按 `solved | split | escalate` schema 校验，并把 normalized result、validation 和 summary 放进 metadata。

### `batch`

[batch.ts](batch.ts) 并行执行多个注册表内工具。限制和特点：

- 最多执行 25 个，超出的会作为错误记录。
- 不允许 batch 调 batch。
- 只能调用 opencode registry 里的工具，不能 batch 外部 MCP/environment 工具。
- 每个子调用会单独写入 session part，成功/失败都记录。

### `skill`、`todo`、`question`、`plan_exit`

- `skill` 按 agent 权限列出和加载可用 skill，输出 `<skill_content name="...">` 块，并附带 skill 目录抽样文件。
- `todowrite`/`todoread` 维护当前 session 的 todo list。
- `question` 调 UI 询问用户，返回用户答案。
- `plan_exit` 用于 plan agent 完成计划后询问是否切到 build agent；用户同意后写 synthetic user message。

## Coq/Rocq 工具链

这个目录里 Coq/Rocq 相关代码很多，因为当前 opencode 分支把证明工作流当作一等能力处理。

### 公共辅助模块

| 文件 | 作用 |
| --- | --- |
| [coq-project.ts](coq-project.ts) | 自动检测 `_RocqProject` 或 `_CoqProject`，解析 flags，判断是否有 `rocq` binary，并在 `coqc/coqtop/coq_session` 中复用。 |
| [proof-schema.ts](proof-schema.ts) | 定义 `ProofPlanStep`、`EnvFeedback`、`TacticRecord`、`CoqProjectContext`、`SessionSummary`、`CoqSessionState`、`CheckpointResult` 等结构。 |
| [coq-style-guard.ts](coq-style-guard.ts) | 用一个正则拒绝 `rewrite !...` 和 `rewrite -!...` 这类 repeat-rewrite。写文件、patch、coqc、coqtop state/eval、coq_session step、petanque run 都会用到。 |

### `coqc`

[coqc.ts](coqc.ts) 编译单个 `.v` 文件：

- 文件必须在 workspace 内，并且后缀是 `.v`。
- 编译前读取文件并跑 `coq-style-guard`。
- 向上查找 `_RocqProject`/`_CoqProject`，自动带上 flags。
- 如果系统有 `rocq`，用 `rocq c`；否则用 `coqc`。
- 非 Windows 下通过 `setsid` 启动，超时后先 `SIGTERM`，再 `SIGKILL`。
- 默认超时 120 秒，可用 `OPENCODE_COQC_TIMEOUT_MS` 覆盖。
- 失败时解析 `File "...", line N` 格式，输出第一批错误摘要和 metadata errors。

### `coqtop`

[coqtop.ts](coqtop.ts) 用 batch 模式查询 Coq/Rocq：

- `check` 生成 `Check input.`
- `search` 生成 `Search input.`
- `print` 生成 `Print input.`
- `state` 会执行 input 再 `Show.`
- `eval` 原样执行 input。

它会把 context 和命令写入临时 `.v` 文件，再用 `-l` 加载，最后清理临时文件。`state/eval` 会拒绝 repeat-rewrite。

### `coq_session`

[coq-session.ts](coq-session.ts) 是内存中的 proof session，key 是 `ctx.sessionID`。它不是常驻 coqtop 进程，而是每次用已成功 tactic history 重建脚本，再 batch 执行新 tactic 或 `Show.`。

支持操作：

- `open`：从文件中定位 theorem/lemma/proposition/corollary，截取到 `Proof.` 或声明结束，解析 section context，初始化目标和假设。
- `step`：执行一个 tactic。限制最多 3 个 tactic sentence，成功则更新 focused goal，失败则记录 error class。
- `goal`：重新查询当前 goal。
- `snapshot`：保存当前 tactic index、goal、hyps、summary。
- `undo`：回滚到指定 snapshot。
- `status`：查看 session 摘要。
- `close`：删除内存 session。

反馈会被粗分为：`proof_progress`、`environment_problem`、`syntax_or_engine_problem`。

### `petanque`

[petanque.ts](petanque.ts) 走 rocq-lsp 的 Petanque API，更适合增量证明探索：

- `start`：按 theorem 名称或文件 position 启动 proof state。
- `run`：在当前 state 执行 tactic，成功后更新 server state 并查询 goals。
- `goals`：读取当前 goals。
- `close`：清除当前 session 的本地记录。

它维护 `state` 和 history，但当前工具接口没有单独暴露 rollback 操作。

### `checkpoint`

[checkpoint.ts](checkpoint.ts) 是 checkpoint-only 编译检查：

- reason 只能是 `node_completed`、`bridge_lemma`、`milestone`。
- 成功时汇总 warnings。
- 失败时提取 first error file/line/message。
- 对同一 session+file 计算错误 hash，若连续 checkpoint 得到同一错误，会标记 `same_as_previous`。

实现上它复用了 project flags 解析，但当前命令数组直接从 `coqc` 开始，而不是像 `coqc.ts` 那样通过 `CoqProject.coqcCmd()` 自动选择 `rocq c`。

### `proof_plan`

[proof-plan.ts](proof-plan.ts) 是 proof text 到 Coq proof DAG 的规划工具。它按 markdown header、`Step N`、`Lemma`、`Theorem`、`Claim`、编号行等识别纸面步骤，但输出的是 `ProofPlan` 对象而不是裸 step 数组：`nodes`、`edges`、`ready_nodes` 和 `planner_contract`。

每个 DAG node 包含 `kind`、`depends_on`、`source`、`input`、`output`、`layer`、`expected`、`target_normal_form`、`prosa_candidate_lemmas`、`mathcomp_candidate_lemmas` 和 `target` shape review。`prover` 需要把选中的 node materialize 到 `proof_region` marker 上，至少包括 `plan_node`、`depends_on`、`source`、`input`、`output`、`layer`、`expected`、`normal_form` 和 `evidence`，否则 workflow locality gate 不会派发给 `lemma`。

## `.txt` 描述文件

多数 `.txt` 文件是工具描述 prompt，例如 [read.txt](read.txt)、[bash.txt](bash.txt)、[task.txt](task.txt)、[coqc.txt](coqc.txt)。它们会被对应 `.ts` import，然后作为 tool description 暴露给模型。

有几点需要注意：

- [plan-enter.txt](plan-enter.txt) 存在，但 `PlanEnterTool` 目前被注释掉，所以它不是活跃工具描述。
- `petanque` 的 description 直接写在 [petanque.ts](petanque.ts) 里，没有单独 `petanque.txt`。
- `invalid` 和 `todoread` 的 description 也是代码里内联。

## 新增工具时的惯例

如果要在这里加新工具，通常需要：

1. 新建 `xxx.ts`，用 `Tool.define("xxx", ...)` 定义 ID、description、Zod 参数和 `execute()`。
2. 有长描述时新建 `xxx.txt` 并 import。
3. 在 [registry.ts](registry.ts) import 并加入 `all()` 返回数组。
4. 涉及文件路径时调用 [external-directory.ts](external-directory.ts) 的 `assertExternalDirectory()`。
5. 涉及敏感动作时先 `ctx.ask()` 请求对应权限。
6. 涉及文件写入时发布 `File.Event.Edited` 和 `FileWatcher.Event.Updated`，并 touch LSP 收集 diagnostics。
7. 输出可能很大时依赖 `Tool.define()` 的自动截断，或自己在 metadata 中显式设置 `truncated`。
8. 若会写 `.v` 或执行 Coq tactic，应调用 [coq-style-guard.ts](coq-style-guard.ts)，保持证明风格约束一致。