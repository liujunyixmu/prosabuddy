import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Session } from "."
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { MessageV2 } from "./message-v2"
import z from "zod"
import { Token } from "../util/token"
import { Log } from "../util/log"
import { SessionProcessor } from "./processor"
import { fn } from "@/util/fn"
import { Todo } from "./todo"
import { ProofContext } from "./proof-context"
import { SessionProof } from "./session-proof"
import { SessionProofWorkflow } from "./proof-workflow"
import { ProofEditTransaction } from "./proof-edit-transaction"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { ProviderTransform } from "@/provider/transform"
import fs from "fs/promises"
import path from "path"

export namespace SessionCompaction {
  const log = Log.create({ service: "session.compaction" })

  export const Event = {
    Compacted: BusEvent.define(
      "session.compacted",
      z.object({
        sessionID: z.string(),
      }),
    ),
  }
  // set this to reserve 12
  const COMPACTION_BUFFER = 12_000
  const PROOF_HISTORY_AGENTS = new Set(["prover", "lemma", "fixer", "whole-lemma"])
  const DEFAULT_PROOF_CONTEXT_RATIO = 0.78

  function tokenCount(tokens: MessageV2.Assistant["tokens"]) {
    return tokens.total || tokens.input + tokens.output + tokens.cache.read + tokens.cache.write
  }

  function proofContextRatio() {
    const value = Number(globalThis.process?.env?.OPENCODE_PROOF_COMPACTION_CONTEXT_RATIO)
    return Number.isFinite(value) && value >= 0.65 && value <= 0.9
      ? value
      : DEFAULT_PROOF_CONTEXT_RATIO
  }

  async function usableContext(model: Provider.Model) {
    const config = await Config.get()
    if (config.compaction?.auto === false) return undefined
    const context = model.limit.context
    if (context === 0) return undefined
    const output = ProviderTransform.maxOutputTokens(model)
    const reserved = config.compaction?.reserved ?? Math.min(COMPACTION_BUFFER, output)
    const contextUsable = context - output
    const inputUsable = model.limit.input ? model.limit.input - reserved : Number.POSITIVE_INFINITY
    return Math.max(0, Math.min(contextUsable, inputUsable))
  }

  export async function shouldCompact(input: {
    tokens: MessageV2.Assistant["tokens"]
    model: Provider.Model
    agent?: string
  }) {
    const usable = await usableContext(input.model)
    if (usable === undefined) return false
    const count = tokenCount(input.tokens)
    if (count >= usable) return true
    // A single proportional proof compaction before the real boundary avoids
    // hundreds of requests carrying a near-full repair history.  Unlike the
    // old fixed 160K cutoff, this scales with the provider context and normally
    // runs only once per long proof epoch, preserving a stable cache prefix for
    // the much larger middle portion of the run.
    return Boolean(
      input.agent &&
        PROOF_HISTORY_AGENTS.has(input.agent) &&
        count >= Math.floor(usable * proofContextRatio()),
    )
  }

