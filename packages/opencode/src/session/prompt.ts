import path from "path"
import os from "os"
import fs from "fs/promises"
import z from "zod"
import { Filesystem } from "../util/filesystem"
import { Identifier } from "../id/id"
import { MessageV2 } from "./message-v2"
import { Log } from "../util/log"
import { SessionRevert } from "./revert"
import { Session } from "."
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { type Tool as AITool, tool, jsonSchema, type ToolCallOptions, asSchema, type ModelMessage } from "ai"
import { SessionCompaction } from "./compaction"
import { Instance } from "../project/instance"
import { Todo } from "./todo"
import { Bus } from "../bus"
import { ProviderTransform } from "../provider/transform"
import { SystemPrompt } from "./system"
import { InstructionPrompt } from "./instruction"
import { Plugin } from "../plugin"
import PROMPT_PLAN from "../session/prompt/plan.txt"
import BUILD_SWITCH from "../session/prompt/build-switch.txt"
import { defer } from "../util/defer"
import { ToolRegistry } from "../tool/registry"
import { MCP } from "../mcp"
import { LSP } from "../lsp"
import { ReadTool } from "../tool/read"
import { FileTime } from "../file/time"
import { Flag } from "../flag/flag"
import { ulid } from "ulid"
import { spawn } from "child_process"
import { Command } from "../command"
import { $, fileURLToPath, pathToFileURL } from "bun"
import { ConfigMarkdown } from "../config/markdown"
import { SessionSummary } from "./summary"
import { NamedError } from "@opencode-ai/util/error"
import { fn } from "@/util/fn"
import { SessionProcessor } from "./processor"
import { TaskTool } from "@/tool/task"
import { Tool } from "@/tool/tool"
import { PermissionNext } from "@/permission/next"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { iife } from "@/util/iife"
import { Shell } from "@/shell/shell"
import { Truncate } from "@/tool/truncation"
import { Trace } from "./trace"
import { ProofContext } from "./proof-context"
import { ProofProjection } from "./proof-projection"
import { SessionProof } from "./session-proof"
import { SessionProofWorkflow } from "./proof-workflow"
import { ProofRouteLedger } from "./proof-route-ledger"
import { ProofEditTransaction } from "./proof-edit-transaction"
import { SessionRestore } from "./restore"
import {
  lemmaLocalProofPrompt,
  proverTheoremWorkflowPrompt,
} from "./proof-policy"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

export namespace SessionPrompt {
  const log = Log.create({ service: "session.prompt" })
  const ACCEPTED_PLAN_PASSIVE_LOOKUP_LIMIT = 12
  const ACCEPTED_PLAN_PASSIVE_LOOKUP_HARD_LIMIT = 16
  const ACCEPTED_PLAN_HARD_BLOCKED_TOOLS = [
    "read",
    "grep",
    "glob",
    "lsp",
    "coqtop",
    "codesearch",
    "list",
    "bash",
    "batch",
    "task",
    "skill",
    "proof_plan",
    "coq-proof-dag",
    "pdf-read",
  ] as const

  /** Ephemerally mark user messages that actually arrived after the last
   * completed assistant turn. Persisted creation time is authoritative because
   * legacy message IDs roll over and are not globally chronological. */
  export function wrapQueuedUserMessages(
    messages: MessageV2.WithParts[],
    lastFinished: MessageV2.Assistant,
  ) {
    for (const msg of messages) {
      if (msg.info.role !== "user" || !MessageV2.isAfter(msg.info, lastFinished)) continue
      for (const part of msg.parts) {
        if (part.type !== "text" || part.ignored || part.synthetic) continue
        if (!part.text.trim()) continue
        part.text = [
          "<system-reminder>",
          "The user sent the following message:",
          part.text,
          "",
          "Please address this message and continue with your tasks.",
          "</system-reminder>",
        ].join("\n")
      }
    }
  }

  /** @internal Exported for testing. */
  export function applyAcceptedPlanMaterializationToolGate(
    tools: Record<string, unknown>,
    passiveLookupStreak: number,
  ) {
    const active = passiveLookupStreak >= ACCEPTED_PLAN_PASSIVE_LOOKUP_HARD_LIMIT
    const blockedTools: string[] = []
    if (active) {
      for (const toolID of ACCEPTED_PLAN_HARD_BLOCKED_TOOLS) {
        if (!(toolID in tools)) continue
        blockedTools.push(toolID)
        const current = tools[toolID]
        if (!current || typeof current !== "object" || !("execute" in current)) continue
        const execute = (current as { execute?: unknown }).execute
        if (typeof execute !== "function") continue
        tools[toolID] = {
          ...current,
          async execute() {
            return {
              title: "Accepted-plan materialization gate",
              metadata: {
                acceptedPlanMaterializationGate: true,
                blockedTool: toolID,
              },
              output: [
                "accepted_plan_materialization_gate: this passive lookup is temporarily blocked after the bounded evidence window.",
                `blocked_tool: ${toolID}`,
                "next_action: make one reversible edit in the first accepted proof region, or take one active proof-session step. Compiler evidence from that attempt may justify a narrow blocker-driven lookup on the following turn.",
              ].join("\n"),
            }
          },
        }
      }
    }
    return {
      active,
      warning_limit: ACCEPTED_PLAN_PASSIVE_LOOKUP_LIMIT,
      hard_limit: ACCEPTED_PLAN_PASSIVE_LOOKUP_HARD_LIMIT,
      blocked_tools: blockedTools,
      // Kept for trace consumers that understood the earlier delete-based gate.
      removed_tools: [] as string[],
    }
  }

  // Agents that receive live proof context refreshes before tool execution
  const proofAgents = new Set(["prover", "fixer", "lemma", "whole-lemma", "explorer"])
  const proofEditTools = new Set(["edit", "multiedit", "write"])

  async function recoverProofEditTransaction(sessionID: string, parentSessionID: string, agent: string) {
    if (agent !== "prover") return
    const binding = SessionProof.get(sessionID)
    if (!binding?.file.endsWith(".v") || !(await Filesystem.exists(binding.file))) return
    // Recovery must compare the persisted transaction against the current
    // workspace file. Transaction-aware reads are used only after recovery.
    const source = await Filesystem.readText(binding.file)
    const theorem = SessionProofWorkflow.theoremTargetAtProofPosition(source, {
      line: binding.line,
      character: binding.character,
    })?.theorem
    if (!theorem) return
    return ProofEditTransaction.recoverLatest({
      sessionID,
      parentSessionID,
      file: binding.file,
      source,
      theorem,
      agent,
      // A root prover owns final composition and the theorem terminator. A
      // recovered lemma-child transaction must therefore not retain its last
      // proof_region scope after all delegated regions have returned.
      minimumScope: { kind: "theorem_body", theorem },
    })
  }

  function stagedPlanningSource(sessionID: string) {
    const binding = SessionProof.get(sessionID)
    return binding ? ProofEditTransaction.source(sessionID, binding.file) : undefined
  }

  function cacheProjectionEnabled() {
    return process.env.OPENCODE_CACHE_PROJECT_TOOL_OUTPUTS === "1"
  }

  export function cacheProjectionOptions(agent: Agent.Info): MessageV2.CacheProjectionOptions {
    if (process.env.OPENCODE_CACHE_PROJECT_TOOL_OUTPUTS === "0") return { enabled: false }
    if (agent.name !== "prover" && agent.name !== "lemma") return { enabled: cacheProjectionEnabled() }

    const lemma = agent.name === "lemma"

    return {
      enabled: true,
      maxToolOutputChars:
        positiveIntegerEnv("OPENCODE_CACHE_MAX_TOOL_OUTPUT_CHARS") ?? (lemma ? 2_000 : 3_000),
      maxProofToolOutputChars:
        positiveIntegerEnv("OPENCODE_CACHE_MAX_PROOF_TOOL_OUTPUT_CHARS") ?? (lemma ? 4_000 : 6_000),
      maxEditToolOutputChars:
        positiveIntegerEnv("OPENCODE_CACHE_MAX_EDIT_TOOL_OUTPUT_CHARS") ?? (lemma ? 1_000 : 1_500),
      maxEditToolInputChars:
        positiveIntegerEnv("OPENCODE_CACHE_MAX_EDIT_TOOL_INPUT_CHARS") ?? (lemma ? 1_000 : 1_500),
      maxAssistantTextChars:
        positiveIntegerEnv("OPENCODE_CACHE_MAX_ASSISTANT_TEXT_CHARS") ?? (lemma ? 4_000 : 6_000),
      maxReasoningChars:
        positiveIntegerEnv("OPENCODE_CACHE_MAX_REASONING_CHARS") ?? (lemma ? 2_000 : 3_000),
    }
  }

  function proofWorkflowMode() {
    return process.env.OPENCODE_PROOF_WORKFLOW_MODE?.trim() ?? ""
  }

  function isDirectProsaProbe(agent: Agent.Info) {
    return (agent.name === "whole-lemma" || agent.name === "prover") && proofWorkflowMode() === "direct_prosa_probe"
  }

  async function inferProofFileFromPromptParts(parts: PromptInput["parts"]) {
    const candidates = new Set<string>()
    for (const part of parts) {
      if (part.type !== "text") continue
      for (const match of part.text.matchAll(/\btarget file\b[^\n`]*`([^`]+\.v)`/gi)) candidates.add(match[1])
      for (const match of part.text.matchAll(/\btarget file\b[^\n]*?([A-Za-z0-9_./-]+\.v)\b/gi)) candidates.add(match[1])
      for (const match of part.text.matchAll(/\bcoqc\s+([A-Za-z0-9_./-]+\.v)\b/gi)) candidates.add(match[1])
    }

    for (const candidate of candidates) {
      const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(Instance.directory, candidate)
      const relative = path.relative(Instance.directory, resolved)
      if (relative.startsWith("..") || path.isAbsolute(relative)) continue
      if (await Filesystem.exists(resolved)) return resolved
    }

    return undefined
  }

  function positiveIntegerEnv(name: string) {
    const raw = process.env[name]
    if (!raw) return undefined
    const value = Number.parseInt(raw, 10)
    return Number.isFinite(value) && value > 0 ? value : undefined
  }

  function runtimeContextMessage(text: string): ModelMessage {
    return {
      role: "user",
      content: [
        {
          type: "text",
          text,
        },
      ],
    }
  }

  function directProsaProbePrompt() {
    return [
      "<direct-prosa-proof-runtime>",
      "You are the primary theorem prover for the current file in direct Prosa proof mode.",
      "Prove the target theorem directly from the current theorem context and existing Prosa facts.",
      "Do not read proof.tex, do not build a paper-derived skeleton, and do not create proof_region/admit_id segmentation in this mode.",
      "Direct-proof workflow: read the target theorem file; search the theorem conclusion's key symbols and hypothesis names in the current workspace and prosa/; inspect only directly relevant existing lemmas or proof patterns; build the strongest direct proof you can justify; compile with coqc.",
      "Keep the work in direct theorem proof mode. Prefer existing Prosa lemmas and small local adaptations over paper-structured decomposition.",
      "</direct-prosa-proof-runtime>",
    ].join("\n")
  }

  async function lemmaContinuationPrompt(sessionID: string, messages: MessageV2.WithParts[]) {
    const suggestion = await SessionProofWorkflow.suggestNextSubtask(
      sessionID,
      messages,
      stagedPlanningSource(sessionID),
    )
    if (!suggestion) return undefined

    const task = suggestion.task
    const assignment = task.lemma_assignment ? JSON.stringify(task.lemma_assignment, null, 2) : undefined
    const display = path.relative(Instance.worktree, suggestion.file) || path.basename(suggestion.file)
    const pending = suggestion.pending.map((item) => item.admit_id)
    const latest = suggestion.latest
      ? `The latest completed lemma task returned status ${suggestion.latest.status} for admit_id ${suggestion.latest.admitID}.`
      : "No completed lemma task has been recorded yet for this refreshed queue."
    const latestEscalation = suggestion.latest_escalation
      ? `Latest structural escalation: admit_id ${suggestion.latest_escalation.admit_id} returned ${suggestion.latest_escalation.escalation_type}: ${suggestion.latest_escalation.reason}`
      : undefined
    const taskID = task.task_id ? `task_id: ${task.task_id}` : undefined
    const model = task.model ? `model: ${task.model.providerID}/${task.model.modelID}` : undefined

    return [
      "<lemma-continuation-reminder>",
      latest,
      latestEscalation,
      `The target file ${display} still contains dependency-ready lemma-owned proof_regions in scheduler priority order: ${pending.join(", ")}.`,
      "The proof workflow scheduler normally enqueues ready lemma tasks mechanically before the next prover turn.",
      "If this reminder appears in a prover turn, treat it as a fallback scope check: either repair the theorem-level bridge that blocks delegation, or use exactly the listed task fields without proving inside the region.",
      "Fallback task fields:",
      `description: ${task.description}`,
      `subagent_type: ${task.agent}`,
      taskID,
      model,
      `prompt:\n${task.prompt}`,
      assignment ? `lemma_assignment:\n${assignment}` : undefined,
      "Do not prove inside `proof_region owner: lemma` regions from the prover session; keep prover work to theorem-level repair, merge review, and final validation.",
      "</lemma-continuation-reminder>",
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n")
  }

  async function proverFinalizationPrompt(sessionID: string) {
    const binding = SessionProof.get(sessionID)
    if (!binding || !binding.file.endsWith(".v")) return undefined
    if (!(await Filesystem.exists(binding.file))) return undefined

    const state = SessionProofWorkflow.get(sessionID)
    if (!state || state.queue.length === 0) return undefined
    if (!state.queue.every((item) => item.status === "solved")) return undefined

    const source = await ProofEditTransaction.readSource(sessionID, binding.file)
    const report = SessionProofWorkflow.analyzeSource(binding.file, source, state)
    if (report.pending_count !== 0) return undefined

    const finalGate = report.final_theorem_gate
    if (finalGate.ok) return undefined

    const display = path.relative(Instance.worktree, binding.file) || path.basename(binding.file)
    return [
      "<prover-finalization-reminder>",
      `All lemma-owned proof_regions in ${display} are solved. Do not dispatch a final lemma task for theorem closure.`,
      `Final theorem gate still fails: ${finalGate.reason}`,
      "Return to Layer 1 now: review the merged skeleton, parent composition outside the regions, and the final theorem goal.",
      "The theorem-level terminator and any `Admitted.` -> `Qed.` conversion are prover-owned, because they are outside every lemma editable region.",
      "Do not edit inside solved lemma-owned proof_regions unless you first remodel ownership in Layer 1.",
      "Change the theorem terminator to `Qed.` only after the complete theorem body has no remaining goals, admits, or aborts and validates with Coq.",
      "</prover-finalization-reminder>",
    ].join("\n")
  }

  async function enqueueScheduledSubtask(
    sessionID: string,
    lastUser: MessageV2.User,
    task: SessionProofWorkflow.ScheduledSubtask,
  ) {
    const msg = await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "user",
      sessionID,
      time: { created: Date.now() },
      agent: lastUser.agent,
      model: lastUser.model,
      variant: lastUser.variant,
    })
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: msg.id,
      sessionID,
      type: "subtask",
      prompt: task.prompt,
      description: task.description,
      agent: task.agent,
      ...(task.caller ? { caller: task.caller } : {}),
      ...(task.model ? { model: task.model } : {}),
      ...(task.task_id ? { task_id: task.task_id } : {}),
      ...(task.lemma_assignment ? { lemma_assignment: task.lemma_assignment } : {}),
      ...(task.proof_repair_assignment ? { proof_repair_assignment: task.proof_repair_assignment } : {}),
    } satisfies MessageV2.SubtaskPart)
  }

