---
name: ssreflect-count-bridging
description: 'Handle ssreflect and MathComp proof branches where the same quantity appears as an indicator sum, a filtered big operator, a count, and then a min-bound or arithmetic inequality. Use when `big_mkcond`, `sum1_count`, `big_filter`, `count`, `Nat.min` or `minn`, or `if ... then 1 else 0` appear together and rewrites keep failing because the branch has no stable counting normal form.'
argument-hint: 'Describe the current indicator or count shape, the target equality or inequality, and the first failed rewrite or bridge step.'
user-invocable: true
---

# Ssreflect Count Bridging

## When to Use
- A branch mixes `\sum_`, `big_filter`, `big_mkcond`, `sum1_count`, `count`, and `Nat.min` or `minn`.
- The current term is an indicator sum such as `if P x then 1 else 0`, but the intended lemma is about `count`.
- The proof is trying to bound how many elements satisfy a predicate and then feed that bound into a strict inequality or a `min` bound.
- The same quantity is being rewritten back and forth as a filtered sequence, a filtered big operator, and a raw count.
- A large model keeps proposing arithmetic or transitivity steps before the counting shape is stable.

## Core Rule
For this proof class, choose one counting normal form and move toward it monotonically.

Do not jump directly from an indicator sum to a `min` inequality or a final arithmetic step. First normalize the branch into one stable representation, usually:

1. indicator sum
2. filtered big operator
3. count
4. arithmetic or `min` bound

If the next theorem is a theorem about `count`, normalize to `count` first. If the next theorem is a theorem about big operators, stay in filtered big-operator form. Do not oscillate between both.

## High-Signal Surface Cues
This skill is likely the right one if the failing branch contains several of these at once:

- `big_mkcond`
- `sum1_count`
- `big_filter`
- `count`
- `filter`
- `Nat.min` or `minn`
- `if P x then 1 else 0`
- local names like `count_exceeding`, `other_tasks`, `rest_tasks`, or similar “count selected elements of a remainder list” helper facts

One cue alone is not enough. The class appears when the same quantity is drifting across these different shapes.

## Normal-Form Decision
Before rewriting, answer this first:

- Is the endgame a count theorem, a cardinality theorem, or an arithmetic inequality about how many elements satisfy a predicate?
- Or is the endgame still a big-operator identity?

If the endgame is about how many elements satisfy a predicate, prefer this target normal form:

```text
count P s
```

If the endgame is still a summation theorem, prefer this target normal form:

```text
\sum_(x <- s | P x) 1
```

Once chosen, keep the whole branch moving toward that form only.

## Required Procedure
1. Freeze the branch and name the current shape.
   - indicator sum
   - filtered big operator
   - count
   - `min` or arithmetic layer
2. Decide the target normal form.
   - If the next useful fact is about `count`, normalize toward `count`.
   - If the next useful fact is about big operators, normalize toward filtered big operators.
3. If the branch still contains `if P x then 1 else 0`, remove the indicator encoding first.
   - Use `big_mkcond` or an equivalent bridge step to expose the predicate as a filter condition.
4. If the branch is now a filtered sum of ones, collapse it to a count.
   - Use `sum1_count` or an equivalent local bridge fact.
5. Only after the count shape is stable should you apply list-splitting, subset, or `min` lemmas.
6. Only after the count bound is stable should you perform the final arithmetic step.
   - Keep boolean comparisons and Prop arithmetic separate until you explicitly bridge them.
7. If the branch needs a local connector fact, name it and keep it local.
   - Prefer a named connector fact over a brittle inline `have ->` chain.

## Canonical Bridge Order
Preferred bridge sequence:

```text
\sum_(x <- s) (if P x then 1 else 0)
  ->
\sum_(x <- s | P x) 1
  ->
count P s
  ->
bound on count P s
  ->
bound on Nat.min / minn / final arithmetic expression
```

The hard rule is: do not skip a bridge when the next lemma lives in a different layer.

## Bridge Templates

### Template 1: Indicator Sum To Filtered Big Operator
Use this when the branch still hides the predicate in `if ... then 1 else 0`.

```coq
have H_indicator_filter :
  \sum_(x <- s) (if P x then 1 else 0) = \sum_(x <- s | P x) 1.
(* Prove this local fact immediately with big_mkcond or the equivalent
   branch-local rewrite; do not leave a placeholder proof. *)
```

