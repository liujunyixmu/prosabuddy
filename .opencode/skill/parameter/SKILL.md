---
name: coq-goal-driven-apply
description: Distinguish postponable proof obligations from non-postponable early-bound implicit parameters, section arguments, policies, and typeclass instances in Coq and Rocq theorem application. In this failure mode, do not use exact of a fully explicit theorem term as a workaround. Use when apply or eapply fails before ordinary subgoals appear and Coq reports uninstantiated existentials or instance-construction errors, or when you are tempted to write a long exact (@lemma ...) call.
argument-hint: '[theorem name] [goal shape or early-binding error]'
user-invocable: true
---

# Coq Goal-Driven Apply for Early-Bound Arguments

Use this skill for one failure mode only: an exported lemma looks applicable, but Coq cannot even produce the ordinary proof obligations because some implicit parameter, section argument, policy, or typeclass instance has not been fixed yet.

## Core Distinction

There are two very different kinds of missing information.

- Postponable proof obligations: ordinary premises that appear as subgoals after `apply:` or `eapply`. These should stay postponed.
- Early-bound arguments or instances: values Coq must know before the theorem term is well-typed. These cannot be postponed.

If Coq has not produced ordinary subgoals yet, do not treat the problem as just another premise to prove later.

## What Must Be Fixed First

An implicit argument or instance must be fixed first if it does one of the following:

- determines a local `Instance` used in the theorem statement
- fixes the policy that later hypotheses are typed over
- appears in the type of later hypotheses, so Coq cannot state those hypotheses until the binder is chosen
- selects the `Interference`, `InterferingWorkload`, readiness, or policy layer in which the conclusion lives

## Failure Signals

Use this skill when goal-driven apply fails with signals like these:

- `Not enough uninstantiated existential variables.`
- `Constant does not build instances of a declared type class.`
- Coq expects a policy, instance, or data argument, but your next term is a proof hypothesis.
- A proof term such as `REFLEXIVE_JLFP` or `WORK_BEARING` is being read as if it should fill a non-`Prop` binder.

These are early-binding failures. They are not ordinary missing premises.

## Procedure

1. Shape the local goal first.
2. Try `apply:` or `eapply` exactly once.
3. If Coq exposes ordinary subgoals, stop. Those goals are postponable. Keep them postponed.
4. If Coq fails before ordinary subgoals appear, inspect the theorem source and identify the earliest non-inferable binder or instance.
5. Add only that earliest binder or instance explicitly, while keeping the theorem application in `apply:` or `eapply` form.
6. Re-run `apply:` or `eapply`.
7. Once Coq starts exposing ordinary subgoals, switch back to postponed-proof mode and do not keep filling parameters.

## Hard Rule

For this failure mode, `exact (@lemma ...)` is prohibited as a repair strategy.

- Do not replace a failed or nearly working `apply:` or `eapply` with a fully explicit theorem term.
- Do not use `exact (@lemma ...)` just to force Coq past unresolved policies, instances, or generalized binders.
- If `apply:` or `eapply` already exposes ordinary subgoals, then the explicit `exact (@lemma ...)` form is strictly worse and should be rejected.

The reason is procedural, not stylistic: a long explicit term bypasses obligation discovery. It turns a goal-driven proof into manual reconstruction of the theorem's exported binder order, instance placement, and policy choices.

## Preferred Application Style

When the theorem head is already the right one, keep the application implicit and let Coq expose the remaining obligations.

Prefer:

```coq
eapply uniprocessor_response_time_bound_restricted_supply_seq.
all: try done.
```

or:

```coq
apply: uniprocessor_response_time_bound_restricted_supply_seq => //.
```

Then solve the exposed goals one by one.

Avoid replacing a nearly working application with a full explicit term such as:

```coq
exact (@uniprocessor_response_time_bound_restricted_supply_seq
   Task H ...
   INTRA_BOUNDED R SOL_SEQ_RS
   j ARR TSK).
```

That style is brittle because it forces you to guess generalized binder order, policy choices, and instance placement all at once. One small drift in a threshold instance, interference instance, or policy coercion can make the entire term ill-typed.

If one early-bound item really must be fixed first, add only that item and then return immediately to `apply:` or `eapply`. Do not keep expanding the theorem term.

## Postponable Example

```coq
have H_pi_bounded :
   forall j0 t1 t2,
      arrives_in arr_seq j0 ->
      job_of_task tsk j0 ->
      busy_interval_prefix arr_seq sched j0 t1 t2 ->
      max_lp_nonpreemptive_segment arr_seq j0 t1 <=
         (fun _ => blocking_bound ts tsk) (job_arrival j0 - t1).
Proof.
   move=> j0 t1 t2 ARR0 TSK0 PREFIX.
   exact: nonpreemptive_segments_bounded_by_blocking.
Qed.

have SI_BOUNDED :
   service_inversion_is_bounded_by arr_seq sched tsk (fun _ => blocking_bound ts tsk).
Proof.
   apply: service_inversion_is_bounded => //.
   exact: H_pi_bounded.
Qed.
```

