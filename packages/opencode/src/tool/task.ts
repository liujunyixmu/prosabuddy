import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { PermissionNext } from "@/permission/next"
import { SessionProof } from "../session/session-proof"
import { ProofContext } from "../session/proof-context"
import { SessionProofWorkflow } from "../session/proof-workflow"
import {
  BlockedProofReportSchema,
  EscalationType,
  LemmaAssignmentSchema,
  RemodelRequestSchema,
  type LemmaAssignment,
} from "@/session/lemma-assignment"
import { Trace } from "@/session/trace"
import path from "path"
import { Filesystem } from "@/util/filesystem"
import { Instance } from "@/project/instance"
import { currentCoqProofState, findContextNormalizationAudit } from "./coq-session"
import { ProofEditTransaction } from "@/session/proof-edit-transaction"

const assignment = LemmaAssignmentSchema

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  lemma_assignment: assignment
    .describe("Required for fresh lemma tasks. Identifies the exact single proof_region the lemma agent must replace or update, preserve, and validate.")
    .optional(),
  proof_repair_assignment: SessionProofWorkflow.ProofRepairAssignment
    .describe("Required for theorem repair tasks created after a structural lemma escalation. Identifies the exact stale proof_region blocker and repair evidence.")
    .optional(),
  task_id: z
    .string()
    .describe(
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
    )
    .optional(),
  command: z.string().describe("The command that triggered this task").optional(),
})

const MAX_LEMMA_RECURSION_DEPTH = 4
const MAX_LEMMA_CHILDREN = 1
const LEMMA_STACK_MODE = "dfs_lifo" as const
const WIDE_PROBE_PROOF_AGENTS = new Set(["fixer", "coq-prover", "coqprover"])
const WIDE_FALLBACK_PROOF_AGENTS = new Set(["whole-lemma"])
const PROOF_PRODUCING_AGENTS = new Set(["lemma", "prover", ...WIDE_PROBE_PROOF_AGENTS, ...WIDE_FALLBACK_PROOF_AGENTS])

const proofResultChildSchema = z
  .object({
    child_id_hint: z.string().min(1),
    title: z.string().min(1),
    statement: z.string().min(1),
    why_smaller_than_parent: z.string().min(1),
    expected_role_in_parent: z.string().min(1),
    suggested_order: z.number().int().positive(),
    source_reference: z.string().min(1).optional(),
    paper_reference: z.string().min(1).optional(),
  })
  .passthrough()
  .superRefine((child, ctx) => {
    if (!child.source_reference?.trim() && !child.paper_reference?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source_reference"],
        message: "split child requires source_reference, or legacy paper_reference for backward compatibility",
      })
    }
  })

const proofResultSchema = z
  .object({
    status: z.enum(["solved", "split", "escalate"]),
    goal_id: z.string().min(1),
    parent_goal_id: z.string().min(1),
    stack_mode: z.literal(LEMMA_STACK_MODE),
    informal_proof: z.string().trim().min(1),
    split_required: z.boolean(),
    split_reason: z.string(),
    children: z.array(proofResultChildSchema).max(MAX_LEMMA_CHILDREN),
    proof_text: z.string(),
    used_helpers: z.array(z.string()).default([]),
    validation_plan: z.array(z.string()).default([]),
    escalate_reason: z.string(),
    escalation_type: EscalationType.optional(),
    remodel_request: RemodelRequestSchema.optional(),
    attempt_report: BlockedProofReportSchema.optional(),
    changed_region_summary: z.string().optional(),
    recursion_depth: z.number().int().positive().optional(),
    max_recursion_depth: z.number().int().positive().optional(),
  })
  .passthrough()
  .superRefine((result, ctx) => {
    const proofText = result.proof_text.trim()
    const splitReason = result.split_reason.trim()
    const escalateReason = result.escalate_reason.trim()

    if (result.status === "solved") {
      if (result.remodel_request) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["remodel_request"],
          message: "solved proof_result must not include remodel_request",
        })
      }
      if (result.split_required) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["split_required"],
          message: "solved proof_result must set split_required to false",
        })
      }
      if (result.children.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["children"],
          message: "solved proof_result must not include children",
        })
      }
      if (!proofText) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["proof_text"],
          message: "solved proof_result requires non-empty proof_text",
        })
      }
    }

    if (result.status === "split") {
      if (!result.split_required) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["split_required"],
          message: "split proof_result must set split_required to true",
        })
      }
      if (!splitReason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["split_reason"],
          message: "split proof_result requires non-empty split_reason",
        })
      }
      if (result.children.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["children"],
          message: "split proof_result requires at least one child",
        })
      }
      if (proofText) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["proof_text"],
          message: "split proof_result must leave proof_text empty",
        })
      }
      const orders = result.children.map((child) => child.suggested_order)
      const uniqueOrders = new Set(orders)
      if (uniqueOrders.size !== orders.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["children"],
          message: "split proof_result children must use unique suggested_order values",
        })
      }
      const sortedOrders = [...uniqueOrders].sort((left, right) => left - right)
      for (const [index, order] of sortedOrders.entries()) {
        if (order !== index + 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["children"],
            message: "split proof_result children must use contiguous suggested_order values starting at 1",
          })
          break
        }
      }
    }

    if (result.status === "escalate") {
      if (result.split_required) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["split_required"],
          message: "escalate proof_result must set split_required to false",
        })
      }
      if (result.children.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["children"],
          message: "escalate proof_result must not include children",
        })
      }
      if (!escalateReason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["escalate_reason"],
          message: "escalate proof_result requires non-empty escalate_reason",
        })
      }
      if (!result.escalation_type) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["escalation_type"],
          message: "escalate proof_result requires escalation_type",
        })
      }
      if (result.escalation_type === "needs_subgoal_remodel" && !result.remodel_request) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["remodel_request"],
          message: "needs_subgoal_remodel proof_result requires remodel_request",
        })
      }
    }
  })

