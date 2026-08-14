---
name: by-expansion-diagnostics
description: 'Debug Coq and ssreflect `No applicable tactic` failures that arise on `by ...` lines by removing `by`, exposing the remaining goals, and treating the first revealed proof state as the real error signal. Use when a compact `by rewrite`, `by apply:`, `have ... by ...`, or `case ...; by ...` script hides whether the failure is a rewrite mismatch, a missing assumption, or an unexpected branch split.'
argument-hint: 'Describe the failing `by ...` line, the current goal, and the first message after expanding it.'
user-invocable: true
---

# By Expansion Diagnostics

## When to Use
- Coq reports `No applicable tactic` on a line that starts with `by` or ends in a compressed `...; by ...` tail.
- A large model reacts to the flat error by trying random rewrites or lemma applications.
- You do not know whether the real failure is a rewrite mismatch, a missing assumption, or an extra branch.
- The failing line is a short script such as `by rewrite ...`, `by apply: ...`, `have H : P by ...`, or `case E: x; by ...`.

## Core Rule
Treat `by` as a proof-state compressor, not as a diagnostic tactic.

When `by ...` fails, do not immediately try other tactics. Remove `by`, rerun the exact payload, and inspect the first revealed proof state. That first revealed state is the real debugging signal.

## Why `by` Hides the Useful Error
`by tac.` means: run `tac` and close every resulting goal immediately.

If `tac` does any of the following,
- leaves one goal unsolved,
- opens two or more goals,
- rewrites the wrong normal form,
- applies a lemma with mismatched premises,

then Coq often reports only `No applicable tactic` at the compressed line.

After expansion, the hidden signal usually becomes one of these:
- a concrete remaining goal,
- `Expected a single focused goal but 2 goals are focused.`,
- `The LHS of ... does not match any subterm of the goal.`,
- `Cannot apply lemma ...`,
- `No assumption in ...`.

That specific message is what you should debug, not the original flat `by` failure.

## Required Procedure
1. Freeze the exact failing line.
   - Copy the `by ...` line exactly.
   - Do not rewrite its payload yet.
2. Expand only that one compression boundary.
   - Remove `by`.
   - Keep the original tactic payload unchanged.
3. Re-run immediately.
   - Record the first new message.
   - Record the number of focused goals.
4. Classify the revealed signal.
   - One remaining goal: the compressed script was incomplete.
   - More than one goal: the payload split the proof and needs bullets or braces.
   - Rewrite mismatch: the current goal shape does not match the intended lemma.
   - Apply or intro mismatch: the theorem head, premises, or view pattern is wrong.
5. Only then choose the next repair.
   - If branches appeared, fix proof structure first.
   - If a rewrite mismatch appeared, debug the exact goal syntax.
   - If a premise mismatch appeared, inspect the theorem application.
6. Re-compress back to `by` only after the expanded script actually closes all goals.

## Expansion Templates

### Plain `by rewrite`
Original:

```coq
by rewrite L1 L2 L3.
```

Expand to:

```coq
rewrite L1 L2 L3.
```

Do not change the rewrite list until you see which exact rewrite fails or what goal remains.

### Plain `by apply:`
Original:

```coq
by apply: some_lemma.
```

Expand to:

```coq
apply: some_lemma.
```

Now inspect whether Coq exposed missing premises, extra subgoals, or an application mismatch.

### `have ... by ...`
Original:

```coq
have H : P by tac.
```

Expand to:

```coq
have H : P.
{
  tac.
}
```

This isolates the local proof and prevents drift into the outer proof.

### `suff ... by ...`
Original:

```coq
suff H : P by tac.
```

Expand to:

```coq
suff H : P.
- tac.
```

Then inspect the newly exposed sufficiency goal separately.

### `case ...; by ...`
Original:

```coq
case E: x; by tac.
```

Expand to:

```coq
case E: x.
- tac.
- tac.
```

If the branches are not symmetric, the expansion will show which branch actually needs a different proof.

## First Revealed Error -> Real Cause
- `Expected a single focused goal but 2 goals are focused.`
  The payload opened branches. This is a structure problem, not a math problem.