  function resolveWorkspaceFile(file: string) {
    return path.normalize(path.isAbsolute(file) ? file : path.join(Instance.directory, file))
  }

  function toolInputTouchesFile(input: Record<string, unknown>, targetFile: string) {
    const raw = input.filePath
    if (typeof raw !== "string" || !raw) return false
    return resolveWorkspaceFile(raw) === targetFile
  }

  function hasCompletedTool(msgs: MessageV2.WithParts[], toolName: string) {
    for (const msg of msgs) {
      for (const part of msg.parts) {
        if (part.type !== "tool") continue
        if (part.tool !== toolName || part.state.status !== "completed") continue
        return true
      }
    }
    return false
  }

  function hasCompletedReadOfFile(msgs: MessageV2.WithParts[], targetFile: string) {
    for (const msg of msgs) {
      for (const part of msg.parts) {
        if (part.type !== "tool") continue
        if (part.tool !== "read" || part.state.status !== "completed") continue
        if (toolInputTouchesFile(part.state.input, targetFile)) return true
      }
    }
    return false
  }

  function hasCompletedTargetedSemanticInspection(msgs: MessageV2.WithParts[], targetFile?: string) {
    const normalizedTarget = targetFile ? resolveWorkspaceFile(targetFile) : undefined
    for (const msg of msgs) {
      for (const part of msg.parts) {
        if (part.type !== "tool" || part.state.status !== "completed") continue
        if (part.tool === "read") {
          const raw = toolInputString(part.state.input, "filePath")
          if (!raw) continue
          const inspected = resolveWorkspaceFile(raw)
          if (inspected.endsWith(".v") && inspected !== normalizedTarget) return true
          continue
        }
        if (part.tool === "coqtop") {
          const command = toolInputString(part.state.input, "command")
          if (["check", "search", "print"].includes(command)) return true
          continue
        }
        if (part.tool === "coq_session") {
          const op = toolInputString(part.state.input, "op")
          if (["open", "goal", "inspect"].includes(op)) return true
          continue
        }
        if (part.tool === "petanque") {
          const op = toolInputString(part.state.input, "command") || toolInputString(part.state.input, "op")
          if (["open", "goal", "inspect", "check", "search", "print"].includes(op)) return true
        }
      }
    }
    return false
  }

  function hasCompletedProofFileEdit(msgs: MessageV2.WithParts[], targetFile?: string) {
    for (const msg of msgs) {
      for (const part of msg.parts) {
        if (part.type === "patch") {
          if (!targetFile) return true
          const rel = path.relative(Instance.worktree, targetFile)
          if (part.files.includes(targetFile) || part.files.includes(rel)) return true
          continue
        }
        if (part.type !== "tool") continue
        if (part.state.status !== "completed") continue
        if (!proofEditTools.has(part.tool)) continue
        if (!targetFile || toolInputTouchesFile(part.state.input, targetFile)) return true
      }
    }
    return false
  }

  function toolInputString(input: Record<string, unknown>, key: string) {
    const value = input[key]
    return typeof value === "string" ? value : ""
  }

  function isWholeLemmaPassiveLookupPart(part: any) {
    if (part?.type !== "tool" || part.state?.status !== "completed") return false
    if (part.tool === "read" || part.tool === "grep" || part.tool === "glob" || part.tool === "lsp") return true
    if (part.tool === "coqtop") {
      const command = toolInputString(part.state.input, "command")
      return ["search", "check", "print", "eval"].includes(command)
    }
    if (part.tool === "coq_session") {
      const op = toolInputString(part.state.input, "op")
      return op === "open" || op === "goal" || op === "inspect"
    }
    if (part.tool === "petanque") {
      const verb = toolInputString(part.state.input, "command") || toolInputString(part.state.input, "op")
      return ["search", "check", "print", "goal", "inspect", "open"].includes(verb)
    }
    return false
  }

  function isWholeLemmaActiveProofAttemptPart(part: any, targetFile?: string) {
    if (part?.type === "patch") {
      if (!targetFile) return true
      const rel = path.relative(Instance.worktree, targetFile)
      return part.files?.includes(targetFile) || part.files?.includes(rel)
    }
    if (part?.type !== "tool" || part.state?.status !== "completed") return false
    if (proofEditTools.has(part.tool) && (!targetFile || toolInputTouchesFile(part.state.input, targetFile))) {
      return true
    }
    if (part.tool === "coq_session") {
      return toolInputString(part.state.input, "op") === "step"
    }
    if (part.tool === "petanque") {
      const verb = toolInputString(part.state.input, "command") || toolInputString(part.state.input, "op")
      return Boolean(verb) && !["search", "check", "print", "goal", "inspect", "open"].includes(verb)
    }
    return false
  }