type ProofResult = z.infer<typeof proofResultSchema>

type LemmaTaskRuntime = {
  caller_agent: string
  recursion_depth: number
  max_recursion_depth: number
  max_children: number
  stack_mode: typeof LEMMA_STACK_MODE
}

function proofScopeMetadata(agentName: string, hasLemmaAssignment: boolean, repairAssignment?: SessionProofWorkflow.ProofRepairAssignment) {
  if (agentName === "lemma" && hasLemmaAssignment) {
    return {
      proof_scope: "lemma_local" as const,
      lemma_local_worker: true,
      proof_worker_label: "lemma-local worker: owns exactly one assigned proof_region",
    }
  }
  if (agentName === "prover" && repairAssignment) {
    return {
      proof_scope: "theorem_repair" as const,
      lemma_local_worker: false,
      proof_worker_label: "theorem repair worker: owns the theorem-level remodel or bridge for one escalated proof_region",
      proof_repair_assignment: repairAssignment,
      admit_id: repairAssignment.admit_id,
      region_fingerprint: repairAssignment.region_fingerprint,
      remodel_request: repairAssignment.remodel_request,
      attempt_report: repairAssignment.attempt_report,
    }
  }
  if (WIDE_PROBE_PROOF_AGENTS.has(agentName)) {
    return {
      proof_scope: "wide_probe" as const,
      lemma_local_worker: false,
      proof_worker_label: "bounded proof probe: must feed findings into a concrete repair or escalation",
    }
  }
  if (WIDE_FALLBACK_PROOF_AGENTS.has(agentName)) {
    return {
      proof_scope: "wide_fallback" as const,
      lemma_local_worker: false,
      proof_worker_label: "whole-theorem wide fallback proof agent: not evidence that lemma-local isolation was satisfied",
    }
  }
  return {}
}

async function beginProofEditTransaction(input: {
  sessionID: string
  parentSessionID: string
  agent: string
  lemmaAssignment?: LemmaAssignment
  repairAssignment?: SessionProofWorkflow.ProofRepairAssignment
}) {
  const binding = SessionProof.get(input.sessionID)
  if (!binding?.file.endsWith(".v")) return undefined
  const requestedFile = input.lemmaAssignment?.file ?? input.repairAssignment?.file ?? binding.file
  const file = path.isAbsolute(requestedFile) ? requestedFile : path.resolve(Instance.directory, requestedFile)
  if (!(await Filesystem.exists(file))) return undefined
  const source = await Filesystem.readText(file)
  const theorem =
    input.lemmaAssignment?.theorem ??
    input.repairAssignment?.theorem ??
    SessionProofWorkflow.theoremTargetAtProofPosition(source, {
      line: binding.line,
      character: binding.character,
    })?.theorem
  if (!theorem) return undefined

  const editable = input.lemmaAssignment?.editable_region
  const explicitSpineChange = Boolean(
    input.repairAssignment &&
      (input.repairAssignment.escalation_type === "needs_theorem_spine_change" ||
        input.repairAssignment.remodel_request?.should_lift_to_theorem_level),
  )
  const scope: ProofEditTransaction.AuthorizedScope =
    editable?.begin_marker && editable.end_marker
      ? {
          kind: "proof_region",
          theorem,
          beginMarker: editable.begin_marker,
          endMarker: editable.end_marker,
        }
      : explicitSpineChange
        ? {
            kind: "theorem_spine",
            theorem,
          }
        : {
            kind: "theorem_body",
            theorem,
          }
  const transferred = ProofEditTransaction.transfer({
    fromSessionID: input.parentSessionID,
    toSessionID: input.sessionID,
    file,
    theorem,
    scope,
    preferCertifiedBaseline: Boolean(input.repairAssignment),
  })
  if (transferred) return transferred

  return ProofEditTransaction.begin({
    sessionID: input.sessionID,
    parentSessionID: input.parentSessionID,
    agent: input.agent,
    file,
    source,
    scope,
    preferCertifiedBaseline: Boolean(input.repairAssignment),
  })
}

function withProofEditTransactionRecovery(
  prompt: string,
  transaction: ProofEditTransaction.Summary | undefined,
) {
  if (!transaction || (!transaction.recovered && !transaction.handed_off)) return prompt
  return [
    prompt,
    "",
    "<proof-edit-transaction-recovery>",
    transaction.recovered
      ? "A recoverable proof transaction was restored for this child. The staged source exposed by read/edit/checkpoint tools is authoritative and may be newer than the workspace file on disk."
      : "A proof transaction was handed off to this child. The staged source exposed by read/edit/checkpoint tools is authoritative and may be newer than the workspace file on disk.",
    `transaction_id: ${transaction.transaction_id}`,
    `file: ${transaction.file}`,
    `scope: ${transaction.scope}`,
    `revision: ${transaction.revision}`,
    `source_hash: ${transaction.source_hash}`,
    `progress_level: ${transaction.progress_level ?? "none"}`,
    `committable_snapshot: ${transaction.committable_snapshot}`,
    `validation_pending: ${transaction.validation_pending}`,
    `recovery_base: ${transaction.recovery_base}`,
    transaction.certified_revision !== undefined
      ? `certified_revision: ${transaction.certified_revision}`
      : undefined,
    transaction.certified_region_count !== undefined
      ? `certified_region_count: ${transaction.certified_region_count}`
      : undefined,
    transaction.certified_unresolved_debt !== undefined
      ? `certified_unresolved_debt: ${transaction.certified_unresolved_debt}`
      : undefined,
    transaction.preserved_draft_revision !== undefined
      ? `preserved_draft_revision: ${transaction.preserved_draft_revision}`
      : undefined,
    transaction.preserved_draft_hash
      ? `preserved_draft_hash: ${transaction.preserved_draft_hash}`
      : undefined,
    transaction.recovery_base === "best_certified"
      ? "This fresh repair branch starts from the best compiler-certified snapshot. The newer unaccepted draft remains journaled under preserved_draft_revision; use its evidence from the handoff, but do not make it the active baseline unless it earns a compiler certificate."
      : "Continue from the current journaled draft and preserve every compiler-certified fragment.",
    transaction.validation_pending
      ? "This exact staged revision is still pending validation. Run checkpoint/coqc and obtain a compiler-backed receipt before ordinary lemma redispatch; if validation fails, repair or remodel this staged region first."
      : undefined,
    "First read the current authorized staged region. On proof_transaction_stale_view, re-read and create a new local patch; do not reconstruct from the older workspace source.",
    "</proof-edit-transaction-recovery>",
  ].filter((line): line is string => Boolean(line)).join("\n")
}

