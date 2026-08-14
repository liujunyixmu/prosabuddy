---
name: goal-focus-discipline
description: 'Handle Coq and ssreflect proof-state drift by checking the current number of goals after every tactic that can split or close goals, using bullets to manage branches, and proving any have-generated sublemma inside braces before returning to the main line.'
argument-hint: 'Describe the current goal count, the previous tactic, and the branch or sublemma that introduced the drift.'
user-invocable: true
---

# Goal Focus Discipline

## When to Use
- Coq reports `Expected a single focused goal but 2 goals are focused.`
- A proof used to have one main line, then `case`, `have`, `apply/negP`, `split`, or `destruct` was added and later tactics stopped fitting.
- The model starts adding extra lemmas instead of first checking whether the proof state already drifted.
- A local fact such as `PENDING0` or `SLOT_BOUND` is introduced, and later tactics behave as if the main goal were still the only goal.
- The focus error appears right after `case` or another boolean split, but the split target may still be hidden under a named definition or wrapper.
- A branch "looks done" because the last line rewrote a local hypothesis, but the enclosing goal was never explicitly discharged.

## Core Rule
Do not choose the next tactic from proof intent alone. First check how many goals exist now, and whether the previous tactic opened or closed any goal.

If there is more than one goal, switch to bullet management immediately. Do not continue with a single-goal script.

If `have` is used to introduce a lemma, prove it inside `{ ... }` and return only after that local proof is closed.

If a `case`, `destruct`, or reflected boolean split targets a term that is still hidden under a named definition, unfold first. Otherwise the split can create branches without actually changing the enclosing goal.

If the last useful line of a branch only rewrites inside a local hypothesis, do not assume the branch is closed. Explicitly consume that hypothesis with `exact`, `apply`, or `exfalso; exact:` if it is meant to close the enclosing goal.

When the visible script structure and the live proof state disagree, trust the live proof state. Do not keep editing as if braces, bullets, or a finished-looking `have` block had already restored focus.

If the current focused goal count is not exactly one, the next step is a recovery step, not a math step.

Recovery-step whitelist when the goal count is not exactly one:
- inspect the current goals
- introduce or finish bullets
- close the current `{ ... }` subproof
- return to the parent branch
- abort and restart a noisy exploratory branch

Until focus returns to exactly one intended goal, do not:
- add a new `have`, `suff`, or helper lemma
- attempt a new `rewrite`, `apply`, `exact`, or arithmetic step for the outer theorem
- treat downstream messages such as missing hypotheses, reused names, or failed lemma applications as the main problem

Errors such as `Cannot apply lemma ...`, `No such goal`, `... already used`, and `The variable ... was not found` are often secondary effects of proof-state drift once multiple goals are live. Do not repair them before restoring focus.

## Required Procedure
1. Read the current proof state before the next step.
   - Record the exact number of focused goals.
   - Record the shape of the current goal.
2. Inspect the previous tactic.
   - Did it split the proof into branches?
   - Did it create a local subgoal?
   - Did it close a branch?
3. Inspect the literal goal head before any new split.
  - If the next `case`, `destruct`, or reflection step targets a term hidden under a definition, unfold first.
  - Do not split on mathematical intent alone. Check whether the split target literally occurs in the current goal or active hypothesis.
4. If the goal count changed, respond structurally, not mathematically.
   - New branch: introduce a bullet.
   - Local lemma from `have`: open `{ ... }`, finish it, then return.
   - Closed branch: verify that focus returned to the intended outer goal.
5. When a branch seems finished, verify that the last line actually discharged the enclosing goal.
  - Rewriting inside `Hlt_succ`, `Hdone`, or another local fact is not the same as closing the branch.
  - If the branch should end from that fact, finish with `exact`, `apply`, or `exfalso; exact:`.
6. Only after focus is stable should you pick the next rewriting or reasoning step.
7. Do not add bridge lemmas, arithmetic lemmas, or helper facts just to avoid a focus problem. Fix the branch structure first.

## Hidden Goal Head Before Case Split
This is a common local cause of fake branch progress.

Pattern:

- the goal is a named wrapper such as `job_misses_no_deadline j`
- the script does `case Hdone: (completed ...)`
- the first branch ends with `by []`
- the second branch later reports `Expected a single focused goal but 2 goals are focused.`

What happened:

- the split target was not yet the literal head of the goal
- the `case` created branches, but did not rewrite the enclosing goal the way the script expected
- the first branch did not truly close, even if it looked trivial

Hard rule:

- before splitting a boolean goal, check whether the boolean expression is literally present in the current goal head
- if the head is still a wrapper definition, unfold first

Preferred repair:

```coq
rewrite /job_misses_no_deadline.
apply/negP => Hnot_done.
...
```

