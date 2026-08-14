# classic 目录下 `.v` 文件中的 Hypothesis 整理

- 扫描范围：递归扫描 `classic` 目录下全部 `.v` 文件。
- 原始 `Hypothesis` 条数：1503
- 去重后条数：409
- 去重规则：忽略 `Hypothesis` 名称，只按冒号后的命题主体去重；命题内容只要有任何差异，就视为不同假设。
- 每条记录内容：保留一条代表性原句，补充中文注释，并给出代表位置与重复出现次数。

## 分类统计

- 与模型有关：130
- 与数据结构有关：32
- 其他：247

## 1. 与模型有关的 Hypothesis（130 条）

### M001

- 代表位置：`analysis/apa/bertogna_edf_comp.v:912`
- 重复出现次数：85
- 原句：

```coq
      Hypothesis H_completed_jobs_dont_execute: completed_jobs_dont_execute job_cost sched.
```

- 注释：要求已经完成的作业不再继续执行。

### M002

- 代表位置：`analysis/apa/bertogna_edf_comp.v:911`
- 重复出现次数：57
- 原句：

```coq
      Hypothesis H_jobs_must_arrive_to_execute: jobs_must_arrive_to_execute job_arrival sched.
```

- 注释：要求作业只有在真正到达之后才能执行。

### M003

- 代表位置：`analysis/apa/bertogna_edf_comp.v:901`
- 重复出现次数：46
- 原句：

```coq
      Hypothesis H_sporadic_tasks:
        sporadic_task_model task_period job_arrival job_task arr_seq.
```

- 注释：要求到达序列满足 sporadic 任务模型，即同一任务相邻作业的到达间隔受到周期约束。

### M004

- 代表位置：`analysis/apa/bertogna_edf_comp.v:220`
- 重复出现次数：34
- 原句：

```coq
      Hypothesis H_valid_task_parameters:
        valid_sporadic_taskset task_cost task_period task_deadline ts.
```

- 注释：要求整个任务集满足 sporadic 任务模型下的合法参数约束，例如执行时间、周期和截止期的定义都符合模型要求。

### M005

- 代表位置：`analysis/apa/bertogna_edf_comp.v:915`
- 重复出现次数：29
- 原句：

```coq
      Hypothesis H_sequential_jobs: sequential_jobs sched.
```

- 注释：要求每个作业的执行是串行的，不会在多个处理器上并行运行。

### M006

- 代表位置：`analysis/apa/bertogna_edf_comp.v:895`
- 重复出现次数：28
- 原句：

```coq
      Hypothesis H_valid_job_parameters:
        forall j,
          arrives_in arr_seq j ->
          valid_sporadic_job task_cost task_deadline job_cost job_deadline job_task j.
```

- 注释：要求到达序列中的每个作业都满足 sporadic 作业的合法参数约束，并与所属任务的参数保持一致。

### M007

- 代表位置：`analysis/global/basic/bertogna_edf_comp.v:904`
- 重复出现次数：26
- 原句：

```coq
      Hypothesis H_work_conserving: work_conserving job_arrival job_cost arr_seq sched.
```

- 注释：要求调度器在有可执行作业时不让处理器无故空闲，这是典型的工作保守假设。

### M008

- 代表位置：`analysis/apa/bertogna_edf_comp.v:877`
- 重复出现次数：20
- 原句：

```coq
      Hypothesis H_constrained_deadlines:
        forall tsk, tsk \in ts -> task_deadline tsk <= task_period tsk.
```

- 注释：要求系统满足受限截止期模型，即任务的相对截止期不超过周期。

### M009

- 代表位置：`analysis/apa/interference_bound_edf.v:156`
- 重复出现次数：19
- 原句：

```coq
    Hypothesis H_at_least_one_cpu: num_cpus > 0.
```

- 注释：要求平台至少有一个处理器。

### M010

- 代表位置：`analysis/uni/basic/fp_rta_comp.v:196`
- 重复出现次数：19
- 原句：

```coq
          Hypothesis H_priority_is_reflexive:
            FP_is_reflexive higher_eq_priority.
```

- 注释：要求固定优先级关系满足自反性，这是把它当作合法优先级比较关系所需的基本性质。

### M011

- 代表位置：`analysis/uni/basic/fp_rta_comp.v:282`
- 重复出现次数：13
- 原句：

```coq
    Hypothesis H_priority_transitive: FP_is_transitive higher_eq_priority.
```

- 注释：要求固定优先级关系满足传递性。

### M012

- 代表位置：`analysis/global/jitter/bertogna_edf_comp.v:984`
- 重复出现次数：12
- 原句：

```coq
      Hypothesis H_jobs_execute_after_jitter:
        jobs_execute_after_jitter job_arrival job_jitter sched.
```

- 注释：要求系统满足带抖动的到达模型约束。

### M013

- 代表位置：`analysis/global/jitter/bertogna_edf_comp.v:993`
- 重复出现次数：11
- 原句：

```coq
      Hypothesis H_work_conserving: work_conserving job_arrival job_cost job_jitter arr_seq sched.
```

- 注释：要求调度器在有可执行作业时不让处理器无故空闲，这是典型的工作保守假设。

### M014

- 代表位置：`analysis/apa/workload_bound.v:177`
- 重复出现次数：10
- 原句：

```coq
    Hypothesis H_valid_task_parameters:
      is_valid_sporadic_task task_cost task_period task_deadline tsk.
```

- 注释：要求单个任务满足 sporadic 任务模型的合法参数约束。

### M015

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_rta.v:48`
- 重复出现次数：10
- 原句：

```coq
    Hypothesis H_job_cost_le_task_cost:
      cost_of_jobs_from_arrival_sequence_le_task_cost
        task_cost job_cost job_task arr_seq.
```

- 注释：要求到达序列中的作业执行成本不超过其所属任务声明的执行成本。

### M016

- 代表位置：`analysis/uni/susp/dynamic/oblivious/reduction.v:50`
- 重复出现次数：9
- 原句：

```coq
    Hypothesis H_priority_is_transitive: JLDP_is_transitive higher_eq_priority.
```

- 注释：要求 JLDP 优先级关系满足传递性。

### M017

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_rta.v:126`
- 重复出现次数：9
- 原句：

```coq
      Hypothesis H_job_cost_positive: job_cost_positive job_cost j.
```

- 注释：要求作业执行成本为正，排除零执行时间等退化情况。

### M018

- 代表位置：`analysis/apa/bertogna_fp_comp.v:289`
- 重复出现次数：8
- 原句：

```coq
      Hypothesis H_priority_transitive: FP_is_transitive higher_priority.
```

- 注释：要求固定优先级关系满足传递性。

### M019

- 代表位置：`analysis/apa/workload_bound.v:46`
- 重复出现次数：8
- 原句：

```coq
    Hypothesis H_period_positive: task_period tsk > 0.
```

- 注释：要求任务周期为正。

### M020

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_seq_rta.v:193`
- 重复出现次数：8
- 原句：

```coq
      Hypothesis H_sequential_jobs: sequential_jobs job_arrival job_cost sched job_task.
```

- 注释：要求每个作业的执行是串行的，不会在多个处理器上并行运行。

### M021

- 代表位置：`analysis/apa/bertogna_edf_comp.v:919`
- 重复出现次数：7
- 原句：

```coq
      Hypothesis H_work_conserving: apa_work_conserving job_arrival job_cost job_task arr_seq
                                                        sched alpha.
```

- 注释：要求 APA 调度器在给定亲和性约束下保持工作保守。

### M022

- 代表位置：`analysis/global/basic/bertogna_edf_comp.v:905`
- 重复出现次数：7
- 原句：

```coq
      Hypothesis H_edf_policy: respects_JLFP_policy job_arrival job_cost arr_seq sched
                                                    (EDF job_arrival job_deadline).
```

- 注释：要求调度满足给定的 EDF/JLFP 优先级策略。

### M023

- 代表位置：`analysis/uni/basic/fp_rta_comp.v:201`
- 重复出现次数：7
- 原句：

```coq
          Hypothesis H_period_positive:
            forall tsk, tsk \in ts -> task_period tsk > 0.
```

- 注释：要求任务周期为正。

### M024

- 代表位置：`model/schedule/uni/jitter/busy_interval.v:84`
- 重复出现次数：7
- 原句：

```coq
        Hypothesis H_priority_is_reflexive: JLFP_is_reflexive higher_eq_priority.
```

- 注释：要求固定优先级关系满足自反性，这是把它当作合法优先级比较关系所需的基本性质。

### M025

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_seq_rta.v:83`
- 重复出现次数：7
- 原句：

```coq
    Hypothesis H_family_of_proper_arrival_curves:
      family_of_proper_arrival_curves job_task arr_seq max_arrivals ts.
```

- 注释：要求到达曲线或到达曲线族满足 proper 性质，用于给出到达数量的上界模型。

### M026

- 代表位置：`analysis/global/jitter/bertogna_edf_comp.v:967`
- 重复出现次数：6
- 原句：

```coq
      Hypothesis H_valid_job_parameters:
        forall j,
          arrives_in arr_seq j ->
          valid_sporadic_job_with_jitter task_cost task_deadline task_jitter job_cost
                                         job_deadline job_task job_jitter j.
```

- 注释：要求到达序列中的每个作业都满足带抖动的 sporadic 作业参数约束，并与所属任务参数保持一致。

### M027

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_properties.v:59`
- 重复出现次数：6
- 原句：

```coq
    Hypothesis H_priority_is_total: FP_is_total_over_task_set higher_eq_priority ts.
```

- 注释：要求任务集上的固定优先级关系是全的，也就是任意两项都可比较。

### M028

- 代表位置：`model/schedule/uni/jitter/busy_interval.v:246`
- 重复出现次数：6
- 原句：

```coq
          Hypothesis H_priority_is_transitive: JLFP_is_transitive higher_eq_priority.
```

- 注释：要求固定优先级关系满足传递性。

### M029

- 代表位置：`analysis/apa/interference_bound_edf.v:1162`
- 重复出现次数：5
- 原句：

```coq
    Hypothesis H_period_positive: task_period tsk_other > 0.
```

- 注释：要求任务周期为正。

### M030

- 代表位置：`analysis/global/basic/bertogna_fp_theory.v:78`
- 重复出现次数：5
- 原句：

```coq
    Hypothesis H_respects_FP_policy:
      respects_FP_policy job_arrival job_cost job_task arr_seq sched higher_eq_priority.
```

- 注释：要求调度满足给定的固定优先级策略。

### M031

- 代表位置：`analysis/uni/jitter/fp_rta_comp.v:285`
- 重复出现次数：5
- 原句：

```coq
    Hypothesis H_job_cost_le_task_cost:
      forall j,
        arrives_in arr_seq j ->
        job_cost j <= task_cost (job_task j).
```

- 注释：要求到达序列中的作业执行成本不超过其所属任务声明的执行成本。

### M032

- 代表位置：`analysis/uni/susp/dynamic/oblivious/reduction.v:49`
- 重复出现次数：5
- 原句：

```coq
    Hypothesis H_priority_is_reflexive: JLDP_is_reflexive higher_eq_priority.
```

- 注释：要求 JLDP 优先级关系满足自反性。

### M033

- 代表位置：`analysis/uni/susp/dynamic/oblivious/reduction.v:51`
- 重复出现次数：5
- 原句：

```coq
    Hypothesis H_priority_is_total: JLDP_is_total arr_seq higher_eq_priority.
