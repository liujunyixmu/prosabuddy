---
name: rocq-proof-methodology
description: Use for general Rocq/Coq proof development and recovery when the blocker is a goal-state, tactic, typing, focus, rewrite, or incomplete-proof issue and no narrower domain skill already explains it.
---

# Rocq Proof Methodology

Use this skill as a compact recovery loop, not as a second copy of the agent's proof policy. Prefer a narrower skill when the diagnostic already identifies a specific pattern such as goal focus, `by` expansion, failed lemma application, count/bigop bridging, or a known Prosa construction.

## Core loop

1. Read the exact current goal and hypotheses from the live proof state.
2. Fix the first reliable error only: syntax/structure, then typing/unification, then tactic failure or unfinished goals.
3. Make one small proof-producing step or edit.
4. Re-run the smallest relevant goal/checkpoint validation.
5. Persist a validated step in the proof file or roll back only its failing tail.

Do not respond to a failed step with an unrelated broad search. A targeted lookup is justified when the current goal or compiler error names the missing definition, lemma shape, instance, or premise; use its result in the next proof attempt.

## Scope and proof integrity

- Keep edits inside the currently owned theorem or proof_region.
- Preserve compiler-certified prefixes and current transaction state.
- Do not introduce `Axiom`, `Parameter`, `Hypothesis`, `Variable`, `admit`, or `Admitted.` as a proof substitute. A runtime-authorized temporary skeleton is not final success.
- Do not change theorem assumptions or declarations to make the proof easier.
- Close a benchmark proof only with a real compiling `Qed.` (or `Defined.` when transparency is intentionally required).

## Goal and branch discipline

- Inspect the goal after a tactic that rewrites, applies a lemma, introduces a local fact, or changes branches.
- Use bullets or `{ ... }` to isolate multiple focused goals. Repair focus/brace structure before changing semantic tactics.
- If a compressed `by ...` hides the failure, expand only that boundary and inspect the first revealed goal.
- For dependent rewrite errors, first consider `subst` for a variable equality, or revert/generalize dependent hypotheses before rewriting.

## Choosing the next step

Choose tactics from the actual goal shape; this is guidance, not a mandatory route:

- definitional equality: `reflexivity`, `cbn`, or a small unfold;
- available hypothesis or constructor: `exact`, `assumption`, `apply`, `constructor`, `split`, `left`, `right`;
- equality transport: `rewrite`, `subst`, `f_equal`, `congruence`;
- local bridge: `have`, `assert`, `suff`, `pose proof`, or `set`;
- arithmetic: use the imported solver appropriate to the domain, such as `lia` or `ring`;
- bounded search: `auto n` or `eauto n` only when the relevant hint database and premises are understood.

Do not use ssreflect repeat-rewrite syntax `rewrite !...` or `rewrite -!...` in this environment. Do not use `intuition`; construct the logical steps explicitly.

## Candidate lemma audit

Before committing to an imported lemma:

1. inspect its exact type;
2. unify its conclusion with the live target;
3. list the remaining premises and implicit instances;
4. check whether each premise follows from current hypotheses or an already certified local bridge;
5. abandon or change the instantiation when a required premise is unavailable.

A verified failed lemma/missing-premise route must not be repeated through cosmetic edits or an `admit_id` rename. It may be reconsidered after a new hypothesis is derived, the missing premise is compiled, the instantiation genuinely changes, or the audit is shown wrong.

## Completion check

Before reporting success, verify:

- the current owned goal is closed;
- no proof placeholder remains in the owned theorem;
- the authoritative staged revision, not an older disk copy, passes checkpoint/coqc;
- all opened branches and local assertions are closed;
- the final theorem terminator is correct for the assigned ownership layer.

If the proof still fails, return the exact stable goal/error, the smallest failed step, missing premises, and which certified prefix remains reusable.
