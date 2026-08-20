import z from "zod"
import { createHash } from "crypto"
import { Tool } from "./tool"
import {
  MAX_IDENTICAL_PLAN_METADATA_REPAIRS,
  MAX_SEMANTIC_PLAN_REVISIONS,
  ProofPlan,
  ProofPlanReview,
  ProofPlanStep,
  type ProofPlan as ProofPlanValue,
  type ProofPlanReviewIssue,
} from "./proof-schema"
import { SessionProof } from "@/session/session-proof"
import { SessionProofWorkflow } from "@/session/proof-workflow"
import { ProofRouteLedger } from "@/session/proof-route-ledger"
import { ProofEditTransaction } from "@/session/proof-edit-transaction"
import { Filesystem } from "@/util/filesystem"
import { Instance } from "@/project/instance"
import { auditPlanLibraryCandidates } from "./proof-premise-audit"
import { normalizeProofPlanIdentifiers } from "./proof-plan-identifiers"

export { normalizeProofPlanIdentifiers } from "./proof-plan-identifiers"

const Edge = z.object({ from: z.string().min(1), to: z.string().min(1) })

const Parameters = z
  .object({
    text: z.string().optional().describe("Natural-language proof text to extract when no structured nodes are supplied."),
    theorem: z.string().optional().describe("The theorem being decomposed."),
    root_goal: z.string().optional().describe("The exact theorem goal or its stable Coq-shaped summary."),
    nodes: z.array(ProofPlanStep).optional().describe("A structured candidate proof DAG to review before editing Coq."),
    edges: z.array(Edge).optional().describe("Directed dependency edges from prerequisite node to consumer node."),
    addresses_failure_ids: z
      .array(z.string().min(1))
      .optional()
      .describe("Known route-failure IDs that this plan changes or explicitly addresses."),
    route_overrides: z
      .array(ProofRouteLedger.RouteOverride)
      .optional()
      .describe("Evidence-backed reasons for deliberately retrying a verified failed route."),
  })
  .refine((input) => Boolean(input.text?.trim()) || Boolean(input.nodes?.length), {
    message: "provide non-empty text or at least one structured node",
  })

const planHistory = new Map<string, { attemptedFingerprints: string[] }>()

type PlanningStatus = "planning" | "accepted" | "exhausted" | "unbound" | "draft"
type RecommendedAction =
  | "materialize_once"
  | "materialize_accepted_plan"
  | "revise_semantic_dag"
  | "repair_plan_route"
  | "repair_plan_metadata"
  | "do_not_retry_metadata_only_plan"
  | "start_new_plan_generation"
  | "stop_and_report_best_plan"
  | "submit_structured_plan"
type SubmissionKind = "structured_plan" | "text_draft" | "text_fallback"
type ProofPlanMetadata = ProofPlanValue & {
  same_semantic_plan: boolean
  semantic_revision_number: number
  planning_generation: number
  revision_budget_exhausted: boolean
  accepted_plan_locked: boolean
  planning_status: PlanningStatus
  submission_kind: SubmissionKind
  submitted_semantic_fingerprint: string
  recommended_action: RecommendedAction
  route_failure_review: RouteFailureReview
  metadata_repair_repeat_count?: number
  metadata_repair_retry_limit?: number
  terminal_verdict?: {
    status: "semantic_incomplete"
    source_hash: string
    theorem_source_hash: string
    semantic_fingerprint: string
    blockers: string[]
    recoverable?: boolean
    planning_generation?: number
    failure_fingerprint?: string
    best_semantic_fingerprint?: string
    evaluated_at: number
  }
}

type RouteFailureReview = {
  active_failure_ids: string[]
  blocked: boolean
  override_required: boolean
  blocks: { failure_id: string; code: string; message: string; node_id?: string }[]
  warnings: { failure_id: string; code: string; message: string; node_id?: string }[]
}

type ProofPlanConvergence = Pick<
  ProofPlanMetadata,
  | "same_semantic_plan"
  | "semantic_revision_number"
  | "planning_generation"
  | "revision_budget_exhausted"
  | "accepted_plan_locked"
  | "planning_status"
  | "submission_kind"
  | "submitted_semantic_fingerprint"
  | "recommended_action"
  | "route_failure_review"
  | "metadata_repair_repeat_count"
  | "metadata_repair_retry_limit"
  | "terminal_verdict"
>

function formatProofPlanOutput(plan: ProofPlanValue, convergence: ProofPlanConvergence) {
  const review = plan.review
  const distinctHardErrors = [...new Map(
    (review?.hard_errors ?? []).map((entry) => [
      `${entry.code}\n${entry.node_id ?? ""}\n${entry.message}`,
      entry,
    ]),
  ).values()]
  const visibleHardErrors = distinctHardErrors.slice(0, 12).map((entry) => {
    const node = entry.node_id ? ` (${entry.node_id})` : ""
    const message = entry.message.replace(/\s+/g, " ").slice(0, 320)
    const details = Object.entries(entry.details ?? {}).slice(0, 8).map(([key, value]) => {
      const compact = value.replace(/\s+/g, " ").slice(0, 900)
      return `  ${key}: ${compact}`
    })
    return [
      `- ${entry.code}${node}: ${message}`,
      entry.repair_hint ? `  repair_hint: ${entry.repair_hint.replace(/\s+/g, " ").slice(0, 900)}` : undefined,
      ...details,
    ].filter((line): line is string => line !== undefined).join("\n")
  })
  if (distinctHardErrors.length > visibleHardErrors.length) {
    visibleHardErrors.push(`- ... ${distinctHardErrors.length - visibleHardErrors.length} additional distinct hard errors`)
  }

  return [
    "PROOF_PLAN_VERDICT",
    `planning_status: ${convergence.planning_status}`,
    `review_status: ${review?.status ?? "unknown"}`,
    `materialization_allowed: ${review?.materialization_allowed ?? false}`,
    `hard_error_count: ${review?.hard_errors.length ?? 0}`,
    `semantic_revision_number: ${convergence.semantic_revision_number}`,
    `planning_generation: ${convergence.planning_generation}`,
    `revision_budget_exhausted: ${convergence.revision_budget_exhausted}`,
    `accepted_plan_locked: ${convergence.accepted_plan_locked}`,
    `recommended_action: ${convergence.recommended_action}`,
    convergence.metadata_repair_repeat_count
      ? `metadata_repair_repeat_count: ${convergence.metadata_repair_repeat_count}/${convergence.metadata_repair_retry_limit ?? MAX_IDENTICAL_PLAN_METADATA_REPAIRS}`
      : undefined,
    `submission_kind: ${convergence.submission_kind}`,
    convergence.terminal_verdict ? `terminal_status: ${convergence.terminal_verdict.status}` : undefined,
    convergence.terminal_verdict ? `terminal_recoverable: ${convergence.terminal_verdict.recoverable === true}` : undefined,
    visibleHardErrors.length > 0 ? "distinct_hard_errors:" : undefined,
    ...visibleHardErrors,
    "END_PROOF_PLAN_VERDICT",
    `plan_node_count: ${plan.nodes.length}`,
    `plan_edge_count: ${plan.edges.length}`,
    "full_plan_persisted_in_workflow: true",
  ].filter((line): line is string => line !== undefined).join("\n")
}

