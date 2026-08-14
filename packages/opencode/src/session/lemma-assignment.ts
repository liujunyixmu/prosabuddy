import z from "zod"

export const ObligationKind = z.enum([
  "definition_rewrite",
  "library_instantiation",
  "semantic_bridge",
  "pointwise_semantic_bridge",
  "witness_transport",
  "witness_extraction",
  "injectivity_uniq",
  "uniqueness_injection",
  "count_cardinality",
  "case_split_boundary",
  "contradiction_close",
  "final_arithmetic",
  "shape_transport",
  "paper_bridge",
  "unknown",
])
export type ObligationKind = z.infer<typeof ObligationKind>

export const EscalationType = z.enum([
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
])
export type EscalationType = z.infer<typeof EscalationType>

export const RemodelRequestSchema = z.object({
  current_target: z.string().min(1),
  why_current_target_is_wrong: z.string().min(1),
  proposed_target_statement: z.string().optional(),
  proposed_preceding_helper: z.string().optional(),
  proposed_region_shape: z.string().optional(),
  should_lift_to_theorem_level: z.boolean(),
})
export type RemodelRequest = z.infer<typeof RemodelRequestSchema>

export const ContextMismatchBasis = z.enum([
  "hidden_arguments",
  "section_context",
  "module_instantiation",
  "implicit_arguments",
  "alias_normalization",
  "other",
])
export type ContextMismatchBasis = z.infer<typeof ContextMismatchBasis>

export const ContextNormalizationAuditSchema = z.object({
  audit_id: z.string().min(1),
  outcome: z.enum(["convertible", "not_convertible", "inconclusive"]),
  inspected_symbols: z.array(z.string().min(1)).max(8).default([]),
  left_expression: z.string().min(1),
  right_expression: z.string().min(1),
  left_summary: z.string().min(1),
  right_summary: z.string().min(1),
  goal_fingerprint: z.string().min(1),
  hypotheses_fingerprint: z.string().min(1),
  diagnostic: z.string().optional(),
  verified: z.boolean().default(false),
})
export type ContextNormalizationAudit = z.infer<typeof ContextNormalizationAuditSchema>

export const BlockedProofReportSchema = z
  .object({
    informal_proof_summary: z.string().min(1),
    validated_fragments: z.array(z.string()).default([]),
    failed_tactics_or_edits: z.array(z.string()).default([]),
    stable_blocker_goal: z.string().min(1),
    first_failing_line: z.string().optional(),
    suspected_missing_bridge: z.string().optional(),
    suspected_wrong_target_shape: z.string().optional(),
    context_mismatch_basis: ContextMismatchBasis.optional(),
    context_audit: ContextNormalizationAuditSchema.optional(),
    failed_local_bridge: z.string().optional(),
    proposed_children: z
      .array(
        z.object({
          title: z.string().min(1),
          statement: z.string().min(1),
          why_smaller: z.string().min(1),
          dependency_order: z.number().int().positive(),
        }),
      )
      .default([]),
    recommended_action: z.enum([
      "add_preceding_helper",
      "split_region",
      "strengthen_context",
      "change_theorem_spine",
      "local_retry",
    ]),
  })
  .passthrough()
export type BlockedProofReport = z.infer<typeof BlockedProofReportSchema>

export const LemmaObligationSchema = z.object({
  kind: ObligationKind,
  proof_plan_node: z.string().optional(),
  target_name: z.string().optional(),
  target_statement: z.string().optional(),
  expected_proof_kind: z.string().optional(),
  dependencies: z.array(z.string()).default([]),
  source: z.string().optional(),
  input: z.array(z.string()).default([]),
  output: z.string().optional(),
  layer: z.string().optional(),
  expected: z.string().optional(),
  target_normal_form: z.string().optional(),
  prosa_candidate_lemmas: z.array(z.string()).default([]),
  mathcomp_candidate_lemmas: z.array(z.string()).default([]),
  shape_evidence: z.array(z.string()).default([]),
  locality_check: z
    .object({
      all_dependencies_available: z.boolean(),
      may_need_region_helper: z.boolean(),
      changes_theorem_spine: z.boolean(),
      expected_lemma_shape: z.string().optional(),
      risk_level: z.enum(["low", "medium", "high"]),
    })
    .optional(),
})
export type LemmaObligation = z.infer<typeof LemmaObligationSchema>

export const EditableRegionSchema = z.object({
  mode: z.literal("region"),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  text: z.string().min(1),
  begin_marker: z.string().optional(),
  end_marker: z.string().optional(),
  can_add_sibling_helpers: z.boolean(),
  immutable_prefix_hash: z.string().optional(),
  immutable_suffix_hash: z.string().optional(),
  region_fingerprint: z.string().optional(),
})
export type EditableRegion = z.infer<typeof EditableRegionSchema>

export const LemmaAssignmentSchema = z
  .object({
    file: z.string().min(1).describe("Workspace-relative Coq file path containing the assigned proof_region to replace or update"),
    theorem: z.string().min(1).describe("Enclosing theorem or lemma name for the assigned proof_region"),
    admit_id: z.string().min(1).describe("Stable identifier for the single proof_region this lemma session owns"),
    goal: z.string().min(1).describe("Concrete local goal statement for the assigned proof_region"),
    goal_fingerprint: z
      .string()
      .min(1)
      .optional()
      .describe("Normalized semantic fingerprint of the assigned proof_region entry goal"),
    proof_position: z
      .object({
        line: z.number().int().nonnegative(),
        character: z.number().int().nonnegative(),
      })
      .describe("0-based LSP position immediately inside the local proof block that opens this proof gap")
      .optional(),
    replace: z
      .string()
      .min(1)
      .describe(
        "Exact replacement contract describing which proof_region to replace or update, including the exported local target statement and its proof block, what target statement should be preserved as the prover-authored subgoal contract, and what surrounding structure must stay untouched",
      ),
    skeleton: z
      .string()
      .min(1)
      .describe(
        "Assigned proof_region text, including the exported local target statement to preserve when possible, its proof block, nearby local skeleton, or proof context that the lemma agent must preserve while replacing or updating the region",
      ),
    done: z
      .string()
      .min(1)
      .describe("Completion contract stating how the caller will validate that this assigned proof_region has been fully discharged and merged back"),
    obligation: LemmaObligationSchema.optional(),
    editable_region: EditableRegionSchema.optional(),
    escalation_contract: z
      .object({
        allowed_escalations: z.array(EscalationType),
        remodel_owner: z.literal("prover"),
      })
      .optional(),
  })
  .meta({
    ref: "LemmaAssignment",
  })

export type LemmaAssignment = z.infer<typeof LemmaAssignmentSchema>
