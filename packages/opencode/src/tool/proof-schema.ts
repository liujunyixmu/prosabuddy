import z from "zod"
import { ObligationKind } from "../session/lemma-assignment"
import { ProofRouteLedger } from "../session/proof-route-ledger"

export const ProofPlanLayer = z.enum([
  "semantic",
  "shape",
  "paper",
  "prosa",
  "mathcomp",
  "coq_shape",
  "local_arithmetic",
  "theorem_spine",
])
export type ProofPlanLayer = z.infer<typeof ProofPlanLayer>

export const PremiseSourceStatus = z.enum([
  "exact_local",
  "convertible_local",
  "dependency_node",
  "compiler_certified",
  "unavailable",
  "unknown",
])
export type PremiseSourceStatus = z.infer<typeof PremiseSourceStatus>

export const ProofPlanPremiseSource = z.object({
  premise_fingerprint: z.string().min(1),
  status: PremiseSourceStatus,
  dependency_node: z.string().min(1).optional(),
  certificate_id: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
})
export type ProofPlanPremiseSource = z.infer<typeof ProofPlanPremiseSource>

export const CandidateLemmaAudit = z.object({
  lemma: z.string().min(1),
  exact_type: z.string().min(1).optional(),
  lemma_type_fingerprint: z.string().min(1).optional(),
  target_contract_fingerprint: z.string().min(1),
  instantiation_fingerprint: z.string().min(1).optional(),
  conclusion_compatible: z.boolean(),
  residual_premises: z.array(z.string()).default([]),
  residual_premise_fingerprints: z.array(z.string().min(1)).default([]),
  verdict: z.enum(["usable", "available", "bridge_required", "interface_mismatch", "audit_error"]),
  diagnostic: z.string().optional(),
  compiler_output_hash: z.string().min(1).optional(),
  audited_at: z.number().int().positive(),
})
export type CandidateLemmaAudit = z.infer<typeof CandidateLemmaAudit>

export const ProofPlanCandidateRole = z.enum([
  "direct_apply",
  "rewrite",
  "transport",
  "local_fact",
  "automation_hint",
])
export type ProofPlanCandidateRole = z.infer<typeof ProofPlanCandidateRole>

export const ProofPlanCandidateLemma = z.object({
  name: z.string().min(1),
  library: z.enum(["prosa", "mathcomp", "local", "unknown"]),
  role: ProofPlanCandidateRole.optional().describe(
    "How this candidate participates in the node. Only direct_apply candidates are required to close the complete node target during premise audit; omitted legacy roles are audited conservatively as local_fact and produce a planning warning.",
  ),
  reason: z.string().min(1),
  premise_sources: z.array(ProofPlanPremiseSource).default([]),
  audit: CandidateLemmaAudit.optional(),
})
export type ProofPlanCandidateLemma = z.infer<typeof ProofPlanCandidateLemma>

export const ProofPlanSource = z.object({
  kind: z.enum(["paper", "proof_text", "context", "prosa", "mathcomp", "inferred"]),
  label: z.string().min(1),
  excerpt: z.string().min(1),
})
export type ProofPlanSource = z.infer<typeof ProofPlanSource>

export const ProofPlanIO = z.object({
  hypotheses: z.array(z.string()).default([]),
  definitions: z.array(z.string()).default([]),
  facts: z.array(z.string()).default([]),
})
export type ProofPlanIO = z.infer<typeof ProofPlanIO>

export const ProofPlanExpected = z.object({
  proof_contract: z.string().min(1),
  target_shape: z.string().min(1),
  evidence_required: z.array(z.string()).default([]),
})
export type ProofPlanExpected = z.infer<typeof ProofPlanExpected>

export const ProofPlanTargetReview = z.object({
  normal_form: z.string().min(1),
  shape: z.string().min(1),
  evidence: z.array(z.string()).default([]),
})
export type ProofPlanTargetReview = z.infer<typeof ProofPlanTargetReview>

export const ProofPlanTransformation = z.enum([
  "definition_unfold",
  "representation_bridge",
  "witness_transport",
  "case_split",
  "semantic_bound",
  "count_cardinality",
  "sum_exchange",
  "arithmetic",
  "parent_composition",
])
export type ProofPlanTransformation = z.infer<typeof ProofPlanTransformation>

