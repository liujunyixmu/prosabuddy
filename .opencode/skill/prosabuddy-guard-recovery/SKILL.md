---
name: prosabuddy-guard-recovery
description: Interpret Prosabuddy proof guard, premise-audit, Coq-session desynchronization, proof-transaction recovery, and theorem-region planning feedback and select the next safe proof action. Use when a proof worker receives verified_failed_route_reuse, verified_failed_route_requires_audit, candidate_unresolved_premise, repair_plan_route, proof_transaction_stale_view, proof_transaction_scope_rejection, session_state_desync, debug-only progress, a recoverable transaction, or region-granularity guidance.
---

# Prosabuddy Guard Recovery

Use the full runtime guard payload as the source of truth. Preserve staged and compiler-validated proof text, then repair only the rejected dimension.

## Recovery Map

| Guard or state | Next safe action |
|---|---|
| `verified_failed_route_reuse` | Change the lemma, affected target route, or mechanically audited instantiation; alternatively prove the exact missing premise with a current compiler certificate. |
| `verified_failed_route_requires_audit` | Replace the legacy name-only candidate with a structured library candidate and let the live premise audit check its exact interface and application. Do not treat a renamed fact or free-form override as evidence. |
| `candidate_unresolved_premise` | A residual premise already survived the live assumption/conversion probe. Produce it through an explicit dependency node or reference a current compiler certificate from the handoff; otherwise remove the candidate. |
| `candidate_premise_*_invalid` | Use the exact residual-premise fingerprint returned by the guard. Correct the dependency target or reference a current matching certificate; do not invent certificate IDs or relabel a residual premise as local evidence. |
| `recommended_action: repair_plan_route` | Preserve the current semantic DAG: keep node targets, edges, dependencies, and the leaf set fixed. Change only the candidate lemma, its mechanically distinct instantiation, or the audited source of a residual premise. |
| `recommended_action: repair_plan_metadata` | Correct deterministic node IDs, edge endpoints, dependency anchors, or duplicate schema entries without changing the semantic targets or dependency structure. This does not consume a semantic DAG revision. |
| `recommended_action: revise_semantic_dag` | Submit a materially different dependency/target structure only when the current plan has a structural hard error. The initial plan plus at most four materially distinct revisions is the bounded semantic search space. |
| `recommended_action: stop_and_report_best_plan` | Do not submit another semantic DAG or disguise one through metadata changes. Report the best rejected plan and its exact hard errors. |
| `proof_transaction_stale_view` | Re-read the staged region and build a new patch against the current revision. |
| `proof_transaction_scope_rejection` | Shrink the patch to the authorized theorem body or proof region and preserve its markers and surrounding source. |
| `session_state_desync` | Stop submitting tactics, reopen the assigned region-scoped session, and verify the goal fingerprint before continuing. |
| `progress_level: debug` | Keep the draft for diagnosis, but do not treat it as route validation or accepted proof progress. |
| recoverable transaction | Use the active recovery baseline. If `recovery_base` is `best_certified`, continue there while preserving the newer unaccepted draft in the journal; otherwise continue from the current staged draft. |

## Generic Route Recipe

Use this only as a soft planning prior:

1. Prepare definitions and local context needed by later facts.
2. Establish a semantic or pointwise bridge.
3. Normalize the data, collection, or library-facing proof shape.
4. Aggregate or compose established facts.
5. Close the final logical or arithmetic step.

Reorder, merge, replace, or abandon these layers when the live goal, hypotheses, premise audit, or compiler evidence supports a better route. Never turn a successful trace into a theorem-specific lemma list, variable naming scheme, or tactic script.

## Region Granularity

Prefer roughly 3-6 meaningful first-level regions, commonly 4-5, without treating the count as a guard condition. Keep several local rewrites, arithmetic steps, or helper facts together when they establish one exported fact under one dependency boundary. Split only for independent semantic layers, missing dependencies, cross-branch ownership, or repeated semantic/compiler failure. Merge adjacent tactic-sized leaves that share hypotheses and have no useful independent certificate.

## Candidate Roles And Scheduling

Set each structured library candidate to `direct_apply`, `rewrite`, `transport`, `local_fact`, or `automation_hint`. Only `direct_apply` is expected to unify with the complete node target and expose residual premises during planning; other roles are checked for availability and validated at their concrete proof use. Follow the runtime's dependency-ready region selection: declared producer regions must be compiler-certified, while file order is only a tie-breaker among ready regions.

## Workflow

1. Read the complete guard payload, including fingerprints, missing premises, transaction revision, and recommended action.
2. Preserve the active transaction baseline, every compiler-certified fragment, and any newer unaccepted draft recorded by revision/hash.
3. Change only the route, premise mapping, proof state, or edit scope identified by the guard.
4. Re-read after stale-view or desynchronization errors instead of replaying an old edit or tactic.
5. Validate the new staged revision with the narrowest suitable `coq_session`, checkpoint, or `coqc` certificate.
6. If the guard omits the evidence needed to choose a legal recovery, report the missing field instead of inventing a free-form override.

The skill supplies stable recovery policy only. Runtime prompts must provide concrete transaction IDs, revisions, hashes, goal fingerprints, failure IDs, and premise fingerprints.