Acceptable repair if you still want a split:

```coq
rewrite /job_misses_no_deadline.
case Hdone: (completed job_cost sched j (job_arrival j + job_deadline j)).
- by rewrite Hdone.
- have Hnot_done : ~~ completed job_cost sched j (job_arrival j + job_deadline j).
   by rewrite Hdone.
  ...
```

Do not write `case Hdone: ...` against a hidden goal head and then trust `by []` to close the first branch.

## Explicit Branch Closure Rule
A branch is not closed just because its last line simplified a local hypothesis.

Typical bad shape:

```coq
have Hlt_succ : x < n + 1.
{
  ...
}
by rewrite addn1 in Hlt_succ.
```

This rewrites `Hlt_succ`, but it may not consume it to solve the enclosing goal `x <= n`.

Preferred repair:

```coq
have Hlt_succ : x < n + 1.
{
  ...
}
rewrite addn1 ltnS in Hlt_succ.
exact: Hlt_succ.
```

Contradiction branches should also close explicitly:

```coq
exfalso.
exact: (Hnlt Hlt).
```

If the branch closes by contradiction, end it with the contradiction. Do not leave the contradiction only implicit in a rewritten hypothesis.

## Hard Recovery Protocol
Apply this protocol as soon as the goal count is not exactly one.

1. Freeze theorem progress.
  - Do not choose the next tactic from the intended mathematics.
  - Do not edit for convenience or proof style.
2. Read the live state.
  - Record the number of focused goals.
  - Record which goal is the active one.
  - Record the immediately preceding tactic that changed the state.
3. Classify the most recent structural event.
  - `case`, `elim`, `destruct`, `split`, reflection, or another branch opener
  - `have` or `suff` opening a local subproof
  - closing a branch or returning from a local proof
4. Repair structure before content.
  - Missing bullet: insert the bullet and finish that branch.
  - Unclosed local proof: stay inside `{ ... }` until it is discharged.
  - Wrong branch: return to the correct parent branch before doing anything else.
  - Noisy exploratory branch: `Abort.` it and restart from the last stable point.
5. Re-check the live state.
  - If the goal count is still not exactly one, repeat this protocol.
  - If the goal count is exactly one, only then resume rewriting or theorem application.

Exit condition:
- You may resume ordinary proof search only when there is exactly one focused goal and you can name which branch or outer theorem goal you are in.

## Bullet Policy
- Use bullets immediately after any tactic that creates multiple branches, such as `case`, `elim`, `destruct`, `split`, or a case analysis hidden inside a boolean reflection step.
- Keep one bullet level per structural split.
- Finish each bullet completely before returning to the parent bullet.
- If a branch contains a local lemma, prove it inside braces within that branch.
- If a branch ends from a local inequality or contradiction fact, close it explicitly instead of relying on a final rewrite in that fact.

Template:

```coq
case E: (service_at sched j0 t) => [|k] /=.
- (* branch 1 *)
  ...
- (* branch 2 *)
  ...
```

Local sublemma template:

```coq
have PENDING0 : forall t, a0 <= t < a0 + R -> pending job_arrival job_cost sched j0 t.
{
  move=> t /andP [GE LT].
  apply/andP; split.
  - by rewrite /has_arrived GE.
  - apply/negP => COMPt.
    ...
}
```

The braces are not cosmetic. They guarantee that the `have` proof is discharged before the main proof resumes.

## Goal-Count Checklist
Before every nontrivial tactic, ask these questions.

```text
How many focused goals exist right now?
What did the previous tactic do to that number?
Am I still in the same branch as one line ago?
If this is a `have`, is its proof isolated in `{ ... }`?
If this is a `case` or `split`, did I introduce bullets immediately?
Does the next split target literally occur in the current goal head?
Do I need to unfold a wrapper definition before splitting?
Did the last branch-ending line explicitly consume the closing hypothesis?
```

If any answer is unclear, stop and inspect the proof state before editing further.

## Anti-Patterns
- Do not keep writing linear tactics after a branching tactic created multiple goals.
- Do not patch a focus problem by introducing another helper lemma.
- Do not start a `have` proof inline and then continue the outer script before the local proof is clearly finished.
- Do not assume `apply/negP` is harmless; it can change the goal shape and the remaining branch structure.
- Do not `case` on a boolean term that is still hidden under a named goal definition.
- Do not trust `+ by [].` unless the preceding split actually rewrote the enclosing goal.
- Do not end a branch with `rewrite ... in Hfoo` and assume the enclosing goal is solved; explicitly use `Hfoo`.
- Do not leave a contradiction branch "morally finished"; close it with `exfalso; exact: ...` or the equivalent explicit consumer.
- Do not treat `Expected a single focused goal but 2 goals are focused` as a syntax error. It is a proof-structure error.
- Do not trust the text layout of the script over the live session state.
- Do not respond to secondary errors like `Cannot apply lemma ...` or `No such goal` before restoring the goal count to one.
- Do not keep a branch open just because the surrounding code already looks block-structured.