function normalizeGoal(text: string | undefined) {
  return (text ?? "")
    .replace(/\(\*[\s\S]*?\*\)/g, " ")
    .trim()
    .replace(/\.\s*$/, "")
    .replace(/[{}()]/g, " ")
    // Coq accepts arbitrary whitespace around binder/type colons. Removing
    // parentheses above can otherwise turn equivalent forms such as
    // `(j : Job)` and `(j: Job)` into different normalized strings.
    .replace(/\s*:\s*/g, ":")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function normalizedGoalHash(text: string) {
  return createHash("sha256").update(text).digest("hex")
}

function nodeID(node: z.infer<typeof ProofPlanStep>) {
  return node.node_id || node.paper_step_id
}

function canonicalPlan(plan: ProofPlanValue) {
  const nodeKey = (node: z.infer<typeof ProofPlanStep>) =>
    [
      node.kind ?? "unknown",
      node.layer ?? "unknown",
      normalizeGoal(node.formal_goal),
      normalizeGoal(node.target_normal_form ?? node.target?.normal_form),
    ].join("\n")
  const nodeKeys = new Map((plan.nodes ?? []).map((node) => [nodeID(node), nodeKey(node)]))
  const dependencyKey = (value: string) => nodeKeys.get(value) ?? normalizeGoal(value)
  return {
    theorem: plan.theorem,
    root_goal: normalizeGoal(plan.root_goal),
    nodes: (plan.nodes ?? [])
      .map((node) => ({
        kind: node.kind ?? "unknown",
        layer: node.layer ?? "unknown",
        formal_goal: normalizeGoal(node.formal_goal),
        target_normal_form: normalizeGoal(node.target_normal_form ?? node.target?.normal_form),
        depends_on: (node.depends_on ?? []).map(dependencyKey).sort(),
        consumers: (node.consumers ?? []).map(dependencyKey).sort(),
        claim_delta: normalizeGoal(node.claim_delta),
        transformations: [...(node.transformations ?? [])].sort(),
        delegation_candidate: node.delegation_candidate,
        risk: node.risk ?? "unknown",
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    edges: [...(plan.edges ?? [])]
      .map((edge) => ({ from: dependencyKey(edge.from), to: dependencyKey(edge.to) }))
      .sort((left, right) => `${left.from}\n${left.to}`.localeCompare(`${right.from}\n${right.to}`)),
  }
}

export function semanticPlanFingerprint(plan: ProofPlanValue) {
  return createHash("sha256").update(JSON.stringify(canonicalPlan(plan))).digest("hex")
}

function graphHasCycle(ids: string[], edges: { from: string; to: string }[]) {
  const outgoing = new Map<string, string[]>()
  for (const edge of edges) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to])
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const next of outgoing.get(id) ?? []) {
      if (visit(next)) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }
  return ids.some(visit)
}

function referenceKeys(text: string | undefined) {
  const normalized = normalizeGoal(text)
  const keys = new Set<string>()
  if (normalized) keys.add(normalized)
  const identifier = (text ?? "").trim().match(/^([A-Za-z_][A-Za-z0-9_']*)\s*(?::|$)/)?.[1]
  if (identifier) keys.add(identifier.toLowerCase())
  return keys
}

function referencesOverlap(left: Iterable<string>, right: Iterable<string>) {
  const expected = new Set(right)
  for (const value of left) {
    if (expected.has(value)) return true
  }
  return false
}

function exportedReferenceKeys(node: z.infer<typeof ProofPlanStep>) {
  const keys = new Set<string>([nodeID(node).toLowerCase(), node.paper_step_id.toLowerCase()])
  for (const value of [
    node.formal_goal,
    node.target_normal_form,
    node.target?.normal_form,
    ...(node.output?.hypotheses ?? []),
    ...(node.output?.definitions ?? []),
    ...(node.output?.facts ?? []),
  ]) {
    for (const key of referenceKeys(value)) keys.add(key)
  }
  return keys
}

function requiresCompositionDataflowAudit(
  node: z.infer<typeof ProofPlanStep>,
  nodesByID: Map<string, z.infer<typeof ProofPlanStep>>,
) {
  const semantic = Boolean(
    node.layer === "semantic" ||
      node.layer === "theorem_spine" ||
      node.kind === "semantic_bridge" ||
      node.kind === "pointwise_semantic_bridge" ||
      (node.transformations ?? []).some((entry) =>
        ["semantic_bound", "case_split", "count_cardinality", "parent_composition"].includes(entry),
      ),
  )
  if (!semantic) return false
  if (node.risk === "medium" || node.risk === "high") return true
  const consumesBranchPremise =
    (node.required_hypotheses ?? []).length > 0 &&
    (node.transformations ?? []).some((entry) => entry === "case_split" || entry === "parent_composition")
  const combinesSemanticDependency =
    (node.required_hypotheses ?? []).length > 0 &&
    (node.depends_on ?? []).some((dependency) => nodesByID.has(dependency)) &&
    (node.transformations ?? []).includes("semantic_bound")
  return consumesBranchPremise || combinesSemanticDependency
}

function requiresHardCompositionDataflowAudit(
  node: z.infer<typeof ProofPlanStep>,
  rootGoal: string,
) {
  const target = normalizeGoal(node.target_normal_form ?? node.target?.normal_form ?? node.formal_goal)
  const closesRoot = Boolean(target && target === rootGoal)
  const mergesBranches =
    (node.transformations ?? []).includes("parent_composition") ||
    ((node.transformations ?? []).includes("case_split") && (node.depends_on ?? []).length > 1)
  const joinsSemanticDependencies =
    (node.depends_on ?? []).length > 1 &&
    (node.layer === "theorem_spine" || (node.transformations ?? []).includes("semantic_bound"))
  return closesRoot || mergesBranches || joinsSemanticDependencies
}

function reviewCompositionDataflow(
  node: z.infer<typeof ProofPlanStep>,
  nodesByID: Map<string, z.infer<typeof ProofPlanStep>>,
  rootGoal: string,
) {
  const id = nodeID(node)
  const issues: ProofPlanReviewIssue[] = []
  if (!requiresCompositionDataflowAudit(node, nodesByID)) return issues
  const critical = requiresHardCompositionDataflowAudit(node, rootGoal)
  const add = (
    code: string,
    message: string,
    guidance?: { repair_hint?: string; details?: Record<string, string> },
  ) => issues.push(issue(critical ? "hard_error" : "warning", code, message, id, guidance))

  const certificate = node.composition_certificate
  if (!certificate) {
    add(
      "composition_certificate_missing",
      critical
        ? "This root or semantic-join node must show how branch hypotheses and dependency outputs reach its target before materialization."
        : "Add composition dataflow when useful, but this non-root semantic node may be materialized incrementally and validated by Coq.",
    )
    return issues
  }

  const seenSteps = new Set<string>()
  for (const step of certificate.steps) {
    if (seenSteps.has(step.step_id)) {
      add("duplicate_composition_step", `Composition step ${step.step_id} is duplicated.`)
    }
    seenSteps.add(step.step_id)
  }

  const rawInputRefs = certificate.steps.flatMap((step) => step.input_refs)
  const inputKeys = new Set(rawInputRefs.flatMap((ref) => [...referenceKeys(ref)]))
  // Models naturally use either an executable output anchor (for example
  // `Hpartition`) or the producer node ID in a composition receipt.  The
  // latter is unambiguous when the DAG edge and dependency_uses mapping are
  // both present, so resolve it mechanically to the producer's exported
  // anchors instead of charging a semantic plan revision for metadata syntax.
  const nodesByNormalizedID = new Map(
    [...nodesByID.entries()].map(([producerID, producer]) => [producerID.trim().toLowerCase(), producer]),
  )
  for (const ref of rawInputRefs) {
    const producer = nodesByNormalizedID.get(ref.trim().toLowerCase())
    if (!producer || !(node.depends_on ?? []).includes(nodeID(producer))) continue
    for (const key of exportedReferenceKeys(producer)) inputKeys.add(key)
  }
  for (const hypothesis of node.required_hypotheses ?? []) {
    if (!referencesOverlap(referenceKeys(hypothesis), inputKeys)) {
      add("required_hypothesis_unmapped", `Required hypothesis ${hypothesis} is not consumed by any composition step.`)
    }
  }

  const dependencyNodes = (node.depends_on ?? []).filter((dependency) => nodesByID.has(dependency))
  const usesByProducer = new Map((node.dependency_uses ?? []).map((entry) => [entry.producer_node, entry]))
  for (const dependency of dependencyNodes) {
    const producer = nodesByID.get(dependency)!
    const use = usesByProducer.get(dependency)
    if (!use) {
      add("dependency_use_missing", `Dependency ${dependency} is declared but has no executable output_anchor mapping.`)
      continue
    }
    const anchorKeys = referenceKeys(use.output_anchor)
    if (!referencesOverlap(anchorKeys, exportedReferenceKeys(producer))) {
      add(
        "dependency_output_anchor_mismatch",
        `Dependency ${dependency} does not export the declared anchor ${use.output_anchor}.`,
      )
      continue
    }
    if (!referencesOverlap(anchorKeys, inputKeys)) {
      add(
        "dependency_not_consumed",
        `Dependency output ${use.output_anchor} is declared but no composition step consumes it.`,
      )
    }
  }

  for (const use of node.dependency_uses ?? []) {
    if (!nodesByID.has(use.producer_node) || !(node.depends_on ?? []).includes(use.producer_node)) {
      issues.push(
        issue(
          "hard_error",
          "dependency_use_unknown_producer",
          `Dependency use references ${use.producer_node}, which is not a declared producer dependency.`,
          id,
        ),
      )
    }
  }

  const rawFinalOutput = certificate.steps.at(-1)?.output_proposition
  const finalOutput = normalizeGoal(rawFinalOutput)
  const targetField = node.target_normal_form !== undefined
    ? "node.target_normal_form"
    : node.target?.normal_form !== undefined
      ? "node.target.normal_form"
      : "node.formal_goal"
  const declaredTarget = normalizeGoal(node.target_normal_form ?? node.target?.normal_form ?? node.formal_goal)
  const closesTheoremRoot =
    (node.transformations ?? []).includes("parent_composition") &&
    (node.consumers ?? []).length === 0
  const comparedTargetField = closesTheoremRoot ? "plan.root_goal" : targetField
  const target = closesTheoremRoot ? rootGoal : declaredTarget

  if (closesTheoremRoot && declaredTarget !== rootGoal) {
    add(
      "root_target_metadata_mismatch",
      "This theorem-closing node declares a target different from the authoritative plan.root_goal.",
      {
        repair_hint:
          `Copy plan.root_goal exactly into ${targetField}. Keep the semantic DAG unchanged; this is a metadata repair, not a new proof route.`,
        details: {
          compared_target_field: targetField,
          normalized_declared_target: declaredTarget || "<empty>",
          normalized_root_goal: rootGoal || "<empty>",
          declared_target_hash: normalizedGoalHash(declaredTarget),
          root_goal_hash: normalizedGoalHash(rootGoal),
        },
      },
    )
  }

  if (!finalOutput || finalOutput !== target) {
    add(
      "composition_target_mismatch",
      critical
        ? "The final composition step must produce the root or semantic-join target. Harmless textual normalization is advisory; final acceptance is determined by Coq."
        : "The final composition description differs from the node target; validate the actual connection while materializing the region.",
      {
        repair_hint:
          `Replace only the final composition output_proposition so that it equals ${comparedTargetField} after normalization. Do not add labels such as "theorem root goal:" and do not change the proof route unless the propositions are genuinely different.`,
        details: {
          compared_target_field: comparedTargetField,
          normalized_final_output: finalOutput || "<empty>",
          normalized_target: target || "<empty>",
          final_output_hash: normalizedGoalHash(finalOutput),
          target_hash: normalizedGoalHash(target),
        },
      },
    )
  }
  return issues
}

function issue(
  severity: "hard_error" | "warning",
  code: string,
  message: string,
  node_id?: string,
  guidance?: { repair_hint?: string; details?: Record<string, string> },
): ProofPlanReviewIssue {
  return {
    severity,
    code,
    message,
    ...(node_id ? { node_id } : {}),
    ...(guidance?.repair_hint ? { repair_hint: guidance.repair_hint } : {}),
    ...(guidance?.details ? { details: guidance.details } : {}),
  }
}

const MECHANICAL_PLAN_HARD_ERRORS = new Set([
  "duplicate_node_id",
  "unknown_edge_endpoint",
  "self_cycle",
  "duplicate_composition_step",
  "dependency_use_unknown_producer",
  "dependency_output_anchor_mismatch",
  "root_target_metadata_mismatch",
  "composition_target_mismatch",
])

export function hasOnlyMechanicalPlanHardErrors(review: z.infer<typeof ProofPlanReview>) {
  return review.hard_errors.length > 0 && review.hard_errors.every((entry) => MECHANICAL_PLAN_HARD_ERRORS.has(entry.code))
}

export function reviewProofPlan(plan: ProofPlanValue) {
  const hardErrors: ProofPlanReviewIssue[] = []
  const warnings: ProofPlanReviewIssue[] = []
  const planNodes = plan.nodes ?? []
  const ids = planNodes.map(nodeID)
  const idSet = new Set(ids)
  const nodesByID = new Map(planNodes.map((node) => [nodeID(node), node]))
  const root = normalizeGoal(plan.root_goal)

  if (planNodes.length === 0) {
    hardErrors.push(issue("hard_error", "empty_plan", "The proof plan has no nodes."))
  }
  if (idSet.size !== ids.length) {
    hardErrors.push(issue("hard_error", "duplicate_node_id", "Every proof-plan node must have a unique node_id."))
  }
  for (const edge of plan.edges ?? []) {
    if (!idSet.has(edge.from) || !idSet.has(edge.to)) {
      hardErrors.push(
        issue("hard_error", "unknown_edge_endpoint", `Edge ${edge.from} -> ${edge.to} references an unknown node.`),
      )
    } else if (edge.from === edge.to) {
      hardErrors.push(issue("hard_error", "self_cycle", `Node ${edge.from} cannot depend on itself.`, edge.from))
    }
  }
  if (graphHasCycle(ids, (plan.edges ?? []).filter((edge) => idSet.has(edge.from) && idSet.has(edge.to)))) {
    hardErrors.push(issue("hard_error", "dependency_cycle", "The structured proof DAG contains a cycle."))
  }

  const outgoing = new Map<string, number>()
  for (const edge of plan.edges ?? []) outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1)
  let delegationCandidates = 0
  let explicitParentConsumer = false
  for (const node of planNodes) {
    const id = nodeID(node)
    if ((node.consumers ?? []).some((consumer) => /^(?:parent|parent_composition|theorem)$/i.test(consumer))) {
      explicitParentConsumer = true
    }
    if (node.delegation_candidate) {
      delegationCandidates += 1
      const target = normalizeGoal(node.target_normal_form ?? node.target?.normal_form ?? node.formal_goal)
      if (root && target === root) {
        hardErrors.push(
          issue(
            "hard_error",
            "parent_equivalent_leaf",
            "A delegated leaf is equivalent to the theorem root. Keep the root in Layer 1 and expose strict child obligations.",
            id,
          ),
        )
      }
      if ((outgoing.get(id) ?? 0) === 0 && (node.consumers ?? []).length === 0) {
        hardErrors.push(
          issue(
            "hard_error",
            "disconnected_leaf",
            "A delegated leaf has no declared DAG edge or parent consumer.",
            id,
          ),
        )
      }
      if ((node.layer === "semantic" || node.kind === "semantic_bridge" || node.kind === "pointwise_semantic_bridge") && !node.claim_delta) {
        warnings.push(
          issue(
            "warning",
            "claim_delta_missing",
            "A semantic leaf should state how its conclusion differs from its parent claim.",
            id,
          ),
        )
      }
      const highRiskTransformations = (node.transformations ?? []).filter((entry) =>
        ["representation_bridge", "witness_transport", "case_split", "semantic_bound", "count_cardinality", "sum_exchange", "parent_composition"].includes(entry),
      )
      if (highRiskTransformations.length > 2) {
        warnings.push(
          issue(
            "warning",
            "region_too_coarse",
            `A delegated region combines ${highRiskTransformations.length} higher-risk transformations (${highRiskTransformations.join(", ")}). Keep it intact if they jointly establish one locally certifiable fact; otherwise split at one meaningful semantic or dependency boundary.`,
            id,
          ),
        )
      } else if ((node.transformations ?? []).length > 1) {
        warnings.push(
          issue(
            "warning",
            "compound_leaf",
            `A delegated region lists ${(node.transformations ?? []).length} transformations. Keep them together if they jointly establish one exported fact under one dependency boundary; otherwise split at a useful proof-state boundary.`,
            id,
          ),
        )
      }
    }
    const evidence = [
      ...(node.candidate_lemmas ?? []),
      ...(node.prosa_candidate_lemmas ?? []).map((entry) => entry.name),
      ...(node.mathcomp_candidate_lemmas ?? []).map((entry) => entry.name),
      ...(node.target?.evidence ?? []),
    ]
    if (node.evidence_status !== "negative_search" && evidence.length === 0) {
      warnings.push(
        issue(
          "warning",
          "evidence_unconfirmed",
          "No exact interface, checked definition, or explicit negative-search receipt supports this leaf yet.",
          id,
        ),
      )
    }
    for (const candidate of [...(node.prosa_candidate_lemmas ?? []), ...(node.mathcomp_candidate_lemmas ?? [])]) {
      const audit = candidate.audit
      if (!candidate.role) {
        warnings.push(
          issue(
            "warning",
            "candidate_role_inferred",
            `Library candidate ${candidate.name} omitted its role, so the runtime used the backward-compatible direct_apply audit. Set direct_apply only when the candidate is intended to close this complete node target; otherwise choose rewrite, transport, local_fact, or automation_hint.`,
            id,
          ),
        )
      }
      const role = candidate.role ?? "direct_apply"
      if (!audit) {
        warnings.push(
          issue(
            "warning",
            "candidate_premise_audit_missing",
            `Library candidate ${candidate.name} has no mechanical Check/application premise audit yet.`,
            id,
          ),
        )
        continue
      }
      if (audit.verdict === "interface_mismatch" || audit.verdict === "audit_error") {
        hardErrors.push(
          issue(
            "hard_error",
            audit.verdict === "interface_mismatch" ? "candidate_interface_mismatch" : "candidate_premise_audit_error",
            `Library candidate ${candidate.name} (${role}) cannot be materialized: ${audit.diagnostic ?? audit.verdict}.`,
            id,
          ),
        )
        continue
      }
      if (role !== "direct_apply" || audit.verdict !== "bridge_required") continue
      for (const premiseFingerprint of audit.residual_premise_fingerprints ?? []) {
        const source = (candidate.premise_sources ?? []).find(
          (entry) => entry.premise_fingerprint === premiseFingerprint,
        )
        if (!source || source.status === "unknown" || source.status === "unavailable") {
          hardErrors.push(
            issue(
              "hard_error",
              "candidate_unresolved_premise",
              `Library candidate ${candidate.name} leaves premise ${premiseFingerprint} without an available dependency or compiler certificate.`,
              id,
            ),
          )
          continue
        }
        if (source.status === "exact_local" || source.status === "convertible_local") {
          hardErrors.push(
            issue(
              "hard_error",
              "candidate_premise_local_evidence_invalid",
              `Library candidate ${candidate.name} still exposes premise ${premiseFingerprint} after the live assumption/conversion probe, so it cannot be self-certified as ${source.status}. Prove it through a dependency node or provide a current compiler certificate.`,
              id,
            ),
          )
        }
        if (
          source.status === "dependency_node" &&
          (!source.dependency_node ||
            !idSet.has(source.dependency_node) ||
            !(node.depends_on ?? []).includes(source.dependency_node))
        ) {
          hardErrors.push(
            issue(
              "hard_error",
              "candidate_premise_dependency_missing",
              `Premise ${premiseFingerprint} for ${candidate.name} names a dependency that is absent from the node DAG.`,
              id,
            ),
          )
        }
        if (source.status === "dependency_node" && source.dependency_node) {
          const dependency = planNodes.find((entry) => nodeID(entry) === source.dependency_node)
          const dependencyTargets = dependency
            ? [dependency.formal_goal, dependency.target_normal_form, dependency.target?.normal_form]
                .filter((target): target is string => Boolean(target))
            : []
          if (
            dependency &&
            !dependencyTargets.some(
              (target) => ProofRouteLedger.premiseFingerprint(target) === premiseFingerprint,
            )
          ) {
            hardErrors.push(
              issue(
                "hard_error",
                "candidate_premise_dependency_target_mismatch",
                `Dependency node ${source.dependency_node} does not export the exact residual premise ${premiseFingerprint} required by ${candidate.name}. Restate that dependency with the audited premise shape or use a current compiler certificate for an equivalent bridge.`,
                id,
              ),
            )
          }
        }
        if (source.status === "compiler_certified" && !source.certificate_id) {
          hardErrors.push(
            issue(
              "hard_error",
              "candidate_premise_certificate_missing",
              `Premise ${premiseFingerprint} for ${candidate.name} is marked compiler-certified without a certificate ID.`,
              id,
            ),
          )
        }
      }
    }
    for (const compositionIssue of reviewCompositionDataflow(node, nodesByID, root)) {
      if (compositionIssue.severity === "hard_error") hardErrors.push(compositionIssue)
      else warnings.push(compositionIssue)
    }
  }

  if (delegationCandidates === 0) {
    warnings.push(
      issue(
        "warning",
        "no_delegation_candidates",
        "The plan has no proposed local obligations. Mark meaningful single-output, dependency-complete nodes as delegation candidates; do not create tactic-sized leaves merely to satisfy this warning.",
      ),
    )
  }
  if (!explicitParentConsumer && !planNodes.some((node) => normalizeGoal(node.formal_goal) === root && !node.delegation_candidate)) {
    warnings.push(
      issue(
        "warning",
        "parent_composition_unspecified",
        "The plan does not yet identify the Layer-1 node or consumer that closes the theorem root.",
      ),
    )
  }

  const semanticFingerprint = semanticPlanFingerprint(plan)
  const status = hardErrors.length > 0 ? "reject" : warnings.length > 0 ? "revise" : "ready"
  return {
    status,
    semantic_fingerprint: semanticFingerprint,
    hard_errors: hardErrors,
    warnings,
    materialization_allowed: hardErrors.length === 0,
    max_semantic_revisions: MAX_SEMANTIC_PLAN_REVISIONS,
  }
}

function extractNodes(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.map((line, index) => ({
    paper_step_id: `step-${index + 1}`,
    node_id: `node-${index + 1}`,
    paper_claim: line,
    formal_goal: line,
    candidate_lemmas: [],
    prosa_candidate_lemmas: [],
    mathcomp_candidate_lemmas: [],
    required_hypotheses: [],
    fallback_plan: [],
    done_when: "The corresponding Coq-shaped node is materialized and connected to its consumer.",
    source: { kind: "proof_text" as const, label: `line-${index + 1}`, excerpt: line },
    confidence: "low" as const,
    depends_on: index === 0 ? [] : [`node-${index}`],
    dependency_uses: [],
    consumers: index + 1 < lines.length ? [`node-${index + 2}`] : ["parent_composition"],
    transformations: [],
    delegation_candidate: false,
    evidence_status: "unknown" as const,
  }))
}

export const ProofPlanTool = Tool.define("proof_plan", {
  description:
    "Create and review a bounded theorem-level proof DAG before editing Coq. Accepts natural-language proof text for extraction or structured nodes for semantic-risk review.",
  parameters: Parameters,
  async execute(params, ctx): Promise<{ title: string; metadata: ProofPlanMetadata; output: string }> {
    let binding: ReturnType<typeof SessionProof.get>
    try {
      binding = SessionProof.get(ctx.sessionID)
    } catch {
      binding = undefined
    }
    const boundProofFile = Boolean(
      binding?.file.endsWith(".v") && (await Filesystem.exists(binding.file)),
    )
    if (boundProofFile && binding) {
      ProofEditTransaction.assertStagedReadSynchronized(ctx.sessionID, binding.file, "submitting a proof plan")
    }
    const boundSource = boundProofFile && binding
      ? await ProofEditTransaction.readSource(ctx.sessionID, binding.file)
      : undefined
    const boundTarget = boundSource && binding
      ? SessionProofWorkflow.theoremTargetAtProofPosition(boundSource, {
          line: binding.line,
          character: binding.character,
        })
      : undefined
    const submittedTheorem = params.theorem?.trim() || undefined
    const submittedRootGoal = params.root_goal?.trim() || undefined
    const normalizedIdentifiers = normalizeProofPlanIdentifiers(
      params.nodes ?? extractNodes(params.text ?? ""),
      params.edges,
    )
    let nodes = normalizedIdentifiers.nodes
    if (boundProofFile && boundTarget && binding && boundSource && params.nodes?.length) {
      nodes = normalizeProofPlanIdentifiers(
        await auditPlanLibraryCandidates({
          file: binding.file,
          source: boundSource,
          theorem: boundTarget.theorem,
          nodes,
          signal: ctx.abort,
        }),
        normalizedIdentifiers.edges,
      ).nodes
    }
    const edges =
      normalizedIdentifiers.edges ??
      nodes.slice(1).map((node, index) => ({ from: nodeID(nodes[index]), to: nodeID(node) }))
    const ids = nodes.map(nodeID)
    const incoming = new Set(edges.map((edge) => edge.to))
    const plan = ProofPlan.parse({
      theorem: boundTarget?.theorem ?? submittedTheorem ?? "unspecified-theorem",
      root_goal: boundTarget?.root_goal ?? submittedRootGoal ?? nodes.at(-1)?.formal_goal ?? "unspecified-root-goal",
      nodes,
      edges,
      ready_nodes: ids.filter((id) => !incoming.has(id)),
      addresses_failure_ids: params.addresses_failure_ids ?? [],
      route_overrides: params.route_overrides ?? [],
      planner_contract: {
        marker_fields_required_for_lemma_delegation: [
          "plan_node",
          "depends_on",
          "source",
          "input",
          "output",
          "layer",
          "expected",
          "normal_form",
          "evidence",
        ],
        note:
          "Resolve semantic and graph hard errors before materialization. Candidate roles are audited differently: direct_apply candidates are application-probed with residual premises, while rewrite/transport/local_fact/automation_hint candidates are checked for availability and validated in their concrete proof use. Composition certificates are required only for theorem-root or multi-branch semantic joins; other nodes may be materialized incrementally with advisory dataflow warnings. Verified exact route failures remain hard materialization constraints.",
      },
    })
    const structuredSubmission = Boolean(params.nodes?.length)
    const rawReview = reviewProofPlan(plan)
    const hasDelegationCandidate = plan.nodes.some((node) => node.delegation_candidate)
    const hasExplicitLayer1Closure = plan.nodes.some(
      (node) => !node.delegation_candidate && normalizeGoal(node.formal_goal) === normalizeGoal(plan.root_goal),
    )
    const bindingErrors: ProofPlanReviewIssue[] = []
    if (boundProofFile && !boundTarget) {
      bindingErrors.push(
        issue(
          "hard_error",
          "bound_theorem_unresolved",
          "The bound proof position does not resolve to one physical theorem with an explicit proof body.",
        ),
      )
    }
    if (boundTarget && submittedTheorem && submittedTheorem !== boundTarget.theorem) {
      bindingErrors.push(
        issue(
          "hard_error",
          "bound_theorem_mismatch",
          `Submitted theorem ${submittedTheorem} does not match bound theorem ${boundTarget.theorem}.`,
        ),
      )
    }
    if (
      boundTarget &&
      submittedRootGoal &&
      normalizeGoal(submittedRootGoal) !== normalizeGoal(boundTarget.root_goal)
    ) {
      bindingErrors.push(
        issue(
          "hard_error",
          "bound_root_goal_mismatch",
          "Submitted root_goal does not match the conclusion of the bound theorem.",
        ),
      )
    }
    if (boundProofFile && structuredSubmission && !hasDelegationCandidate && !hasExplicitLayer1Closure) {
      bindingErrors.push(
        issue(
          "hard_error",
          "no_delegation_or_layer1_closure",
          "A bound structured plan must expose at least one delegation candidate or an explicit non-delegated node that closes the theorem root.",
        ),
      )
    }
    if (boundProofFile && binding && boundSource) {
      const certificates = new Map(
        SessionProofWorkflow.currentValidationCertificates(binding.file, boundSource)
          .map((entry) => [entry.certificate_id, entry]),
      )
      for (const node of plan.nodes) {
        const id = nodeID(node)
        for (const candidate of [
          ...(node.prosa_candidate_lemmas ?? []),
          ...(node.mathcomp_candidate_lemmas ?? []),
        ]) {
          const residual = new Set(candidate.audit?.residual_premise_fingerprints ?? [])
          for (const source of candidate.premise_sources ?? []) {
            if (source.status !== "compiler_certified" || !residual.has(source.premise_fingerprint)) continue
            const certificate = source.certificate_id ? certificates.get(source.certificate_id) : undefined
            if (
              !certificate ||
              certificate.theorem !== boundTarget?.theorem ||
              certificate.target_fingerprint !== source.premise_fingerprint
            ) {
              bindingErrors.push(
                issue(
                  "hard_error",
                  "candidate_premise_certificate_invalid",
                  `Premise ${source.premise_fingerprint} for ${candidate.name} does not reference a current compiler certificate for that exact proof-region target. Use a certificate_id from the live structured handoff or prove the premise through a dependency node.`,
                  id,
                ),
              )
            }
          }
        }
      }
    }
    const activeRouteFailures =
      boundProofFile && boundTarget && binding && boundSource
        ? ProofRouteLedger.getActiveRouteFailures({
            workspace: Instance.worktree === "/" ? Instance.directory : Instance.worktree,
            file: binding.file,
            theorem: boundTarget.theorem,
            source: boundSource,
          })
        : []
    const verifiedOverrideIDs = new Set<string>()
    const workflowState = SessionProofWorkflow.get(ctx.sessionID)
    for (const override of plan.route_overrides ?? []) {
      const failure = activeRouteFailures.find((entry) => entry.id === override.failure_id)
      if (!failure) continue
      const evidence = override.evidence
      if (evidence.kind === "different_instantiation") {
        const candidate = (plan.nodes ?? [])
          .flatMap((node) => [
            ...(node.prosa_candidate_lemmas ?? []),
            ...(node.mathcomp_candidate_lemmas ?? []),
          ])
          .find(
            (entry) =>
              entry.name === failure.failed_lemma &&
              entry.audit?.instantiation_fingerprint === evidence.candidate_instantiation_fingerprint,
          )
        if (
          candidate &&
          failure.failed_instantiation_fingerprint === evidence.previous_instantiation_fingerprint &&
          evidence.previous_instantiation_fingerprint !== evidence.candidate_instantiation_fingerprint
        ) {
          verifiedOverrideIDs.add(failure.id)
        }
      }
      if (evidence.kind === "missing_premise_certified") {
        const item = workflowState?.queue.find((entry) => entry.admit_id === evidence.admit_id)
        const certificate = item?.validation_certificate
        const certifiedTarget = boundSource
          ? SessionProofWorkflow.proofRegionTargetFingerprint(boundSource, evidence.admit_id)
          : undefined
        if (
          item?.status === "solved" &&
          certificate?.compiler_signature === evidence.compiler_signature &&
          certificate.source_hash === evidence.source_hash &&
          certifiedTarget === evidence.premise_fingerprint &&
          failure.missing_premise_fingerprints.includes(evidence.premise_fingerprint)
        ) {
          verifiedOverrideIDs.add(failure.id)
        }
      }
      if (evidence.kind === "failure_audit_invalidated") {
        const item = failure.admit_id
          ? workflowState?.queue.find((entry) => entry.admit_id === failure.admit_id)
          : undefined
        const certificate = item?.validation_certificate
        if (
          item?.status === "solved" &&
          failure.evidence.includes(evidence.audit_id) &&
          certificate?.compiler_signature === evidence.compiler_signature &&
          certificate.source_hash === evidence.source_hash
        ) {
          verifiedOverrideIDs.add(failure.id)
        }
      }
    }
    const routeFailureAssessment = ProofRouteLedger.assessKnownRouteReuse(activeRouteFailures, {
      ...plan,
      plan_fingerprint: rawReview.semantic_fingerprint,
    }, { verified_override_ids: verifiedOverrideIDs })
    const routeFailureReview: RouteFailureReview = {
      active_failure_ids: activeRouteFailures.map((failure) => failure.id),
      ...routeFailureAssessment,
    }
    const activeRouteFailureIDs = new Set(routeFailureReview.active_failure_ids)
    for (const override of plan.route_overrides ?? []) {
      if (activeRouteFailureIDs.has(override.failure_id) && verifiedOverrideIDs.has(override.failure_id)) {
        ProofRouteLedger.recordRouteOverride(override)
      }
    }
    const routeBlocks = routeFailureAssessment.blocks.map((block) =>
      issue("hard_error", block.code, block.message, block.node_id),
    )
    const combinedWarnings = [...rawReview.warnings]
    const combinedHardErrors = [...rawReview.hard_errors, ...bindingErrors, ...routeBlocks]
    const review = ProofPlanReview.parse({
      ...rawReview,
      status:
        combinedHardErrors.length > 0
          ? "reject"
          : rawReview.status === "ready" && combinedWarnings.length > 0
            ? "revise"
            : rawReview.status,
      materialization_allowed: combinedHardErrors.length > 0 ? false : rawReview.materialization_allowed,
      hard_errors: combinedHardErrors,
      warnings: combinedWarnings,
    })
    const reviewedPlan = ProofPlan.parse({ ...plan, review })
    const existingPlanState = binding?.file
      ? SessionProofWorkflow.getDecompositionPlanState(ctx.sessionID, binding.file, boundTarget?.theorem)
      : undefined
    if (
      boundProofFile &&
      !structuredSubmission &&
      existingPlanState?.status !== "accepted" &&
      existingPlanState?.status !== "exhausted"
    ) {
      const result = {
        ...reviewedPlan,
        same_semantic_plan: false,
        semantic_revision_number: existingPlanState?.semantic_revision_number ?? 0,
        planning_generation: existingPlanState?.planning_generation ?? 0,
        revision_budget_exhausted: false,
        accepted_plan_locked: false,
        planning_status: "draft" as const,
        submission_kind: "text_draft" as const,
        submitted_semantic_fingerprint: review.semantic_fingerprint,
        recommended_action: "submit_structured_plan" as const,
        route_failure_review: routeFailureReview,
      }
      return {
        title: `${reviewedPlan.nodes.length} extracted draft nodes (structured plan required)`,
        metadata: result,
        output: formatProofPlanOutput(reviewedPlan, {
          same_semantic_plan: false,
          semantic_revision_number: existingPlanState?.semantic_revision_number ?? 0,
          planning_generation: existingPlanState?.planning_generation ?? 0,
          revision_budget_exhausted: false,
          accepted_plan_locked: false,
          planning_status: "draft",
          submission_kind: "text_draft",
          submitted_semantic_fingerprint: review.semantic_fingerprint,
          recommended_action: "submit_structured_plan",
          route_failure_review: routeFailureReview,
        }),
      }
    }
    let effectivePlan = reviewedPlan
    let sameSemanticPlan = false
    let semanticRevisionNumber = 0
    let planningGeneration = 0
    let revisionBudgetExhausted = false
    let acceptedPlanLocked = false
    let metadataRepairRepeatCount = 0
    let terminalVerdict: ProofPlanMetadata["terminal_verdict"]
    let planningStatus: "planning" | "accepted" | "exhausted" | "unbound" = "unbound"
    let action:
      | "materialize_once"
      | "materialize_accepted_plan"
      | "revise_semantic_dag"
      | "repair_plan_route"
      | "repair_plan_metadata"
      | "do_not_retry_metadata_only_plan"
      | "start_new_plan_generation"
      | "stop_and_report_best_plan"

    if (boundProofFile && binding) {
      const recorded = SessionProofWorkflow.recordDecompositionPlanAttempt({
        sessionID: ctx.sessionID,
        file: binding.file,
        source: boundSource!,
        plan: reviewedPlan,
        review,
      })
      const rejectedAcceptedRepair = Boolean(
        recorded.state.accepted_plan &&
        recorded.state.accepted_semantic_fingerprint !== review.semantic_fingerprint &&
        recorded.state.last_review.semantic_fingerprint === review.semantic_fingerprint &&
        !review.materialization_allowed,
      )
      effectivePlan = rejectedAcceptedRepair
        ? recorded.state.last_candidate_plan
        : recorded.state.accepted_plan ??
          (recorded.state.status === "exhausted" ? recorded.state.best_rejected_plan : undefined) ??
          recorded.state.last_candidate_plan
      sameSemanticPlan = recorded.same_semantic_plan
      semanticRevisionNumber = recorded.state.semantic_revision_number
      planningGeneration = recorded.state.planning_generation ?? 0
      revisionBudgetExhausted = recorded.state.status === "exhausted"
      acceptedPlanLocked = recorded.accepted_plan_locked
      metadataRepairRepeatCount = recorded.state.metadata_repair_repeat_count ?? 0
      terminalVerdict = recorded.state.terminal_verdict
      planningStatus = recorded.state.status
      action = recorded.recommended_action
    } else {
      const historyKey = `${ctx.sessionID}:${reviewedPlan.theorem}`
      const previous = planHistory.get(historyKey)
      const attemptedFingerprints = previous?.attemptedFingerprints ?? []
      sameSemanticPlan = attemptedFingerprints.includes(review.semantic_fingerprint)
      const mechanicalRepair = hasOnlyMechanicalPlanHardErrors(review)
      const attempted = sameSemanticPlan || mechanicalRepair
        ? attemptedFingerprints
        : [...attemptedFingerprints, review.semantic_fingerprint]
      planHistory.set(historyKey, { attemptedFingerprints: attempted })
      semanticRevisionNumber = Math.max(0, attempted.length - 1)
      const beyondBudget = semanticRevisionNumber > review.max_semantic_revisions
      revisionBudgetExhausted = beyondBudget || (
        !review.materialization_allowed &&
        !mechanicalRepair &&
        (sameSemanticPlan || semanticRevisionNumber >= review.max_semantic_revisions)
      )
      action = beyondBudget
        ? "stop_and_report_best_plan"
        : mechanicalRepair
        ? "repair_plan_metadata"
        : sameSemanticPlan
        ? "do_not_retry_metadata_only_plan"
        : review.materialization_allowed
          ? "materialize_once"
          : revisionBudgetExhausted
            ? "stop_and_report_best_plan"
            : "revise_semantic_dag"
    }

    return {
      title: `${effectivePlan.nodes.length} proof plan nodes (${effectivePlan.review?.status ?? review.status})`,
      metadata: {
        ...effectivePlan,
        same_semantic_plan: sameSemanticPlan,
        semantic_revision_number: semanticRevisionNumber,
        planning_generation: planningGeneration,
        revision_budget_exhausted: revisionBudgetExhausted,
        accepted_plan_locked: acceptedPlanLocked,
        planning_status: planningStatus,
        submission_kind: structuredSubmission ? "structured_plan" as const : "text_fallback" as const,
        submitted_semantic_fingerprint: review.semantic_fingerprint,
        recommended_action: action,
        route_failure_review: routeFailureReview,
        metadata_repair_repeat_count: metadataRepairRepeatCount || undefined,
        metadata_repair_retry_limit: MAX_IDENTICAL_PLAN_METADATA_REPAIRS,
        terminal_verdict: terminalVerdict,
      },
      output: formatProofPlanOutput(effectivePlan, {
        same_semantic_plan: sameSemanticPlan,
        semantic_revision_number: semanticRevisionNumber,
        planning_generation: planningGeneration,
        revision_budget_exhausted: revisionBudgetExhausted,
        accepted_plan_locked: acceptedPlanLocked,
        planning_status: planningStatus,
        submission_kind: structuredSubmission ? "structured_plan" : "text_fallback",
        submitted_semantic_fingerprint: review.semantic_fingerprint,
        recommended_action: action,
        route_failure_review: routeFailureReview,
        metadata_repair_repeat_count: metadataRepairRepeatCount || undefined,
        metadata_repair_retry_limit: MAX_IDENTICAL_PLAN_METADATA_REPAIRS,
        terminal_verdict: terminalVerdict,
      }),
    }
  },
})