### Template 2: Filtered Ones Sum To Count
Use this when the branch is already a filtered sum of ones.

```coq
have H_filter_count :
  \sum_(x <- s | P x) 1 = count P s.
(* Prove this local fact immediately with sum1_count or a branch-local variant;
   do not leave a placeholder proof. *)
```

### Template 3: Count Bound Before Min Bound
Use this when the final statement mentions `Nat.min` or `minn`.

```coq
have Hcount_bound : count P s <= k.
Proof.
  ...
Qed.

have Hmin_bound : Nat.min m (count P s) <= Nat.min m k.
Proof.
  ...
Qed.
```

Do not try to prove the `Nat.min` statement while the branch is still in indicator-sum form.

## Local Connector Fact Policy
For this proof class, local connector facts are usually better than long inline rewrites.

Preferred names:

- `H_indicator_filter`
- `H_filter_count`
- `Hcount_rest_tasks`
- `Hcount_exceeding_bound`
- `Hmin_count_bound`

Avoid a long script that repeatedly changes representation without naming the bridge.

## Bool / Prop Separation
These branches often have a second failure mode after the counting shape is already stable. The branch is no longer stuck on `big_mkcond` or `sum1_count`, but it still fails because it keeps switching between:

- boolean comparison and ssreflect reflection
- Prop-level arithmetic needed for `lia`, `Nat.min`, or the final strict inequality

This section covers only the count-branch version of that problem. Use it when the branch is already about `count`, `Nat.min` or `minn`, or a final arithmetic inequality derived from a count bound. If the branch is still drifting between indicator sum, filtered big operator, and count, finish that normalization first.

### Problem Shape
Typical sequence:

1. The proof establishes a boolean fact such as `count P s < k`, `count P s <= k`, or `0 < x`.
2. The next step needs Prop arithmetic, a `Nat.min` side condition, or a contradiction argument.
3. The script bounces among `ltnW`, `ltnNge`, `move/ltP`, `move/leP`, `%coq_nat`, and `lia` without committing to one layer.
4. The final arithmetic step fails even though the count argument is already essentially done.

The root cause is not that one specific lemma is missing. The branch crossed the bool/Prop boundary without deciding which layer should own the rest of the proof.

### Boundary Rule
Once the branch has a stable `count` or `Nat.min` expression, decide whether the rest of the branch should finish in:

- ssreflect boolean comparison form
- Prop arithmetic form

If the remaining work is final arithmetic, `Nat.min` side conditions, or `lia`, move to Prop exactly once and stay there until that subproof closes. Do not alternate between boolean reflection and Prop arithmetic after the handoff.

### Layer Map
Use this rough split.

- bool layer
  - `count P s < k`
  - `count P s <= k`
  - `ltnW`
  - `ltnNge`
  - boolean rewriting and reflection views
- Prop layer
  - `(count P s < k)%coq_nat`
  - `(count P s <= k)%coq_nat`
  - `lia`
  - `have -> : Nat.min a b = ... by lia`
  - contradictions and transitivity using ordinary `<`, `<=`, or `=` hypotheses

`ltnW` is usually a bool-side preparation step. Use it before the Prop handoff if you need a non-strict boolean fact.

### One-Way Handoff Protocol
1. Finish count normalization first.
   - The branch should already be in `count`, plain nat arithmetic, or `Nat.min` form.
2. Isolate the last boolean fact you need.
   - Typical examples: `Hcount_lt : count P s < k`, `Hcount_le : count P s <= k`, `Hpos : 0 < x`.
3. Convert that fact into Prop exactly once.
   - `move/ltP: Hcount_lt => Hcount_lt_prop.`
   - `move/leP: Hcount_le => Hcount_le_prop.`
4. Finish the remaining arithmetic entirely in Prop.
   - Use `lia`.
   - Rewrite `Nat.min` only after the side condition is already a Prop inequality.
5. Reflect back only if the final goal itself is a boolean comparison.
   - `apply/ltP. exact Hgoal_prop.`
   - `apply/leP. exact Hgoal_prop.`

### Common Local Bridges
Use small local connectors rather than bouncing back and forth across the boundary.

- strict to non-strict on the bool side
  - `have Hle_bool : a <= b by exact: ltnW Hlt_bool.`