function withProofRepairHandoff(prompt: string, handoff: unknown) {
  if (!handoff) return prompt
  return [
    prompt,
    "",
    "<proof-repair-handoff>",
    "This is a fresh repair context. Treat the structured payload below as the authoritative compact handoff instead of reconstructing earlier conversation history.",
    JSON.stringify(handoff, null, 2),
    "Preserve certified dependencies and the active transaction baseline. Forbidden routes apply only to the exact verified semantic failure described in the payload; other proof routes and meaningful theorem-level remodeling remain available.",
    "</proof-repair-handoff>",
  ].join("\n")
}

function isLemmaSubagentSession(title: string) {
  return title.includes("(@lemma subagent)")
}

function resolveWorkspaceFile(file: string) {
  return path.normalize(path.isAbsolute(file) ? file : path.join(Instance.directory, file))
}

function bindLemmaProofContext(sessionID: string, item: LemmaAssignment, canonicalSource?: string) {
  if (!item.proof_position) return undefined

  const targetFile = resolveWorkspaceFile(item.file)
  const binding = SessionProof.set(sessionID, targetFile, item.proof_position, "parent", {
    canonicalSource,
  })
  ProofContext.setBinding(sessionID, targetFile, item.proof_position)
  return binding
}

function toolInputTouchesFile(input: Record<string, unknown>, targetFile: string) {
  const raw = input.filePath
  if (typeof raw !== "string" || !raw) return false
  return resolveWorkspaceFile(raw) === targetFile
}

function findProofTexForTarget(targetFile: string) {
  return Filesystem.findUp("proof.tex", path.dirname(targetFile), Instance.worktree).then((matches) => matches[0])
}

function countExplicitGapPlaceholders(source: string) {
  return Array.from(source.matchAll(/\bAdmitted\.|\badmit\b/g)).length
}

async function collectProverDelegationReadiness(sessionID: string, item: LemmaAssignment, sourceOverride?: string) {
  const targetFile = resolveWorkspaceFile(item.file)
  const proofTexPath = await findProofTexForTarget(targetFile)
  let hasProofPlan = false
  let hasTargetEdit = false
  let hasReadProofTex = false

  for await (const message of MessageV2.stream(sessionID)) {
    if (message.info.role !== "assistant") continue

    for (const part of message.parts) {
      if (part.type !== "tool" || part.state.status !== "completed") continue
      if (part.tool === "proof_plan") hasProofPlan = true
      if (proofTexPath && part.tool === "read" && toolInputTouchesFile(part.state.input, proofTexPath)) {
        hasReadProofTex = true
      }
      if ((part.tool === "edit" || part.tool === "write") && toolInputTouchesFile(part.state.input, targetFile)) {
        hasTargetEdit = true
      }
    }

    if ((!proofTexPath || hasReadProofTex) && hasProofPlan && hasTargetEdit) break
  }

  const explicitGapCount = (await Filesystem.exists(targetFile))
    ? countExplicitGapPlaceholders(sourceOverride ?? await Filesystem.readText(targetFile))
    : 0

  return {
    targetFile,
    proofTexPath,
    hasReadProofTex,
    hasProofPlan,
    hasTargetEdit,
    explicitGapCount,
  }
}

async function assertProverLemmaDelegationReadiness(
  sessionID: string,
  item: LemmaAssignment,
  sourceOverride?: string,
) {
  const readiness = await collectProverDelegationReadiness(sessionID, item, sourceOverride)

  if (readiness.proofTexPath && !readiness.hasReadProofTex) {
    throw new Error(
      `workspace contains proof.tex at ${path.relative(Instance.worktree, readiness.proofTexPath)}; before delegating to lemma, prover must read that proof.tex and either use it to anchor the semantic spine or explicitly downgrade it before writing a context-derived split`,
    )
  }

  if (readiness.explicitGapCount === 0) {
    throw new Error(
      "before delegating to lemma, prover must first freeze the theorem-level split as locality-checked proof_region owner: lemma leaves with explicit admits or local placeholders; use proof_plan to audit the semantic spine when useful, then write contract-bearing semantic or shape nodes to the theorem file",
    )
  }

  if (!readiness.hasProofPlan && !readiness.hasTargetEdit && readiness.explicitGapCount < 2) {
    throw new Error(
      "before the first fresh lemma delegation, prover must either call proof_plan or persist a theorem-level edit that makes the semantic/shape split explicit; otherwise the theorem-level decomposition is still implicit and lemma ownership is premature",
    )
  }
}