```

- 注释：要求 JLDP 优先级关系在给定到达序列上是全的。

### M034

- 代表位置：`analysis/apa/bertogna_edf_comp.v:883`
- 重复出现次数：4
- 原句：

```coq
      Hypothesis H_subaffinity:
        forall tsk, tsk \in ts -> is_subaffinity (alpha' tsk) (alpha tsk).
```

- 注释：要求系统满足给定的处理器亲和性约束。

### M035

- 代表位置：`analysis/apa/bertogna_edf_comp.v:918`
- 重复出现次数：4
- 原句：

```coq
      Hypothesis H_respects_affinity: respects_affinity job_task sched alpha.
```

- 注释：要求系统满足给定的处理器亲和性约束。

### M036

- 代表位置：`analysis/apa/bertogna_edf_comp.v:921`
- 重复出现次数：4
- 原句：

```coq
      Hypothesis H_edf_policy:
        respects_JLFP_policy_under_weak_APA job_arrival job_cost job_task
                                            arr_seq sched alpha (EDF job_arrival job_deadline).
```

- 注释：要求调度满足给定的 EDF/JLFP 优先级策略。

### M037

- 代表位置：`analysis/apa/bertogna_edf_comp.v:955`
- 重复出现次数：4
- 原句：

```coq
      Hypothesis H_test_succeeds: edf_schedulable ts.
```

- 注释：要求相关作业或任务不丢截止期，也就是满足可调度性目标。

### M038

- 代表位置：`analysis/apa/bertogna_fp_comp.v:332`
- 重复出现次数：4
- 原句：

```coq
      Hypothesis H_valid_task_parameters:
        valid_sporadic_taskset task_cost task_period task_deadline (rcons ts_hp tsk).
```

- 注释：要求整个任务集满足 sporadic 任务模型下的合法参数约束，例如执行时间、周期和截止期的定义都符合模型要求。

### M039

- 代表位置：`analysis/apa/bertogna_fp_comp.v:502`
- 重复出现次数：4
- 原句：

```coq
      Hypothesis H_priority_is_total:
        FP_is_total_over_task_set higher_priority ts.
```

- 注释：要求任务集上的固定优先级关系是全的，也就是任意两项都可比较。

### M040

- 代表位置：`analysis/apa/bertogna_fp_comp.v:675`
- 重复出现次数：4
- 原句：

```coq
      Hypothesis H_test_succeeds: fp_schedulable ts.
```

- 注释：要求相关作业或任务不丢截止期，也就是满足可调度性目标。

### M041

- 代表位置：`analysis/global/jitter/bertogna_edf_comp.v:994`
- 重复出现次数：4
- 原句：

```coq
      Hypothesis H_edf_policy: respects_JLFP_policy job_arrival job_cost job_jitter arr_seq sched
                                                    (EDF job_arrival job_deadline).
```

- 注释：要求调度满足给定的 EDF/JLFP 优先级策略。

### M042

- 代表位置：`analysis/uni/basic/tdma_wcrt_analysis.v:66`
- 重复出现次数：4
- 原句：

```coq
    Hypothesis H_valid_job:
      valid_sporadic_job task_cost task_deadline job_cost job_deadline job_task j.
```

- 注释：要求到达序列中的每个作业都满足 sporadic 作业的合法参数约束，并与所属任务的参数保持一致。

### M043

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_properties.v:72`
- 重复出现次数：4
- 原句：

```coq
    Hypothesis H_valid_schedule:
      valid_suspension_aware_schedule job_arrival arr_seq job_higher_eq_priority
                                      job_suspension_duration job_cost sched_susp.
```

- 注释：这是一个描述系统模型、调度语义或任务参数约束的假设。

### M044

- 代表位置：`model/schedule/uni/susp/suspension_intervals.v:102`
- 重复出现次数：4
- 原句：

```coq
        Hypothesis H_respects_self_suspensions: respects_self_suspensions.
```

- 注释：要求调度和作业行为遵守自挂起模型规定的挂起约束。

### M045

- 代表位置：`analysis/apa/workload_bound.v:184`
- 重复出现次数：3
- 原句：

```coq
    Hypothesis H_constrained_deadline: task_deadline tsk <= task_period tsk.
```

- 注释：要求系统满足受限截止期模型，即任务的相对截止期不超过周期。

### M046

- 代表位置：`analysis/uni/jitter/fp_rta_comp.v:291`
- 重复出现次数：3
- 原句：

```coq
    Hypothesis H_job_jitter_le_task_jitter:
      forall j,
        arrives_in arr_seq j ->
        job_jitter j <= task_jitter (job_task j).
```

- 注释：要求系统满足带抖动的到达模型约束。

### M047

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_service.v:72`
- 重复出现次数：3
- 原句：

```coq
    Hypothesis H_constrained_deadlines:
      constrained_deadline_model task_period task_deadline ts.
```

- 注释：要求系统满足受限截止期模型，即任务的相对截止期不超过周期。

### M048

- 代表位置：`analysis/uni/susp/dynamic/oblivious/reduction.v:70`
- 重复出现次数：3
- 原句：

```coq
    Hypothesis H_jobs_must_arrive_to_execute:
      jobs_must_arrive_to_execute job_arrival sched_susp.
```

- 注释：要求作业只有在真正到达之后才能执行。

### M049

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_rta.v:85`
- 重复出现次数：3
- 原句：

```coq
    Hypothesis H_work_conserving: work_conserving interference interfering_workload.
```

- 注释：要求调度器在有可执行作业时不让处理器无故空闲，这是典型的工作保守假设。

### M050

- 代表位置：`model/schedule/uni/limited/busy_interval.v:667`
- 重复出现次数：3
- 原句：

```coq
            Hypothesis H_priority_inversion_is_bounded:
              is_priority_inversion_bounded_by priority_inversion_bound.
```

- 注释：要求优先级反转受到某个界的约束。

### M051

- 代表位置：`model/schedule/uni/limited/edf/nonpr_reg/response_time_bound.v:69`
- 重复出现次数：3
- 原句：

```coq
    Hypothesis H_correct_preemption_model:
      correct_preemption_model arr_seq sched can_be_preempted.
```

- 注释：要求调度满足给定的抢占模型约束。

### M052

- 代表位置：`analysis/apa/bertogna_fp_theory.v:82`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_respects_FP_policy:
      respects_FP_policy_under_weak_APA job_arrival job_cost job_task arr_seq
                                        sched alpha higher_eq_priority.
```

- 注释：要求调度满足给定的固定优先级策略。

### M053

- 代表位置：`analysis/global/basic/bertogna_fp_comp.v:527`
- 重复出现次数：2
- 原句：

```coq
      Hypothesis H_respects_FP_policy:
        respects_FP_policy job_arrival job_cost job_task arr_seq sched higher_priority.
```

- 注释：要求调度满足给定的固定优先级策略。

### M054

- 代表位置：`analysis/global/basic/bertogna_fp_theory.v:99`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_response_time_of_interfering_tasks_is_known:
      forall hp_tsk R,
        (hp_tsk, R) \in hp_bounds ->
        response_time_bounded_by hp_tsk R.
```

- 注释：把某个值作为任务的响应时间上界来使用。

### M055

- 代表位置：`analysis/global/jitter/bertogna_fp_theory.v:85`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_respects_priority:
      respects_FP_policy job_arrival job_cost job_task job_jitter arr_seq sched higher_eq_priority.
```

- 注释：要求调度满足给定的固定优先级策略。

### M056

- 代表位置：`analysis/uni/basic/fp_rta_comp.v:353`
- 重复出现次数：2
- 原句：

```coq
      Hypothesis H_test_succeeds: claimed_to_be_schedulable.
```

- 注释：要求相关作业或任务不丢截止期，也就是满足可调度性目标。

### M057

- 代表位置：`analysis/uni/basic/tdma_rta_theory.v:102`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis TDMA_policy:
      Respects_TDMA_policy job_arrival job_cost job_task arr_seq sched ts task_time_slot slot_order.
```

- 注释：要求调度满足 TDMA 时隙分配策略。

### M058

- 代表位置：`analysis/uni/basic/tdma_rta_theory.v:106`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_valid_time_slot:
      is_valid_time_slot tsk task_time_slot.
```

- 注释：这是一个描述系统模型、调度语义或任务参数约束的假设。

### M059

- 代表位置：`analysis/uni/jitter/fp_rta_comp.v:320`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_respects_FP_policy:
      respects_FP_policy job_arrival job_cost job_jitter job_task arr_seq sched higher_eq_priority.
```

- 注释：要求调度满足给定的固定优先级策略。

### M060

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_service.v:134`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_no_deadline_misses_for_previous_jobs:
      forall j0,
        arrives_in arr_seq j0 ->
        job_arrival j0 < job_arrival j ->
        job_task j0 = job_task j ->
        job_misses_no_deadline_in_sched_susp j0.
```

- 注释：要求相关作业或任务不丢截止期，也就是满足可调度性目标。

### M061

- 代表位置：`analysis/uni/susp/dynamic/jitter/taskset_membership.v:110`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_valid_response_time_bound_of_hp_tasks_in_all_schedules:
      forall job_cost sched,
        is_valid_suspension_aware_schedule job_cost sched ->
        forall tsk_hp,
          tsk_hp \in ts ->
          other_hep_task tsk_hp ->
          is_task_response_time_bound_with job_cost sched tsk_hp (R tsk_hp).
```

- 注释：这是一个描述系统模型、调度语义或任务参数约束的假设。

### M062

- 代表位置：`analysis/uni/susp/dynamic/jitter/taskset_membership.v:196`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_dynamic_suspensions:
      dynamic_suspension_model job_cost job_task job_suspension_duration task_suspension_bound.
```

- 注释：要求系统满足动态自挂起模型。

### M063

- 代表位置：`analysis/uni/susp/dynamic/oblivious/fp_rta.v:72`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_dynamic_suspensions:
      dynamic_suspension_model job_cost job_task next_suspension task_suspension_bound.
```

- 注释：要求系统满足动态自挂起模型。

### M064

- 代表位置：`analysis/uni/susp/sustainability/allcosts/reduction_properties.v:58`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_completed_jobs_dont_execute:
      completed_jobs_dont_execute job_cost sched_susp.
```

- 注释：要求已经完成的作业不再继续执行。

### M065

- 代表位置：`analysis/uni/susp/sustainability/allcosts/reduction_properties.v:62`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_work_conserving:
      work_conserving job_arrival job_cost job_suspension_duration arr_seq sched_susp.
```

- 注释：要求调度器在有可执行作业时不让处理器无故空闲，这是典型的工作保守假设。

### M066

- 代表位置：`analysis/uni/susp/sustainability/allcosts/reduction_properties.v:66`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_respects_priority:
      respects_JLDP_policy job_arrival job_cost job_suspension_duration arr_seq
                           sched_susp higher_eq_priority.
```

- 注释：这是一个描述系统模型、调度语义或任务参数约束的假设。

### M067

- 代表位置：`analysis/uni/susp/sustainability/allcosts/reduction_properties.v:71`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_respects_self_suspensions:
      respects_self_suspensions job_arrival job_cost job_suspension_duration sched_susp.
```

- 注释：要求调度和作业行为遵守自挂起模型规定的挂起约束。

### M068

- 代表位置：`implementation/uni/jitter/fp_rta_example.v:136`
- 重复出现次数：2
- 原句：

```coq
     Hypothesis H_jitter_is_bounded:
       forall j,
         arrives_in arr_seq j ->
         job_jitter_leq_task_jitter task_jitter job_jitter job_task j.
```

- 注释：要求系统满足带抖动的到达模型约束。

### M069

- 代表位置：`model/schedule/uni/jitter/busy_interval.v:247`
- 重复出现次数：2
- 原句：

```coq
          Hypothesis H_respects_policy:
            respects_JLFP_policy job_arrival job_cost job_jitter arr_seq sched higher_eq_priority.
```

- 注释：要求调度满足给定的 EDF/JLFP 优先级策略。

### M070

- 代表位置：`model/schedule/uni/limited/busy_interval.v:913`
- 重复出现次数：2
- 原句：

```coq
          Hypothesis H_workload_is_bounded:
            forall t, priority_inversion_bound + hp_workload t (t + delta) <= delta.
```

- 注释：要求优先级反转受到某个界的约束。

### M071

- 代表位置：`model/schedule/uni/limited/edf/nonpr_reg/concrete_models/response_time_bound.v:191`
- 重复出现次数：2
- 原句：

```coq
      Hypothesis H_nonpreemptive_sched: is_nonpreemptive_schedule job_cost sched.
```

- 注释：要求调度是非抢占的。

### M072

- 代表位置：`model/schedule/uni/limited/edf/nonpr_reg/concrete_models/response_time_bound.v:267`
- 重复出现次数：2
- 原句：

```coq
      Hypothesis H_model_with_fixed_preemption_points:
        fixed_preemption_points_model
          task_cost job_cost job_task arr_seq
          job_preemption_points task_preemption_points ts.
```

- 注释：要求系统满足固定抢占点模型。

### M073

- 代表位置：`model/schedule/uni/limited/edf/nonpr_reg/concrete_models/response_time_bound.v:277`
- 重复出现次数：2
- 原句：

```coq
      Hypothesis H_respects_policy:
        respects_JLFP_policy_at_preemption_point
          job_arrival job_cost arr_seq sched
          (can_be_preempted_for_model_with_limited_preemptions job_preemption_points) higher_eq_priority.
```

- 注释：要求调度满足给定的 EDF/JLFP 优先级策略。

### M074

- 代表位置：`model/schedule/uni/limited/edf/nonpr_reg/response_time_bound.v:80`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_respects_policy:
      respects_JLFP_policy_at_preemption_point
        job_arrival job_cost arr_seq sched can_be_preempted higher_eq_priority.
```

- 注释：要求调度满足给定的 EDF/JLFP 优先级策略。

### M075

- 代表位置：`model/schedule/uni/limited/fixed_priority/nonpr_reg/concrete_models/response_time_bound.v:253`
- 重复出现次数：2
- 原句：

```coq
      Hypothesis H_respects_policy:
        respects_FP_policy_at_preemption_point
          job_arrival job_cost job_task arr_seq sched
          (can_be_preempted_for_model_with_limited_preemptions job_preemption_points) higher_eq_priority.
```

- 注释：要求调度满足给定的固定优先级策略。

### M076

- 代表位置：`model/schedule/uni/limited/platform/nonpreemptive.v:41`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_nonpreemptive_sched:
      NonpreemptiveSchedule.is_nonpreemptive_schedule job_cost sched.
```

- 注释：要求调度是非抢占的。

### M077

- 代表位置：`analysis/apa/bertogna_fp_comp.v:540`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_respects_FP_policy:
        respects_FP_policy_under_weak_APA job_arrival job_cost job_task arr_seq sched
                                          alpha higher_priority.
```

- 注释：要求调度满足给定的固定优先级策略。

### M078

- 代表位置：`analysis/apa/bertogna_fp_theory.v:110`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_response_time_of_interfering_tasks_is_known:
      forall hp_tsk R,
        (hp_tsk, R) \in hp_bounds ->
        is_response_time_bound_of_task job_arrival job_cost job_task arr_seq sched hp_tsk R.
```

- 注释：把某个值作为任务的响应时间上界来使用。

### M079

- 代表位置：`analysis/global/jitter/bertogna_fp_comp.v:528`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_respects_FP_policy:
        respects_FP_policy job_arrival job_cost job_task job_jitter arr_seq sched higher_priority.
```

- 注释：要求调度满足给定的固定优先级策略。

### M080

- 代表位置：`analysis/global/jitter/bertogna_fp_theory.v:106`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_response_time_of_interfering_tasks_is_known:
      forall hp_tsk R,
        (hp_tsk, R) \in hp_bounds ->
        response_time_bounded_by hp_tsk (task_jitter hp_tsk + R).
```

- 注释：把某个值作为任务的响应时间上界来使用。

### M081

- 代表位置：`analysis/uni/basic/tdma_rta_theory.v:215`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_is_valid_bound:
        is_valid_tdma_bound BOUND.
```

- 注释：这是一个描述系统模型、调度语义或任务参数约束的假设。

### M082

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_service.v:231`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_workload_has_finished:
          forall j_hp,
            arrives_in arr_seq j_hp ->
            actual_arrival_before job_arrival job_jitter j_hp t -> 
            other_higher_eq_priority_job j_hp ->
            job_completed_in_sched_jitter j_hp t.
```

- 注释：要求系统满足带抖动的到达模型约束。

### M083

- 代表位置：`analysis/uni/susp/dynamic/jitter/taskset_rta.v:145`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_valid_response_time_bound_of_tsk_i:
      forall job_cost job_jitter sched,
        valid_jobs_with_jitter job_cost job_jitter inflated_task_cost task_jitter ->
        is_valid_jitter_aware_schedule job_cost job_jitter sched ->
        is_task_response_time_bound_with job_cost sched tsk_i (R tsk_i).
```

- 注释：要求系统满足带抖动的到达模型约束。

### M084

- 代表位置：`analysis/uni/susp/dynamic/jitter/taskset_rta.v:156`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_valid_schedule: is_valid_suspension_aware_schedule job_cost sched_susp.
```

- 注释：这是一个描述系统模型、调度语义或任务参数约束的假设。

### M085

- 代表位置：`analysis/uni/susp/dynamic/oblivious/fp_rta.v:100`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_work_conserving: work_conserving job_arrival job_cost next_suspension arr_seq sched.
```

- 注释：要求调度器在有可执行作业时不让处理器无故空闲，这是典型的工作保守假设。

### M086

- 代表位置：`analysis/uni/susp/dynamic/oblivious/fp_rta.v:103`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_respects_priority:
        respects_FP_policy job_arrival job_cost job_task next_suspension arr_seq
                           sched higher_eq_priority.
```

- 注释：要求调度满足给定的固定优先级策略。

### M087

- 代表位置：`analysis/uni/susp/dynamic/oblivious/fp_rta.v:108`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_respects_self_suspensions:
        respects_self_suspensions job_arrival job_cost next_suspension sched.
```

- 注释：要求调度和作业行为遵守自挂起模型规定的挂起约束。

### M088

- 代表位置：`analysis/uni/susp/dynamic/oblivious/fp_rta.v:121`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_claimed_schedulable_by_suspension_oblivious_RTA:
        claimed_to_be_schedulable ts.
```

- 注释：要求相关作业或任务不丢截止期，也就是满足可调度性目标。

### M089

- 代表位置：`analysis/uni/susp/dynamic/oblivious/fp_rta.v:79`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_inflated_cost_le_deadline_and_period:
      forall tsk,
        tsk \in ts ->
          inflated_cost tsk <= task_deadline tsk /\
          inflated_cost tsk <= task_period tsk.
```

- 注释：要求系统满足受限截止期模型，即任务的相对截止期不超过周期。

### M090

- 代表位置：`analysis/uni/susp/dynamic/oblivious/reduction.v:117`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_inflated_cost_le_deadline_and_period:
          forall tsk,
            tsk \in ts ->
            inflated_task_cost tsk <= task_deadline tsk /\
            inflated_task_cost tsk <= task_period tsk.
```

- 注释：要求系统满足受限截止期模型，即任务的相对截止期不超过周期。

### M091

- 代表位置：`analysis/uni/susp/dynamic/oblivious/reduction.v:61`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_dynamic_suspensions:
      dynamic_suspension_model original_job_cost job_task next_suspension task_suspension_bound.
```

- 注释：要求系统满足动态自挂起模型。

### M092

- 代表位置：`analysis/uni/susp/dynamic/oblivious/reduction.v:725`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_schedulable_without_suspensions:
      forall j,
        arrives_in arr_seq j ->
        schedulable_without_suspensions j.
```

- 注释：要求相关作业或任务不丢截止期，也就是满足可调度性目标。

### M093

- 代表位置：`analysis/uni/susp/dynamic/oblivious/reduction.v:74`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_completed_jobs_dont_execute:
      completed_jobs_dont_execute original_job_cost sched_susp.
```

- 注释：要求已经完成的作业不再继续执行。

### M094

- 代表位置：`analysis/uni/susp/dynamic/oblivious/reduction.v:78`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_work_conserving:
      susp_aware.work_conserving job_arrival original_job_cost next_suspension arr_seq sched_susp.
```

- 注释：要求调度器在有可执行作业时不让处理器无故空闲，这是典型的工作保守假设。

### M095

- 代表位置：`analysis/uni/susp/dynamic/oblivious/reduction.v:82`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_respects_priority:
      susp_aware.respects_JLDP_policy job_arrival original_job_cost next_suspension
                                      arr_seq sched_susp higher_eq_priority.
```

- 注释：这是一个描述系统模型、调度语义或任务参数约束的假设。

### M096

- 代表位置：`analysis/uni/susp/dynamic/oblivious/reduction.v:87`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_respects_self_suspensions:
      respects_self_suspensions job_arrival original_job_cost next_suspension sched_susp.
```

- 注释：要求调度和作业行为遵守自挂起模型规定的挂起约束。

### M097

- 代表位置：`model/policy_tdma.v:146`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis slot_order_total:
        slot_order_is_total_over_task_set.
```

- 注释：要求 TDMA 槽序关系满足相应的序性质，从而可以合法地比较和排列时隙。

### M098

- 代表位置：`model/policy_tdma.v:150`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis slot_order_antisymmetric:
        slot_order_is_antisymmetric_over_task_set.
```

- 注释：要求 TDMA 槽序关系满足相应的序性质，从而可以合法地比较和排列时隙。

### M099

- 代表位置：`model/policy_tdma.v:154`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis slot_order_transitive:
        slot_order_is_transitive.
```

- 注释：要求 TDMA 槽序关系满足相应的序性质，从而可以合法地比较和排列时隙。

### M100

- 代表位置：`model/policy_tdma.v:88`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis time_slot_positive:
          is_valid_time_slot.
```

- 注释：这是一个描述系统模型、调度语义或任务参数约束的假设。

### M101

- 代表位置：`model/schedule/apa/affinity.v:77`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_subaffinity: is_subaffinity.
```

- 注释：要求系统满足给定的处理器亲和性约束。

### M102

- 代表位置：`model/schedule/apa/constrained_deadlines.v:51`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_respects_JLDP_policy:
        respects_JLDP_policy_under_weak_APA job_arrival job_cost job_task arr_seq
                                            sched alpha higher_eq_priority.
```

- 注释：这是一个描述系统模型、调度语义或任务参数约束的假设。

### M103

- 代表位置：`model/schedule/global/basic/constrained_deadlines.v:47`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_respects_JLDP_policy:
        respects_JLDP_policy job_arrival job_cost arr_seq sched higher_eq_priority.
```

- 注释：这是一个描述系统模型、调度语义或任务参数约束的假设。

### M104

- 代表位置：`model/schedule/global/jitter/constrained_deadlines.v:53`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_respects_JLDP_policy:
          respects_JLDP_policy job_arrival job_cost job_jitter arr_seq sched higher_eq_priority.
```

- 注释：要求系统满足带抖动的到达模型约束。

### M105

- 代表位置：`model/schedule/global/response_time.v:102`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis response_time_bound:
          is_response_time_bound_of_task tsk R.
```

- 注释：把某个值作为任务的响应时间上界来使用。

### M106

- 代表位置：`model/schedule/global/schedulability.v:136`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis no_deadline_misses:
        task_misses_no_deadline job_arrival job_cost job_deadline job_task arr_seq sched tsk.
```

- 注释：要求相关作业或任务不丢截止期，也就是满足可调度性目标。

### M107

- 代表位置：`model/schedule/global/schedulability.v:95`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis no_deadline_miss:
        job_misses_no_deadline job_arrival job_cost job_deadline sched j.
```

- 注释：要求相关作业或任务不丢截止期，也就是满足可调度性目标。

### M108

- 代表位置：`model/schedule/partitioned/schedulability.v:105`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_locally_schedulable:
        forall tsk,
          tsk \in ts -> schedulable_on tsk (assigned_cpu tsk).
```

- 注释：要求相关作业或任务不丢截止期，也就是满足可调度性目标。

### M109

- 代表位置：`model/schedule/uni/end_time.v:102`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_valid_job:
      valid_realtime_job job_cost job_deadline job.
```

- 注释：这是一个描述系统模型、调度语义或任务参数约束的假设。

### M110

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_seq_rta.v:194`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_interference_and_workload_consistent_with_sequential_jobs:
        interference_and_workload_consistent_with_sequential_jobs.
```

- 注释：要求每个作业的执行是串行的，不会在多个处理器上并行运行。

### M111

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_seq_rta.v:250`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_j1_cost_positive: job_cost_positive job_cost j1.
```

- 注释：要求作业执行成本为正，排除零执行时间等退化情况。

### M112

- 代表位置：`model/schedule/uni/limited/busy_interval.v:675`
- 重复出现次数：1
- 原句：

```coq
            Hypothesis H_workload_is_bounded:
              priority_inversion_bound + hp_workload t1 (t1 + delta) <= delta.
```

- 注释：要求优先级反转受到某个界的约束。

### M113

- 代表位置：`model/schedule/uni/limited/edf/nonpr_reg/concrete_models/response_time_bound.v:127`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_respects_policy:
        respects_JLFP_policy_at_preemption_point
          job_arrival job_cost arr_seq sched
          can_be_preempted_for_fully_preemptive_model higher_eq_priority.
```

- 注释：要求调度满足给定的 EDF/JLFP 优先级策略。

### M114

- 代表位置：`model/schedule/uni/limited/edf/nonpr_reg/concrete_models/response_time_bound.v:195`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_respects_policy:
        respects_JLFP_policy_at_preemption_point
          job_arrival job_cost arr_seq sched
          (can_be_preempted_for_fully_nonpreemptive_model job_cost) higher_eq_priority.
```

- 注释：要求调度满足给定的 EDF/JLFP 优先级策略。

### M115

- 代表位置：`model/schedule/uni/limited/edf/response_time_bound.v:143`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_priority_inversion_is_bounded:
      priority_inversion_is_bounded_by
        job_arrival job_cost job_task arr_seq sched EDF tsk priority_inversion_bound.
```

- 注释：要求优先级反转受到某个界的约束。

### M116

- 代表位置：`model/schedule/uni/limited/edf/response_time_bound.v:185`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_R_is_maximum: 
      forall A,
        is_in_search_space A -> 
        exists F,
          A + F = priority_inversion_bound
                  + (task_rbf (A + ε) - (task_cost tsk - task_lock_in_service tsk))
                  + bound_on_total_hep_workload  A (A + F) /\
          F + (task_cost tsk - task_lock_in_service tsk) <= R.
```

- 注释：要求优先级反转受到某个界的约束。

### M117

- 代表位置：`model/schedule/uni/limited/fixed_priority/nonpr_reg/concrete_models/response_time_bound.v:105`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_respects_policy:
        respects_FP_policy_at_preemption_point
          job_arrival job_cost job_task arr_seq sched
          (can_be_preempted_for_fully_preemptive_model) higher_eq_priority. 
```

- 注释：要求调度满足给定的固定优先级策略。

### M118

- 代表位置：`model/schedule/uni/limited/fixed_priority/nonpr_reg/concrete_models/response_time_bound.v:171`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_respects_policy:
        respects_FP_policy_at_preemption_point
          job_arrival job_cost job_task arr_seq sched
          (can_be_preempted_for_fully_nonpreemptive_model job_cost) higher_eq_priority.
```

- 注释：要求调度满足给定的固定优先级策略。

### M119

- 代表位置：`model/schedule/uni/limited/fixed_priority/nonpr_reg/response_time_bound.v:81`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_respects_policy:
      respects_FP_policy_at_preemption_point
        job_arrival job_cost job_task arr_seq sched can_be_preempted higher_eq_priority.
```

- 注释：要求调度满足给定的固定优先级策略。

### M120

- 代表位置：`model/schedule/uni/limited/fixed_priority/response_time_bound.v:145`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_priority_inversion_is_bounded:
      priority_inversion_is_bounded_by
        job_arrival job_cost job_task arr_seq sched jlfp_higher_eq_priority tsk priority_inversion_bound.
```

- 注释：要求优先级反转受到某个界的约束。

### M121

- 代表位置：`model/schedule/uni/limited/fixed_priority/response_time_bound.v:152`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_fixed_point: L = priority_inversion_bound + total_hep_rbf L.
```

- 注释：要求优先级反转受到某个界的约束。

### M122

- 代表位置：`model/schedule/uni/limited/fixed_priority/response_time_bound.v:163`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_R_is_maximum: 
      forall A,
        is_in_search_space A -> 
        exists F,
          A + F = priority_inversion_bound
                  + (task_rbf (A + ε) - (task_cost tsk - task_lock_in_service tsk))
                  + total_ohep_rbf (A + F) /\
          F + (task_cost tsk - task_lock_in_service tsk) <= R.
```

- 注释：要求优先级反转受到某个界的约束。

### M123

- 代表位置：`model/schedule/uni/limited/jlfp_instantiation.v:58`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_JLFP_respects_sequential_jobs:
      JLFP_respects_sequential_jobs
        job_task job_arrival higher_eq_priority.
```

- 注释：要求每个作业的执行是串行的，不会在多个处理器上并行运行。

### M124

- 代表位置：`model/schedule/uni/limited/platform/definitions.v:145`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_correct_preemption_model: correct_preemption_model.
```

- 注释：要求调度满足给定的抢占模型约束。

### M125

- 代表位置：`model/schedule/uni/limited/rbf.v:43`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_proper_arrival_curve:
      proper_arrival_curve job_task arr_seq max_arrivals tsk.
```

- 注释：要求到达曲线或到达曲线族满足 proper 性质，用于给出到达数量的上界模型。

### M126

- 代表位置：`model/schedule/uni/nonpreemptive/schedule.v:35`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_nonpreemptive: is_nonpreemptive_schedule.
```

- 注释：要求调度是非抢占的。

### M127

- 代表位置：`model/schedule/uni/response_time.v:134`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis response_time_bound:
        is_response_time_bound_of_task job_arrival job_cost job_task arr_seq sched tsk R.
```

- 注释：把某个值作为任务的响应时间上界来使用。

### M128

- 代表位置：`model/schedule/uni/response_time.v:91`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis response_time_bound: response_time_bounded_by j R.
```

- 注释：把某个值作为任务的响应时间上界来使用。

### M129

- 代表位置：`model/schedule/uni/schedulability.v:102`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_response_time_bounded: response_time_bounded_by tsk R.
```

- 注释：把某个值作为任务的响应时间上界来使用。

### M130

- 代表位置：`model/schedule/uni/schedule.v:107`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_sequential_jobs: sequential_jobs.
```

- 注释：要求每个作业的执行是串行的，不会在多个处理器上并行运行。

## 2. 与数据结构有关的 Hypothesis（32 条）

### D001

- 代表位置：`analysis/apa/bertogna_edf_comp.v:890`
- 重复出现次数：48
- 原句：

```coq
      Hypothesis H_all_jobs_from_taskset:
        forall j,
          arrives_in arr_seq j -> job_task j \in ts.
```

- 注释：要求到达序列中的每个作业通过 `job_task` 都能映射到任务集 `ts` 中的某个任务；这是连接作业集合和任务集表示的结构性假设。

### D002

- 代表位置：`analysis/apa/bertogna_edf_comp.v:906`
- 重复出现次数：48
- 原句：

```coq
      Hypothesis H_jobs_come_from_arrival_sequence:
        jobs_come_from_arrival_sequence sched arr_seq.
```

- 注释：要求调度里实际出现的作业都来自到达序列 `arr_seq`，从而保证调度行为与输入作业集合一致。

### D003

- 代表位置：`analysis/uni/arrival_curves/workload_bound.v:27`
- 重复出现次数：48
- 原句：

```coq
    Hypothesis H_arrival_times_are_consistent: arrival_times_are_consistent job_arrival arr_seq.
```

- 注释：要求到达序列中的作业记录到达时刻与 `job_arrival` 函数一致，避免序列和时间函数之间出现不一致。

### D004

- 代表位置：`analysis/apa/bertogna_edf_theory.v:127`
- 重复出现次数：45
- 原句：

```coq
      Hypothesis H_j_arrives: arrives_in arr_seq j.
```

- 注释：说明作业属于到达序列 `arr_seq`；这是把作业对象同显式给出的输入到达序列关联起来的基础假设。

### D005

- 代表位置：`analysis/uni/arrival_curves/workload_bound.v:28`
- 重复出现次数：38
- 原句：

```coq
    Hypothesis H_arr_seq_is_a_set: arrival_sequence_is_a_set arr_seq.
```

- 注释：要求到达序列中没有重复作业，从而可以把序列当作集合来使用。

### D006

- 代表位置：`analysis/apa/bertogna_edf_theory.v:128`
- 重复出现次数：31
- 原句：

```coq
      Hypothesis H_job_of_tsk: job_task j = tsk.
```

- 注释：说明作业通过函数 `job_task` 映射到某个任务；这是 Prosa 用函数连接“作业层”和“任务层”对象时需要显式给出的对应关系。

### D007

- 代表位置：`analysis/apa/bertogna_fp_theory.v:95`
- 重复出现次数：24
- 原句：

```coq
    Hypothesis task_in_ts: tsk \in ts.
```

- 注释：说明某个任务属于列表形式表示的任务集 `ts`。这类成员关系在 Prosa 中经常需要显式写出。

### D008

- 代表位置：`analysis/apa/bertogna_edf_theory.v:123`
- 重复出现次数：10
- 原句：

```coq
      Hypothesis H_tsk_R_in_rt_bounds: (tsk, R) \in rt_bounds.
```

- 注释：说明某个 `(任务, 界)` 对已经存在于响应时间界列表 `rt_bounds` 中；这是以列表形式保存分析结果时常见的成员关系假设。

### D009

- 代表位置：`analysis/apa/bertogna_fp_comp.v:284`
- 重复出现次数：8
- 原句：

```coq
      Hypothesis H_task_set_is_sorted: sorted higher_priority ts.
```

- 注释：要求列表已经按优先级关系排序；这通常不是模型本身的一部分，而是因为 Prosa 里任务集常用列表表示，便于递归遍历和程序化分析。

### D010

- 代表位置：`analysis/apa/bertogna_fp_comp.v:285`
- 重复出现次数：8
- 原句：

```coq
      Hypothesis H_task_set_has_unique_priorities:
        FP_is_antisymmetric_over_task_set higher_priority ts.
```

- 注释：要求任务集上的固定优先级关系不存在冲突，保证基于该关系的排序和查找行为是一致的。

### D011

- 代表位置：`analysis/apa/interference_bound_edf.v:185`
- 重复出现次数：6
- 原句：

```coq
    Hypothesis H_tsk_i_in_task_set: tsk_i \in ts.
```

- 注释：说明某个任务属于列表形式表示的任务集 `ts`。这类成员关系在 Prosa 中经常需要显式写出。

### D012

- 代表位置：`analysis/apa/bertogna_edf_comp.v:549`
- 重复出现次数：4
- 原句：

```coq
        Hypothesis H_at_least_one_task: size ts > 0.
```

- 注释：要求列表形式表示的任务集非空；这是某些基于列表递归或选择操作的结构性前提。

### D013

- 代表位置：`analysis/apa/bertogna_edf_theory.v:100`
- 重复出现次数：4
- 原句：

```coq
    Hypothesis H_rt_bounds_contains_all_tasks: unzip1 rt_bounds = ts.
```

- 注释：要求成对保存的分析结果在第一分量上恰好覆盖任务集 `ts`，便于按列表查找每个任务对应的分析结果。

### D014

- 代表位置：`analysis/apa/bertogna_edf_theory.v:177`
- 重复出现次数：4
- 原句：

```coq
        Hypothesis H_response_time_of_tsk_other: (tsk_other, R_other) \in rt_bounds.
```

- 注释：说明某个 `(任务, 界)` 对已经存在于响应时间界列表 `rt_bounds` 中；这是以列表形式保存分析结果时常见的成员关系假设。

### D015

- 代表位置：`analysis/apa/bertogna_fp_theory.v:188`
- 重复出现次数：4
- 原句：

```coq
        Hypothesis H_tsk_other_already_processed: (tsk_other, R_other) \in hp_bounds.
```

- 注释：说明某个 `(任务, 界)` 对已经存在于高优先级任务响应时间界列表 `hp_bounds` 中；这是后续按列表查找已知界时需要的结构性前提。

### D016

- 代表位置：`analysis/apa/interference_bound_edf.v:189`
- 重复出现次数：4
- 原句：

```coq
    Hypothesis H_j_i_arrives: arrives_in arr_seq j_i.
```

- 注释：说明作业属于到达序列 `arr_seq`；这是把作业对象同显式给出的输入到达序列关联起来的基础假设。

### D017

- 代表位置：`analysis/apa/interference_bound_edf.v:190`
- 重复出现次数：4
- 原句：

```coq
    Hypothesis H_job_of_tsk_i: job_task j_i = tsk_i.
```

- 注释：说明作业通过函数 `job_task` 映射到某个任务；这是 Prosa 用函数连接“作业层”和“任务层”对象时需要显式给出的对应关系。

### D018

- 代表位置：`analysis/apa/interference_bound_edf.v:194`
- 重复出现次数：4
- 原句：

```coq
    Hypothesis H_tsk_k_in_task_set: tsk_k \in ts.
```

- 注释：说明某个任务属于列表形式表示的任务集 `ts`。这类成员关系在 Prosa 中经常需要显式写出。

### D019

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_service.v:392`
- 重复出现次数：4
- 原句：

```coq
            Hypothesis H_different_task: job_task j_hp != job_task j.
```

- 注释：说明作业通过函数 `job_task` 映射到某个任务；这是 Prosa 用函数连接“作业层”和“任务层”对象时需要显式给出的对应关系。

### D020

- 代表位置：`analysis/uni/susp/dynamic/oblivious/reduction.v:66`
- 重复出现次数：3
- 原句：

```coq
    Hypothesis H_jobs_come_from_arrival_sequence:
      jobs_come_from_arrival_sequence sched_susp arr_seq.
```

- 注释：要求调度里实际出现的作业都来自到达序列 `arr_seq`，从而保证调度行为与输入作业集合一致。

### D021

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_service.v:338`
- 重复出现次数：2
- 原句：

```coq
          Hypothesis H_arrives: arrives_in arr_seq j_hp.
```

- 注释：说明作业属于到达序列 `arr_seq`；这是把作业对象同显式给出的输入到达序列关联起来的基础假设。

### D022

- 代表位置：`analysis/uni/basic/tdma_wcrt_analysis.v:64`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_job_task: job_task j =tsk.
```

- 注释：说明作业通过函数 `job_task` 映射到某个任务；这是 Prosa 用函数连接“作业层”和“任务层”对象时需要显式给出的对应关系。

### D023

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_service.v:351`
- 重复出现次数：1
- 原句：

```coq
            Hypothesis H_same_task: job_task j_hp = job_task j.
```

- 注释：说明作业通过函数 `job_task` 映射到某个任务；这是 Prosa 用函数连接“作业层”和“任务层”对象时需要显式给出的对应关系。

### D024

- 代表位置：`analysis/uni/susp/dynamic/jitter/taskset_membership.v:243`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_any_j_arrives: arrives_in arr_seq any_j.
```

- 注释：说明作业属于到达序列 `arr_seq`；这是把作业对象同显式给出的输入到达序列关联起来的基础假设。

### D025

- 代表位置：`analysis/uni/susp/dynamic/jitter/taskset_membership.v:251`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_different_task: job_task any_j != tsk_i.
```

- 注释：说明作业通过函数 `job_task` 映射到某个任务；这是 Prosa 用函数连接“作业层”和“任务层”对象时需要显式给出的对应关系。

### D026

- 代表位置：`analysis/uni/susp/dynamic/jitter/taskset_membership.v:98`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_job_of_tsk_i: job_task j = tsk_i.
```

- 注释：说明作业通过函数 `job_task` 映射到某个任务；这是 Prosa 用函数连接“作业层”和“任务层”对象时需要显式给出的对应关系。

### D027

- 代表位置：`model/policy_tdma.v:61`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_task_in_ts: task \in ts. 
```

- 注释：说明某个任务属于列表形式表示的任务集 `ts`。这类成员关系在 Prosa 中经常需要显式写出。

### D028

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_seq_rta.v:246`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_j1_arrives: arrives_in arr_seq j1.
```

- 注释：说明作业属于到达序列 `arr_seq`；这是把作业对象同显式给出的输入到达序列关联起来的基础假设。

### D029

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_seq_rta.v:247`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_j2_arrives: arrives_in arr_seq j2. 
```

- 注释：说明作业属于到达序列 `arr_seq`；这是把作业对象同显式给出的输入到达序列关联起来的基础假设。

### D030

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_seq_rta.v:248`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_j1_from_tsk: job_task j1 = tsk.
```

- 注释：说明作业通过函数 `job_task` 映射到某个任务；这是 Prosa 用函数连接“作业层”和“任务层”对象时需要显式给出的对应关系。

### D031

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_seq_rta.v:249`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_j2_from_tsk: job_task j2 = tsk.
```

- 注释：说明作业通过函数 `job_task` 映射到某个任务；这是 Prosa 用函数连接“作业层”和“任务层”对象时需要显式给出的对应关系。

### D032

- 代表位置：`model/schedule/uni/service.v:123`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_no_duplicate_jobs: uniq jobs.
```

- 注释：要求列表中的元素互异，避免同一对象被重复计入；这是列表被当作集合使用时的典型结构性前提。

## 3. 其他 Hypothesis（247 条）

### O001

- 代表位置：`model/schedule/uni/limited/edf/nonpr_reg/concrete_models/response_time_bound.v:134`
- 重复出现次数：12
- 原句：

```coq
      Hypothesis H_L_positive: L > 0.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O002

- 代表位置：`analysis/apa/interference_bound_edf.v:686`
- 重复出现次数：8
- 原句：

```coq
          Hypothesis H_at_least_two_jobs : size sorted_jobs = num_mid_jobs.+2.
```

- 注释：这是按列表长度或到达数量进行分类讨论时引入的技术性假设。

### O003

- 代表位置：`analysis/apa/bertogna_edf_theory.v:131`
- 重复出现次数：6
- 原句：

```coq
      Hypothesis H_j_not_completed: ~~ completed job_cost sched j (job_arrival j + R).
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O004

- 代表位置：`model/schedule/uni/jitter/busy_interval.v:450`
- 重复出现次数：6
- 原句：

```coq
            Hypothesis H_delta_positive: delta > 0.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O005

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_rta.v:66`
- 重复出现次数：6
- 原句：

```coq
    Hypothesis H_proper_job_lock_in_service:
      proper_job_lock_in_service job_cost arr_seq sched job_lock_in_service.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O006

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_rta.v:71`
- 重复出现次数：6
- 原句：

```coq
    Hypothesis H_proper_task_lock_in_service:
      proper_task_lock_in_service
        task_cost job_task arr_seq job_lock_in_service task_lock_in_service tsk.  
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O007

- 代表位置：`model/schedule/uni/limited/edf/nonpr_reg/concrete_models/response_time_bound.v:135`
- 重复出现次数：6
- 原句：

```coq
      Hypothesis H_fixed_point: L = total_rbf L.
```

- 注释：这是一个不动点条件，用于说明某个候选量满足相应递推方程。

### O008

- 代表位置：`analysis/apa/interference_bound_edf.v:1165`
- 重复出现次数：5
- 原句：

```coq
    Hypothesis H_delta_monotonic: delta <= delta'.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O009

- 代表位置：`analysis/apa/interference_bound_edf.v:1166`
- 重复出现次数：5
- 原句：

```coq
    Hypothesis H_response_time_monotonic: R <= R'.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O010

- 代表位置：`analysis/apa/interference_bound_edf.v:1167`
- 重复出现次数：5
- 原句：

```coq
    Hypothesis H_cost_le_rt_bound: task_cost tsk_other <= R.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O011

- 代表位置：`analysis/apa/bertogna_edf_comp.v:552`
- 重复出现次数：4
- 原句：

```coq
        Hypothesis H_keeps_diverging:
          forall k,
            k <= max_steps ts -> f k != f k.+1.
```

- 注释：这是关于迭代序列持续变化或不收敛情况的技术性假设，常用于反证或终止性分析。

### O012

- 代表位置：`analysis/apa/bertogna_edf_comp.v:881`
- 重复出现次数：4
- 原句：

```coq
      Hypothesis H_non_empty_affinity:
        forall tsk, tsk \in ts -> #|alpha' tsk| > 0.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O013

- 代表位置：`analysis/apa/bertogna_fp_comp.v:294`
- 重复出现次数：4
- 原句：

```coq
      Hypothesis H_analysis_succeeds: fp_claimed_bounds ts = Some hp_bounds.
```

- 注释：这是关于分析函数或判定过程成功返回的技术性假设。

### O014

- 代表位置：`analysis/apa/bertogna_fp_comp.v:326`
- 重复出现次数：4
- 原句：

```coq
      Hypothesis H_test_succeeds: fp_claimed_bounds ts_hp = Some rt_bounds.
```

- 注释：这是关于分析函数或判定过程成功返回的技术性假设。

### O015

- 代表位置：`analysis/apa/bertogna_fp_comp.v:339`
- 重复出现次数：4
- 原句：

```coq
      Hypothesis H_no_larger_than_deadline: f (max_steps tsk) <= task_deadline tsk.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O016

- 代表位置：`analysis/apa/bertogna_fp_comp.v:389`
- 重复出现次数：4
- 原句：

```coq
        Hypothesis H_keeps_diverging:
          forall k,
            k <= max_steps tsk -> f k != f k.+1.
```

- 注释：这是关于迭代序列持续变化或不收敛情况的技术性假设，常用于反证或终止性分析。

### O017

- 代表位置：`analysis/apa/bertogna_fp_theory.v:144`
- 重复出现次数：4
- 原句：

```coq
    Hypothesis H_response_time_no_larger_than_deadline:
      R <= task_deadline tsk.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O018

- 代表位置：`analysis/apa/interference_bound_edf.v:202`
- 重复出现次数：4
- 原句：

```coq
    Hypothesis H_delta_le_deadline: delta <= task_deadline tsk_i.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O019

- 代表位置：`analysis/apa/interference_bound_edf.v:343`
- 重复出现次数：4
- 原句：

```coq
        Hypothesis H_few_jobs: size sorted_jobs <= n_k.
```

- 注释：这是按列表长度或到达数量进行分类讨论时引入的技术性假设。

### O020

- 代表位置：`analysis/apa/interference_bound_edf.v:366`
- 重复出现次数：4
- 原句：

```coq
        Hypothesis H_many_jobs: n_k < size sorted_jobs.
```

- 注释：这是按列表长度或到达数量进行分类讨论时引入的技术性假设。

### O021

- 代表位置：`analysis/apa/interference_bound_edf.v:441`
- 重复出现次数：4
- 原句：

```coq
          Hypothesis H_only_one_job: size sorted_jobs = 1.
```

- 注释：这是按列表长度或到达数量进行分类讨论时引入的技术性假设。

### O022

- 代表位置：`analysis/apa/workload_bound.v:317`
- 重复出现次数：4
- 原句：

```coq
        Hypothesis H_at_least_one_job: size sorted_jobs > 0.
```

- 注释：这是按列表长度或到达数量进行分类讨论时引入的技术性假设。

### O023

- 代表位置：`analysis/apa/workload_bound.v:51`
- 重复出现次数：4
- 原句：

```coq
    Hypothesis H_R_lower_bound: R1 >= task_cost tsk.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O024

- 代表位置：`analysis/apa/workload_bound.v:52`
- 重复出现次数：4
- 原句：

```coq
    Hypothesis H_R1_le_R2: R1 <= R2.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O025

- 代表位置：`analysis/uni/basic/fp_rta_comp.v:200`
- 重复出现次数：4
- 原句：

```coq
          Hypothesis H_cost_positive: task_cost tsk > 0.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O026

- 代表位置：`analysis/uni/jitter/fp_rta_comp.v:297`
- 重复出现次数：4
- 原句：

```coq
    Hypothesis H_job_deadline_eq_task_deadline:
      forall j,
        arrives_in arr_seq j ->
        job_deadline j = task_deadline (job_task j).
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O027

- 代表位置：`analysis/uni/susp/dynamic/oblivious/reduction.v:474`
- 重复出现次数：4
- 原句：

```coq
          Hypothesis H_j_has_arrived: has_arrived job_arrival j t.
```

- 注释：说明某个具体作业在特定时刻是否已经到达或仍在某种局部状态中，这是推进当前证明分支所需的状态性假设。

### O028

- 代表位置：`analysis/uni/susp/sustainability/singlecost/reduction_properties.v:604`
- 重复出现次数：4
- 原句：

```coq
      Hypothesis H_cost_j_positive: job_cost j > 0.
```

- 注释：这是可持续性或系统变换证明中的技术性假设，用于比较原系统和变换后系统的对应关系。

### O029

- 代表位置：`implementation/apa/schedule.v:157`
- 重复出现次数：4
- 原句：

```coq
    Hypothesis H_priority_total: forall t, total (higher_eq_priority t).
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O030

- 代表位置：`model/schedule/apa/constrained_deadlines.v:84`
- 重复出现次数：4
- 原句：

```coq
      Hypothesis H_j_backlogged: backlogged job_arrival job_cost sched j t.
```

- 注释：说明某个具体作业在特定时刻是否已经到达或仍在某种局部状态中，这是推进当前证明分支所需的状态性假设。

### O031

- 代表位置：`model/schedule/uni/jitter/busy_interval.v:150`
- 重复出现次数：4
- 原句：

```coq
        Hypothesis H_quiet: quiet_time t1.
```

- 注释：说明某个具体作业在特定时刻是否已经到达或仍在某种局部状态中，这是推进当前证明分支所需的状态性假设。

### O032

- 代表位置：`model/schedule/uni/limited/edf/nonpr_reg/concrete_models/response_time_bound.v:273`
- 重复出现次数：4
- 原句：

```coq
      Hypothesis H_schedule_with_limited_preemptions:
        is_schedule_with_limited_preemptions arr_seq job_preemption_points sched.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O033

- 代表位置：`model/schedule/uni/limited/fixed_priority/nonpr_reg/concrete_models/response_time_bound.v:184`
- 重复出现次数：4
- 原句：

```coq
      Hypothesis H_fixed_point: L = blocking_bound + total_hep_rbf L.
```

- 注释：这是一个不动点条件，用于说明某个候选量满足相应递推方程。

### O034

- 代表位置：`util/pick.v:66`
- 重复出现次数：4
- 原句：

```coq
  Hypothesis EX: exists x, x < n /\ p x.
```

- 注释：这是通用工具库引理的技术性前提，用于关系、序列或计数等基础证明，与具体调度模型无关。

### O035

- 代表位置：`analysis/apa/bertogna_edf_theory.v:134`
- 重复出现次数：3
- 原句：

```coq
      Hypothesis H_all_previous_jobs_completed_on_time :
        forall j_other tsk_other R_other,
          arrives_in arr_seq j_other ->
          job_task j_other = tsk_other ->
          (tsk_other, R_other) \in rt_bounds ->
          job_arrival j_other + R_other < job_arrival j + R ->
          completed job_cost sched j_other (job_arrival j_other + R_other).
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O036

- 代表位置：`analysis/apa/bertogna_fp_theory.v:124`
- 重复出现次数：3
- 原句：

```coq
    Hypothesis H_response_time_bounds_ge_cost:
      forall hp_tsk R,
        (hp_tsk, R) \in hp_bounds -> R >= task_cost hp_tsk.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O037

- 代表位置：`analysis/apa/bertogna_fp_theory.v:157`
- 重复出现次数：3
- 原句：

```coq
      Hypothesis H_previous_jobs_of_tsk_completed :
        forall j0,
          arrives_in arr_seq j0 ->
          job_task j0 = tsk ->
          job_arrival j0 < job_arrival j ->
          completed job_cost sched j0 (job_arrival j0 + R).
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O038

- 代表位置：`analysis/apa/interference_bound_edf.v:198`
- 重复出现次数：3
- 原句：

```coq
    Hypothesis H_R_k_le_deadline: R_k <= task_deadline tsk_k.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O039

- 代表位置：`analysis/apa/interference_bound_edf.v:205`
- 重复出现次数：3
- 原句：

```coq
    Hypothesis H_all_previous_jobs_completed_on_time :
      forall j_k,
        arrives_in arr_seq j_k ->
        job_task j_k = tsk_k ->
        job_arrival j_k + R_k < job_arrival j_i + delta ->
        completed job_cost sched j_k (job_arrival j_k + R_k).
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O040

- 代表位置：`analysis/apa/workload_bound.v:193`
- 重复出现次数：3
- 原句：

```coq
    Hypothesis H_response_time_bound :    
      forall j,
        arrives_in arr_seq j ->
        job_task j = tsk ->
        job_arrival j + R_tsk < t1 + delta ->
        job_has_completed_by j (job_arrival j + R_tsk).
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O041

- 代表位置：`analysis/apa/workload_bound.v:201`
- 重复出现次数：3
- 原句：

```coq
    Hypothesis H_response_time_ge_cost: R_tsk >= task_cost tsk.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O042

- 代表位置：`analysis/global/basic/bertogna_edf_theory.v:95`
- 重复出现次数：3
- 原句：

```coq
    Hypothesis H_response_time_is_fixed_point :
      forall tsk R,
        (tsk, R) \in rt_bounds ->
        R = task_cost tsk + div_floor (I tsk R) num_cpus.
```

- 注释：这是一个不动点条件，用于说明某个候选量满足相应递推方程。

### O043

- 代表位置：`analysis/global/basic/bertogna_fp_theory.v:105`
- 重复出现次数：3
- 原句：

```coq
    Hypothesis H_hp_bounds_has_interfering_tasks:
      forall hp_tsk,
        hp_tsk \in ts ->
        is_hp_task hp_tsk ->
          exists R, (hp_tsk, R) \in hp_bounds.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O044

- 代表位置：`analysis/uni/susp/dynamic/jitter/rta_by_reduction.v:86`
- 重复出现次数：3
- 原句：

```coq
    Hypothesis H_positive_costs:
      forall j, arrives_in arr_seq j -> job_cost j > 0.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O045

- 代表位置：`model/schedule/apa/constrained_deadlines.v:182`
- 重复出现次数：3
- 原句：

```coq
      Hypothesis H_t_before_period: t < job_arrival j + task_period tsk.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O046

- 代表位置：`model/schedule/apa/constrained_deadlines.v:196`
- 重复出现次数：3
- 原句：

```coq
      Hypothesis H_all_previous_jobs_of_tsk_completed :
        forall j0,
          arrives_in arr_seq j0 ->
          job_task j0 = tsk ->
          job_arrival j0 < job_arrival j ->
          completed job_cost sched j0 (job_arrival j0 + task_period tsk).
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O047

- 代表位置：`model/schedule/apa/constrained_deadlines.v:87`
- 重复出现次数：3
- 原句：

```coq
      Hypothesis H_all_previous_jobs_completed :
        forall j_other tsk_other,
          arrives_in arr_seq j_other ->
          job_task j_other = tsk_other ->
          job_arrival j_other + task_period tsk_other <= t ->
          completed job_cost sched j_other (job_arrival j_other + task_period (job_task j_other)).
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O048

- 代表位置：`model/schedule/global/jitter/schedule.v:65`
- 重复出现次数：3
- 原句：

```coq
      Hypothesis H_jobs_execute_after_jitter:
        jobs_execute_after_jitter.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O049

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_rta.v:130`
- 重复出现次数：3
- 原句：

```coq
      Hypothesis H_busy_interval: busy_interval j t1 t2.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O050

- 代表位置：`model/schedule/uni/limited/edf/nonpr_reg/response_time_bound.v:71`
- 重复出现次数：3
- 原句：

```coq
    Hypothesis H_model_with_bounded_nonpreemptive_segments:
      model_with_bounded_nonpreemptive_segments
        job_cost job_task arr_seq can_be_preempted job_max_nps task_max_nps.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O051

- 代表位置：`analysis/apa/bertogna_fp_theory.v:129`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_interfering_tasks_miss_no_deadlines:
      forall hp_tsk R,
        (hp_tsk, R) \in hp_bounds -> R <= task_deadline hp_tsk.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O052

- 代表位置：`analysis/apa/interference_bound_edf.v:464`
- 重复出现次数：2
- 原句：

```coq
            Hypothesis H_j_fst_completed_by_rt_bound :
              completed job_cost sched j_fst (a_fst + R_k).
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O053

- 代表位置：`analysis/apa/interference_bound_edf.v:565`
- 重复出现次数：2
- 原句：

```coq
            Hypothesis H_j_fst_not_complete_by_rt_bound :
              ~~ completed job_cost sched j_fst (a_fst + R_k).
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O054

- 代表位置：`analysis/apa/workload_bound.v:202`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_no_deadline_miss: R_tsk <= task_deadline tsk.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O055

- 代表位置：`analysis/global/basic/bertogna_edf_theory.v:101`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_tasks_miss_no_deadlines:
      forall tsk_other R,
        (tsk_other, R) \in rt_bounds -> R <= task_deadline tsk_other.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O056

- 代表位置：`analysis/global/jitter/bertogna_edf_theory.v:132`
- 重复出现次数：2
- 原句：

```coq
      Hypothesis H_j_not_completed: ~~ completed job_cost sched j (t1 + R).
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O057

- 代表位置：`analysis/uni/arrival_curves/workload_bound.v:110`
- 重复出现次数：2
- 原句：

```coq
      Hypothesis H_job_cost_le_task_cost:
        forall j,
          arrives_in arr_seq j ->
          job_cost_le_task_cost task_cost job_cost job_task j.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O058

- 代表位置：`analysis/uni/basic/fp_rta_comp.v:81`
- 重复出现次数：2
- 原句：

```coq
      Hypothesis H_analysis_succeeds:
        fp_claimed_bounds ts = Some rt_bounds.
```

- 注释：这是关于分析函数或判定过程成功返回的技术性假设。

### O059

- 代表位置：`analysis/uni/basic/fp_rta_theory.v:88`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_R_positive: R > 0.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O060

- 代表位置：`analysis/uni/basic/fp_rta_theory.v:89`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_response_time_is_fixed_point: R = W R.
```

- 注释：这是一个不动点条件，用于说明某个候选量满足相应递推方程。

### O061

- 代表位置：`analysis/uni/basic/workload_bound_fp.v:200`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_fixed_point: R = workload_bound R.
```

- 注释：这是一个不动点条件，用于说明某个候选量满足相应递推方程。

### O062

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_service.v:228`
- 重复出现次数：2
- 原句：

```coq
        Hypothesis H_before_end_of_interval: t <= arr_j + R_j.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O063

- 代表位置：`model/arrival/basic/task_arrival.v:191`
- 重复出现次数：2
- 原句：

```coq
      Hypothesis H_at_least_one_job:
        num_arrivals >= 1.
```

- 注释：这是按列表长度或到达数量进行分类讨论时引入的技术性假设。

### O064

- 代表位置：`model/schedule/global/basic/constrained_deadlines.v:254`
- 重复出现次数：2
- 原句：

```coq
      Hypothesis H_all_previous_jobs_completed :
        forall j_other tsk_other,
          arrives_in arr_seq j_other ->
          job_task j_other = tsk_other ->
          is_hp_task tsk_other ->
          completed job_cost sched j_other (job_arrival j_other + task_period tsk_other).
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O065

- 代表位置：`model/schedule/global/jitter/constrained_deadlines.v:89`
- 重复出现次数：2
- 原句：

```coq
        Hypothesis H_j_backlogged: job_is_backlogged j t.
```

- 注释：说明某个具体作业在特定时刻是否已经到达或仍在某种局部状态中，这是推进当前证明分支所需的状态性假设。

### O066

- 代表位置：`model/schedule/uni/jitter/busy_interval.v:149`
- 重复出现次数：2
- 原句：

```coq
        Hypothesis H_interval: t1 <= t2.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O067

- 代表位置：`model/schedule/uni/jitter/busy_interval.v:151`
- 重复出现次数：2
- 原句：

```coq
        Hypothesis H_not_quiet: ~ quiet_time t2.
```

- 注释：说明某个具体作业在特定时刻是否已经到达或仍在某种局部状态中，这是推进当前证明分支所需的状态性假设。

### O068

- 代表位置：`model/schedule/uni/jitter/busy_interval.v:354`
- 重复出现次数：2
- 原句：

```coq
          Hypothesis H_j_is_pending: job_pending_at j t_busy.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O069

- 代表位置：`model/schedule/uni/jitter/busy_interval.v:444`
- 重复出现次数：2
- 原句：

```coq
            Hypothesis H_is_busy_prefix: busy_interval_prefix t1 t_busy.+1.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O070

- 代表位置：`model/schedule/uni/jitter/busy_interval.v:460`
- 重复出现次数：2
- 原句：

```coq
              Hypothesis H_no_quiet_time:
                forall t, t1 < t <= t1 + delta -> ~ quiet_time t.
```

- 注释：说明某个具体作业在特定时刻是否已经到达或仍在某种局部状态中，这是推进当前证明分支所需的状态性假设。

### O071

- 代表位置：`model/schedule/uni/jitter/busy_interval.v:637`
- 重复出现次数：2
- 原句：

```coq
          Hypothesis H_workload_is_bounded:
            forall t, actual_hp_workload t (t + delta) <= delta.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O072

- 代表位置：`model/schedule/uni/jitter/busy_interval.v:88`
- 重复出现次数：2
- 原句：

```coq
        Hypothesis H_busy_interval: busy_interval t1 t2.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O073

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_rta.v:96`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_busy_interval_exists: busy_intervals_are_bounded_by interference interfering_workload L.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O074

- 代表位置：`model/schedule/uni/limited/edf/nonpr_reg/concrete_models/response_time_bound.v:501`
- 重复出现次数：2
- 原句：

```coq
      Hypothesis H_task_model_with_floating_nonpreemptive_regions:
        model_with_floating_nonpreemptive_regions
          job_cost job_task arr_seq job_preemption_points task_max_nps.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O075

- 代表位置：`model/schedule/uni/limited/edf/response_time_bound.v:515`
- 重复出现次数：2
- 原句：

```coq
        Hypothesis H_A_is_in_abstract_search_space:
          AbstractRTAReduction.is_in_search_space tsk L total_interference_bound A.
```

- 注释：这是抽象 RTA 搜索空间中的技术性条件，用于限制候选点的取值范围。

### O076

- 代表位置：`model/schedule/uni/susp/last_execution.v:323`
- 重复出现次数：2
- 原句：

```coq
        Hypothesis H_j_has_completed: completed_by job_cost sched j t.
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O077

- 代表位置：`util/minmax.v:86`
- 重复出现次数：2
- 原句：

```coq
        Hypothesis H_transitive: transitive rel.
```

- 注释：这是通用工具库引理的技术性前提，用于关系、序列或计数等基础证明，与具体调度模型无关。

### O078

- 代表位置：`analysis/apa/bertogna_edf_theory.v:107`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_response_time_is_fixed_point :
      forall tsk R,
        (tsk, R) \in rt_bounds ->
        R = task_cost tsk + div_floor (I tsk R) #|alpha' tsk|.
```

- 注释：这是一个不动点条件，用于说明某个候选量满足相应递推方程。

### O079

- 代表位置：`analysis/apa/bertogna_edf_theory.v:113`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_tasks_miss_no_deadlines:
      forall tsk R,
        (tsk, R) \in rt_bounds -> R <= task_deadline tsk.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O080

- 代表位置：`analysis/apa/bertogna_fp_theory.v:116`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_hp_bounds_has_interfering_tasks:
      forall hp_tsk,
        hp_tsk \in ts ->
        hp_task_in (alpha tsk) hp_tsk ->
        exists R,
          (hp_tsk, R) \in hp_bounds.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O081

- 代表位置：`analysis/apa/bertogna_fp_theory.v:136`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_response_time_recurrence_holds :
      R = task_cost tsk +
          div_floor
            (total_interference_bound_fp task_cost task_period alpha tsk
                            (alpha' tsk) hp_bounds R higher_eq_priority)
            #|alpha' tsk|.
```

- 注释：这是一个不动点条件，用于说明某个候选量满足相应递推方程。

### O082

- 代表位置：`analysis/apa/bertogna_fp_theory.v:189`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_tsk_other_has_higher_priority: hp_task_in (alpha tsk) tsk_other.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O083

- 代表位置：`analysis/global/basic/bertogna_fp_theory.v:123`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_response_time_recurrence_holds :
      R = task_cost tsk +
          div_floor
            (total_interference_bound_fp task_cost task_period tsk hp_bounds R)
            num_cpus.
```

- 注释：这是一个不动点条件，用于说明某个候选量满足相应递推方程。

### O084

- 代表位置：`analysis/global/jitter/bertogna_edf_theory.v:110`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_tasks_miss_no_deadlines:
      forall tsk R,
        (tsk, R) \in rt_bounds ->
        task_jitter tsk + R <= task_deadline tsk.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O085

- 代表位置：`analysis/global/jitter/bertogna_edf_theory.v:135`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_all_previous_jobs_completed_on_time :
        forall j_other tsk_other R_other,
          arrives_in arr_seq j_other ->
          job_task j_other = tsk_other ->
          (tsk_other, R_other) \in rt_bounds ->
          job_arrival j_other + task_jitter tsk_other + R_other < job_arrival j + task_jitter tsk + R ->
          completed job_cost sched j_other (job_arrival j_other + task_jitter tsk_other + R_other).
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O086

- 代表位置：`analysis/global/jitter/bertogna_fp_theory.v:125`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_interfering_tasks_miss_no_deadlines:
      forall hp_tsk R,
        (hp_tsk, R) \in hp_bounds ->
        task_jitter hp_tsk + R <= task_deadline hp_tsk.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O087

- 代表位置：`analysis/global/jitter/bertogna_fp_theory.v:132`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_response_time_recurrence_holds :
      R = task_cost tsk +
          div_floor
            (total_interference_bound_fp task_cost task_period task_jitter
                                         tsk hp_bounds R)
            num_cpus.
```

- 注释：这是一个不动点条件，用于说明某个候选量满足相应递推方程。

### O088

- 代表位置：`analysis/global/jitter/bertogna_fp_theory.v:140`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_response_time_no_larger_than_deadline:
      task_jitter tsk + R <= task_deadline tsk.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O089

- 代表位置：`analysis/global/jitter/bertogna_fp_theory.v:156`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_previous_jobs_of_tsk_completed :
        forall j0,
          arrives_in arr_seq j0 ->
          job_task j0 = tsk ->
          job_arrival j0 < job_arrival j ->
          completed job_cost sched j0 (job_arrival j0 + task_jitter tsk + R).
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O090

- 代表位置：`analysis/global/jitter/interference_bound_edf.v:189`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_R_k_le_deadline: task_jitter tsk_k + R_k <= task_deadline tsk_k.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O091

- 代表位置：`analysis/global/jitter/interference_bound_edf.v:196`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_all_previous_jobs_completed_on_time :
      forall j_k,
        arrives_in arr_seq j_k ->
        job_task j_k = tsk_k ->
        job_arrival j_k + task_jitter tsk_k + R_k < job_arrival j_i + task_jitter tsk_i + delta ->
        completed job_cost sched j_k (job_arrival j_k + task_jitter tsk_k + R_k).
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O092

- 代表位置：`analysis/global/jitter/interference_bound_edf.v:465`
- 重复出现次数：1
- 原句：

```coq
            Hypothesis H_j_fst_completed_by_rt_bound :
              completed job_cost sched j_fst (a_fst + J_k + R_k).
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O093

- 代表位置：`analysis/global/jitter/interference_bound_edf.v:603`
- 重复出现次数：1
- 原句：

```coq
            Hypothesis H_j_fst_not_complete_by_rt_bound :
              ~~ completed job_cost sched j_fst (a_fst + J_k + R_k).
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O094

- 代表位置：`analysis/global/jitter/workload_bound.v:205`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_no_deadline_miss: task_jitter tsk + R_tsk <= task_deadline tsk.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O095

- 代表位置：`analysis/global/jitter/workload_bound.v:207`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_response_time_bound :    
      forall j,
        arrives_in arr_seq j ->
        job_task j = tsk ->
        job_arrival j + task_jitter tsk + R_tsk < t1 + delta ->
        job_has_completed_by j (job_arrival j + task_jitter tsk + R_tsk).
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O096

- 代表位置：`analysis/global/parallel/bertogna_fp_theory.v:115`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_response_time_recurrence_holds :
      R = task_cost tsk +
          div_floor
            (total_interference_bound_fp task_cost task_period hp_bounds R)
            num_cpus.
```

- 注释：这是一个不动点条件，用于说明某个候选量满足相应递推方程。

### O097

- 代表位置：`analysis/uni/arrival_curves/workload_bound.v:121`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_is_arrival_bound:
        is_arrival_bound_for_taskset job_task arr_seq max_arrivals ts. 
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O098

- 代表位置：`analysis/uni/basic/tdma_rta_theory.v:85`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis WCRT_le_period:
      WCRT task_cost task_time_slot ts tsk <= task_period tsk.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O099

- 代表位置：`analysis/uni/basic/tdma_wcrt_analysis.v:134`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis all_previous_jobs_of_same_task_completed :
      forall j_other,
        arrives_in arr_seq j_other ->
        job_task j = job_task j_other ->
        job_arrival j_other < job_arrival j ->
        completed_by job_cost sched j_other (job_arrival j).
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O100

- 代表位置：`analysis/uni/basic/tdma_wcrt_analysis.v:731`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_job_cost_le_task_cost: job_cost_le_task_cost task_cost job_cost job_task j.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O101

- 代表位置：`analysis/uni/jitter/fp_rta_comp.v:266`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_positive_costs: forall tsk, tsk \in ts -> task_cost tsk > 0.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O102

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_service.v:1157`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_j_not_completed:
          ~~ job_completed_in_sched_susp j (arr_j + R_j).
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O103

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_service.v:1222`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_response_time_of_j_in_sched_jitter:
        job_response_time_in_sched_jitter_bounded_by j R_j.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O104

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_service.v:124`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_bounded_response_time_of_hp_jobs:
      forall j_hp,
        arrives_in arr_seq j_hp ->
        other_hep_task (job_task j_hp) ->
        job_response_time_in_sched_susp_bounded_by j_hp (R_hp j_hp).
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O105

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_service.v:339`
- 重复出现次数：1
- 原句：

```coq
          Hypothesis H_higher_or_equal_priority: other_higher_eq_priority_job j_hp.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O106

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_service.v:395`
- 重复出现次数：1
- 原句：

```coq
            Hypothesis H_released_no_earlier: arr_j <= actual_job_arrival j_hp.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O107

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_service.v:416`
- 重复出现次数：1
- 原句：

```coq
            Hypothesis H_distance_is_smaller:
              arr_j - arr_hp < Rhp - cost_hp.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O108

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_service.v:444`
- 重复出现次数：1
- 原句：

```coq
            Hypothesis H_completes_before_j_arrives: arr_hp + Rhp <= arr_j.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O109

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_service.v:472`
- 重复出现次数：1
- 原句：

```coq
            Hypothesis H_released_before: actual_job_arrival j_hp < arr_j.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O110

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_service.v:475`
- 重复出现次数：1
- 原句：

```coq
            Hypothesis H_j_hp_completes_after_j_arrives: arr_j < arr_hp + Rhp.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O111

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_service.v:476`
- 重复出现次数：1
- 原句：

```coq
            Hypothesis H_distance_is_not_smaller: Rhp - cost_hp <= arr_j - arr_hp.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O112

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_service.v:610`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_no_earlier_than_j: t >= arr_j.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O113

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_service.v:695`
- 重复出现次数：1
- 原句：

```coq
          Hypothesis H_d_lt_R: d < R_j.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O114

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_service.v:700`
- 重复出现次数：1
- 原句：

```coq
          Hypothesis H_induction_hypothesis:
            service_of_other_hep_jobs_in_sched_susp arr_j (arr_j + d) <=
            service_of_other_hep_jobs_in_sched_jitter arr_j (arr_j + d).
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O115

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_service.v:716`
- 重复出现次数：1
- 原句：

```coq
            Hypothesis H_all_jobs_completed_in_sched_jitter:
              forall j_hp,
                arrives_in arr_seq j_hp ->
                other_higher_eq_priority_job j_hp ->
                job_has_actually_arrived j_hp (arr_j + d) ->
                job_completed_in_sched_jitter j_hp (arr_j + d). 
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O116

- 代表位置：`analysis/uni/susp/dynamic/jitter/jitter_schedule_service.v:892`
- 重复出现次数：1
- 原句：

```coq
            Hypothesis H_there_are_pending_jobs_in_sched_jitter:
              exists j_hp,
                arrives_in arr_seq j_hp /\
                other_higher_eq_priority_job j_hp /\
                job_has_actually_arrived j_hp (arr_j + d) /\
                ~~ job_completed_in_sched_jitter j_hp (arr_j + d). 
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O117

- 代表位置：`analysis/uni/susp/dynamic/jitter/rta_by_reduction.v:118`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_valid_response_time_bound_of_hp_tasks:
      forall tsk_hp,
        tsk_hp \in ts ->
        other_hep_task tsk_hp ->
        task_response_time_in_sched_susp_bounded_by tsk_hp (R tsk_hp).
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O118

- 代表位置：`analysis/uni/susp/dynamic/jitter/rta_by_reduction.v:164`
- 重复出现次数：1
- 原句：

```coq
    (** Central Hypothesis *)
    
    (* Assume that using some jitter-aware RTA, we determine that
       (R tsk) is a response-time bound for tsk in sched_jitter. *)
    Hypothesis H_valid_response_time_bound_in_sched_jitter:
      job_response_time_in_sched_jitter_bounded_by j (R tsk).
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O119

- 代表位置：`analysis/uni/susp/dynamic/jitter/taskset_membership.v:250`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_higher_priority: higher_eq_priority (job_task any_j) tsk_i.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O120

- 代表位置：`analysis/uni/susp/dynamic/jitter/taskset_rta.v:110`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_R_le_deadline: R tsk_i <= task_deadline tsk_i.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O121

- 代表位置：`analysis/uni/susp/dynamic/oblivious/reduction.v:449`
- 重复出现次数：1
- 原句：

```coq
          Hypothesis H_induction_hypothesis:
            forall j,
              arrives_in arr_seq j ->
              job_service_without_suspensions j t <=
              job_service_with_suspensions j t + job_cumulative_suspension j t.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O122

- 代表位置：`analysis/uni/susp/dynamic/oblivious/reduction.v:481`
- 重复出现次数：1
- 原句：

```coq
            Hypothesis H_j_has_completed:
              completed_by original_job_cost sched_susp j t.
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O123

- 代表位置：`analysis/uni/susp/dynamic/oblivious/reduction.v:511`
- 重复出现次数：1
- 原句：

```coq
            Hypothesis H_j_is_pending:
              ~~ completed_by original_job_cost sched_susp j t.
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O124

- 代表位置：`analysis/uni/susp/dynamic/oblivious/reduction.v:547`
- 重复出现次数：1
- 原句：

```coq
              Hypothesis H_j_scheduled_in_new: scheduled_at sched_new j t.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O125

- 代表位置：`analysis/uni/susp/dynamic/oblivious/reduction.v:548`
- 重复出现次数：1
- 原句：

```coq
              Hypothesis H_j_not_scheduled_in_susp: ~~ scheduled_at sched_susp j t.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O126

- 代表位置：`analysis/uni/susp/dynamic/oblivious/reduction.v:555`
- 重复出现次数：1
- 原句：

```coq
                Hypothesis H_j_is_not_suspended: ~~ job_suspended_at sched_susp j t. 
```

- 注释：说明某个具体作业在特定时刻是否已经到达或仍在某种局部状态中，这是推进当前证明分支所需的状态性假设。

### O127

- 代表位置：`analysis/uni/susp/dynamic/oblivious/reduction.v:583`
- 重复出现次数：1
- 原句：

```coq
                Hypothesis H_j_hp_is_scheduled: scheduled_at sched_susp j_hp t.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O128

- 代表位置：`analysis/uni/susp/dynamic/oblivious/reduction.v:584`
- 重复出现次数：1
- 原句：

```coq
                Hypothesis H_higher_or_equal_priority: higher_eq_priority t j_hp j.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O129

- 代表位置：`analysis/uni/susp/sustainability/allcosts/reduction_properties.v:261`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_before_R: t <= arr_j + R.
```

- 注释：这是可持续性或系统变换证明中的技术性假设，用于比较原系统和变换后系统的对应关系。

### O130

- 代表位置：`analysis/uni/susp/sustainability/allcosts/reduction_properties.v:90`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_job_costs_do_not_decrease:
      forall any_j, inflated_job_cost any_j >= job_cost any_j.
```

- 注释：这是可持续性或系统变换证明中的技术性假设，用于比较原系统和变换后系统的对应关系。

### O131

- 代表位置：`analysis/uni/susp/sustainability/singlecost/reduction_properties.v:385`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_j_has_not_completed: ~~ completed_in_sched_susp j t.
```

- 注释：这是可持续性或系统变换证明中的技术性假设，用于比较原系统和变换后系统的对应关系。

### O132

- 代表位置：`analysis/uni/susp/sustainability/singlecost/reduction_properties.v:390`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_schedules_are_the_same:
          forall k any_j,
            k < t ->
            scheduled_at sched_susp any_j k = scheduled_at sched_susp_highercost any_j k.
```

- 注释：这是可持续性或系统变换证明中的技术性假设，用于比较原系统和变换后系统的对应关系。

### O133

- 代表位置：`analysis/uni/susp/sustainability/singlecost/reduction_properties.v:397`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_k_before_t: k <= t.
```

- 注释：这是可持续性或系统变换证明中的技术性假设，用于比较原系统和变换后系统的对应关系。

### O134

- 代表位置：`analysis/uni/susp/sustainability/singlecost/reduction_properties.v:608`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_response_time_bound_in_sched_susp:
        job_response_time_in_sched_susp_bounded_by j r.
```

- 注释：这是可持续性或系统变换证明中的技术性假设，用于比较原系统和变换后系统的对应关系。

### O135

- 代表位置：`analysis/uni/susp/sustainability/singlecost/reduction_properties.v:610`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_response_time_bound_is_tight:
        forall r', job_response_time_in_sched_susp_bounded_by j r' -> r <= r'.
```

- 注释：这是可持续性或系统变换证明中的技术性假设，用于比较原系统和变换后系统的对应关系。

### O136

- 代表位置：`analysis/uni/susp/sustainability/singlecost/reduction_properties.v:615`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_response_time_bound_in_sched_susp_highercost:
        job_response_time_in_sched_susp_highercost_bounded_by j R.
```

- 注释：这是可持续性或系统变换证明中的技术性假设，用于比较原系统和变换后系统的对应关系。

### O137

- 代表位置：`analysis/uni/susp/sustainability/singlecost/reduction_properties.v:81`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_cost_of_j_does_not_decrease: inflated_job_cost j >= job_cost j.
```

- 注释：这是可持续性或系统变换证明中的技术性假设，用于比较原系统和变换后系统的对应关系。

### O138

- 代表位置：`analysis/uni/susp/sustainability/singlecost/reduction_properties.v:84`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_inflation_only_for_job_j:
      forall any_j,
        any_j != j ->
        inflated_job_cost any_j = job_cost any_j.
```

- 注释：这是可持续性或系统变换证明中的技术性假设，用于比较原系统和变换后系统的对应关系。

### O139

- 代表位置：`implementation/uni/basic/schedule.v:99`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_priority_is_transitive: forall t, transitive (higher_eq_priority t).
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O140

- 代表位置：`model/arrival/basic/arrival_bounds.v:101`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_at_least_two_jobs: num_arrivals >= 2.
```

- 注释：这是按列表长度或到达数量进行分类讨论时引入的技术性假设。

### O141

- 代表位置：`model/arrival/basic/arrival_bounds.v:107`
- 重复出现次数：1
- 原句：

```coq
          Hypothesis H_many_arrivals: div_ceil (t2 - t1) (task_period tsk) < num_arrivals.
```

- 注释：这是按列表长度或到达数量进行分类讨论时引入的技术性假设。

### O142

- 代表位置：`model/arrival/basic/arrival_bounds.v:51`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_no_jobs: num_arrivals = 0.
```

- 注释：这是按列表长度或到达数量进行分类讨论时引入的技术性假设。

### O143

- 代表位置：`model/arrival/basic/arrival_bounds.v:83`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_no_jobs: num_arrivals = 1.
```

- 注释：这是按列表长度或到达数量进行分类讨论时引入的技术性假设。

### O144

- 代表位置：`model/arrival/jitter/arrival_bounds.v:118`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_at_least_two_jobs: num_actual_arrivals >= 2.
```

- 注释：这是按列表长度或到达数量进行分类讨论时引入的技术性假设。

### O145

- 代表位置：`model/arrival/jitter/arrival_bounds.v:124`
- 重复出现次数：1
- 原句：

```coq
          Hypothesis H_many_arrivals:
            div_ceil (t2 + task_jitter tsk - t1) (task_period tsk) < num_actual_arrivals.
```

- 注释：这是按列表长度或到达数量进行分类讨论时引入的技术性假设。

### O146

- 代表位置：`model/arrival/jitter/arrival_bounds.v:69`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_no_jobs: num_actual_arrivals = 0.
```

- 注释：这是按列表长度或到达数量进行分类讨论时引入的技术性假设。

### O147

- 代表位置：`model/arrival/jitter/arrival_bounds.v:99`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_no_jobs: num_actual_arrivals = 1.
```

- 注释：这是按列表长度或到达数量进行分类讨论时引入的技术性假设。

### O148

- 代表位置：`model/schedule/apa/constrained_deadlines.v:188`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_all_previous_jobs_completed :
        forall j_other tsk_other,
          arrives_in arr_seq j_other ->
          job_task j_other = tsk_other ->
          hp_task_in (alpha tsk) tsk_other ->
          completed job_cost sched j_other (job_arrival j_other + task_period tsk_other).
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O149

- 代表位置：`model/schedule/global/response_time.v:60`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis response_time_bound:
          job_has_completed_by j (job_arrival j + R). 
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O150

- 代表位置：`model/schedule/global/transformation/construction.v:117`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_depends_only_on_prefix:
          forall (sched1 sched2: schedule Job num_cpus) cpu t,
            (forall t0 cpu, t0 < t -> sched1 cpu t0 = sched2 cpu t0) ->          
            build_schedule sched1 cpu t = build_schedule sched2 cpu t.
```

- 注释：这是关于构造型调度函数在相同前缀下保持一致的技术性假设。

### O151

- 代表位置：`model/schedule/global/transformation/construction.v:79`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_depends_only_on_service:
          forall sched1 sched2 cpu t,
            (forall j, service sched1 j t = service sched2 j t) ->          
            build_schedule sched1 cpu t = build_schedule sched2 cpu t.
```

- 注释：这是关于构造型调度函数在相同前缀下保持一致的技术性假设。

### O152

- 代表位置：`model/schedule/partitioned/schedulability.v:38`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_partitioned: partitioned_schedule job_task sched ts assigned_cpu.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O153

- 代表位置：`model/schedule/uni/basic/platform.v:139`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_j_is_never_backlogged:
        forall t,
          job_arrival j <= t < job_arrival j + job_cost j ->
          ~ job_backlogged_at j t.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O154

- 代表位置：`model/schedule/uni/jitter/busy_interval.v:199`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_strictly_larger: t1 < t2.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O155

- 代表位置：`model/schedule/uni/jitter/busy_interval.v:201`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_not_quiet: forall t, t1 < t <= t2 -> ~ quiet_time t.
```

- 注释：说明某个具体作业在特定时刻是否已经到达或仍在某种局部状态中，这是推进当前证明分支所需的状态性假设。

### O156

- 代表位置：`model/schedule/uni/jitter/busy_interval.v:445`
- 重复出现次数：1
- 原句：

```coq
            Hypothesis H_busy_prefix_contains_arrival: actual_job_arrival j >= t1.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O157

- 代表位置：`model/schedule/uni/jitter/busy_interval.v:451`
- 重复出现次数：1
- 原句：

```coq
            Hypothesis H_workload_is_bounded: actual_hp_workload t1 (t1 + delta) <= delta.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O158

- 代表位置：`model/schedule/uni/jitter/busy_interval.v:92`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_during_interval: t1 <= t < t2.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O159

- 代表位置：`model/schedule/uni/jitter/busy_interval.v:93`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_job_is_pending: job_pending_at j t.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O160

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_rta.v:101`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_job_interference_is_bounded:
      job_interference_is_bounded_by interference interfering_workload interference_bound_function.
```

- 注释：这是一个不动点条件，用于说明某个候选量满足相应递推方程。

### O161

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_rta.v:111`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_R_is_maximum:
      forall A,
        is_in_search_space A -> 
        exists F,
          A + F = task_lock_in_service tsk + interference_bound_function tsk A (A + F) /\
          F + (task_cost tsk - task_lock_in_service tsk) <= R.
```

- 注释：这是一个不动点条件，用于说明某个候选量满足相应递推方程。

### O162

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_rta.v:146`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_A_gt_Asp: A_sp <= A.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O163

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_rta.v:148`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_equivalent:
        are_equivalent_at_values_less_than (interference_bound_function tsk A) (interference_bound_function tsk A_sp) L.
```

- 注释：这是一个不动点条件，用于说明某个候选量满足相应递推方程。

### O164

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_rta.v:151`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_Asp_is_in_search_space: is_in_search_space A_sp.
```

- 注释：这是抽象 RTA 搜索空间中的技术性条件，用于限制候选点的取值范围。

### O165

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_rta.v:153`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_fixpoint:
        A_sp + F_sp = task_lock_in_service tsk + interference_bound_function tsk A_sp (A_sp + F_sp).
```

- 注释：这是一个不动点条件，用于说明某个候选量满足相应递推方程。

### O166

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_rta.v:156`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_R_gt_Fsp: F_sp + (task_cost tsk - task_lock_in_service tsk) <= R.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O167

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_rta.v:164`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_big_fixpoint_solution: t2 <= t1 + (A_sp + F_sp).
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O168

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_rta.v:197`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_small_fixpoint_solution: t1 + (A_sp + F_sp) < t2.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O169

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_rta.v:204`
- 重复出现次数：1
- 原句：

```coq
          Hypothesis H_fixpoint_is_no_less_than_relative_arrival_of_j: A <= A_sp + F_sp. 
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O170

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_rta.v:365`
- 重复出现次数：1
- 原句：

```coq
          Hypothesis H_fixpoint_is_less_that_relative_arrival_of_j: A_sp + F_sp < A.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O171

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_seq_rta.v:203`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_task_interference_is_bounded: task_interference_is_bounded_by task_interference_bound_function.   
```

- 注释：这是一个不动点条件，用于说明某个候选量满足相应递推方程。

### O172

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_seq_rta.v:232`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_R_is_maximum_seq: 
        forall A,
          is_in_search_space_seq A -> 
          exists F,
            A + F = (task_rbf (A + ε) - (task_cost tsk - task_lock_in_service tsk))
                    + task_interference_bound_function tsk A (A + F) /\
            F + (task_cost tsk - task_lock_in_service tsk) <= R.
```

- 注释：这是一个不动点条件，用于说明某个候选量满足相应递推方程。

### O173

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_seq_rta.v:254`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_busy_interval: busy_interval j1 t1 t2.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O174

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_seq_rta.v:319`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_inside_busy_interval: t1 + x < t2.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O175

- 代表位置：`model/schedule/uni/limited/abstract_RTA/abstract_seq_rta.v:321`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_job_j_is_not_completed: ~~ job_completed_by j (t1 + x).
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O176

- 代表位置：`model/schedule/uni/limited/abstract_RTA/reduction_of_search_space.v:138`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_less_than: A_sp + F_sp < B.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O177

- 代表位置：`model/schedule/uni/limited/abstract_RTA/reduction_of_search_space.v:139`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_fixpoint: A_sp + F_sp = interference_bound_function tsk A_sp (A_sp + F_sp).
```

- 注释：这是一个不动点条件，用于说明某个候选量满足相应递推方程。

### O178

- 代表位置：`model/schedule/uni/limited/abstract_RTA/reduction_of_search_space.v:145`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_bounds_for_A: A_sp <= A <= A_sp + F_sp.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O179

- 代表位置：`model/schedule/uni/limited/abstract_RTA/reduction_of_search_space.v:146`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_equivalent:
        are_equivalent_at_values_less_than
          (interference_bound_function tsk A)
          (interference_bound_function tsk A_sp) B.
```

- 注释：这是一个不动点条件，用于说明某个候选量满足相应递推方程。

### O180

- 代表位置：`model/schedule/uni/limited/abstract_RTA/reduction_of_search_space.v:79`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_A_less_than_B: A < B.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O181

- 代表位置：`model/schedule/uni/limited/abstract_RTA/sufficient_condition_for_lock_in_service.v:143`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_progress_le_job_cost: progress_of_job <= job_cost j.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O182

- 代表位置：`model/schedule/uni/limited/abstract_RTA/sufficient_condition_for_lock_in_service.v:148`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_total_workload_is_bounded:
        progress_of_job + cumul_interference j t1 (t1 + delta) <= delta.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O183

- 代表位置：`model/schedule/uni/limited/abstract_RTA/sufficient_condition_for_lock_in_service.v:203`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_lock_in_service_positive:
        job_lock_in_service_positive job_cost arr_seq job_lock_in_service.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O184

- 代表位置：`model/schedule/uni/limited/abstract_RTA/sufficient_condition_for_lock_in_service.v:207`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_lock_in_service_le_job_cost:
        job_lock_in_service_le_job_cost job_cost arr_seq job_lock_in_service.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O185

- 代表位置：`model/schedule/uni/limited/abstract_RTA/sufficient_condition_for_lock_in_service.v:211`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_job_nonpreemptive_after_lock_in_service:
        job_nonpreemptive_after_lock_in_service job_cost arr_seq sched job_lock_in_service.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O186

- 代表位置：`model/schedule/uni/limited/abstract_RTA/sufficient_condition_for_lock_in_service.v:90`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_greater_than_or_equal: t1 <= t.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O187

- 代表位置：`model/schedule/uni/limited/abstract_RTA/sufficient_condition_for_lock_in_service.v:91`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_less_or_equal: t + delta <= t2.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O188

- 代表位置：`model/schedule/uni/limited/busy_interval.v:1082`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_delta_positive: Δ > 0.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O189

- 代表位置：`model/schedule/uni/limited/busy_interval.v:1083`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_workload_is_bounded: forall t, total_workload t (t + Δ) <= Δ.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O190

- 代表位置：`model/schedule/uni/limited/busy_interval.v:1108`
- 重复出现次数：1
- 原句：

```coq
          Hypothesis H_no_carry_in: no_carry_in t.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O191

- 代表位置：`model/schedule/uni/limited/busy_interval.v:281`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_busy_interval_prefix: busy_interval_prefix t1 t2.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O192

- 代表位置：`model/schedule/uni/limited/busy_interval.v:449`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_no_quiet_time: forall t, t1 < t <= t1 + Δ -> ~ quiet_time t.
```

- 注释：说明某个具体作业在特定时刻是否已经到达或仍在某种局部状态中，这是推进当前证明分支所需的状态性假设。

### O193

- 代表位置：`model/schedule/uni/limited/edf/nonpr_reg/concrete_models/response_time_bound.v:144`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_R_is_maximum:
        forall A,
          is_in_search_space A -> 
          exists F,
            A + F = task_rbf (A + ε) + bound_on_total_hep_workload A (A + F) /\
            F <= R.
```

- 注释：这是抽象 RTA 搜索空间中的技术性条件，用于限制候选点的取值范围。

### O194

- 代表位置：`model/schedule/uni/limited/edf/nonpr_reg/concrete_models/response_time_bound.v:217`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_R_is_maximum:
        forall A,
          is_in_search_space A -> 
          exists F,
            A + F = blocking_bound + (task_rbf (A + ε) - (task_cost tsk - ε))
                    + bound_on_total_hep_workload A (A + F) /\
            F + (task_cost tsk - ε) <= R.
```

- 注释：这是抽象 RTA 搜索空间中的技术性条件，用于限制候选点的取值范围。

### O195

- 代表位置：`model/schedule/uni/limited/edf/nonpr_reg/concrete_models/response_time_bound.v:306`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_R_is_maximum:
        forall A,
          is_in_search_space A -> 
          exists F,
            A + F = blocking_bound
                    + (task_rbf (A + ε) - (task_last_nps tsk - ε)) 
                    + bound_on_total_hep_workload A (A + F) /\
            F + (task_last_nps tsk - ε) <= R.
```

- 注释：这是抽象 RTA 搜索空间中的技术性条件，用于限制候选点的取值范围。

### O196

- 代表位置：`model/schedule/uni/limited/edf/nonpr_reg/concrete_models/response_time_bound.v:536`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_R_is_maximum:
        forall A,
          is_in_search_space A -> 
          exists F,
            A + F = blocking_bound + task_rbf (A + ε) + bound_on_total_hep_workload A (A + F) /\
            F <= R.
```

- 注释：这是抽象 RTA 搜索空间中的技术性条件，用于限制候选点的取值范围。

### O197

- 代表位置：`model/schedule/uni/limited/edf/nonpr_reg/response_time_bound.v:320`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_R_is_maximum:
        forall A,
          is_in_search_space A -> 
          exists  F,
            A + F = blocking_bound
                    + (task_rbf (A + ε) - (task_cost tsk - task_lock_in_service tsk))
                    + bound_on_total_hep_workload  A (A + F) /\
            F + (task_cost tsk - task_lock_in_service tsk) <= R.
```

- 注释：这是抽象 RTA 搜索空间中的技术性条件，用于限制候选点的取值范围。

### O198

- 代表位置：`model/schedule/uni/limited/edf/response_time_bound.v:215`
- 重复出现次数：1
- 原句：

```coq
    (** ** Filling Out Hypothesis Of Abstract RTA Theorem *)
    (** In this section we prove that all hypotheses necessary to use the abstract theorem are satisfied. *)
    Section FillingOutHypothesesOfAbstractRTATheorem.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O199

- 代表位置：`model/schedule/uni/limited/fixed_priority/nonpr_reg/concrete_models/response_time_bound.v:114`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_fixed_point: L = total_hep_rbf L.
```

- 注释：这是一个不动点条件，用于说明某个候选量满足相应递推方程。

### O200

- 代表位置：`model/schedule/uni/limited/fixed_priority/nonpr_reg/concrete_models/response_time_bound.v:122`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_R_is_maximum:
        forall A,
          is_in_search_space A -> 
          exists F,
            A + F = task_rbf (A + ε) + total_ohep_rbf (A + F) /\
            F <= R.
```

- 注释：这是抽象 RTA 搜索空间中的技术性条件，用于限制候选点的取值范围。

### O201

- 代表位置：`model/schedule/uni/limited/fixed_priority/nonpr_reg/concrete_models/response_time_bound.v:192`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_R_is_maximum:
        forall A,
          is_in_search_space A -> 
          exists  F,
            A + F = blocking_bound
                    + (task_rbf (A + ε) - (task_cost tsk - ε))
                    + total_ohep_rbf (A + F) /\
            F + (task_cost tsk - ε) <= R.
```

- 注释：这是抽象 RTA 搜索空间中的技术性条件，用于限制候选点的取值范围。

### O202

- 代表位置：`model/schedule/uni/limited/fixed_priority/nonpr_reg/concrete_models/response_time_bound.v:281`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_R_is_maximum:
        forall A,
          is_in_search_space A ->
          exists  F,
            A + F = blocking_bound
                    + (task_rbf (A + ε) - (task_last_nps tsk - ε))
                    + total_ohep_rbf (A + F) /\
            F + (task_last_nps tsk - ε) <= R.      
```

- 注释：这是抽象 RTA 搜索空间中的技术性条件，用于限制候选点的取值范围。

### O203

- 代表位置：`model/schedule/uni/limited/fixed_priority/nonpr_reg/concrete_models/response_time_bound.v:510`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_R_is_maximum:
        forall A,
          is_in_search_space A ->
          exists  F,
            A + F = blocking_bound + task_rbf (A + ε) + total_ohep_rbf (A + F) /\
            F <= R.
```

- 注释：这是抽象 RTA 搜索空间中的技术性条件，用于限制候选点的取值范围。

### O204

- 代表位置：`model/schedule/uni/limited/fixed_priority/nonpr_reg/response_time_bound.v:266`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_R_is_maximum:
        forall A, 
          is_in_search_space A -> 
          exists  F,
            A + F = blocking_bound
                    + (task_rbf (A + ε) - (task_cost tsk - task_lock_in_service tsk))
                    + total_ohep_rbf (A + F) /\
            F + (task_cost tsk - task_lock_in_service tsk) <= R.
```

- 注释：这是抽象 RTA 搜索空间中的技术性条件，用于限制候选点的取值范围。

### O205

- 代表位置：`model/schedule/uni/limited/jlfp_instantiation.v:354`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_quiet_time: quiet_time j t1.
```

- 注释：说明某个具体作业在特定时刻是否已经到达或仍在某种局部状态中，这是推进当前证明分支所需的状态性假设。

### O206

- 代表位置：`model/schedule/uni/limited/platform/definitions.v:146`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_model_with_bounded_np_segments:
          model_with_bounded_nonpreemptive_segments job_max_nps task_max_nps.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O207

- 代表位置：`model/schedule/uni/limited/platform/limited.v:210`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_is_schedule_with_limited_preemptions:
        is_schedule_with_limited_preemptions sched.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O208

- 代表位置：`model/schedule/uni/limited/platform/limited.v:222`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_limited_preemptions_job_model: limited_preemptions_job_model.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O209

- 代表位置：`model/schedule/uni/limited/platform/limited.v:223`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_job_max_np_segment_le_task_max_np_segment:
        job_max_np_segment_le_task_max_np_segment task_max_nps.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O210

- 代表位置：`model/schedule/uni/limited/platform/priority_inversion_is_bounded.v:336`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_preemption_time_exists:
        exists pr_t, preemption_time pr_t /\ t1 <= pr_t <= t1 + K.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O211

- 代表位置：`model/schedule/uni/limited/platform/priority_inversion_is_bounded.v:95`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_busy_interval_prefix:
      busy_interval_prefix job_arrival job_cost arr_seq sched higher_eq_priority j t1 t2.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O212

- 代表位置：`model/schedule/uni/nonpreemptive/schedule.v:136`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_j_is_scheduled_at_t: scheduled_at sched j t.
```

- 注释：这是一个服务于中间推导、分类讨论或界函数证明的技术性假设，不直接描述基础调度模型，也不是由 Prosa 数据结构表示直接引入的结构条件。

### O213

- 代表位置：`model/schedule/uni/schedulability.v:88`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_job_deadline_eq_task_deadline:
          forall j,
            arrives_in arr_seq j ->
            job_deadline_eq_task_deadline task_deadline job_deadline job_task j.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O214

- 代表位置：`model/schedule/uni/schedule.v:516`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_less_than_s: s0 < service sched j t.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O215

- 代表位置：`model/schedule/uni/schedule.v:562`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_service_not_zero: service_during sched j t1 t2 > 0.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O216

- 代表位置：`model/schedule/uni/schedule.v:602`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_same_service: service sched j t1 = service sched j t2.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O217

- 代表位置：`model/schedule/uni/susp/build_suspension_table.v:48`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_arrived:
      forall j t,
        t < t_max ->
        job_suspended_at j t ->
        has_arrived job_arrival j t.
```

- 注释：说明某个具体作业在特定时刻是否已经到达或仍在某种局部状态中，这是推进当前证明分支所需的状态性假设。

### O218

- 代表位置：`model/schedule/uni/susp/build_suspension_table.v:55`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_not_completed:
      forall j t,
        t < t_max ->
        job_suspended_at j t ->
        ~~ job_completed_by j t.
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O219

- 代表位置：`model/schedule/uni/susp/build_suspension_table.v:63`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_continuous_suspension:
      forall j t t_susp,
        t < t_max ->
        job_suspended_at j t ->
        start_of_latest_suspension j t <= t_susp < t ->
        job_suspended_at j t_susp.
```

- 注释：说明某个具体作业在特定时刻是否已经到达或仍在某种局部状态中，这是推进当前证明分支所需的状态性假设。

### O220

- 代表位置：`model/schedule/uni/susp/last_execution.v:217`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_same_service: service sched j t = service sched j t'.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O221

- 代表位置：`model/schedule/uni/susp/last_execution.v:327`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_less_than_cost: s < job_cost j.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O222

- 代表位置：`model/schedule/uni/susp/last_execution.v:370`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_no_earlier_than_arrival: has_arrived job_arrival j t0.
```

- 注释：说明某个具体作业在特定时刻是否已经到达或仍在某种局部状态中，这是推进当前证明分支所需的状态性假设。

### O223

- 代表位置：`model/schedule/uni/susp/last_execution.v:373`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_before_last_execution: t0 < time_after_last_execution j t.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O224

- 代表位置：`model/schedule/uni/susp/last_execution.v:93`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_after_arrival: has_arrived job_arrival j t1.
```

- 注释：说明某个具体作业在特定时刻是否已经到达或仍在某种局部状态中，这是推进当前证明分支所需的状态性假设。

### O225

- 代表位置：`model/schedule/uni/susp/suspension_intervals.v:120`
- 重复出现次数：1
- 原句：

```coq
          Hypothesis H_within_suspension_interval:
            suspension_start <= t_in <= suspension_start + duration.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O226

- 代表位置：`model/schedule/uni/susp/suspension_intervals.v:170`
- 重复出现次数：1
- 原句：

```coq
          Hypothesis H_not_completed: ~~ job_completed_by j t_in.
```

- 注释：说明某个具体作业在特定时刻是否已经完成，这是局部证明分支上的状态性假设。

### O227

- 代表位置：`model/schedule/uni/susp/suspension_intervals.v:173`
- 重复出现次数：1
- 原句：

```coq
          Hypothesis H_within_suspension_interval:
            suspension_start <= t_in < suspension_start + duration.
```

- 注释：这是证明中的数值关系假设，用于比较两个中间量的大小或建立夹逼关系。

### O228

- 代表位置：`model/schedule/uni/susp/suspension_intervals.v:223`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_j_is_suspended: suspended_at j t.
```

- 注释：说明某个具体作业在特定时刻是否已经到达或仍在某种局部状态中，这是推进当前证明分支所需的状态性假设。

### O229

- 代表位置：`model/schedule/uni/susp/suspension_intervals.v:490`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_not_suspended_at_t: ~~ suspended_at j t.
```

- 注释：说明某个具体作业在特定时刻是否已经到达或仍在某种局部状态中，这是推进当前证明分支所需的状态性假设。

### O230

- 代表位置：`model/schedule/uni/susp/suspension_intervals.v:491`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_begins_suspension: suspended_at j t.+1.
```

- 注释：说明某个具体作业在特定时刻是否已经到达或仍在某种局部状态中，这是推进当前证明分支所需的状态性假设。

### O231

- 代表位置：`model/schedule/uni/sustainability.v:282`
- 重复出现次数：1
- 原句：

```coq
          Hypothesis H_classical_forall_exists:
            forall (T: Type) (P: T -> Prop),
              ~ (forall x, ~ P x) -> exists x, P x.
```

- 注释：这是一个单独拿出来使用的逻辑引理，与调度模型本身无关。

### O232

- 代表位置：`model/schedule/uni/sustainability.v:285`
- 重复出现次数：1
- 原句：

```coq
          Hypothesis H_classical_and_or:
            forall (P Q: Prop), ~ (P /\ Q) -> ~ P \/ ~ Q.
```

- 注释：这是一个单独拿出来使用的逻辑引理，与调度模型本身无关。

### O233

- 代表位置：`model/schedule/uni/transformation/construction.v:113`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_depends_only_on_prefix:
          forall (sched1 sched2: schedule Job) t,
            (forall t0, t0 < t -> sched1 t0 = sched2 t0) ->          
            build_schedule sched1 t = build_schedule sched2 t.
```

- 注释：这是关于构造型调度函数在相同前缀下保持一致的技术性假设。

### O234

- 代表位置：`model/schedule/uni/transformation/construction.v:147`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_immediate_property:
          forall sched_prefix t, P (build_schedule sched_prefix t).
```

- 注释：这是关于构造型调度函数在相同前缀下保持一致的技术性假设。

### O235

- 代表位置：`model/schedule/uni/transformation/construction.v:76`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_depends_only_on_service:
          forall sched1 sched2 t,
            (forall j, service sched1 j t = service sched2 j t) ->          
            build_schedule sched1 t = build_schedule sched2 t.
```

- 注释：这是关于构造型调度函数在相同前缀下保持一致的技术性假设。

### O236

- 代表位置：`util/fixedpoint.v:157`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_reflexive: reflexive R.
```

- 注释：这是通用工具库引理的技术性前提，用于关系、序列或计数等基础证明，与具体调度模型无关。

### O237

- 代表位置：`util/fixedpoint.v:158`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_transitive: transitive R.
```

- 注释：这是通用工具库引理的技术性前提，用于关系、序列或计数等基础证明，与具体调度模型无关。

### O238

- 代表位置：`util/fixedpoint.v:159`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_monotone: monotone f R.
```

- 注释：这是通用工具库引理的技术性前提，用于关系、序列或计数等基础证明，与具体调度模型无关。

### O239

- 代表位置：`util/minmax.v:242`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_total_over_list:
          forall x y,
            x \in l ->
            y \in l ->
            rel x y || rel y x.
```

- 注释：这是通用工具库引理的技术性前提，用于关系、序列或计数等基础证明，与具体调度模型无关。

### O240

- 代表位置：`util/minmax.v:89`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_total_over_list:
          forall x y,
            x \in l ->
            y \in l ->
            rel (F x) (F y) || rel (F y) (F x).
```

- 注释：这是通用工具库引理的技术性前提，用于关系、序列或计数等基础证明，与具体调度模型无关。

### O241

- 代表位置：`util/pick.v:122`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis MIN:
      forall x,
        x < n ->
        p x ->
        (forall y, y < n -> p y -> x <= y) ->
        P x.
```

- 注释：这是通用工具库引理的技术性前提，用于关系、序列或计数等基础证明，与具体调度模型无关。

### O242

- 代表位置：`util/pick.v:197`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis MAX:
      forall x,
        x < n ->
        p x ->
        (forall y, y < n -> p y -> x >= y) ->
        P x.
```

- 注释：这是通用工具库引理的技术性前提，用于关系、序列或计数等基础证明，与具体调度模型无关。

### O243

- 代表位置：`util/pick.v:265`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis EX1 : exists x, x < n /\ p1 x.
```

- 注释：这是通用工具库引理的技术性前提，用于关系、序列或计数等基础证明，与具体调度模型无关。

### O244

- 代表位置：`util/pick.v:266`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis EX2 : exists x, x < n /\ p2 x.
```

- 注释：这是通用工具库引理的技术性前提，用于关系、序列或计数等基础证明，与具体调度模型无关。

### O245

- 代表位置：`util/pick.v:268`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis OUT:
    forall x y, x < n -> y < n -> p1 x -> p2 y -> ~~ p1 y -> x <= y. 
```

- 注释：这是通用工具库引理的技术性前提，用于关系、序列或计数等基础证明，与具体调度模型无关。

### O246

- 代表位置：`util/pick.v:68`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis HOLDS: forall x, p x -> P x.
```

- 注释：这是通用工具库引理的技术性前提，用于关系、序列或计数等基础证明，与具体调度模型无关。

### O247

- 代表位置：`util/sorting.v:56`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_leT_is_transitive: transitive leT.
```

- 注释：这是通用工具库引理的技术性前提，用于关系、序列或计数等基础证明，与具体调度模型无关。

