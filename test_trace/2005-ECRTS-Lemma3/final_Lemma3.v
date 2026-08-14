Require Import prosa.classic.util.all.
Require Import prosa.classic.model.arrival.basic.task prosa.classic.model.arrival.basic.job prosa.classic.model.priority prosa.classic.model.arrival.basic.task_arrival.
Require Import prosa.classic.model.schedule.global.workload.
Require Import prosa.classic.model.schedule.global.schedulability.
Require Import prosa.classic.model.schedule.global.basic.schedule prosa.classic.model.schedule.global.basic.platform
               prosa.classic.model.schedule.global.basic.constrained_deadlines prosa.classic.model.schedule.global.basic.interference.
Require Import
               prosa.classic.model.schedule.global.response_time.

From mathcomp Require Import ssreflect ssrbool eqtype ssrnat seq fintype bigop div path.

Module ResponseTimeAnalysisEDF.

  Export Job SporadicTaskset ScheduleOfSporadicTask Workload Interference
          Platform Schedulability ResponseTime
      TaskArrival ConstrainedDeadlines Priority.



  Export Job SporadicTaskset ScheduleOfSporadicTask Workload Interference
          Platform Schedulability ResponseTime
          TaskArrival  ConstrainedDeadlines.

Section Lemma3_05.
 Context {sporadic_task: eqType}.
    Variable task_cost: sporadic_task -> time.
    Variable task_period: sporadic_task -> time.
    Variable task_deadline: sporadic_task -> time.
    
    Context {Job: eqType}.
    Variable job_arrival: Job -> time.
    Variable job_cost: Job -> time.
    Variable job_deadline: Job -> time.
    Variable job_task: Job -> sporadic_task.
     Variable arr_seq: arrival_sequence Job.

    Hypothesis H_valid_job_parameters:
      forall j,
        arrives_in arr_seq j ->
        valid_sporadic_job task_cost task_deadline job_cost job_deadline job_task j.

 
    Variable ts: taskset_of sporadic_task.
    Hypothesis H_valid_task_parameters:
      valid_sporadic_taskset task_cost task_period task_deadline ts.

    Hypothesis H_sporadic_tasks:
      sporadic_task_model task_period job_arrival job_task arr_seq.

       Hypothesis H_all_jobs_from_taskset:
      forall j, arrives_in arr_seq j -> job_task j \in ts.

    Variable num_cpus: nat.
    Variable sched: schedule Job num_cpus.
    
    Hypothesis H_edf_policy:
    respects_JLFP_policy job_arrival job_cost arr_seq sched (EDF job_arrival job_deadline).
    
    Hypothesis H_jobs_must_arrive_to_execute: jobs_must_arrive_to_execute job_arrival sched.
    
  Hypothesis H_jobs_come_from_arrival_sequence:
      jobs_come_from_arrival_sequence sched arr_seq.

  Hypothesis H_sequential_jobs: sequential_jobs sched.
   

      Hypothesis H_arrival_times_are_consistent: arrival_times_are_consistent job_arrival arr_seq.
      Hypothesis H_arr_seq_is_a_set: arrival_sequence_is_a_set arr_seq.
 
    Hypothesis H_at_least_one_cpu: num_cpus > 0.

    Hypothesis H_completed_jobs_dont_execute: completed_jobs_dont_execute job_cost sched.  


    Hypothesis H_work_conserving: work_conserving job_arrival job_cost arr_seq sched.
  

  
Hypothesis H_constrained_deadlines:
      forall tsk, tsk \in ts -> task_deadline tsk <= task_period tsk.
   
    Variable tsk: sporadic_task.
    Hypothesis task_in_ts: tsk \in ts.
 Hypothesis H_previous_jobs_of_tsk_completed :
  forall j0 t j,
    arrives_in arr_seq j0 ->
    arrives_in arr_seq j ->
    job_task j0 = tsk ->
    job_task j = tsk ->
    job_arrival j0 < job_arrival j ->
    job_arrival j <= t ->
    completed job_cost sched j0 t.

    Definition cumulative_task_interference (j: Job) (a b: time) :=
      \sum_(tsk_other <- ts | tsk_other != tsk)
        task_interference job_arrival job_cost job_task sched j tsk_other a b.

    Lemma Lemma3_05 :
      forall (j: Job) a b,
        arrives_in arr_seq j ->
        job_task j = tsk ->
        cumulative_task_interference j a b =
          num_cpus * total_interference job_arrival job_cost sched j a b.