export const ProofPlanRisk = z.enum(["low", "medium", "high"])
export type ProofPlanRisk = z.infer<typeof ProofPlanRisk>

export const ProofPlanEvidenceStatus = z.enum(["verified", "candidate", "negative_search", "unknown"])
export type ProofPlanEvidenceStatus = z.infer<typeof ProofPlanEvidenceStatus>

export const ProofPlanDependencyUse = z.object({
  producer_node: z.string().min(1),
  output_anchor: z.string().min(1),
})
export type ProofPlanDependencyUse = z.infer<typeof ProofPlanDependencyUse>

export const ProofPlanCompositionStep = z.object({
  step_id: z.string().min(1),
  input_refs: z.array(z.string().min(1)).min(1),
  output_proposition: z.string().min(1),
})
export type ProofPlanCompositionStep = z.infer<typeof ProofPlanCompositionStep>

export const ProofPlanCompositionCertificate = z.object({
  steps: z.array(ProofPlanCompositionStep).min(1),
})
export type ProofPlanCompositionCertificate = z.infer<typeof ProofPlanCompositionCertificate>

/** Structured proof plan step extracted from proof.txt / paper-proof.txt */
export const ProofPlanStep = z.object({
  paper_step_id: z.string(),
  node_id: z.string().optional().describe(
    "Machine identifier used by DAG edges and proof_region plan_node markers. The proof_plan tool canonicalizes missing or unsafe values to ^[A-Za-z][A-Za-z0-9_-]*$; keep the human-readable title in paper_step_id.",
  ),
  kind: ObligationKind.optional(),
  layer: ProofPlanLayer.optional(),
  paper_claim: z.string(),
  formal_goal: z.string(),
  candidate_lemmas: z.array(z.string()),
  prosa_candidate_lemmas: z.array(ProofPlanCandidateLemma).default([]),
  mathcomp_candidate_lemmas: z.array(ProofPlanCandidateLemma).default([]),
  required_hypotheses: z.array(z.string()),
  source: ProofPlanSource.optional(),
  input: ProofPlanIO.optional(),
  output: ProofPlanIO.optional(),
  expected: ProofPlanExpected.optional(),
  target: ProofPlanTargetReview.optional(),
  target_normal_form: z.string().optional(),
  fallback_plan: z.array(z.string()),
  done_when: z.string(),
  source_excerpt: z.string().optional(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  formalization_notes: z.array(z.string()).optional(),
  depends_on: z.array(z.string()).default([]),
  dependency_uses: z.array(ProofPlanDependencyUse).default([]),
  consumers: z.array(z.string()).default([]),
  claim_delta: z.string().optional(),
  transformations: z.array(ProofPlanTransformation).default([]),
  delegation_candidate: z.boolean().default(false),
  risk: ProofPlanRisk.optional(),
  evidence_status: ProofPlanEvidenceStatus.optional(),
  composition_certificate: ProofPlanCompositionCertificate.optional(),
})
export type ProofPlanStep = z.infer<typeof ProofPlanStep>

export const ProofPlanReviewIssue = z.object({
  severity: z.enum(["hard_error", "warning"]),
  code: z.string().min(1),
  message: z.string().min(1),
  node_id: z.string().optional(),
})
export type ProofPlanReviewIssue = z.infer<typeof ProofPlanReviewIssue>

export const MAX_SEMANTIC_PLAN_REVISIONS = 4 as const

export const ProofPlanReview = z.object({
  status: z.enum(["ready", "revise", "reject"]),
  semantic_fingerprint: z.string().min(1),
  hard_errors: z.array(ProofPlanReviewIssue).default([]),
  warnings: z.array(ProofPlanReviewIssue).default([]),
  materialization_allowed: z.boolean(),
  max_semantic_revisions: z
    .number()
    .int()
    .min(1)
    .max(MAX_SEMANTIC_PLAN_REVISIONS)
    .transform(() => MAX_SEMANTIC_PLAN_REVISIONS),
})
export type ProofPlanReview = z.infer<typeof ProofPlanReview>

export const ProofPlan = z.object({
  theorem: z.string().min(1),
  root_goal: z.string().min(1),
  nodes: z.array(ProofPlanStep),
  edges: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })).default([]),
  ready_nodes: z.array(z.string()).default([]),
  addresses_failure_ids: z.array(z.string().min(1)).default([]),
  route_overrides: z.array(ProofRouteLedger.RouteOverride).default([]),
  planner_contract: z.object({
    marker_fields_required_for_lemma_delegation: z.array(z.string()).default([]),
    note: z.string().min(1),
  }),
  review: ProofPlanReview.optional(),
})
export type ProofPlan = z.infer<typeof ProofPlan>

