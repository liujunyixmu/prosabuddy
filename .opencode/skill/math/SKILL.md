---
name: coq-proof-state-discipline
description: 'Debug Coq and ssreflect proofs by following the exact proof state, choosing rewrites only when their left-hand side literally matches the goal, and adding small bridge lemmas for bigop, iter, and multiplication mismatches. Use when rewrites fail, big_const_ord or big_distrr are involved, or a proof seems mathematically obvious but Coq reports that the lemma does not match any subterm.'
argument-hint: 'Describe the goal, the failed rewrite, and the current goal shape.'
user-invocable: true
---

# Coq Proof-State Discipline

## When to Use
- A rewrite should work mathematically, but Coq rejects it.
- A proof oscillates between `\sum_`, `iter`, addition, and multiplication forms.
- `mul1n`, `mulnC`, `big_ord_recr`, or `big_const_ord` fail with “does not match any subterm”.
- You need a small bridge lemma between a local goal shape and the intended algebraic form.
- A large model is proposing steps from intuition instead of from the literal current goal.

## Core Rule
Choose the next lemma from the exact current goal syntax, not from mathematical intent alone.

If the left-hand side of the next lemma is not a literal subterm of the current goal, do not rewrite yet. First normalize one side or add a bridge lemma.

## Procedure
1. Snapshot the exact goal.
   - Quote the full goal or the smallest relevant subterm.
   - Record the head form: `bigop`, `iter`, `addn`, `muln`, or boolean-as-nat.
2. Name the intended rewrite.
   - Write the lemma you want to use.
   - Write its exact left-hand side.
3. Run the shape check.
   - Ask whether that left-hand side occurs syntactically in the current goal.
   - If the answer is no, stop and choose a bridge step instead.
4. Add the smallest bridge lemma that fixes the mismatch.
   - Prefer a local lemma when the mismatch is specific to a fixed variable, branch, or index.
   - Prefer a generic lemma only when the same mismatch recurs across proofs.
5. Normalize inside-out.
   - First settle constant or boolean-valued inner sums.
   - Then distribute or factor outer sums.
   - Use arithmetic rewrites such as `mulnC` only after multiplication is literally present.
6. Validate after each nontrivial rewrite.
   - Re-read the new goal head form.
   - If the goal moved from `bigop` to `iter`, update the plan before continuing.
7. Keep one stable normal form.
   - Avoid oscillating between `\sum_(i < n) x`, `iter n (addn x) 0`, `x * n`, and `n * x` in the same branch.

## Bridge Lemma Strategy

### Prefer a local bridge lemma when
- The expression depends on a fixed local variable such as `t`, `cpu`, or a branch condition.
- A boolean-valued term becomes a constant over an index.
- The proof only needs the lemma once.

Template:

```coq
have cpu_sum_of_backlogged t :
  \sum_(cpu < num_cpus) (backlogged job_arrival job_cost sched j t) =
  backlogged job_arrival job_cost sched j t * num_cpus.
Proof.
  by case: (backlogged job_arrival job_cost sched j t);
     rewrite big_const_ord ?iter_addn ?mul1n ?mul0n ?addn0.
Qed.
```

### Prefer a generic bridge lemma when
- The same normalization gap appears in multiple proofs.
- The goal has already become a literal constant sum.

Template:

```coq
Lemma big_const_ord_muln n x :
  \sum_(i < n) x = x * n.
Proof.
  by rewrite big_const_ord iter_addn mulnC.
Qed.
```

More ready-to-copy templates are in [bridge-lemma-templates](./assets/bridge-lemma-templates.v).

## Bigop Endgame Discipline
For ssreflect big operator proofs, use this order.

1. Exchange or rearrange sums only while the goal is still clearly a big operator.
2. Collapse branch-local constant sums.
3. Introduce local bridge lemmas for boolean-as-nat constants.
4. Use `big_distrr` or similar outer distribution only after inner normalization is stable.
5. Use algebraic rewrites such as `mulnC` only when multiplication is literally present.

## When To Switch To Count Bridging
This skill handles generic big-operator, `iter`, and multiplication mismatches.

If the branch has clearly become a counting proof, switch to [ssreflect-count-bridging](./skill_count.md) instead of staying here.

High-signal cues for switching:
- the branch mixes `big_mkcond`, `sum1_count`, `big_filter`, `count`, and `Nat.min` or `minn`
- the same quantity appears both as `if P x then 1 else 0` and as a `count`
- the endgame is no longer a pure big-operator identity, but a bound on how many elements satisfy a predicate
- the next intended theorem lives in the `count` or `min` layer rather than in the generic `bigop` or `iter` layer

Use this generic skill only up to the point where the proof class is clear. Once the branch is really about indicator-sum to count normalization, the count-bridging skill has the stricter pipeline.

## Side-Specific Normalization
Sometimes the cleanest fix is to rewrite only one side into the other side’s syntax.

Example:

```coq
rewrite [in RHS]-big_const_ord.
```

Use this when the goal is naturally a big operator and forcing the other side into multiplication would create an unstable `iter` intermediate.

## Common Failure Signatures
See [failure-signatures](./references/failure-signatures.md) for a mapping from common error messages to the missing normalization step.

Short version:
- `Unable to unify "X * n" with "iter n (addn X) 0"` means the goal is still in `iter` form.
- `The LHS of mul1n ... does not match any subterm` means there is no literal `1 * _` yet.
- `The LHS of mulnC ... does not match any subterm` means there is no multiplication node yet, or not the one you think.
- `The LHS of big_ord_recr ... does not match any subterm` means the goal is no longer a standard ordinal big operator head.
- `No applicable tactic` after several rewrites usually means the proof drifted across multiple normal forms without a stable bridge.

If the branch now mentions `big_mkcond`, `sum1_count`, filtered sums of ones, or `count` bounds, stop here and switch to [ssreflect-count-bridging](./skill_count.md). That is no longer a generic bigop mismatch; it is a counting-normalization proof.

## Anti-Patterns
- Do not rewrite because two expressions are mathematically equal if the target lemma does not literally match the goal.
- Do not chain `big_const_ord`, `iter_addn`, `mul1n`, and `mulnC` blindly without checking the intermediate goal.
- Do not use a generic arithmetic lemma when a branch-local bridge lemma is simpler and more robust.
- Do not switch normal forms repeatedly inside one proof branch.

## Minimal Debug Log
Keep a short log while debugging.

```text
Current goal subterm:
Desired lemma:
Lemma left-hand side:
Literal match in goal: yes/no
If no, bridge lemma or normalization step:
Resulting goal head form:
```

## Success Condition
The proof is on track when each rewrite is justified by a literal syntactic match, and every bridge lemma moves the branch toward a single stable normal form instead of introducing another oscillation.