Here `H_pi_bounded` is a normal proof premise. It appears after the theorem application and can be discharged later. Do not make more parameters explicit.

## Early-Bound Example

This is an existing-context pattern, not code to add to the benchmark file.
If the surrounding file or imported library already provides:

```text
JLFP : JLFP_policy Job
H_priority_is_reflexive : reflexive_job_priorities JLFP
rs_jlfp_interference : Interference Job
rs_jlfp_interfering_workload : InterferingWorkload Job
H_policy_respects_sequential_tasks : policy_respects_sequential_tasks JLFP
```

then a target such as:

```coq
interference_and_workload_consistent_with_sequential_tasks arr_seq sched tsk
```

may require fixing the policy or instance arguments before ordinary proof
premises appear. Do not introduce new `Context`, `Hypothesis`, `Parameter`, or
`Variable` declarations to manufacture these arguments.

In this shape, `JLFP` and the induced `Interference` and `InterferingWorkload` instances are not later proof obligations. Coq must know them before it can form the instantiated theorem term. If they are still ambiguous, do not start filling later premises such as `SI_BOUNDED` or workload bounds. First fix the missing policy or instance, then re-run the theorem application.

## Final-Theorem Example

Suppose the final goal already matches a theorem head like
`uniprocessor_response_time_bound_restricted_supply_seq` and the remaining work is to supply facts such as schedule validity, bounded interference, a valid SBF, and a recurrence solution.

Preferred script:

```coq
eapply uniprocessor_response_time_bound_restricted_supply_seq.
all: try done.
```

Then inspect the remaining goals and solve them using the local facts you already named.

If the proof can be driven by a line such as:

```coq
apply: uniprocessor_response_time_bound_restricted_supply_seq; try done.
```

then a fully explicit `exact (@uniprocessor_response_time_bound_restricted_supply_seq ...)` term is not merely verbose. In this skill, it is the wrong move and should be removed.

Do not jump directly to:

```coq
exact (@uniprocessor_response_time_bound_restricted_supply_seq
   Task H ...
   ABSTRACT_WORK_CONSERVING H_sequential_tasks I_AND_W_SEQUENTIAL
   L BUSY_INTERVALS_BOUNDED (arm_sbf Π Θ ν)
   RS_VALID_BUSY_SBF_ARM ARM_SBF_UNIT
   ...
   j ARR TSK).
```

In this situation, a long explicit term is not helping Coq discover obligations. It is bypassing obligation discovery and making you manually reconstruct the theorem's full exported binder order.

Concrete replacement example:

```coq
exact (@uniprocessor_response_time_bound_restricted_supply_seq
   Task H (@limited_preemptions_rtc_threshold Task H H1)
   Job H2 H4 H3 (@limited_preemptive_job_model Job H5)
   PState H_uniprocessor_proc_model H_unit_supply_proc_model
   H_consumed_supply_proc_model arr_seq VALID_ARRIVALS
   sched JOBS_FROM_ARRIVAL_SEQUENCE JOBS_MUST_ARRIVE
   COMPLETED_JOBS_DONT_EXECUTE VALID_COSTS ts tsk H_tsk_in_ts
   VALID_PREEMPTION_MODEL VALID_RTCT H0 VALID_ARRIVAL_CURVE
   RESPECTS_MAX_ARRIVALS
   (rs_jlfp_interference arr_seq sched)
   (rs_jlfp_interfering_workload arr_seq sched)
   ABSTRACT_WORK_CONSERVING H_sequential_tasks I_AND_W_SEQUENTIAL
   L BUSY_INTERVALS_BOUNDED (arm_sbf Π Θ ν)
   RS_VALID_BUSY_SBF_ARM ARM_SBF_UNIT
   (fun _ F => blocking_bound ts tsk + total_ohep_request_bound_function_FP ts tsk F)
   INTRA_BOUNDED R SOL_SEQ_RS
   j ARR TSK).
```

should be replaced by:

```coq
apply: uniprocessor_response_time_bound_restricted_supply_seq; try done.
```

This shorter script is stronger because it lets Coq recover the instantiated theorem head from the goal and generate only the real remaining obligations.

## Anti-Patterns

- Do not respond to early-binding errors by writing a full `@lemma ...` term.
- Do not replace a good `apply:` or `eapply` candidate with `exact (@lemma ...)` just because some parameters are still unresolved.
- Do not keep an `exact (@uniprocessor_response_time_bound_restricted_supply_seq ...)` script once `apply: uniprocessor_response_time_bound_restricted_supply_seq; try done.` works.
- Do not fill later proof premises when the theorem term itself is still ambiguous.
- Do not treat a typeclass-construction failure as evidence that more `Prop` goals should be proved.
- Do not keep adding explicit arguments after the first missing policy or instance has been identified.

## Output Expectations

When using this skill, explain proof choices in this order:

1. whether Coq already exposed ordinary proof obligations
2. which binder or instance must be fixed first
3. why that item is not a postponable proof premise
4. what minimum explicit information should be added now
5. when it is safe to return to postponed-proof mode