  function wholeLemmaPassiveLookupStreak(msgs: MessageV2.WithParts[], targetFile?: string) {
    let streak = 0
    for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
      const msg = msgs[msgIndex]
      for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = msg.parts[partIndex]
        if (isWholeLemmaPassiveLookupPart(part)) {
          streak += 1
          continue
        }
        if (isWholeLemmaActiveProofAttemptPart(part, targetFile)) return streak
        // Invalid tool calls, validation, and bookkeeping are not proof
        // materialization.  Keep scanning past them so the hard gate cannot be
        // escaped by an unavailable lookup or an unchanged coqc/checkpoint.
      }
    }
    return streak
  }

  /** @internal Exported for regression tests of materialization liveness. */
  export function acceptedPlanMaterializationLookupStreakForTest(
    msgs: MessageV2.WithParts[],
    targetFile?: string,
  ) {
    return wholeLemmaPassiveLookupStreak(msgs, targetFile)
  }

  async function findProofTexForSession(sessionID: string) {
    const binding = SessionProof.get(sessionID)
    if (!binding) return undefined
    const matches = await Filesystem.findUp("proof.tex", path.dirname(binding.file), Instance.worktree)
    return matches[0]
  }

  const state = Instance.state(
    () => {
      const data: Record<
        string,
        {
          abort: AbortController
          callbacks: {
            resolve(input: MessageV2.WithParts): void
            reject(reason?: any): void
          }[]
        }
      > = {}
      return data
    },
    async (current) => {
      for (const item of Object.values(current)) {
        item.abort.abort()
      }
    },
  )

  export function assertNotBusy(sessionID: string) {
    const match = state()[sessionID]
    if (match) throw new Session.BusyError(sessionID)
  }

  export const PromptInput = z.object({
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    model: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
    agent: z.string().optional(),
    noReply: z.boolean().optional(),
    tools: z
      .record(z.string(), z.boolean())
      .optional()
      .describe(
        "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
      ),
    format: MessageV2.Format.optional(),
    system: z.string().optional(),
    variant: z.string().optional(),
    parts: z.array(
      z.discriminatedUnion("type", [
        MessageV2.TextPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "TextPartInput",
          }),
        MessageV2.FilePart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "FilePartInput",
          }),
        MessageV2.AgentPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "AgentPartInput",
          }),
        MessageV2.SubtaskPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "SubtaskPartInput",
          }),
      ]),
    ),
  })
  export type PromptInput = z.infer<typeof PromptInput>

  export const prompt = fn(PromptInput, async (input) => {
    const session = await Session.get(input.sessionID)
    await SessionRevert.cleanup(session)

    // Auto-bind proof context if a .v file is attached or explicitly named in a proof prompt.
    if (!ProofContext.getBinding(input.sessionID)) {
      const existing = SessionProof.get(input.sessionID)
      const inferred = await inferProofFileFromPromptParts(input.parts)
      const replaceStaleAutoBinding = Boolean(
        inferred &&
        existing?.source === "auto" &&
        path.normalize(existing.file) !== path.normalize(inferred),
      )
      if (inferred && (!existing || replaceStaleAutoBinding)) {
        // Continuation runners may attach a harmless placeholder such as
        // DO_NOT_CREATE.v while naming the real theorem file in the prompt.
        // The explicit target is authoritative for an automatic binding, and
        // must also repair a persisted placeholder binding in a fresh process.
        ProofContext.setBinding(input.sessionID, inferred, { line: 0, character: 0 })
        SessionProof.set(input.sessionID, inferred, { line: 0, character: 0 }, "auto")
      } else if (existing) {
        ProofContext.setBinding(input.sessionID, existing.file, { line: existing.line, character: existing.character })
      } else {
        for (const part of input.parts) {
          if (part.type === "file" && part.filename?.endsWith(".v")) {
            const resolved = part.url?.startsWith("file:")
              ? fileURLToPath(part.url)
              : path.resolve(Instance.worktree, part.filename)
            ProofContext.setBinding(input.sessionID, resolved, { line: 0, character: 0 })
            SessionProof.set(input.sessionID, resolved, { line: 0, character: 0 }, "auto")
            break
          }
        }
      }
    }

    const message = await createUserMessage(input)
    await Session.touch(input.sessionID)

    // this is backwards compatibility for allowing `tools` to be specified when
    // prompting
    const permissions: PermissionNext.Ruleset = []
    for (const [tool, enabled] of Object.entries(input.tools ?? {})) {
      permissions.push({
        permission: tool,
        action: enabled ? "allow" : "deny",
        pattern: "*",
      })
    }
    if (permissions.length > 0) {
      session.permission = permissions
      await Session.setPermission({ sessionID: session.id, permission: permissions })
    }

    if (input.noReply === true) {
      return message
    }

    return loop({ sessionID: input.sessionID })
  })

  export async function resolvePromptParts(template: string): Promise<PromptInput["parts"]> {
    const parts: PromptInput["parts"] = [
      {
        type: "text",
        text: template,
      },
    ]
    const files = ConfigMarkdown.files(template)
    const seen = new Set<string>()
    await Promise.all(
      files.map(async (match) => {
        const name = match[1]
        if (seen.has(name)) return
        seen.add(name)
        const filepath = name.startsWith("~/")
          ? path.join(os.homedir(), name.slice(2))
          : path.resolve(Instance.worktree, name)

        const stats = await fs.stat(filepath).catch(() => undefined)
        if (!stats) {
          const agent = await Agent.get(name)
          if (agent) {
            parts.push({
              type: "agent",
              name: agent.name,
            })
          }
          return
        }

        if (stats.isDirectory()) {
          parts.push({
            type: "file",
            url: pathToFileURL(filepath).href,
            filename: name,
            mime: "application/x-directory",
          })
          return
        }

        parts.push({
          type: "file",
          url: pathToFileURL(filepath).href,
          filename: name,
          mime: "text/plain",
        })
      }),
    )
    return parts
  }

  function start(sessionID: string) {
    const s = state()
    if (s[sessionID]) return
    const controller = new AbortController()
    s[sessionID] = {
      abort: controller,
      callbacks: [],
    }
    return controller.signal
  }

  function resume(sessionID: string) {
    const s = state()
    if (!s[sessionID]) return

    return s[sessionID].abort.signal
  }

  export function cancel(sessionID: string) {
    log.info("cancel", { sessionID })
    const s = state()
    const match = s[sessionID]
    if (!match) {
      SessionStatus.set(sessionID, { type: "idle" })
      return
    }
    match.abort.abort()
    delete s[sessionID]
    SessionStatus.set(sessionID, { type: "idle" })
    return
  }

  export const LoopInput = z.object({
    sessionID: Identifier.schema("session"),
    resume_existing: z.boolean().optional(),
  })
  export const loop = fn(LoopInput, async (input) => {
    const { sessionID, resume_existing } = input

    const abort = resume_existing ? resume(sessionID) : start(sessionID)
    if (!abort) {
      return new Promise<MessageV2.WithParts>((resolve, reject) => {
        const callbacks = state()[sessionID].callbacks
        callbacks.push({ resolve, reject })
      })
    }

    using _ = defer(() => cancel(sessionID))
    await using _trace = defer(async () => Trace.end(sessionID))

    await Trace.begin(sessionID)

    // Structured output state
    // Note: On session resumption, state is reset but outputFormat is preserved
    // on the user message and will be retrieved from lastUser below
    let structuredOutput: unknown | undefined

    let firstLoop = true
    const session = await Session.get(sessionID)
    while (true) {
      SessionStatus.set(sessionID, { type: "busy" })
      log.info("loop", { sessionID })
      if (abort.aborted) break
      let msgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))

      let lastUser: MessageV2.User | undefined
      let lastAssistant: MessageV2.Assistant | undefined
      let lastFinished: MessageV2.Assistant | undefined
      let tasks: (MessageV2.CompactionPart | MessageV2.SubtaskPart)[] = []
      for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i]
        if (!lastUser && msg.info.role === "user") lastUser = msg.info as MessageV2.User
        if (!lastAssistant && msg.info.role === "assistant") lastAssistant = msg.info as MessageV2.Assistant
        if (!lastFinished && msg.info.role === "assistant" && msg.info.finish)
          lastFinished = msg.info as MessageV2.Assistant
        if (lastUser && lastFinished) break
        const task = msg.parts.filter((part) => part.type === "compaction" || part.type === "subtask")
        if (task && !lastFinished) {
          tasks.push(...task)
        }
      }

      if (!lastUser) throw new Error("No user message found in stream. This should never happen.")
      const recoveredProofEditTransaction = await recoverProofEditTransaction(
        sessionID,
        session.parentID ?? "",
        lastUser.agent,
      )
      if (
        lastAssistant?.finish &&
        !["tool-calls", "unknown"].includes(lastAssistant.finish) &&
        tasks.length === 0 &&
        MessageV2.isAfter(lastAssistant, lastUser)
      ) {
        const scheduledLemma =
          lastUser.agent === "prover"
            ? await SessionProofWorkflow.planNextSubtask(sessionID, msgs, stagedPlanningSource(sessionID))
            : undefined
        if (scheduledLemma) {
          await enqueueScheduledSubtask(sessionID, lastUser, scheduledLemma)
          continue
        }
        log.info("exiting loop", { sessionID })
        break
      }

      const isFirstLoop = firstLoop
      firstLoop = false
      if (isFirstLoop)
        ensureTitle({
          session,
          modelID: lastUser.model.modelID,
          providerID: lastUser.model.providerID,
          history: msgs,
        })

      const model = await Provider.getModel(lastUser.model.providerID, lastUser.model.modelID).catch((e) => {
        if (Provider.ModelNotFoundError.isInstance(e)) {
          const hint = e.data.suggestions?.length ? ` Did you mean: ${e.data.suggestions.join(", ")}?` : ""
          Bus.publish(Session.Event.Error, {
            sessionID,
            error: new NamedError.Unknown({
              message: `Model not found: ${e.data.providerID}/${e.data.modelID}.${hint}`,
            }).toObject(),
          })
        }
        throw e
      })
      const task = tasks.pop()

      // pending subtask
      // TODO: centralize "invoke tool" logic
      if (task?.type === "subtask") {
        const taskTool = await TaskTool.init()
        const taskModel = task.model ? await Provider.getModel(task.model.providerID, task.model.modelID) : model
        const assistantMessage = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "assistant",
          parentID: lastUser.id,
          sessionID,
          mode: task.agent,
          agent: task.agent,
          variant: lastUser.variant,
          path: {
            cwd: Instance.directory,
            root: Instance.worktree,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: taskModel.id,
          providerID: taskModel.providerID,
          time: {
            created: Date.now(),
          },
        })) as MessageV2.Assistant
        let part = (await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: assistantMessage.id,
          sessionID: assistantMessage.sessionID,
          type: "tool",
          callID: ulid(),
          tool: TaskTool.id,
          state: {
            status: "running",
            input: {
              prompt: task.prompt,
              description: task.description,
              subagent_type: task.agent,
              command: task.command,
              task_id: task.task_id,
              lemma_assignment: task.lemma_assignment,
              proof_repair_assignment: task.proof_repair_assignment,
            },
            time: {
              start: Date.now(),
            },
          },
        })) as MessageV2.ToolPart
        const taskArgs = {
          prompt: task.prompt,
          description: task.description,
          subagent_type: task.agent,
          command: task.command,
          task_id: task.task_id,
          lemma_assignment: task.lemma_assignment,
          proof_repair_assignment: task.proof_repair_assignment,
        }
        await Plugin.trigger(
          "tool.execute.before",
          {
            tool: "task",
            sessionID,
            callID: part.id,
          },
          { args: taskArgs },
        )
        let executionError: Error | undefined
        const taskAgent = await Agent.get(task.agent)
        const taskCtx: Tool.Context = {
          agent: task.caller ?? task.agent,
          messageID: assistantMessage.id,
          sessionID: sessionID,
          abort,
          callID: part.callID,
          extra: { bypassAgentCheck: true },
          messages: msgs,
          async metadata(input) {
            await Session.updatePart({
              ...part,
              type: "tool",
              state: {
                ...part.state,
                ...input,
              },
            } satisfies MessageV2.ToolPart)
          },
          async ask(req) {
            await PermissionNext.ask({
              ...req,
              sessionID: sessionID,
              ruleset: PermissionNext.merge(taskAgent.permission, session.permission ?? []),
            })
          },
        }
        const result = await taskTool.execute(taskArgs, taskCtx).catch((error) => {
          executionError = error
          log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
          return undefined
        })
        const attachments = result?.attachments?.map((attachment) => ({
          ...attachment,
          id: Identifier.ascending("part"),
          sessionID,
          messageID: assistantMessage.id,
        }))
        await Plugin.trigger(
          "tool.execute.after",
          {
            tool: "task",
            sessionID,
            callID: part.id,
            args: taskArgs,
          },
          result,
        )
        assistantMessage.finish = "tool-calls"
        assistantMessage.time.completed = Date.now()
        await Session.updateMessage(assistantMessage)
        if (result && part.state.status === "running") {
          await Session.updatePart({
            ...part,
            state: {
              status: "completed",
              input: part.state.input,
              title: result.title,
              metadata: result.metadata,
              output: result.output,
              attachments,
              time: {
                ...part.state.time,
                end: Date.now(),
              },
            },
          } satisfies MessageV2.ToolPart)
        }
        if (!result) {
          await Session.updatePart({
            ...part,
            state: {
              status: "error",
              error: executionError ? `Tool execution failed: ${executionError.message}` : "Tool execution failed",
              time: {
                start: part.state.status === "running" ? part.state.time.start : Date.now(),
                end: Date.now(),
              },
              metadata: part.metadata,
              input: part.state.input,
            },
          } satisfies MessageV2.ToolPart)
        }

        if (task.command) {
          // Add synthetic user message to prevent certain reasoning models from erroring
          // If we create assistant messages w/ out user ones following mid loop thinking signatures
          // will be missing and it can cause errors for models like gemini for example
          const summaryUserMsg: MessageV2.User = {
            id: Identifier.ascending("message"),
            sessionID,
            role: "user",
            time: {
              created: Date.now(),
            },
            agent: lastUser.agent,
            model: lastUser.model,
          }
          await Session.updateMessage(summaryUserMsg)
          await Session.updatePart({
            id: Identifier.ascending("part"),
            messageID: summaryUserMsg.id,
            sessionID,
            type: "text",
            text: "Summarize the task tool output above and continue with your task.",
            synthetic: true,
          } satisfies MessageV2.TextPart)
        }

        continue
      }

      // pending compaction
      if (task?.type === "compaction") {
        const result = await SessionCompaction.process({
          messages: msgs,
          parentID: lastUser.id,
          abort,
          sessionID,
          auto: task.auto,
          overflow: task.overflow,
        })
        if (result === "stop") break
        continue
      }

      // context overflow, needs compaction
      if (
        lastFinished &&
        lastFinished.summary !== true &&
        (await SessionCompaction.shouldCompact({
          tokens: lastFinished.tokens,
          model,
          agent: lastUser.agent,
        }))
      ) {
        await SessionCompaction.create({
          sessionID,
          agent: lastUser.agent,
          model: lastUser.model,
          auto: true,
        })
        continue
      }

      const fallbackGuard = proofAgents.has(lastUser.agent)
        ? await SessionProofWorkflow.assessFallbackGuard(sessionID, msgs, stagedPlanningSource(sessionID))
        : undefined
      const parentRepairTakeoverRequired = Boolean(
        fallbackGuard?.tripped &&
          "parentRepairTakeoverRequired" in fallbackGuard &&
          fallbackGuard.parentRepairTakeoverRequired === true &&
          lastUser.agent === "prover",
      )
      if (fallbackGuard?.tripped && !parentRepairTakeoverRequired) {
        const repairChildNoMaterialization =
          "repairChildNoMaterialization" in fallbackGuard && fallbackGuard.repairChildNoMaterialization === true
        const stalledRepairYield = repairChildNoMaterialization
          ? ProofEditTransaction.yieldStalledRepair({
              sessionID,
              handoffToSessionID: session.parentID,
              handoffScope: {
                kind: "theorem_body",
                theorem: fallbackGuard.assignment.theorem,
              },
            })
          : undefined
        const now = Date.now()
        const assistantMessage = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID,
          parentID: lastUser.id,
          role: "assistant",
          mode: lastUser.agent,
          agent: lastUser.agent,
          variant: lastUser.variant,
          path: {
            cwd: Instance.directory,
            root: Instance.worktree,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.id,
          providerID: model.providerID,
          time: {
            created: now,
            completed: now,
          },
          finish: "stop",
        })) as MessageV2.Assistant
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: assistantMessage.id,
          sessionID,
          type: "text",
          text: [
            repairChildNoMaterialization
              ? "repair_child_no_materialization: runtime is returning this scoped repair to the parent prover after a generous no-materialization window."
              : "stalled_wide_fallback: runtime stopped this proof turn before another broad fallback batch.",
            fallbackGuard.message ? `reason: ${fallbackGuard.message}` : undefined,
            `admit_id: ${fallbackGuard.assignment.admit_id}`,
            `required_scope: theorem_repair`,
            stalledRepairYield ? `proof_transaction_yield: ${JSON.stringify(stalledRepairYield)}` : undefined,
            repairChildNoMaterialization
              ? "next_action: parent prover must continue from the yielded certified/base transaction snapshot and materialize the diagnosed theorem-level remodel directly; the failed draft remains journaled, and the unchanged repair child must not be redispatched."
              : "next_action: make a theorem-level edit that changes the stale blocker contract, adds the missing bridge, or remodels the region before restarting fallback search.",
          ].filter((line): line is string => Boolean(line)).join("\n"),
          synthetic: true,
        } satisfies MessageV2.TextPart)
        break
      }

      const scheduledLemma =
        lastUser.agent === "prover"
          ? await SessionProofWorkflow.planNextSubtask(sessionID, msgs, stagedPlanningSource(sessionID))
          : undefined
      if (scheduledLemma) {
        await enqueueScheduledSubtask(sessionID, lastUser, scheduledLemma)
        continue
      }

      // normal processing
      const agent = await Agent.get(lastUser.agent)
      const runtimeContext = await insertReminders({
        messages: msgs,
        agent,
        session,
      })
      if (recoveredProofEditTransaction?.recovered && recoveredProofEditTransaction.staged) {
        runtimeContext.push(
          runtimeContextMessage(
            [
              "<proof-edit-transaction-recovery>",
              `transaction_id: ${recoveredProofEditTransaction.transaction_id}`,
              `scope: ${recoveredProofEditTransaction.scope}`,
              `revision: ${recoveredProofEditTransaction.revision}`,
              `source_hash: ${recoveredProofEditTransaction.source_hash}`,
              `validation_pending: ${recoveredProofEditTransaction.validation_pending}`,
              "The recovered staged source exposed by read/edit/multiedit/write/apply_patch/checkpoint/coqc is the authoritative proof state for this turn.",
              "The ordinary workspace file on disk may intentionally be older until a compiler-accepted transaction snapshot is committed.",
              "Before lemma dispatch, proof planning, Coq-session use, or proof edits, read the target .v file through the read tool. The controller will reject those actions until this staged-revision resynchronization read occurs.",
              "Do not use bash, cat, or a direct disk read to reconstruct proof state, and do not rewrite compiler-certified regions merely because the disk file is stale.",
              "Read the target through the read tool and continue with the smallest edit against that staged revision. If finalization reports only the theorem terminator remains, edit only that terminator and run the final checkpoint/coqc.",
              recoveredProofEditTransaction.validation_pending
                ? "The controller will not dispatch an ordinary lemma task from this draft until the exact staged revision receives a compiler-backed checkpoint/coqc receipt."
                : undefined,
              "</proof-edit-transaction-recovery>",
            ].filter((line): line is string => Boolean(line)).join("\n"),
          ),
        )
      }
      if (
        fallbackGuard &&
        "repairChildWarning" in fallbackGuard &&
        fallbackGuard.repairChildWarning === true
      ) {
        runtimeContext.push(
          runtimeContextMessage(
            [
              "<repair-child-materialization-reminder>",
              fallbackGuard.message,
              "You still have room to investigate. Avoid repeating an already established diagnosis.",
              "Before the hard liveness limit, materialize the repair through a substantive theorem edit, one proof_plan revision, or an accepted checkpoint.",
              "</repair-child-materialization-reminder>",
            ]
              .filter((line): line is string => Boolean(line))
              .join("\n"),
          ),
        )
      }
      if (
        fallbackGuard &&
        "repairRedispatchWarning" in fallbackGuard &&
        fallbackGuard.repairRedispatchWarning === true
      ) {
        runtimeContext.push(
          runtimeContextMessage(
            [
              "<repair-child-redispatch-budget>",
              fallbackGuard.message,
              "The previous child returned without materialization. Prefer using its diagnosis to change the proof route, contract, or decomposition before spending another child attempt.",
              "A fresh child is still permitted, but five identical no-certificate outcomes on the same semantic blocker and compiler signature hard-lock the sixth dispatch.",
              "</repair-child-redispatch-budget>",
            ]
              .filter((line): line is string => Boolean(line))
              .join("\n"),
          ),
        )
      }
      if (
        fallbackGuard && parentRepairTakeoverRequired
      ) {
        runtimeContext.push(
          runtimeContextMessage(
            [
              "<parent-repair-takeover-reminder>",
              fallbackGuard.message,
              "Do not finish this prover turn and do not redispatch the unchanged repair child.",
              "Use the child's diagnosis now: make the theorem-level contract/bridge/remodel edit directly, then validate it.",
              "</parent-repair-takeover-reminder>",
            ]
              .filter((line): line is string => Boolean(line))
              .join("\n"),
          ),
        )
      }

      const processor = SessionProcessor.create({
        assistantMessage: (await Session.updateMessage({
          id: Identifier.ascending("message"),
          parentID: lastUser.id,
          role: "assistant",
          mode: agent.name,
          agent: agent.name,
          variant: lastUser.variant,
          path: {
            cwd: Instance.directory,
            root: Instance.worktree,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.id,
          providerID: model.providerID,
          time: {
            created: Date.now(),
          },
          sessionID,
        })) as MessageV2.Assistant,
        sessionID: sessionID,
        model,
        abort,
      })
      using _ = defer(() => InstructionPrompt.clear(processor.message.id))

      // Check if user explicitly invoked an agent via @ in this turn
      const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
      const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false

      const tools = await resolveTools({
        agent,
        session,
        model,
        tools: lastUser.tools,
        processor,
        bypassAgentCheck,
        messages: msgs,
      })

      // Inject StructuredOutput tool if JSON schema mode enabled
      if (lastUser.format?.type === "json_schema") {
        tools["StructuredOutput"] = createStructuredOutputTool({
          schema: lastUser.format.schema,
          onSuccess(output) {
            structuredOutput = output
          },
        })
      }

      if (isFirstLoop) {
        SessionSummary.summarize({
          sessionID: sessionID,
          messageID: lastUser.id,
        })
      }

      // Ephemerally wrap queued user messages with a reminder to stay on track
      if (!isFirstLoop && lastFinished) {
        wrapQueuedUserMessages(msgs, lastFinished)
      }

      await Plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

      let restored = await SessionRestore.get(sessionID).catch(() => undefined)
      const proofBinding = SessionProof.get(sessionID)
      const currentProofFile = proofBinding?.file
      const directProsaProbe = isDirectProsaProbe(agent)
      const proofTexPath = agent.name === "prover" && !directProsaProbe ? await findProofTexForSession(sessionID) : undefined
      const hasProofFileEdit = hasCompletedProofFileEdit(msgs, currentProofFile)
      const hasReadCurrentProofFile = currentProofFile ? hasCompletedReadOfFile(msgs, currentProofFile) : false
      const hasReadProofTex = proofTexPath ? hasCompletedReadOfFile(msgs, proofTexPath) : false
      const hasTargetedSemanticInspection = hasCompletedTargetedSemanticInspection(msgs, currentProofFile)
      const currentProofSource =
        currentProofFile && (await Filesystem.exists(currentProofFile))
          ? await ProofEditTransaction.readSource(sessionID, currentProofFile)
          : undefined
      const theoremAtBinding = currentProofSource && proofBinding
        ? SessionProofWorkflow.theoremAtProofPosition(currentProofSource, {
            line: proofBinding.line,
            character: proofBinding.character,
          })
        : undefined
      const routeLedgerPrompt =
        agent.name === "prover" && currentProofFile && currentProofSource && theoremAtBinding
          ? ProofRouteLedger.routeFailurePrompt(
              ProofRouteLedger.getActiveRouteFailures({
                workspace: Instance.worktree === "/" ? Instance.directory : Instance.worktree,
                file: currentProofFile,
                theorem: theoremAtBinding,
                source: currentProofSource,
              }),
            )
          : undefined
      const decompositionPlanState = currentProofFile
        ? SessionProofWorkflow.getDecompositionPlanState(sessionID, currentProofFile, theoremAtBinding)
        : undefined
      const hasAcceptedProofPlan = decompositionPlanState?.status === "accepted"
      const planGenerationRecoveryAvailable = Boolean(
        decompositionPlanState?.status === "exhausted" &&
          decompositionPlanState.terminal_verdict?.recoverable === true,
      )
      const planRevisionExhausted = Boolean(
        decompositionPlanState?.status === "exhausted" && !planGenerationRecoveryAvailable,
      )
      const hasProofPlan = hasAcceptedProofPlan
      const decompositionMaterialization =
        currentProofFile && currentProofSource && hasAcceptedProofPlan
          ? SessionProofWorkflow.previewDecompositionMaterialization(sessionID, currentProofFile, currentProofSource)
          : undefined
      const acceptedPlanRepair =
        currentProofFile && currentProofSource && hasAcceptedProofPlan
          ? SessionProofWorkflow.getAcceptedPlanRepairEligibility(sessionID, currentProofFile, currentProofSource)
          : undefined
      const administrativeReconciliationAvailable = Boolean(
        decompositionMaterialization?.review?.status === "drifted" &&
          (decompositionPlanState?.administrative_reconciliation_count ?? 0) < 1,
      )
      const boundTheorem =
        decompositionPlanState?.theorem && decompositionPlanState.theorem !== "unspecified-theorem"
          ? decompositionPlanState.theorem
          : theoremAtBinding
      const hasExistingProofRegions = Boolean(
        currentProofSource &&
          SessionProofWorkflow.hasProofRegionsForTheorem(currentProofSource, boundTheorem),
      )
      const acceptedPlanLookupStreak =
        agent.name === "prover" &&
        hasAcceptedProofPlan &&
        !hasProofFileEdit &&
        !hasExistingProofRegions
          ? wholeLemmaPassiveLookupStreak(msgs, currentProofFile)
          : 0
      const acceptedPlanMaterializationToolGate = applyAcceptedPlanMaterializationToolGate(
        tools,
        acceptedPlanLookupStreak,
      )
      const hasWholeLemmaStartupLookup =
        hasCompletedTool(msgs, "grep") ||
        hasCompletedTool(msgs, "glob") ||
        hasCompletedTool(msgs, "coq_session") ||
        hasCompletedTool(msgs, "petanque") ||
        hasCompletedTool(msgs, "lsp") ||
        hasCompletedTool(msgs, "coqtop")
      const wholeLemmaLookupStreak =
        agent.name === "whole-lemma" && !hasProofFileEdit ? wholeLemmaPassiveLookupStreak(msgs, currentProofFile) : 0
      const lemmaContinuation = agent.name === "prover" ? await lemmaContinuationPrompt(sessionID, msgs) : undefined
      const proverFinalization = agent.name === "prover" ? await proverFinalizationPrompt(sessionID) : undefined

      // Build system prompt, adding structured output instruction if needed
      const system = restored
        ? [...restored.system]
        : [...(await SystemPrompt.environment(model)), ...(await InstructionPrompt.system())]
      const restoreSystem = [...system]
      if (agent.name === "prover" && !directProsaProbe) {
        system.push(proverTheoremWorkflowPrompt())
      }
      if (directProsaProbe) {
        system.push(directProsaProbePrompt())
      }
      if (lemmaContinuation) {
        runtimeContext.push(runtimeContextMessage(lemmaContinuation))
      }
      if (proverFinalization) {
        runtimeContext.push(runtimeContextMessage(proverFinalization))
      }
      if (routeLedgerPrompt) {
        runtimeContext.push(runtimeContextMessage(routeLedgerPrompt))
      }
      if (agent.name === "lemma") {
        system.push(lemmaLocalProofPrompt())
      }
      if (proofTexPath) {
        const proofTexDisplay = path.relative(Instance.worktree, proofTexPath) || "proof.tex"
        system.push(
          [
            "<proof-tex-guidance>",
            `A primary proof-narrative evidence file exists for this theorem at ${proofTexDisplay}.`,
            "Treat the theorem statement and the user's benchmark file as fixed inputs to prove, not as claims to second-guess.",
            "Use proof.tex to seed the theorem-level decomposition when its steps match the formal goal, hypotheses, exact interfaces, premise audit, and compiler evidence.",
            "If a narrative step is vague, premise-mismatched, or formally incompatible, record that downgrade and use a context-derived route for the affected boundary.",
            "</proof-tex-guidance>",
          ].join("\n"),
        )
      }
      if (agent.name === "prover" && proofTexPath && !hasReadProofTex) {
        const proofTexDisplay = path.relative(Instance.worktree, proofTexPath) || "proof.tex"
        runtimeContext.push(runtimeContextMessage(
          [
            "<proof-tex-read-required>",
            `You have not yet read ${proofTexDisplay} in this session.`,
            "Your next non-validation action must be a `read` of that proof.tex file.",
            "Until you have read it, do not perform broad workspace search, do not call `lemma`, and do not make any negative semantic judgment about the theorem.",
            "</proof-tex-read-required>",
          ].join("\n"),
        ))
      }
      if (
        agent.name === "prover" &&
        proofTexPath &&
        hasReadProofTex &&
        !hasProofFileEdit &&
        !hasExistingProofRegions
      ) {
        runtimeContext.push(runtimeContextMessage(
          [
            "<proof-tex-skeleton-required>",
            "You have read proof.tex but have not yet written the theorem-level skeleton to the current Coq proof file.",
            planGenerationRecoveryAvailable
              ? "The current planning generation exhausted its bounded revisions, but one recovery generation is available. Call `proof_plan` with a materially corrected DAG based on the persisted best rejected plan and its blockers; do not merely rename nodes or rewrite metadata."
              : planRevisionExhausted
              ? "The semantic revision budget is exhausted. Do not call `proof_plan` again and do not invent another split; stop and report the best rejected plan with its hard errors."
              : hasProofPlan
                ? "A bounded proof plan is accepted and locked for normal materialization. Materialize it now; call `proof_plan` again only if the workflow later exposes its evidence-backed accepted-plan repair revision."
                : "Your next non-validation action must call `proof_plan` on the proof.tex content. Mark strict delegation candidates, their claim deltas, transformations, dependencies, and parent consumers before editing Coq.",
            "Resolve semantic hard errors with at most four materially distinct DAG revisions after the initial plan. Deterministic identifier, edge, and anchor corrections do not consume this budget. Warnings are advisory and must not cause an open-ended planning loop.",
            "Do not continue broad search, and do not call `lemma` until the file contains the first-level gap boundaries implied by proof.tex.",
            "</proof-tex-skeleton-required>",
          ].join("\n"),
        ))
      }
      if (acceptedPlanMaterializationToolGate.active) {
        runtimeContext.push(runtimeContextMessage(
          [
            "<accepted-plan-materialization-hard-gate>",
            `The accepted plan has now been followed by ${acceptedPlanLookupStreak} consecutive passive lookup or inspection calls without a proof-file edit or active proof step.`,
            `The soft reminder began at ${acceptedPlanMaterializationToolGate.warning_limit}; the bounded grace window ended at ${acceptedPlanMaterializationToolGate.hard_limit}.`,
            "Broad lookup tools remain visible so the provider tool schema and KV-cache prefix stay stable, but calls to them return a deterministic gate diagnostic because another lookup cannot establish materialization progress.",
            "Make one reversible target proof edit, or use an available active `coq_session`/`petanque` proof step on the first planned region. A concrete proof attempt resets this gate and restores narrow blocker-driven lookup on the following turn.",
            "Validation tools remain available. The gate does not change the accepted semantic DAG, select a theorem-specific route, or require a successful proof step before lookup can resume.",
            acceptedPlanMaterializationToolGate.blocked_tools.length > 0
              ? `Temporarily gated tools: ${acceptedPlanMaterializationToolGate.blocked_tools.join(", ")}.`
              : undefined,
            "</accepted-plan-materialization-hard-gate>",
          ].filter((line): line is string => Boolean(line)).join("\n"),
        ))
      }
      if (
        agent.name === "prover" &&
        proofTexPath &&
        hasAcceptedProofPlan &&
        !hasProofFileEdit &&
        !hasExistingProofRegions &&
        acceptedPlanLookupStreak >= ACCEPTED_PLAN_PASSIVE_LOOKUP_LIMIT
      ) {
        runtimeContext.push(runtimeContextMessage(
          [
            "<accepted-plan-materialization-liveness>",
            `The accepted plan has been followed by ${acceptedPlanLookupStreak} consecutive read-only lookup or inspection calls without a proof-file edit or an active proof step.`,
            "The accepted semantic DAG remains authoritative, and the evidence pass is now sufficient to begin a reversible proof transaction.",
            "Your next non-validation action must materialize the smallest useful first-level skeleton in the target theorem, or make one concrete `coq_session`/`petanque` proof step for the first planned region and immediately transfer the validated fragment into that skeleton.",
            "Do not issue another broad `read`, `grep`, `glob`, or `coqtop` Check/Search/Print burst before that concrete attempt. If the attempt exposes one exact missing identifier, premise, or target-shape error, perform only the narrow lookup needed for that blocker and then return to materialization.",
            "Temporary admits are permitted only inside the accepted first-level proof regions while establishing the Phase-1 scaffold; they are not proof success and must later be discharged before final `Qed.`.",
            "This is a liveness reminder, not a semantic-route lock: compiler evidence may still justify the workflow's bounded accepted-plan repair revision.",
            "</accepted-plan-materialization-liveness>",
          ].join("\n"),
        ))
      }
      if (
        agent.name === "prover" &&
        !proofTexPath &&
        currentProofFile &&
        !hasExistingProofRegions &&
        !hasProofFileEdit &&
        !hasReadCurrentProofFile
      ) {
        const proofFileDisplay = path.relative(Instance.worktree, currentProofFile) || path.basename(currentProofFile)
        runtimeContext.push(runtimeContextMessage(
          [
            "<decomposition-read-required>",
            `Read ${proofFileDisplay} before planning or editing the theorem decomposition.`,
            "Inspect the exact theorem statement, section hypotheses, nearby definitions, and current proof body.",
            "</decomposition-read-required>",
          ].join("\n"),
        ))
      }
      if (
        agent.name === "prover" &&
        !proofTexPath &&
        currentProofFile &&
        !hasExistingProofRegions &&
        !hasProofFileEdit &&
        hasReadCurrentProofFile &&
        !hasTargetedSemanticInspection &&
        !hasProofPlan &&
        !planRevisionExhausted
      ) {
        runtimeContext.push(runtimeContextMessage(
          [
            "<decomposition-evidence-required>",
            "Before the first skeleton edit, perform one bounded semantic inspection tied to the theorem's conclusion or hypotheses.",
            "Open one directly relevant Prosa/MathComp declaration or analogous proof, or inspect the exact live goal with `coq_session`/`coqtop`.",
            "A grep listing alone is candidate discovery, not an evidence receipt. Do not perform a broad search batch.",
            "</decomposition-evidence-required>",
          ].join("\n"),
        ))
      }
      if (
        agent.name === "prover" &&
        !proofTexPath &&
        currentProofFile &&
        !hasExistingProofRegions &&
        !hasProofFileEdit &&
        hasReadCurrentProofFile &&
        hasTargetedSemanticInspection &&
        !hasProofPlan &&
        !planRevisionExhausted
      ) {
        runtimeContext.push(runtimeContextMessage(
          [
            "<decomposition-plan-required>",
            "Your next non-validation action must call `proof_plan` with a structured theorem-level DAG before editing Coq.",
            "Mark meaningful single-output, dependency-complete, locally certifiable nodes as delegation_candidate; do not create tactic-sized leaves to satisfy a count. State claim_delta, consumers, and the relevant transformations.",
            "Use at most four materially distinct semantic DAG revisions after the initial plan. Deterministic schema corrections use repair_plan_metadata and do not consume this budget. Do not treat evidence wording, marker text, or comments as DAG progress.",
            "</decomposition-plan-required>",
          ].join("\n"),
        ))
      }
      if (
        agent.name === "prover" &&
        currentProofFile &&
        planGenerationRecoveryAvailable &&
        !hasProofFileEdit
      ) {
        const bestRejectedPlan = decompositionPlanState?.best_rejected_plan
        const bestRejectedReview = decompositionPlanState?.best_rejected_review
        const bestPlanNodes = bestRejectedPlan?.nodes.slice(0, 8).map((node) => {
          const id = node.node_id || node.paper_step_id
          const goal = node.formal_goal.replace(/\s+/g, " ").trim().slice(0, 220)
          return `- ${id}: ${goal}; depends_on=[${node.depends_on.join(", ")}]`
        }) ?? []
        const blockers = (bestRejectedReview?.hard_errors ?? [])
          .slice(0, 8)
          .map((entry) => `- ${entry.code}${entry.node_id ? ` (${entry.node_id})` : ""}: ${entry.message}`)
        runtimeContext.push(runtimeContextMessage(
          [
            "<decomposition-plan-generation-recovery>",
            `Planning generation ${decompositionPlanState?.planning_generation ?? 0} exhausted, and exactly one bounded recovery generation is available.`,
            `Best rejected semantic fingerprint: ${bestRejectedReview?.semantic_fingerprint ?? "unavailable"}.`,
            bestPlanNodes.length > 0 ? "Best rejected plan outline:" : undefined,
            ...bestPlanNodes,
            blockers.length > 0 ? "Blocking review findings:" : undefined,
            ...blockers,
            "Call `proof_plan` again with a materially corrected structured DAG. Preserve useful nodes whose contracts remain sound, change the failing semantic boundary, and address the listed blockers.",
            "The rejected plan remains diagnostic only: it cannot be materialized, and metadata-only changes do not count as a new route.",
            "If this recovery generation also exhausts its bounded revisions, the resulting verdict is final for this experiment attempt.",
            "</decomposition-plan-generation-recovery>",
          ].filter((line): line is string => Boolean(line)).join("\n"),
        ))
      }
      if (
        agent.name === "prover" &&
        currentProofFile &&
        planRevisionExhausted &&
        !hasProofFileEdit
      ) {
        runtimeContext.push(runtimeContextMessage(
          [
            "<decomposition-plan-exhausted>",
            "The persisted decomposition state has exhausted its four materially distinct semantic DAG revisions without an accepted plan.",
            "Do not call `proof_plan` again or disguise the same architecture through metadata changes; report the best rejected plan and its blockers.",
            "Stop with the best rejected plan and its deterministic hard errors so the caller can decide whether to change the architecture manually.",
            "</decomposition-plan-exhausted>",
          ].join("\n"),
        ))
      }
      if (
        agent.name === "prover" &&
        !proofTexPath &&
        currentProofFile &&
        !hasExistingProofRegions &&
        !hasProofFileEdit &&
        hasProofPlan &&
        !acceptedPlanRepair?.available
      ) {
        runtimeContext.push(runtimeContextMessage(
          [
            "<decomposition-materialize-required>",
            "The accepted proof plan is persisted and locked. Materialize that connected DAG into the theorem proof body now.",
            "Write the parent composition and all leaf boundaries from the same plan in one coherent pass, then compile incrementally.",
            "Do not call `proof_plan` again without compiler, remodel, or failed-reconciliation evidence. Residual warnings belong in the handoff, not in an automatic repair loop.",
            "</decomposition-materialize-required>",
          ].join("\n"),
        ))
      }
      if (
        agent.name === "prover" &&
        currentProofFile &&
        hasAcceptedProofPlan &&
        hasProofFileEdit &&
        decompositionMaterialization &&
        !decompositionMaterialization.review &&
        !acceptedPlanRepair?.available
      ) {
        runtimeContext.push(runtimeContextMessage(
          [
            "<decomposition-materialization-incomplete>",
            "Continue materializing the already accepted plan; do not call `proof_plan` and do not design a replacement split.",
            decompositionMaterialization.missing_plan_nodes.length > 0
              ? `Still missing planned leaf boundaries: ${decompositionMaterialization.missing_plan_nodes.join(", ")}.`
              : "The accepted leaf set is not yet fully represented in the theorem body.",
            decompositionMaterialization.observed_plan_nodes.length > 0
              ? `Currently observed proof_region plan_node values: ${decompositionMaterialization.observed_plan_nodes.join(", ")}.`
              : "No proof_region plan_node value is currently recognized.",
            decompositionMaterialization.unexpected_regions.length > 0
              ? `Regions currently mapped outside the accepted delegated leaf set: ${decompositionMaterialization.unexpected_regions.join(", ")}.`
              : undefined,
            "Change the plan_node value inside the actual `proof_region begin` marker. Editing only a nearby `plan_node:` contract comment does not change dispatch mapping.",
            "Finish the same coherent skeleton, then validate it. This is completion of one materialization, not a new decomposition round.",
            "</decomposition-materialization-incomplete>",
          ].filter((line): line is string => Boolean(line)).join("\n"),
        ))
      }
      if (
        agent.name === "prover" &&
        currentProofFile &&
        hasAcceptedProofPlan &&
        acceptedPlanRepair?.available
      ) {
        runtimeContext.push(runtimeContextMessage(
          acceptedPlanRepair.mode === "route_repair"
            ? [
                "<decomposition-route-repair-required>",
                "The one accepted-plan replacement DAG is already reserved, but its candidate route or premise audit was mechanically rejected.",
                `Evidence: ${acceptedPlanRepair.reason}`,
                "Resubmit the same semantic DAG with a different audited lemma, genuinely different instantiation, explicit dependency for the residual premise, or a current compiler certificate.",
                "Do not change node targets, dependencies, or the semantic leaf set during this route-only correction.",
                "</decomposition-route-repair-required>",
              ].join("\n")
            : [
                "<decomposition-repair-revision-available>",
                "The accepted plan has concrete structural evidence that its current DAG cannot remain frozen.",
                `Evidence: ${acceptedPlanRepair.reason}`,
                "Exactly one accepted-plan repair revision is available. Submit one structured `proof_plan` candidate that changes only the semantic DAG needed to resolve this evidence.",
                "This is not permission for wording-only, evidence-only, or marker-only replanning. If the replacement DAG is rejected only by a route or premise audit, keep that same DAG and correct the audited route instead of spending another structural revision.",
                "</decomposition-repair-revision-available>",
              ].join("\n"),
        ))
      }
      if (
        agent.name === "prover" &&
        currentProofFile &&
        hasAcceptedProofPlan &&
        decompositionMaterialization?.review &&
        !acceptedPlanRepair?.available
      ) {
        const review = decompositionMaterialization.review
        runtimeContext.push(runtimeContextMessage(
          [
            "<decomposition-materialization-reviewed>",
            `The plan-to-skeleton review for the current theorem source is ${review.status}.`,
            review.missing_plan_nodes.length > 0
              ? `Missing plan nodes: ${review.missing_plan_nodes.join(", ")}.`
              : "All planned delegation nodes are represented.",
            review.unexpected_regions.length > 0
              ? `Unexpected regions: ${review.unexpected_regions.join(", ")}.`
              : undefined,
            review.status === "drifted" && administrativeReconciliationAvailable
              ? "One administrative reconciliation is available for this exact accepted plan. Correct only deterministic marker boundaries, plan_node mapping, dependencies, or metadata to match the accepted DAG; do not change the semantic leaf set or rename admit_id to erase history."
              : review.status === "drifted"
                ? "The one administrative reconciliation has already been used. Do not keep rewriting marker metadata; report the remaining drift unless compiler/remodel evidence opens the single accepted-plan repair revision."
                : "This review is current only for this exact theorem source. A later theorem edit will invalidate and recompute it instead of preserving a stale terminal result.",
            "Do not call `proof_plan` for marker-only drift. Continue with bounded validation after a matched review.",
            "</decomposition-materialization-reviewed>",
          ].filter((line): line is string => Boolean(line)).join("\n"),
        ))
      }
      if (agent.name === "whole-lemma" && currentProofFile && !hasProofFileEdit && !hasReadCurrentProofFile) {
        const proofFileDisplay = path.relative(Instance.worktree, currentProofFile) || path.basename(currentProofFile)
        runtimeContext.push(runtimeContextMessage(
          [
            "<whole-lemma-read-required>",
            `You have not yet read ${proofFileDisplay} in this session.`,
            "Your next non-validation action must be a `read` of that theorem file.",
            "Do not make a proof edit before you have read the current theorem statement, nearby context, and existing proof body.",
            "</whole-lemma-read-required>",
          ].join("\n"),
        ))
      }
      if (agent.name === "whole-lemma" && hasReadCurrentProofFile && !hasProofFileEdit && !hasWholeLemmaStartupLookup) {
        runtimeContext.push(runtimeContextMessage(
          [
            "<whole-lemma-lookup-required>",
            "You have read the theorem file but have not yet inspected any proof support in this session.",
            "Your next non-validation action must inspect the live goal or perform one targeted lookup tied to the theorem conclusion or hypothesis names.",
            "Use `grep`, `glob`, `coq_session`, `petanque`, `lsp`, or `coqtop` to inspect directly relevant Prosa facts or goal state before your first proof edit.",
            "Do not guess a proof script before that targeted lookup.",
            "</whole-lemma-lookup-required>",
          ].join("\n"),
        ))
      }
      if (
        (
          agent.name === "lemma" ||
          (agent.name === "prover" && !currentProofFile)
        ) &&
        !hasProofFileEdit &&
        !(agent.name === "prover" && proofTexPath)
      ) {
        runtimeContext.push(runtimeContextMessage(
          [
            "<proof-no-edit-guard>",
            "This session has not yet produced any successful `edit` or `write` against the proof file.",
            "Treat any additional broad reading as circling unless it resolves one concrete blocker from the current goal or a failed proof step.",
            "Your next non-validation action must create a concrete file edit in the current proof.",
            "</proof-no-edit-guard>",
          ].join("\n"),
        ))
      }
      if (agent.name === "whole-lemma" && hasReadCurrentProofFile && hasWholeLemmaStartupLookup && !hasProofFileEdit) {
        runtimeContext.push(runtimeContextMessage(
          [
            "<whole-lemma-active-proof-loop>",
            "You have read the theorem file and performed at least one targeted lookup or live-goal inspection.",
            "Continue querying Prosa when the current goal or a failed tactic exposes a concrete missing fact, but avoid staying in a pure lookup streak.",
            "Prefer to turn the useful lookup result into proof action soon: open or continue a `coq_session`/`petanque` proof loop, run one small advancing tactic, or write a small concrete proof fragment to the theorem file.",
            "When a proof-loop tactic changes the goal in a promising way, mirror that validated step into the file promptly, then use LSP diagnostics, `coq_session`/`petanque`, and `coqc` feedback to repair the next failing line.",
            "Broad `grep`, `glob`, `read`, `coqtop Check/Print/Search`, or pure `petanque Check/Print/Search` calls should be tied to a specific current-goal blocker, not used as a substitute for trying proof steps.",
            "</whole-lemma-active-proof-loop>",
          ].join("\n"),
        ))
      }
      if (agent.name === "whole-lemma" && hasReadCurrentProofFile && hasWholeLemmaStartupLookup && !hasProofFileEdit && wholeLemmaLookupStreak >= 5) {
        runtimeContext.push(runtimeContextMessage(
          [
            "<whole-lemma-lookup-streak>",
            `Your most recent completed actions end with ${wholeLemmaLookupStreak} consecutive lookup or inspection calls and still no proof-file edit.`,
            "That usually means lookup has stopped paying for itself.",
            "Prefer your next non-validation action to be one concrete proof-loop attempt: a `coq_session`/`petanque` step that tries to advance the live goal, or a small proof edit in the theorem file.",
            "After that attempt, use `coqc`, diagnostics, or the next live goal to identify the exact blocker, and only then do the narrowest follow-up lookup needed to repair it.",
            "Avoid another broad lookup burst unless you can name the precise missing lemma, identifier, or side condition that the imminent proof step depends on.",
            "</whole-lemma-lookup-streak>",
          ].join("\n"),
        ))
      }
      const format = lastUser.format ?? { type: "text" }
      if (format.type === "json_schema") {
        system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
      }
      const historyCacheOptions = cacheProjectionOptions(agent)
      const restoredAnchorIndex = restored ? msgs.findIndex((msg) => msg.info.id === restored.anchor) : -1
      const history = restored
        ? [
            ...restored.messages,
            ...MessageV2.toModelMessages(
              restoredAnchorIndex >= 0 ? msgs.slice(restoredAnchorIndex + 1) : msgs,
              model,
              { cache: historyCacheOptions },
            ),
          ]
        : MessageV2.toModelMessages(msgs, model, { cache: historyCacheOptions })

      const result = await processor.process({
        user: lastUser,
        agent,
        abort,
        sessionID,
        system,
        messages: [...history, ...runtimeContext],
        tools,
        model,
        toolChoice: format.type === "json_schema" ? "required" : undefined,
        permission: session.permission,
      })

      // If structured output was captured, save it and exit immediately
      // This takes priority because the StructuredOutput tool was called successfully
      if (structuredOutput !== undefined) {
        processor.message.structured = structuredOutput
        processor.message.finish = processor.message.finish ?? "stop"
        await Session.updateMessage(processor.message)
        break
      }

      // Check if model finished (finish reason is not "tool-calls" or "unknown")
      const modelFinished = processor.message.finish && !["tool-calls", "unknown"].includes(processor.message.finish)

      if (modelFinished && !processor.message.error) {
        if (format.type === "json_schema") {
          // Model stopped without calling StructuredOutput tool
          processor.message.error = new MessageV2.StructuredOutputError({
            message: "Model did not produce structured output",
            retries: 0,
          }).toObject()
          await Session.updateMessage(processor.message)
          break
        }
      }

      if (result === "stop") break
      if (result === "compact") {
        await SessionCompaction.create({
          sessionID,
          agent: lastUser.agent,
          model: lastUser.model,
          auto: true,
          overflow: !processor.message.finish,
        })
      }
      continue
    }
    await ProofEditTransaction.finalize(sessionID)
    SessionCompaction.prune({ sessionID })
    await Trace.end(sessionID)
    for await (const item of MessageV2.stream(sessionID)) {
      if (item.info.role === "user") continue
      const queued = state()[sessionID]?.callbacks ?? []
      for (const q of queued) {
        q.resolve(item)
      }
      return item
    }
    throw new Error("Impossible")
  })

  async function lastModel(sessionID: string) {
    for await (const item of MessageV2.stream(sessionID)) {
      if (item.info.role === "user" && item.info.model) return item.info.model
    }
    return Provider.defaultModel()
  }

  /** @internal Exported for testing */
  export async function resolveTools(input: {
    agent: Agent.Info
    model: Provider.Model
    session: Session.Info
    tools?: Record<string, boolean>
    processor: SessionProcessor.Info
    bypassAgentCheck: boolean
    messages: MessageV2.WithParts[]
  }) {
    using _ = log.time("resolveTools")
    const tools: Record<string, AITool> = {}

    const context = (args: any, options: ToolCallOptions): Tool.Context => ({
      sessionID: input.session.id,
      abort: options.abortSignal!,
      messageID: input.processor.message.id,
      callID: options.toolCallId,
      extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck },
      agent: input.agent.name,
      messages: input.messages,
      metadata: async (val: { title?: string; metadata?: any }) => {
        const match = input.processor.partFromToolCall(options.toolCallId)
        if (match && match.state.status === "running") {
          await Session.updatePart({
            ...match,
            state: {
              title: val.title,
              metadata: val.metadata,
              status: "running",
              input: args,
              time: {
                start: Date.now(),
              },
            },
          })
        }
      },
      async ask(req) {
        await PermissionNext.ask({
          ...req,
          sessionID: input.session.id,
          tool: { messageID: input.processor.message.id, callID: options.toolCallId },
          ruleset: PermissionNext.merge(input.agent.permission, input.session.permission ?? []),
        })
      },
    })

    for (const item of await ToolRegistry.tools(
      { modelID: input.model.api.id, providerID: input.model.providerID },
      input.agent,
    )) {
      const schema = ProviderTransform.schema(input.model, z.toJSONSchema(item.parameters))
      tools[item.id] = tool({
        id: item.id as any,
        description: item.description,
        inputSchema: jsonSchema(schema as any),
        async execute(args, options) {
          const ctx = context(args, options)
          await Plugin.trigger(
            "tool.execute.before",
            {
              tool: item.id,
              sessionID: ctx.sessionID,
              callID: ctx.callID,
            },
            {
              args,
            },
          )
          // Refresh live proof snapshot before tool execution for prover agents
          if (proofAgents.has(input.agent.name)) {
            await ProofContext.ensureFromBinding(ctx.sessionID).catch(() => {})
          }
          const result = await item.execute(args, ctx)
          const output = {
            ...result,
            attachments: result.attachments?.map((attachment) => ({
              ...attachment,
              id: Identifier.ascending("part"),
              sessionID: ctx.sessionID,
              messageID: input.processor.message.id,
            })),
          }
          await Plugin.trigger(
            "tool.execute.after",
            {
              tool: item.id,
              sessionID: ctx.sessionID,
              callID: ctx.callID,
              args,
            },
            output,
          )
          return output
        },
      })
    }

    for (const [key, item] of Object.entries(await MCP.tools())) {
      const execute = item.execute
      if (!execute) continue

      const transformed = ProviderTransform.schema(input.model, asSchema(item.inputSchema).jsonSchema)
      item.inputSchema = jsonSchema(transformed)
      // Wrap execute to add plugin hooks and format output
      item.execute = async (args, opts) => {
        const ctx = context(args, opts)

        await Plugin.trigger(
          "tool.execute.before",
          {
            tool: key,
            sessionID: ctx.sessionID,
            callID: opts.toolCallId,
          },
          {
            args,
          },
        )

        await ctx.ask({
          permission: key,
          metadata: {},
          patterns: ["*"],
          always: ["*"],
        })

        const result = await execute(args, opts)

        await Plugin.trigger(
          "tool.execute.after",
          {
            tool: key,
            sessionID: ctx.sessionID,
            callID: opts.toolCallId,
            args,
          },
          result,
        )

        const textParts: string[] = []
        const attachments: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[] = []

        for (const contentItem of result.content) {
          if (contentItem.type === "text") {
            textParts.push(contentItem.text)
          } else if (contentItem.type === "image") {
            attachments.push({
              type: "file",
              mime: contentItem.mimeType,
              url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
            })
          } else if (contentItem.type === "resource") {
            const { resource } = contentItem
            if (resource.text) {
              textParts.push(resource.text)
            }
            if (resource.blob) {
              attachments.push({
                type: "file",
                mime: resource.mimeType ?? "application/octet-stream",
                url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
                filename: resource.uri,
              })
            }
          }
        }

        const outputDirectory = /^(?:1|true|yes)$/i.test(
          process.env.OPENCODE_STRICT_WORKSPACE_BOUNDARY ?? "",
        )
          ? path.join(Instance.directory, ".prosabuddy-tool-output")
          : undefined
        const truncated = await Truncate.output(
          textParts.join("\n\n"),
          { outputDirectory },
          input.agent,
        )
        const metadata = {
          ...(result.metadata ?? {}),
          truncated: truncated.truncated,
          ...(truncated.truncated && { outputPath: truncated.outputPath }),
        }

        return {
          title: "",
          metadata,
          output: truncated.content,
          attachments: attachments.map((attachment) => ({
            ...attachment,
            id: Identifier.ascending("part"),
            sessionID: ctx.sessionID,
            messageID: input.processor.message.id,
          })),
          content: result.content, // directly return content to preserve ordering when outputting to model
        }
      }
      tools[key] = item
    }

    return tools
  }

  /** @internal Exported for testing */
  export function createStructuredOutputTool(input: {
    schema: Record<string, any>
    onSuccess: (output: unknown) => void
  }): AITool {
    // Remove $schema property if present (not needed for tool input)
    const { $schema, ...toolSchema } = input.schema

    return tool({
      id: "StructuredOutput" as any,
      description: STRUCTURED_OUTPUT_DESCRIPTION,
      inputSchema: jsonSchema(toolSchema as any),
      async execute(args) {
        // AI SDK validates args against inputSchema before calling execute()
        input.onSuccess(args)
        return {
          output: "Structured output captured successfully.",
          title: "Structured Output",
          metadata: { valid: true },
        }
      },
      toModelOutput(result) {
        return {
          type: "text",
          value: result.output,
        }
      },
    })
  }

  async function createUserMessage(input: PromptInput) {
    const agent = await Agent.get(input.agent ?? (await Agent.defaultAgent()))

    const model = input.model ?? agent.model ?? (await lastModel(input.sessionID))
    const full =
      !input.variant && agent.variant
        ? await Provider.getModel(model.providerID, model.modelID).catch(() => undefined)
        : undefined
    const variant = input.variant ?? (agent.variant && full?.variants?.[agent.variant] ? agent.variant : undefined)

    const info: MessageV2.Info = {
      id: input.messageID ?? Identifier.ascending("message"),
      role: "user",
      sessionID: input.sessionID,
      time: {
        created: Date.now(),
      },
      tools: input.tools,
      agent: agent.name,
      model,
      system: input.system,
      format: input.format,
      variant,
    }
    using _ = defer(() => InstructionPrompt.clear(info.id))

    type Draft<T> = T extends MessageV2.Part ? Omit<T, "id"> & { id?: string } : never
    const assign = (part: Draft<MessageV2.Part>): MessageV2.Part => ({
      ...part,
      id: part.id ?? Identifier.ascending("part"),
    })

    const parts = await Promise.all(
      input.parts.map(async (part): Promise<Draft<MessageV2.Part>[]> => {
        if (part.type === "file") {
          // before checking the protocol we check if this is an mcp resource because it needs special handling
          if (part.source?.type === "resource") {
            const { clientName, uri } = part.source
            log.info("mcp resource", { clientName, uri, mime: part.mime })

            const pieces: Draft<MessageV2.Part>[] = [
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Reading MCP resource: ${part.filename} (${uri})`,
              },
            ]

            try {
              const resourceContent = await MCP.readResource(clientName, uri)
              if (!resourceContent) {
                throw new Error(`Resource not found: ${clientName}/${uri}`)
              }

              // Handle different content types
              const contents = Array.isArray(resourceContent.contents)
                ? resourceContent.contents
                : [resourceContent.contents]

              for (const content of contents) {
                if ("text" in content && content.text) {
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: content.text as string,
                  })
                } else if ("blob" in content && content.blob) {
                  // Handle binary content if needed
                  const mimeType = "mimeType" in content ? content.mimeType : part.mime
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `[Binary content: ${mimeType}]`,
                  })
                }
              }

              pieces.push({
                ...part,
                messageID: info.id,
                sessionID: input.sessionID,
              })
            } catch (error: unknown) {
              log.error("failed to read MCP resource", { error, clientName, uri })
              const message = error instanceof Error ? error.message : String(error)
              pieces.push({
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Failed to read MCP resource ${part.filename}: ${message}`,
              })
            }

            return pieces
          }
          const url = new URL(part.url)
          switch (url.protocol) {
            case "data:":
              if (part.mime === "text/plain") {
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: Buffer.from(part.url, "base64url").toString(),
                  },
                  {
                    ...part,
                    messageID: info.id,
                    sessionID: input.sessionID,
                  },
                ]
              }
              break
            case "file:":
              log.info("file", { mime: part.mime })
              // have to normalize, symbol search returns absolute paths
              // Decode the pathname since URL constructor doesn't automatically decode it
              const filepath = fileURLToPath(part.url)
              const s = Filesystem.stat(filepath)

              if (s?.isDirectory()) {
                part.mime = "application/x-directory"
              }

              if (part.mime === "text/plain") {
                let offset: number | undefined = undefined
                let limit: number | undefined = undefined
                const range = {
                  start: url.searchParams.get("start"),
                  end: url.searchParams.get("end"),
                }
                if (range.start != null) {
                  const filePathURI = part.url.split("?")[0]
                  let start = parseInt(range.start)
                  let end = range.end ? parseInt(range.end) : undefined
                  // some LSP servers (eg, gopls) don't give full range in
                  // workspace/symbol searches, so we'll try to find the
                  // symbol in the document to get the full range
                  if (start === end) {
                    const symbols = await LSP.documentSymbol(filePathURI).catch(() => [])
                    for (const symbol of symbols) {
                      let range: LSP.Range | undefined
                      if ("range" in symbol) {
                        range = symbol.range
                      } else if ("location" in symbol) {
                        range = symbol.location.range
                      }
                      if (range?.start?.line && range?.start?.line === start) {
                        start = range.start.line
                        end = range?.end?.line ?? start
                        break
                      }
                    }
                  }
                  offset = Math.max(start, 1)
                  if (end) {
                    limit = end - (offset - 1)
                  }
                }
                const args = { filePath: filepath, offset, limit }

                const pieces: Draft<MessageV2.Part>[] = [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                ]

                await ReadTool.init()
                  .then(async (t) => {
                    const model = await Provider.getModel(info.model.providerID, info.model.modelID)
                    const readCtx: Tool.Context = {
                      sessionID: input.sessionID,
                      abort: new AbortController().signal,
                      agent: input.agent!,
                      messageID: info.id,
                      extra: { bypassCwdCheck: true, model },
                      messages: [],
                      metadata: async () => {},
                      ask: async () => {},
                    }
                    const result = await t.execute(args, readCtx)
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: result.output,
                    })
                    if (result.attachments?.length) {
                      pieces.push(
                        ...result.attachments.map((attachment) => ({
                          ...attachment,
                          synthetic: true,
                          filename: attachment.filename ?? part.filename,
                          messageID: info.id,
                          sessionID: input.sessionID,
                        })),
                      )
                    } else {
                      pieces.push({
                        ...part,
                        messageID: info.id,
                        sessionID: input.sessionID,
                      })
                    }
                  })
                  .catch((error) => {
                    log.error("failed to read file", { error })
                    const message = error instanceof Error ? error.message : error.toString()
                    Bus.publish(Session.Event.Error, {
                      sessionID: input.sessionID,
                      error: new NamedError.Unknown({
                        message,
                      }).toObject(),
                    })
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                    })
                  })

                return pieces
              }

              if (part.mime === "application/x-directory") {
                const args = { filePath: filepath }
                const listCtx: Tool.Context = {
                  sessionID: input.sessionID,
                  abort: new AbortController().signal,
                  agent: input.agent!,
                  messageID: info.id,
                  extra: { bypassCwdCheck: true },
                  messages: [],
                  metadata: async () => {},
                  ask: async () => {},
                }
                const result = await ReadTool.init().then((t) => t.execute(args, listCtx))
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  },
                  {
                    ...part,
                    messageID: info.id,
                    sessionID: input.sessionID,
                  },
                ]
              }

              FileTime.read(input.sessionID, filepath)
              return [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
                  synthetic: true,
                },
                {
                  id: part.id,
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "file",
                  url: `data:${part.mime};base64,` + (await Filesystem.readBytes(filepath)).toString("base64"),
                  mime: part.mime,
                  filename: part.filename!,
                  source: part.source,
                },
              ]
          }
        }

        if (part.type === "agent") {
          // Check if this agent would be denied by task permission
          const perm = PermissionNext.evaluate("task", part.name, agent.permission)
          const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
          return [
            {
              ...part,
              messageID: info.id,
              sessionID: input.sessionID,
            },
            {
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              // An extra space is added here. Otherwise the 'Use' gets appended
              // to user's last word; making a combined word
              text:
                " Use the above message and context to generate a prompt and call the task tool with subagent: " +
                part.name +
                hint,
            },
          ]
        }

        return [
          {
            ...part,
            messageID: info.id,
            sessionID: input.sessionID,
          },
        ]
      }),
    ).then((x) => x.flat().map(assign))

    await Plugin.trigger(
      "chat.message",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        messageID: input.messageID,
        variant: input.variant,
      },
      {
        message: info,
        parts,
      },
    )

    await Session.updateMessage(info)
    for (const part of parts) {
      await Session.updatePart(part)
    }

    return {
      info,
      parts,
    }
  }

  async function insertReminders(input: {
    messages: MessageV2.WithParts[]
    agent: Agent.Info
    session: Session.Info
  }): Promise<ModelMessage[]> {
    const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
    const runtimeContext: ModelMessage[] = []
    if (!userMessage) return runtimeContext

    // Inject proof context for all proof-aware agents (prover, fixer, lemma, whole-lemma, explorer)
    if (proofAgents.has(input.agent.name)) {
      // Detect paper-faithful signals in user text (prover only)
      const userText = userMessage.parts
        .filter((p): p is MessageV2.TextPart => p.type === "text" && !p.synthetic)
        .map((p) => p.text)
        .join("\n")
      const FAITHFUL_RE = /use the paper|follow the proof heuristic|translate the paper proof|strictly follow the proof|do not invent new assumptions|follow the paper|paper.faithful|proof heuristic/i
      const faithful = FAITHFUL_RE.test(userText)

      const { lines } = await ProofProjection.project(input.agent.name, input.session.id, {
        faithful,
        runtimeOnly: true,
      })

      const todos = Todo.get(input.session.id)
      if (todos.length > 0) {
        lines.push(
          "<todo-state>",
          "Current todo list:",
          todos.map((t) => `- [${t.status}] ${t.content}`).join("\n"),
          "</todo-state>",
        )
      }
      if (lines.length > 0) {
        runtimeContext.push({
          role: "user",
          content: [
            {
              type: "text",
              text: lines.join("\n"),
            },
          ],
        })
      }
    }

    // Original logic when experimental plan mode is disabled
    if (!Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE) {
      if (input.agent.name === "plan") {
        userMessage.parts.push({
          id: Identifier.ascending("part"),
          messageID: userMessage.info.id,
          sessionID: userMessage.info.sessionID,
          type: "text",
          text: PROMPT_PLAN,
          synthetic: true,
        })
      }
      const wasPlan = input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
      if (wasPlan && input.agent.name === "build") {
        userMessage.parts.push({
          id: Identifier.ascending("part"),
          messageID: userMessage.info.id,
          sessionID: userMessage.info.sessionID,
          type: "text",
          text: BUILD_SWITCH,
          synthetic: true,
        })
      }
      return runtimeContext
    }

    // New plan mode logic when flag is enabled
    const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")

    // Switching from plan mode to build mode
    if (input.agent.name !== "plan" && assistantMessage?.info.agent === "plan") {
      const plan = Session.plan(input.session)
      const exists = await Filesystem.exists(plan)
      if (exists) {
        const part = await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: userMessage.info.id,
          sessionID: userMessage.info.sessionID,
          type: "text",
          text:
            BUILD_SWITCH + "\n\n" + `A plan file exists at ${plan}. You should execute on the plan defined within it`,
          synthetic: true,
        })
        userMessage.parts.push(part)
      }
      return runtimeContext
    }

    // Entering plan mode
    if (input.agent.name === "plan" && assistantMessage?.info.agent !== "plan") {
      const plan = Session.plan(input.session)
      const exists = await Filesystem.exists(plan)
      if (!exists) await fs.mkdir(path.dirname(plan), { recursive: true })
      const part = await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: `<system-reminder>
Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supersedes any other instructions you have received.

## Plan File Info:
${exists ? `A plan file already exists at ${plan}. You can read it and make incremental edits using the edit tool.` : `No plan file exists yet. You should create your plan at ${plan} using the write tool.`}
You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.

## Plan Workflow

### Phase 1: Initial Understanding
Goal: Gain a comprehensive understanding of the user's request by reading through code and asking them questions. Critical: In this phase you should only use the explore subagent type.

1. Focus on understanding the user's request and the code associated with their request

2. **Launch up to 3 explore agents IN PARALLEL** (single message, multiple tool calls) to efficiently explore the codebase.
   - Use 1 agent when the task is isolated to known files, the user provided specific file paths, or you're making a small targeted change.
   - Use multiple agents when: the scope is uncertain, multiple areas of the codebase are involved, or you need to understand existing patterns before planning.
   - Quality over quantity - 3 agents maximum, but you should try to use the minimum number of agents necessary (usually just 1)
   - If using multiple agents: Provide each agent with a specific search focus or area to explore. Example: One agent searches for existing implementations, another explores related components, a third investigates testing patterns

3. After exploring the code, use the question tool to clarify ambiguities in the user request up front.

### Phase 2: Design
Goal: Design an implementation approach.

Launch general agent(s) to design the implementation based on the user's intent and your exploration results from Phase 1.

You can launch up to 1 agent(s) in parallel.

**Guidelines:**
- **Default**: Launch at least 1 Plan agent for most tasks - it helps validate your understanding and consider alternatives
- **Skip agents**: Only for truly trivial tasks (typo fixes, single-line changes, simple renames)

Examples of when to use multiple agents:
- The task touches multiple parts of the codebase
- It's a large refactor or architectural change
- There are many edge cases to consider
- You'd benefit from exploring different approaches

Example perspectives by task type:
- New feature: simplicity vs performance vs maintainability
- Bug fix: root cause vs workaround vs prevention
- Refactoring: minimal change vs clean architecture

In the agent prompt:
- Provide comprehensive background context from Phase 1 exploration including filenames and code path traces
- Describe requirements and constraints
- Request a detailed implementation plan

### Phase 3: Review
Goal: Review the plan(s) from Phase 2 and ensure alignment with the user's intentions.
1. Read the critical files identified by agents to deepen your understanding
2. Ensure that the plans align with the user's original request
3. Use question tool to clarify any remaining questions with the user

### Phase 4: Final Plan
Goal: Write your final plan to the plan file (the only file you can edit).
- Include only your recommended approach, not all alternatives
- Ensure that the plan file is concise enough to scan quickly, but detailed enough to execute effectively
- Include the paths of critical files to be modified
- Include a verification section describing how to test the changes end-to-end (run the code, use MCP tools, run tests)

### Phase 5: Call plan_exit tool
At the very end of your turn, once you have asked the user questions and are happy with your final plan file - you should always call plan_exit to indicate to the user that you are done planning.
This is critical - your turn should only end with either asking the user a question or calling plan_exit. Do not stop unless it's for these 2 reasons.

**Important:** Use question tool to clarify requirements/approach, use plan_exit to request plan approval. Do NOT use question tool to ask "Is this plan okay?" - that's what plan_exit does.

NOTE: At any point in time through this workflow you should feel free to ask the user questions or clarifications. Don't make large assumptions about user intent. The goal is to present a well researched plan to the user, and tie any loose ends before implementation begins.
</system-reminder>`,
        synthetic: true,
      })
      userMessage.parts.push(part)
      return runtimeContext
    }
    return runtimeContext
  }

  export const ShellInput = z.object({
    sessionID: Identifier.schema("session"),
    agent: z.string(),
    model: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
    command: z.string(),
  })
  export type ShellInput = z.infer<typeof ShellInput>
  export async function shell(input: ShellInput) {
    const abort = start(input.sessionID)
    if (!abort) {
      throw new Session.BusyError(input.sessionID)
    }

    using _ = defer(() => {
      // If no queued callbacks, cancel (the default)
      const callbacks = state()[input.sessionID]?.callbacks ?? []
      if (callbacks.length === 0) {
        cancel(input.sessionID)
      } else {
        // Otherwise, trigger the session loop to process queued items
        loop({ sessionID: input.sessionID, resume_existing: true }).catch((error) => {
          log.error("session loop failed to resume after shell command", { sessionID: input.sessionID, error })
        })
      }
    })

    const session = await Session.get(input.sessionID)
    if (session.revert) {
      await SessionRevert.cleanup(session)
    }
    const agent = await Agent.get(input.agent)
    const model = input.model ?? agent.model ?? (await lastModel(input.sessionID))
    const userMsg: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: input.sessionID,
      time: {
        created: Date.now(),
      },
      role: "user",
      agent: input.agent,
      model: {
        providerID: model.providerID,
        modelID: model.modelID,
      },
    }
    await Session.updateMessage(userMsg)
    const userPart: MessageV2.Part = {
      type: "text",
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: input.sessionID,
      text: "The following tool was executed by the user",
      synthetic: true,
    }
    await Session.updatePart(userPart)

    const msg: MessageV2.Assistant = {
      id: Identifier.ascending("message"),
      sessionID: input.sessionID,
      parentID: userMsg.id,
      mode: input.agent,
      agent: input.agent,
      cost: 0,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      time: {
        created: Date.now(),
      },
      role: "assistant",
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: model.modelID,
      providerID: model.providerID,
    }
    await Session.updateMessage(msg)
    const part: MessageV2.Part = {
      type: "tool",
      id: Identifier.ascending("part"),
      messageID: msg.id,
      sessionID: input.sessionID,
      tool: "bash",
      callID: ulid(),
      state: {
        status: "running",
        time: {
          start: Date.now(),
        },
        input: {
          command: input.command,
        },
      },
    }
    await Session.updatePart(part)
    const shell = Shell.preferred()
    const shellName = (
      process.platform === "win32" ? path.win32.basename(shell, ".exe") : path.basename(shell)
    ).toLowerCase()

    const invocations: Record<string, { args: string[] }> = {
      nu: {
        args: ["-c", input.command],
      },
      fish: {
        args: ["-c", input.command],
      },
      zsh: {
        args: [
          "-c",
          "-l",
          `
            [[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
            [[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
            eval ${JSON.stringify(input.command)}
          `,
        ],
      },
      bash: {
        args: [
          "-c",
          "-l",
          `
            shopt -s expand_aliases
            [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
            eval ${JSON.stringify(input.command)}
          `,
        ],
      },
      // Windows cmd
      cmd: {
        args: ["/c", input.command],
      },
      // Windows PowerShell
      powershell: {
        args: ["-NoProfile", "-Command", input.command],
      },
      pwsh: {
        args: ["-NoProfile", "-Command", input.command],
      },
      // Fallback: any shell that doesn't match those above
      //  - No -l, for max compatibility
      "": {
        args: ["-c", `${input.command}`],
      },
    }

    const matchingInvocation = invocations[shellName] ?? invocations[""]
    const args = matchingInvocation?.args

    const cwd = Instance.directory
    const shellEnv = await Plugin.trigger(
      "shell.env",
      { cwd, sessionID: input.sessionID, callID: part.callID },
      { env: {} },
    )
    const proc = spawn(shell, args, {
      cwd,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...shellEnv.env,
        TERM: "dumb",
      },
    })

    let output = ""

    proc.stdout?.on("data", (chunk) => {
      output += chunk.toString()
      if (part.state.status === "running") {
        part.state.metadata = {
          output: output,
          description: "",
        }
        Session.updatePart(part)
      }
    })

    proc.stderr?.on("data", (chunk) => {
      output += chunk.toString()
      if (part.state.status === "running") {
        part.state.metadata = {
          output: output,
          description: "",
        }
        Session.updatePart(part)
      }
    })

    let aborted = false
    let exited = false

    const kill = () => Shell.killTree(proc, { exited: () => exited })

    if (abort.aborted) {
      aborted = true
      await kill()
    }

    const abortHandler = () => {
      aborted = true
      void kill()
    }

    abort.addEventListener("abort", abortHandler, { once: true })

    await new Promise<void>((resolve) => {
      proc.on("close", () => {
        exited = true
        abort.removeEventListener("abort", abortHandler)
        resolve()
      })
    })

    if (aborted) {
      output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
    }
    msg.time.completed = Date.now()
    await Session.updateMessage(msg)
    if (part.state.status === "running") {
      part.state = {
        status: "completed",
        time: {
          ...part.state.time,
          end: Date.now(),
        },
        input: part.state.input,
        title: "",
        metadata: {
          output,
          description: "",
        },
        output,
      }
      await Session.updatePart(part)
    }
    return { info: msg, parts: [part] }
  }

  export const CommandInput = z.object({
    messageID: Identifier.schema("message").optional(),
    sessionID: Identifier.schema("session"),
    agent: z.string().optional(),
    model: z.string().optional(),
    arguments: z.string(),
    command: z.string(),
    variant: z.string().optional(),
    parts: z
      .array(
        z.discriminatedUnion("type", [
          MessageV2.FilePart.omit({
            messageID: true,
            sessionID: true,
          }).partial({
            id: true,
          }),
        ]),
      )
      .optional(),
  })
  export type CommandInput = z.infer<typeof CommandInput>
  const bashRegex = /!`([^`]+)`/g
  // Match [Image N] as single token, quoted strings, or non-space sequences
  const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
  const placeholderRegex = /\$(\d+)/g
  const quoteTrimRegex = /^["']|["']$/g
  /**
   * Regular expression to match @ file references in text
   * Matches @ followed by file paths, excluding commas, periods at end of sentences, and backticks
   * Does not match when preceded by word characters or backticks (to avoid email addresses and quoted references)
   */

  export async function command(input: CommandInput) {
    log.info("command", input)
    const command = await Command.get(input.command)
    const agentName = command.agent ?? input.agent ?? (await Agent.defaultAgent())

    const raw = input.arguments.match(argsRegex) ?? []
    const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))

    const templateCommand = await command.template

    const placeholders = templateCommand.match(placeholderRegex) ?? []
    let last = 0
    for (const item of placeholders) {
      const value = Number(item.slice(1))
      if (value > last) last = value
    }

    // Let the final placeholder swallow any extra arguments so prompts read naturally
    const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
      const position = Number(index)
      const argIndex = position - 1
      if (argIndex >= args.length) return ""
      if (position === last) return args.slice(argIndex).join(" ")
      return args[argIndex]
    })
    const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
    let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

    // If command doesn't explicitly handle arguments (no $N or $ARGUMENTS placeholders)
    // but user provided arguments, append them to the template
    if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
      template = template + "\n\n" + input.arguments
    }

    const shell = ConfigMarkdown.shell(template)
    if (shell.length > 0) {
      const results = await Promise.all(
        shell.map(async ([, cmd]) => {
          try {
            return await $`${{ raw: cmd }}`.quiet().nothrow().text()
          } catch (error) {
            return `Error executing command: ${error instanceof Error ? error.message : String(error)}`
          }
        }),
      )
      let index = 0
      template = template.replace(bashRegex, () => results[index++])
    }
    template = template.trim()

    const taskModel = await (async () => {
      if (command.model) {
        return Provider.parseModel(command.model)
      }
      if (command.agent) {
        const cmdAgent = await Agent.get(command.agent)
        if (cmdAgent?.model) {
          return cmdAgent.model
        }
      }
      if (input.model) return Provider.parseModel(input.model)
      return await lastModel(input.sessionID)
    })()

    try {
      await Provider.getModel(taskModel.providerID, taskModel.modelID)
    } catch (e) {
      if (Provider.ModelNotFoundError.isInstance(e)) {
        const { providerID, modelID, suggestions } = e.data
        const hint = suggestions?.length ? ` Did you mean: ${suggestions.join(", ")}?` : ""
        Bus.publish(Session.Event.Error, {
          sessionID: input.sessionID,
          error: new NamedError.Unknown({ message: `Model not found: ${providerID}/${modelID}.${hint}` }).toObject(),
        })
      }
      throw e
    }
    const agent = await Agent.get(agentName)
    if (!agent) {
      const available = await Agent.list().then((agents) => agents.filter((a) => !a.hidden).map((a) => a.name))
      const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
      const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
      Bus.publish(Session.Event.Error, {
        sessionID: input.sessionID,
        error: error.toObject(),
      })
      throw error
    }

    const templateParts = await resolvePromptParts(template)
    const isSubtask = (agent.mode === "subagent" && command.subtask !== false) || command.subtask === true
    const parts = isSubtask
      ? [
          {
            type: "subtask" as const,
            agent: agent.name,
            description: command.description ?? "",
            command: input.command,
            model: {
              providerID: taskModel.providerID,
              modelID: taskModel.modelID,
            },
            // TODO: how can we make task tool accept a more complex input?
            prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
          },
        ]
      : [...templateParts, ...(input.parts ?? [])]

    const userAgent = isSubtask ? (input.agent ?? (await Agent.defaultAgent())) : agentName
    const userModel = isSubtask
      ? input.model
        ? Provider.parseModel(input.model)
        : await lastModel(input.sessionID)
      : taskModel

    await Plugin.trigger(
      "command.execute.before",
      {
        command: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
      },
      { parts },
    )

    const result = (await prompt({
      sessionID: input.sessionID,
      messageID: input.messageID,
      model: userModel,
      agent: userAgent,
      parts,
      variant: input.variant,
    })) as MessageV2.WithParts

    Bus.publish(Command.Event.Executed, {
      name: input.command,
      sessionID: input.sessionID,
      arguments: input.arguments,
      messageID: result.info.id,
    })

    return result
  }

  async function ensureTitle(input: {
    session: Session.Info
    history: MessageV2.WithParts[]
    providerID: string
    modelID: string
  }) {
    if (input.session.parentID) return
    if (!Session.isDefaultTitle(input.session.title)) return

    // Find first non-synthetic user message
    const firstRealUserIdx = input.history.findIndex(
      (m) => m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic),
    )
    if (firstRealUserIdx === -1) return

    const isFirst =
      input.history.filter((m) => m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic))
        .length === 1
    if (!isFirst) return

    // Gather all messages up to and including the first real user message for context
    // This includes any shell/subtask executions that preceded the user's first prompt
    const contextMessages = input.history.slice(0, firstRealUserIdx + 1)
    const firstRealUser = contextMessages[firstRealUserIdx]

    // For subtask-only messages (from command invocations), extract the prompt directly
    // since toModelMessage converts subtask parts to generic "The following tool was executed by the user"
    const subtaskParts = firstRealUser.parts.filter((p) => p.type === "subtask") as MessageV2.SubtaskPart[]
    const hasOnlySubtaskParts = subtaskParts.length > 0 && firstRealUser.parts.every((p) => p.type === "subtask")

    const agent = await Agent.get("title")
    if (!agent) return
    const model = await iife(async () => {
      if (agent.model) return await Provider.getModel(agent.model.providerID, agent.model.modelID)
      return (
        (await Provider.getSmallModel(input.providerID)) ?? (await Provider.getModel(input.providerID, input.modelID))
      )
    })
    const result = await LLM.stream({
      agent,
      user: firstRealUser.info as MessageV2.User,
      system: [],
      small: true,
      tools: {},
      model,
      abort: new AbortController().signal,
      sessionID: input.session.id,
      retries: 2,
      messages: [
        {
          role: "user",
          content: "Generate a title for this conversation:\n",
        },
        ...(hasOnlySubtaskParts
          ? [{ role: "user" as const, content: subtaskParts.map((p) => p.prompt).join("\n") }]
          : MessageV2.toModelMessages(contextMessages, model)),
      ],
    })
    const text = await result.text.catch((err) => log.error("failed to generate title", { error: err }))
    if (text) {
      const cleaned = text
        .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      if (!cleaned) return

      const title = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
      return Session.setTitle({ sessionID: input.session.id, title })
    }
  }
}