Proof.
  move=> j a b ARRIVAL JOB.
  unfold cumulative_task_interference.
  (* The paper states an iff between total interference and the sum of per-task min-bounded interference.
     In this formalization, the current goal is the defining equality that identifies the task-wise sum
     with m times the total interference, so we first expose that definitional bridge as the outer theorem-level step.
     This is a have, not a pose, because it is a propositional equality to be used to close the main goal. *)
  have H_defeq:
      \sum_(tsk_other <- ts | tsk_other != tsk)
        task_interference job_arrival job_cost job_task sched j tsk_other a b =
      num_cpus * total_interference job_arrival job_cost sched j a b.
  {
    (* proof_block owner: lemma admit_id: lemma3_05_definitional_bridge theorem: Lemma3_05 *)
    {
      (* This first-level local gap corresponds to the paper's identity m I_k(a,b) = \sum_i I_{i,k}(a,b)
         specialized to the present Prosa definitions; it is a have, not a pose, because we need an equality.
         Coq technical note: this bridge connects the benchmark notation to the imported definition of total_interference. *)
      (* Informal proof step 1: unfold both sides so that both are expressed as sums over the interval [a,b). *)
      (* Informal proof step 2: commute the outer sum over tasks with the sum over time and CPUs. *)
      (* Informal proof step 3: for each time t with j backlogged, work conservation implies that every cpu executes some job. *)
      (* Informal proof step 4: because j belongs to task tsk and is backlogged, the job scheduled on any cpu at time t must belong to a task different from tsk, so exactly one summand contributes per cpu. *)
      (* Informal proof step 5: hence the per-task sum at each backlogged instant equals the number of cpus, and otherwise it equals 0. *)
      (* Informal proof step 6: we therefore reduce the equality to a pointwise counting identity for each time t in [a,b). *)
      (* Informal proof step 7: summing these pointwise equalities over time yields num_cpus times total_interference. *)
      (* Coq technical support, not a main proof step from the paper: after unfolding the definitions,
         we expect to rewrite the finite sums into the same order and then prove the per-time equality
         by case analysis on whether j is backlogged at time t. *)
      have TSKPOS: task_period tsk > 0.
      {
        (* Coq technical support, not a main proof step from the paper: we extract positivity of the task period
           from the valid-taskset assumption because the equal-arrival same-task case is discharged via sporadic separation. *)
        by move: (H_valid_task_parameters _ task_in_ts) => [_ [TSKPOS _]].
      }
      have VALIDtsk := H_valid_task_parameters _ task_in_ts.
      have UNIQ :=
        ConstrainedDeadlines.platform_at_most_one_pending_job_of_each_task
          task_cost task_period task_deadline job_arrival job_cost job_task arr_seq sched
          H_sporadic_tasks tsk VALIDtsk j JOB.
      have DIFFTASK:
          forall t j_other,
            arrives_in arr_seq j_other ->
            backlogged job_arrival job_cost sched j t ->
            scheduled sched j_other t ->
            job_task j_other != tsk.
      {
        (* This have corresponds to the paper sentence that, whenever j is backlogged, interference comes only
           from tasks other than tsk; it is a have, not a pose, because it is a derived proposition used later
           to isolate the unique contributing task summand on each processor. *)
        move=> t j_other ARRother BACK SCHED.
        apply/eqP; red=> SAMEtsk.
        move: SCHED => /existsP [cpu SCHEDcpu].
        have SCHED' : scheduled sched j_other t by apply/existsP; exists cpu.
        have PENDINGother := SCHED'.
        apply scheduled_implies_pending with (job_cost := job_cost) (job_arrival := job_arrival)
          in PENDINGother; try (by done).
        have SAMEtsk' : job_task j = job_task j_other by rewrite JOB SAMEtsk.
        destruct (ltnP (job_arrival j_other) (job_arrival j)) as [BEFOREother | BEFOREj].
        {
          move: PENDINGother => /andP [_ /negP NOTCOMPother].
          move: BACK => /andP [/andP [ARRIVEDj _] _].
          apply: NOTCOMPother.
          exact: (H_previous_jobs_of_tsk_completed j_other t j ARRother ARRIVAL SAMEtsk JOB BEFOREother ARRIVEDj).
        }
        {
          have [EQjob | NEQjob] := eqVneq j_other j.
          {
            subst j_other.
            move: BACK => /andP [_ /negP NOTSCHEDj].
            apply: NOTSCHEDj.
            by apply/existsP; exists cpu.
          }
          {
            have NEQjob' : j <> j_other.
            { by move=> EQ; subst j_other; rewrite eq_refl in NEQjob. }
            have SEP := H_sporadic_tasks j j_other NEQjob' ARRIVAL ARRother SAMEtsk' BEFOREj.
            have LT1 : (job_arrival j).+1 <= job_arrival j + task_period tsk.
            { by rewrite -addn1 leq_add2l. }
            have SEPtsk : job_arrival j + task_period tsk <= job_arrival j_other.
            { by rewrite JOB in SEP. }
            have BEFOREjj_other : job_arrival j < job_arrival j_other.
            { exact: (leq_trans LT1 SEPtsk). }
            move: BACK => /andP [/andP [_ /negP NOTCOMPj] _].
            apply: NOTCOMPj.
            exact: (H_sequential_tasks j j_other t cpu ARRIVAL ARRother SAMEtsk' BEFOREjj_other SCHEDcpu).
          }
        }
      }
      set other_tasks := [seq tsk_other <- ts | tsk_other != tsk].
      have -> :
          \sum_(tsk_other <- ts | tsk_other != tsk)
            task_interference job_arrival job_cost job_task sched j tsk_other a b =
          \sum_(tsk_other <- other_tasks)
            task_interference job_arrival job_cost job_task sched j tsk_other a b.
      {
        by rewrite /other_tasks big_filter.
      }
      rewrite /total_interference /task_interference mulnC.
      rewrite -big_mkcond.
      rewrite -exchange_big.
      rewrite big_distrl /=.
      rewrite [\sum_(_ <= _ < _ | backlogged _ _ _ _ _) _]big_mkcond.
      apply eq_big_nat; move => t /andP [GEt LTt].
      destruct (backlogged job_arrival job_cost sched j t) eqn:BACK;
        last by rewrite big1 //; intros i _; rewrite big1.
      rewrite big_mkcond /=.
      rewrite exchange_big /=.
      apply eq_trans with (y := \sum_(cpu < num_cpus) 1); last by simpl_sum_const.
      apply eq_bigr; intros cpu _.
      move: (H_work_conserving j t ARRIVAL BACK cpu) => [j_other /eqP SCHED]; unfold scheduled_on in *.
      have ARRother: arrives_in arr_seq j_other.
      {
        apply (H_jobs_come_from_arrival_sequence j_other t).
        by apply/existsP; exists cpu; apply/eqP.
      }
      rewrite (bigD1_seq (job_task j_other)) /=; last by rewrite /other_tasks filter_uniq; destruct ts.
      {
        rewrite (eq_bigr (fun i => 0));
          last by intros i DIFF; rewrite /task_scheduled_on SCHED; apply/eqP; rewrite eqb0 eq_sym.
        rewrite big_const_seq iter_addn mul0n.
        rewrite addn0.
        rewrite addn0.
        apply/eqP; rewrite eqb1.
        by unfold task_scheduled_on; rewrite SCHED.
      }
      have TASKIN : job_task j_other \in other_tasks.
      {
        rewrite /other_tasks mem_filter; apply/andP; split; last by apply H_all_jobs_from_taskset.
        by apply DIFFTASK with (t := t); try (by done); apply/existsP; exists cpu; apply/eqP.
      }
      exact: TASKIN. (* admit_id: lemma3_05_definitional_bridge *)
    }
  }
  exact H_defeq.
Qed.

End Lemma3_05.
    
End ResponseTimeAnalysisEDF.