async function lemmaRecursionDepth(sessionID: string) {
  let depth = 0
  const seen = new Set<string>()
  let current = await Session.get(sessionID).catch(() => undefined)

  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    if (isLemmaSubagentSession(current.title)) depth += 1
    current = current.parentID ? await Session.get(current.parentID).catch(() => undefined) : undefined
  }

  return depth
}

async function lemmaTaskRuntime(sessionID: string, callerAgent: string): Promise<LemmaTaskRuntime> {
  return {
    caller_agent: callerAgent,
    recursion_depth: Math.max(1, await lemmaRecursionDepth(sessionID)),
    max_recursion_depth: MAX_LEMMA_RECURSION_DEPTH,
    max_children: MAX_LEMMA_CHILDREN,
    stack_mode: LEMMA_STACK_MODE,
  }
}

function withLemmaRuntimeGuardrail(prompt: string, runtime: LemmaTaskRuntime) {
  return [
    "<lemma-runtime-guardrail>",
    `caller_agent: ${runtime.caller_agent}`,
    `recursion_depth: ${runtime.recursion_depth}`,
    `max_recursion_depth: ${runtime.max_recursion_depth}`,
    `stack_mode: ${runtime.stack_mode}`,
    `max_children_per_split: ${runtime.max_children}`,
    "ownership: edit only the assigned proof_region; preserve its exported target when possible and never edit the theorem terminator.",
    "prefix: solve and validate the first unresolved local block before touching later local proof holes; preserve partition braces.",
    "validation: after a failed proof change, use the first diagnostic to repair the same block from the authoritative staged revision.",
    "split: keep local decomposition in this session and expose only the immediate smaller blocker; do not dispatch another lemma worker.",
    "freedom: direct proof, same-region helpers, and evidence-backed local remodeling requests remain available.",
    "</lemma-runtime-guardrail>",
    "",
    prompt,
  ].join("\n")
}

function withLemmaAssignment(prompt: string, item: LemmaAssignment) {
  const editableRegion = item.editable_region
    ? [
        "",
        "Editable region policy:",
        `- editable_region.mode: ${item.editable_region.mode}`,
        `- editable_region.lines: ${item.editable_region.start_line}-${item.editable_region.end_line}`,
        `- can_add_sibling_helpers: ${item.editable_region.can_add_sibling_helpers}`,
        "- The assigned proof_region should include the exported target statement and its complete `{ ... }` proof block, not just the text inside that target's braces.",
        "- Treat the exported target statement as the prover-authored subgoal contract: prefer writing proof text inside its block and adding same-region helpers before it, not changing its name or proposition.",
        "- You may edit text inside the proof_region begin/end markers, including adding sibling helper have/assert/pose statements before the target have/assert.",
        "- You must not edit text before the editable region or after it.",
        "- The theorem-level terminator is outside the editable region and must not be changed by the lemma agent.",
        item.obligation?.target_name
          ? `- The exported target remains ${item.obligation.target_name}; if that target is wrong, return escalation_type=needs_subgoal_remodel instead of changing theorem-level spine.`
          : "- If the assigned target is wrong, return escalation_type=needs_subgoal_remodel instead of changing theorem-level spine.",
      ]
    : []
  const obligation = item.obligation
    ? [
        "",
        "Obligation metadata:",
        `- kind: ${item.obligation.kind}`,
        item.obligation.proof_plan_node ? `- proof_plan_node: ${item.obligation.proof_plan_node}` : undefined,
        item.obligation.target_name ? `- target_name: ${item.obligation.target_name}` : undefined,
        item.obligation.target_statement ? `- target_statement: ${item.obligation.target_statement}` : undefined,
        item.obligation.expected_proof_kind ? `- expected_proof_kind: ${item.obligation.expected_proof_kind}` : undefined,
        item.obligation.dependencies.length > 0 ? `- dependencies: ${item.obligation.dependencies.join(", ")}` : undefined,
        item.obligation.source ? `- source: ${item.obligation.source}` : undefined,
        (item.obligation.input?.length ?? 0) > 0 ? `- input: ${item.obligation.input!.join(", ")}` : undefined,
        item.obligation.output ? `- output: ${item.obligation.output}` : undefined,
        item.obligation.layer ? `- layer: ${item.obligation.layer}` : undefined,
        item.obligation.expected ? `- expected: ${item.obligation.expected}` : undefined,
        item.obligation.target_normal_form ? `- target_normal_form: ${item.obligation.target_normal_form}` : undefined,
        (item.obligation.prosa_candidate_lemmas?.length ?? 0) > 0 ? `- prosa_candidate_lemmas: ${item.obligation.prosa_candidate_lemmas!.join(", ")}` : undefined,
        (item.obligation.mathcomp_candidate_lemmas?.length ?? 0) > 0 ? `- mathcomp_candidate_lemmas: ${item.obligation.mathcomp_candidate_lemmas!.join(", ")}` : undefined,
        (item.obligation.shape_evidence?.length ?? 0) > 0 ? `- shape_evidence: ${item.obligation.shape_evidence!.join(", ")}` : undefined,
        item.obligation.locality_check
          ? `- locality_check: ${JSON.stringify(item.obligation.locality_check)}`
          : undefined,
      ].filter((line): line is string => Boolean(line))
    : []
  return [
    "<lemma-assignment>",
    `file: ${item.file}`,
    `theorem: ${item.theorem}`,
    `admit_id: ${item.admit_id}`,
    `goal: ${item.goal}`,
    `replace_contract: ${item.replace}`,
    "local_skeleton:",
    item.skeleton,
    `completion_contract: ${item.done}`,
    ...obligation,
    ...editableRegion,
    "Rules:",
    "- This task owns exactly one assigned proof_region, identified by admit_id.",
    "- The purpose of this assignment is to help finish the target theorem proof and make the file compile; all local actions must be proof-producing or directly prepare the next proof-producing edit.",
    "- Treat any source/input/output/layer/expected comments in the skeleton as the binding node contract for this assignment.",
    "- Treat the exported target statement and target_name as the main prover's intended subgoal; preserve them whenever possible, and escalate with needs_subgoal_remodel if they are wrong rather than silently rewriting the contract.",
    "- If layer=semantic, close the assigned mathematical bridge without changing the outer spine. If layer=shape, perform only the requested target-shape transport, library instantiation, witness movement, uniqueness/injectivity step, contradiction close, or arithmetic close.",
    "- Replace or update the complete assigned proof_region with a complete proof for its exported target and any same-region helpers.",
    "- Do not discharge sibling regions or batch multiple proof_regions into one lemma session.",
    "- Preserve the surrounding theorem skeleton, sibling proof_regions, and proof order unless the assignment itself says otherwise.",
    "- For status=solved, proof_text should contain the complete updated assigned proof_region for merge review; the edited .v file and editable_region boundary are the source of truth.",
    "- Do not change theorem-level terminators such as `Admitted.` or `Qed.`; the prover performs final merge and final validation after all regions are solved.",
    "- Large local assignments are allowed: solve them by running a long interactive proof loop inside this block, not by widening ownership.",
    "- Do not use the task tool to call another lemma subagent. If the local proof splits, keep the child obligation in this same lemma session and return status=split only for the single immediate next blocker under the same admit_id.",
    "- Inside the assigned proof_region, use strict prefix-hole order: do not edit or fill a later have/assert/suff proof block while an earlier admit or empty `{}` remains unresolved and unvalidated.",
    "- A failed validation still permits and expects edits inside the current first unresolved block; repair that block before any broad lookup or escalation. Avoid both read-only stalling and disconnected proof edits.",
    "- Preserve existing proof-block braces as partition boundaries; solve the current block by inserting proof text inside `{ ... }`.",
    "- Do not escalate merely because the proof is long, brittle, or difficult to find; escalation must cite concrete evidence such as a stable blocked goal, missing premise, failed local bridge attempt, wrong target shape, or non-local dependency.",
    "- Use persistent Coq/LSP tools (`coq_session`, `petanque`, `lsp proofGoals`) to validate small proof steps before committing large scripts.",
    "- Do not use `rewrite !...` or `rewrite -!...`; write repeated rewrites explicitly one step at a time or introduce a named normalization bridge.",
    "- Do not use the `intuition` tactic; it generates opaque proof terms and is rejected. Use explicit tactics (`left`/`right`/`split`/`apply`/`exact`) instead.",
    "- If you escalate with needs_context_strengthening, it means an explicit bridge must be derived and threaded from existing hypotheses; do not request new section-level, theorem-level, or global assumptions.",
    "- Use `coq_session inspect` before needs_context_strengthening only when the escalation specifically depends on hidden arguments, Section/Module instantiation, implicit arguments, or alias normalization; do not make this audit a generic prerequisite for other context blockers.",
    "- For that narrow case, record attempt_report.context_mismatch_basis and copy the returned context_audit metadata exactly. A convertible or inconclusive/missing audit triggers at most one targeted same-session retry; after that retry, structured escalation is still allowed. Verified non-convertibility plus attempt_report.failed_local_bridge may escalate immediately.",
    "- If you escalate, include escalation_type. Use needs_subgoal_remodel with a remodel_request when the assigned target statement or region shape is wrong.",
    "</lemma-assignment>",
    "",
    prompt,
  ].join("\n")
}

