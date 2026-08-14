import { Database, eq } from "@/storage/db"
import { Filesystem } from "@/util/filesystem"
import z from "zod"
import { createHash } from "crypto"
import { rm } from "fs/promises"
import { LSP } from "@/lsp"
import path from "path"
import * as CoqProject from "@/tool/coq-project"
import { assertNoRewriteBangInCoqFile, assertNoIntuitionInCoqFile } from "@/tool/coq-style-guard"
import {
  BlockedProofReportSchema,
  EscalationType,
  LemmaAssignmentSchema,
  ObligationKind,
  RemodelRequestSchema,
  type BlockedProofReport,
  type LemmaAssignment,
  type RemodelRequest,
} from "./lemma-assignment"
import { MessageV2 } from "./message-v2"
import { SessionProof } from "./session-proof"
import { SessionProofWorkflowTable } from "./session-proof-workflow.sql"
import { ProofRouteLedger } from "./proof-route-ledger"
import { ProofEditTransaction } from "./proof-edit-transaction"
import { Instance } from "@/project/instance"
import { parseCoqCompilerOutput } from "@/tool/coq-diagnostics"
import { Log } from "@/util/log"
import {
  MAX_SEMANTIC_PLAN_REVISIONS,
  ProofPlan,
  ProofPlanReview,
  type ProofPlan as ProofPlanValue,
  type ProofPlanReview as ProofPlanReviewValue,
} from "@/tool/proof-schema"

export namespace SessionProofWorkflow {
  const log = Log.create({ service: "proof-workflow" })
  const MAX_PLAN_RECOVERY_GENERATIONS = 1

  export function decompositionModeEnabled() {
    const mode = process.env.OPENCODE_PROOF_WORKFLOW_MODE?.trim()
    return mode === "decomposition" || mode === "prooftex_structured_workflow"
  }

  export const BlockOwner = z.enum(["lemma"])
  export type BlockOwner = z.infer<typeof BlockOwner>

  export const BlockStatus = z.enum(["pending", "running", "split", "unvalidated", "solved", "escalated"])
  export type BlockStatus = z.infer<typeof BlockStatus>

  export const ValidationCertificate = z.object({
    normalized_file: z.string().min(1),
    source_hash: z.string().min(1),
    admit_id: z.string().min(1),
    region_fingerprint: z.string().min(1),
    compiler_signature: z.string().min(1),
    validator: z.enum(["coqc", "checkpoint", "checkpoint-coqc"]),
    validated_at: z.number().int().positive(),
  })
  export type ValidationCertificate = z.infer<typeof ValidationCertificate>

  export const ValidationFailure = z.object({
    source_hash: z.string().min(1),
    compiler_signature: z.string().min(1),
    validator: z.enum(["coqc", "checkpoint", "checkpoint-coqc"]),
    first_error_file: z.string().optional(),
    first_error_line: z.number().int().positive().optional(),
    message: z.string().optional(),
    recorded_at: z.number().int().positive(),
  })
  export type ValidationFailure = z.infer<typeof ValidationFailure>

  export const ProofRegionLifecycleTransition = z.object({
    action: z.enum(["certified", "invalidated", "source_changed", "unchanged", "unmapped_failure"]),
    admit_id: z.string().optional(),
    old_status: BlockStatus.optional(),
    new_status: BlockStatus.optional(),
    compiler_signature: z.string(),
    next_action: z.string(),
    affected_sessions: z.number().int().nonnegative(),
  })
  export type ProofRegionLifecycleTransition = z.infer<typeof ProofRegionLifecycleTransition>

  export const ProofProgressReceiptKind = z.enum([
    "region_certified",
    "missing_premise_certified",
    "semantic_debt_reduced",
    "locality_validated_split",
    "first_error_advanced",
    "final_qed",
  ])
  export type ProofProgressReceiptKind = z.infer<typeof ProofProgressReceiptKind>

  export const ProofProgressLevel = z.enum(["hard", "structural", "debug"])
  export type ProofProgressLevel = z.infer<typeof ProofProgressLevel>

  export const ProofErrorAnchor = z.object({
    theorem: z.string().min(1),
    scope: z.string().min(1),
    region_order: z.number().int().nonnegative(),
    sentence_index: z.number().int().nonnegative(),
    sentence_fingerprint: z.string().min(1).optional(),
    line: z.number().int().positive().optional(),
    normalized_error: z.string(),
  })
  export type ProofErrorAnchor = z.infer<typeof ProofErrorAnchor>

  export const ProofProgressReceipt = z.object({
    id: z.string().min(1),
    kind: ProofProgressReceiptKind,
    level: ProofProgressLevel,
    theorem: z.string().min(1),
    theorem_context_fingerprint: z.string().min(1),
    source_fingerprint: z.string().min(1),
    before_unresolved_semantic_debt: z.number().int().nonnegative().optional(),
    after_unresolved_semantic_debt: z.number().int().nonnegative().optional(),
    certified_semantic_debt_count: z.number().int().nonnegative().optional(),
    admit_id: z.string().min(1).optional(),
    compiler_signature: z.string().min(1).optional(),
    split_fingerprint: z.string().min(1).optional(),
    first_error_before: ProofErrorAnchor.optional(),
    first_error_after: ProofErrorAnchor.optional(),
    recorded_at: z.number().int().positive(),
  })
  export type ProofProgressReceipt = z.infer<typeof ProofProgressReceipt>

  export const Phase = z.enum(["architect", "delegating", "prover", "complete"])
  export type Phase = z.infer<typeof Phase>

  export const QueueItem = z.object({
    order: z.number().int().positive(),
    owner: BlockOwner,
    theorem: z.string().min(1),
    admit_id: z.string().min(1),
    start_line: z.number().int().positive(),
    end_line: z.number().int().positive(),
    status: BlockStatus,
    task_id: z.string().optional(),
    kind: ObligationKind.default("unknown"),
    target_name: z.string().optional(),
    editable_mode: z.literal("region").default("region"),
    region_start_line: z.number().int().positive().optional(),
    region_end_line: z.number().int().positive().optional(),
    escalation_type: EscalationType.optional(),
    escalation_reason: z.string().optional(),
    remodel_request: RemodelRequestSchema.optional(),
    attempt_report: BlockedProofReportSchema.optional(),
    region_fingerprint: z.string().optional(),
    proof_plan_node: z.string().optional(),
    depends_on: z.array(z.string()).default([]),
    validation_certificate: ValidationCertificate.optional(),
    validation_failure: ValidationFailure.optional(),
    context_audit_resume_count: z.number().int().nonnegative().optional(),
    context_audit_feedback: z.string().optional(),
    running_started_at: z.number().int().positive().optional(),
    running_lease_expires_at: z.number().int().positive().optional(),
    running_release_reason: z.string().optional(),
    takeover_agent: z.string().optional(),
    takeover_reason: z.string().optional(),
    takeover_at: z.number().int().positive().optional(),
  })
  export type QueueItem = z.infer<typeof QueueItem>

  export const LatestEscalation = z.object({
    admit_id: z.string().min(1),
    escalation_type: EscalationType,
    reason: z.string(),
    remodel_request: RemodelRequestSchema.optional(),
    attempt_report: BlockedProofReportSchema.optional(),
    task_id: z.string().optional(),
    updated: z.number(),
  })
  export type LatestEscalation = z.infer<typeof LatestEscalation>

  export const ProofRepairAssignment = z.object({
    file: z.string(),
    theorem: z.string().min(1),
    admit_id: z.string().min(1),
    escalation_type: EscalationType,
    reason: z.string(),
    region_start_line: z.number().int().positive().optional(),
    region_end_line: z.number().int().positive().optional(),
    region_fingerprint: z.string().optional(),
    original_unresolved: z.boolean().optional(),
    theorem_fingerprint: z.string().optional(),
    theorem_structure_fingerprint: z.string().optional(),
    source_fingerprint: z.string().optional(),
    unfinished_baseline: z.number().int().nonnegative().optional(),
    accepted_progress_baseline_at: z.number().int().positive().optional(),
    continuation_count: z.number().int().nonnegative().optional(),
    last_assessed_task_at: z.number().int().positive().optional(),
    last_outcome: z
      .enum([
        "assigned_obligation_solved",
        "accepted_theorem_progress",
        "remodel_pending_validation",
        "syntax_or_cosmetic_only",
        "structured_escalation",
      ])
      .optional(),
    remodel_request: RemodelRequestSchema.optional(),
    attempt_report: BlockedProofReportSchema.optional(),
  })
  export type ProofRepairAssignment = z.infer<typeof ProofRepairAssignment>

  export const FallbackGuard = z.object({
    blocker_admit_id: z.string().min(1),
    theorem_fingerprint: z.string(),
    source_fingerprint: z.string().optional(),
    region_fingerprint: z.string().optional(),
    dispatch_lock_scope: z.enum(["cross_session", "repair_child_yield"]).optional(),
    passive_lookup_streak: z.number().int().nonnegative(),
    last_target_edit_at: z.number().int().positive().optional(),
    last_accepted_progress_at: z.number().int().positive().optional(),
    tripped_at: z.number().int().positive().optional(),
    reason: z.string().optional(),
  })
  export type FallbackGuard = z.infer<typeof FallbackGuard>

  export const RepairIncident = z.object({
    signature: z.string().min(1),
    theorem: z.string().min(1),
    escalation_type: EscalationType,
    reason: z.string().min(1),
    source_fingerprint: z.string().optional(),
    first_admit_id: z.string().min(1),
    last_admit_id: z.string().min(1),
    repeat_count: z.number().int().nonnegative(),
    first_seen_at: z.number().int().positive(),
    updated_at: z.number().int().positive(),
  })
  export type RepairIncident = z.infer<typeof RepairIncident>

  export const RepairIncidentResolution = z.object({
    signature: z.string().min(1),
    theorem: z.string().min(1),
    resolved_at: z.number().int().positive(),
  })
  export type RepairIncidentResolution = z.infer<typeof RepairIncidentResolution>

  export const DecompositionMaterializationReview = z.object({
    status: z.enum(["matched", "partial", "drifted"]),
    plan_semantic_fingerprint: z.string().min(1),
    source_hash: z.string().min(1),
    theorem_source_hash: z.string().min(1).optional(),
    expected_plan_nodes: z.array(z.string()),
    observed_plan_nodes: z.array(z.string()),
    missing_plan_nodes: z.array(z.string()),
    duplicate_plan_nodes: z.array(z.string()),
    unexpected_regions: z.array(z.string()),
    dependency_mismatches: z.array(
      z.object({
        plan_node: z.string().min(1),
        expected: z.array(z.string()),
        observed: z.array(z.string()),
      }),
    ),
    metadata_mismatches: z.array(z.string()),
    reviewed_at: z.number().int().positive(),
  })
  export type DecompositionMaterializationReview = z.infer<typeof DecompositionMaterializationReview>

  export const DecompositionPlanStatus = z.enum(["planning", "accepted", "exhausted"])
  export type DecompositionPlanStatus = z.infer<typeof DecompositionPlanStatus>

  export const DecompositionTerminalVerdict = z.object({
    status: z.literal("semantic_incomplete"),
    source_hash: z.string().min(1),
    theorem_source_hash: z.string().min(1),
    semantic_fingerprint: z.string().min(1),
    blockers: z.array(z.string()),
    recoverable: z.boolean().optional(),
    planning_generation: z.number().int().nonnegative().optional(),
    failure_fingerprint: z.string().min(1).optional(),
    best_semantic_fingerprint: z.string().min(1).optional(),
    evaluated_at: z.number().int().positive(),
  })
  export type DecompositionTerminalVerdict = z.infer<typeof DecompositionTerminalVerdict>

  export const DecompositionPlanAction = z.enum([
    "materialize_once",
    "materialize_accepted_plan",
    "revise_semantic_dag",
    "repair_plan_route",
    "repair_plan_metadata",
    "do_not_retry_metadata_only_plan",
    "start_new_plan_generation",
    "stop_and_report_best_plan",
  ])
  export type DecompositionPlanAction = z.infer<typeof DecompositionPlanAction>

  export const DecompositionPlanState = z.object({
    file: z.string().min(1),
    theorem: z.string().min(1),
    root_goal: z.string().min(1),
    source_hash_before_materialization: z.string().min(1),
    attempted_semantic_fingerprints: z.array(z.string().min(1)),
    semantic_revision_number: z.number().int().nonnegative(),
    planning_generation: z.number().int().nonnegative().optional(),
    generation_failure_fingerprints: z.array(z.string().min(1)).optional(),
    status: DecompositionPlanStatus,
    last_candidate_plan: ProofPlan,
    last_review: ProofPlanReview,
    best_rejected_plan: ProofPlan.optional(),
    best_rejected_review: ProofPlanReview.optional(),
    accepted_plan: ProofPlan.optional(),
    accepted_semantic_fingerprint: z.string().min(1).optional(),
    accepted_at: z.number().int().positive().optional(),
    exhausted_at: z.number().int().positive().optional(),
    theorem_source_hash_before_materialization: z.string().min(1).optional(),
    repair_revision_number: z.number().int().nonnegative().optional(),
    repair_revision_reason: z.string().min(1).optional(),
    administrative_reconciliation_count: z.number().int().nonnegative().optional(),
    materialization_review: DecompositionMaterializationReview.optional(),
    terminal_verdict: DecompositionTerminalVerdict.optional(),
    updated: z.number().int().positive(),
  })
  export type DecompositionPlanState = z.infer<typeof DecompositionPlanState>

  export const State = z.object({
    file: z.string(),
    phase: Phase,
    queue: z.array(QueueItem),
    active_admit_id: z.string().optional(),
    active_task_id: z.string().optional(),
    latest_escalation: LatestEscalation.optional(),
    active_repair: ProofRepairAssignment.optional(),
    fallback_guard: FallbackGuard.optional(),
    repair_incidents: z.array(RepairIncident).optional(),
    repair_incident_resolutions: z.array(RepairIncidentResolution).optional(),
    decomposition_plan: DecompositionPlanState.optional(),
    last_progress_receipt: ProofProgressReceipt.optional(),
    last_structural_progress_receipt: ProofProgressReceipt.optional(),
    last_debug_progress_receipt: ProofProgressReceipt.optional(),
    updated: z.number(),
  })
  export type State = z.infer<typeof State>

  export interface ParsedBlock {
    owner: BlockOwner
    theorem: string
    admit_id: string
    order: number
    headerStart: number
    blockStart: number
    startLine: number
    endLine: number
    endIndex: number
    headerText: string
    blockText: string
    pending: boolean
    kind: ObligationKind
    targetName?: string
    targetStatement?: string
    proofPlanNode?: string
    dependsOn: string[]
    dependsOnDeclared: boolean
    sourceRef?: string
    inputRefs: string[]
    outputRef?: string
    layer?: string
    expected?: string
    targetNormalForm?: string
    shapeEvidence: string[]
    prosaCandidateLemmas: string[]
    mathcompCandidateLemmas: string[]
    editableMode: "region"
    beginMarker?: string
    endMarker?: string
    regionStart?: number
    regionEnd?: number
    regionFingerprint?: string
  }

  export interface ScheduledSubtask {
    caller: string
    agent: string
    description: string
    prompt: string
    task_id?: string
    model?: {
      providerID: string
      modelID: string
    }
    lemma_assignment?: LemmaAssignment
    proof_repair_assignment?: ProofRepairAssignment
  }

  interface LemmaOutcome {
    status: "solved" | "split" | "escalate"
    taskID?: string
    model?: {
      providerID: string
      modelID: string
    }
    assignment?: LemmaAssignment
    escalationType?: EscalationType
    escalationReason?: string
    remodelRequest?: RemodelRequest
    attemptReport?: BlockedProofReport
    proofText?: string
    contextAuditReview?: ContextAuditReview
    contextAuditResume?: boolean
  }

  interface ContextAuditReview {
    applicable: boolean
    audit_id?: string
    verified: boolean
    outcome?: "convertible" | "not_convertible" | "inconclusive"
    failed_local_bridge: boolean
    action: string
  }

  interface LatestLemmaTask {
    admitID: string
    status: "solved" | "split" | "escalate" | "completed" | "error" | "running" | "pending"
    taskID?: string
    model?: {
      providerID: string
      modelID: string
    }
    hasStructuredOutcome: boolean
    proofResultValid?: boolean
    validationErrors?: string[]
    error?: string
    escalationType?: EscalationType
    remodelRequest?: RemodelRequest
    attemptReport?: BlockedProofReport
  }

  export interface DelegationSuggestion {
    file: string
    phase: Phase
    pending: QueueItem[]
    latest?: LatestLemmaTask
    latest_escalation?: LatestEscalation
    active_repair?: ProofRepairAssignment
    fallback_guard?: FallbackGuard
    task: ScheduledSubtask
  }