- bool to Prop
  - `move/ltP: Hlt_bool => Hlt_prop.`
  - `move/leP: Hle_bool => Hle_prop.`
- Prop back to a final bool goal
  - `apply/ltP. exact Hlt_prop.`
  - `apply/leP. exact Hle_prop.`

Do not use these bridges as an open-ended rewrite loop. Use them once to transfer ownership of the branch.

### Template 4: Count Bound To Prop Arithmetic
Use this when the count bound is done and only arithmetic remains.

```coq
have Hcount_lt : count P s < k.
Proof.
  ...
Qed.

have Hcount_lt_prop : (count P s < k)%coq_nat.
Proof.
  by move/ltP: Hcount_lt.
Qed.

have Hgoal_prop : (count P s < k + 1)%coq_nat.
Proof.
  lia.
Qed.

have Hgoal : count P s < k + 1.
Proof.
  apply/ltP.
  exact Hgoal_prop.
Qed.
```

### Template 5: Prop Side Condition For Nat.min
Use this when the count bound is already known, but `Nat.min` needs a Prop side condition.

```coq
have Hcount_le : count P s <= k.
Proof.
  ...
Qed.

have Hcount_le_prop : (count P s <= k)%coq_nat.
Proof.
  by move/leP: Hcount_le.
Qed.

have -> : Nat.min (count P s) k = count P s by lia.
```

If you prefer `PeanoNat.Nat.min_l` or `PeanoNat.Nat.min_r`, discharge the side condition only after it is already in Prop form.

### Contradiction Pattern With `ltnNge`
Use `ltnNge` as a boundary-specific contradiction tool, not as a general rewrite strategy.

```coq
rewrite ltnNge.
apply/negP => /leP Hge_prop.
lia.
```

This is appropriate when the goal is a boolean strict inequality and the contradiction should finish in Prop arithmetic.

### Boundary Failure Signs
The boundary was crossed at the wrong time if:

- `lia` sees no usable arithmetic hypotheses because all comparisons are still boolean facts.
- `Nat.min` or `minn` side conditions do not discharge because the branch still only has `ltn` or `leq` facts.
- the script proves a Prop inequality, immediately reflects it back to bool, then needs to move back to Prop again.
- the count argument is complete, but the strict inequality still fails because the branch never committed to one final layer.

## Failure Signatures For This Skill
- `The LHS of big_mkcond ... does not match any subterm`
  The branch is not yet in the expected indicator-sum head form.
- `The LHS of sum1_count ... does not match any subterm`
  The branch is not yet a filtered sum of ones.
- `Unable to unify ... count ... with ... \sum_ ...`
  The count bridge has not been established yet.
- `No applicable tactic` after several bigop rewrites in a count argument
  The proof is drifting across indicator, filter, and count forms without a stable target.
- A strict inequality fails after a count argument “should already be done”
  The arithmetic step is too early; the count layer or the bool-to-Prop bridge is not finished.

## Anti-Patterns
- Do not feed an indicator sum directly to a count lemma.
- Do not apply `Nat.min` or `minn` lemmas before the raw count expression is stable.
- Do not bounce between filtered sequence form and count form without naming the connector fact.
- Do not start the final strict inequality proof while the branch still contains `if ... then 1 else 0`.
- Do not call `lia` while the main inequalities still only exist as `ltn` or `leq` facts.
- Do not reflect back to bool in the middle of a Prop arithmetic subproof.
- Do not use `ltnW` after the branch has already moved into Prop unless you are deliberately rebuilding a final bool goal.
- Do not rewrite `Nat.min` or `minn` while the only available side condition is still in boolean form.
- Do not encode theorem-local names such as `Hsum_slack` or `Hsum_succ` into the skill. Keep the skill at the proof-pattern level.
- Do not use this skill for focus drift or early-bound theorem application failures. Those are different problem classes.

## Minimal Debug Log

```text
Current counting shape:
Target normal form:
Next intended lemma:
Does that lemma live in indicator / filtered bigop / count / min-arithmetic layer:
Missing bridge step:
Named local connector fact:
Is the final arithmetic step still premature: yes/no
```

## Success Condition
This skill has worked when the branch stops oscillating between indicator sums, filtered big operators, counts, and `min` bounds, and every subsequent step stays inside one chosen counting normal form until the final arithmetic handoff.