function extractProofResult(text: string) {
  const jsonMatch = text.match(/<proof_result>\s*([\s\S]*?)\s*<\/proof_result>/)
  if (!jsonMatch) return undefined

  try {
    const parsed = JSON.parse(jsonMatch[1])
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {}

  return undefined
}

function proofResultSummary(result: ProofResult, runtime?: LemmaTaskRuntime, currentStep?: number) {
  const orderedChildren = [...result.children].sort((left, right) => left.suggested_order - right.suggested_order)
  return {
    status: result.status,
    goal_id: result.goal_id,
    parent_goal_id: result.parent_goal_id,
    split_required: result.split_required,
    child_count: result.children.length,
    child_order: orderedChildren.map((child) => `${child.suggested_order}:${child.child_id_hint}`),
    stack_mode: result.stack_mode,
    recursion_depth: result.recursion_depth ?? runtime?.recursion_depth,
    max_recursion_depth: result.max_recursion_depth ?? runtime?.max_recursion_depth,
    current_step: currentStep,
    escalate_reason: result.escalate_reason || undefined,
    escalation_type: result.escalation_type,
    remodel_request: result.remodel_request,
    attempt_report: result.attempt_report,
    changed_region_summary: result.changed_region_summary,
  }
}

function contextAuditReview(proofResult: ReturnType<typeof inspectProofResult> | undefined, sessionID: string) {
  if (!proofResult?.validation.valid) return undefined
  const normalized = proofResult.normalized as ProofResult
  if (!normalized || normalized.status !== "escalate" || normalized.escalation_type !== "needs_context_strengthening") {
    return undefined
  }

  const report = normalized.attempt_report
  const submitted = report?.context_audit
  const recorded = submitted?.audit_id
    ? findContextNormalizationAudit(sessionID, submitted.audit_id)
    : undefined
  const verifiedAudit = recorded
    ? { ...recorded, verified: true }
    : submitted
      ? { ...submitted, verified: false }
      : undefined
  const applicable = Boolean(
    report?.context_mismatch_basis && report.context_mismatch_basis !== "other",
  )

  if (report && verifiedAudit) {
    const updatedReport = { ...report, context_audit: verifiedAudit }
    proofResult.normalized.attempt_report = updatedReport
    if (proofResult.summary) proofResult.summary.attempt_report = updatedReport
  }

  const action = !applicable
    ? "accept_structured_escalation"
    : recorded?.outcome === "not_convertible" && report?.failed_local_bridge?.trim()
      ? "accept_with_verified_nonconvertibility"
      : "resume_once_for_targeted_local_evidence"

  return {
    applicable,
    audit_id: submitted?.audit_id,
    verified: Boolean(recorded),
    outcome: recorded?.outcome ?? submitted?.outcome,
    failed_local_bridge: Boolean(report?.failed_local_bridge?.trim()),
    action,
  }
}

function inspectProofResult(raw: Record<string, unknown>, runtime?: LemmaTaskRuntime, currentStep?: number) {
  const parsed = proofResultSchema.safeParse(raw)
  const errors = parsed.success
    ? []
    : parsed.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""
        return path + issue.message
      })

  if (parsed.success && runtime) {
    if (parsed.data.status === "split" && runtime.recursion_depth >= runtime.max_recursion_depth) {
      errors.push("status=split is not allowed at or beyond the configured max recursion depth")
    }
    if (parsed.data.children.length > runtime.max_children) {
      errors.push(`children must contain at most ${runtime.max_children} items`)
    }
  }

  if (!parsed.success) {
    return {
      normalized: raw,
      validation: { valid: false, errors },
      summary: undefined,
    }
  }

  const normalized = {
    ...parsed.data,
    recursion_depth: parsed.data.recursion_depth ?? runtime?.recursion_depth,
    max_recursion_depth: parsed.data.max_recursion_depth ?? runtime?.max_recursion_depth,
  }

  return {
    normalized,
    validation: { valid: errors.length === 0, errors },
    summary: proofResultSummary(normalized, runtime, currentStep),
  }
}