- `The LHS of ... does not match any subterm of the goal.`
  The chosen rewrite does not literally fit the current goal shape.
- `Cannot apply lemma ...`
  The theorem head or expected premise shape is wrong.
- `No assumption in ...`
  An intro pattern, view pattern, or moved hypothesis does not exist in the current context.
- A concrete goal remains with no special error.
  The original `by` was simply too optimistic. Read and solve that goal directly.

## Examples

### Example 1: `by` Hides a Rewrite Mismatch
Compressed script:

```coq
by rewrite big_const_ord iter_addn mul1n.
```

Expand to:

```coq
rewrite big_const_ord iter_addn mul1n.
```

What this often reveals:
- `mul1n` does not match because the goal is still in `iter` form.
- Or the multiplication appears as `n * x`, not `1 * x`.

Correct reaction:
- Stop guessing.
- Read the exact intermediate goal after `big_const_ord` and `iter_addn`.
- Decide whether you need a bridge lemma or a different arithmetic normal form.

### Example 2: `by apply:` Hides Missing Premises
Compressed script:

```coq
by apply: leq_trans.
```

Expand to:

```coq
apply: leq_trans.
```

What this often reveals:
- two ordinary comparison goals,
- or a missing middle bound that was never named.

Correct reaction:
- Prove or name the intermediate inequality.
- Do not swap in a different lemma until you read the actual subgoals.

### Example 3: `have ... by ...` Hides an Incomplete Local Proof
Compressed script:

```coq
have PENDING0 : forall t, a0 <= t < a0 + R -> pending job_arrival job_cost sched j0 t by
  move=> t /andP [GE LT]; apply/andP; split.
```

Expand to:

```coq
have PENDING0 : forall t, a0 <= t < a0 + R -> pending job_arrival job_cost sched j0 t.
{
  move=> t /andP [GE LT].
  apply/andP; split.
}
```

What this reveals:
- the first conjunct may be solved,
- the second conjunct still needs a backlog or completion argument.

Correct reaction:
- Finish the exposed second conjunct.
- Do not invent a new helper lemma before reading that exact missing goal.

### Example 4: `case ...; by ...` Hides Branch Asymmetry
Compressed script:

```coq
case E: (service_at sched j0 t) => [|k] /=; by rewrite add0n.
```

Expand to:

```coq
case E: (service_at sched j0 t) => [|k] /=.
- rewrite add0n.
- rewrite add0n.
```

What this reveals:
- the zero branch may close,
- the successor branch may need a different argument entirely,
- or Coq may complain about multiple focused goals if bullets were missing.

Correct reaction:
- manage the branches explicitly,
- then solve each branch from its own goal shape.

## What To Do After Expansion
- If expansion reveals multiple goals, switch to the goal-count and bullet discipline in `skill_goal.md`.
- If expansion reveals a rewrite mismatch, debug the literal goal shape as in `.github/skills/coq-proof-state-discipline/skill_math.md`.
- If expansion reveals theorem-application ambiguity before ordinary goals appear, switch to early-bound argument diagnosis instead of adding random premises.

## Anti-Patterns
- Do not respond to a failing `by` by trying three other rewrite lists first.
- Do not remove `by` and simultaneously change the tactic payload. Expand first, then inspect.
- Do not expand the whole proof at once. Expand one compression boundary at a time.
- Do not leave `have H : P.` floating inline when its local proof can drift. Use braces.
- Do not compress back to `by` until the expanded form is known to close every resulting goal.

## Minimal Debug Log

```text
Failing compact line:
Expanded form:
First revealed message:
Focused goal count after expansion:
Did the payload split goals: yes/no
Real problem class: rewrite mismatch / missing premise / extra branch / incomplete local proof
Next repair chosen from revealed signal:
```

## Success Condition
This skill has worked when the flat `No applicable tactic` has been replaced by a specific, local proof-state diagnosis, and the next tactic is chosen from that diagnosis instead of from blind trial and error.

If the expanded form closes the proof cleanly, then and only then is it reasonable to compress it back into `by`.