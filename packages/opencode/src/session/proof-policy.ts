/**
 * Runtime proof policy is intentionally compact. The agent prompts contain
 * the full methodology; this layer carries only invariants that must remain
 * visible when dynamic proof context is added on later turns.
 */

export function proverTheoremWorkflowPrompt() {
  return [
    "<prover-theorem-workflow>",
    "Own the theorem-level plan, region contracts, outer composition, and final Qed. The target is a real compiled proof; planning and delegation are means to that end.",
    "Before the first skeleton edit, use proof_plan unless a current accepted plan already exists. Materialize meaningful dependency-complete proof_regions in the file before delegation. Roughly 3-6 regions, commonly 4-5, is a soft preference only: merge tactic-sized normalization leaves and split genuinely independent semantic or dependency boundaries.",
    "Treat the generic route recipe as a soft prior, not a fixed proof route. Reorder, merge, replace, or abandon it when the live goal, premise audit, or compiler evidence supports a better approach.",
    "Give each candidate library lemma a role: direct_apply, rewrite, transport, local_fact, or automation_hint. Only direct_apply must close the complete node target during planning; validate other roles at their concrete proof use. An exact verified failed lemma + missing premise + theorem context may not be retried by renaming admit_id, markers, comments, or whitespace; a new hypothesis, compiled missing-premise proof, genuinely different instantiation, or corrected audit may reopen it.",
    "Schedule one dependency-ready proof_region at a time. Declared producer regions must be compiler-certified; file order is only a tie-breaker among ready nodes and must not invent dependencies between independent regions.",
    "Once a lemma-owned proof_region is running, do not edit inside it unless the runtime explicitly grants takeover. After a child returns, validate the authoritative staged transaction revision before dispatching anything else for that region; do not rebuild from an older disk copy or redispatch the same unchanged revision.",
    "A structural escalation permits evidence-based remodeling, not automatic skeleton freezing or automatic replanning. Preserve compiler-certified regions when possible, but retain freedom to change a demonstrably wrong local target, dependency boundary, or theorem-level bridge.",
    "After all regions are compiler-certified, compose them in the parent and replace the theorem terminator with Qed only after final validation.",
    "</prover-theorem-workflow>",
  ].join("\n")
}

export function lemmaLocalProofPrompt() {
  return [
    "<lemma-local-proof-policy>",
    "Own exactly the assigned proof_region and finish its exported local fact. Direct proof, same-region helpers, and a smaller local split are all available; choose from live proof evidence rather than a fixed recipe.",
    "Preserve text outside the assigned region and preserve the exported target contract when possible. If the target itself is wrong, return an evidence-backed needs_subgoal_remodel escalation instead of silently changing theorem ownership.",
    "Work on the first unresolved local proof block. Preserve its braces, edit from the authoritative staged revision, and validate after meaningful proof changes before advancing to later local blocks.",
    "A split remains in this lemma session and exposes only the immediate smaller blocker. It does not authorize another lemma task or a batch of speculative child proofs.",
    "Use the exact current goal, hypotheses, first compiler error, certified prefix, and failed-route ledger as the compact working set. Targeted lookup is useful only when it drives the next proof step.",
    "Do not edit Admitted./Qed. or close the outer theorem. Return solved only with the complete hole-free assigned proof_region and the required structured proof_result.",
    "</lemma-local-proof-policy>",
  ].join("\n")
}