/** Normalized environment feedback from a tactic step or compile */
export const EnvFeedback = z.object({
  kind: z.enum(["proof_progress", "environment_problem", "syntax_or_engine_problem"]),
  summary: z.string(),
  missing_symbol: z.string().optional(),
  missing_hypothesis: z.string().optional(),
  new_goal: z.string().optional(),
  remaining_goals: z.number().optional(),
  raw_ref: z.string().optional(),
  same_as_previous: z.boolean().optional(),
})
export type EnvFeedback = z.infer<typeof EnvFeedback>

/** A single tactic application record */
export const TacticRecord = z.object({
  tactic: z.string(),
  result: z.enum(["success", "failure"]),
  feedback: EnvFeedback.optional(),
  time: z.string(),
})
export type TacticRecord = z.infer<typeof TacticRecord>

/** Resolved project context for Coq compilation */
export const CoqProjectContext = z.object({
  root: z.string(),
  file: z.string(),
  theorem: z.string(),
  project_path: z.string().nullable(),
  flags: z.array(z.string()),
  cwd: z.string(),
  preamble: z.string(),
})
export type CoqProjectContext = z.infer<typeof CoqProjectContext>

/** Short-term proof summary updated after each step */
export const SessionSummary = z.object({
  last_success: z.string().nullable(),
  last_failure: z.string().nullable(),
  last_error_class: z.enum(["proof_progress", "environment_problem", "syntax_or_engine_problem"]).nullable(),
  remaining_goals: z.number().nullable(),
  frontier: z.string().nullable(),
  changed: z.boolean(),
})
export type SessionSummary = z.infer<typeof SessionSummary>

/** Coq session state for incremental tactic stepping */
export const CoqSessionState = z.object({
  session_id: z.string(),
  loaded_file: z.string(),
  focused_goal: z.string(),
  local_hyps: z.array(z.string()),
  tactic_history: z.array(TacticRecord),
  snapshots: z.record(z.string(), z.object({
    id: z.string(),
    goal: z.string(),
    hyps: z.array(z.string()),
    tactic_index: z.number(),
    context: z.string(),
    goal_fingerprint: z.string().optional(),
    semantic_goal_fingerprint: z.string().optional(),
    summary: SessionSummary.optional(),
  })),
  last_error: z.string().nullable(),
  warning_summary: z.array(z.string()),
  project: CoqProjectContext.optional(),
  source_file: z.string().optional(),
  open_context: z.string().optional(),
  source_hash: z.string().optional(),
  certified_prefix_fingerprint: z.string().optional(),
  region_admit_id: z.string().optional(),
  region_binding: z.enum(["assigned", "explicit"]).optional(),
  proof_position: z.object({ line: z.number().int().nonnegative(), character: z.number().int().nonnegative() }).optional(),
  goal_fingerprint: z.string().optional(),
  semantic_goal_fingerprint: z.string().optional(),
  expected_goal: z.string().optional(),
  expected_goal_fingerprint: z.string().optional(),
  desync_count: z.number().int().nonnegative().default(0),
  summary: SessionSummary.optional(),
})
export type CoqSessionState = z.infer<typeof CoqSessionState>

/** Compiler checkpoint result */
export const CheckpointResult = z.object({
  status: z.enum(["ok", "error"]),
  first_error_file: z.string().nullable(),
  first_error_line: z.number().nullable(),
  first_error_message: z.string().nullable(),
  warning_summary: z.array(z.string()),
  same_as_previous: z.boolean(),
})
export type CheckpointResult = z.infer<typeof CheckpointResult>