## Trace Example From This Workspace
The trace in `2007-RTSS-Theorem3-opencode-github-copilot_gpt-5-4-20260418145414/opencode_events.jsonl` repeatedly reached:

```text
File "./theorem.v", line 111, characters 2-25:
Error: Expected a single focused goal but 2 goals are focused.
```

The failing script shape was roughly:

```coq
move=> j0 ARR0 JOB0.
apply/negP => NOTCOMP0.
have PENDING0 : forall t,
    a0 <= t < a0 + R -> pending job_arrival job_cost sched j0 t.
Proof.
  ...
Qed.
have SLOT_BOUND : forall t,
    a0 <= t < a0 + R ->
    1 <= backlogged job_arrival job_cost sched j0 t + service_at sched j0 t.
Proof.
  ...
  case E: (service_at sched j0 t) => [|k] /=.
  - ...
  - ...
Qed.
apply: leq_trans ...
```

Why this drifted:
- `apply/negP` changed the main goal into a reflected boolean goal.
- `have PENDING0` opened a local proof.
- `have SLOT_BOUND` opened another local proof.
- Inside `SLOT_BOUND`, `case E: ...` split the proof again.
- Later tactics resumed as if only one goal were active, but at least one branch or local proof had not been structurally closed the way the script expected.

This is why the right repair is branch management, not another lemma.

What the repair protocol should conclude at this point:
- The main theorem is frozen.
- The only valid next move is to close the currently open local proof or branch.
- Any later lemma-application mismatch is diagnostic noise until the focus count returns to one.

## Bullet-Based Repair Pattern
Prefer this shape instead:

```coq
move=> j0 ARR0 JOB0.
apply/negP => NOTCOMP0.

have PENDING0 : forall t,
    a0 <= t < a0 + R -> pending job_arrival job_cost sched j0 t.
{
  move=> t /andP [GE LT].
  apply/andP; split.
  - by rewrite /has_arrived GE.
  - apply/negP => COMPt.
    apply/negP: NOTCOMP0.
    rewrite /completed in COMPt *.
    apply: leq_trans COMPt _.
    rewrite /service [in X in _ <= X](@big_cat_nat _ _ _ t) //=.
    by rewrite leq_addr.
}

have SLOT_BOUND : forall t,
    a0 <= t < a0 + R ->
    1 <= backlogged job_arrival job_cost sched j0 t + service_at sched j0 t.
{
  move=> t LT.
  have PEND := PENDING0 t LT.
  move: PEND => /andP [ARRIVED NOTCOMP].
  rewrite /backlogged /pending ARRIVED NOTCOMP /=.
  rewrite (not_scheduled_no_service (sched := sched) (j := j0)).
  case E: (service_at sched j0 t) => [|k] /=.
  - by rewrite eq_refl.
  - by rewrite add0n.
}

have TOTAL_GE_R :
    R <= total_interference job_arrival job_cost sched j0 a0 (a0 + R) +
         service_during sched j0 a0 (a0 + R).
{
  apply: leq_trans.
  - apply: leq_sum => t LT.
    exact: SLOT_BOUND t LT.
  - rewrite big_split /=.
    rewrite /total_interference /service_during.
    by rewrite big_const_nat iter_addn mul1n addn0 addKn.
}
```

Why this is safer:
- Each `have` is fully discharged inside braces.
- The outer theorem resumes only after the local proof returns to one focused outer goal.
- The `case` split is handled immediately with bullets.
- The script never pretends a multi-goal state is still linear.

## Minimal Debug Log
Keep a short log while editing.

```text
Current focused goal count:
Current active goal owner:
Previous tactic:
Did it open a branch or sublemma: yes/no
Current bullet level:
Need `{ ... }` around `have`: yes/no
Am I inside an unclosed local proof: yes/no
Is the next move a recovery step rather than a math step: yes/no
Next tactic is valid for one goal only: yes/no
Next split target literally appears in the goal head: yes/no
Need to unfold a wrapper definition before splitting: yes/no
Last closing hypothesis was explicitly consumed: yes/no
```

## Success Condition
The proof is back on track when every branch-producing tactic is followed by bullets, every `have` proof is isolated in `{ ... }`, every split acts on a literal visible goal head rather than a hidden wrapper definition, and every branch-ending hypothesis is explicitly consumed before the script resumes the outer proof.