function proofResultTrace(input: {
  parentSessionID: string
  taskID: string
  assignment?: LemmaAssignment
  structured?: Record<string, unknown>
  proofResult?: ReturnType<typeof inspectProofResult>
}) {
  if (!input.structured) return undefined
  const summary = input.proofResult?.summary
  const validation = input.proofResult?.validation
  return {
    parent_session_id: input.parentSessionID,
    task_id: input.taskID,
    admit_id: input.assignment?.admit_id,
    theorem: input.assignment?.theorem,
    obligation_kind: input.assignment?.obligation?.kind,
    locality_check: input.assignment?.obligation?.locality_check,
    editable_region_mode: input.assignment?.editable_region?.mode,
    editable_region_lines: input.assignment?.editable_region
      ? {
          start_line: input.assignment.editable_region.start_line,
          end_line: input.assignment.editable_region.end_line,
        }
      : undefined,
    proof_result_valid: validation?.valid ?? false,
    validation_errors: validation?.errors ?? [],
    status: summary?.status ?? input.structured.status,
    escalation_type: summary?.escalation_type,
    remodel_request: summary?.remodel_request,
    attempt_report: summary?.attempt_report,
    changed_region_summary: summary?.changed_region_summary,
  }
}

export const TaskTool = Tool.define("task", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  // Filter agents by permissions if agent provided
  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => PermissionNext.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents

  const description = DESCRIPTION.replace(
    "{agents}",
    accessibleAgents
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const config = await Config.get()

      if (ctx.agent === "lemma" && params.subagent_type === "lemma") {
        throw new Error(
          "lemma agents must not launch child lemma subagents; split child obligations inside the current proof_region and return status=split if the same lemma session needs to be resumed",
        )
      }

      if (params.subagent_type === "lemma" && !params.task_id && !params.lemma_assignment) {
        throw new Error(
          "fresh lemma tasks require lemma_assignment with file, theorem, admit_id, goal, replace, skeleton, and done",
        )
      }

      if (ctx.agent === "prover" && params.subagent_type === "lemma" && !params.task_id) {
        const parts = await MessageV2.parts(ctx.messageID)
        const sibling = parts.some((part) => {
          if (part.type !== "tool" || part.tool !== "task" || part.callID === ctx.callID) return false
          const input = part.state.input
          if (!input || typeof input !== "object") return false
          return "subagent_type" in input && input.subagent_type === "lemma"
        })
        if (sibling) {
          throw new Error(
            "launch only one fresh lemma task per assistant turn; wait for that admit result before dispatching the next lemma task",
          )
        }

        if (!params.lemma_assignment) {
          throw new Error("fresh lemma delegation from prover requires lemma_assignment")
        }

        const assignmentFile = resolveWorkspaceFile(params.lemma_assignment.file)
        ProofEditTransaction.assertStagedReadSynchronized(
          ctx.sessionID,
          assignmentFile,
          `delegating proof_region ${params.lemma_assignment.admit_id}`,
        )
        const stagedParentSource = ProofEditTransaction.source(ctx.sessionID, assignmentFile)
        params.lemma_assignment = await SessionProofWorkflow.assertFreshLemmaAssignmentLocality(
          ctx.sessionID,
          assignmentFile,
          params.lemma_assignment,
          stagedParentSource,
        )
        await assertProverLemmaDelegationReadiness(ctx.sessionID, params.lemma_assignment, stagedParentSource)
      }

      if (params.proof_repair_assignment) {
        const assignmentFile = resolveWorkspaceFile(params.proof_repair_assignment.file)
        ProofEditTransaction.assertStagedReadSynchronized(
          ctx.sessionID,
          assignmentFile,
          `dispatching theorem repair ${params.proof_repair_assignment.admit_id}`,
        )
        const stagedParentSource = ProofEditTransaction.source(ctx.sessionID, assignmentFile)
        params.proof_repair_assignment = await SessionProofWorkflow.assertRepairAssignmentCurrent(
          ctx.sessionID,
          assignmentFile,
          params.proof_repair_assignment,
          stagedParentSource,
        )
      }

      const agent = await Agent.get(params.subagent_type)
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      const proofDispatch = await SessionProofWorkflow.assertProofTaskDispatchAllowed({
        sessionID: ctx.sessionID,
        subagentType: agent.name,
        proofProducing: PROOF_PRODUCING_AGENTS.has(agent.name),
        lemmaAssignment: params.lemma_assignment,
        proofRepairAssignment: params.proof_repair_assignment,
      })

      // Skip permission check when user explicitly invoked via @ or command subtask
      if (!ctx.extra?.bypassAgentCheck) {
        await ctx.ask({
          permission: "task",
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const canUseTaskTool = PermissionNext.evaluate("task", "*", agent.permission).action !== "deny"

      const session = await iife(async () => {
        if (params.task_id) {
          const found = await Session.get(params.task_id).catch(() => {})
          if (found) return found
        }

        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent)`,
          permission: [
            {
              permission: "todowrite",
              pattern: "*",
              action: "deny",
            },
            {
              permission: "todoread",
              pattern: "*",
              action: "deny",
            },
            ...(canUseTaskTool
              ? []
              : [
                  {
                    permission: "task" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(config.experimental?.primary_tools?.map((t) => ({
              pattern: "*",
              action: "allow" as const,
              permission: t,
            })) ?? []),
          ],
        })
      })
      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      // Propagate parent's proof binding to child session, then pin lemma tasks to their assigned local gap.
      SessionProof.inherit(ctx.sessionID, session.id)
      SessionProofWorkflow.inheritBoundProofScope(ctx.sessionID, session.id)
      if (PROOF_PRODUCING_AGENTS.has(agent.name)) {
        SessionProofWorkflow.bindProofTaskWorker(session.id, agent.name)
      }
      if (params.proof_repair_assignment) {
        SessionProofWorkflow.bindActiveRepair(session.id, params.proof_repair_assignment, ctx.sessionID)
      }
      if (agent.name === "lemma" && params.lemma_assignment) {
        const assignmentFile = path.isAbsolute(params.lemma_assignment.file)
          ? params.lemma_assignment.file
          : path.resolve(Instance.directory, params.lemma_assignment.file)
        const validatedSource = ProofEditTransaction.source(ctx.sessionID, assignmentFile) ??
          (await Filesystem.exists(assignmentFile) ? await Filesystem.readText(assignmentFile) : undefined)
        bindLemmaProofContext(session.id, params.lemma_assignment, validatedSource)
        SessionProofWorkflow.bindActiveLemmaAssignment(
          session.id,
          params.lemma_assignment,
          validatedSource,
          params.task_id ? "resume" : "fresh",
          ctx.sessionID,
        )
      }

      const model = agent.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      const lemmaRuntime = agent.name === "lemma" ? await lemmaTaskRuntime(session.id, ctx.agent) : undefined
      const proofScope = proofScopeMetadata(agent.name, Boolean(params.lemma_assignment), params.proof_repair_assignment)

      ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
          ...proofScope,
          ...(params.subagent_type === "lemma" && params.lemma_assignment
            ? { lemma_assignment: params.lemma_assignment }
            : {}),
          ...(params.proof_repair_assignment ? { proof_repair_assignment: params.proof_repair_assignment } : {}),
          proof_task_dispatch: proofDispatch,
          ...(lemmaRuntime ? { lemma_runtime: lemmaRuntime } : {}),
        },
      })

      const messageID = Identifier.ascending("message")

      function cancel() {
        SessionPrompt.cancel(session.id)
      }
      ctx.abort.addEventListener("abort", cancel)
      using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))
      const scopedPrompt =
        agent.name === "lemma" && params.lemma_assignment ? withLemmaAssignment(params.prompt, params.lemma_assignment) : params.prompt
      const proofEditTransactionStart = PROOF_PRODUCING_AGENTS.has(agent.name)
        ? await beginProofEditTransaction({
            sessionID: session.id,
            parentSessionID: ctx.sessionID,
            agent: agent.name,
            lemmaAssignment: params.lemma_assignment,
            repairAssignment: params.proof_repair_assignment,
          })
        : undefined
      const proofEditTransactionFinalizeOptions =
        params.lemma_assignment || params.proof_repair_assignment || proofEditTransactionStart?.handed_off
          ? {
              handoffToSessionID: ctx.sessionID,
              // A child owns a narrow region while it runs, but its staged
              // revision must remain authoritative for parent-side outcome
              // validation and follow-up scheduling after the child returns.
              ...(params.lemma_assignment
                ? {
                    handoffScope: {
                      kind: "theorem_body" as const,
                      theorem: params.lemma_assignment.theorem,
                    },
                  }
                : {}),
            }
          : undefined
      let proofEditTransactionFinalized = false
      await using proofEditTransactionCleanup = defer(async () => {
        if (proofEditTransactionStart && !proofEditTransactionFinalized) {
          await ProofEditTransaction.finalize(session.id, proofEditTransactionFinalizeOptions)
        }
      })
      const runtimePrompt = lemmaRuntime ? withLemmaRuntimeGuardrail(scopedPrompt, lemmaRuntime) : scopedPrompt
      const transactionPrompt = withProofEditTransactionRecovery(runtimePrompt, proofEditTransactionStart)
      let repairHandoff: unknown
      if (params.proof_repair_assignment) {
        const repairFile = resolveWorkspaceFile(params.proof_repair_assignment.file)
        const stagedSource = ProofEditTransaction.source(session.id, repairFile) ??
          (await Filesystem.exists(repairFile) ? await Filesystem.readText(repairFile) : undefined)
        if (stagedSource !== undefined) {
          const liveProofState = currentCoqProofState(ctx.sessionID)
          const liveProofStateMatchesBaseline = Boolean(
            liveProofState &&
            proofEditTransactionStart &&
            liveProofState.source_hash === proofEditTransactionStart.source_hash,
          )
          repairHandoff = {
            ...SessionProofWorkflow.buildRepairHandoff({
              sessionID: ctx.sessionID,
              file: repairFile,
              source: stagedSource,
              assignment: params.proof_repair_assignment,
            }),
            transaction: proofEditTransactionStart,
            live_proof_state: liveProofStateMatchesBaseline ? liveProofState : undefined,
            live_proof_state_mismatch:
              liveProofState && proofEditTransactionStart && !liveProofStateMatchesBaseline
                ? {
                    reason:
                      "The parent Coq session belongs to a different source revision. Reopen the staged region and establish a new goal fingerprint before submitting tactics.",
                    parent_source_hash: liveProofState.source_hash,
                    transaction_source_hash: proofEditTransactionStart.source_hash,
                  }
                : undefined,
          }
        }
      }
      const promptText = withProofRepairHandoff(transactionPrompt, repairHandoff)
      const promptParts = await SessionPrompt.resolvePromptParts(promptText)

      let result: Awaited<ReturnType<typeof SessionPrompt.prompt>>
      try {
        result = await SessionPrompt.prompt({
          messageID,
          sessionID: session.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          agent: agent.name,
          tools: {
            todowrite: false,
            todoread: false,
            ...(canUseTaskTool ? {} : { task: false }),
            ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
          },
          parts: promptParts,
        })
      } catch (error) {
        // A successfully certified snapshot is still worth committing if the
        // child later fails while formatting its final response. Uncertified
        // lemma edits are also handed back to the parent transaction journal
        // so a timeout or malformed response cannot erase hours of staged
        // proof work or trigger a duplicate fresh dispatch from disk.
        await ProofEditTransaction.finalize(session.id, proofEditTransactionFinalizeOptions)
        proofEditTransactionFinalized = true
        throw error
      }

      const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
      const lemmaCurrentStep = agent.name === "lemma" ? await Trace.currentStep(session.id) : undefined

      // Extract structured proof result if present in subagent output
      const structured = extractProofResult(text)
      const proofResult = structured ? inspectProofResult(structured, lemmaRuntime, lemmaCurrentStep) : undefined
      const auditReview = contextAuditReview(proofResult, session.id)
      const proofTrace = proofResultTrace({
        parentSessionID: ctx.sessionID,
        taskID: session.id,
        assignment: params.lemma_assignment,
        structured,
        proofResult,
      })
      if (proofTrace) await Trace.event(ctx.sessionID, "lemma-proof-result", proofTrace)

      // Extract fixer subagent structured output
      const fixMatch = text.match(/<fix>\s*([\s\S]*?)\s*<\/fix>/)
      const escalateMatch = text.match(/<escalate>\s*([\s\S]*?)\s*<\/escalate>/)
      const fixer = fixMatch
        ? { action: "fix" as const, detail: fixMatch[1].trim() }
        : escalateMatch
          ? { action: "escalate" as const, detail: escalateMatch[1].trim() }
          : undefined

      // Extract diagnoser subagent structured output
      let diagnosis: Record<string, unknown> | undefined
      const diagnosisMatch = text.match(/<diagnosis>\s*([\s\S]*?)\s*<\/diagnosis>/)
      if (diagnosisMatch) {
        try {
          diagnosis = JSON.parse(diagnosisMatch[1])
        } catch {}
      }

      const proofEditTransaction = await ProofEditTransaction.finalize(
        session.id,
        proofEditTransactionFinalizeOptions,
      )
      proofEditTransactionFinalized = true

      const validationBlock =
        proofResult && !proofResult.validation.valid
          ? [
              "",
              "<proof_result_validation_error>",
              ...proofResult.validation.errors,
              "</proof_result_validation_error>",
            ].join("\n")
          : ""

      const output = [
        `task_id: ${session.id} (for resuming to continue this task if needed)`,
        "",
        "<task_result>",
        text,
        "</task_result>",
        validationBlock,
      ].join("\n")

      return {
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
          ...proofScope,
          ...(params.subagent_type === "lemma" && params.lemma_assignment
            ? { lemma_assignment: params.lemma_assignment }
            : {}),
          ...(params.proof_repair_assignment ? { proof_repair_assignment: params.proof_repair_assignment } : {}),
          proof_task_dispatch: proofDispatch,
          ...(lemmaRuntime ? { lemma_runtime: lemmaRuntime } : {}),
          ...(structured ? { proof_result: proofResult?.normalized ?? structured } : {}),
          ...(proofResult ? { proof_result_validation: proofResult.validation } : {}),
          ...(proofResult?.summary ? { proof_result_summary: proofResult.summary } : {}),
          ...(auditReview ? { context_audit_review: auditReview } : {}),
          ...(proofTrace ? { proof_result_trace: proofTrace } : {}),
          ...(proofEditTransactionStart ? { proof_edit_transaction_start: proofEditTransactionStart } : {}),
          ...(proofEditTransaction ? { proof_edit_transaction: proofEditTransaction } : {}),
          ...(fixer ? { fixer } : {}),
          ...(diagnosis ? { diagnosis } : {}),
        },
        output,
      }
    },
  }
})