  const cache = new Map<string, State>()
  const activeLemmaAssignments = new Map<string, LemmaAssignment>()
  const activeRepairWorkerAssignments = new Map<string, ProofRepairAssignment>()
  const proofTaskWorkerSessions = new Map<string, string>()
  const validatedLemmaSources = new Map<string, Map<string, string>>()
  const lemmaResumesMissingBaseline = new Set<string>()
  const proofProgressSnapshots = new Map<string, Map<string, ProofProgressMetrics>>()
  const proofFailureSnapshots = new Map<string, Map<string, ProofErrorAnchor>>()
  let lastProgressReceiptAt = 0
  type BoundProofScope = {
    file: string
    canonicalHash: string
    canonicalLength: number
    theoremStart: number
    declarationEnd: number
    proofStart: number
    bodyStart: number
    bodyEnd: number
    terminatorEnd: number
    protectedPrefix: string
    protectedSuffix: string
  }
  const boundProofScopes = new Map<string, Map<string, BoundProofScope>>()
  const boundProofScopeRootBySession = new Map<string, string>()
  const boundProofScopeMembersByRoot = new Map<string, Set<string>>()
  const REGION_BEGIN = /\(\*\s*proof_region\s+begin\s+([\s\S]*?)\s*\*\)/g
  const REGION_END = /\(\*\s*proof_region\s+end(?:\s+admit_id:\s*([^\s*]+))?\s*\*\)/g
  const THEOREM_NAME = /\b(?:Lemma|Theorem|Corollary|Proposition|Fact|Remark|Example)\s+([A-Za-z0-9_']+)/g
  const PENDING_PLACEHOLDER = /\bby\s+admit\.|\badmit\./
  const PENDING_PLACEHOLDER_GLOBAL = /\bby\s+admit\.|\badmit\./g
  const EMPTY_PROOF_BLOCK = /\{\s*(?:\(\*[\s\S]*?\*\)\s*)*\}/
  const EMPTY_PROOF_BLOCK_GLOBAL = /\{\s*(?:\(\*[\s\S]*?\*\)\s*)*\}/g
  const DEFAULT_VALIDATION_TIMEOUT_MS = 120_000
  const DEFAULT_RUNNING_LEASE_MS = 30 * 60_000
  const INFORMAL_PROOF_COMMENT = /\(\*[\s\S]*?\binformal proof\b[\s\S]*?\*\)/i
  const UNFINISHED_PROOF = /\bAdmitted\.|\bAbort\.|\bby\s+admit\.|\badmit\./
  const WIDE_PROOF_EDIT_AGENTS = new Set(["prover", "fixer", "whole-lemma", "coq-prover", "coqprover"])
  const FALLBACK_LOOKUP_STREAK_LIMIT = 5
  // Keep repair exploration flexible, but return control before a child can
  // spend an entire long session without producing a new compiler-backed
  // certificate. A certificate starts a fresh action epoch.
  const REPAIR_CHILD_MATERIALIZATION_WARNING_LIMIT = 12
  const REPAIR_CHILD_MATERIALIZATION_STOP_LIMIT = 20
  const REPAIR_CHILD_COMPILER_SIGNATURE_WARNING_LIMIT = 2
  const REPAIR_CHILD_COMPILER_SIGNATURE_STOP_LIMIT = 3
  // A single repair child may fail to materialize for sampling-specific
  // reasons. Preserve room for several genuinely fresh attempts, but prevent
  // an unchanged semantic blocker and compiler state from spawning an
  // unbounded sequence of fresh children.
  const IDENTICAL_REPAIR_CHILD_NO_MATERIALIZATION_LIMIT = 5
  const MAX_REPAIR_INCIDENTS = 64

  export interface ValidationResult {
    ok: boolean
    validator: "checkpoint-coqc"
    status: "ok" | "error"
    message?: string
    first_error_file?: string
    first_error_line?: number
    failure_kind?: "compiler_error" | "process_error" | "timeout" | "spawn_error" | "style_guard"
    prefix_complete?: boolean
  }

  type ProofProgressMetrics = {
    theorem?: string
    unfinished_count: number
    admit_count: number
    empty_block_count: number
    admitted_terminator_count: number
    abort_terminator_count: number
    final_terminator?: string
    qed_distance: number
    unresolved_semantic_debt: number
    unresolved_semantic_debt_ids: string[]
    certified_semantic_debt_ids: string[]
    validated_split_fingerprint?: string
  }

  function validationTimeoutMs() {
    const raw = process.env.OPENCODE_PROOF_WORKFLOW_VALIDATION_TIMEOUT_MS
    if (!raw) return DEFAULT_VALIDATION_TIMEOUT_MS
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_VALIDATION_TIMEOUT_MS
  }

  function runningLeaseMs() {
    const raw = process.env.OPENCODE_LEMMA_RUNNING_LEASE_MS
    if (!raw) return DEFAULT_RUNNING_LEASE_MS
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RUNNING_LEASE_MS
  }

  function isRunningLeaseExpired(item: QueueItem, now = Date.now()) {
    return item.status === "running" && Boolean(item.running_lease_expires_at && item.running_lease_expires_at <= now)
  }

  function normalizeProofText(text: string) {
    return text.replaceAll("\r\n", "\n").trim()
  }

  function normalizeBoundProofFile(file: string) {
    return path.normalize(path.isAbsolute(file) ? file : path.resolve(Instance.directory, file))
  }

  function sourceHash(source: string) {
    return createHash("sha256").update(source).digest("hex")
  }

  function protectedSuffixStart(source: string, protectedSuffix: string) {
    if (source.endsWith(protectedSuffix)) return source.length - protectedSuffix.length

    // A model-generated replacement that reaches EOF commonly adds or drops
    // the final newline.  That formatting-only change must not be treated as
    // a protected module/file suffix mutation.  Preserve every non-whitespace
    // suffix byte exactly and relax only horizontal/line whitespace at EOF.
    const stableSuffix = protectedSuffix.replace(/[ \t\r\n]+$/, "")
    const stableSource = source.replace(/[ \t\r\n]+$/, "")
    if (!stableSource.endsWith(stableSuffix)) return undefined
    return stableSource.length - stableSuffix.length
  }

  function sourceOffset(source: string, line: number, character: number) {
    if (line < 0 || character < 0) return undefined
    let offset = 0
    for (let current = 0; current < line; current++) {
      const newline = source.indexOf("\n", offset)
      if (newline < 0) return undefined
      offset = newline + 1
    }
    const lineEnd = source.indexOf("\n", offset)
    const limit = lineEnd < 0 ? source.length : lineEnd
    return offset + character <= limit ? offset + character : undefined
  }

  function maskCoqCommentsAndStrings(source: string) {
    const masked = source.split("")
    let commentDepth = 0
    let inString = false
    for (let index = 0; index < source.length; index++) {
      const pair = source.slice(index, index + 2)
      if (commentDepth > 0) {
        if (pair === "(*") {
          masked[index] = masked[index + 1] = " "
          commentDepth++
          index++
          continue
        }
        if (pair === "*)") {
          masked[index] = masked[index + 1] = " "
          commentDepth--
          index++
          continue
        }
        if (source[index] !== "\n" && source[index] !== "\r") masked[index] = " "
        continue
      }
      if (inString) {
        if (source[index] === '"' && source[index + 1] === '"') {
          masked[index] = masked[index + 1] = " "
          index++
          continue
        }
        if (source[index] === '"') inString = false
        if (source[index] !== "\n" && source[index] !== "\r") masked[index] = " "
        continue
      }
      if (pair === "(*") {
        masked[index] = masked[index + 1] = " "
        commentDepth = 1
        index++
        continue
      }
      if (source[index] === '"') {
        masked[index] = " "
        inString = true
      }
    }
    if (commentDepth !== 0 || inString) return undefined
    return masked.join("")
  }

  type TheoremSpan = {
    name: string
    start: number
    end: number
    proofStart?: number
    proofEnd?: number
    rootGoal?: string
  }

  export type BoundTheoremTarget = {
    theorem: string
    root_goal: string
    start: number
    end: number
  }

  function theoremRootGoal(source: string, masked: string, start: number, proofStart: number) {
    const declaration = source.slice(start, proofStart)
    const maskedDeclaration = masked.slice(start, proofStart)
    const proofCommand = /\bProof\s*\./g.exec(maskedDeclaration)
    const terminator = maskedDeclaration.lastIndexOf(".", proofCommand?.index ?? maskedDeclaration.length)
    const limit = terminator >= 0 ? terminator : maskedDeclaration.length
    let round = 0
    let square = 0
    let curly = 0
    let colon = -1
    for (let index = 0; index < limit; index++) {
      const char = maskedDeclaration[index]
      if (char === "(") round += 1
      else if (char === ")") round = Math.max(0, round - 1)
      else if (char === "[") square += 1
      else if (char === "]") square = Math.max(0, square - 1)
      else if (char === "{") curly += 1
      else if (char === "}") curly = Math.max(0, curly - 1)
      else if (char === ":" && round === 0 && square === 0 && curly === 0) {
        colon = index
        break
      }
    }
    if (colon < 0) return undefined
    const goal = declaration.slice(colon + 1, limit).trim()
    return goal || undefined
  }

  function theoremSpans(source: string) {
    const masked = maskCoqCommentsAndStrings(source)
    if (!masked) return [] as TheoremSpan[]
    const declarations = [...masked.matchAll(THEOREM_NAME)].map((match) => ({
      name: match[1],
      start: match.index,
    }))
    return declarations.map<TheoremSpan>((declaration, index) => {
      const end = declarations[index + 1]?.start ?? source.length
      const theoremText = masked.slice(declaration.start, end)
      const proof = /\bProof\s*\./g.exec(theoremText)
      const proofStart = proof ? declaration.start + proof.index + proof[0].length : undefined
      const terminator = proofStart === undefined
        ? undefined
        : /\b(?:Qed|Defined|Admitted|Abort)\s*\./g.exec(masked.slice(proofStart, end))
      const proofEnd = terminator && proofStart !== undefined
        ? proofStart + terminator.index + terminator[0].length
        : undefined
      const rootGoal = proofStart === undefined
        ? undefined
        : theoremRootGoal(source, masked, declaration.start, proofStart)
      return {
        ...declaration,
        end,
        proofStart,
        proofEnd,
        rootGoal,
      }
    })
  }

  function theoremSpanAtOffset(spans: TheoremSpan[], offset: number) {
    return spans.find((span) => offset >= span.start && offset < span.end)
  }

  export function theoremTargetAtProofPosition(
    source: string,
    position: { line: number; character: number },
  ): BoundTheoremTarget | undefined {
    const offset = sourceOffset(source, position.line, position.character)
    if (offset === undefined) return undefined
    const spans = theoremSpans(source)
    const preceding = spans.filter((span) => span.start <= offset).at(-1)
    const span = preceding ?? (spans.length === 1 ? spans[0] : undefined)
    if (!span?.rootGoal || offset >= span.end) return undefined
    return {
      theorem: span.name,
      root_goal: span.rootGoal,
      start: span.start,
      end: span.end,
    }
  }

  function deriveBoundProofScope(file: string, source: string, position: number): BoundProofScope {
    const masked = maskCoqCommentsAndStrings(source)
    if (!masked) {
      throw new Error("proof_scope_integrity: cannot derive canonical scope from an unterminated Coq comment or string")
    }

    const theoremPattern = /\b(?:Lemma|Theorem|Corollary|Proposition|Fact|Remark|Example)\s+[A-Za-z0-9_']+\b/g
    const theoremStarts = [...masked.matchAll(theoremPattern)].map((match) => match.index)
    const precedingTheoremStart = theoremStarts.filter((start) => start <= position).at(-1)
    const theoremStart = precedingTheoremStart ?? (theoremStarts.length === 1 ? theoremStarts[0] : undefined)
    if (theoremStart === undefined) {
      throw new Error("proof_scope_integrity: bound position is not inside a uniquely located theorem")
    }
    const effectivePosition = precedingTheoremStart === undefined ? theoremStart : position
    const nextTheorem = theoremStarts.find((start) => start > theoremStart) ?? source.length

    const proofMatches = [...masked.slice(theoremStart, nextTheorem).matchAll(/\bProof\s*\./g)]
    if (proofMatches.length !== 1) {
      throw new Error("proof_scope_integrity: bound theorem must contain exactly one explicit Proof command")
    }
    const proofMatch = proofMatches[0]
    const proofStart = theoremStart + proofMatch.index
    const bodyStart = proofStart + proofMatch[0].length

    const terminators = [...masked.slice(bodyStart, nextTheorem).matchAll(/\b(?:Qed|Defined|Admitted)\s*\./g)]
    if (terminators.length !== 1) {
      throw new Error("proof_scope_integrity: bound theorem must contain exactly one proof terminator")
    }
    const terminator = terminators[0]
    const bodyEnd = bodyStart + terminator.index
    const terminatorEnd = bodyEnd + terminator[0].length
    if (effectivePosition < theoremStart || effectivePosition > terminatorEnd) {
      throw new Error("proof_scope_integrity: bound position disagrees with the located theorem proof span")
    }

    return {
      file,
      canonicalHash: sourceHash(source),
      canonicalLength: source.length,
      theoremStart,
      declarationEnd: proofStart,
      proofStart,
      bodyStart,
      bodyEnd,
      terminatorEnd,
      protectedPrefix: source.slice(0, proofStart),
      protectedSuffix: source.slice(terminatorEnd),
    }
  }

  function registerBoundProofScopeSession(sessionID: string, rootID?: string) {
    const existing = boundProofScopeRootBySession.get(sessionID)
    const root = rootID ?? existing ?? sessionID
    if (existing && existing !== root) {
      throw new Error("proof_scope_integrity: session proof lineage changed after scope initialization")
    }
    boundProofScopeRootBySession.set(sessionID, root)
    const members = boundProofScopeMembersByRoot.get(root) ?? new Set<string>()
    members.add(sessionID)
    boundProofScopeMembersByRoot.set(root, members)
    return root
  }

  function releaseBoundProofScopeSession(sessionID: string) {
    const root = boundProofScopeRootBySession.get(sessionID)
    if (!root) return
    boundProofScopeRootBySession.delete(sessionID)
    const members = boundProofScopeMembersByRoot.get(root)
    members?.delete(sessionID)
    if ((members?.size ?? 0) > 0) return
    boundProofScopeMembersByRoot.delete(root)
    boundProofScopes.delete(root)
  }

  export function inheritBoundProofScope(parentID: string, childID: string) {
    const root = registerBoundProofScopeSession(parentID)
    registerBoundProofScopeSession(childID, root)
  }

  export function assertBoundProofBodyMutationAllowed(input: {
    sessionID: string
    file: string
    before: string
    after: string
    destinationFile?: string
  }) {
    if (input.before === input.after && !input.destinationFile) return
    const binding = SessionProof.get(input.sessionID)
    if (!binding || !binding.file.endsWith(".v")) return
    const boundFile = normalizeBoundProofFile(binding.file)
    const sourceFile = normalizeBoundProofFile(input.file)
    const destinationFile = normalizeBoundProofFile(input.destinationFile ?? input.file)
    if (sourceFile !== boundFile && destinationFile !== boundFile) return
    if (sourceFile !== boundFile || destinationFile !== boundFile) {
      throw new Error(
        "proof_scope_integrity_rejection: bound proof files cannot be moved, replaced from another path, or moved away",
      )
    }
    if (!input.before) {
      throw new Error("proof_scope_integrity: cannot initialize a bound proof scope without pristine existing source")
    }

    const root = registerBoundProofScopeSession(input.sessionID)
    const scopes = boundProofScopes.get(root) ?? new Map<string, BoundProofScope>()
    let scope = scopes.get(boundFile)
    if (!scope) {
      const canonicalSource = binding.canonicalSource
      if (canonicalSource === undefined) {
        throw new Error("proof_scope_integrity: bound proof has no canonical source snapshot")
      }
      const position = sourceOffset(canonicalSource, binding.line, binding.character)
      if (position === undefined) {
        throw new Error("proof_scope_integrity: bound line/character is outside the pristine source")
      }
      scope = deriveBoundProofScope(boundFile, canonicalSource, position)
      scopes.set(boundFile, scope)
      boundProofScopes.set(root, scopes)
    }
    if (
      sourceHash(input.before) !== scope.canonicalHash &&
      (
        !input.before.startsWith(scope.protectedPrefix) ||
        protectedSuffixStart(input.before, scope.protectedSuffix) === undefined
      )
    ) {
      throw new Error("proof_scope_integrity: current bound file does not match the immutable session snapshot")
    }

    const prefixOK = input.after.startsWith(scope.protectedPrefix)
    const suffixStart = protectedSuffixStart(input.after, scope.protectedSuffix)
    const suffixOK = suffixStart !== undefined
    if (prefixOK && suffixStart !== undefined && suffixStart >= scope.protectedPrefix.length) {
      const proofText = input.after.slice(scope.protectedPrefix.length, suffixStart)
      const maskedProof = maskCoqCommentsAndStrings(proofText)
      if (!maskedProof) {
        throw new Error("proof_scope_integrity_rejection: bound theorem proof has an unterminated comment or string")
      }
      const proofs = [...maskedProof.matchAll(/\bProof\s*\./g)]
      const terminators = [...maskedProof.matchAll(/\b(?:Qed|Defined|Admitted|Abort)\s*\./g)]
      if (proofs.length !== 1 || terminators.length !== 1 || terminators[0].index <= proofs[0].index) {
        throw new Error(
          "proof_scope_integrity_rejection: bound theorem must retain exactly one Proof command followed by exactly one proof terminator",
        )
      }
      if (/\bEnd\s+[A-Za-z0-9_']+\s*\./.test(maskedProof)) {
        throw new Error("proof_scope_integrity_rejection: an End command was copied into the bound theorem proof")
      }
      const trailing = maskedProof.slice(terminators[0].index + terminators[0][0].length)
      if (trailing.trim()) {
        throw new Error("proof_scope_integrity_rejection: tactic or command text appears after the proof terminator")
      }
      if (decompositionModeEnabled()) {
        const plan = getDecompositionPlanState(input.sessionID, boundFile)
        if (plan && (plan.status !== "accepted" || !plan.accepted_plan || !plan.accepted_semantic_fingerprint)) {
          throw new Error(
            `decomposition_plan_materialization_rejection ${JSON.stringify({
              status: plan.status,
              semantic_revision_number: plan.semantic_revision_number,
              accepted_semantic_fingerprint: plan.accepted_semantic_fingerprint,
              terminal_verdict: plan.terminal_verdict,
              reason: "a current accepted semantic plan is required before materializing a decomposition",
            })}`,
          )
        }
      }
      return
    }

    const category = !prefixOK
      ? input.after.slice(0, scope.theoremStart) !== scope.protectedPrefix.slice(0, scope.theoremStart)
        ? "protected_prefix"
        : "theorem_declaration_or_proof_boundary"
      : "protected_suffix"
    throw new Error(
      `proof_scope_integrity_rejection ${JSON.stringify({
        category,
        canonical_hash: scope.canonicalHash,
        proposed_hash: sourceHash(input.after),
        canonical_length: scope.canonicalLength,
        proposed_length: input.after.length,
        protected_offsets: {
          theorem_start: scope.theoremStart,
          declaration_end: scope.declarationEnd,
          proof_start: scope.proofStart,
          body_start: scope.bodyStart,
          body_end: scope.bodyEnd,
          terminator_end: scope.terminatorEnd,
        },
      })}`,
    )
  }

  function countMatches(text: string, pattern: RegExp) {
    pattern.lastIndex = 0
    return [...text.matchAll(pattern)].length
  }

  function hasPendingProofHole(text: string) {
    const masked = maskCoqCommentsAndStrings(text)
    if (!masked) return true
    return PENDING_PLACEHOLDER.test(masked) || EMPTY_PROOF_BLOCK.test(masked)
  }

  function firstSequentialHole(text: string) {
    const searchable = maskCoqCommentsAndStrings(text) ?? text
    const pending = PENDING_PLACEHOLDER.exec(searchable)
    const empty = EMPTY_PROOF_BLOCK.exec(searchable)
    const pendingEnd = pending
      ? (() => {
          const end = pending.index + pending[0].length
          const inlineAdmitMarker = /^[ \t]*\(\*\s*admit_id\s*:\s*[^\s*]+\s*\*\)/.exec(text.slice(end))
          return end + (inlineAdmitMarker?.[0].length ?? 0)
        })()
      : undefined
    const candidates = [
      pending ? { start: pending.index, end: pendingEnd!, kind: "admit placeholder" } : undefined,
      empty ? { start: empty.index, end: empty.index + empty[0].length, kind: "empty proof block" } : undefined,
    ].filter((candidate): candidate is { start: number; end: number; kind: string } => Boolean(candidate))
    return candidates.sort((left, right) => left.start - right.start)[0]
  }

  async function checkpointScaffold(
    file: string,
    sourceOverride?: string,
    options: CoqProject.ProcessOptions = {},
  ): Promise<ValidationResult> {
    if (!file.endsWith(".v")) {
      return {
        ok: false,
        validator: "checkpoint-coqc",
        status: "error",
        message: "scaffold gate only accepts .v files",
      }
    }
    if (!(await Filesystem.exists(file))) {
      return { ok: false, validator: "checkpoint-coqc", status: "error", message: `file not found: ${file}` }
    }

    const source = sourceOverride ?? (await Filesystem.readText(file))
    try {
      assertNoRewriteBangInCoqFile(file, source)
      assertNoIntuitionInCoqFile(file, source)
    } catch (error) {
      return {
        ok: false,
        validator: "checkpoint-coqc",
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        failure_kind: "style_guard",
      }
    }

    if (sourceOverride !== undefined) {
      const result = await checkpointSourceAs(file, source, [], options)
      if (result.ok || !result.first_error_file) return result

      const tempFile = path.join(
        path.dirname(file),
        `OpencodePrefix_${hashText(file + "\n" + source).slice(0, 12)}.v`,
      )
      return diagnosticFileMatches(tempFile, result.first_error_file)
        ? { ...result, first_error_file: file }
        : result
    }

    const resolved = await CoqProject.resolve(file)
    const args = [...CoqProject.coqcCmd(), ...resolved.flags, file]
    const timeoutMs = validationTimeoutMs()
    let result: CoqProject.ProcessResult
    try {
      result = await CoqProject.runProcess(args, resolved.cwd, { ...options, timeoutMs })
    } catch (error) {
      return {
        ok: false,
        validator: "checkpoint-coqc",
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        failure_kind: "spawn_error",
      }
    }

    if (result.timedOut) {
      return {
        ok: false,
        validator: "checkpoint-coqc",
        status: "error",
        message: `checkpoint scaffold gate timed out after ${timeoutMs}ms`,
        failure_kind: "timeout",
      }
    }
    if (result.aborted) {
      return {
        ok: false,
        validator: "checkpoint-coqc",
        status: "error",
        message: "checkpoint scaffold gate was aborted; process group was killed",
        failure_kind: "process_error",
      }
    }
    if (result.outputLimitExceeded) {
      return {
        ok: false,
        validator: "checkpoint-coqc",
        status: "error",
        message: `checkpoint scaffold gate exceeded the ${options.maxOutputBytes ?? CoqProject.subprocessMaxOutputBytes()} byte output limit`,
        failure_kind: "process_error",
      }
    }

    if (result.exit === 0) return { ok: true, validator: "checkpoint-coqc", status: "ok" }

    const parsed = parseCoqCompilerOutput(result.stdout, result.stderr)
    const firstError = parsed.firstError
    return {
      ok: false,
      validator: "checkpoint-coqc",
      status: "error",
      first_error_file: firstError?.file,
      first_error_line: firstError?.line,
      failure_kind: firstError ? "compiler_error" : "process_error",
      message:
        firstError?.message ?? (parsed.output.slice(0, 1000) || "Coq compiler failed without diagnostic output."),
    }
  }

  function maskEmptyProofBlock(match: string) {
    const close = match.lastIndexOf("}")
    if (close < 0) return match
    if (!match.includes("\n")) return "{ admit. }"

    const beforeClose = match.slice(0, close).trimEnd()
    const closeLine = match.slice(0, close).match(/\n([ \t]*)[^\n]*$/)
    const closeIndent = closeLine?.[1] ?? ""
    return `${beforeClose}\n${closeIndent}  admit.\n${closeIndent}}`
  }

  function maskEmptyProofBlocksAfter(source: string, startIndex: number, endIndex = source.length) {
    return (
      source.slice(0, startIndex) +
      source.slice(startIndex, endIndex).replace(EMPTY_PROOF_BLOCK_GLOBAL, maskEmptyProofBlock) +
      source.slice(endIndex)
    )
  }

  async function checkpointSourceAs(
    file: string,
    source: string,
    extraFlags: string[] = [],
    options: CoqProject.ProcessOptions = {},
  ): Promise<ValidationResult> {
    const directory = path.dirname(file)
    const basename = `OpencodePrefix_${hashText(file + "\n" + source).slice(0, 12)}.v`
    const tempFile = path.join(directory, basename)
    const cleanup = [
      tempFile,
      tempFile.replace(/\.v$/, ".vo"),
      tempFile.replace(/\.v$/, ".vos"),
      tempFile.replace(/\.v$/, ".vok"),
      tempFile.replace(/\.v$/, ".glob"),
    ]

    try {
      await Filesystem.write(tempFile, source)
      const resolved = await CoqProject.resolve(file)
      const args = [...CoqProject.coqcCmd(), ...resolved.flags, ...extraFlags, tempFile]
      const timeoutMs = validationTimeoutMs()
      let result: CoqProject.ProcessResult
      try {
        result = await CoqProject.runProcess(args, resolved.cwd, { ...options, timeoutMs })
      } catch (error) {
        return {
          ok: false,
          validator: "checkpoint-coqc",
          status: "error",
          message: error instanceof Error ? error.message : String(error),
          failure_kind: "spawn_error",
        }
      }

      if (result.timedOut) {
        return {
          ok: false,
          validator: "checkpoint-coqc",
          status: "error",
          message: `lemma prefix checkpoint timed out after ${timeoutMs}ms`,
          failure_kind: "timeout",
        }
      }
      if (result.aborted) {
        return {
          ok: false,
          validator: "checkpoint-coqc",
          status: "error",
          message: "lemma prefix checkpoint was aborted; process group was killed",
          failure_kind: "process_error",
        }
      }
      if (result.outputLimitExceeded) {
        return {
          ok: false,
          validator: "checkpoint-coqc",
          status: "error",
          message: `lemma prefix checkpoint exceeded the ${options.maxOutputBytes ?? CoqProject.subprocessMaxOutputBytes()} byte output limit`,
          failure_kind: "process_error",
        }
      }

      if (result.exit === 0) return { ok: true, validator: "checkpoint-coqc", status: "ok" }

      const parsed = parseCoqCompilerOutput(result.stdout, result.stderr)
      const firstError = parsed.firstError
      return {
        ok: false,
        validator: "checkpoint-coqc",
        status: "error",
        first_error_file: firstError?.file,
        first_error_line: firstError?.line,
        failure_kind: firstError ? "compiler_error" : "process_error",
        message:
          firstError?.message ?? (parsed.output.slice(0, 1000) || "Coq compiler failed without diagnostic output."),
      }
    } finally {
      await Promise.all(cleanup.map((filePath) => rm(filePath, { force: true }).catch(() => undefined)))
    }
  }

  export const Validation = {
    scaffold: checkpointScaffold,
    prefix: checkpointSourceAs,
    parseCompilerOutput: parseCoqCompilerOutput,
  }

  function hashText(text: string) {
    return createHash("sha256").update(text).digest("hex")
  }

  function normalizedWorkflowFile(file: string) {
    return path.normalize(path.isAbsolute(file) ? file : path.resolve(Instance.directory, file))
  }

  function boundTheoremTarget(sessionID: string, file: string, source: string) {
    const binding = SessionProof.get(sessionID)
    if (!binding || normalizedWorkflowFile(binding.file) !== normalizedWorkflowFile(file)) return undefined
    return theoremTargetAtProofPosition(source, {
      line: binding.line,
      character: binding.character,
    })
  }

  function normalizedSourceSnapshot(source: string) {
    return source.replaceAll("\r\n", "\n")
  }

  function regionPrefixHash(source: string, block: ParsedBlock) {
    const end = block.regionEnd ?? block.endIndex + 1
    return hashText(normalizedSourceSnapshot(source.slice(0, end)))
  }

  function validationCertificateCurrent(
    certificate: ValidationCertificate | undefined,
    file: string,
    source: string,
    block: ParsedBlock,
  ) {
    return Boolean(
      certificate &&
        certificate.normalized_file === normalizedWorkflowFile(file) &&
        certificate.admit_id === block.admit_id &&
        certificate.region_fingerprint === block.regionFingerprint &&
        certificate.source_hash === regionPrefixHash(source, block),
    )
  }

  function validationFailureCurrent(
    failure: ValidationFailure | undefined,
    source: string,
    block: ParsedBlock,
  ) {
    return Boolean(failure && failure.source_hash === regionPrefixHash(source, block))
  }

  function buildValidationCertificate(input: {
    file: string
    source: string
    block: ParsedBlock
    compilerSignature: string
    validator: ValidationCertificate["validator"]
  }): ValidationCertificate {
    return {
      normalized_file: normalizedWorkflowFile(input.file),
      source_hash: regionPrefixHash(input.source, input.block),
      admit_id: input.block.admit_id,
      region_fingerprint: input.block.regionFingerprint ?? hashText(input.block.blockText),
      compiler_signature: input.compilerSignature,
      validator: input.validator,
      validated_at: Date.now(),
    }
  }

  function normalizeCompilerMessage(message: string | undefined) {
    return (message ?? "")
      .replace(/File "[^"]+"/g, 'File "<file>"')
      .replace(/characters? \d+-\d+/g, "characters <range>")
      .replace(/\s+/g, " ")
      .trim()
  }

  function compilerResultSignature(input: {
    ok: boolean
    file: string
    firstErrorFile?: string
    firstErrorLine?: number
    firstErrorMessage?: string
  }) {
    return hashText(
      [
        input.ok ? "ok" : "error",
        normalizedWorkflowFile(input.file),
        input.firstErrorFile ? path.normalize(input.firstErrorFile) : "",
        input.firstErrorLine ?? "",
        normalizeCompilerMessage(input.firstErrorMessage),
      ].join("\n"),
    )
  }

  function parseAttributes(text: string) {
    const attrs = new Map<string, string>()
    const attr = /([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s*]+))/g
    let match: RegExpExecArray | null
    while ((match = attr.exec(text))) attrs.set(match[1], match[2] ?? match[3] ?? match[4] ?? "")
    return attrs
  }

  const CONTRACT_FIELDS = [
    "plan_node",
    "node",
    "proof_plan_node",
    "depends_on",
    "depends",
    "source",
    "input",
    "inputs",
    "output",
    "layer",
    "expected",
    "normal_form",
    "normal",
    "target_normal_form",
    "evidence",
    "shape_evidence",
    "prosa",
    "prosa_candidates",
    "prosa_candidate_lemmas",
    "mathcomp",
    "mathcomp_candidates",
    "mathcomp_candidate_lemmas",
  ]

  function parseContractAttributes(text: string) {
    const attrs = parseAttributes(text)
    for (const field of CONTRACT_FIELDS) {
      const match = text.match(
        new RegExp(`(?:^|[;\\n])\\s*${escapeRegExp(field)}\\s*:\\s*(?:"([^"]*)"|'([^']*)'|([^;\\n*]+))`, "i"),
      )
      const value = match?.[1] ?? match?.[2] ?? match?.[3]
      if (value?.trim()) attrs.set(field, value.trim())
    }
    return attrs
  }

  function nearbyContractAttributes(source: string, markerStart: number) {
    const window = source.slice(Math.max(0, markerStart - 1800), markerStart)
    const comments = [...window.matchAll(/\(\*([\s\S]*?)\*\)/g)]
    for (let index = comments.length - 1; index >= 0; index--) {
      const text = comments[index][1]
      if (
        /\b(?:source|input|output|layer|expected|normal_form|target_normal_form|evidence|plan_node|depends_on)\s*:/.test(
          text,
        )
      ) {
        return parseContractAttributes(text)
      }
    }
    return new Map<string, string>()
  }

  function leadingRegionContractAttributes(blockText: string, beginMarkerLength: number) {
    const tail = blockText.slice(beginMarkerLength)
    const comments: string[] = []
    let offset = 0

    // A proof-region contract is commonly formatted as several consecutive
    // comments immediately after the begin marker.  Keep consuming only that
    // leading comment prelude; once Coq code starts, later proof comments must
    // not be mistaken for scheduler metadata.
    while (offset < tail.length) {
      const whitespace = /^\s*/.exec(tail.slice(offset))?.[0].length ?? 0
      offset += whitespace
      if (!tail.startsWith("(*", offset)) break

      const end = tail.indexOf("*)", offset + 2)
      if (end < 0) break
      comments.push(tail.slice(offset + 2, end))
      offset = end + 2
    }

    return parseContractAttributes(comments.join("\n"))
  }

  function mergeContractAttributes(...sources: Map<string, string>[]) {
    const merged = new Map<string, string>()
    for (const source of sources) {
      for (const [key, value] of source) merged.set(key, value)
    }
    return merged
  }

  function attrValue(primary: Map<string, string>, fallback: Map<string, string>, ...keys: string[]) {
    for (const key of keys) {
      const value = primary.get(key) ?? fallback.get(key)
      if (value) return value
    }
    return undefined
  }

  function attrList(value: string | undefined) {
    if (!value) return []
    return value
      .split(/[|,]/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .filter((entry) => entry.toLowerCase() !== "none")
  }

  function escapeRegExp(text: string) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  const COQ_TARGET_KEYWORDS = new Set([
    "as",
    "at",
    "cofix",
    "else",
    "end",
    "exists",
    "fix",
    "for",
    "forall",
    "fun",
    "if",
    "in",
    "let",
    "match",
    "return",
    "then",
    "with",
  ])

  const REGION_MARKER_FIELDS = [
    "owner",
    "admit_id",
    "theorem",
    "kind",
    "target",
    "plan_node",
    "depends_on",
    "depends",
    "source",
    "input",
    "inputs",
    "output",
    "layer",
    "expected",
    "normal_form",
    "normal",
    "target_normal_form",
    "evidence",
    "shape_evidence",
    "prosa",
    "prosa_candidates",
    "prosa_candidate_lemmas",
    "mathcomp",
    "mathcomp_candidates",
    "mathcomp_candidate_lemmas",
  ]

  function targetFieldText(markerText: string) {
    const match = /\btarget\s*:\s*/i.exec(markerText)
    if (!match) return undefined
    const start = match.index + match[0].length
    const quote = markerText[start]
    if (quote === '"' || quote === "'") {
      const end = markerText.indexOf(quote, start + 1)
      return end < 0 ? undefined : markerText.slice(start + 1, end).trim()
    }

    const tail = markerText.slice(start)
    const nextField = new RegExp(
      `(?:\\s|^)(?:${REGION_MARKER_FIELDS.map(escapeRegExp).join("|")})\\s*:`,
      "i",
    ).exec(tail)
    return tail.slice(0, nextField?.index ?? tail.length).trim()
  }

  function targetDeclarations(blockText: string) {
    const masked = maskCoqCommentsAndStrings(blockText) ?? blockText
    const lines = blockText.split("\n")
    const maskedLines = masked.split("\n")
    const declarations: { name: string; statement: string; proposition: string }[] = []
    const declaration = /\b(?:have|suff(?:ices)?|enough)\s+([A-Za-z_][A-Za-z0-9_']*)\b|\bassert\s*\(\s*([A-Za-z_][A-Za-z0-9_']*)\b/

    for (let start = 0; start < maskedLines.length; start++) {
      const found = declaration.exec(maskedLines[start])
      const name = found?.[1] ?? found?.[2]
      if (!found || !name) continue

      const collected: string[] = []
      for (let index = start; index < lines.length; index++) {
        collected.push(lines[index].trim())
        if (maskedLines[index].trim().endsWith(".")) break
      }
      const statement = collected.join("\n").trim()
      const colon = statement.indexOf(":")
      if (colon < 0) continue
      const proposition = statement
        .slice(colon + 1)
        .replace(/\)\s*\.\s*$/, "")
        .replace(/\.\s*$/, "")
        .replace(/\s+/g, " ")
        .trim()
      declarations.push({ name, statement, proposition })
    }
    return declarations
  }

  function resolveTargetName(markerText: string, blockText: string, parsedTarget?: string) {
    const fieldText = targetFieldText(markerText)
    const scalarTarget = fieldText ?? parsedTarget
    if (
      scalarTarget &&
      /^[A-Za-z_][A-Za-z0-9_']*$/.test(scalarTarget) &&
      !COQ_TARGET_KEYWORDS.has(scalarTarget.toLowerCase())
    ) {
      return scalarTarget
    }

    const declarations = targetDeclarations(blockText)
    const normalizedTarget = fieldText?.replace(/\s+/g, " ").replace(/\.\s*$/, "").trim()
    if (normalizedTarget) {
      const matching = declarations.filter((entry) => entry.proposition === normalizedTarget)
      if (matching.length === 1) return matching[0].name
    }
    if (declarations.length === 1) return declarations[0].name
    return undefined
  }

  function findTargetStatement(blockText: string, targetName?: string) {
    if (!targetName) return undefined
    return targetDeclarations(blockText).find((entry) => entry.name === targetName)?.statement
  }

  function hasOpenSameIDRegionBefore(source: string, index: number, admitID: string) {
    const begin = /\(\*\s*proof_region\s+begin\s+([\s\S]*?)\s*\*\)/g
    const end = /\(\*\s*proof_region\s+end(?:\s+admit_id:\s*([^\s*]+))?\s*\*\)/g
    let beginMatch: RegExpExecArray | null
    while ((beginMatch = begin.exec(source))) {
      if (beginMatch.index >= index) break
      if (parseAttributes(beginMatch[1]).get("admit_id") !== admitID) continue

      end.lastIndex = begin.lastIndex
      let endMatch: RegExpExecArray | null
      while ((endMatch = end.exec(source))) {
        const endAdmitID = endMatch[1]
        if (endAdmitID && endAdmitID !== admitID) continue
        if (endMatch.index > index) return true
        break
      }
    }
    return false
  }

  function lineNumberOf(text: string, index: number) {
    let line = 1
    for (let i = 0; i < index; i++) {
      if (text[i] === "\n") line += 1
    }
    return line
  }

  function inferDeclaredTheorem(text: string) {
    return theoremSpans(text).at(-1)?.name
  }

  function inferTheorem(text: string) {
    return inferDeclaredTheorem(text) ?? "unknown_theorem"
  }

  function parseRegions(source: string) {
    const regions: ParsedBlock[] = []
    const spans = theoremSpans(source)
    REGION_BEGIN.lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = REGION_BEGIN.exec(source))) {
      const attrs = parseAttributes(match[1])
      const ownerRaw = attrs.get("owner")
      if (ownerRaw !== "lemma") continue

      const admitID = attrs.get("admit_id")
      if (!admitID) continue
      if (hasOpenSameIDRegionBefore(source, match.index, admitID)) continue
      const physicalTheorem = theoremSpanAtOffset(spans, match.index)
      if (
        !physicalTheorem?.proofStart ||
        !physicalTheorem.proofEnd ||
        match.index < physicalTheorem.proofStart ||
        match.index >= physicalTheorem.proofEnd
      ) continue
      const declaredTheorem = attrs.get("theorem")
      if (declaredTheorem && declaredTheorem !== physicalTheorem.name) continue

      REGION_END.lastIndex = REGION_BEGIN.lastIndex
      let endMatch: RegExpExecArray | null
      let matchedEnd: RegExpExecArray | undefined
      while ((endMatch = REGION_END.exec(source))) {
        const endAdmitID = endMatch[1]
        if (!endAdmitID || endAdmitID === admitID) {
          matchedEnd = endMatch
          break
        }
      }
      if (!matchedEnd) continue

      const beginMarker = match[0]
      const endMarker = matchedEnd[0]
      const regionStart = match.index
      const regionEnd = matchedEnd.index + matchedEnd[0].length
      const nestedBegin = /\(\*\s*proof_region\s+begin\s+([\s\S]*?)\s*\*\)/g
      const nestedText = source.slice(match.index + match[0].length, matchedEnd.index)
      let nestedMatch: RegExpExecArray | null
      let nestedSameID = false
      while ((nestedMatch = nestedBegin.exec(nestedText))) {
        if (parseAttributes(nestedMatch[1]).get("admit_id") === admitID) {
          nestedSameID = true
          break
        }
      }
      if (nestedSameID) continue

      const blockText = source.slice(regionStart, regionEnd)
      const contractAttrs = mergeContractAttributes(
        nearbyContractAttributes(source, match.index),
        leadingRegionContractAttributes(blockText, beginMarker.length),
      )
      const rawKind = attrs.get("kind") ?? "unknown"
      const kind = ObligationKind.safeParse(rawKind).success ? (rawKind as ObligationKind) : "unknown"
      const targetName = resolveTargetName(match[1], blockText, attrs.get("target"))
      const targetStatement = findTargetStatement(blockText, targetName)
      const dependsOnValue = attrValue(attrs, contractAttrs, "depends_on", "depends")
      const prosaCandidateLemmas = attrList(
        attrValue(attrs, contractAttrs, "prosa", "prosa_candidates", "prosa_candidate_lemmas"),
      )
      const mathcompCandidateLemmas = attrList(
        attrValue(attrs, contractAttrs, "mathcomp", "mathcomp_candidates", "mathcomp_candidate_lemmas"),
      )
      const shapeEvidence = [
        ...attrList(attrValue(attrs, contractAttrs, "evidence", "shape_evidence")),
        ...prosaCandidateLemmas.map((lemma) => `prosa:${lemma}`),
        ...mathcompCandidateLemmas.map((lemma) => `mathcomp:${lemma}`),
      ]

      regions.push({
        owner: "lemma",
        theorem: physicalTheorem.name,
        admit_id: admitID,
        order: 0,
        headerStart: regionStart,
        blockStart: regionStart,
        startLine: lineNumberOf(source, regionStart),
        endLine: lineNumberOf(source, regionEnd - 1),
        endIndex: regionEnd - 1,
        headerText: beginMarker,
        blockText,
        pending: hasPendingProofHole(blockText),
        kind,
        targetName,
        targetStatement,
        proofPlanNode: attrValue(attrs, contractAttrs, "plan_node", "node", "proof_plan_node"),
        dependsOn: attrList(dependsOnValue),
        dependsOnDeclared: dependsOnValue !== undefined,
        sourceRef: attrValue(attrs, contractAttrs, "source"),
        inputRefs: attrList(attrValue(attrs, contractAttrs, "input", "inputs")),
        outputRef: attrValue(attrs, contractAttrs, "output"),
        layer: attrValue(attrs, contractAttrs, "layer"),
        expected: attrValue(attrs, contractAttrs, "expected"),
        targetNormalForm: attrValue(attrs, contractAttrs, "normal_form", "normal", "target_normal_form"),
        shapeEvidence,
        prosaCandidateLemmas,
        mathcompCandidateLemmas,
        editableMode: "region",
        beginMarker,
        endMarker,
        regionStart,
        regionEnd,
        regionFingerprint: hashText(blockText),
      })
    }

    const invalid = new Set<number>()
    const sorted = regions
      .map((region, index) => ({ region, index }))
      .sort((left, right) => left.region.blockStart - right.region.blockStart)
    for (let index = 0; index < sorted.length; index++) {
      const left = sorted[index]
      for (let next = index + 1; next < sorted.length; next++) {
        const right = sorted[next]
        if (right.region.blockStart >= left.region.regionEnd!) break
        invalid.add(left.index)
        invalid.add(right.index)
      }
    }
    const byIdentity = new Map<string, number[]>()
    regions.forEach((region, index) => {
      const key = `${region.theorem}\u0000${region.admit_id}`
      byIdentity.set(key, [...(byIdentity.get(key) ?? []), index])
    })
    for (const matches of byIdentity.values()) {
      if (matches.length < 2) continue
      for (const index of matches) invalid.add(index)
    }

    return regions.filter((_, index) => !invalid.has(index))
  }

  function parseProofObligations(source: string) {
    const regions = parseRegions(source)
    return regions
      .sort((left, right) => left.blockStart - right.blockStart)
      .map((block, index) => ({
        ...block,
        order: index + 1,
      }))
  }

  export function proofRegionTargetFingerprint(source: string, admitID: string) {
    const block = parseProofObligations(source).find((entry) => entry.admit_id === admitID)
    return block?.targetStatement
      ? ProofRouteLedger.premiseFingerprint(block.targetStatement)
      : undefined
  }

  export function proofRegionHandoff(
    file: string,
    theorem: string | undefined,
    admitID: string,
    sessionID: string,
  ) {
    const source = ProofEditTransaction.source(sessionID, file)
    if (!source) return undefined
    const block = parseProofObligations(source).find(
      (entry) => entry.admit_id === admitID && (!theorem || entry.theorem === theorem),
    )
    if (!block) return undefined
    return {
      admit_id: block.admit_id,
      theorem: block.theorem,
      plan_node: block.proofPlanNode,
      depends_on: block.dependsOn,
      target_name: block.targetName,
      target_statement: block.targetStatement,
      target_normal_form: block.targetNormalForm,
      region_fingerprint: block.regionFingerprint,
      text: block.blockText,
    }
  }

  export function theoremAtProofPosition(
    source: string,
    position: { line: number; character: number },
  ) {
    return theoremTargetAtProofPosition(source, position)?.theorem
  }

  export function hasProofRegionsForTheorem(source: string, theorem: string | undefined) {
    if (!theorem) return false
    return parseProofObligations(source).some((block) => block.theorem === theorem)
  }

  function decompositionPlanNodeID(node: ProofPlanValue["nodes"][number]) {
    return node.node_id || node.paper_step_id
  }

  function normalizedMetadataList(values: string[]) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort()
  }

  function sameMetadataList(left: string[], right: string[]) {
    return JSON.stringify(normalizedMetadataList(left)) === JSON.stringify(normalizedMetadataList(right))
  }

  function normalizedMetadataText(value: string | undefined) {
    return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase()
  }

  function materializationTheoremSourceHash(source: string, theorem: string) {
    const span = theorem === "unspecified-theorem"
      ? undefined
      : theoremSpans(source).find((candidate) => candidate.name === theorem)
    const theoremSource = span ? source.slice(span.start, span.proofEnd ?? span.end) : undefined
    return hashText(normalizedSourceSnapshot(theoremSource ?? source))
  }

  function materializationPreviewFromBlocks(
    planState: DecompositionPlanState,
    blocks: ParsedBlock[],
    source: string,
  ) {
    const plan = planState.accepted_plan
    if (!plan || planState.status !== "accepted") return undefined
    const planNodes = new Map(plan.nodes.map((node) => [decompositionPlanNodeID(node), node]))
    const delegated = new Map(
      plan.nodes
        .filter((node) => node.delegation_candidate)
        .map((node) => [decompositionPlanNodeID(node), node]),
    )
    const theoremBlocks = blocks.filter(
      (block) => plan.theorem === "unspecified-theorem" || block.theorem === plan.theorem,
    )
    const observedByNode = new Map<string, ParsedBlock[]>()
    for (const block of theoremBlocks) {
      if (!block.proofPlanNode) continue
      observedByNode.set(block.proofPlanNode, [...(observedByNode.get(block.proofPlanNode) ?? []), block])
    }
    const expectedPlanNodes = [...delegated.keys()].sort()
    const observedPlanNodes = [...observedByNode.keys()].sort()
    const missingPlanNodes = expectedPlanNodes.filter((id) => !observedByNode.has(id))
    const duplicatePlanNodes = [...observedByNode.entries()]
      .filter(([, matches]) => matches.length > 1)
      .map(([id]) => id)
      .sort()
    const unexpectedRegions = theoremBlocks
      .filter((block) => {
        if (!block.proofPlanNode) return true
        if (delegated.has(block.proofPlanNode)) return false
        // A fresh plan may retain a previously compiler-checked region as a
        // named, non-delegated setup node.  It is safe to keep that solved
        // boundary in the file; only a pending region may enter the lemma
        // queue, and decompositionDispatchCheck rejects non-delegated nodes.
        return !planNodes.has(block.proofPlanNode) || block.pending
      })
      .map((block) => block.admit_id)
      .sort()
    const dependencyMismatches: DecompositionMaterializationReview["dependency_mismatches"] = []
    const metadataMismatches: string[] = []
    for (const [id, node] of delegated) {
      const block = observedByNode.get(id)?.[0]
      if (!block) continue
      if (!sameMetadataList(node.depends_on, block.dependsOn)) {
        dependencyMismatches.push({
          plan_node: id,
          expected: normalizedMetadataList(node.depends_on),
          observed: normalizedMetadataList(block.dependsOn),
        })
      }
      if (node.kind && block.kind !== node.kind) {
        metadataMismatches.push(`${id}: kind expected ${node.kind}, observed ${block.kind}`)
      }
      if (node.layer && normalizedMetadataText(block.layer) !== normalizedMetadataText(node.layer)) {
        metadataMismatches.push(`${id}: layer expected ${node.layer}, observed ${block.layer ?? "missing"}`)
      }
      const expectedNormalForm = node.target_normal_form ?? node.target?.normal_form
      if (
        expectedNormalForm &&
        normalizedMetadataText(expectedNormalForm) !== normalizedMetadataText(block.targetNormalForm)
      ) {
        metadataMismatches.push(`${id}: target normal form differs from the accepted plan`)
      }
    }
    const status =
      duplicatePlanNodes.length > 0 ||
      unexpectedRegions.length > 0 ||
      dependencyMismatches.length > 0 ||
      metadataMismatches.length > 0
        ? "drifted"
        : missingPlanNodes.length > 0
          ? "partial"
          : "matched"
    const currentTheoremSourceHash = materializationTheoremSourceHash(source, plan.theorem)
    const sourceChanged = planState.theorem_source_hash_before_materialization
      ? currentTheoremSourceHash !== planState.theorem_source_hash_before_materialization
      : sourceHash(source) !== planState.source_hash_before_materialization
    const ready =
      (sourceChanged &&
        (missingPlanNodes.length === 0 || Boolean(planState.materialization_review))) ||
      ((planState.repair_revision_number ?? 0) > 0 && status === "matched")
    const review = ready
      ? DecompositionMaterializationReview.parse({
          status,
          plan_semantic_fingerprint: planState.accepted_semantic_fingerprint,
          source_hash: sourceHash(source),
          theorem_source_hash: currentTheoremSourceHash,
          expected_plan_nodes: expectedPlanNodes,
          observed_plan_nodes: observedPlanNodes,
          missing_plan_nodes: missingPlanNodes,
          duplicate_plan_nodes: duplicatePlanNodes,
          unexpected_regions: unexpectedRegions,
          dependency_mismatches: dependencyMismatches,
          metadata_mismatches: metadataMismatches,
          reviewed_at: Date.now(),
        })
      : undefined
    return {
      status,
      ready,
      expected_plan_nodes: expectedPlanNodes,
      observed_plan_nodes: observedPlanNodes,
      missing_plan_nodes: missingPlanNodes,
      duplicate_plan_nodes: duplicatePlanNodes,
      unexpected_regions: unexpectedRegions,
      dependency_mismatches: dependencyMismatches,
      metadata_mismatches: metadataMismatches,
      review,
      known_plan_nodes: [...planNodes.keys()].sort(),
    }
  }

  export function previewDecompositionMaterialization(sessionID: string, file: string, source: string) {
    const target = boundTheoremTarget(sessionID, file, source)
    const planState = getDecompositionPlanState(sessionID, file, target?.theorem)
    if (!planState) return undefined
    const currentTheoremSourceHash = materializationTheoremSourceHash(source, planState.theorem)
    const storedReviewCurrent = Boolean(
      planState.materialization_review &&
        (planState.materialization_review.theorem_source_hash
          ? planState.materialization_review.theorem_source_hash === currentTheoremSourceHash
          : planState.materialization_review.source_hash === sourceHash(source)),
    )
    if (planState.materialization_review && storedReviewCurrent) {
      return {
        ready: true,
        expected_plan_nodes: planState.materialization_review.expected_plan_nodes,
        observed_plan_nodes: planState.materialization_review.observed_plan_nodes,
        missing_plan_nodes: planState.materialization_review.missing_plan_nodes,
        duplicate_plan_nodes: planState.materialization_review.duplicate_plan_nodes,
        unexpected_regions: planState.materialization_review.unexpected_regions,
        review: planState.materialization_review,
        known_plan_nodes: planState.accepted_plan?.nodes.map(decompositionPlanNodeID).sort() ?? [],
      }
    }
    return materializationPreviewFromBlocks(planState, parseProofObligations(source), source)
  }

  export function classifyDecompositionCheckpoint(sessionID: string, file: string, source: string) {
    const normalizedFile = normalizedWorkflowFile(file)
    const state = get(sessionID)
    const plan = state && normalizedWorkflowFile(state.file) === normalizedFile
      ? state.decomposition_plan
      : undefined
    const sourceFingerprint = sourceHash(source)
    if (!plan) {
      return {
        status: "incomplete" as const,
        terminal_ready: false,
        materialization_complete: false,
        source_hash: sourceFingerprint,
        blockers: ["no source-bound decomposition plan exists for the current proof session"],
      }
    }

    const theoremFingerprint = materializationTheoremSourceHash(source, plan.theorem)
    if (plan.status === "exhausted") {
      const terminalCurrent = Boolean(
        plan.terminal_verdict &&
          plan.terminal_verdict.source_hash === sourceFingerprint &&
          plan.terminal_verdict.theorem_source_hash === theoremFingerprint,
      )
      return {
        status: "incomplete" as const,
        terminal_ready: false,
        materialization_complete: false,
        source_hash: sourceFingerprint,
        theorem_source_hash: theoremFingerprint,
        theorem: plan.theorem,
        plan_status: plan.status,
        plan_fingerprint: plan.last_review.semantic_fingerprint,
        blockers: terminalCurrent
          ? plan.terminal_verdict?.blockers ?? []
          : ["the exhausted plan verdict does not match the current theorem source"],
        terminal_verdict: terminalCurrent ? plan.terminal_verdict : undefined,
      }
    }
    if (plan.status !== "accepted" || !plan.accepted_plan || !plan.accepted_semantic_fingerprint) {
      return {
        status: "incomplete" as const,
        terminal_ready: false,
        materialization_complete: false,
        source_hash: sourceFingerprint,
        theorem_source_hash: theoremFingerprint,
        theorem: plan.theorem,
        plan_status: plan.status,
        plan_fingerprint: plan.last_review.semantic_fingerprint,
        blockers: ["the decomposition plan has not been accepted for materialization"],
      }
    }

    const preview = materializationPreviewFromBlocks(plan, parseProofObligations(source), source)
    const review = preview?.review
    const complete = Boolean(
      review &&
        review.status === "matched" &&
        review.expected_plan_nodes.length > 0 &&
        review.missing_plan_nodes.length === 0 &&
        review.duplicate_plan_nodes.length === 0 &&
        review.unexpected_regions.length === 0 &&
        review.dependency_mismatches.length === 0 &&
        review.metadata_mismatches.length === 0,
    )
    const blockers = complete
      ? []
      : [
          !review ? "accepted plan has not been materialized into a source-bound reviewed skeleton" : undefined,
          review?.expected_plan_nodes.length === 0 ? "accepted plan has no delegated proof regions" : undefined,
          ...(review?.missing_plan_nodes.map((id) => `missing plan node ${id}`) ?? []),
          ...(review?.duplicate_plan_nodes.map((id) => `duplicate plan node ${id}`) ?? []),
          ...(review?.unexpected_regions.map((id) => `unexpected proof region ${id}`) ?? []),
          ...(review?.dependency_mismatches.map((entry) => `dependency mismatch for ${entry.plan_node}`) ?? []),
          ...(review?.metadata_mismatches ?? []),
        ].filter((entry): entry is string => Boolean(entry))
    return {
      status: complete ? ("ready" as const) : ("incomplete" as const),
      terminal_ready: complete,
      materialization_complete: complete,
      source_hash: sourceFingerprint,
      theorem_source_hash: theoremFingerprint,
      theorem: plan.theorem,
      plan_status: plan.status,
      plan_fingerprint: plan.accepted_semantic_fingerprint,
      blockers,
      materialization_review: review,
    }
  }

  function decompositionDispatchCheck(
    state: State,
    blocks: ParsedBlock[],
    block: ParsedBlock,
    source: string,
  ) {
    const planState = state.decomposition_plan
    // Preserve compatibility for a pre-existing, locality-checked skeleton
    // created before this bounded planning state existed.
    if (!planState) return { ok: true as const }
    if (planState.status !== "accepted" || !planState.accepted_plan) {
      return { ok: false as const, reason: `decomposition plan is ${planState.status}` }
    }
    const repairEvidence = (planState.repair_revision_number ?? 0) < 1
      ? acceptedPlanRepairEvidence(state, planState, source)
      : undefined
    const structuralRepairGuidance = repairEvidence
      ? `accepted-plan structural repair revision is available (${repairEvidence}); call proof_plan with the one evidence-backed structural repair revision, and do not dispatch a lemma until the revised DAG is accepted and materialized`
      : undefined

    // The persisted review remains one-time, but dispatch must audit the live
    // source so a later rogue or duplicate region cannot enter the lemma queue.
    const preview = materializationPreviewFromBlocks(planState, blocks, source)
    if (!preview?.review) {
      return {
        ok: false as const,
        reason: [
          "accepted plan materialization is incomplete",
          `expected_plan_nodes=[${preview?.expected_plan_nodes.join(", ") ?? ""}]`,
          `observed_plan_nodes=[${preview?.observed_plan_nodes.join(", ") ?? ""}]`,
          `missing_plan_nodes=[${preview?.missing_plan_nodes.join(", ") ?? ""}]`,
          `unexpected_regions=[${preview?.unexpected_regions.join(", ") ?? ""}]`,
          "update the proof_region begin marker's plan_node value to the accepted node ID; editing a nearby contract comment alone does not change the region mapping",
          structuralRepairGuidance,
        ].filter((part): part is string => Boolean(part)).join("; "),
      }
    }
    if (
      preview.missing_plan_nodes.length > 0 ||
      preview.duplicate_plan_nodes.length > 0 ||
      preview.unexpected_regions.length > 0
    ) {
      return {
        ok: false as const,
        reason: [
          "accepted plan materialization has structural drift",
          `expected_plan_nodes=[${preview.expected_plan_nodes.join(", ")}]`,
          `observed_plan_nodes=[${preview.observed_plan_nodes.join(", ")}]`,
          `missing_plan_nodes=[${preview.missing_plan_nodes.join(", ")}]`,
          `duplicate_plan_nodes=[${preview.duplicate_plan_nodes.join(", ")}]`,
          `unexpected_regions=[${preview.unexpected_regions.join(", ")}]`,
          `dependency_mismatches=[${preview.review.dependency_mismatches.map((entry) => entry.plan_node).join(", ")}]`,
          `metadata_mismatches=[${preview.review.metadata_mismatches.join(" | ")}]`,
          structuralRepairGuidance,
        ].filter((part): part is string => Boolean(part)).join("; "),
      }
    }

    const plan = planState.accepted_plan
    if (plan.theorem !== "unspecified-theorem" && block.theorem !== plan.theorem) {
      return { ok: false as const, reason: "proof region belongs to a different theorem" }
    }
    const node = plan.nodes.find(
      (candidate) => decompositionPlanNodeID(candidate) === block.proofPlanNode,
    )
    if (!node?.delegation_candidate) {
      return { ok: false as const, reason: "proof region is not an accepted delegation candidate" }
    }
    return { ok: true as const }
  }

  function computePhase(queue: QueueItem[]): Phase {
    const next = queue.find((item) => item.status !== "solved")
    if (!next) return queue.length > 0 ? "complete" : "architect"
    if (next.status !== "escalated") return "delegating"
    return "prover"
  }

  function currentCertificatesForSource(file: string, source: string, blocks: ParsedBlock[]) {
    const blocksByIdentity = new Map(
      blocks.map((block) => [`${block.theorem}\u0000${block.admit_id}`, block]),
    )
    const certificates = new Map<string, ValidationCertificate>()
    for (const { state } of statesForFile(file)) {
      for (const item of state.queue) {
        if (item.status !== "solved" || !item.validation_certificate) continue
        const identity = `${item.theorem}\u0000${item.admit_id}`
        const block = blocksByIdentity.get(identity)
        if (!block || !validationCertificateCurrent(item.validation_certificate, file, source, block)) continue
        const previous = certificates.get(identity)
        if (!previous || item.validation_certificate.validated_at > previous.validated_at) {
          certificates.set(identity, item.validation_certificate)
        }
      }
    }
    return certificates
  }

  export function validationCertificateID(certificate: ValidationCertificate) {
    return `proof-cert-${hashText([
      certificate.normalized_file,
      certificate.admit_id,
      certificate.region_fingerprint,
      certificate.source_hash,
      certificate.compiler_signature,
      certificate.validator,
    ].join("\n")).slice(0, 24)}`
  }

  export function currentValidationCertificates(file: string, source: string) {
    const normalized = normalizedWorkflowFile(file)
    const blocks = parseProofObligations(source)
    const blocksByIdentity = new Map(
      blocks.map((block) => [`${block.theorem}\u0000${block.admit_id}`, block]),
    )
    return [...currentCertificatesForSource(normalized, source, blocks)].flatMap(([identity, certificate]) => {
      const block = blocksByIdentity.get(identity)
      if (!block?.targetStatement) return []
      return [{
        certificate_id: validationCertificateID(certificate),
        theorem: block.theorem,
        admit_id: block.admit_id,
        target_fingerprint: ProofRouteLedger.premiseFingerprint(block.targetStatement),
        certificate,
      }]
    })
  }

  function mergeQueue(
    previous: State | undefined,
    blocks: ParsedBlock[],
    file: string,
    source: string,
    boundTheorem?: string,
  ) {
    const previousByAdmit = new Map(previous?.queue.map((item) => [item.admit_id, item]) ?? [])
    // A compiler certificate is an exact-prefix fact, not session-local
    // conversational state.  A child created after certification may safely
    // inherit it when the normalized file, theorem/admit identity, region
    // fingerprint, and prefix hash still match the source it is opening.
    const currentCertificates = currentCertificatesForSource(file, source, blocks)
    const queue = blocks.map<QueueItem>((block) => {
      const before = previousByAdmit.get(block.admit_id)
      const sameLogicalRegion = Boolean(before && before.theorem === block.theorem)
      const sameRegion = Boolean(
        sameLogicalRegion && before?.region_fingerprint && before.region_fingerprint === block.regionFingerprint,
      )
      const contentCarried = sameRegion ? before : undefined
      // Runtime ownership belongs to the delegated task, not to one immutable
      // source snapshot. A lemma is expected to change its assigned region, so
      // keep running/split ownership until its structured result, lease expiry,
      // or an explicit takeover releases it.
      const runtimeCarried =
        sameLogicalRegion && (before?.status === "running" || before?.status === "split") ? before : undefined
      const carried = runtimeCarried ?? contentCarried
      const validationCertificate = validationCertificateCurrent(before?.validation_certificate, file, source, block)
        ? before?.validation_certificate
        : currentCertificates.get(`${block.theorem}\u0000${block.admit_id}`)
      const validationFailure = validationFailureCurrent(contentCarried?.validation_failure, source, block)
        ? contentCarried?.validation_failure
        : undefined
      let status: BlockStatus = "pending"

      if (validationCertificate && !block.pending) status = "solved"
      else if (runtimeCarried) status = runtimeCarried.status
      else if (contentCarried?.status === "escalated") status = "escalated"
      else if (!block.pending) status = "unvalidated"

      return {
        order: block.order,
        owner: block.owner,
        theorem: block.theorem,
        admit_id: block.admit_id,
        start_line: block.startLine,
        end_line: block.endLine,
        status,
        task_id: carried?.task_id,
        kind: block.kind,
        target_name: block.targetName,
        proof_plan_node: block.proofPlanNode,
        depends_on: block.dependsOn,
        editable_mode: block.editableMode,
        region_start_line: block.editableMode === "region" ? block.startLine : undefined,
        region_end_line: block.editableMode === "region" ? block.endLine : undefined,
        escalation_type: contentCarried?.escalation_type,
        escalation_reason: contentCarried?.escalation_reason,
        remodel_request: contentCarried?.remodel_request,
        attempt_report: contentCarried?.attempt_report,
        region_fingerprint: block.regionFingerprint,
        validation_certificate: validationCertificate,
        validation_failure: validationFailure,
        context_audit_resume_count: status === "solved" ? undefined : carried?.context_audit_resume_count,
        context_audit_feedback: status === "solved" ? undefined : carried?.context_audit_feedback,
        running_started_at: status === "running" ? carried?.running_started_at : undefined,
        running_lease_expires_at: status === "running" ? carried?.running_lease_expires_at : undefined,
        running_release_reason: carried?.running_release_reason,
        takeover_agent: carried?.takeover_agent,
        takeover_reason: carried?.takeover_reason,
        takeover_at: carried?.takeover_at,
      }
    })

    const previousActive = previous?.active_admit_id
      ? previous.queue.find((item) => item.admit_id === previous.active_admit_id)
      : undefined
    const activeStillParsed = previousActive
      ? queue.some((item) => item.admit_id === previousActive.admit_id && item.theorem === previousActive.theorem)
      : false
    if (
      previousActive &&
      (!boundTheorem || previousActive.theorem === boundTheorem) &&
      !activeStillParsed &&
      (previousActive.status === "running" || previousActive.status === "split")
    ) {
      // Keep a detached runtime placeholder if an in-flight task temporarily
      // removes or rewrites its marker. Its structured result must still be
      // assessed; otherwise the scheduler could skip ahead or launch a duplicate.
      const insertAt = Math.max(0, Math.min(queue.length, previousActive.order - 1))
      queue.splice(insertAt, 0, {
        ...previousActive,
        validation_certificate: undefined,
        validation_failure: undefined,
      })
    }

    const first = firstReadyUnresolved(queue)
    const active = previous?.active_admit_id
    const activeItem = active && first?.admit_id === active ? queue.find((item) => item.admit_id === active) : undefined
    const activeAdmitID =
      activeItem && (activeItem.status === "running" || activeItem.status === "split") ? activeItem.admit_id : undefined
    const normalizedQueue = queue.map((item) =>
      (item.status === "running" || item.status === "split") && item.admit_id !== activeAdmitID
        ? {
            ...item,
            status: "pending" as const,
            task_id: undefined,
            running_started_at: undefined,
            running_lease_expires_at: undefined,
            running_release_reason: "running state normalized because another proof_region is the active blocker",
          }
        : item,
    )
    return {
      queue: normalizedQueue,
      active_admit_id: activeAdmitID,
      active_task_id: activeAdmitID ? activeItem?.task_id : undefined,
    }
  }

  function coerceQueueItem(item: unknown) {
    return QueueItem.parse(
      item && typeof item === "object"
        ? {
            ...item,
            owner: "lemma",
            kind: "kind" in item ? item.kind : "unknown",
            editable_mode: "region",
            status:
              "status" in item && item.status === "solved" && !("validation_certificate" in item)
                ? "unvalidated"
                : "status" in item
                  ? item.status
                  : "pending",
          }
        : item,
    )
  }

  function fromRow(row: typeof SessionProofWorkflowTable.$inferSelect) {
    const payload = JSON.parse(row.payload)
    if (payload && typeof payload === "object" && Array.isArray(payload.queue)) {
      payload.queue = payload.queue.map(coerceQueueItem)
      payload.phase = computePhase(payload.queue)
    }
    return State.parse(payload)
  }

  export function get(sessionID: string) {
    const hit = cache.get(sessionID)
    if (hit) return hit

    const row = Database.use((db) =>
      db.select().from(SessionProofWorkflowTable).where(eq(SessionProofWorkflowTable.session_id, sessionID)).get(),
    )
    if (!row) return undefined

    const state = fromRow(row)
    cache.set(sessionID, state)
    return state
  }

  function statesForFile(file: string) {
    const rows = Database.use((db) =>
      db.select().from(SessionProofWorkflowTable).where(eq(SessionProofWorkflowTable.file, file)).all(),
    )
    return rows.map((row) => ({
      sessionID: row.session_id,
      state: fromRow(row),
    }))
  }

  function sharedRepairHistory(file: string, current?: State) {
    const states = [...statesForFile(file).map((entry) => entry.state), ...(current ? [current] : [])]
    const resolutions = new Map<string, RepairIncidentResolution>()
    for (const state of states) {
      for (const resolution of state.repair_incident_resolutions ?? []) {
        const previous = resolutions.get(resolution.signature)
        if (!previous || resolution.resolved_at > previous.resolved_at) {
          resolutions.set(resolution.signature, resolution)
        }
      }
    }
    const incidents = new Map<string, RepairIncident>()
    for (const state of states) {
      for (const incident of state.repair_incidents ?? []) {
        const resolution = resolutions.get(incident.signature)
        if (resolution && resolution.resolved_at >= incident.updated_at) continue
        const previous = incidents.get(incident.signature)
        if (
          !previous ||
          incident.repeat_count > previous.repeat_count ||
          (incident.repeat_count === previous.repeat_count && incident.updated_at > previous.updated_at)
        ) {
          incidents.set(incident.signature, incident)
        }
      }
    }
    return {
      incidents: [...incidents.values()].sort((left, right) => left.updated_at - right.updated_at).slice(-MAX_REPAIR_INCIDENTS),
      resolutions: [...resolutions.values()].sort((left, right) => left.resolved_at - right.resolved_at).slice(-MAX_REPAIR_INCIDENTS),
    }
  }

  export function set(sessionID: string, state: State) {
    const previous = get(sessionID)
    const sameFile = previous && normalizedWorkflowFile(previous.file) === normalizedWorkflowFile(state.file)
    const decompositionPlan = Object.prototype.hasOwnProperty.call(state, "decomposition_plan")
      ? state.decomposition_plan
      : sameFile
        ? previous?.decomposition_plan
        : undefined
    const next = State.parse({
      ...state,
      repair_incidents: state.repair_incidents ?? previous?.repair_incidents,
      repair_incident_resolutions:
        state.repair_incident_resolutions ?? previous?.repair_incident_resolutions,
      decomposition_plan: decompositionPlan,
    })
    const now = Date.now()
    Database.use((db) =>
      db
        .insert(SessionProofWorkflowTable)
        .values({
          session_id: sessionID,
          file: next.file,
          payload: JSON.stringify(next),
          time_created: now,
          time_updated: now,
        })
        .onConflictDoUpdate({
          target: SessionProofWorkflowTable.session_id,
          set: {
            file: next.file,
            payload: JSON.stringify(next),
            time_updated: now,
          },
        })
        .run(),
    )
    cache.set(sessionID, next)
    return next
  }

  export function getDecompositionPlanState(sessionID: string, file?: string, theorem?: string) {
    const state = get(sessionID)
    const plan = state?.decomposition_plan
    if (!plan) return undefined
    if (file && normalizedWorkflowFile(plan.file) !== normalizedWorkflowFile(file)) return undefined
    if (theorem && plan.theorem !== theorem) return undefined
    return plan
  }

  function recoverAcceptedDecompositionPlan(file: string, source: string, theorem: string) {
    const normalizedFile = normalizedWorkflowFile(file)
    const theoremSpan = theoremSpans(source).find((candidate) => candidate.name === theorem)
    if (!theoremSpan?.rootGoal) return undefined
    const theoremSourceHash = materializationTheoremSourceHash(source, theorem)
    const fullSourceHash = sourceHash(source)
    const blocks = parseProofObligations(source)

    const compatible = statesForFile(normalizedFile).flatMap(({ state }) => {
      const plan = state.decomposition_plan
      if (
        !plan ||
        plan.status !== "accepted" ||
        !plan.accepted_plan ||
        !plan.accepted_semantic_fingerprint ||
        plan.theorem !== theorem ||
        normalizedWorkflowFile(plan.file) !== normalizedFile ||
        normalizeTargetShape(plan.root_goal) !== normalizeTargetShape(theoremSpan.rootGoal)
      ) {
        return []
      }

      const unchangedBaseline = plan.theorem_source_hash_before_materialization
        ? plan.theorem_source_hash_before_materialization === theoremSourceHash
        : plan.source_hash_before_materialization === fullSourceHash
      if (unchangedBaseline) return [plan]

      // A fresh session may start after part of the accepted DAG was already
      // materialized. Reuse the plan only when the current theorem contains at
      // least one recognized plan node and no structural or metadata drift.
      const preview = materializationPreviewFromBlocks(plan, blocks, source)
      if (!preview || preview.observed_plan_nodes.length === 0 || preview.status === "drifted") return []
      return [plan]
    })

    return compatible.sort(
      (left, right) => (right.accepted_at ?? right.updated) - (left.accepted_at ?? left.updated),
    )[0]
  }

  function acceptedPlanRepairEvidence(state: State, plan: DecompositionPlanState, source: string) {
    if (state.queue.some((item) => item.theorem === plan.theorem && (item.status === "running" || item.status === "split"))) {
      return undefined
    }
    const repair = state.active_repair
    if (repair?.theorem === plan.theorem && structuralEscalation(repair.escalation_type)) {
      return `active theorem repair ${repair.escalation_type}: ${repair.reason}`
    }
    const escalated = state.queue.find(
      (item) => item.theorem === plan.theorem && item.status === "escalated" && structuralEscalation(item.escalation_type),
    )
    if (escalated?.escalation_type) {
      return `proof_region ${escalated.admit_id} escalated with ${escalated.escalation_type}: ${escalated.escalation_reason ?? "structural remodel required"}`
    }
    const preview = materializationPreviewFromBlocks(plan, parseProofObligations(source), source)
    if (
      preview?.review?.status === "drifted" &&
      (plan.administrative_reconciliation_count ?? 0) >= 1
    ) {
      return "materialization remains structurally drifted after the one administrative marker reconciliation"
    }
    return undefined
  }

  const ROUTE_REPAIR_HARD_ERRORS = new Set([
    "candidate_interface_mismatch",
    "candidate_premise_audit_error",
    "candidate_unresolved_premise",
    "candidate_premise_dependency_missing",
    "candidate_premise_dependency_target_mismatch",
    "candidate_premise_certificate_missing",
    "candidate_premise_local_evidence_invalid",
    "candidate_premise_certificate_invalid",
    "verified_failed_route_reuse",
    "verified_failed_route_requires_audit",
  ])

  const MECHANICAL_PLAN_HARD_ERRORS = new Set([
    "duplicate_node_id",
    "unknown_edge_endpoint",
    "self_cycle",
    "duplicate_composition_step",
    "dependency_use_unknown_producer",
    "dependency_output_anchor_mismatch",
  ])

  function hasOnlyRouteRepairHardErrors(review: ProofPlanReviewValue) {
    return review.hard_errors.length > 0 && review.hard_errors.every((issue) => ROUTE_REPAIR_HARD_ERRORS.has(issue.code))
  }

  function hasOnlyMechanicalPlanHardErrors(review: ProofPlanReviewValue) {
    return review.hard_errors.length > 0 && review.hard_errors.every((issue) => MECHANICAL_PLAN_HARD_ERRORS.has(issue.code))
  }

  function hasPendingAcceptedPlanRouteRepair(plan: DecompositionPlanState) {
    return Boolean(
      (plan.repair_revision_number ?? 0) >= 1 &&
      plan.last_review.semantic_fingerprint !== plan.accepted_semantic_fingerprint &&
      hasOnlyRouteRepairHardErrors(plan.last_review),
    )
  }

  function rejectedPlanScore(review: ProofPlanReviewValue) {
    return [review.hard_errors.length, review.warnings.length] as const
  }

  function shouldReplaceBestRejectedPlan(
    previous: ProofPlanReviewValue | undefined,
    candidate: ProofPlanReviewValue,
  ) {
    if (!previous) return true
    const [candidateHard, candidateWarnings] = rejectedPlanScore(candidate)
    const [previousHard, previousWarnings] = rejectedPlanScore(previous)
    if (candidateHard !== previousHard) return candidateHard < previousHard
    // Prefer the newer candidate on a tie so a corrected explanation or
    // premise audit is retained without treating it as accepted progress.
    return candidateWarnings <= previousWarnings
  }

  function decompositionFailureFingerprint(review: ProofPlanReviewValue) {
    const hardErrors = review.hard_errors
      .map((entry) => ({
        code: entry.code,
        node_id: entry.node_id ?? "",
        message: entry.message.replace(/\s+/g, " ").trim(),
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    return hashText(JSON.stringify({
      semantic_fingerprint: review.semantic_fingerprint,
      hard_errors: hardErrors,
    }))
  }

  export function getAcceptedPlanRepairEligibility(sessionID: string, file: string, source: string) {
    const state = get(sessionID)
    const plan = state?.decomposition_plan
    if (
      !state ||
      !plan ||
      plan.status !== "accepted" ||
      !plan.accepted_plan ||
      normalizedWorkflowFile(state.file) !== normalizedWorkflowFile(file)
    ) {
      return { available: false as const, mode: undefined, reason: "no accepted plan is bound to this theorem" }
    }
    if ((plan.repair_revision_number ?? 0) >= 1 && !hasPendingAcceptedPlanRouteRepair(plan)) {
      return {
        available: false as const,
        mode: undefined,
        reason: "the one accepted-plan repair revision has already been used",
      }
    }
    if (hasPendingAcceptedPlanRouteRepair(plan)) {
      return {
        available: true as const,
        mode: "route_repair" as const,
        reason:
          "the single accepted-plan repair DAG is already reserved; correct only its candidate lemma, instantiation, or premise-source audit without changing that DAG",
      }
    }
    const evidence = acceptedPlanRepairEvidence(state, plan, source)
    if (!evidence) {
      return {
        available: false as const,
        mode: undefined,
        reason: "no compiler, remodel, or post-reconciliation drift evidence permits reopening the accepted plan",
      }
    }
    return { available: true as const, mode: "structural_revision" as const, reason: evidence }
  }

  export function recordDecompositionPlanAttempt(input: {
    sessionID: string
    file: string
    source: string
    plan: ProofPlanValue
    review: ProofPlanReviewValue
  }) {
    const file = normalizedWorkflowFile(input.file)
    const existingWorkflow = get(input.sessionID)
    const sameWorkflowFile = existingWorkflow && normalizedWorkflowFile(existingWorkflow.file) === file
    const sameWorkflowTarget = Boolean(
      sameWorkflowFile && existingWorkflow?.decomposition_plan?.theorem === input.plan.theorem,
    )
    // A proof session is bound to one theorem target in one Coq file. Do not
    // let wording-only theorem/root-goal changes manufacture a fresh planning
    // scope and bypass an accepted or exhausted decomposition state.
    let scoped = sameWorkflowTarget ? existingWorkflow?.decomposition_plan : undefined
    const reviewedPlan = ProofPlan.parse({ ...input.plan, review: input.review })

    if (scoped?.status === "accepted" && scoped.accepted_plan) {
      const sameSemanticPlan = scoped.accepted_semantic_fingerprint === input.review.semantic_fingerprint
      const pendingRouteRepair = hasPendingAcceptedPlanRouteRepair(scoped)
      const samePendingRepair = Boolean(
        pendingRouteRepair &&
        scoped.last_review.semantic_fingerprint === input.review.semantic_fingerprint,
      )
      const repairEvidence = (existingWorkflow
        ? acceptedPlanRepairEvidence(existingWorkflow, scoped, input.source)
        : undefined) ?? scoped.repair_revision_reason
      if (
        sameSemanticPlan ||
        ((scoped.repair_revision_number ?? 0) >= 1 && !samePendingRepair) ||
        !repairEvidence
      ) {
        return {
          state: scoped,
          recommended_action: "materialize_accepted_plan" as const,
          same_semantic_plan: sameSemanticPlan,
          accepted_plan_locked: true,
        }
      }

      const now = Date.now()
      const attempted = scoped.attempted_semantic_fingerprints.includes(input.review.semantic_fingerprint)
        ? scoped.attempted_semantic_fingerprints
        : [...scoped.attempted_semantic_fingerprints, input.review.semantic_fingerprint]
      if (!input.review.materialization_allowed) {
        const rejectedRepair = DecompositionPlanState.parse({
          ...scoped,
          attempted_semantic_fingerprints: attempted,
          last_candidate_plan: reviewedPlan,
          last_review: input.review,
          repair_revision_number: 1,
          repair_revision_reason: repairEvidence,
          updated: now,
        })
        set(input.sessionID, {
          ...existingWorkflow!,
          decomposition_plan: rejectedRepair,
          updated: now,
        })
        return {
          state: rejectedRepair,
          recommended_action: hasOnlyRouteRepairHardErrors(input.review)
            ? "repair_plan_route" as const
            : "stop_and_report_best_plan" as const,
          same_semantic_plan: false,
          accepted_plan_locked: true,
        }
      }

      const replacementBaseline = DecompositionPlanState.parse({
        ...scoped,
        root_goal: input.plan.root_goal,
        source_hash_before_materialization: sourceHash(input.source),
        theorem_source_hash_before_materialization: materializationTheoremSourceHash(input.source, input.plan.theorem),
        attempted_semantic_fingerprints: attempted,
        last_candidate_plan: reviewedPlan,
        last_review: input.review,
        accepted_plan: reviewedPlan,
        accepted_semantic_fingerprint: input.review.semantic_fingerprint,
        accepted_at: now,
        repair_revision_number: 1,
        repair_revision_reason: repairEvidence,
        administrative_reconciliation_count: 0,
        materialization_review: undefined,
        terminal_verdict: undefined,
        updated: now,
      })
      const existingMatchedReview = materializationPreviewFromBlocks(
        replacementBaseline,
        parseProofObligations(input.source),
        input.source,
      )?.review
      const replacement = existingMatchedReview
        ? DecompositionPlanState.parse({
            ...replacementBaseline,
            materialization_review: existingMatchedReview,
          })
        : replacementBaseline
      set(input.sessionID, {
        ...existingWorkflow!,
        phase: "architect",
        queue: [],
        active_admit_id: undefined,
        active_task_id: undefined,
        latest_escalation: undefined,
        active_repair: undefined,
        fallback_guard: undefined,
        decomposition_plan: replacement,
        updated: now,
      })
      return {
        state: replacement,
        recommended_action: "materialize_once" as const,
        same_semantic_plan: false,
        accepted_plan_locked: true,
      }
    }
    if (scoped?.status === "exhausted") {
      const generation = scoped.planning_generation ?? 0
      if (scoped.terminal_verdict?.recoverable === true && generation < MAX_PLAN_RECOVERY_GENERATIONS) {
        // Start one bounded recovery generation in the same proof session. The
        // prior best rejected plan remains diagnostic input, never an accepted
        // or materializable plan.
        scoped = DecompositionPlanState.parse({
          ...scoped,
          attempted_semantic_fingerprints: [],
          semantic_revision_number: 0,
          planning_generation: generation + 1,
          status: "planning",
          exhausted_at: undefined,
          terminal_verdict: undefined,
          updated: Date.now(),
        })
      } else {
        return {
          state: scoped,
          recommended_action: "stop_and_report_best_plan" as const,
          same_semantic_plan: scoped.attempted_semantic_fingerprints.includes(input.review.semantic_fingerprint),
          accepted_plan_locked: false,
        }
      }
    }

    const previousAttempts = scoped?.attempted_semantic_fingerprints ?? []
    const sameSemanticPlan = previousAttempts.includes(input.review.semantic_fingerprint)
    const previousMechanicalRepair = Boolean(scoped && hasOnlyMechanicalPlanHardErrors(scoped.last_review))
    const currentMechanicalRepair = hasOnlyMechanicalPlanHardErrors(input.review)
    const mechanicalRepair = previousMechanicalRepair || currentMechanicalRepair
    const maxDistinctPlans = MAX_SEMANTIC_PLAN_REVISIONS + 1
    const newPlanBeyondBudget = !sameSemanticPlan && !mechanicalRepair && previousAttempts.length >= maxDistinctPlans
    const attempted = sameSemanticPlan || newPlanBeyondBudget || mechanicalRepair
      ? [...previousAttempts]
      : [...previousAttempts, input.review.semantic_fingerprint]
    const semanticRevisionNumber = Math.max(0, attempted.length - 1)
    const now = Date.now()
    // Candidate-lemma and premise-source repairs do not change the semantic
    // DAG fingerprint. If the previous rejection was exclusively a mechanical
    // route/premise gate and the current review now passes, accept the repaired
    // route without consuming a semantic re-decomposition revision.
    const resolvedRouteRepair = Boolean(
      sameSemanticPlan &&
      scoped &&
      hasOnlyRouteRepairHardErrors(scoped.last_review) &&
      input.review.materialization_allowed,
    )
    const pendingRouteRepair = !newPlanBeyondBudget && hasOnlyRouteRepairHardErrors(input.review)
    const accepted =
      !newPlanBeyondBudget && input.review.materialization_allowed && (!sameSemanticPlan || resolvedRouteRepair)
    const exhausted =
      newPlanBeyondBudget ||
      (!accepted &&
        !pendingRouteRepair &&
        !mechanicalRepair &&
        (sameSemanticPlan || semanticRevisionNumber >= MAX_SEMANTIC_PLAN_REVISIONS))
    const status: DecompositionPlanStatus = accepted ? "accepted" : exhausted ? "exhausted" : "planning"
    const planningGeneration = scoped?.planning_generation ?? 0
    const candidateIsRejected = !input.review.materialization_allowed
    const replaceBestRejected = candidateIsRejected && shouldReplaceBestRejectedPlan(
      scoped?.best_rejected_review,
      input.review,
    )
    const bestRejectedPlan = replaceBestRejected
      ? reviewedPlan
      : scoped?.best_rejected_plan
    const bestRejectedReview = replaceBestRejected
      ? input.review
      : scoped?.best_rejected_review
    const failureFingerprint = exhausted ? decompositionFailureFingerprint(input.review) : undefined
    const generationFailureFingerprints = failureFingerprint
      ? [...new Set([...(scoped?.generation_failure_fingerprints ?? []), failureFingerprint])]
      : scoped?.generation_failure_fingerprints
    const recoverable = exhausted && planningGeneration < MAX_PLAN_RECOVERY_GENERATIONS
    const terminalVerdict = exhausted
      ? DecompositionTerminalVerdict.parse({
          status: "semantic_incomplete",
          source_hash: sourceHash(input.source),
          theorem_source_hash: materializationTheoremSourceHash(input.source, input.plan.theorem),
          semantic_fingerprint: input.review.semantic_fingerprint,
          blockers: (bestRejectedReview?.hard_errors.length ?? 0) > 0
            ? bestRejectedReview!.hard_errors.map(
                (entry) => `${entry.code}${entry.node_id ? ` (${entry.node_id})` : ""}: ${entry.message}`,
              )
            : ["semantic revision budget exhausted without an accepted plan"],
          recoverable,
          planning_generation: planningGeneration,
          failure_fingerprint: failureFingerprint,
          best_semantic_fingerprint: bestRejectedReview?.semantic_fingerprint ?? input.review.semantic_fingerprint,
          evaluated_at: now,
        })
      : undefined
    const nextPlan = DecompositionPlanState.parse({
      file,
      theorem: input.plan.theorem,
      root_goal: input.plan.root_goal,
      source_hash_before_materialization: accepted
        ? sourceHash(input.source)
        : scoped?.source_hash_before_materialization ?? sourceHash(input.source),
      theorem_source_hash_before_materialization: accepted
        ? materializationTheoremSourceHash(input.source, input.plan.theorem)
        : scoped?.theorem_source_hash_before_materialization,
      attempted_semantic_fingerprints: attempted,
      semantic_revision_number: semanticRevisionNumber,
      planning_generation: planningGeneration,
      generation_failure_fingerprints: generationFailureFingerprints,
      status,
      last_candidate_plan: reviewedPlan,
      last_review: input.review,
      best_rejected_plan: bestRejectedPlan,
      best_rejected_review: bestRejectedReview,
      accepted_plan: accepted ? reviewedPlan : undefined,
      accepted_semantic_fingerprint: accepted ? input.review.semantic_fingerprint : undefined,
      accepted_at: accepted ? now : undefined,
      exhausted_at: exhausted ? now : undefined,
      repair_revision_number: 0,
      administrative_reconciliation_count: 0,
      terminal_verdict: terminalVerdict,
      updated: now,
    })
    const workflowBase: State = sameWorkflowTarget && existingWorkflow
      ? existingWorkflow
      : {
          file,
          phase: "architect",
          queue: [],
          updated: now,
        }
    set(input.sessionID, {
      ...workflowBase,
      file,
      decomposition_plan: nextPlan,
      updated: now,
    })

    const recommendedAction: DecompositionPlanAction = accepted
      ? "materialize_once"
      : mechanicalRepair
        ? "repair_plan_metadata"
      : pendingRouteRepair
        ? "repair_plan_route"
      : exhausted
        ? recoverable
          ? "start_new_plan_generation"
          : "stop_and_report_best_plan"
        : sameSemanticPlan
          ? "do_not_retry_metadata_only_plan"
          : "revise_semantic_dag"
    return {
      state: nextPlan,
      recommended_action: recommendedAction,
      same_semantic_plan: sameSemanticPlan,
      accepted_plan_locked: false,
    }
  }

  export function clear(sessionID: string) {
    Database.use((db) =>
      db.delete(SessionProofWorkflowTable).where(eq(SessionProofWorkflowTable.session_id, sessionID)).run(),
    )
    cache.delete(sessionID)
    activeLemmaAssignments.delete(sessionID)
    activeRepairWorkerAssignments.delete(sessionID)
    proofTaskWorkerSessions.delete(sessionID)
    validatedLemmaSources.delete(sessionID)
    lemmaResumesMissingBaseline.delete(sessionID)
    proofProgressSnapshots.delete(sessionID)
    proofFailureSnapshots.delete(sessionID)
    releaseBoundProofScopeSession(sessionID)
  }

  export function bindActiveLemmaAssignment(
    sessionID: string,
    assignment: LemmaAssignment,
    validatedSource?: string,
    mode: "fresh" | "resume" = "fresh",
  ) {
    const previous = activeLemmaAssignments.get(sessionID)
    const sameAssignment = Boolean(
      previous &&
        previous.admit_id === assignment.admit_id &&
        previous.theorem === assignment.theorem &&
        assignmentFilePath(previous) === assignmentFilePath(assignment),
    )
    activeLemmaAssignments.set(sessionID, assignment)
    if (mode === "fresh") {
      lemmaResumesMissingBaseline.delete(sessionID)
      if (!sameAssignment) validatedLemmaSources.get(sessionID)?.delete(assignmentFilePath(assignment))
      if (validatedSource !== undefined)
        setValidatedLemmaSource(sessionID, assignmentFilePath(assignment), validatedSource)
      return
    }

    // Resuming rebinds the assignment but never blesses the current working
    // tree as the last compiler-validated prefix. Preserve the existing cursor;
    // if it is unavailable (for example after a process restart), require a
    // fresh validation before the resumed agent may edit further.
    if (!sameAssignment || !getValidatedLemmaSource(sessionID, assignmentFilePath(assignment))) {
      lemmaResumesMissingBaseline.add(sessionID)
    } else {
      lemmaResumesMissingBaseline.delete(sessionID)
    }
  }

  export function activeLemmaAssignment(sessionID: string) {
    return activeLemmaAssignments.get(sessionID)
  }

  export function assignedRegionSessionContext(
    sessionID: string,
    file: string,
    theorem: string,
    source: string,
    admitID?: string,
  ) {
    const assignment = activeLemmaAssignments.get(sessionID)
    if (!assignment) return undefined
    if (assignment.theorem !== theorem) return undefined
    if (assignmentFilePath(assignment) !== normalizedWorkflowFile(file)) return undefined
    if (admitID && assignment.admit_id !== admitID) return undefined

    const parsed = parseProofObligations(source).filter((block) => block.theorem === theorem)
    const block = parsed.find((candidate) => candidate.admit_id === assignment.admit_id)
    if (!block) {
      throw new Error(`session_state_desync: assigned proof_region ${assignment.admit_id} is absent from ${file}`)
    }
    const state = refresh(sessionID, file, source).state
    const item = state.queue.find((candidate) => candidate.admit_id === assignment.admit_id)
    if (!item) throw new Error(`session_state_desync: assigned proof_region ${assignment.admit_id} is not live`)
    const byNode = new Map(state.queue.map((candidate) => [queueItemNodeID(candidate), candidate]))
    const uncertifiedDependency = item.depends_on
      .map((dependency) => byNode.get(dependency))
      .find((candidate) => candidate && candidate.status !== "solved")
    if (uncertifiedDependency) {
      throw new Error(
        `session_state_desync: cannot open ${assignment.admit_id} before declared dependency ${uncertifiedDependency.admit_id} is compiler-certified`,
      )
    }

    const proofPosition = proofBlockEntryPosition(source, block)
    const offset = sourceOffset(source, proofPosition.line, proofPosition.character)
    if (offset === undefined || offset <= block.blockStart || offset >= (block.regionEnd ?? block.endIndex + 1)) {
      throw new Error(`session_state_desync: invalid proof entry position for ${assignment.admit_id}`)
    }
    const prefix = source.slice(0, offset)
    return {
      assignment,
      proof_position: proofPosition,
      prefix,
      source_hash: sourceHash(source),
      certified_prefix_fingerprint: hashText(prefix),
      expected_goal: assignment.goal,
      expected_goal_fingerprint: assignment.goal_fingerprint ?? semanticGoalFingerprint(assignment.goal),
    }
  }

  function recoverLemmaBaseline(sessionID: string, file: string, source: string) {
    setValidatedLemmaSource(sessionID, file, source)
  }

  export function refresh(sessionID: string, file: string, source: string) {
    const previous = get(sessionID)
    const target = boundTheoremTarget(sessionID, file, source)
    const parsedBlocks = parseProofObligations(source).filter(
      (block) => !target || block.theorem === target.theorem,
    )
    const merged = mergeQueue(previous, parsedBlocks, file, source, target?.theorem)
    let decompositionPlan = previous?.decomposition_plan
    if (!decompositionPlan && target) {
      decompositionPlan = recoverAcceptedDecompositionPlan(file, source, target.theorem)
    }
    if (target && decompositionPlan?.theorem !== target.theorem) decompositionPlan = undefined
    if (
      decompositionPlan?.status === "accepted" &&
      normalizedWorkflowFile(decompositionPlan.file) === normalizedWorkflowFile(file)
    ) {
      const currentTheoremSourceHash = materializationTheoremSourceHash(source, decompositionPlan.theorem)
      const previousReview = decompositionPlan.materialization_review
      const previousReviewCurrent = Boolean(
        previousReview &&
          (previousReview.theorem_source_hash
            ? previousReview.theorem_source_hash === currentTheoremSourceHash
            : previousReview.source_hash === sourceHash(source)),
      )
      let administrativeReconciliationCount = decompositionPlan.administrative_reconciliation_count ?? 0
      if (
        previousReview?.status === "drifted" &&
        !previousReviewCurrent &&
        administrativeReconciliationCount < 1
      ) {
        administrativeReconciliationCount += 1
      }
      const preview = previousReviewCurrent
        ? undefined
        : materializationPreviewFromBlocks(decompositionPlan, parsedBlocks, source)
      const materializationReview = previousReviewCurrent ? previousReview : preview?.review
      if (
        materializationReview !== previousReview ||
        administrativeReconciliationCount !== (decompositionPlan.administrative_reconciliation_count ?? 0)
      ) {
        decompositionPlan = DecompositionPlanState.parse({
          ...decompositionPlan,
          administrative_reconciliation_count: administrativeReconciliationCount,
          materialization_review: materializationReview,
          updated: Date.now(),
        })
      }
    }
    const remodelPendingValidation = ProofEditTransaction.requiresValidation(sessionID, file)
    const activeRepair =
      previous?.active_repair &&
      (!target || previous.active_repair.theorem === target.theorem) &&
      merged.queue.some(
        (item) =>
          item.theorem === previous.active_repair?.theorem &&
          item.admit_id === previous.active_repair?.admit_id,
      ) &&
      // theorem_fingerprint is the exact revision hash (comments and markers
      // included). Once that revision changes, the old repair and its guard
      // may remain useful history, but they no longer own the live queue.
      (remodelPendingValidation ||
        (previous.active_repair.theorem_fingerprint
          ? previous.active_repair.theorem_fingerprint === theoremFingerprint(source, previous.active_repair.theorem)
          : !previous.active_repair.source_fingerprint ||
            previous.active_repair.source_fingerprint === repairSourceFingerprint(source, previous.active_repair.theorem)))
        ? previous.active_repair
        : undefined
    // A guard is revision-scoped. It cannot survive removal of its admit_id or
    // block a real queue reconstructed from a newer theorem revision.
    const fallbackGuard =
      activeRepair && previous?.fallback_guard?.blocker_admit_id === activeRepair.admit_id
        ? previous.fallback_guard
        : undefined
    const sharedRepair = sharedRepairHistory(file, previous)
    const state = set(sessionID, {
      file,
      phase: computePhase(merged.queue),
      queue: merged.queue,
      active_admit_id: merged.active_admit_id,
      active_task_id: merged.active_task_id,
      latest_escalation: previous?.latest_escalation && merged.queue.some((item) => {
        if (item.admit_id !== previous.latest_escalation?.admit_id || item.status !== "escalated") return false
        const previousItem = previous.queue.find(
          (entry) => entry.admit_id === previous.latest_escalation?.admit_id,
        )
        return !previousItem || previousItem.theorem === item.theorem
      })
        ? previous.latest_escalation
        : undefined,
      active_repair: activeRepair,
      fallback_guard: fallbackGuard,
      repair_incidents: sharedRepair.incidents,
      repair_incident_resolutions: sharedRepair.resolutions,
      decomposition_plan: decompositionPlan,
      last_progress_receipt: previous?.last_progress_receipt,
      last_structural_progress_receipt: previous?.last_structural_progress_receipt,
      last_debug_progress_receipt: previous?.last_debug_progress_receipt,
      updated: Date.now(),
    })
    return {
      state,
      parsed: new Map(parsedBlocks.map((block) => [block.admit_id, block])),
    }
  }

  export function recordSourceMutation(file: string, source: string) {
    if (!file.endsWith(".v")) return []
    const normalized = normalizedWorkflowFile(file)
    const refreshed: string[] = []
    let states: ReturnType<typeof statesForFile>
    try {
      states = statesForFile(normalized)
    } catch (error) {
      log.error("failed to enumerate proof workflows after source mutation", {
        file: normalized,
        error,
      })
      return refreshed
    }
    for (const { sessionID } of states) {
      try {
        refresh(sessionID, normalized, source)
        refreshed.push(sessionID)
      } catch (error) {
        // The filesystem mutation has already committed by the time this hook
        // runs. A stale auxiliary workflow record must not turn that successful
        // edit into a tool failure that the agent may retry destructively.
        log.error("failed to refresh proof workflow after source mutation", {
          sessionID,
          file: normalized,
          error,
        })
      }
    }
    return refreshed
  }

  export async function assertFreshLemmaAssignmentOrder(
    sessionID: string,
    file: string,
    assignment: Pick<LemmaAssignment, "admit_id">,
  ) {
    if (!(await Filesystem.exists(file))) return

    const source = await ProofEditTransaction.readSource(sessionID, file)
    const { state } = refresh(sessionID, file, source)
    if (state.queue.length === 0) return

    const next = firstReadyUnresolved(state.queue)
    if (!next) {
      throw new Error(`fresh lemma delegation is blocked because every proof_region in ${file} is already solved`)
    }

    const current =
      next.status === "running"
        ? releaseExpiredRunningIfNeeded(sessionID, state, next, "running lease expired before fresh lemma delegation")
        : state
    const currentNext = current === state ? next : firstReadyUnresolved(current.queue)
    if (!currentNext) return

    if (currentNext.admit_id !== assignment.admit_id) {
      throw new Error(
        `fresh lemma delegation must follow the accepted DAG-ready queue: next eligible proof_region is ${currentNext.admit_id} (${currentNext.status}); cannot delegate ${assignment.admit_id} until its declared producer dependencies are compiler-certified`,
      )
    }

    if (currentNext.status !== "pending") {
      throw new Error(
        `fresh lemma delegation for admit_id ${assignment.admit_id} is blocked because that proof_region is ${currentNext.status}; resume, repair, or close it before launching another fresh lemma task`,
      )
    }
  }

  export async function assertFreshLemmaAssignmentLocality(
    sessionID: string,
    file: string,
    assignment: Pick<LemmaAssignment, "admit_id">,
    sourceOverride?: string,
  ) {
    if (!(await Filesystem.exists(file))) {
      throw new Error(
        `fresh lemma delegation requires an existing Coq file with a locality-checked proof_region; file not found: ${file}`,
      )
    }

    const source = sourceOverride ?? await ProofEditTransaction.readSource(sessionID, file)
    const { state, parsed } = refresh(sessionID, file, source)
    if (state.queue.length === 0) {
      throw new Error(
        `fresh lemma delegation requires a proof_region owner: lemma with a locality certificate in ${file}; a bare admit or theorem-level skeleton is not lemma-ready`,
      )
    }

    const next = firstReadyUnresolved(state.queue)
    if (!next) {
      throw new Error(`fresh lemma delegation is blocked because every proof_region in ${file} is already solved`)
    }

    const current =
      next.status === "running"
        ? releaseExpiredRunningIfNeeded(sessionID, state, next, "running lease expired before fresh lemma delegation")
        : state
    const currentNext = current === state ? next : firstReadyUnresolved(current.queue)
    if (!currentNext) {
      throw new Error(`fresh lemma delegation is blocked because every proof_region in ${file} is already solved`)
    }

    if (currentNext.admit_id !== assignment.admit_id) {
      throw new Error(
        `fresh lemma delegation must follow the accepted DAG-ready queue: next eligible proof_region is ${currentNext.admit_id} (${currentNext.status}); cannot delegate ${assignment.admit_id} until its declared producer dependencies are compiler-certified`,
      )
    }

    if (currentNext.status !== "pending" && !(currentNext.status === "running" && !currentNext.task_id)) {
      throw new Error(
        `fresh lemma delegation for admit_id ${assignment.admit_id} is blocked because that proof_region is ${currentNext.status}; resume, repair, or close it before launching another fresh lemma task`,
      )
    }

    const block = parsed.get(currentNext.admit_id)
    if (!block) {
      throw new Error(
        `fresh lemma delegation for admit_id ${assignment.admit_id} is blocked because its proof_region could not be parsed`,
      )
    }

    if (currentNext.target_name && !block.targetStatement) {
      throw new Error(
        `proof_region ${currentNext.admit_id} must wrap exported target statement ${currentNext.target_name} together with its proof block; current markers do not include that target statement inside the region`,
      )
    }

    const checked = checkedLemmaAssignment(state, [...parsed.values()], file, currentNext, block, source)
    if (!checked.ok) throw new Error(checked.reason)
    return checked.assignment
  }

  export async function assertRepairAssignmentCurrent(
    sessionID: string,
    file: string,
    assignment: ProofRepairAssignment,
    sourceOverride?: string,
  ) {
    if (!(await Filesystem.exists(file))) {
      throw new Error(`proof_repair_assignment_stale_revision: target file no longer exists: ${file}`)
    }

    const source = sourceOverride ?? await ProofEditTransaction.readSource(sessionID, file)
    const { state } = refresh(sessionID, file, source)
    const item = state.queue.find((entry) => entry.admit_id === assignment.admit_id)
    const currentSourceFingerprint = repairSourceFingerprint(source, assignment.theorem)
    const currentUnresolved = state.queue
      .filter((entry) => entry.status !== "solved")
      .map((entry) => `${entry.admit_id}:${entry.status}`)
      .join(", ") || "none"
    const stale =
      !item ||
      item.status !== "escalated" ||
      (assignment.region_fingerprint !== undefined &&
        item.region_fingerprint !== assignment.region_fingerprint) ||
      (assignment.source_fingerprint !== undefined &&
        assignment.source_fingerprint !== currentSourceFingerprint) ||
      (item.escalation_reason !== undefined &&
        normalizedRepairReason(item.escalation_reason) !== normalizedRepairReason(assignment.reason))

    if (stale) {
      throw new Error(
        `proof_repair_assignment_stale_revision: repair ${assignment.admit_id} no longer matches the current staged theorem revision; current unresolved proof_regions: ${currentUnresolved}. Re-plan from the current staged source and do not reconstruct or edit the obsolete repair region.`,
      )
    }
    return assignment
  }

  function goalWindow(blockText: string, admitID: string) {
    const lines = blockText.split("\n")
    const admitLine = lines.findIndex((line) => line.includes(`admit_id: ${admitID}`))
    const end = admitLine >= 0 ? admitLine : lines.length
    const start = Math.max(0, end - 8)
    return lines
      .slice(start, end)
      .map((line) => line.trim())
      .filter((line) => line && line !== "{" && line !== "}")
      .join("\n")
  }

  function positionOf(text: string, index: number) {
    let line = 0
    let lineStart = 0
    for (let i = 0; i < index; i++) {
      if (text[i] === "\n") {
        line += 1
        lineStart = i + 1
      }
    }
    return { line, character: index - lineStart }
  }

  function proofBlockEntryPosition(source: string, block: ParsedBlock) {
    const masked = maskCoqCommentsAndStrings(block.blockText) ?? block.blockText
    const targetPattern = block.targetName
      ? new RegExp(`\\b(?:have|suff(?:ices)?|assert|enough)\\s+${escapeRegExp(block.targetName)}\\b`)
      : /\b(?:have|suff(?:ices)?|assert|enough)\b/
    const target = targetPattern.exec(masked)
    if (!target || target.index === undefined) return positionOf(source, block.blockStart)

    let terminator = -1
    for (let index = target.index + target[0].length; index < masked.length; index++) {
      if (masked[index] !== ".") continue
      const previous = masked[index - 1]
      const next = masked[index + 1]
      if (previous && next && /[A-Za-z0-9_']/.test(previous) && /[A-Za-z0-9_']/.test(next)) continue
      terminator = index
      break
    }
    if (terminator < 0) return positionOf(source, block.blockStart)

    const opener = masked.indexOf("{", terminator + 1)
    if (opener < 0) return positionOf(source, block.blockStart)
    return positionOf(source, block.blockStart + opener + 1)
  }

  function semanticGoalFingerprint(goal: string) {
    return hashText(
      goal
        .replace(/\b(?:Goal|goal)\s+\d+(?:\s*\/\s*\d+)?\s*:/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
  }

  function skipIgnoredBackward(text: string, index: number) {
    let cursor = index
    while (cursor > 0) {
      while (cursor > 0 && /\s/.test(text[cursor - 1])) cursor -= 1
      if (text.slice(cursor - 2, cursor) !== "*)") break

      const commentStart = text.lastIndexOf("(*", cursor - 2)
      if (commentStart < 0) break
      cursor = commentStart
    }
    return cursor
  }

  function localStatementBefore(source: string, headerStart: number) {
    const end = skipIgnoredBackward(source, headerStart)
    if (end <= 0 || source[end - 1] !== ".") return undefined

    const windowStart = Math.max(0, end - 4000)
    const window = source.slice(windowStart, end)
    const localStatement = /(^|\n)\s*(?:have|suff(?:ices)?|assert|enough)\b/g
    const matches = [...window.matchAll(localStatement)]
    const last = matches.at(-1)
    if (!last || last.index === undefined) return undefined

    const start = windowStart + last.index + (last[1] === "\n" ? 1 : 0)
    const statement = source.slice(start, end).trim()
    const proofPosition = positionOf(source, end)
    return { statement, proofPosition }
  }

  function goalFromStatement(statement: string) {
    const body = statement.endsWith(".") ? statement.slice(0, -1).trim() : statement.trim()
    const colon = body.indexOf(":")
    if (colon < 0) return body
    const goal = body.slice(colon + 1).trim()
    return /^assert\s*\(/.test(body) && goal.endsWith(")") ? goal.slice(0, -1).trim() : goal
  }

  const LEMMA_READY_LAYERS = new Set(["semantic", "shape", "prosa", "mathcomp", "coq_shape", "local_arithmetic"])

  function normalizeTargetShape(text: string | undefined) {
    return (text ?? "")
      .replace(/\$+/g, " ")
      .replace(/\\leq?|\\le/g, " <= ")
      .replace(/\\geq?|\\ge/g, " >= ")
      .replace(/\\neq/g, " <> ")
      .replace(/\\forall/g, " forall ")
      .replace(/\\exists/g, " exists ")
      .replace(/\\sum/g, " sum ")
      .replace(/\\min/g, " min ")
      .replace(/\\max/g, " max ")
      .replace(/[{}]/g, " ")
      .replace(/[()]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  }

  function hasGroundedProofEvidence(block: ParsedBlock) {
    return (
      block.shapeEvidence.some((entry) => /^(?:prosa|mathcomp|local|context|coq|compiler):/i.test(entry)) ||
      block.prosaCandidateLemmas.length > 0 ||
      block.mathcompCandidateLemmas.length > 0
    )
  }

  function targetShapeMatches(block: ParsedBlock) {
    if (!block.targetStatement || !block.targetNormalForm) return false
    const actual = normalizeTargetShape(goalFromStatement(block.targetStatement))
    const expected = normalizeTargetShape(block.targetNormalForm)
    if (!actual || !expected) return false
    return actual === expected || actual.includes(expected) || expected.includes(actual)
  }

  function localityGate(item: QueueItem, block: ParsedBlock) {
    const blockers: string[] = []
    const missing: string[] = []
    if (item.kind === "unknown") missing.push("kind")
    if (item.kind === "paper_bridge") {
      blockers.push("kind=paper_bridge is a planning placeholder without a locally certifiable exported contract")
    }
    if (!block.proofPlanNode) missing.push("plan_node")
    if (!block.dependsOnDeclared) missing.push("depends_on")
    if (!block.sourceRef) missing.push("source")
    if (block.inputRefs.length === 0) missing.push("input")
    if (!block.outputRef) missing.push("output")
    if (!block.layer || !LEMMA_READY_LAYERS.has(block.layer)) missing.push("lemma_ready_layer")
    if (!block.expected) missing.push("expected")
    if (!block.targetNormalForm) missing.push("normal_form")
    if (!targetShapeMatches(block)) missing.push("target_shape_review")
    if (!hasGroundedProofEvidence(block)) missing.push("grounded_proof_evidence")

    if (block.layer === "paper" || block.layer === "theorem_spine") {
      blockers.push(`layer=${block.layer} belongs to Layer 1 decomposition and must be refined before lemma delegation`)
    }

    if (missing.length > 0 || blockers.length > 0) {
      const detail = [
        blockers.length > 0 ? `blocked: ${blockers.join("; ")}` : undefined,
        missing.length > 0 ? `missing or invalid ${missing.join(", ")}` : undefined,
      ]
        .filter(Boolean)
        .join("; ")
      return {
        ok: false as const,
        reason: `proof_region ${item.admit_id} is not yet a dependency-complete, locally certifiable proof DAG node; ${detail}. Prover should add the missing contract fields or remodel only the evidenced semantic/dependency boundary. Region size and internal tactic count are not rejection criteria.`,
      }
    }

    return { ok: true as const, text: block.blockText }
  }

  function buildLemmaAssignment(file: string, item: QueueItem, block: ParsedBlock, source: string): LemmaAssignment {
    const targetStatement = block.targetStatement
    const goal =
      (targetStatement ? goalFromStatement(targetStatement) : undefined) ||
      goalWindow(block.blockText, item.admit_id) ||
      `Discharge admit_id ${item.admit_id} inside the preserved proof_region.`
    const regionStart = block.regionStart ?? block.blockStart
    const regionEnd = block.regionEnd ?? block.endIndex + 1
    const targetMissing = Boolean(block.targetName && !block.targetStatement)

    return LemmaAssignmentSchema.parse({
      file,
      theorem: item.theorem,
      admit_id: item.admit_id,
      goal,
      goal_fingerprint: semanticGoalFingerprint(goal),
      proof_position: proofBlockEntryPosition(source, block),
      replace: `Replace or update the entire existing proof_region for admit_id ${item.admit_id}. The region must wrap the exported local target statement ${block.targetName ?? "the assigned target"} together with its complete proof block, not only the text inside that target's braces. Treat that exported target statement as the main prover's split contract: keep its name and proposition unchanged whenever possible, write proof text inside its block, and add same-region helper pose/have/assert statements before it when useful. If the target statement itself is wrong, return needs_subgoal_remodel instead of silently changing it. Preserve all text outside the region, including any parent composition step that uses the exported target after the end marker.`,
      skeleton: block.blockText,
      done: `The region is done only when ${file} no longer contains a pending admit for admit_id ${item.admit_id}, the proof_region begin/end markers are still present with the same admit_id around the preserved exported target statement and its proof block, text outside the region is unchanged, and the file validates after merge.`,
      obligation: {
        kind: item.kind,
        proof_plan_node: block.proofPlanNode,
        target_name: item.target_name,
        target_statement: targetStatement,
        expected_proof_kind: "region_local_proof_with_optional_sibling_helpers",
        dependencies: block.dependsOn,
        source: block.sourceRef,
        input: block.inputRefs,
        output: block.outputRef,
        layer: block.layer,
        expected: block.expected,
        target_normal_form: block.targetNormalForm,
        prosa_candidate_lemmas: block.prosaCandidateLemmas,
        mathcomp_candidate_lemmas: block.mathcompCandidateLemmas,
        shape_evidence: block.shapeEvidence,
        locality_check: {
          all_dependencies_available: true,
          may_need_region_helper: false,
          changes_theorem_spine: false,
          expected_lemma_shape: block.targetNormalForm ?? targetStatement,
          risk_level: targetMissing ? "medium" : "low",
        },
      },
      editable_region: {
        mode: "region",
        start_line: block.startLine,
        end_line: block.endLine,
        text: block.blockText,
        begin_marker: block.beginMarker ?? block.headerText,
        end_marker: block.endMarker,
        can_add_sibling_helpers: true,
        immutable_prefix_hash: hashText(source.slice(0, regionStart)),
        immutable_suffix_hash: hashText(source.slice(regionEnd)),
        region_fingerprint: block.regionFingerprint,
      },
      escalation_contract: {
        allowed_escalations: [
          "needs_definition_unfolding",
          "needs_library_shape_change",
          "needs_preceding_bridge",
          "needs_uniqueness_bridge",
          "needs_context_strengthening",
          "needs_theorem_spine_change",
          "needs_subgoal_remodel",
          "blocked_by_sibling_syntax",
          "not_local",
          "unknown",
        ],
        remodel_owner: "prover",
      },
    })
  }

  function checkedLemmaAssignment(
    state: State,
    blocks: ParsedBlock[],
    file: string,
    item: QueueItem,
    block: ParsedBlock,
    source: string,
  ) {
    const dispatch = decompositionDispatchCheck(state, blocks, block, source)
    if (!dispatch.ok) return dispatch
    const gate = localityGate(item, block)
    if (!gate.ok) return gate
    return {
      ok: true as const,
      assignment: buildLemmaAssignment(file, item, block, source),
    }
  }

  function regionOutsideUnchanged(assignment: LemmaAssignment | undefined, source: string) {
    const region = assignment?.editable_region
    if (!region || region.mode !== "region") return true
    if (!region.begin_marker || !region.end_marker) return true
    if (!region.immutable_prefix_hash || !region.immutable_suffix_hash) return true

    const start = source.indexOf(region.begin_marker)
    if (start < 0) return false
    const endStart = source.indexOf(region.end_marker, start + region.begin_marker.length)
    if (endStart < 0) return false
    const end = endStart + region.end_marker.length
    return (
      hashText(source.slice(0, start)) === region.immutable_prefix_hash &&
      hashText(source.slice(end)) === region.immutable_suffix_hash
    )
  }

  function assignedEditableText(assignment: LemmaAssignment | undefined, source: string) {
    return assignedEditableRange(assignment, source)?.text
  }

  function assignedEditableRange(assignment: LemmaAssignment | undefined, source: string) {
    const region = assignment?.editable_region
    if (!region?.begin_marker) return undefined

    const start = source.indexOf(region.begin_marker)
    if (start < 0) return undefined

    if (region.mode === "region") {
      if (!region.end_marker) return undefined
      const endStart = source.indexOf(region.end_marker, start + region.begin_marker.length)
      if (endStart < 0) return undefined
      const end = endStart + region.end_marker.length
      return { start, end, text: source.slice(start, end) }
    }

    return undefined
  }

  function assignedSolvedGate(assignment: LemmaAssignment | undefined, admitID: string, source: string) {
    const text = assignedEditableText(assignment, source)
    if (!text) {
      return {
        ok: false,
        escalation_type: "not_local" as const,
        reason: `Solved proof_result for admit_id ${admitID} removed or rewrote its assigned proof marker.`,
      }
    }

    if (hasPendingProofHole(text)) {
      return {
        ok: false,
        escalation_type: "blocked_by_sibling_syntax" as const,
        reason: `Solved proof_result for admit_id ${admitID} still leaves a pending admit or empty proof block inside the assigned region.`,
      }
    }

    const targetName = assignment?.obligation?.target_name
    if (targetName && !findTargetStatement(text, targetName)) {
      return {
        ok: false,
        escalation_type: "needs_subgoal_remodel" as const,
        reason: `Solved proof_result for admit_id ${admitID} removed exported target ${targetName} from its assigned region.`,
      }
    }

    return { ok: true as const, text }
  }

  function theoremRange(source: string, theorem: string) {
    const span = theoremSpans(source).find((candidate) => candidate.name === theorem)
    return span ? source.slice(span.start, span.end) : undefined
  }

  function finalTheoremGate(source: string, theorem: string) {
    const text = theoremRange(source, theorem)
    if (!text) {
      return {
        ok: false,
        reason: `Final theorem gate could not find theorem ${theorem}.`,
      }
    }

    const masked = maskCoqCommentsAndStrings(text)
    if (!masked) {
      return {
        ok: false,
        reason: `Final theorem gate could not parse theorem ${theorem} because it contains an unterminated comment or string.`,
      }
    }
    const terminators = [...masked.matchAll(/\b(Qed|Admitted|Abort)\./g)]
    const final = terminators.at(-1)?.[1]
    if (final !== "Qed") {
      return {
        ok: false,
        reason: `Final theorem gate requires theorem ${theorem} to end with Qed.; found ${final ? `${final}.` : "no proof terminator"}.`,
      }
    }

    if (UNFINISHED_PROOF.test(masked) || EMPTY_PROOF_BLOCK.test(masked)) {
      return {
        ok: false,
        reason: `Final theorem gate requires theorem ${theorem} to contain no admit, empty proof block, Admitted., or Abort.`,
      }
    }

    return { ok: true as const }
  }

  function validatedSplitFingerprint(
    sessionID: string,
    file: string,
    source: string,
    theorem: string | undefined,
    blocks: ParsedBlock[],
  ) {
    if (!theorem) return undefined
    const state = get(sessionID)
    const repair = state?.active_repair
    const plan = state?.decomposition_plan
    const review = plan?.materialization_review
    if (!repair || repair.theorem !== theorem || !repair.theorem_structure_fingerprint) return undefined
    if (repair.theorem_structure_fingerprint === theoremStructureFingerprint(source, theorem)) return undefined
    if (plan?.status !== "accepted" || plan.theorem !== theorem || review?.status !== "matched") return undefined
    const currentTheoremHash = materializationTheoremSourceHash(source, theorem)
    if ((review.theorem_source_hash ?? review.source_hash) !== currentTheoremHash) return undefined
    if (blocks.length < 2) return undefined

    const stateItems = new Map(state.queue.map((item) => [item.admit_id, item]))
    const localityComplete = blocks.every((block) => {
      const item = stateItems.get(block.admit_id)
      return Boolean(item && decompositionDispatchCheck(state, blocks, block, source).ok)
    })
    if (!localityComplete) return undefined
    return hashText(
      [
        normalizedWorkflowFile(file),
        theorem,
        plan.accepted_semantic_fingerprint ?? review.plan_semantic_fingerprint,
        currentTheoremHash,
      ].join("\n"),
    )
  }

  function proofProgressMetrics(
    sessionID: string,
    file: string,
    source: string,
    theorem?: string,
  ): ProofProgressMetrics {
    const text = theorem ? (theoremRange(source, theorem) ?? source) : source
    const masked = maskCoqCommentsAndStrings(text) ?? text
    const admitCount = countMatches(masked, PENDING_PLACEHOLDER_GLOBAL)
    const emptyBlockCount = countMatches(masked, EMPTY_PROOF_BLOCK_GLOBAL)
    const admittedTerminatorCount = countMatches(masked, /\bAdmitted\./g)
    const abortTerminatorCount = countMatches(masked, /\bAbort\./g)
    const terminators = [...masked.matchAll(/\b(Qed|Admitted|Abort)\./g)]
    const finalTerminator = terminators.at(-1)?.[1]
    const unfinishedCount = admitCount + emptyBlockCount + admittedTerminatorCount + abortTerminatorCount
    const blocks = parseProofObligations(source).filter((block) => !theorem || block.theorem === theorem)
    const state = get(sessionID)
    const items = new Map(
      (state?.queue ?? [])
        .filter((item) => !theorem || item.theorem === theorem)
        .map((item) => [item.admit_id, item]),
    )
    const certifiedSemanticDebtIDs: string[] = []
    const unresolvedSemanticDebtIDs: string[] = []
    for (const block of blocks) {
      const debtID = `region:${block.admit_id}`
      const item = items.get(block.admit_id)
      if (
        item?.status === "solved" &&
        validationCertificateCurrent(item.validation_certificate, file, source, block)
      ) {
        certifiedSemanticDebtIDs.push(debtID)
      } else {
        unresolvedSemanticDebtIDs.push(debtID)
      }
    }
    if (finalTerminator !== "Qed") unresolvedSemanticDebtIDs.push(`theorem:${theorem ?? "unknown"}:final_qed`)

    return {
      theorem,
      unfinished_count: unfinishedCount,
      admit_count: admitCount,
      empty_block_count: emptyBlockCount,
      admitted_terminator_count: admittedTerminatorCount,
      abort_terminator_count: abortTerminatorCount,
      final_terminator: finalTerminator,
      qed_distance: finalTerminator === "Qed" ? (unfinishedCount === 0 ? 0 : 1) : 2,
      unresolved_semantic_debt: unresolvedSemanticDebtIDs.length,
      unresolved_semantic_debt_ids: unresolvedSemanticDebtIDs,
      certified_semantic_debt_ids: certifiedSemanticDebtIDs,
      validated_split_fingerprint: validatedSplitFingerprint(sessionID, file, source, theorem, blocks),
    }
  }

  function progressReceipt(input: Omit<ProofProgressReceipt, "id" | "recorded_at">) {
    const recordedAt = Math.max(Date.now(), lastProgressReceiptAt + 1)
    lastProgressReceiptAt = recordedAt
    return ProofProgressReceipt.parse({
      ...input,
      id: hashText(
        [
          input.kind,
          input.theorem,
          input.source_fingerprint,
          input.admit_id ?? "",
          input.compiler_signature ?? "",
          input.split_fingerprint ?? "",
          input.first_error_after ? JSON.stringify(input.first_error_after) : "",
        ].join("\n"),
      ),
      recorded_at: recordedAt,
    })
  }

  function saveProgressReceipt(sessionID: string, receipt: ProofProgressReceipt | undefined) {
    if (!receipt) return
    const state = get(sessionID)
    if (!state) return
    set(sessionID, {
      ...state,
      ...(receipt.level === "hard" ? { last_progress_receipt: receipt } : {}),
      ...(receipt.level === "structural" ? { last_structural_progress_receipt: receipt } : {}),
      ...(receipt.level === "debug" ? { last_debug_progress_receipt: receipt } : {}),
      updated: Date.now(),
    })
  }

  function proofProgressFor(
    sessionID: string,
    file: string,
    source: string,
    theorem: string | undefined,
    current: ProofProgressMetrics,
    finalOK: boolean,
    lifecycle?: ProofRegionLifecycleTransition,
  ) {
    const normalized = path.normalize(file)
    const existing = proofProgressSnapshots.get(sessionID) ?? new Map<string, ProofProgressMetrics>()
    const previous = existing.get(normalized)

    let status: "baseline" | "advanced" | "stalled" | "regressed" | "final_theorem_success"
    let accepted = false
    let level: ProofProgressLevel | undefined
    let workspaceCommittable = false
    let reason: string
    let receipt: ProofProgressReceipt | undefined
    const receiptBase = theorem
      ? {
          theorem,
          theorem_context_fingerprint: ProofRouteLedger.theoremContextFingerprint(source, theorem),
          source_fingerprint: repairSourceFingerprint(source, theorem),
          before_unresolved_semantic_debt: previous?.unresolved_semantic_debt,
          after_unresolved_semantic_debt: current.unresolved_semantic_debt,
          certified_semantic_debt_count: current.certified_semantic_debt_ids.length,
        }
      : undefined
    const state = get(sessionID)

    if (finalOK) {
      status = "final_theorem_success"
      accepted = true
      level = "hard"
      workspaceCommittable = true
      reason = "target theorem passed the final gate"
      if (receiptBase) receipt = progressReceipt({ ...receiptBase, kind: "final_qed", level, compiler_signature: lifecycle?.compiler_signature })
    } else if (lifecycle?.action === "certified") {
      status = "advanced"
      accepted = true
      level = "hard"
      workspaceCommittable = true
      reason = lifecycle.admit_id
        ? `proof_region ${lifecycle.admit_id} received a compiler certificate`
        : "a proof_region received a compiler certificate"
      if (receiptBase) {
        receipt = progressReceipt({
          ...receiptBase,
          kind: "region_certified",
          level,
          admit_id: lifecycle.admit_id,
          compiler_signature: lifecycle.compiler_signature,
        })
      }
    } else if (
      receiptBase &&
      current.validated_split_fingerprint &&
      current.validated_split_fingerprint !== previous?.validated_split_fingerprint &&
      !(
        state?.last_structural_progress_receipt?.kind === "locality_validated_split" &&
        state.last_structural_progress_receipt.split_fingerprint === current.validated_split_fingerprint
      )
    ) {
      status = "advanced"
      level = "structural"
      workspaceCommittable = true
      reason = "the repaired theorem region was materialized as a dependency-complete locality-validated proof DAG and compiled"
      receipt = progressReceipt({
        ...receiptBase,
        kind: "locality_validated_split",
        level,
        split_fingerprint: current.validated_split_fingerprint,
        compiler_signature: lifecycle?.compiler_signature,
      })
    } else if (
      receiptBase &&
      previous &&
      current.unresolved_semantic_debt < previous.unresolved_semantic_debt
    ) {
      const removed = previous.unresolved_semantic_debt_ids.filter(
        (debt) => !current.unresolved_semantic_debt_ids.includes(debt),
      )
      const certified = new Set(current.certified_semantic_debt_ids)
      const evidenced = removed.length > 0 && removed.every((debt) => certified.has(debt))
      if (evidenced) {
        status = "advanced"
        accepted = true
        level = "hard"
        workspaceCommittable = true
        reason = `unresolved semantic debt decreased from ${previous.unresolved_semantic_debt} to ${current.unresolved_semantic_debt} with compiler certificates for every discharged region`
        receipt = progressReceipt({ ...receiptBase, kind: "semantic_debt_reduced", level, compiler_signature: lifecycle?.compiler_signature })
      } else {
        status = "stalled"
        reason = "syntactic debt decreased, but removed semantic obligations lack compiler certificates"
      }
    } else if (!previous) {
      status = "baseline"
      reason =
        "recorded the current nonfinal compile as a baseline; accepted progress requires a progress receipt"
    } else if (current.unfinished_count > previous.unfinished_count || current.qed_distance > previous.qed_distance) {
      status = "regressed"
      reason = `unfinished proof count or final-Qed distance regressed from ${previous.unfinished_count}/${previous.qed_distance} to ${current.unfinished_count}/${current.qed_distance}`
    } else {
      status = "stalled"
      reason =
        current.unfinished_count < previous.unfinished_count || current.qed_distance < previous.qed_distance
          ? "syntactic proof debt decreased, but no new proof_region compiler certificate or final Qed was recorded"
          : "compile succeeded without a new proof_region compiler certificate or final Qed"
    }

    if (!previous || accepted || level === "structural") {
      existing.set(normalized, current)
      proofProgressSnapshots.set(sessionID, existing)
    }
    if (receipt) saveProgressReceipt(sessionID, receipt)

    return {
      status,
      accepted,
      level,
      workspace_committable: workspaceCommittable,
      reason,
      receipt,
      current,
      previous,
    }
  }

  export function classifyCoqcSuccess(
    sessionID: string,
    file: string,
    source: string,
    lifecycle?: ProofRegionLifecycleTransition,
  ) {
    const state = get(sessionID)
    const parsed = parseProofObligations(source)
    const stateTheorem =
      state && normalizedWorkflowFile(state.file) === normalizedWorkflowFile(file)
        ? state.decomposition_plan?.theorem && state.decomposition_plan.theorem !== "unspecified-theorem"
          ? state.decomposition_plan.theorem
          : state.queue[0]?.theorem
        : undefined
    const boundRegionTheorem = parsed.length > 0
      ? boundTheoremTarget(sessionID, file, source)?.theorem
      : undefined
    const theorem =
      stateTheorem ??
      boundRegionTheorem ??
      parsed[0]?.theorem ??
      inferDeclaredTheorem(source)
    const final = theorem
      ? finalTheoremGate(source, theorem)
      : { ok: false, reason: "No target theorem found for final proof gate." }
    const theoremText = theorem ? theoremRange(source, theorem) : undefined
    const metrics = proofProgressMetrics(sessionID, file, source, theorem)
    const progress = proofProgressFor(sessionID, file, source, theorem, metrics, final.ok, lifecycle)
    proofFailureSnapshots.get(sessionID)?.delete(path.normalize(file))
    const maskedTheoremText = maskCoqCommentsAndStrings(theoremText ?? source)
    const hasUnfinishedProof =
      metrics.unfinished_count > 0 ||
      !maskedTheoremText ||
      UNFINISHED_PROOF.test(maskedTheoremText)

    return {
      theorem,
      status_detail: final.ok ? ("final_theorem_success" as const) : ("compile_success_nonfinal" as const),
      has_unfinished_proof: hasUnfinishedProof,
      proof_progress: progress,
      final_theorem_gate: final,
    }
  }

  function compilerErrorAnchor(
    source: string,
    theorem: string,
    firstErrorLine: number | undefined,
    firstErrorMessage: string | undefined,
  ): ProofErrorAnchor | undefined {
    if (!firstErrorLine) return undefined
    const offset = sourceOffset(source, firstErrorLine - 1, 0)
    const span = theoremSpans(source).find((candidate) => candidate.name === theorem)
    if (offset === undefined || !span || offset < span.start || offset >= span.end) return undefined
    const blocks = parseProofObligations(source)
      .filter((block) => block.theorem === theorem)
      .sort((left, right) => left.blockStart - right.blockStart)
    const block = blocks.find((candidate) => offset >= candidate.blockStart && offset <= candidate.endIndex)
    const preceding = blocks.filter((candidate) => candidate.endIndex < offset).length
    const scopeStart = block?.blockStart ?? span.proofStart ?? span.start
    const scopeEnd = block?.endIndex ?? span.end
    const scopeText = source.slice(scopeStart, scopeEnd)
    const maskedScope = maskCoqCommentsAndStrings(scopeText) ?? scopeText
    const relativeOffset = Math.max(0, Math.min(maskedScope.length, offset - scopeStart))
    const maskedPrefix = maskedScope.slice(0, relativeOffset)
    const sentenceIndex = [...maskedPrefix.matchAll(/\.(?=\s|$)/g)].length
    const sentenceStart = maskedPrefix.lastIndexOf(".") + 1
    const nextTerminator = maskedScope.indexOf(".", relativeOffset)
    const sentence = maskedScope
      .slice(sentenceStart, nextTerminator >= 0 ? nextTerminator + 1 : maskedScope.length)
      .replace(/\s+/g, " ")
      .trim()
    return ProofErrorAnchor.parse({
      theorem,
      scope: block ? `region:${block.admit_id}` : `theorem:${theorem}:spine`,
      region_order: block ? preceding : preceding,
      sentence_index: sentenceIndex,
      sentence_fingerprint: sentence ? hashText(sentence) : undefined,
      line: firstErrorLine,
      normalized_error: normalizedRepairReason(firstErrorMessage ?? ""),
    })
  }

  function errorAnchorAdvanced(previous: ProofErrorAnchor, current: ProofErrorAnchor) {
    if (previous.theorem !== current.theorem) return false
    if (current.region_order !== previous.region_order) return current.region_order > previous.region_order
    if (current.scope !== previous.scope) return false
    if (
      previous.sentence_fingerprint &&
      current.sentence_fingerprint &&
      previous.sentence_fingerprint === current.sentence_fingerprint
    ) {
      return false
    }
    return current.sentence_index > previous.sentence_index
  }

  export function classifyCoqcFailure(
    sessionID: string,
    file: string,
    source: string,
    input: {
      first_error_line?: number
      first_error_message?: string
      lifecycle?: ProofRegionLifecycleTransition
    },
  ) {
    const state = get(sessionID)
    const plannedTheorem =
      state?.decomposition_plan?.theorem && state.decomposition_plan.theorem !== "unspecified-theorem"
        ? state.decomposition_plan.theorem
        : undefined
    const theorem =
      plannedTheorem ??
      state?.queue[0]?.theorem ??
      boundTheoremTarget(sessionID, file, source)?.theorem ??
      inferDeclaredTheorem(source)
    const metrics = proofProgressMetrics(sessionID, file, source, theorem)
    const normalized = path.normalize(file)
    const snapshots = proofFailureSnapshots.get(sessionID) ?? new Map<string, ProofErrorAnchor>()
    const previous = snapshots.get(normalized)
    const current = theorem
      ? compilerErrorAnchor(source, theorem, input.first_error_line, input.first_error_message)
      : undefined
    const advanced = Boolean(previous && current && errorAnchorAdvanced(previous, current))
    const receipt = advanced && theorem && previous && current
      ? progressReceipt({
          kind: "first_error_advanced",
          level: "debug",
          theorem,
          theorem_context_fingerprint: ProofRouteLedger.theoremContextFingerprint(source, theorem),
          source_fingerprint: repairSourceFingerprint(source, theorem),
          before_unresolved_semantic_debt: metrics.unresolved_semantic_debt,
          after_unresolved_semantic_debt: metrics.unresolved_semantic_debt,
          compiler_signature: input.lifecycle?.compiler_signature,
          first_error_before: previous,
          first_error_after: current,
        })
      : undefined
    if (current && (!previous || advanced)) {
      snapshots.set(normalized, current)
      proofFailureSnapshots.set(sessionID, snapshots)
    }
    if (input.lifecycle?.action === "certified") {
      const progress = proofProgressFor(
        sessionID,
        file,
        source,
        theorem,
        metrics,
        false,
        input.lifecycle,
      )
      return {
        theorem,
        status_detail: "compile_failed" as const,
        has_unfinished_proof: true,
        proof_progress: {
          ...progress,
          // The exact region prefix is certified, but the complete staged
          // theorem still failed at its final Qed. Keep the full draft in the
          // transaction journal instead of publishing it as a committable
          // workspace snapshot.
          workspace_committable: false,
          first_error: current,
          previous_first_error: previous,
        },
      }
    }
    if (receipt) saveProgressReceipt(sessionID, receipt)
    return {
      theorem,
      status_detail: "compile_failed" as const,
      has_unfinished_proof: true,
      proof_progress: {
        status: advanced ? ("advanced" as const) : previous ? ("stalled" as const) : ("baseline" as const),
        accepted: false,
        level: advanced ? ("debug" as const) : undefined,
        workspace_committable: false,
        reason: advanced
          ? "debug progress only: the earliest compiler error advanced, but no semantic obligation or missing premise received a compiler certificate"
          : previous
            ? "the earliest compiler error did not advance beyond the stored stable sentence anchor"
            : "recorded the current earliest compiler error as a baseline",
        receipt,
        current: metrics,
        previous: undefined,
        first_error: current,
        previous_first_error: previous,
      },
    }
  }

  async function solvedValidationGate(
    sessionID: string,
    file: string,
    item: QueueItem,
    outcome: LemmaOutcome,
    source: string,
  ) {
    const assigned = assignedSolvedGate(outcome.assignment, item.admit_id, source)
    if (!assigned.ok) return assigned
    const assignedText = assigned.text
    if (!assignedText) {
      return {
        ok: false,
        escalation_type: "not_local" as const,
        reason: `Solved proof_result for admit_id ${item.admit_id} removed or rewrote its assigned proof marker.`,
      }
    }

    if (!outcome.proofText?.trim()) {
      return {
        ok: false,
        escalation_type: "not_local" as const,
        reason: `Solved proof_result for admit_id ${item.admit_id} must include non-empty proof_text for the complete assigned proof_region.`,
      }
    }

    if (normalizeProofText(outcome.proofText) !== normalizeProofText(assignedText)) {
      return {
        ok: false,
        escalation_type: "not_local" as const,
        reason: `Solved proof_result for admit_id ${item.admit_id} proof_text must be exactly equal to the complete assigned proof_region and contain no text outside it.`,
      }
    }

    if (!INFORMAL_PROOF_COMMENT.test(assignedText)) {
      return {
        ok: false,
        escalation_type: "not_local" as const,
        reason: `Solved proof_result for admit_id ${item.admit_id} must leave an informal-proof comment inside the assigned proof_region before the tactic script.`,
      }
    }

    const scaffold = await Validation.scaffold(file, source)
    if (
      !scaffold.ok &&
      !expectedIncompleteQedScaffold(file, source, scaffold) &&
      !compilerReachedPastRegion(file, item, scaffold)
    ) {
      const failure = validationEscalation(file, item, scaffold)
      return {
        ok: false,
        escalation_type: failure.escalation_type,
        reason: `Solved proof_result did not pass checkpoint/coqc scaffold gate: ${failure.reason}`,
      }
    }

    // Lemma edits are transactional. The parent may intentionally own a
    // staged revision that is newer than the workspace file until this gate
    // records its compiler certificate. Comparing only with disk incorrectly
    // rejects that solved patch and allows the scheduler to launch it again.
    const currentSource = await ProofEditTransaction.readSource(sessionID, file)
    if (sourceHash(currentSource) !== sourceHash(source)) {
      return {
        ok: false,
        escalation_type: "unknown" as const,
        reason: `Solved proof_result for admit_id ${item.admit_id} changed while its compiler certificate was being recorded; revalidate the current source.`,
      }
    }

    const block = parseProofObligations(source).find((entry) => entry.admit_id === item.admit_id)
    if (!block || block.pending) {
      return {
        ok: false,
        escalation_type: "not_local" as const,
        reason: `Solved proof_result for admit_id ${item.admit_id} did not leave one hole-free parsed proof_region to certify.`,
      }
    }

    const compilerSignature = compilerResultSignature({
      ok: scaffold.ok,
      file,
      firstErrorFile: scaffold.first_error_file,
      firstErrorLine: scaffold.first_error_line,
      firstErrorMessage: scaffold.message,
    })
    return {
      ok: true as const,
      certificate: buildValidationCertificate({
        file,
        source,
        block,
        compilerSignature,
        validator: scaffold.validator,
      }),
    }
  }

  function validationFailureReason(result: ValidationResult) {
    const location = result.first_error_line ? `line ${result.first_error_line}: ` : ""
    return `${result.validator} scaffold gate failed: ${location}${result.message ?? "unknown compiler error"}`
  }

  function normalizedRepairReason(reason: string) {
    return reason
      .replace(/File "[^"]+"/g, 'File "<file>"')
      .replace(/\bline \d+:\s*/g, "line <n>: ")
      .replace(/characters? \d+-\d+/g, "characters <range>")
      .replace(/\badmit_id\s*[:=]\s*[^\s;,]+/gi, "admit_id=<id>")
      .replace(/\s+/g, " ")
      .trim()
  }

  function repairSourceFingerprint(source: string, theorem: string) {
    const text = theoremRange(source, theorem) ?? source
    return hashText(
      text
        // Region marker IDs and explanatory comments are administrative text;
        // changing them must not evade repeated-blocker detection. Keep all
        // actual Coq terms and tactic identifiers so a substantive repair gets
        // a fresh attempt even when the compiler message is unchanged.
        .replace(/\(\*[\s\S]*?\*\)/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
  }

  function repairIncidentSignature(file: string, item: QueueItem, reason: string, sourceFingerprint: string) {
    return hashText(
      [path.normalize(file), item.theorem, normalizedRepairReason(reason), sourceFingerprint].join("\n"),
    )
  }

  function registerRepairIncident(
    sessionID: string,
    state: State,
    item: QueueItem,
    escalationType: EscalationType,
    reason: string,
    source: string,
  ) {
    const sourceFingerprint = repairSourceFingerprint(source, item.theorem)
    const signature = repairIncidentSignature(state.file, item, reason, sourceFingerprint)
    const previous = state.repair_incidents ?? []
    const existing = previous.find((incident) => incident.signature === signature)
    const now = Date.now()
    const incident: RepairIncident = existing
      ? {
          ...existing,
          last_admit_id: item.admit_id,
          repeat_count: existing.repeat_count + 1,
          updated_at: now,
        }
      : {
          signature,
          theorem: item.theorem,
          escalation_type: escalationType,
          reason,
          source_fingerprint: sourceFingerprint,
          first_admit_id: item.admit_id,
          last_admit_id: item.admit_id,
          repeat_count: 0,
          first_seen_at: now,
          updated_at: now,
        }
    const incidents = [...previous.filter((entry) => entry.signature !== signature), incident].slice(
      -MAX_REPAIR_INCIDENTS,
    )
    return {
      repeated: Boolean(existing),
      incident,
      state: set(sessionID, { ...state, repair_incidents: incidents, updated: now }),
    }
  }

  function repairChildOutcomeCompilerSignature(output?: string) {
    if (!output) return undefined
    return /(?:repeated_)?compiler_signature=([A-Za-z0-9_-]+)/.exec(output)?.[1]
  }

  function repairChildNoMaterializationIncidentReason(
    assignment: ProofRepairAssignment,
    compilerSignature?: string,
  ) {
    return [
      "repair_child_no_materialization",
      `blocker=${normalizedRepairReason(assignment.reason)}`,
      `compiler_signature=${compilerSignature ?? "unavailable"}`,
    ].join("; ")
  }

  function clearResolvedRepairIncidents(sessionID: string, state: State, theorem: string) {
    const resolved = state.repair_incidents?.filter((incident) => incident.theorem === theorem) ?? []
    if (resolved.length === 0) return state
    const now = Date.now()
    const resolutions = [
      ...(state.repair_incident_resolutions ?? []).filter(
        (entry) => !resolved.some((incident) => incident.signature === entry.signature),
      ),
      ...resolved.map((incident) => ({ signature: incident.signature, theorem, resolved_at: now })),
    ].slice(-MAX_REPAIR_INCIDENTS)
    return set(sessionID, {
      ...state,
      repair_incidents: state.repair_incidents?.filter((incident) => incident.theorem !== theorem),
      repair_incident_resolutions: resolutions,
      fallback_guard: undefined,
      updated: now,
    })
  }

  function diagnosticFileMatches(file: string, diagnosticFile?: string) {
    if (!diagnosticFile) return true
    const resolved = path.isAbsolute(diagnosticFile)
      ? path.normalize(diagnosticFile)
      : path.normalize(path.resolve(path.dirname(file), diagnosticFile))
    return resolved === path.normalize(file)
  }

  function validationEscalation(file: string, item: QueueItem, result: ValidationResult) {
    const reason = validationFailureReason(result)
    const compilerError =
      result.failure_kind === "compiler_error" || (!result.failure_kind && result.first_error_line !== undefined)
    if (
      !compilerError ||
      !diagnosticFileMatches(file, result.first_error_file) ||
      result.first_error_line === undefined
    ) {
      return { escalation_type: "unknown" as const, reason }
    }

    const start = item.region_start_line ?? item.start_line
    const end = item.region_end_line ?? item.end_line
    if (result.first_error_line < start || result.first_error_line > end) {
      return { escalation_type: "blocked_by_sibling_syntax" as const, reason }
    }
    return { escalation_type: "needs_subgoal_remodel" as const, reason }
  }

  function compilerReachedPastRegion(file: string, item: QueueItem, result: ValidationResult) {
    if (
      result.ok ||
      result.failure_kind !== "compiler_error" ||
      !diagnosticFileMatches(file, result.first_error_file) ||
      result.first_error_line === undefined
    ) {
      return false
    }

    const end = item.region_end_line ?? item.end_line
    return result.first_error_line > end
  }

  function expectedIncompleteQedScaffold(file: string, source: string, result: ValidationResult) {
    if (
      result.ok ||
      result.failure_kind !== "compiler_error" ||
      !diagnosticFileMatches(file, result.first_error_file) ||
      result.first_error_line === undefined ||
      !/attempt to save an incomplete proof/i.test(result.message ?? "")
    ) {
      return false
    }

    const errorLine = source.split(/\r?\n/)[result.first_error_line - 1] ?? ""
    const maskedLine = maskCoqCommentsAndStrings(errorLine) ?? errorLine
    if (!/\bQed\s*\./.test(maskedLine)) return false

    const errorOffset = sourceOffset(source, result.first_error_line - 1, 0)
    const theorem = errorOffset === undefined
      ? undefined
      : theoremSpanAtOffset(theoremSpans(source), errorOffset)
    if (!theorem) return false

    const theoremBlocks = parseProofObligations(source).filter((block) => block.theorem === theorem.name)
    if (
      theoremBlocks.some(
        (block) => result.first_error_line! >= block.startLine && result.first_error_line! <= block.endLine,
      )
    ) {
      return false
    }
    return theoremBlocks.some((block) => block.pending && block.endLine < result.first_error_line!)
  }

  function lifecycleTransition(input: ProofRegionLifecycleTransition) {
    return ProofRegionLifecycleTransition.parse(input)
  }

  export async function recordCompilerResult(input: {
    sessionID: string
    file: string
    source: string
    validator: ValidationCertificate["validator"]
    ok: boolean
    first_error_file?: string
    first_error_line?: number
    first_error_message?: string
    validated_source_current?: boolean
  }): Promise<ProofRegionLifecycleTransition> {
    const file = normalizedWorkflowFile(input.file)
    const compilerSignature = compilerResultSignature({
      ok: input.ok,
      file,
      firstErrorFile: input.first_error_file,
      firstErrorLine: input.first_error_line,
      firstErrorMessage: input.first_error_message,
    })
    const currentSource = (await Filesystem.exists(file)) ? await Filesystem.readText(file) : undefined
    if (
      !input.validated_source_current &&
      (currentSource === undefined || sourceHash(currentSource) !== sourceHash(input.source))
    ) {
      return lifecycleTransition({
        action: "source_changed",
        compiler_signature: compilerSignature,
        next_action: "recompile the unchanged current source before updating proof-region state",
        affected_sessions: 0,
      })
    }

    const binding = SessionProof.get(input.sessionID)
    if (binding && normalizedWorkflowFile(binding.file) === file && !get(input.sessionID)) {
      refresh(input.sessionID, file, input.source)
    }

    const parsed = parseProofObligations(input.source)
    const parsedByIdentity = new Map(
      parsed.map((block) => [`${block.theorem}\u0000${block.admit_id}`, block]),
    )
    const sessions = statesForFile(file)
    if (sessions.length === 0) {
      return lifecycleTransition({
        action: input.ok ? "unchanged" : "unmapped_failure",
        compiler_signature: compilerSignature,
        next_action: input.ok
          ? "no proof-region workflow is bound to this file"
          : "retain unresolved state because no proof-region workflow owns this compiler failure",
        affected_sessions: 0,
      })
    }

    if (input.ok) {
      const certifiedBefore = new Set<string>()
      for (const { sessionID } of sessions) {
        const state = refresh(sessionID, file, input.source).state
        for (const item of state.queue) {
          const block = parsedByIdentity.get(`${item.theorem}\u0000${item.admit_id}`)
          if (
            block &&
            item.status === "solved" &&
            validationCertificateCurrent(item.validation_certificate, file, input.source, block)
          ) {
            certifiedBefore.add(`${item.theorem}\u0000${item.admit_id}`)
          }
        }
      }

      let firstChanged:
        | { admitID: string; oldStatus: BlockStatus; newStatus: BlockStatus }
        | undefined
      let callerChanged:
        | { admitID: string; oldStatus: BlockStatus; newStatus: BlockStatus }
        | undefined
      let callerSynchronizedExisting = false
      let affectedSessions = 0

      for (const { sessionID } of sessions) {
        const state = refresh(sessionID, file, input.source).state
        let changed = false
        let sessionChanged:
          | { admitID: string; oldStatus: BlockStatus; newStatus: BlockStatus }
          | undefined
        let sessionNewlyCertified:
          | { admitID: string; oldStatus: BlockStatus; newStatus: BlockStatus }
          | undefined
        const queue = state.queue.map((item) => {
          const block = parsedByIdentity.get(`${item.theorem}\u0000${item.admit_id}`)
          if (!block || block.pending || item.status !== "unvalidated") return item
          const certificate = buildValidationCertificate({
            file,
            source: input.source,
            block,
            compilerSignature,
            validator: input.validator,
          })
          const transition = { admitID: item.admit_id, oldStatus: item.status, newStatus: "solved" as const }
          sessionChanged ??= transition
          if (!certifiedBefore.has(`${item.theorem}\u0000${item.admit_id}`)) {
            sessionNewlyCertified ??= transition
          }
          firstChanged ??= sessionChanged
          changed = true
          return {
            ...item,
            status: "solved" as const,
            validation_certificate: certificate,
            validation_failure: undefined,
            escalation_type: undefined,
            escalation_reason: undefined,
            task_id: undefined,
            context_audit_resume_count: undefined,
            context_audit_feedback: undefined,
            running_started_at: undefined,
            running_lease_expires_at: undefined,
            running_release_reason: undefined,
          }
        })
        if (!changed) continue
        if (sessionID === input.sessionID) {
          callerChanged = sessionNewlyCertified
          callerSynchronizedExisting = Boolean(sessionChanged && !sessionNewlyCertified)
        }
        affectedSessions += 1
        const active = queue.find(
          (item) =>
            item.admit_id === state.active_admit_id && (item.status === "running" || item.status === "split"),
        )
        const repairResolved = Boolean(
          state.active_repair &&
            (queue.some(
              (item) => item.admit_id === state.active_repair?.admit_id && item.status === "solved",
            ) ||
              // A theorem-level remodel may replace or rename the original
              // region.  If that old ID is no longer live, a compiler
              // certificate for the caller's replacement region in the same
              // theorem is real progress and closes the stale transaction.
              (!queue.some((item) => item.admit_id === state.active_repair?.admit_id) &&
                sessionNewlyCertified &&
                queue.some(
                  (item) =>
                    item.admit_id === sessionNewlyCertified?.admitID &&
                    item.theorem === state.active_repair?.theorem &&
                    item.status === "solved",
                ))),
        )
        const certifiedTheorem = sessionNewlyCertified
          ? queue.find((item) => item.admit_id === sessionNewlyCertified?.admitID)?.theorem
          : undefined
        const incidentState = certifiedTheorem
          ? clearResolvedRepairIncidents(sessionID, state, certifiedTheorem)
          : state
        set(sessionID, {
          ...incidentState,
          phase: computePhase(queue),
          queue,
          active_admit_id: active?.admit_id,
          active_task_id: active?.task_id,
          active_repair: repairResolved ? undefined : state.active_repair,
          fallback_guard: repairResolved ? undefined : state.fallback_guard,
          updated: Date.now(),
        })
      }

      return lifecycleTransition({
        action: callerChanged ? "certified" : "unchanged",
        admit_id: callerChanged?.admitID,
        old_status: callerChanged?.oldStatus,
        new_status: callerChanged?.newStatus,
        compiler_signature: compilerSignature,
        next_action: callerChanged
          ? "continue from the first proof_region that is not compiler-certified"
          : callerSynchronizedExisting
            ? "synchronized this session with an existing proof-region certificate; continue from the first globally unresolved region"
          : firstChanged
            ? "other theorem-local workflows were updated; retain this session's existing proof-region state"
            : "retain the existing exact-prefix proof-region certificates",
        affected_sessions: affectedSessions,
      })
    }

    // Coq checks a file sequentially.  A diagnostic after a hole-free
    // proof_region is therefore also a compiler certificate for that exact
    // prefix, even when the whole theorem cannot be closed yet (for example,
    // Qed. reports an incomplete proof because later sibling regions still
    // contain admits).  Previously these theorem-spine failures were returned
    // as unmapped_failure, which left an already checked first region stuck in
    // "unvalidated" forever and prevented the scheduler from dispatching the
    // next region.
    const mappedBlock =
      diagnosticFileMatches(file, input.first_error_file) && input.first_error_line !== undefined
        ? parsed.find(
            (block) =>
              input.first_error_line! >= block.startLine && input.first_error_line! <= block.endLine,
          )
        : undefined
    const prefixCertifiedBlocks =
      !mappedBlock && diagnosticFileMatches(file, input.first_error_file) && input.first_error_line !== undefined
        ? parsed.filter((block) => !block.pending && block.endLine < input.first_error_line!)
        : []
    if (prefixCertifiedBlocks.length > 0) {
      const eligible = new Map(
        prefixCertifiedBlocks.map((block) => [`${block.theorem}\u0000${block.admit_id}`, block]),
      )
      let firstChanged:
        | { admitID: string; oldStatus: BlockStatus; newStatus: BlockStatus }
        | undefined
      let callerChanged:
        | { admitID: string; oldStatus: BlockStatus; newStatus: BlockStatus }
        | undefined
      let affectedSessions = 0

      for (const { sessionID } of sessions) {
        const state = refresh(sessionID, file, input.source).state
        let changed = false
        let sessionChanged:
          | { admitID: string; oldStatus: BlockStatus; newStatus: BlockStatus }
          | undefined
        const queue = state.queue.map((item) => {
          const block = eligible.get(`${item.theorem}\u0000${item.admit_id}`)
          if (!block || item.status !== "unvalidated") return item
          const transition = { admitID: item.admit_id, oldStatus: item.status, newStatus: "solved" as const }
          sessionChanged ??= transition
          firstChanged ??= transition
          changed = true
          return {
            ...item,
            status: "solved" as const,
            validation_certificate: buildValidationCertificate({
              file,
              source: input.source,
              block,
              compilerSignature,
              validator: input.validator,
            }),
            validation_failure: undefined,
            escalation_type: undefined,
            escalation_reason: undefined,
            task_id: undefined,
            context_audit_resume_count: undefined,
            context_audit_feedback: undefined,
            running_started_at: undefined,
            running_lease_expires_at: undefined,
            running_release_reason: undefined,
          }
        })
        if (!changed) continue
        if (sessionID === input.sessionID) callerChanged = sessionChanged
        affectedSessions += 1
        const active = queue.find(
          (item) =>
            item.admit_id === state.active_admit_id && (item.status === "running" || item.status === "split"),
        )
        const repairResolved = Boolean(
          state.active_repair &&
            queue.some(
              (item) => item.admit_id === state.active_repair?.admit_id && item.status === "solved",
            ),
        )
        const certifiedTheorem = sessionChanged
          ? queue.find((item) => item.admit_id === sessionChanged?.admitID)?.theorem
          : undefined
        const incidentState = certifiedTheorem
          ? clearResolvedRepairIncidents(sessionID, state, certifiedTheorem)
          : state
        set(sessionID, {
          ...incidentState,
          phase: computePhase(queue),
          queue,
          active_admit_id: active?.admit_id,
          active_task_id: active?.task_id,
          active_repair: repairResolved ? undefined : state.active_repair,
          fallback_guard: repairResolved ? undefined : state.fallback_guard,
          updated: Date.now(),
        })
      }

      if (callerChanged || firstChanged) {
        const changed = callerChanged ?? firstChanged!
        return lifecycleTransition({
          action: callerChanged ? "certified" : "unchanged",
          admit_id: callerChanged?.admitID,
          old_status: callerChanged?.oldStatus,
          new_status: callerChanged?.newStatus,
          compiler_signature: compilerSignature,
          next_action: callerChanged
            ? "the compiler reached a later failure after this exact proof-region prefix; continue from the first remaining unresolved proof_region"
            : "a later compiler failure certified a prefix owned by another theorem-local workflow",
          affected_sessions: affectedSessions,
        })
      }
    }

    if (!mappedBlock) {
      return lifecycleTransition({
        action: "unmapped_failure",
        compiler_signature: compilerSignature,
        next_action: "keep the first unresolved proof_region active and repair the reported compiler failure",
        affected_sessions: 0,
      })
    }

    let firstChanged: { oldStatus: BlockStatus; newStatus: BlockStatus } | undefined
    let callerChanged: { oldStatus: BlockStatus; newStatus: BlockStatus } | undefined
    let affectedSessions = 0
    for (const { sessionID } of sessions) {
      const state = refresh(sessionID, file, input.source).state
      const targetIndex = state.queue.findIndex(
        (item) => item.theorem === mappedBlock.theorem && item.admit_id === mappedBlock.admit_id,
      )
      if (targetIndex < 0) continue
      const target = state.queue[targetIndex]
      if (target.status !== "solved" && target.status !== "unvalidated") continue
      let changed = false
      let sessionChanged: { oldStatus: BlockStatus; newStatus: BlockStatus } | undefined
      const queue = state.queue.map((item, index) => {
        if (index < targetIndex) return item
        const block = parsedByIdentity.get(`${item.theorem}\u0000${item.admit_id}`)
        if (index === targetIndex) {
          const nextStatus: BlockStatus = block?.pending ? "pending" : "unvalidated"
          const failure: ValidationFailure | undefined = block?.pending
            ? undefined
            : {
                source_hash: regionPrefixHash(input.source, mappedBlock),
                compiler_signature: compilerSignature,
                validator: input.validator,
                first_error_file: input.first_error_file,
                first_error_line: input.first_error_line,
                message: input.first_error_message,
                recorded_at: Date.now(),
              }
          if (
            item.status !== nextStatus ||
            item.validation_certificate ||
            item.validation_failure?.compiler_signature !== compilerSignature
          ) {
            changed = true
            sessionChanged ??= { oldStatus: item.status, newStatus: nextStatus }
            firstChanged ??= sessionChanged
          }
          return {
            ...item,
            status: nextStatus,
            validation_certificate: undefined,
            validation_failure: failure,
            task_id: undefined,
            running_started_at: undefined,
            running_lease_expires_at: undefined,
            running_release_reason: "released after compiler validation failed for this proof prefix",
          }
        }

        if (!item.validation_certificate && item.status !== "solved") return item
        changed = true
        return {
          ...item,
          status: block?.pending ? ("pending" as const) : ("unvalidated" as const),
          validation_certificate: undefined,
          validation_failure: undefined,
          task_id: undefined,
          running_started_at: undefined,
          running_lease_expires_at: undefined,
          running_release_reason: "released behind an earlier compiler validation failure",
        }
      })
      if (!changed) continue
      if (sessionID === input.sessionID) callerChanged = sessionChanged
      affectedSessions += 1
      const activeRepairIndex = state.active_repair
        ? state.queue.findIndex((item) => item.admit_id === state.active_repair?.admit_id)
        : -1
      const activeRepairInvalidated = activeRepairIndex >= targetIndex
      set(sessionID, {
        ...state,
        phase: computePhase(queue),
        queue,
        active_admit_id: undefined,
        active_task_id: undefined,
        active_repair: activeRepairInvalidated ? undefined : state.active_repair,
        fallback_guard: activeRepairInvalidated ? undefined : state.fallback_guard,
        updated: Date.now(),
      })
    }

    return lifecycleTransition({
      action: callerChanged ? "invalidated" : "unmapped_failure",
      admit_id: callerChanged ? mappedBlock.admit_id : undefined,
      old_status: callerChanged?.oldStatus,
      new_status: callerChanged?.newStatus,
      compiler_signature: compilerSignature,
      next_action: callerChanged
        ? "repair and recompile this proof_region before scheduling any later region"
        : firstChanged
          ? "the compiler failure belongs to another theorem-local workflow in this file"
          : "keep this theorem-local workflow unchanged because the compiler failure did not map to it",
      affected_sessions: affectedSessions,
    })
  }

  export function analyzeSource(file: string, source: string, state?: State) {
    const parsed = parseProofObligations(source)
    const queue =
      state?.queue ??
      parsed.map<QueueItem>((block) => ({
        order: block.order,
        owner: block.owner,
        theorem: block.theorem,
        admit_id: block.admit_id,
        start_line: block.startLine,
        end_line: block.endLine,
        status: block.pending ? "pending" : "unvalidated",
        kind: block.kind,
        target_name: block.targetName,
        proof_plan_node: block.proofPlanNode,
        depends_on: block.dependsOn,
        editable_mode: block.editableMode,
        region_start_line: block.editableMode === "region" ? block.startLine : undefined,
        region_end_line: block.editableMode === "region" ? block.endLine : undefined,
      }))
    const theorem = queue[0]?.theorem ?? parsed[0]?.theorem
    const final = theorem ? finalTheoremGate(source, theorem) : { ok: false, reason: "No proof obligations found." }

    return {
      file,
      region_count: parsed.filter((block) => block.editableMode === "region").length,
      legacy_block_count: 0,
      pending_count: queue.filter(
        (item) =>
          item.status === "pending" ||
          item.status === "running" ||
          item.status === "split" ||
          item.status === "unvalidated",
      ).length,
      unvalidated_count: queue.filter((item) => item.status === "unvalidated").length,
      solved_count: queue.filter((item) => item.status === "solved").length,
      remodel_or_escalation_count: queue.filter((item) => item.status === "escalated" || Boolean(item.escalation_type))
        .length,
      region_outside_modification: false,
      final_theorem_gate: final,
    }
  }

  export async function dryRunFile(file: string, state?: State) {
    const source = await Filesystem.readText(file)
    const report = analyzeSource(file, source, state)
    const scaffold = await Validation.scaffold(file)
    return {
      ...report,
      scaffold_gate: scaffold,
    }
  }

  function structuralEscalation(type: EscalationType | undefined) {
    return (
      type === "needs_preceding_bridge" ||
      type === "needs_uniqueness_bridge" ||
      type === "needs_context_strengthening" ||
      type === "needs_theorem_spine_change" ||
      type === "needs_subgoal_remodel" ||
      type === "blocked_by_sibling_syntax" ||
      type === "not_local"
    )
  }

  async function siblingDiagnosticBlocker(file: string, item: QueueItem, source?: string) {
    if (item.editable_mode !== "region") return undefined
    if (source !== undefined) {
      const diskSource = await Filesystem.readText(file).catch(() => undefined)
      if (diskSource === undefined || sourceHash(diskSource) !== sourceHash(source)) return undefined
    }
    await LSP.touchFile(file, true).catch(() => undefined)
    const diagnostics = await LSP.diagnostics().catch(() => undefined)
    const errors = diagnostics?.[file]?.filter((diag) => (diag.severity ?? 1) === 1) ?? []
    const start = item.region_start_line ?? item.start_line
    const end = item.region_end_line ?? item.end_line
    const blocker = errors.find((diag) => {
      const line = diag.range.start.line + 1
      return line < start || line > end
    })
    if (!blocker) return undefined
    return `[${blocker.range.start.line + 1}:${blocker.range.start.character + 1}] ${blocker.message}`
  }

  function markEscalated(
    sessionID: string,
    state: State,
    item: QueueItem,
    escalationType: EscalationType,
    reason: string,
  ) {
    const queue = state.queue.map((entry) =>
      entry.admit_id === item.admit_id
        ? {
            ...entry,
            status: "escalated" as const,
            escalation_type: escalationType,
            escalation_reason: reason,
          }
        : entry,
    )
    const escalatedItem = queue.find((entry) => entry.admit_id === item.admit_id && entry.status === "escalated")
    const activeRepair = escalatedItem ? repairAssignment(state.file, escalatedItem) : state.active_repair
    return set(sessionID, {
      file: state.file,
      phase: computePhase(queue),
      queue,
      active_admit_id: undefined,
      active_task_id: undefined,
      latest_escalation: {
        admit_id: item.admit_id,
        escalation_type: escalationType,
        reason,
        task_id: item.task_id,
        updated: Date.now(),
      },
      active_repair: activeRepair,
      fallback_guard:
        activeRepair && sameRepairBlocker(activeRepair, state.active_repair) ? state.fallback_guard : undefined,
      updated: Date.now(),
    })
  }

  function escalateToRepair(
    sessionID: string,
    state: State,
    item: QueueItem,
    file: string,
    source: string,
    escalationType: EscalationType,
    reason: string,
  ) {
    const nextState = markEscalated(sessionID, state, item, escalationType, reason)
    const escalated = nextState.queue.find((entry) => entry.admit_id === item.admit_id && entry.status === "escalated")
    if (!escalated) return undefined
    const assignment = repairAssignment(file, escalated, source, sessionID)
    if (!assignment) return undefined
    const tracked = reason.includes("scaffold gate failed")
      ? registerRepairIncident(sessionID, nextState, escalated, escalationType, reason, source)
      : { repeated: false, state: nextState, incident: undefined }
    if (tracked.repeated && tracked.incident) {
      const now = Date.now()
      const reason =
        "same checkpoint failure recurred without a substantive Coq source change; admit_id, marker, comment, and whitespace changes are not proof progress"
      set(sessionID, {
        ...tracked.state,
        phase: "prover",
        active_repair: assignment,
        fallback_guard: {
          blocker_admit_id: assignment.admit_id,
          theorem_fingerprint: tracked.incident.signature,
          source_fingerprint: tracked.incident.source_fingerprint ?? assignment.source_fingerprint,
          region_fingerprint: assignment.region_fingerprint,
          passive_lookup_streak: 0,
          tripped_at: now,
          reason,
        },
        updated: now,
      })
      return undefined
    }
    return scheduleRepairOrLock({
      sessionID,
      state: tracked.state,
      item: escalated,
      assignment,
      source,
    })
  }

  function releaseRunning(sessionID: string, state: State, item: QueueItem, reason: string) {
    const queue = state.queue.map((entry) =>
      entry.admit_id === item.admit_id
        ? {
            ...entry,
            status: "pending" as const,
            task_id: undefined,
            running_started_at: undefined,
            running_lease_expires_at: undefined,
            running_release_reason: reason,
          }
        : entry,
    )

    return set(sessionID, {
      file: state.file,
      phase: computePhase(queue),
      queue,
      active_admit_id: undefined,
      active_task_id: undefined,
      latest_escalation: state.latest_escalation,
      active_repair: state.active_repair,
      fallback_guard: state.fallback_guard,
      updated: Date.now(),
    })
  }

  function releaseExpiredRunningIfNeeded(sessionID: string, state: State, item: QueueItem, reason: string) {
    if (!isRunningLeaseExpired(item)) return state
    return releaseRunning(sessionID, state, item, reason)
  }

  function assignmentFromTaskPart(part: MessageV2.ToolPart) {
    const metadata = "metadata" in part.state ? part.state.metadata : undefined
    const input = part.state.input
    const raw =
      metadata && typeof metadata === "object" && "lemma_assignment" in metadata
        ? metadata.lemma_assignment
        : input && typeof input === "object" && "lemma_assignment" in input
          ? input.lemma_assignment
          : undefined
    return raw && typeof raw === "object" ? raw : undefined
  }

  function proofResultValidation(metadata: Record<string, unknown>) {
    const validation = metadata.proof_result_validation
    if (!validation || typeof validation !== "object") return undefined
    const record = validation as Record<string, unknown>
    const errors = Array.isArray(record.errors) ? record.errors.map(String) : []
    return {
      valid: record.valid === true,
      errors,
    }
  }

  function proofResultContextAuditReview(metadata: Record<string, unknown>): ContextAuditReview | undefined {
    const raw = metadata.context_audit_review
    if (!raw || typeof raw !== "object") return undefined
    const record = raw as Record<string, unknown>
    const outcome = record.outcome
    if (outcome !== undefined && outcome !== "convertible" && outcome !== "not_convertible" && outcome !== "inconclusive") {
      return undefined
    }
    return {
      applicable: record.applicable === true,
      audit_id: typeof record.audit_id === "string" ? record.audit_id : undefined,
      verified: record.verified === true,
      outcome,
      failed_local_bridge: record.failed_local_bridge === true,
      action: typeof record.action === "string" ? record.action : "unspecified",
    }
  }

  function findLatestLemmaOutcome(messages: MessageV2.WithParts[], admitID: string): LemmaOutcome | undefined {
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
      const message = messages[messageIndex]
      for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = message.parts[partIndex]
        if (part.type !== "tool" || part.tool !== "task" || part.state.status !== "completed") continue

        const metadata = "metadata" in part.state ? part.state.metadata : undefined
        if (!metadata || typeof metadata !== "object") continue

        const assignment = "lemma_assignment" in metadata ? metadata.lemma_assignment : undefined
        if (!assignment || typeof assignment !== "object") continue
        if (!("admit_id" in assignment) || assignment.admit_id !== admitID) continue

        const summary = "proof_result_summary" in metadata ? metadata.proof_result_summary : undefined
        if (!summary || typeof summary !== "object" || !("status" in summary)) continue

        const validation = proofResultValidation(metadata as Record<string, unknown>)
        if (validation && !validation.valid) {
          const taskID = typeof metadata.sessionId === "string" ? metadata.sessionId : undefined
          const assignmentParsed = LemmaAssignmentSchema.safeParse(assignment)
          return {
            status: "escalate",
            taskID,
            assignment: assignmentParsed.success ? assignmentParsed.data : undefined,
            escalationType: "not_local",
            escalationReason: `Lemma proof_result failed structured validation: ${validation.errors.join("; ") || "invalid proof_result"}`,
          }
        }

        const rawStatus = summary.status
        if (rawStatus !== "solved" && rawStatus !== "split" && rawStatus !== "escalate") continue

        const taskID = typeof metadata.sessionId === "string" ? metadata.sessionId : undefined
        const model =
          "model" in metadata &&
          metadata.model &&
          typeof metadata.model === "object" &&
          "providerID" in metadata.model &&
          "modelID" in metadata.model
            ? {
                providerID: String(metadata.model.providerID),
                modelID: String(metadata.model.modelID),
              }
            : undefined

        const assignmentParsed = LemmaAssignmentSchema.safeParse(assignment)
        const summaryRecord = summary as Record<string, unknown>
        const rawEscalationType = summaryRecord.escalation_type
        const escalationType = EscalationType.safeParse(rawEscalationType).success
          ? (rawEscalationType as EscalationType)
          : undefined
        const rawRemodelRequest = summaryRecord.remodel_request
        const remodelRequest = RemodelRequestSchema.safeParse(rawRemodelRequest).success
          ? (rawRemodelRequest as RemodelRequest)
          : undefined
        const rawAttemptReport = summaryRecord.attempt_report
        const attemptReport = BlockedProofReportSchema.safeParse(rawAttemptReport).success
          ? (rawAttemptReport as BlockedProofReport)
          : undefined
        const escalationReason =
          typeof summaryRecord.escalate_reason === "string" ? summaryRecord.escalate_reason : undefined
        const proofResult =
          "proof_result" in metadata && metadata.proof_result && typeof metadata.proof_result === "object"
            ? (metadata.proof_result as Record<string, unknown>)
            : undefined
        const proofText = typeof proofResult?.proof_text === "string" ? proofResult.proof_text : undefined
        const contextAuditReview = proofResultContextAuditReview(metadata as Record<string, unknown>)

        return {
          status: rawStatus,
          taskID,
          model,
          assignment: assignmentParsed.success ? assignmentParsed.data : undefined,
          escalationType,
          escalationReason,
          remodelRequest,
          attemptReport,
          proofText,
          contextAuditReview,
        }
      }
    }

    return undefined
  }

  function modelFromMetadata(metadata: Record<string, unknown>) {
    const model = metadata.model
    return model && typeof model === "object" && "providerID" in model && "modelID" in model
      ? {
          providerID: String(model.providerID),
          modelID: String(model.modelID),
        }
      : undefined
  }

  function findLatestLemmaTask(messages: MessageV2.WithParts[]): LatestLemmaTask | undefined {
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
      const message = messages[messageIndex]
      for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = message.parts[partIndex]
        if (part.type !== "tool" || part.tool !== "task") continue
        if (
          part.state.status !== "completed" &&
          part.state.status !== "error" &&
          part.state.status !== "running" &&
          part.state.status !== "pending"
        )
          continue

        const metadata = "metadata" in part.state ? part.state.metadata : undefined
        const metadataRecord = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {}
        const assignment = assignmentFromTaskPart(part)
        if (!assignment || typeof assignment !== "object") continue
        if (!("admit_id" in assignment) || typeof assignment.admit_id !== "string") continue

        const validation = proofResultValidation(metadataRecord)
        const hasStructuredOutcome = "proof_result" in metadataRecord || "proof_result_summary" in metadataRecord
        const summary = "proof_result_summary" in metadataRecord ? metadataRecord.proof_result_summary : undefined
        const rawStatus = summary && typeof summary === "object" && "status" in summary ? summary.status : undefined
        const status =
          rawStatus === "solved" || rawStatus === "split" || rawStatus === "escalate"
            ? rawStatus
            : part.state.status === "error"
              ? "error"
              : part.state.status === "running"
                ? "running"
                : part.state.status === "pending"
                  ? "pending"
                  : "completed"
        const taskID =
          "sessionId" in metadataRecord && typeof metadataRecord.sessionId === "string"
            ? metadataRecord.sessionId
            : undefined
        const summaryRecord = summary && typeof summary === "object" ? (summary as Record<string, unknown>) : undefined
        const rawEscalationType = summaryRecord?.escalation_type
        const escalationType = EscalationType.safeParse(rawEscalationType).success
          ? (rawEscalationType as EscalationType)
          : undefined
        const rawRemodelRequest = summaryRecord?.remodel_request
        const remodelRequest = RemodelRequestSchema.safeParse(rawRemodelRequest).success
          ? (rawRemodelRequest as RemodelRequest)
          : undefined
        const rawAttemptReport = summaryRecord?.attempt_report
        const attemptReport = BlockedProofReportSchema.safeParse(rawAttemptReport).success
          ? (rawAttemptReport as BlockedProofReport)
          : undefined

        return {
          admitID: assignment.admit_id,
          status,
          taskID,
          model: modelFromMetadata(metadataRecord),
          hasStructuredOutcome,
          proofResultValid: validation?.valid,
          validationErrors: validation?.errors,
          error: part.state.status === "error" ? part.state.error : undefined,
          escalationType,
          remodelRequest,
          attemptReport,
        }
      }
    }

    return undefined
  }

  function findLatestLemmaTaskForAdmit(messages: MessageV2.WithParts[], admitID: string) {
    const latest = findLatestLemmaTask(messages)
    return latest?.admitID === admitID ? latest : undefined
  }

  function routeContextEscalation(item: QueueItem, outcome: LemmaOutcome): LemmaOutcome {
    if (outcome.status !== "escalate" || outcome.escalationType !== "needs_context_strengthening") {
      return outcome
    }

    const basis = outcome.attemptReport?.context_mismatch_basis
    const applicable = Boolean(outcome.contextAuditReview?.applicable || (basis && basis !== "other"))
    if (!applicable || (item.context_audit_resume_count ?? 0) >= 1) return outcome

    const audit = outcome.contextAuditReview
    if (audit?.verified && audit.outcome === "not_convertible" && audit.failed_local_bridge) {
      return outcome
    }

    const feedback = audit?.verified
      ? audit.outcome === "convertible"
        ? "The verified context audit found the compared expressions convertible. Try one explicit local normalization or bridge that exposes that convertibility in the current goal before escalating again."
        : audit.outcome === "not_convertible"
          ? "The verified audit found the compared expressions non-convertible, but the report did not document a failed concrete local bridge. Attempt that smallest bridge once and record the exact failure if escalation remains necessary."
          : "The verified context audit was inconclusive. Re-inspect only the exact hidden/implicit/Section/Module/alias mismatch and make one concrete local bridge attempt before returning the best structured result."
      : "The context-normalization evidence was missing or could not be verified. Perform one targeted live-context inspection, or one concrete local normalization bridge attempt, before returning the best structured result."

    return {
      ...outcome,
      status: "split",
      contextAuditResume: true,
      escalationReason: feedback,
    }
  }

  function failedLemmaFromReport(report: BlockedProofReport, candidates: string[] = []) {
    const evidence = [report.failed_local_bridge, ...report.failed_tactics_or_edits]
      .filter((entry): entry is string => Boolean(entry))
      .join("\n")
    const exactCandidate = candidates.find((candidate) =>
      new RegExp(`\\b${escapeRegExp(candidate)}\\b`).test(evidence),
    )
    if (exactCandidate) return exactCandidate
    const applied = /\b(?:e?apply|rewrite|pose\s+proof|specialize|have)\s*\(?\s*([A-Za-z_][A-Za-z0-9_.']*)/i.exec(
      evidence,
    )?.[1]
    if (applied) return applied
    return /\b([A-Za-z_][A-Za-z0-9_.']+)\s+(?:lemma|theorem)\b/i.exec(evidence)?.[1]
  }

  function recordVerifiedRouteFailure(
    state: State,
    item: QueueItem,
    outcome: LemmaOutcome,
    source: string,
  ) {
    if (
      outcome.status !== "escalate" ||
      (outcome.escalationType !== "needs_context_strengthening" &&
        outcome.escalationType !== "needs_preceding_bridge")
    ) return
    const report = outcome.attemptReport
    const embeddedAudit = report?.context_audit
    const trustedAudit = outcome.contextAuditReview
    const verifiedNonConvertible = Boolean(
      (trustedAudit?.verified && trustedAudit.outcome === "not_convertible" && trustedAudit.failed_local_bridge) ||
        (embeddedAudit?.verified && embeddedAudit.outcome === "not_convertible" && report?.failed_local_bridge),
    )
    const reportedMissingPremise = Boolean(
      outcome.escalationType === "needs_preceding_bridge" &&
        report?.failed_local_bridge &&
        (report.suspected_missing_bridge || report.proposed_children.length > 0),
    )
    if (!report || (!verifiedNonConvertible && !reportedMissingPremise) || !report.failed_local_bridge) return

    const block = parseProofObligations(source).find((entry) => entry.admit_id === item.admit_id)
    const missingPremises = report.suspected_missing_bridge
      ? [report.suspected_missing_bridge]
      : report.proposed_children.map((child) => child.statement)
    const failedLemma = failedLemmaFromReport(report, [
      ...(block?.prosaCandidateLemmas ?? []),
      ...(block?.mathcompCandidateLemmas ?? []),
    ])
    if (outcome.escalationType === "needs_preceding_bridge" && !failedLemma) return
    const planNode = state.decomposition_plan?.accepted_plan?.nodes.find(
      (node) => (node.node_id ?? node.paper_step_id) === block?.proofPlanNode,
    )
    const auditedCandidate = [...(planNode?.prosa_candidate_lemmas ?? []), ...(planNode?.mathcomp_candidate_lemmas ?? [])]
      .find((candidate) => candidate.name === failedLemma)
    const auditedMissingPremises = auditedCandidate?.audit?.verdict === "bridge_required"
      ? auditedCandidate.audit.residual_premises
      : []
    const preciseMissingPremises = auditedMissingPremises.length > 0 ? auditedMissingPremises : missingPremises
    const verifiedMissingPremise = Boolean(
      reportedMissingPremise &&
        auditedCandidate?.audit?.verdict === "bridge_required" &&
        auditedCandidate.audit.residual_premise_fingerprints.length > 0,
    )
    const routeSummary = report.suspected_missing_bridge
      ? `The current route is missing a premise or bridge: ${report.suspected_missing_bridge}`
      : `The attempted local bridge is not convertible in the live theorem context: ${report.failed_local_bridge}`
    const evidence = [
      report.failed_local_bridge,
      embeddedAudit?.diagnostic,
      embeddedAudit ? `left=${embeddedAudit.left_summary}` : undefined,
      embeddedAudit ? `right=${embeddedAudit.right_summary}` : undefined,
      trustedAudit?.audit_id ? `trusted_audit=${trustedAudit.audit_id}` : undefined,
      trustedAudit?.action ? `audit_action=${trustedAudit.action}` : undefined,
      `goal=${report.stable_blocker_goal}`,
    ]
      .filter((entry): entry is string => Boolean(entry))
      .join("; ")

    try {
      ProofRouteLedger.recordRouteFailure({
        workspace: Instance.worktree === "/" ? Instance.directory : Instance.worktree,
        file: state.file,
        theorem: item.theorem,
        theorem_context_fingerprint: ProofRouteLedger.theoremContextFingerprint(source, item.theorem),
        plan_fingerprint: state.decomposition_plan?.accepted_semantic_fingerprint,
        node_id: block?.proofPlanNode,
        admit_id: item.admit_id,
        target_contract_fingerprint:
          auditedCandidate?.audit?.target_contract_fingerprint ??
          ProofRouteLedger.targetContractFingerprint(block?.targetStatement ?? report.stable_blocker_goal),
        kind: preciseMissingPremises.length > 0 ? "lemma_missing_premise" : "lemma_interface_mismatch",
        failed_lemma: failedLemma,
        lemma_type_fingerprint: auditedCandidate?.audit?.lemma_type_fingerprint,
        failed_instantiation_fingerprint: auditedCandidate?.audit?.instantiation_fingerprint,
        missing_premises: preciseMissingPremises,
        missing_premise_fingerprints:
          auditedCandidate?.audit?.residual_premise_fingerprints ??
          preciseMissingPremises.map(ProofRouteLedger.premiseFingerprint),
        route_summary: routeSummary,
        evidence,
        // A child report alone remains useful cross-session memory, but only
        // a mechanical candidate application audit may promote a missing-
        // premise route to the verified hard gate.
        confidence: verifiedNonConvertible || verifiedMissingPremise ? "verified" : "tentative",
        // A verified local mismatch does not by itself prove that the theorem
        // decomposition is wrong. Keep the exported target and permit a new
        // lemma, instantiation, normal form, or same-region helper first.
        recommended_action: preciseMissingPremises.length > 0 ? "prove_missing_premise" : "replace_lemma",
      })
    } catch (error) {
      log.warn("failed to persist verified route failure", {
        file: state.file,
        theorem: item.theorem,
        admit_id: item.admit_id,
        error,
      })
    }
  }

  async function persistOutcome(
    sessionID: string,
    state: State,
    item: QueueItem,
    outcome: LemmaOutcome,
    source: string,
  ) {
    const admitID = item.admit_id
    const baseQueue = state.queue.some((entry) => entry.admit_id === admitID) ? state.queue : [...state.queue, item]
    const regionChanged = !regionOutsideUnchanged(outcome.assignment, source)
    let status: BlockStatus =
      outcome.status === "solved" && !regionChanged
        ? "solved"
        : outcome.status === "split" && !regionChanged
          ? "split"
          : "escalated"
    let escalationType = regionChanged ? "not_local" : outcome.escalationType
    let escalationReason = regionChanged
      ? "Lemma task modified text outside its editable proof_region."
      : outcome.escalationReason
    let validationCertificate: ValidationCertificate | undefined

    if (status === "solved") {
      const solvedGate = await solvedValidationGate(sessionID, state.file, item, outcome, source)
      if (!solvedGate.ok) {
        status = "escalated"
        escalationType = solvedGate.escalation_type
        escalationReason = solvedGate.reason
      } else if ("certificate" in solvedGate) {
        validationCertificate = solvedGate.certificate
      }
    }

    const queue: QueueItem[] = baseQueue.map((entry) =>
      entry.admit_id === admitID
        ? {
            ...entry,
            status,
            task_id: outcome.taskID ?? entry.task_id,
            escalation_type: escalationType,
            escalation_reason: escalationReason,
            remodel_request: outcome.remodelRequest,
            attempt_report: outcome.attemptReport,
            validation_certificate: status === "solved" ? validationCertificate : undefined,
            validation_failure: undefined,
            context_audit_resume_count:
              status === "solved"
                ? undefined
                : status === "split" && outcome.contextAuditResume
                  ? (entry.context_audit_resume_count ?? 0) + 1
                  : entry.context_audit_resume_count,
            context_audit_feedback:
              status === "solved"
                ? undefined
                : status === "split" && outcome.contextAuditResume
                  ? escalationReason ?? "Perform one targeted context-normalization retry."
                  : entry.context_audit_feedback,
            running_started_at: undefined,
            running_lease_expires_at: undefined,
            running_release_reason: undefined,
          }
        : entry,
    )
    const latestEscalation =
      status === "escalated" && escalationType
        ? {
            admit_id: admitID,
            escalation_type: escalationType,
            reason: escalationReason ?? "Lemma task escalated this proof obligation.",
            remodel_request: outcome.remodelRequest,
            attempt_report: outcome.attemptReport,
            task_id: outcome.taskID,
            updated: Date.now(),
          }
        : state.latest_escalation
    const escalatedItem = queue.find((entry) => entry.admit_id === admitID && entry.status === "escalated")
    const activeRepair = escalatedItem
      ? repairAssignment(state.file, escalatedItem)
      : status === "solved" && state.active_repair?.admit_id === admitID
        ? undefined
        : state.active_repair

    const persisted = set(sessionID, {
      file: state.file,
      phase: computePhase(queue),
      queue,
      active_admit_id: status === "split" ? admitID : undefined,
      active_task_id: status === "split" ? outcome.taskID : undefined,
      latest_escalation: latestEscalation,
      active_repair: activeRepair,
      fallback_guard:
        activeRepair && sameRepairBlocker(activeRepair, state.active_repair) ? state.fallback_guard : undefined,
      updated: Date.now(),
    })
    if (status === "escalated") recordVerifiedRouteFailure(persisted, item, outcome, source)
    return persisted
  }

  function markRunning(sessionID: string, state: State, item: QueueItem, taskID?: string) {
    const now = Date.now()
    const queue = state.queue.map((entry) =>
      entry.admit_id === item.admit_id
        ? {
            ...entry,
            status: "running" as const,
            task_id: taskID ?? entry.task_id,
            running_started_at: now,
            running_lease_expires_at: now + runningLeaseMs(),
          }
        : entry,
    )

    return set(sessionID, {
      file: state.file,
      phase: computePhase(queue),
      queue,
      active_admit_id: item.admit_id,
      active_task_id: taskID ?? item.task_id,
      latest_escalation: state.latest_escalation,
      active_repair: state.active_repair,
      fallback_guard: state.fallback_guard,
      updated: Date.now(),
    })
  }

  function firstUnresolved(queue: QueueItem[]) {
    return queue.find((item) => item.status !== "solved")
  }

  function queueItemNodeID(item: QueueItem) {
    return item.proof_plan_node ?? item.admit_id
  }

  function dependencyReady(queue: QueueItem[], item: QueueItem) {
    const byNode = new Map(queue.map((candidate) => [queueItemNodeID(candidate), candidate]))
    return item.depends_on.every((dependency) => {
      const producer = byNode.get(dependency)
      // Dependencies such as theorem hypotheses or context facts are not queue
      // nodes and are already available to the region. Only an accepted DAG
      // producer represented by another proof_region can block dispatch.
      return !producer || producer.status === "solved"
    })
  }

  function readyUnresolved(queue: QueueItem[]) {
    const active = queue.find((item) => item.status === "running" || item.status === "split")
    if (active) return [active]
    const priority: Record<BlockStatus, number> = {
      unvalidated: 0,
      pending: 1,
      escalated: 2,
      running: 3,
      split: 3,
      solved: 4,
    }
    return queue
      .filter((item) => item.status !== "solved" && dependencyReady(queue, item))
      .sort((left, right) => priority[left.status] - priority[right.status] || left.order - right.order)
  }

  function firstReadyUnresolved(queue: QueueItem[]) {
    return readyUnresolved(queue)[0] ?? firstUnresolved(queue)
  }

  function theoremFingerprint(source: string, theorem?: string) {
    return hashText((theorem ? theoremRange(source, theorem) : undefined) ?? source)
  }

  function theoremStructureFingerprint(source: string, theorem?: string) {
    const text = (theorem ? theoremRange(source, theorem) : undefined) ?? source
    const normalized = text
      .replace(/\(\*[\s\S]*?\*\)/g, " ")
      .replace(/\b(?:admit_id|plan_node|target|owner|theorem)\s*:\s*[^\s*]+/g, " ")
      .replace(/"(?:\\.|[^"\\])*"/g, "STRING")
      .replace(/\b\d+\b/g, "NUMBER")
      .replace(/\b[A-Za-z_][A-Za-z0-9_']*\b/g, "IDENT")
      .replace(/\s+/g, "")
    return hashText(normalized)
  }

  function toolInputString(input: Record<string, unknown>, key: string) {
    const value = input[key]
    return typeof value === "string" ? value : ""
  }

  function toolInputTouchesFile(input: Record<string, unknown>, targetFile: string) {
    const raw = typeof input.filePath === "string" ? input.filePath : input.file
    if (typeof raw !== "string" || !raw) return false
    const resolved = path.normalize(path.isAbsolute(raw) ? raw : path.resolve(Instance.directory, raw))
    return resolved === path.normalize(targetFile)
  }

  function isFallbackPassiveLookupPart(part: MessageV2.WithParts["parts"][number]) {
    if (part.type !== "tool" || part.state.status !== "completed") return false
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

  function isFallbackActivePart(part: MessageV2.WithParts["parts"][number], targetFile?: string) {
    if (part.type === "patch") {
      if (!targetFile) return true
      const rel = path.relative(Instance.worktree, targetFile)
      return part.files.includes(targetFile) || part.files.includes(rel)
    }
    if (part.type !== "tool" || part.state.status !== "completed") return false
    if (
      (part.tool === "edit" || part.tool === "write" || part.tool === "coqc" || part.tool === "checkpoint") &&
      (!targetFile || toolInputTouchesFile(part.state.input, targetFile))
    ) {
      return true
    }
    if (part.tool === "coq_session") return toolInputString(part.state.input, "op") === "step"
    if (part.tool === "petanque") {
      const verb = toolInputString(part.state.input, "command") || toolInputString(part.state.input, "op")
      return Boolean(verb) && !["search", "check", "print", "goal", "inspect", "open"].includes(verb)
    }
    return false
  }

  function fallbackPassiveLookupStreak(messages: MessageV2.WithParts[], targetFile?: string) {
    let streak = 0
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
      const message = messages[messageIndex]
      for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = message.parts[partIndex]
        if (isFallbackPassiveLookupPart(part)) {
          streak += 1
          continue
        }
        if (isFallbackActivePart(part, targetFile)) return streak
        if (part.type === "tool" || part.type === "patch") return streak
      }
    }
    return streak
  }

  function repairChildNonMaterializingActionCount(messages: MessageV2.WithParts[], after?: number) {
    let count = 0
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
      const message = messages[messageIndex]
      const messageTime =
        message.info.role === "assistant"
          ? message.info.time?.completed ?? message.info.time?.created ?? 0
          : message.info.time?.created ?? 0
      for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = message.parts[partIndex]
        if (part.type === "patch") {
          if (after !== undefined && messageTime <= after) continue
          count += 1
          continue
        }
        if (part.type !== "tool") continue
        if (part.state.status !== "completed" && part.state.status !== "error") continue
        if (after !== undefined && part.state.time.end <= after) continue
        count += 1
      }
    }
    return count
  }

  function latestTargetEditAt(messages: MessageV2.WithParts[], targetFile: string) {
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
      const message = messages[messageIndex]
      for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = message.parts[partIndex]
        if (part.type === "patch") {
          const rel = path.relative(Instance.worktree, targetFile)
          if (part.files.includes(targetFile) || part.files.includes(rel)) return Date.now()
          continue
        }
        if (part.type !== "tool" || part.state.status !== "completed") continue
        if ((part.tool === "edit" || part.tool === "write") && toolInputTouchesFile(part.state.input, targetFile)) {
          return part.state.time.end
        }
      }
    }
    return undefined
  }

  function latestAcceptedProgressAt(messages: MessageV2.WithParts[], targetFile: string) {
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
      const message = messages[messageIndex]
      for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = message.parts[partIndex]
        if (part.type !== "tool" || part.state.status !== "completed") continue
        if ((part.tool !== "coqc" && part.tool !== "checkpoint") || !toolInputTouchesFile(part.state.input, targetFile))
          continue
        const proofStatus = part.state.metadata.proof_status
        if (!proofStatus || typeof proofStatus !== "object") continue
        const proofProgress = "proof_progress" in proofStatus ? proofStatus.proof_progress : undefined
        if (
          proofProgress &&
          typeof proofProgress === "object" &&
          "accepted" in proofProgress &&
          proofProgress.accepted === true &&
          "receipt" in proofProgress &&
          Boolean(proofProgress.receipt)
        ) {
          return part.state.time.end
        }
      }
    }
    return undefined
  }

  function latestProofStatus(messages: MessageV2.WithParts[], targetFile: string) {
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
      const message = messages[messageIndex]
      for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = message.parts[partIndex]
        if (part.type !== "tool" || part.state.status !== "completed") continue
        if ((part.tool !== "coqc" && part.tool !== "checkpoint") || !toolInputTouchesFile(part.state.input, targetFile))
          continue
        const metadata = part.state.metadata
        if (!metadata || typeof metadata !== "object") continue
        const proofStatus = "proof_status" in metadata ? metadata.proof_status : undefined
        if (!proofStatus || typeof proofStatus !== "object") continue
        const status = proofStatus as Record<string, unknown>
        const progress =
          status.proof_progress && typeof status.proof_progress === "object"
            ? (status.proof_progress as Record<string, unknown>)
            : undefined
        const current =
          progress?.current && typeof progress.current === "object"
            ? (progress.current as Record<string, unknown>)
            : undefined
        return {
          accepted: progress?.accepted === true && Boolean(progress.receipt),
          unfinishedCount: typeof current?.unfinished_count === "number" ? current.unfinished_count : undefined,
          statusDetail: typeof status.status_detail === "string" ? status.status_detail : undefined,
          time: part.state.time.end,
        }
      }
    }
    return undefined
  }

  function repairChildCompilerSignatureStreak(
    messages: MessageV2.WithParts[],
    targetFile: string,
    after?: number,
  ) {
    let signature: string | undefined
    let count = 0
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type !== "tool" || part.state.status !== "completed") continue
        if (after !== undefined && part.state.time.end <= after) continue
        if ((part.tool !== "coqc" && part.tool !== "checkpoint") || !toolInputTouchesFile(part.state.input, targetFile))
          continue
        const metadata = part.state.metadata
        if (!metadata || typeof metadata !== "object") continue
        const lifecycle = "proof_region_lifecycle" in metadata ? metadata.proof_region_lifecycle : undefined
        if (!lifecycle || typeof lifecycle !== "object" || !("compiler_signature" in lifecycle)) continue
        const next = typeof lifecycle.compiler_signature === "string" ? lifecycle.compiler_signature : undefined
        if (!next) continue
        if (next === signature) count += 1
        else {
          signature = next
          count = 1
        }
      }
    }
    return { signature, count }
  }

  function repairAssignment(
    file: string,
    item: QueueItem,
    source?: string,
    sessionID?: string,
  ): ProofRepairAssignment | undefined {
    if (!item.escalation_type || !item.escalation_reason) return undefined
    const metrics = source ? proofProgressMetrics(sessionID ?? "", file, source, item.theorem) : undefined
    return {
      file,
      theorem: item.theorem,
      admit_id: item.admit_id,
      escalation_type: item.escalation_type,
      reason: item.escalation_reason,
      region_start_line: item.region_start_line ?? item.start_line,
      region_end_line: item.region_end_line ?? item.end_line,
      region_fingerprint: item.region_fingerprint,
      original_unresolved: item.status !== "solved",
      theorem_fingerprint: source ? theoremFingerprint(source, item.theorem) : undefined,
      theorem_structure_fingerprint: source ? theoremStructureFingerprint(source, item.theorem) : undefined,
      source_fingerprint: source ? repairSourceFingerprint(source, item.theorem) : undefined,
      unfinished_baseline: metrics?.unfinished_count,
      // Every repair transaction gets an explicit receipt boundary.  Source
      // edits, marker renames, and a receipt left over from an earlier repair
      // must not release the newly-created blocker.
      accepted_progress_baseline_at: sessionID
        ? Math.max(
            Date.now(),
            lastProgressReceiptAt,
            get(sessionID)?.last_progress_receipt?.recorded_at ?? 0,
          )
        : undefined,
      continuation_count: 0,
      remodel_request: item.remodel_request,
      attempt_report: item.attempt_report,
    }
  }

  function sameRepairBlocker(left: ProofRepairAssignment | undefined, right: ProofRepairAssignment | undefined) {
    if (!left || !right) return false
    return left.admit_id === right.admit_id && left.region_fingerprint === right.region_fingerprint
  }

  function proofRepairAssignmentMatches(left: ProofRepairAssignment, right: ProofRepairAssignment) {
    return (
      normalizedWorkflowFile(left.file) === normalizedWorkflowFile(right.file) &&
      left.theorem === right.theorem &&
      left.admit_id === right.admit_id &&
      left.escalation_type === right.escalation_type &&
      left.region_fingerprint === right.region_fingerprint &&
      normalizedRepairReason(left.reason) === normalizedRepairReason(right.reason) &&
      (!left.source_fingerprint ||
        !right.source_fingerprint ||
        left.source_fingerprint === right.source_fingerprint)
    )
  }

  function findLatestRepairTaskForAdmit(messages: MessageV2.WithParts[], admitID: string) {
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
      const message = messages[messageIndex]
      for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = message.parts[partIndex]
        if (part.type !== "tool" || part.tool !== "task") continue
        if (
          part.state.status !== "completed" &&
          part.state.status !== "error" &&
          part.state.status !== "running" &&
          part.state.status !== "pending"
        )
          continue
        const metadata = "metadata" in part.state ? part.state.metadata : undefined
        const metadataRecord = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {}
        const repair = "proof_repair_assignment" in metadataRecord ? metadataRecord.proof_repair_assignment : undefined
        if (!repair || typeof repair !== "object") continue
        if (!("admit_id" in repair) || repair.admit_id !== admitID) continue
        if (metadataRecord.proof_scope !== "theorem_repair") continue
        return {
          status: part.state.status,
          time: part.state.status === "completed" || part.state.status === "error" ? part.state.time.end : undefined,
          output: part.state.status === "completed" ? part.state.output : undefined,
        }
      }
    }
    return undefined
  }

  function markRepairing(sessionID: string, state: State, item: QueueItem, assignment: ProofRepairAssignment) {
    const now = Date.now()
    const queue = state.queue.map((entry) =>
      entry.admit_id === item.admit_id
        ? {
            ...entry,
            takeover_agent: "prover",
            takeover_reason: `theorem repair required after ${assignment.escalation_type}: ${assignment.reason}`,
            takeover_at: now,
          }
        : entry,
    )
    return set(sessionID, {
      file: state.file,
      phase: "prover",
      queue,
      active_admit_id: undefined,
      active_task_id: undefined,
      latest_escalation: state.latest_escalation,
      active_repair: assignment,
      fallback_guard: undefined,
      updated: now,
    })
  }

  export function buildRepairHandoff(input: {
    sessionID: string
    file: string
    source: string
    assignment: ProofRepairAssignment
  }) {
    const file = normalizedWorkflowFile(input.file)
    const refreshed = refresh(input.sessionID, file, input.source)
    const block = refreshed.parsed.get(input.assignment.admit_id)
    const item = refreshed.state.queue.find(
      (candidate) =>
        candidate.theorem === input.assignment.theorem &&
        candidate.admit_id === input.assignment.admit_id,
    )
    const dependencyNodes = new Set(item?.depends_on ?? [])
    const certifiedDependencies = refreshed.state.queue
      .filter(
        (candidate) =>
          candidate.theorem === input.assignment.theorem &&
          candidate.status === "solved" &&
          Boolean(candidate.validation_certificate) &&
          dependencyNodes.has(queueItemNodeID(candidate)),
      )
      .map((candidate) => ({
        admit_id: candidate.admit_id,
        order: candidate.order,
        kind: candidate.kind,
        target_name: candidate.target_name,
        certificate_id: validationCertificateID(candidate.validation_certificate!),
        certificate: candidate.validation_certificate,
      }))
    const forbiddenRoutes = ProofRouteLedger.getActiveRouteFailures({
      workspace: Instance.worktree === "/" ? Instance.directory : Instance.worktree,
      file,
      theorem: input.assignment.theorem,
      source: input.source,
    })
      .filter((failure) => failure.confidence === "verified")
      .slice(0, 5)
      .map((failure) => ({
        failure_id: failure.id,
        kind: failure.kind,
        failed_lemma: failure.failed_lemma,
        failed_instantiation_fingerprint: failure.failed_instantiation_fingerprint,
        missing_premises: failure.missing_premises,
        missing_premise_fingerprints: failure.missing_premise_fingerprints,
        recommended_action: failure.recommended_action,
      }))
    const expectedGoal =
      input.assignment.attempt_report?.stable_blocker_goal ??
      (block?.targetStatement ? goalFromStatement(block.targetStatement) : undefined) ??
      input.assignment.remodel_request?.current_target

    return {
      version: 1,
      source: {
        file,
        theorem: input.assignment.theorem,
        source_hash: sourceHash(input.source),
      },
      target: {
        admit_id: input.assignment.admit_id,
        escalation_type: input.assignment.escalation_type,
        escalation_reason: input.assignment.reason,
        expected_goal: expectedGoal,
        expected_goal_fingerprint: expectedGoal ? semanticGoalFingerprint(expectedGoal) : undefined,
      },
      staged_region: block
        ? {
            start_line: block.startLine,
            end_line: block.endLine,
            region_fingerprint: block.regionFingerprint,
            target_statement: block.targetStatement,
            text: block.blockText,
          }
        : undefined,
      certified_dependencies: certifiedDependencies,
      forbidden_routes: forbiddenRoutes,
      compiler_diagnostic: item?.validation_failure,
      generic_route_recipe: {
        mandatory: false,
        purpose: "Use as a shape-level planning prior, not as a theorem-specific script.",
        layers: [
          "prepare only definitions and local context needed by later facts",
          "establish one pointwise or semantic bridge",
          "normalize data, collection, or library-facing proof shape",
          "aggregate or combine the established facts",
          "close the final arithmetic or logical composition",
        ],
        adaptation:
          "Keep a meaningful layer together when it can be certified locally; split only after concrete cross-layer or repeated-failure evidence, and freely choose a different route when the live goal requires it.",
      },
    }
  }

  function repairPrompt(assignment: ProofRepairAssignment, guard?: FallbackGuard) {
    return [
      "Repair the theorem-level blocker created by a structural lemma escalation.",
      `Target file: ${assignment.file}`,
      `Theorem: ${assignment.theorem}`,
      `Escalated admit_id: ${assignment.admit_id}`,
      `Escalation type: ${assignment.escalation_type}`,
      `Escalation reason: ${assignment.reason}`,
      assignment.region_start_line && assignment.region_end_line
        ? `Original region lines: ${assignment.region_start_line}-${assignment.region_end_line}`
        : undefined,
      assignment.region_fingerprint ? `Original region_fingerprint: ${assignment.region_fingerprint}` : undefined,
      assignment.remodel_request ? `Remodel request: ${JSON.stringify(assignment.remodel_request)}` : undefined,
      assignment.attempt_report ? `Attempt report: ${JSON.stringify(assignment.attempt_report)}` : undefined,
      guard?.reason ? `Fallback guard reason: ${guard.reason}` : undefined,
      "If the live workflow explicitly exposes its single accepted-plan repair revision, call `proof_plan` once before editing and replace only the structurally invalid DAG portion. Otherwise, your next non-validation action must be a theorem-level edit that repairs this blocker by changing the stale proof_region contract, adding the missing theorem-level bridge from existing context, or remodeling the outer spine exactly as the escalation evidence requires.",
      "Do not prove inside unchanged lemma-owned proof_region text, do not redispatch the same stale admit_id, and do not run another broad read/search batch before the repair edit.",
      "Do not rename or version admit_id merely to obtain a new region_fingerprint; marker, comment, whitespace, and identifier-only edits are not repair progress.",
      "Classify the result explicitly as one of: assigned obligation solved; accepted theorem-level proof progress; substantive remodel pending fresh validation; or structured escalation.",
      "Compiler-error disappearance or syntax recovery is only an intermediate milestone. It never completes this semantic repair by itself.",
      "If the assigned admit_id disappears, treat that as remodeling until fresh scaffold and proof-progress validation demonstrate semantic progress.",
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n")
  }

  function scheduledRepair(assignment: ProofRepairAssignment, guard?: FallbackGuard): ScheduledSubtask {
    return {
      caller: "prover",
      agent: "prover",
      description: `Repair ${assignment.admit_id}`,
      prompt: repairPrompt(assignment, guard),
      proof_repair_assignment: assignment,
    }
  }

  function receiptRecordedAfterRepair(state: State, repair: ProofRepairAssignment) {
    const receipt = state.last_progress_receipt
    return Boolean(
      receipt &&
        receipt.theorem === repair.theorem &&
        repair.accepted_progress_baseline_at !== undefined &&
        receipt.recorded_at > repair.accepted_progress_baseline_at,
    )
  }

  function matchingCrossSessionRepair(
    sessionID: string,
    assignment: ProofRepairAssignment,
    source: string,
  ) {
    const currentSourceFingerprint = repairSourceFingerprint(source, assignment.theorem)
    return statesForFile(assignment.file).find(({ sessionID: otherSessionID, state }) => {
      if (otherSessionID === sessionID) return false
      const existing = state.active_repair
      if (!existing || receiptRecordedAfterRepair(state, existing)) return false
      return (
        normalizedWorkflowFile(existing.file) === normalizedWorkflowFile(assignment.file) &&
        existing.theorem === assignment.theorem &&
        existing.admit_id === assignment.admit_id &&
        existing.escalation_type === assignment.escalation_type &&
        normalizedRepairReason(existing.reason) === normalizedRepairReason(assignment.reason) &&
        existing.source_fingerprint === currentSourceFingerprint &&
        assignment.source_fingerprint === currentSourceFingerprint &&
        existing.theorem_fingerprint === theoremFingerprint(source, assignment.theorem) &&
        assignment.theorem_fingerprint === theoremFingerprint(source, assignment.theorem)
      )
    })
  }

  function scheduleRepairOrLock(input: {
    sessionID: string
    state: State
    item: QueueItem
    assignment: ProofRepairAssignment
    source: string
  }) {
    const existing = matchingCrossSessionRepair(input.sessionID, input.assignment, input.source)
    if (!existing) {
      markRepairing(input.sessionID, input.state, input.item, input.assignment)
      return scheduledRepair(input.assignment)
    }

    const now = Date.now()
    const reason =
      `cross-session repair dispatch lock: unchanged blocker ${input.assignment.admit_id} in theorem ${input.assignment.theorem} ` +
      `already has the same repair assignment in session ${existing.sessionID}; do not launch another identical repair child. ` +
      "Make a substantive theorem proof/contract change or obtain compiler-backed accepted progress before redispatching."
    const guard: FallbackGuard = {
      blocker_admit_id: input.assignment.admit_id,
      theorem_fingerprint: theoremFingerprint(input.source, input.assignment.theorem),
      source_fingerprint: input.assignment.source_fingerprint,
      region_fingerprint: input.assignment.region_fingerprint,
      dispatch_lock_scope: "cross_session",
      passive_lookup_streak: 0,
      tripped_at: now,
      reason,
    }
    set(input.sessionID, {
      ...input.state,
      phase: "prover",
      active_admit_id: undefined,
      active_task_id: undefined,
      active_repair: input.assignment,
      fallback_guard: guard,
      updated: now,
    })
    return undefined
  }

  export function bindActiveRepair(sessionID: string, assignment: ProofRepairAssignment) {
    activeRepairWorkerAssignments.set(sessionID, assignment)
    const previous = get(sessionID)
    return set(sessionID, {
      file: assignment.file,
      phase: "prover",
      queue: previous?.queue ?? [],
      active_admit_id: previous?.active_admit_id,
      active_task_id: previous?.active_task_id,
      latest_escalation: previous?.latest_escalation,
      active_repair: assignment,
      fallback_guard: undefined,
      updated: Date.now(),
    })
  }

  export function bindProofTaskWorker(sessionID: string, agent: string) {
    proofTaskWorkerSessions.set(sessionID, agent)
  }

  export async function assertProofTaskDispatchAllowed(input: {
    sessionID: string
    subagentType: string
    proofProducing: boolean
    lemmaAssignment?: LemmaAssignment
    proofRepairAssignment?: ProofRepairAssignment
  }) {
    if (!input.proofProducing) {
      return {
        active: false,
        decision: "allowed_non_proof_task",
        reason: `${input.subagentType} is not classified as proof-producing`,
        source_changed: false,
      }
    }

    const repairWorkerAssignment = activeRepairWorkerAssignments.get(input.sessionID)
    if (repairWorkerAssignment) {
      throw new Error(
        `proof_task_dispatch_blocked: theorem repair worker for ${repairWorkerAssignment.theorem}:${repairWorkerAssignment.admit_id} cannot launch a nested proof-producing task; return the repair result to the parent prover for validation and routing`,
      )
    }

    const proofTaskWorker = proofTaskWorkerSessions.get(input.sessionID)
    if (proofTaskWorker) {
      const localLemmaDispatch = input.subagentType === "lemma" && Boolean(input.lemmaAssignment)
      const localFixerDispatch = input.subagentType === "fixer" && proofTaskWorker !== "fixer"
      if (!localLemmaDispatch && !localFixerDispatch) {
        throw new Error(
          `proof_task_dispatch_blocked: ${proofTaskWorker} task worker cannot launch unscoped nested proof task ${input.subagentType}; delegate only a locality-validated lemma_assignment or one narrow fixer task, and return wide theorem proving to the parent orchestrator`,
        )
      }
    }

    const binding = SessionProof.get(input.sessionID)
    const previous = get(input.sessionID)
    const file = binding?.file ?? previous?.file
    if (!file || !file.endsWith(".v") || !(await Filesystem.exists(file))) {
      return {
        active: false,
        decision: "allowed_without_bound_proof_workflow",
        reason: "no live Rocq proof workflow is bound to this task session",
        source_changed: false,
      }
    }

    const normalizedFile = normalizedWorkflowFile(file)
    const source = await ProofEditTransaction.readSource(input.sessionID, normalizedFile)
    const refreshed = refresh(input.sessionID, normalizedFile, source)
    const state = refreshed.state
    if (input.lemmaAssignment) {
      const assignmentFile = normalizedWorkflowFile(input.lemmaAssignment.file)
      if (assignmentFile !== normalizedFile) {
        throw new Error(
          `proof_task_dispatch_blocked: lemma assignment file ${assignmentFile} does not match bound proof file ${normalizedFile}`,
        )
      }
      const item = state.queue.find(
        (entry) =>
          entry.theorem === input.lemmaAssignment?.theorem &&
          entry.admit_id === input.lemmaAssignment?.admit_id,
      )
      const block = refreshed.parsed.get(input.lemmaAssignment.admit_id)
      if (!item || !block || block.theorem !== input.lemmaAssignment.theorem) {
        throw new Error(
          `proof_task_dispatch_blocked: lemma assignment ${input.lemmaAssignment.theorem}:${input.lemmaAssignment.admit_id} is not a live proof_region in the bound theorem`,
        )
      }
      const dispatch = decompositionDispatchCheck(state, [...refreshed.parsed.values()], block, source)
      if (!dispatch.ok) {
        throw new Error(`proof_task_dispatch_blocked: ${dispatch.reason}`)
      }
    }
    const repair = state.active_repair
    if (!repair) {
      return {
        active: false,
        decision: "allowed_without_active_repair",
        reason: "no theorem repair transaction is active",
        source_changed: false,
      }
    }

    const currentSourceFingerprint = repairSourceFingerprint(source, repair.theorem)
    const sourceChanged = Boolean(
      repair.source_fingerprint && repair.source_fingerprint !== currentSourceFingerprint,
    )
    const item = state.queue.find((entry) => entry.admit_id === repair.admit_id)
    if (!item || sourceChanged) {
      const reason = !item
        ? `released stale active repair ${repair.admit_id} because that admit_id is not present in the current theorem revision`
        : `released stale active repair ${repair.admit_id} because the theorem source revision changed`
      set(input.sessionID, {
        ...state,
        active_repair: undefined,
        fallback_guard: undefined,
        updated: Date.now(),
      })
      return {
        active: false,
        decision: "released_stale_repair_revision",
        reason,
        admit_id: repair.admit_id,
        source_changed: sourceChanged,
      }
    }
    const progressReceipt = state.last_progress_receipt
    const receiptAfterBaseline = Boolean(
      progressReceipt &&
        progressReceipt.theorem === repair.theorem &&
        repair.accepted_progress_baseline_at !== undefined &&
        progressReceipt.recorded_at > repair.accepted_progress_baseline_at,
    )
    if (item?.status === "solved" || receiptAfterBaseline) {
      const reason = item?.status === "solved"
        ? `proof_region ${repair.admit_id} is compiler-certified`
        : `proof progress receipt ${progressReceipt?.kind} was recorded for theorem ${repair.theorem}`
      set(input.sessionID, {
        ...state,
        active_repair: undefined,
        fallback_guard: undefined,
        updated: Date.now(),
      })
      return {
        active: false,
        decision: "released_after_progress_receipt",
        reason,
        admit_id: repair.admit_id,
        source_changed: sourceChanged,
      }
    }

    const explicitTheorem = input.proofRepairAssignment?.theorem ?? input.lemmaAssignment?.theorem
    const explicitFile = input.proofRepairAssignment?.file ?? input.lemmaAssignment?.file
    const explicitDifferentScope = Boolean(
      explicitTheorem &&
        explicitFile &&
        (explicitTheorem !== repair.theorem ||
          normalizedWorkflowFile(explicitFile) !== normalizedWorkflowFile(repair.file)),
    )
    if (explicitDifferentScope) {
      return {
        active: true,
        decision: "allowed_explicit_different_proof_scope",
        reason: `explicit assignment targets ${normalizedWorkflowFile(explicitFile!)}:${explicitTheorem}, not active repair scope ${normalizedWorkflowFile(repair.file)}:${repair.theorem}`,
        admit_id: repair.admit_id,
        source_changed: false,
      }
    }

    const matchingRepair = Boolean(
      input.proofRepairAssignment && proofRepairAssignmentMatches(input.proofRepairAssignment, repair),
    )
    const fallbackTripped = Boolean(
      state.fallback_guard?.blocker_admit_id === repair.admit_id && state.fallback_guard.tripped_at,
    )
    if (matchingRepair && !fallbackTripped) {
      return {
        active: true,
        decision: "allowed_matching_repair",
        reason: `task carries the exact active repair assignment for ${repair.admit_id}`,
        admit_id: repair.admit_id,
        source_changed: false,
      }
    }

    if (fallbackTripped) {
      throw new Error(
        `proof_task_dispatch_blocked: fallback guard already tripped for unchanged repair blocker ${repair.admit_id} in theorem ${repair.theorem}; make a substantive theorem proof or contract change before redispatching another proof-producing task`,
      )
    }

    const markerOnlyDrift = !item && repair.source_fingerprint === currentSourceFingerprint
    throw new Error(
      `proof_task_dispatch_blocked: active repair blocker ${repair.admit_id} in theorem ${repair.theorem} is unchanged${
        markerOnlyDrift ? " apart from administrative marker/comment text" : ""
      }; ${input.subagentType} must carry the exact matching proof_repair_assignment, target an explicitly different theorem, or wait for substantive proof/contract progress`,
    )
  }

  export async function assessFallbackGuard(
    sessionID: string,
    messages: MessageV2.WithParts[],
    sourceOverride?: string,
  ) {
    const repairWorkerAssignment = activeRepairWorkerAssignments.get(sessionID)
    if (repairWorkerAssignment) {
      const binding = SessionProof.get(sessionID)
      if (!binding || !binding.file.endsWith(".v")) return undefined
      if (!(await Filesystem.exists(binding.file))) return undefined

      const source = await ProofEditTransaction.readSource(sessionID, binding.file)
      const currentSourceFingerprint = repairSourceFingerprint(source, repairWorkerAssignment.theorem)
      const lastAcceptedProgressAt = latestAcceptedProgressAt(messages, binding.file)
      const previous = get(sessionID)
      // A compiler-backed receipt starts a fresh liveness epoch. Do not count
      // investigation from the successful epoch against the next blocker,
      // but also do not disable the repair guard for the rest of the session.
      const actionCount = repairChildNonMaterializingActionCount(messages, lastAcceptedProgressAt)
      const compilerStreak = repairChildCompilerSignatureStreak(messages, binding.file, lastAcceptedProgressAt)
      const warningReached =
        actionCount >= REPAIR_CHILD_MATERIALIZATION_WARNING_LIMIT ||
        compilerStreak.count >= REPAIR_CHILD_COMPILER_SIGNATURE_WARNING_LIMIT
      if (!warningReached) {
        if (previous?.fallback_guard) {
          set(sessionID, {
            ...previous,
            fallback_guard: undefined,
            updated: Date.now(),
          })
        }
        return undefined
      }

      const tripped =
        actionCount >= REPAIR_CHILD_MATERIALIZATION_STOP_LIMIT ||
        compilerStreak.count >= REPAIR_CHILD_COMPILER_SIGNATURE_STOP_LIMIT
      const compilerDetail = compilerStreak.signature
        ? `; repeated_compiler_signature=${compilerStreak.signature}; signature_streak=${compilerStreak.count}`
        : ""
      const reason = tripped
        ? `theorem-repair child reached the semantic liveness cutoff after ${actionCount} tool actions without a new compiler-backed proof progress receipt${compilerDetail}`
        : `theorem-repair child has performed ${actionCount} tool actions without a new compiler-backed proof progress receipt${compilerDetail}; preserve exploration freedom, but do not submit the same compiler state a third time and target a new certificate, discharged premise/debt, or final Qed`
      const guard: FallbackGuard = {
        blocker_admit_id: repairWorkerAssignment.admit_id,
        theorem_fingerprint: theoremFingerprint(source, repairWorkerAssignment.theorem),
        source_fingerprint: currentSourceFingerprint,
        region_fingerprint: repairWorkerAssignment.region_fingerprint,
        passive_lookup_streak: actionCount,
        last_target_edit_at: latestTargetEditAt(messages, binding.file),
        last_accepted_progress_at: lastAcceptedProgressAt,
        tripped_at: tripped ? Date.now() : undefined,
        reason,
      }
      if (previous) {
        set(sessionID, {
          ...previous,
          fallback_guard: guard,
          updated: Date.now(),
        })
      }
      return {
        tripped,
        guard,
        assignment: repairWorkerAssignment,
        task: undefined,
        message: reason,
        repairChildWarning: !tripped,
        repairChildNoMaterialization: tripped,
      }
    }

    const binding = SessionProof.get(sessionID)
    if (!binding || !binding.file.endsWith(".v")) return undefined
    if (!(await Filesystem.exists(binding.file))) return undefined
    if (ProofEditTransaction.requiresValidation(sessionID, binding.file)) return undefined

    const source = sourceOverride ?? await ProofEditTransaction.readSource(sessionID, binding.file)
    const { state } = refresh(sessionID, binding.file, source)
    const activeRepair = state.active_repair
    const first = firstReadyUnresolved(state.queue)
    const firstRepair =
      first?.status === "escalated" ? repairAssignment(binding.file, first, source, sessionID) : undefined
    const assignment = activeRepair ?? firstRepair
    if (!assignment) return undefined

    const item = state.queue.find((entry) => entry.admit_id === assignment.admit_id)
    const currentTheoremFingerprint = theoremFingerprint(source, assignment.theorem)
    const currentTheoremStructureFingerprint = theoremStructureFingerprint(source, assignment.theorem)
    const currentSourceFingerprint = repairSourceFingerprint(source, assignment.theorem)
    const currentRegionFingerprint = item?.region_fingerprint
    const passiveLookupStreak = fallbackPassiveLookupStreak(messages, binding.file)
    const lastTargetEditAt = latestTargetEditAt(messages, binding.file)
    const lastAcceptedProgressAt = latestAcceptedProgressAt(messages, binding.file)
    const acceptedAfterBaseline = Boolean(
      lastAcceptedProgressAt &&
        assignment.accepted_progress_baseline_at !== undefined &&
        lastAcceptedProgressAt > assignment.accepted_progress_baseline_at,
    )
    const previousGuard = state.fallback_guard
    if (previousGuard?.tripped_at && previousGuard.reason) {
      const lockSourceChanged = Boolean(
        previousGuard.dispatch_lock_scope &&
          previousGuard.source_fingerprint &&
          previousGuard.source_fingerprint !== currentSourceFingerprint,
      )
      if (lockSourceChanged) {
        const releasedGuard: FallbackGuard = {
          blocker_admit_id: assignment.admit_id,
          theorem_fingerprint: currentTheoremFingerprint,
          source_fingerprint: currentSourceFingerprint,
          region_fingerprint: currentRegionFingerprint,
          passive_lookup_streak: 0,
          last_target_edit_at: lastTargetEditAt,
          last_accepted_progress_at: lastAcceptedProgressAt,
          reason: `released ${previousGuard.dispatch_lock_scope} after a substantive theorem source change`,
        }
        set(sessionID, {
          ...state,
          fallback_guard: undefined,
          updated: Date.now(),
        })
        return {
          tripped: false,
          guard: releasedGuard,
          assignment,
          task: undefined,
          message: releasedGuard.reason,
        }
      }
      if (acceptedAfterBaseline) {
        const releasedGuard: FallbackGuard = {
          blocker_admit_id: assignment.admit_id,
          theorem_fingerprint: currentTheoremFingerprint,
          source_fingerprint: currentSourceFingerprint,
          region_fingerprint: currentRegionFingerprint,
          passive_lookup_streak: 0,
          last_target_edit_at: lastTargetEditAt,
          last_accepted_progress_at: lastAcceptedProgressAt,
          reason: `released stale fallback guard after a compiler-backed proof progress receipt in theorem ${assignment.theorem}`,
        }
        set(sessionID, {
          ...state,
          active_repair: undefined,
          fallback_guard: undefined,
          updated: Date.now(),
        })
        return {
          tripped: false,
          guard: releasedGuard,
          assignment,
          task: undefined,
          message: releasedGuard.reason,
        }
      }
      return {
        tripped: true,
        guard: previousGuard,
        assignment,
        task: undefined,
        message: previousGuard.reason,
        parentRepairTakeoverRequired: Boolean(previousGuard.dispatch_lock_scope),
      }
    }
    const sameAsPrevious = Boolean(
      previousGuard?.blocker_admit_id === assignment.admit_id &&
        (previousGuard.source_fingerprint
          ? previousGuard.source_fingerprint === currentSourceFingerprint
          : previousGuard.theorem_fingerprint === currentTheoremFingerprint &&
            previousGuard.region_fingerprint === currentRegionFingerprint),
    )
    const latestRepair = findLatestRepairTaskForAdmit(messages, assignment.admit_id)
    const repairFinished = Boolean(
      activeRepair && latestRepair && (latestRepair.status === "completed" || latestRepair.status === "error"),
    )
    const unassessedRepair = Boolean(
      repairFinished && latestRepair?.time && latestRepair.time !== activeRepair?.last_assessed_task_at,
    )
    if (activeRepair && unassessedRepair && latestRepair?.time) {
      const childNoMaterialization = Boolean(
        latestRepair.output?.includes("repair_child_no_materialization:"),
      )
      if (childNoMaterialization) {
        const compilerSignature = repairChildOutcomeCompilerSignature(latestRepair.output)
        const tracked = item
          ? registerRepairIncident(
              sessionID,
              state,
              item,
              activeRepair.escalation_type,
              repairChildNoMaterializationIncidentReason(activeRepair, compilerSignature),
              source,
            )
          : { repeated: false, state, incident: undefined }
        const identicalFailureCount = tracked.incident
          ? tracked.incident.repeat_count + 1
          : (activeRepair.continuation_count ?? 0) + 1
        const retryLimitReached =
          identicalFailureCount >= IDENTICAL_REPAIR_CHILD_NO_MATERIALIZATION_LIMIT
        const reason = retryLimitReached
          ? `repair_outcome=child_no_materialization; identical_repair_failures=${identicalFailureCount}/${IDENTICAL_REPAIR_CHILD_NO_MATERIALIZATION_LIMIT}; compiler_signature=${compilerSignature ?? "unavailable"}; the same semantic repair route exhausted five fresh children without a theorem edit, proof_plan revision, accepted checkpoint, or compiler certificate; the sixth identical dispatch is blocked and the parent must remodel, change route, or produce accepted proof progress`
          : `repair_outcome=child_no_materialization; identical_repair_failures=${identicalFailureCount}/${IDENTICAL_REPAIR_CHILD_NO_MATERIALIZATION_LIMIT}; compiler_signature=${compilerSignature ?? "unavailable"}; this child produced no theorem edit, proof_plan revision, accepted checkpoint, or compiler certificate; another fresh repair child remains permitted, but repeated attempts are cumulative for this unchanged semantic blocker and compiler state`
        const nextAssignment: ProofRepairAssignment = {
          ...activeRepair,
          theorem_fingerprint: currentTheoremFingerprint,
          theorem_structure_fingerprint: currentTheoremStructureFingerprint,
          source_fingerprint: currentSourceFingerprint,
          region_fingerprint: currentRegionFingerprint ?? activeRepair.region_fingerprint,
          continuation_count: identicalFailureCount,
          last_assessed_task_at: latestRepair.time,
          last_outcome: "structured_escalation",
        }
        const guard: FallbackGuard = {
          blocker_admit_id: assignment.admit_id,
          theorem_fingerprint: currentTheoremFingerprint,
          source_fingerprint: currentSourceFingerprint,
          region_fingerprint: currentRegionFingerprint,
          passive_lookup_streak: 0,
          last_target_edit_at: lastTargetEditAt,
          last_accepted_progress_at: lastAcceptedProgressAt,
          dispatch_lock_scope: retryLimitReached ? "repair_child_yield" : undefined,
          tripped_at: retryLimitReached ? Date.now() : undefined,
          reason,
        }
        set(sessionID, {
          ...tracked.state,
          active_repair: nextAssignment,
          fallback_guard: guard,
          updated: Date.now(),
        })
        return {
          tripped: retryLimitReached,
          guard,
          assignment: nextAssignment,
          task: undefined,
          message: reason,
          repairRedispatchWarning: !retryLimitReached,
          parentRepairTakeoverRequired: retryLimitReached,
        }
      }
      const proofStatus = latestProofStatus(messages, binding.file)
      const acceptedProgress = Boolean(
        proofStatus?.accepted &&
          activeRepair.accepted_progress_baseline_at !== undefined &&
          proofStatus.time > activeRepair.accepted_progress_baseline_at,
      )
      const assignedSolved = Boolean(item?.status === "solved")
      const substantiveRemodel = Boolean(
        activeRepair.theorem_structure_fingerprint &&
          activeRepair.theorem_structure_fingerprint !== currentTheoremStructureFingerprint,
      )
      const unfinishedBefore = activeRepair.unfinished_baseline
      const unfinishedAfter =
        proofStatus?.unfinishedCount ??
        proofProgressMetrics(sessionID, binding.file, source, assignment.theorem).unfinished_count

      if (assignedSolved || acceptedProgress) {
        const outcome = assignedSolved ? "assigned_obligation_solved" : "accepted_theorem_progress"
        const reason = `repair_outcome=${outcome}; unresolved_before=${activeRepair.original_unresolved !== false}; unresolved_after=${!assignedSolved}; unfinished_before=${unfinishedBefore ?? "unknown"}; unfinished_after=${unfinishedAfter}; accepted_progress=${acceptedProgress}`
        const acceptedGuard: FallbackGuard = {
          blocker_admit_id: assignment.admit_id,
          theorem_fingerprint: currentTheoremFingerprint,
          source_fingerprint: currentSourceFingerprint,
          region_fingerprint: currentRegionFingerprint,
          passive_lookup_streak: 0,
          last_target_edit_at: lastTargetEditAt,
          last_accepted_progress_at: lastAcceptedProgressAt,
          reason,
        }
        set(sessionID, {
          ...state,
          active_repair: undefined,
          fallback_guard: undefined,
          updated: Date.now(),
        })
        return {
          tripped: false,
          guard: acceptedGuard,
          assignment: { ...activeRepair, last_outcome: outcome },
          task: undefined,
          message: reason,
        }
      }

      const scaffold = substantiveRemodel ? await Validation.scaffold(binding.file, source) : undefined
      const classifiedOutcome = "structured_escalation"
      const reason = `repair_outcome=${classifiedOutcome}; unresolved_before=${activeRepair.original_unresolved !== false}; unresolved_after=true; unfinished_before=${unfinishedBefore ?? "unknown"}; unfinished_after=${unfinishedAfter}; accepted_progress=false; substantive_remodel=${substantiveRemodel}; scaffold_ok=${scaffold?.ok ?? false}; source or plan changes without a progress receipt do not reset repair state`
      const nextAssignment: ProofRepairAssignment = {
        ...activeRepair,
        last_assessed_task_at: latestRepair.time,
        last_outcome: classifiedOutcome,
      }
      const guard: FallbackGuard = {
        blocker_admit_id: assignment.admit_id,
        theorem_fingerprint: currentTheoremFingerprint,
        source_fingerprint: currentSourceFingerprint,
        region_fingerprint: currentRegionFingerprint,
        passive_lookup_streak: 0,
        last_target_edit_at: lastTargetEditAt,
        last_accepted_progress_at: lastAcceptedProgressAt,
        tripped_at: Date.now(),
        reason,
      }
      set(sessionID, {
        ...state,
        active_repair: nextAssignment,
        fallback_guard: guard,
        updated: Date.now(),
      })
      return {
        tripped: true,
        guard,
        assignment: nextAssignment,
        task: undefined,
        message: reason,
      }
    }
    const lookupStalled = Boolean(
      sameAsPrevious && passiveLookupStreak >= FALLBACK_LOOKUP_STREAK_LIMIT && !acceptedAfterBaseline,
    )
    const tripped = lookupStalled
    const reason = lookupStalled
      ? `same blocker ${assignment.admit_id} and unchanged theorem fingerprint after ${passiveLookupStreak} passive lookup calls without target edit or accepted proof progress`
      : undefined
    const guard: FallbackGuard = {
      blocker_admit_id: assignment.admit_id,
      theorem_fingerprint: currentTheoremFingerprint,
      source_fingerprint: currentSourceFingerprint,
      region_fingerprint: currentRegionFingerprint,
      passive_lookup_streak: passiveLookupStreak,
      last_target_edit_at: lastTargetEditAt,
      last_accepted_progress_at: lastAcceptedProgressAt,
      tripped_at: tripped ? Date.now() : previousGuard?.tripped_at,
      reason: reason ?? previousGuard?.reason,
    }

    set(sessionID, {
      ...state,
      fallback_guard: guard,
      active_repair: activeRepair ?? firstRepair,
      updated: Date.now(),
    })

    return {
      tripped,
      guard,
      assignment,
      task: scheduledRepair(assignment, guard),
      message: reason,
    }
  }

  function pendingDelegationItems(queue: QueueItem[]) {
    return readyUnresolved(queue).filter((item) => item.status === "pending" || item.status === "split")
  }

  function freshLemmaPrompt(item: QueueItem) {
    return [
      "You are being scheduled mechanically for a first-level proof_region that is already frozen in the theorem file.",
      "The goal is to complete the target theorem proof and make the file compile; this assignment, its declared dependency order, and its validation gates exist only to advance that proof.",
      `Own only admit_id ${item.admit_id} in theorem ${item.theorem}.`,
      `Obligation kind: ${item.kind}.`,
      item.target_name ? `Exported target: ${item.target_name}.` : undefined,
      "This proof_region is ready because every declared proof-region dependency is compiler-certified. Work only in this assigned region; file order is a priority among ready nodes, not an undeclared semantic dependency.",
      "Inside this assigned proof_region, treat the first unresolved local admit or empty `{}` as the only writable proof hole. Do not write proof text for later local have/assert/suff blocks until this current hole validates.",
      "The proof_region must wrap the exported target statement and its complete `{ ... }` proof block, not just the proof body inside braces.",
      "Treat the exported target statement as the prover-authored subgoal contract: edit the proof block and same-region helpers, but keep the target name and proposition unchanged unless the assignment explicitly requires remodeling.",
      "You may add sibling helper pose/have/assert statements inside the proof_region before the exported target, but you must not edit text outside the region.",
      "Do not move the proof_region end marker to include parent composition such as exact/rewrite/apply of the exported target; those steps belong outside the region.",
      "Do not redesign the outer theorem spine.",
      "Return solved, split, or escalate according to the lemma runtime policy. If you split, keep all child obligations inside this same region and this same lemma session; do not launch child lemma subagents, and do not hand control back to prover unless you must escalate.",
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n")
  }

  function resumeLemmaPrompt(item: QueueItem) {
    return [
      "Continue the same mechanically scheduled lemma session for the current first-level proof_region.",
      "Keep the final objective in view: finish the target theorem proof and get the file compiling. Do not respond with read-only stalling or disconnected edits.",
      `Stay inside admit_id ${item.admit_id} in theorem ${item.theorem}.`,
      "Do not skip ahead to any later sibling proof_region; this admit_id remains the scheduling blocker until it is solved, remodeled by Layer 1, or escalated with evidence.",
      "Resume at the first unresolved local admit or empty `{}` inside this same proof_region; do not fill later local blocks until the current one validates.",
      "If you previously returned split, keep the decomposition inside this same region and this same lemma session, recurse in DFS/LIFO order, and only escalate if the region truly requires theorem-level intervention.",
      item.context_audit_feedback
        ? `Context-audit advisory retry: ${item.context_audit_feedback} This is one bounded corrective resume, not a permanent escalation ban; after one targeted inspection or concrete local bridge attempt, return the best structured result with evidence.`
        : undefined,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n")
  }

  function regionTextByAdmit(source: string, admitID: string) {
    return parseProofObligations(source).find((block) => block.admit_id === admitID)?.blockText
  }

  function regionRangeByAdmit(source: string, admitID: string) {
    const block = parseProofObligations(source).find((entry) => entry.admit_id === admitID)
    if (!block) return undefined
    return {
      start: block.regionStart ?? block.blockStart,
      end: block.regionEnd ?? block.endIndex + 1,
      startLine: block.startLine,
      endLine: block.endLine,
    }
  }

  function assignmentFilePath(assignment: LemmaAssignment) {
    return path.normalize(
      path.isAbsolute(assignment.file) ? assignment.file : path.resolve(Instance.directory, assignment.file),
    )
  }

  function assignmentFileMatches(inputFile: string, assignment: LemmaAssignment) {
    return path.normalize(inputFile) === assignmentFilePath(assignment)
  }

  function setValidatedLemmaSource(sessionID: string, file: string, source: string) {
    const normalized = path.normalize(file)
    const existing = validatedLemmaSources.get(sessionID) ?? new Map<string, string>()
    existing.set(normalized, source)
    validatedLemmaSources.set(sessionID, existing)
    lemmaResumesMissingBaseline.delete(sessionID)
  }

  function getValidatedLemmaSource(sessionID: string, file: string) {
    return validatedLemmaSources.get(sessionID)?.get(path.normalize(file))
  }

  export function recordLemmaValidationSuccess(input: {
    sessionID: string
    agent: string
    file: string
    source: string
  }) {
    if (input.agent !== "lemma") return
    const assignment = activeLemmaAssignments.get(input.sessionID)
    if (!assignment) return
    if (!assignmentFileMatches(input.file, assignment)) return
    setValidatedLemmaSource(input.sessionID, input.file, input.source)
  }

  export async function recordLemmaPrefixValidation(input: {
    sessionID: string
    agent: string
    file: string
    source: string
  }): Promise<ValidationResult | undefined> {
    if (input.agent !== "lemma") return undefined
    const assignment = activeLemmaAssignments.get(input.sessionID)
    if (!assignment) return undefined
    if (!assignmentFileMatches(input.file, assignment)) return undefined

    const validatedSource = getValidatedLemmaSource(input.sessionID, input.file)
    if (!validatedSource) {
      const recoveringResume = lemmaResumesMissingBaseline.has(input.sessionID)
      const recovered = await Validation.prefix(input.file, input.source)
      if (!recovered.ok) return recovered
      recoverLemmaBaseline(input.sessionID, input.file, input.source)
      return {
        ...recovered,
        message: recoveringResume
          ? "restored the missing resume validation baseline from a fresh successful prefix compilation"
          : recovered.message,
      }
    }

    const validatedRange = assignedEditableRange(assignment, validatedSource)
    const currentRange = assignedEditableRange(assignment, input.source)
    if (!validatedRange || !currentRange) {
      return {
        ok: false,
        validator: "checkpoint-coqc",
        status: "error",
        message: `lemma prefix checkpoint cannot find assigned proof_region ${assignment.admit_id}.`,
      }
    }

    const hole = firstSequentialHole(validatedRange.text)
    if (!hole) {
      setValidatedLemmaSource(input.sessionID, input.file, input.source)
      return { ok: true, validator: "checkpoint-coqc", status: "ok" }
    }

    const protectedSuffix = validatedRange.text.slice(hole.end)
    if (!currentRange.text.endsWith(protectedSuffix)) {
      return {
        ok: false,
        validator: "checkpoint-coqc",
        status: "error",
        message: `lemma prefix checkpoint refused admit_id ${assignment.admit_id}: text after the current first hole changed before that hole was validated.`,
      }
    }

    const suffixStart = currentRange.end - protectedSuffix.length
    const maskedSource = maskEmptyProofBlocksAfter(input.source, suffixStart, currentRange.end)
    const result = await Validation.prefix(input.file, maskedSource)
    if (!result.ok) return result

    const currentPrefix = currentRange.text.slice(0, suffixStart - currentRange.start)
    const prefixComplete = !hasPendingProofHole(currentPrefix)
    if (prefixComplete) {
      setValidatedLemmaSource(input.sessionID, input.file, input.source)
      return { ...result, prefix_complete: true }
    }

    return {
      ...result,
      prefix_complete: false,
      message:
        "current prefix compiles, but the current first proof hole still contains an admit or empty block; keep repairing this block before moving on",
    }
  }

  export function assertLemmaSequentialEditAllowed(input: {
    sessionID: string
    agent: string
    file: string
    before: string
    after: string
  }) {
    if (input.agent !== "lemma") return
    if (!input.file.endsWith(".v")) return
    if (input.before === input.after) return

    const assignment = activeLemmaAssignments.get(input.sessionID)
    if (!assignment) return
    if (!assignmentFileMatches(input.file, assignment)) return

    if (!getValidatedLemmaSource(input.sessionID, input.file)) {
      if (lemmaResumesMissingBaseline.has(input.sessionID)) {
        throw new Error(
          `lemma resume for admit_id ${assignment.admit_id} has no trusted validated prefix baseline; run checkpoint/coqc successfully before editing further.`,
        )
      }
      setValidatedLemmaSource(input.sessionID, input.file, input.before)
    }

    const beforeRange = assignedEditableRange(assignment, input.before)
    const afterRange = assignedEditableRange(assignment, input.after)
    if (!beforeRange || !afterRange) {
      throw new Error(
        `lemma agent cannot edit ${input.file}: assigned proof_region for admit_id ${assignment.admit_id} is missing or its markers were rewritten.`,
      )
    }

    if (
      input.before.slice(0, beforeRange.start) !== input.after.slice(0, afterRange.start) ||
      input.before.slice(beforeRange.end) !== input.after.slice(afterRange.end)
    ) {
      throw new Error(
        `lemma agent may edit only its assigned proof_region ${assignment.admit_id}; text outside that region must remain unchanged.`,
      )
    }

    const validatedSource = getValidatedLemmaSource(input.sessionID, input.file) ?? input.before
    const validatedRange = assignedEditableRange(assignment, validatedSource)
    const hole = firstSequentialHole(validatedRange?.text ?? beforeRange.text)
    if (!hole) return

    const protectedSuffix = (validatedRange?.text ?? beforeRange.text).slice(hole.end)
    if (!afterRange.text.endsWith(protectedSuffix)) {
      throw new Error(
        `lemma agent cannot edit text after the first unresolved local proof hole in admit_id ${assignment.admit_id}; solve and compile/validate the current ${hole.kind} before writing later have/assert/suff blocks.`,
      )
    }

    if (hole.kind === "empty proof block") {
      const editablePrefix =
        protectedSuffix.length > 0
          ? afterRange.text.slice(0, afterRange.text.length - protectedSuffix.length)
          : afterRange.text
      if (!editablePrefix.trimEnd().endsWith("}")) {
        throw new Error(
          `lemma agent must preserve the partition braces for the current proof block in admit_id ${assignment.admit_id}; fill inside the existing { ... } block instead of replacing it with a by-proof or deleting the braces.`,
        )
      }
    }

    const targetName = assignment.obligation?.target_name
    const expectedTargetStatement = assignment.obligation?.target_statement
    if (targetName) {
      const actualTargetStatement = findTargetStatement(afterRange.text, targetName)
      if (!actualTargetStatement) {
        throw new Error(
          `lemma agent must preserve exported target ${targetName} and its statement inside admit_id ${assignment.admit_id}; return needs_subgoal_remodel instead of deleting or renaming the assigned target.`,
        )
      }
      if (
        expectedTargetStatement &&
        normalizeTargetShape(goalFromStatement(actualTargetStatement)) !==
          normalizeTargetShape(goalFromStatement(expectedTargetStatement))
      ) {
        throw new Error(
          `lemma agent must preserve the proposition of exported target ${targetName} inside admit_id ${assignment.admit_id}; return needs_subgoal_remodel instead of changing the assigned target statement.`,
        )
      }
    }
  }

  function touchedRunningRegions(file: string, before: string, after: string) {
    const touched: Array<{ sessionID: string; state: State; item: QueueItem }> = []
    for (const { sessionID, state } of statesForFile(file)) {
      for (const item of state.queue) {
        if (item.status !== "running") continue
        const beforeText = regionTextByAdmit(before, item.admit_id)
        if (!beforeText) continue
        const afterText = regionTextByAdmit(after, item.admit_id)
        if (beforeText !== afterText) touched.push({ sessionID, state, item })
      }
    }
    return touched
  }

  function assertWideAgentSolvedPrefixEditAllowed(input: {
    sessionID: string
    agent: string
    file: string
    before: string
    after: string
  }) {
    if (!input.file.endsWith(".v")) return
    if (!WIDE_PROOF_EDIT_AGENTS.has(input.agent)) return
    if (input.before === input.after) return

    const { state } = refresh(input.sessionID, input.file, input.before)
    for (const solved of state.queue.filter((item) => item.status === "solved" && item.validation_certificate)) {
      const beforeText = regionTextByAdmit(input.before, solved.admit_id)
      if (!beforeText) continue
      const afterText = regionTextByAdmit(input.after, solved.admit_id)
      if (afterText === beforeText) continue
      const frozen = regionRangeByAdmit(input.before, solved.admit_id)
      throw new Error(
        `${input.agent} cannot edit compiler-certified proof_region ${solved.admit_id}` +
          `${frozen ? ` at lines ${frozen.startLine}-${frozen.endLine}` : ""}. ` +
          "Preserve certified regions while repairing another DAG-ready region; request an explicit structural remodel only when compiler evidence invalidates this certificate boundary.",
      )
    }
  }

  export function assertWideAgentRunningRegionEditAllowed(input: {
    sessionID: string
    agent: string
    file: string
    before: string
    after: string
    takeover?: boolean
    takeoverReason?: string
  }) {
    if (!input.file.endsWith(".v")) return []
    if (!WIDE_PROOF_EDIT_AGENTS.has(input.agent)) return []
    if (input.before === input.after) return []

    assertWideAgentSolvedPrefixEditAllowed(input)

    const touched = touchedRunningRegions(input.file, input.before, input.after)
    if (touched.length === 0) return []
    if (input.takeover && input.takeoverReason?.trim())
      return touched.map(({ sessionID, item }) => ({ sessionID, admit_id: item.admit_id }))

    const regions = touched.map(({ item }) => item.admit_id).join(", ")
    throw new Error(
      `${input.agent} cannot edit running lemma-owned proof_region(s) ${regions} in ${input.file}. ` +
        "Pass takeover_running_region=true with a non-empty takeover_reason to explicitly take ownership and record the running -> pending transition.",
    )
  }

  export function recordWideAgentRunningRegionTakeover(input: {
    agent: string
    file: string
    before: string
    after: string
    takeoverReason: string
  }) {
    if (!input.file.endsWith(".v")) return []
    if (!WIDE_PROOF_EDIT_AGENTS.has(input.agent)) return []

    const touched = touchedRunningRegions(input.file, input.before, input.after)
    const now = Date.now()
    const recorded: Array<{ sessionID: string; admit_id: string }> = []
    for (const { sessionID, state, item } of touched) {
      const queue = state.queue.map((entry) =>
        entry.admit_id === item.admit_id
          ? {
              ...entry,
              status: "pending" as const,
              task_id: undefined,
              running_started_at: undefined,
              running_lease_expires_at: undefined,
              running_release_reason: `taken over by ${input.agent}: ${input.takeoverReason}`,
              takeover_agent: input.agent,
              takeover_reason: input.takeoverReason,
              takeover_at: now,
            }
          : entry,
      )
      set(sessionID, {
        file: state.file,
        phase: computePhase(queue),
        queue,
        active_admit_id: state.active_admit_id === item.admit_id ? undefined : state.active_admit_id,
        active_task_id: state.active_admit_id === item.admit_id ? undefined : state.active_task_id,
        latest_escalation: state.latest_escalation,
        active_repair: state.active_repair,
        fallback_guard: state.fallback_guard,
        updated: now,
      })
      recorded.push({ sessionID, admit_id: item.admit_id })
    }
    return recorded
  }

  export async function planNextSubtask(
    sessionID: string,
    messages: MessageV2.WithParts[],
    sourceOverride?: string,
  ): Promise<ScheduledSubtask | undefined> {
    // Repair workers are leaves in the proof-task tree. Their parent prover
    // owns validation and any follow-up repair/lemma scheduling.
    if (activeRepairWorkerAssignments.has(sessionID)) return undefined

    const binding = SessionProof.get(sessionID)
    if (!binding || !binding.file.endsWith(".v")) return undefined
    if (!(await Filesystem.exists(binding.file))) return undefined
    if (ProofEditTransaction.requiresStagedRead(sessionID, binding.file)) return undefined

    const previous = get(sessionID)
    const source = sourceOverride ?? await ProofEditTransaction.readSource(sessionID, binding.file)
    const { state, parsed } = refresh(sessionID, binding.file, source)
    const previousActive = previous?.active_admit_id
      ? previous.queue.find((item) => item.admit_id === previous.active_admit_id)
      : undefined
    if (state.active_repair) {
      const repairItem = state.queue.find((item) => item.admit_id === state.active_repair?.admit_id)
      const receipt = state.last_progress_receipt
      const receiptAfterBaseline = Boolean(
        receipt &&
          receipt.theorem === state.active_repair.theorem &&
          state.active_repair.accepted_progress_baseline_at !== undefined &&
          receipt.recorded_at > state.active_repair.accepted_progress_baseline_at,
      )
      if (repairItem?.status === "solved" || receiptAfterBaseline) {
        set(sessionID, {
          ...state,
          active_repair: undefined,
          fallback_guard: undefined,
          updated: Date.now(),
        })
        return planNextSubtask(sessionID, messages, source)
      }
      if (state.fallback_guard?.dispatch_lock_scope) {
        const currentSourceFingerprint = repairSourceFingerprint(source, state.active_repair.theorem)
        const sourceChanged = Boolean(
          state.active_repair.source_fingerprint &&
            state.active_repair.source_fingerprint !== currentSourceFingerprint,
        )
        const regionChangedWithoutSourceBaseline = Boolean(
          !state.active_repair.source_fingerprint &&
            repairItem &&
            state.active_repair.region_fingerprint &&
            repairItem.region_fingerprint !== state.active_repair.region_fingerprint,
        )
        const blockerReasonChanged = Boolean(
          repairItem?.escalation_reason &&
            normalizedRepairReason(repairItem.escalation_reason) !==
              normalizedRepairReason(state.active_repair.reason),
        )
        if (sourceChanged || regionChangedWithoutSourceBaseline || blockerReasonChanged) {
          set(sessionID, {
            ...state,
            active_repair: undefined,
            fallback_guard: undefined,
            updated: Date.now(),
          })
          return planNextSubtask(sessionID, messages, source)
        }
        if (state.fallback_guard.dispatch_lock_scope === "repair_child_yield") return undefined
      }
      // Keep the repair ledger alive across source changes, but do not turn it
      // into a permanent scheduler lock.  A still-escalated live blocker owns
      // the theorem-level repair turn.  Once the region becomes pending,
      // running, split, or unvalidated (or is replaced by a remodel), normal
      // validation/routing must continue so it can earn a real progress
      // receipt.  This preserves retry accounting without deadlocking the
      // compiler-certificate path.
      if (repairItem?.status === "escalated") return undefined
    }
    if (state.queue.length === 0) {
      if (previousActive?.status === "running") {
        const outcome = findLatestLemmaOutcome(messages, previousActive.admit_id)
        if (outcome) {
          const routedOutcome = routeContextEscalation(previousActive, outcome)
          await persistOutcome(sessionID, state, previousActive, routedOutcome, source)
        }
      }
      return undefined
    }

    const active = state.active_admit_id
      ? state.queue.find((item) => item.admit_id === state.active_admit_id)
      : undefined
    const runningActive =
      active?.status === "running" ? active : previousActive?.status === "running" ? previousActive : undefined

    if (runningActive) {
      const outcome = findLatestLemmaOutcome(messages, runningActive.admit_id)
      const latestAttempt = findLatestLemmaTaskForAdmit(messages, runningActive.admit_id)
      if (!outcome) {
        if (!isRunningLeaseExpired(runningActive)) return undefined

        if (latestAttempt?.status === "completed" && !latestAttempt.hasStructuredOutcome) {
          releaseRunning(
            sessionID,
            state,
            runningActive,
            "lemma task completed without a structured proof_result before the running lease expired",
          )
          return planNextSubtask(sessionID, messages, source)
        }
        if (latestAttempt?.status === "error") {
          releaseRunning(
            sessionID,
            state,
            runningActive,
            `lemma task failed before the running lease expired: ${latestAttempt.error ?? "unknown error"}`,
          )
          return planNextSubtask(sessionID, messages, source)
        }
        const block = parsed.get(runningActive.admit_id)
        if (!block) {
          return escalateToRepair(
            sessionID,
            state,
            runningActive,
            binding.file,
            source,
            "not_local",
            `running lemma task for admit_id ${runningActive.admit_id} removed or rewrote its proof_region marker without returning a structured outcome`,
          )
        }
        if (runningActive.task_id) {
          const checked = checkedLemmaAssignment(
            state,
            [...parsed.values()],
            binding.file,
            runningActive,
            block,
            source,
          )
          if (!checked.ok) {
            return escalateToRepair(
              sessionID,
              state,
              runningActive,
              binding.file,
              source,
              "needs_subgoal_remodel",
              checked.reason,
            )
          }
          markRunning(sessionID, state, runningActive, runningActive.task_id)
          return {
            caller: "prover",
            agent: "lemma",
            description: `Resume ${runningActive.admit_id}`,
            prompt: resumeLemmaPrompt(runningActive),
            task_id: runningActive.task_id,
            lemma_assignment: checked.assignment,
          }
        }

        releaseRunning(
          sessionID,
          state,
          runningActive,
          "running lease expired without a resumable task_id or structured proof_result",
        )
        return planNextSubtask(sessionID, messages, source)
      }

      const routedOutcome = routeContextEscalation(runningActive, outcome)
      const nextState = await persistOutcome(sessionID, state, runningActive, routedOutcome, source)
      if (routedOutcome.status === "split" && routedOutcome.taskID) {
        const resumable = nextState.queue.find((item) => item.admit_id === runningActive.admit_id)
        if (!resumable || resumable.status !== "split") return undefined
        const block = parsed.get(resumable.admit_id)
        if (!block) return undefined
        const checked = checkedLemmaAssignment(
          nextState,
          [...parsed.values()],
          binding.file,
          resumable,
          block,
          source,
        )
        if (!checked.ok) {
          return escalateToRepair(
            sessionID,
            nextState,
            resumable,
            binding.file,
            source,
            "needs_subgoal_remodel",
            checked.reason,
          )
        }
        markRunning(sessionID, nextState, resumable, routedOutcome.taskID)
        return {
          caller: "prover",
          agent: "lemma",
          description: `Resume ${runningActive.admit_id}`,
          prompt: resumeLemmaPrompt(resumable),
          task_id: routedOutcome.taskID,
          model: routedOutcome.model,
          lemma_assignment: checked.assignment,
        }
      }

      const persisted = nextState.queue.find((item) => item.admit_id === runningActive.admit_id)
      if (persisted?.status === "escalated") {
        const assignment = repairAssignment(binding.file, persisted, source, sessionID)
        if (!assignment) return undefined
        return scheduleRepairOrLock({
          sessionID,
          state: nextState,
          item: persisted,
          assignment,
          source,
        })
      }
      if (routedOutcome.status === "escalate" || structuralEscalation(routedOutcome.escalationType)) return undefined
      return planNextSubtask(sessionID, messages, source)
    }

    if (active && active.status === "split" && active.task_id) {
      const block = parsed.get(active.admit_id)
      if (!block) return undefined
      const checked = checkedLemmaAssignment(
        state,
        [...parsed.values()],
        binding.file,
        active,
        block,
        source,
      )
      if (!checked.ok) {
        return escalateToRepair(sessionID, state, active, binding.file, source, "needs_subgoal_remodel", checked.reason)
      }
      markRunning(sessionID, state, active, active.task_id)
      return {
        caller: "prover",
        agent: "lemma",
        description: `Resume ${active.admit_id}`,
        prompt: resumeLemmaPrompt(active),
        task_id: active.task_id,
        lemma_assignment: checked.assignment,
      }
    }

    // A structural repair draft is useful evidence, but until the exact
    // revision earns a checkpoint/compiler receipt it is not the live theorem
    // contract. Process any completed running child above, then keep control
    // with the parent prover instead of dispatching ordinary lemma work against
    // an uncommitted draft.
    if (ProofEditTransaction.requiresValidation(sessionID, binding.file)) {
      if (state.active_repair && state.active_repair.last_outcome !== "remodel_pending_validation") {
        set(sessionID, {
          ...state,
          active_repair: { ...state.active_repair, last_outcome: "remodel_pending_validation" },
          updated: Date.now(),
        })
      }
      return undefined
    }

    const next = firstReadyUnresolved(state.queue)
    if (!next) {
      const theorem = state.queue[0]?.theorem
      const final = theorem ? finalTheoremGate(source, theorem) : { ok: false as const }
      set(sessionID, {
        ...state,
        phase: final.ok ? "complete" : "prover",
        active_admit_id: undefined,
        active_task_id: undefined,
        latest_escalation: state.latest_escalation,
        updated: Date.now(),
      })
      return undefined
    }

    if (next.status === "unvalidated") {
      const block = parsed.get(next.admit_id)
      if (!block) return undefined
      const previousFailure = validationFailureCurrent(next.validation_failure, source, block)
        ? next.validation_failure
        : undefined
      const scaffold: ValidationResult = previousFailure
        ? {
            ok: false,
            validator: "checkpoint-coqc",
            status: "error",
            message: previousFailure.message,
            first_error_file: previousFailure.first_error_file,
            first_error_line: previousFailure.first_error_line,
            failure_kind: previousFailure.first_error_line ? "compiler_error" : "process_error",
          }
        : await Validation.scaffold(binding.file, source)

      if (!previousFailure) {
        const lifecycle = await recordCompilerResult({
          sessionID,
          file: binding.file,
          source,
          validator: scaffold.validator,
          ok: scaffold.ok,
          first_error_file: scaffold.first_error_file,
          first_error_line: scaffold.first_error_line,
          first_error_message: scaffold.message,
        })
        if (lifecycle.action === "certified") {
          return planNextSubtask(sessionID, messages, source)
        }
        if (lifecycle.action === "source_changed") return undefined
      }

      if (scaffold.ok) return undefined
      const failure = validationEscalation(binding.file, next, scaffold)
      const currentState = get(sessionID) ?? state
      const currentItem = currentState.queue.find((item) => item.admit_id === next.admit_id) ?? next
      return escalateToRepair(
        sessionID,
        currentState,
        currentItem,
        binding.file,
        source,
        failure.escalation_type,
        failure.reason,
      )
    }

    if (next.status === "escalated") {
      const assignment = repairAssignment(binding.file, next, source, sessionID)
      if (!assignment) {
        set(sessionID, {
          ...state,
          phase: "prover",
          active_admit_id: undefined,
          active_task_id: undefined,
          latest_escalation: state.latest_escalation,
          updated: Date.now(),
        })
        return undefined
      }
      return scheduleRepairOrLock({
        sessionID,
        state,
        item: next,
        assignment,
        source,
      })
    }

    const leaseReleasedState =
      next.status === "running"
        ? releaseExpiredRunningIfNeeded(sessionID, state, next, "running lease expired before fresh lemma delegation")
        : state
    if (leaseReleasedState !== state) return planNextSubtask(sessionID, messages, source)

    if (next.status !== "pending") return undefined
    const block = parsed.get(next.admit_id)
    if (!block) return undefined
    if (!decompositionDispatchCheck(state, [...parsed.values()], block, source).ok) return undefined

    if (next.target_name && !block.targetStatement) {
      return escalateToRepair(
        sessionID,
        state,
        next,
        binding.file,
        source,
        "needs_subgoal_remodel",
        `proof_region ${next.admit_id} must wrap exported target statement ${next.target_name} together with its proof block; current markers do not include that target statement inside the region`,
      )
    }

    const checked = checkedLemmaAssignment(
      state,
      [...parsed.values()],
      binding.file,
      next,
      block,
      source,
    )
    if (!checked.ok) {
      return escalateToRepair(sessionID, state, next, binding.file, source, "needs_subgoal_remodel", checked.reason)
    }

    const scaffold = await Validation.scaffold(binding.file, source)
    if (!scaffold.ok && !expectedIncompleteQedScaffold(binding.file, source, scaffold)) {
      const failure = validationEscalation(binding.file, next, scaffold)
      return escalateToRepair(sessionID, state, next, binding.file, source, failure.escalation_type, failure.reason)
    }

    const blocker = await siblingDiagnosticBlocker(binding.file, next, source)
    if (blocker) {
      return escalateToRepair(sessionID, state, next, binding.file, source, "blocked_by_sibling_syntax", blocker)
    }

    markRunning(sessionID, state, next)
    return {
      caller: "prover",
      agent: "lemma",
      description: `Prove ${next.admit_id}`,
      prompt: freshLemmaPrompt(next),
      lemma_assignment: checked.assignment,
    }
  }

  export async function suggestNextSubtask(
    sessionID: string,
    messages: MessageV2.WithParts[],
    sourceOverride?: string,
  ): Promise<DelegationSuggestion | undefined> {
    if (activeRepairWorkerAssignments.has(sessionID)) return undefined

    const binding = SessionProof.get(sessionID)
    if (!binding || !binding.file.endsWith(".v")) return undefined
    if (!(await Filesystem.exists(binding.file))) return undefined
    if (ProofEditTransaction.requiresValidation(sessionID, binding.file)) return undefined

    const source = sourceOverride ?? await ProofEditTransaction.readSource(sessionID, binding.file)
    const { state, parsed } = refresh(sessionID, binding.file, source)
    if (state.queue.length === 0) return undefined
    if (state.active_repair) return undefined

    const pending = pendingDelegationItems(state.queue)
    if (pending.length === 0) return undefined

    const latest = findLatestLemmaTask(messages)
    if (latest?.status === "split" && latest.taskID) {
      // refresh() reconstructs queue status from the current source, so a
      // previously split region may appear pending here. Resume it only when
      // it is still the highest-priority dependency-ready region; a stale
      // split result for a later sibling must not jump ahead of pending[0].
      const item = pending[0]?.admit_id === latest.admitID ? pending[0] : undefined
      if (item) {
        const block = parsed.get(item.admit_id)
        if (!block) return undefined
        const checked = checkedLemmaAssignment(
          state,
          [...parsed.values()],
          binding.file,
          item,
          block,
          source,
        )
        if (!checked.ok) return undefined
        return {
          file: binding.file,
          phase: state.phase,
          pending,
          latest,
          latest_escalation: state.latest_escalation,
          task: {
            caller: "prover",
            agent: "lemma",
            description: `Resume ${item.admit_id}`,
            prompt: resumeLemmaPrompt(item),
            task_id: latest.taskID,
            model: latest.model,
            lemma_assignment: checked.assignment,
          },
        }
      }
    }

    const next = pending[0]
    const block = parsed.get(next.admit_id)
    if (!block) return undefined

    if (next.status === "split" && next.task_id) {
      const checked = checkedLemmaAssignment(
        state,
        [...parsed.values()],
        binding.file,
        next,
        block,
        source,
      )
      if (!checked.ok) return undefined
      return {
        file: binding.file,
        phase: state.phase,
        pending,
        latest,
        latest_escalation: state.latest_escalation,
        task: {
          caller: "prover",
          agent: "lemma",
          description: `Resume ${next.admit_id}`,
          prompt: resumeLemmaPrompt(next),
          task_id: next.task_id,
          lemma_assignment: checked.assignment,
        },
      }
    }

    if (next.status !== "pending") return undefined
    if (!decompositionDispatchCheck(state, [...parsed.values()], block, source).ok) return undefined
    const checked = checkedLemmaAssignment(
      state,
      [...parsed.values()],
      binding.file,
      next,
      block,
      source,
    )
    if (!checked.ok) return undefined

    return {
      file: binding.file,
      phase: state.phase,
      pending,
      latest,
      latest_escalation: state.latest_escalation,
      task: {
        caller: "prover",
        agent: "lemma",
        description: `Prove ${next.admit_id}`,
        prompt: freshLemmaPrompt(next),
        lemma_assignment: checked.assignment,
      },
    }
  }
}