  export async function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
    const usable = await usableContext(input.model)
    if (usable === undefined) return false
    const count = tokenCount(input.tokens)
    return count >= usable
  }

  export const PRUNE_MINIMUM = 20_000
  export const PRUNE_PROTECT = 40_000

  const PRUNE_PROTECTED_TOOLS = ["skill", "todowrite", "todoread", "coqc", "coqtop", "proof_plan", "coq_session", "checkpoint"]

  // goes backwards through parts until there are 40_000 tokens worth of tool
  // calls. then erases output of previous tool calls. idea is to throw away old
  // tool calls that are no longer relevant.
  export async function prune(input: { sessionID: string }) {
    const config = await Config.get()
    if (config.compaction?.prune === false) return
    log.info("pruning")
    const msgs = await Session.messages({ sessionID: input.sessionID })
    let total = 0
    let pruned = 0
    const toPrune = []
    let turns = 0

    loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
      const msg = msgs[msgIndex]
      if (msg.info.role === "user") turns++
      if (turns < 2) continue
      if (msg.info.role === "assistant" && msg.info.summary) break loop
      for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = msg.parts[partIndex]
        if (part.type === "tool")
          if (part.state.status === "completed") {
            if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue

            if (part.state.time.compacted) break loop
            const estimate = Token.estimate(part.state.output)
            total += estimate
            if (total > PRUNE_PROTECT) {
              pruned += estimate
              toPrune.push(part)
            }
          }
      }
    }
    log.info("found", { pruned, total })
    if (pruned > PRUNE_MINIMUM) {
      for (const part of toPrune) {
        if (part.state.status === "completed") {
          part.state.time.compacted = Date.now()
          await Session.updatePart(part)
        }
      }
      log.info("pruned", { count: toPrune.length })
    }
  }

  export async function process(input: {
    parentID: string
    messages: MessageV2.WithParts[]
    sessionID: string
    abort: AbortSignal
    auto: boolean
    overflow?: boolean
  }) {
    const userMessage = input.messages.findLast((m) => m.info.id === input.parentID)!.info as MessageV2.User

    let messages = input.messages
    let replay: MessageV2.WithParts | undefined
    if (input.overflow) {
      const idx = input.messages.findIndex((m) => m.info.id === input.parentID)
      for (let i = idx - 1; i >= 0; i--) {
        const msg = input.messages[i]
        if (msg.info.role === "user" && !msg.parts.some((p) => p.type === "compaction")) {
          replay = msg
          messages = input.messages.slice(0, i)
          break
        }
      }
      const hasContent =
        replay && messages.some((m) => m.info.role === "user" && !m.parts.some((p) => p.type === "compaction"))
      if (!hasContent) {
        replay = undefined
        messages = input.messages
      }
    }

    const agent = await Agent.get("compaction")
    const model = agent.model
      ? await Provider.getModel(agent.model.providerID, agent.model.modelID)
      : await Provider.getModel(userMessage.model.providerID, userMessage.model.modelID)
    const msg = (await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "assistant",
      parentID: input.parentID,
      sessionID: input.sessionID,
      mode: "compaction",
      agent: "compaction",
      variant: userMessage.variant,
      summary: true,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        output: 0,
        input: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: model.id,
      providerID: model.providerID,
      time: {
        created: Date.now(),
      },
    })) as MessageV2.Assistant
    const processor = SessionProcessor.create({
      assistantMessage: msg,
      sessionID: input.sessionID,
      model,
      abort: input.abort,
    })
    // Allow plugins to inject context or replace compaction prompt
    const compacting = await Plugin.trigger(
      "experimental.session.compacting",
      { sessionID: input.sessionID },
      { context: [], prompt: undefined },
    )
    const defaultPrompt = `Provide a detailed continuation checkpoint for our conversation above.
  The summary will be used so that another agent can continue the current owned task without losing progress, user constraints, proof state, important file-derived facts, or the current plan.

  Preserve the following information explicitly:
  - summarize only the current agent-owned scope; do not widen a local proof subgoal into a summary of the whole theorem or unrelated sibling work
  - if this is a subagent task, summarize the subagent task, not the parent conversation; preserve parent context only when it constrains the owned task
  - task ownership: current agent, parent/caller if known, task id if known, target file, enclosing theorem or lemma, owned admit id or goal id, replacement contract, phase, and sibling work that must remain untouched
  - user requirements, constraints, limitations, and preferences that must continue to be obeyed
  - which files matter and why
  - for proof subagents, the assigned local goal or subgoal only: the concrete local goal, key hypotheses, local definitions, current case or branch, non-formal proof framework, completed formal proof fragments, remaining local obligations, and whether the current attempt is still on-scope or has drifted
  - the earlier interaction trace for the current owned task: current progress, remaining work, blockers, dependencies, successful attempts, failed attempts, and guidance for the next attempt
  - important findings from file reads that materially affect this owned task, such as relevant definitions, imported facts, lemma types, equations, nearby proof patterns, paper-aligned local proof steps, and search results that changed the local proof strategy
  - failed edits, failed proof attempts, diagnostics, rollbacks, and lessons that should guide the next attempt
  - validation state: last successful proof step or checkpoint, latest goal/hypotheses/error if available, current coq_session/petanque snapshot or tactic position if available, and the next validation action

  Treat the active proof transaction's staged revision as the source of truth when one exists; otherwise use the current .v file on disk. Do not rewrite, normalize, or replace proof text in the summary. Instead, record which transaction revision, .v file, proof_regions, admit IDs, validated fragments, or frozen boundaries must remain unchanged.

  If live proof state, todo state, assignment metadata, or other structured proof context is provided below, preserve it explicitly and do not contradict it. If a fact is unknown from the available conversation, say it is unknown instead of inventing it.

  When constructing the summary, try to stick to this template:
  ---
  ## Goal

  [Current owned task goal. For proof subagents, this is the assigned local goal/subgoal only.]

  ## Assignment / Ownership

  - [Agent/subagent role, caller or parent if known, task id if known, target file, theorem/lemma, owned admit_id or goal_id, replacement contract, phase, and sibling work that must remain untouched]

  ## Constraints To Preserve

  - [User requirements, preferences, and must-not-change constraints]

  ## Frozen / Current File State

  - [Which .v files, proof_regions, admit IDs, validated fragments, or boundaries are the source of truth and must remain unchanged]
  - [Whether any proof text is validated, merely in-file but unvalidated, commented out, moved to scratch, or reverted]

  ## Local Goal And Proof State

  [For proof subagents: current concrete goal, important hypotheses, local definitions, current case/branch/bullet/focus state, live proof error, and coq_session/petanque snapshot or tactic position if known.]

  ## Owned Proof Plan And Trace

  [For proof subagents, summarize only the current assigned local goal or subgoal: its non-formal proof framework, controlling proof idea, key intermediate local claims, completed formal proof fragments, remaining local obligations, and why this local approach is being followed. Distinguish validated fragments from speculative, failed, reverted, or incomplete attempts.]

  ## Formal Progress

  - validated: [Proof fragments or tactics validated by coq_session, petanque, LSP, coqc, or checkpoint]
  - in_file_but_unvalidated: [Proof text currently in the file but not yet validated]
  - speculative_or_reverted: [Attempts that should not be treated as completed proof]

  ## Important File Discoveries

  [Only discoveries that materially affect this owned task: relevant definitions, imported facts, lemma types, equations, paper steps, nearby proof patterns, or failed search results that changed the local proof strategy.]

  ## Progress

  [What work has been completed for the current owned task and what state the current attempt is in.]

  ## Remaining Work

  [What is still unfinished for the current owned task, what blockers or dependencies remain, and what local obligations are still open.]

  ## Scope Check

  [State whether the current work is still aligned with the owned subgoal/task. Check for drift into sibling proof_regions, theorem-level skeleton changes, global assumptions, parent claims, or unrelated search. If it drifted, explain where and what should be pulled back into scope.]

  ## Failure History And Lessons

  [Earlier failed edits, diagnostics, rollbacks, and guidance or lessons for the next attempt on this owned task.]

  ## Validation Plan

  [Smallest next validation step, success condition, and first diagnostic to inspect if it fails.]

  ## Next Step

  [The exact next action the next agent should take. Prefer a concrete read, proof-session step, local claim, edit, or validation command over generic continue language.]

  ## Relevant files / directories

  [Construct a structured list of relevant files that have been read, edited, or created that pertain to the task at hand. If all the files in a directory are relevant, include the path to the directory.]

  ## Todo List

  [Include this section when a todo list is provided.]
  ---`

    let promptText = compacting.prompt ?? [defaultPrompt, ...compacting.context].join("\n\n")

    const promptMdPath = path.join(Instance.worktree, "prompt.md")
    try {
      const promptMdContent = await fs.readFile(promptMdPath, "utf-8")
      if (promptMdContent.trim()) promptText += "\n\n" + promptMdContent
    } catch {
      // Skip when the workspace does not provide prompt.md.
    }

    // Inject structured proof layers so compaction preserves proof state
    const proofContext: string[] = []

    const binding = SessionProof.get(input.sessionID)
    const workflow = SessionProofWorkflow.get(input.sessionID)
    const transaction = ProofEditTransaction.active(input.sessionID)
    const assignment = SessionProofWorkflow.activeLemmaAssignment(input.sessionID)
    if (binding || workflow || transaction || assignment) {
      const certified = workflow?.queue.flatMap((item) =>
        item.validation_certificate
          ? [{
              admit_id: item.admit_id,
              certificate_id: SessionProofWorkflow.validationCertificateID(item.validation_certificate),
              source_hash: item.validation_certificate.source_hash,
              compiler_signature: item.validation_certificate.compiler_signature,
            }]
          : [],
      ) ?? []
      proofContext.push(
        "<proof-compact-handoff>",
        "This metadata is authoritative after compaction. It intentionally omits staged proof text; read the current staged file/region through the proof tools before editing.",
        JSON.stringify({
          binding: binding
            ? {
                file: binding.file,
                line: binding.line,
                character: binding.character,
                stale: binding.stale,
              }
            : undefined,
          transaction,
          workflow: workflow
            ? {
                phase: workflow.phase,
                active_admit_id: workflow.active_admit_id,
                active_task_id: workflow.active_task_id,
                queue: workflow.queue.map((item) => ({
                  order: item.order,
                  theorem: item.theorem,
                  admit_id: item.admit_id,
                  kind: item.kind,
                  target_name: item.target_name,
                  status: item.status,
                  task_id: item.task_id,
                  escalation_type: item.escalation_type,
                  region_fingerprint: item.region_fingerprint,
                })),
                latest_escalation: workflow.latest_escalation,
                active_repair: workflow.active_repair,
                accepted_plan: workflow.decomposition_plan
                  ? {
                      theorem: workflow.decomposition_plan.theorem,
                      status: workflow.decomposition_plan.status,
                      accepted_semantic_fingerprint: workflow.decomposition_plan.accepted_semantic_fingerprint,
                      repair_revision_number: workflow.decomposition_plan.repair_revision_number,
                    }
                  : undefined,
                last_progress_receipt: workflow.last_progress_receipt,
                certificates: certified,
              }
            : undefined,
          assignment: assignment
            ? {
                theorem: assignment.theorem,
                admit_id: assignment.admit_id,
                goal: assignment.goal,
                target_name: assignment.obligation?.target_name,
                dependencies: assignment.obligation?.dependencies,
                region_fingerprint: assignment.editable_region?.region_fingerprint,
              }
            : undefined,
        }),
        "</proof-compact-handoff>",
      )
    }

    // Live proof snapshot (most recent real-time state from rocq-lsp)
    const snap = ProofContext.cached(input.sessionID)
    if (snap) {
      const parts = ["<proof-live-summary>", "## Live Proof State (MUST preserve in summary)"]
      if (snap.goal) parts.push(`Goal: ${snap.goal}`)
      if (snap.hyps.length > 0) parts.push(`Hypotheses: ${snap.hyps.slice(0, 15).join("; ")}`)
      if (snap.errors.length > 0) {
        parts.push(`Latest error: [${snap.errors[0].line}:${snap.errors[0].col}] ${snap.errors[0].message}`)
      }
      parts.push("</proof-live-summary>")
      proofContext.push(...parts)
    }

    const todos = Todo.get(input.sessionID)
    if (todos.length > 0) {
      proofContext.push(
        "<todo-state>",
        "Preserve the following todo list in your summary under a '## Todo List' section:",
        JSON.stringify(todos, null, 2),
        "</todo-state>",
      )
    }
    const fullPrompt = proofContext.length > 0
      ? [promptText, "", ...proofContext.filter(Boolean)].join("\n")
      : promptText

    const result = await processor.process({
      user: userMessage,
      agent,
      abort: input.abort,
      sessionID: input.sessionID,
      tools: {},
      system: [],
      messages: [
        ...MessageV2.toModelMessages(messages, model, { stripMedia: true }),
        {
          role: "user",
          content: [
            {
              type: "text",
              text: fullPrompt,
            },
          ],
        },
      ],
      model,
    })

    if (result === "compact") {
      processor.message.error = new MessageV2.ContextOverflowError({
        message: replay
          ? "Conversation history too large to compact - exceeds model context limit"
          : "Session too large to compact - context exceeds model limit even after stripping media",
      }).toObject()
      processor.message.finish = "error"
      await Session.updateMessage(processor.message)
      return "stop"
    }

    if (result === "continue" && input.auto) {
      if (replay) {
        const original = replay.info as MessageV2.User
        const replayMsg = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: input.sessionID,
          time: { created: Date.now() },
          agent: original.agent,
          model: original.model,
          format: original.format,
          tools: original.tools,
          system: original.system,
          variant: original.variant,
        })
        for (const part of replay.parts) {
          if (part.type === "compaction") continue
          const replayPart =
            part.type === "file" && MessageV2.isMedia(part.mime)
              ? { type: "text" as const, text: `[Attached ${part.mime}: ${part.filename ?? "file"}]` }
              : part
          await Session.updatePart({
            ...replayPart,
            id: Identifier.ascending("part"),
            messageID: replayMsg.id,
            sessionID: input.sessionID,
          })
        }
      } else {
        const continueMsg = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: input.sessionID,
          time: { created: Date.now() },
          agent: userMessage.agent,
          model: userMessage.model,
        })
        const text =
          (input.overflow
            ? "The previous request exceeded the provider's size limit due to large media attachments. The conversation was compacted and media files were removed from context. If the user was asking about attached images or files, explain that the attachments were too large to process and suggest they try again with smaller or fewer files.\n\n"
            : "") +
          "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: continueMsg.id,
          sessionID: input.sessionID,
          type: "text",
          synthetic: true,
          text,
          time: {
            start: Date.now(),
            end: Date.now(),
          },
        })
      }
    }
    if (processor.message.error) return "stop"
    Bus.publish(Event.Compacted, { sessionID: input.sessionID })
    return "continue"
  }

  export const create = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      agent: z.string(),
      model: z.object({
        providerID: z.string(),
        modelID: z.string(),
      }),
      auto: z.boolean(),
      overflow: z.boolean().optional(),
    }),
    async (input) => {
      const msg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: {
          created: Date.now(),
        },
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
        overflow: input.overflow,
      })
    },
  )
}
