# rt-proofs-v0.6 中排除 classic 和 dataset_casestudy 后的 Hypothesis 整理

- 扫描范围：递归扫描 `rt-proofs-v0.6` 目录下全部 `.v` 文件，但显式排除 `classic/` 和 `dataset_casestudy/`。
- 参与扫描的 `.v` 文件数：357
- 原始 `Hypothesis` 条数：2362
- 去重后条数：430
- 去重规则：忽略 `Hypothesis` 名称，只按冒号后的命题主体去重；命题内容只要有任何差异，就视为不同假设。
- 每条记录内容：保留一条代表性原句，补充中文注释，并给出代表位置与重复出现次数。

## 分类统计

- 与模型有关：134
- 与数据结构有关：27
- 其他：269

## 1. 与模型有关的 Hypothesis（134 条）

### M001

- 代表位置：`analysis/abstract/IBF/task.v:103`
- 重复出现次数：134
- 原句：

```coq
  Hypothesis H_valid_arrival_sequence : valid_arrival_sequence arr_seq.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M002

- 代表位置：`analysis/abstract/ideal/cumulative_bounds.v:24`
- 重复出现次数：101
- 原句：

```coq
  Hypothesis H_valid_schedule : valid_schedule sched  arr_seq.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M003

- 代表位置：`analysis/abstract/IBF/task.v:137`
- 重复出现次数：79
- 原句：

```coq
  Hypothesis H_work_conserving : work_conserving arr_seq sched.
```

- 注释：要求调度器在有可执行工作时不无故空闲，这是典型的工作保守假设。

### M004

- 代表位置：`analysis/abstract/IBF/task.v:98`
- 重复出现次数：75
- 原句：

```coq
  Hypothesis H_uniprocessor_proc_model : uniprocessor_model PState.
```

- 注释：要求系统满足某个基础模型语义，例如处理器模型、到达模型、资源模型或理想化平台模型。

### M005

- 代表位置：`analysis/abstract/IBF/task.v:114`
- 重复出现次数：57
- 原句：

```coq
  Hypothesis H_valid_job_cost : arrivals_have_valid_job_costs arr_seq.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M006

- 代表位置：`analysis/abstract/IBF/task.v:129`
- 重复出现次数：55
- 原句：

```coq
  Hypothesis H_is_arrival_curve : taskset_respects_max_arrivals arr_seq ts.
```

- 注释：要求到达过程满足到达曲线或最大到达数量约束。

### M007

- 代表位置：`analysis/abstract/IBF/task.v:110`
- 重复出现次数：54
- 原句：

```coq
  Hypothesis H_jobs_must_arrive_to_execute : jobs_must_arrive_to_execute sched.
```

- 注释：要求作业只能在到达之后执行。

### M008

- 代表位置：`analysis/abstract/iw_auxiliary.v:33`
- 重复出现次数：51
- 原句：

```coq
  Hypothesis H_consumed_supply_proc_model : fully_consuming_proc_model PState.
```

- 注释：要求系统满足某个基础模型语义，例如处理器模型、到达模型、资源模型或理想化平台模型。

### M009

- 代表位置：`analysis/abstract/IBF/task.v:128`
- 重复出现次数：50
- 原句：

```coq
  Hypothesis H_valid_arrival_curve : valid_taskset_arrival_curve ts max_arrivals.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M010

- 代表位置：`analysis/abstract/restricted_supply/abstract_rta.v:38`
- 重复出现次数：47
- 原句：

```coq
  Hypothesis H_unit_supply_proc_model : unit_supply_proc_model PState.
```

- 注释：要求系统满足某个基础模型语义，例如处理器模型、到达模型、资源模型或理想化平台模型。

### M011

- 代表位置：`analysis/abstract/IBF/task.v:111`
- 重复出现次数：45
- 原句：

```coq
  Hypothesis H_completed_jobs_dont_execute : completed_jobs_dont_execute sched.
```

- 注释：要求已经完成的作业不再继续执行。

### M012

- 代表位置：`analysis/abstract/ideal/abstract_rta.v:62`
- 重复出现次数：42
- 原句：

```coq
  Hypothesis H_valid_preemption_model :
    valid_preemption_model arr_seq sched.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M013

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/elf.v:39`
- 重复出现次数：40
- 原句：

```coq
  Hypothesis H_priority_is_reflexive : reflexive_task_priorities FP.
```

- 注释：要求优先级关系或时隙顺序满足自反、全序或反对称等结构性质，从而能作为合法调度策略的基础。

### M014

- 代表位置：`analysis/abstract/IBF/task.v:251`
- 重复出现次数：37
- 原句：

```coq
    Hypothesis H_job_cost_positive : job_cost_positive j.
```

- 注释：要求作业执行成本、任务执行成本或周期等基础参数满足正性或界约束。

### M015

- 代表位置：`analysis/abstract/ideal/cumulative_bounds.v:15`
- 重复出现次数：34
- 原句：

```coq
  Hypothesis H_policy_is_reflexive : reflexive_job_priorities JLFP.
```

- 注释：要求优先级关系或时隙顺序满足自反、全序或反对称等结构性质，从而能作为合法调度策略的基础。

### M016

- 代表位置：`results/rta/arm/edf/floating_nonpreemptive.v:84`
- 重复出现次数：28
- 原句：

```coq
  Hypothesis H_valid_task_arrival_sequence : valid_task_arrival_sequence ts arr_seq.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M017

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/fp.v:63`
- 重复出现次数：26
- 原句：

```coq
  Hypothesis H_respects_policy : respects_FP_policy_at_preemption_point arr_seq sched FP.
```

- 注释：要求优先级关系或时隙顺序满足自反、全序或反对称等结构性质，从而能作为合法调度策略的基础。

### M018

- 代表位置：`analysis/facts/preemption/job/limited.v:36`
- 重复出现次数：26
- 原句：

```coq
  Hypothesis H_schedule_respects_preemption_model :
    schedule_respects_preemption_model arr_seq sched.
```

- 注释：要求系统满足某个基础模型语义，例如处理器模型、到达模型、资源模型或理想化平台模型。

### M019

- 代表位置：`analysis/abstract/IBF/task.v:99`
- 重复出现次数：22
- 原句：

```coq
  Hypothesis H_unit_service_proc_model : unit_service_proc_model PState.
```

- 注释：要求系统满足某个基础模型语义，例如处理器模型、到达模型、资源模型或理想化平台模型。

### M020

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/edf.v:70`
- 重复出现次数：22
- 原句：

```coq
  Hypothesis H_respects_policy : respects_JLFP_policy_at_preemption_point arr_seq sched (EDF Job).
```

- 注释：要求优先级关系或时隙顺序满足自反、全序或反对称等结构性质，从而能作为合法调度策略的基础。

### M021

- 代表位置：`analysis/abstract/restricted_supply/abstract_rta.v:94`
- 重复出现次数：21
- 原句：

```coq
  Hypothesis H_unit_SBF : unit_supply_bound_function SBF.
```

- 注释：要求资源供给、请求或受限供给相关的分析模型满足相应语义。

### M022

- 代表位置：`analysis/abstract/restricted_supply/search_space/edf.v:90`
- 重复出现次数：21
- 原句：

```coq
  Hypothesis H_task_cost_pos : 0 < task_cost tsk.
```

- 注释：要求作业执行成本、任务执行成本或周期等基础参数满足正性或界约束。

### M023

- 代表位置：`analysis/abstract/IBF/task.v:184`
- 重复出现次数：20
- 原句：

```coq
  Hypothesis H_sequential_tasks : sequential_tasks arr_seq sched.
```

- 注释：要求任务或作业是串行执行的，不允许同一实体并行推进。

### M024

- 代表位置：`analysis/abstract/restricted_supply/abstract_rta.v:93`
- 重复出现次数：20
- 原句：

```coq
  Hypothesis H_valid_SBF : valid_busy_sbf arr_seq sched tsk SBF.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M025

- 代表位置：`analysis/abstract/ideal/iw_instantiation.v:48`
- 重复出现次数：19
- 原句：

```coq
  Hypothesis H_priority_is_transitive : transitive_job_priorities JLFP.
```

- 注释：要求优先级关系或时隙顺序满足自反、全序或反对称等结构性质，从而能作为合法调度策略的基础。

### M026

- 代表位置：`analysis/abstract/ideal/abstract_rta.v:35`
- 重复出现次数：17
- 原句：

```coq
  Hypothesis H_ideal_progress_proc_model : ideal_progress_proc_model PState.
```

- 注释：要求系统满足某个基础模型语义，例如处理器模型、到达模型、资源模型或理想化平台模型。

### M027

- 代表位置：`analysis/abstract/ideal/abstract_rta.v:69`
- 重复出现次数：17
- 原句：

```coq
  Hypothesis H_valid_run_to_completion_threshold :
    valid_task_run_to_completion_threshold arr_seq tsk.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M028

- 代表位置：`analysis/abstract/ideal/abstract_seq_rta.v:171`
- 重复出现次数：17
- 原句：

```coq
    Hypothesis H_arrival_curve_pos : 0 < max_arrivals tsk ε.
```

- 注释：要求到达过程满足到达曲线或最大到达数量约束。

### M029

- 代表位置：`analysis/facts/preemption/job/nonpreemptive.v:29`
- 重复出现次数：15
- 原句：

```coq
  Hypothesis H_nonpreemptive_sched : nonpreemptive_schedule  sched.
```

- 注释：要求系统满足受限截止期、抢占模型或固定抢占点等调度语义。

### M030

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/aux.v:91`
- 重复出现次数：14
- 原句：

```coq
  Hypothesis H_busy_prefix : busy_interval_prefix arr_seq sched j t1 t2.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M031

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/edf.v:66`
- 重复出现次数：14
- 原句：

```coq
  Hypothesis H_valid_model_with_bounded_nonpreemptive_segments :
    valid_model_with_bounded_nonpreemptive_segments arr_seq sched.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M032

- 代表位置：`analysis/facts/busy_interval/hep_at_pt.v:50`
- 重复出现次数：14
- 原句：

```coq
  Hypothesis H_respects_policy :
    respects_JLFP_policy_at_preemption_point arr_seq sched JLFP.
```

- 注释：要求优先级关系或时隙顺序满足自反、全序或反对称等结构性质，从而能作为合法调度策略的基础。

### M033

- 代表位置：`analysis/facts/model/overheads/blackout_bound.v:35`
- 重复出现次数：13
- 原句：

```coq
  Hypothesis H_valid_overheads_model :
    overhead_resource_model sched DB CSB CRPDB.
```

- 注释：要求系统满足某个基础模型语义，例如处理器模型、到达模型、资源模型或理想化平台模型。

### M034

- 代表位置：`analysis/facts/preemption/rtc_threshold/limited.v:51`
- 重复出现次数：13
- 原句：

```coq
  Hypothesis H_valid_fixed_preemption_points_model :
    valid_fixed_preemption_points_model arr_seq ts.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M035

- 代表位置：`analysis/facts/preemption/task/floating.v:48`
- 重复出现次数：12
- 原句：

```coq
  Hypothesis H_valid_model_with_floating_nonpreemptive_regions :
    valid_model_with_floating_nonpreemptive_regions arr_seq.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M036

- 代表位置：`analysis/facts/model/sbf/average.v:38`
- 重复出现次数：10
- 原句：

```coq
  Hypothesis H_average_resource_model : average_resource_model Π Θ ν sched.
```

- 注释：要求系统满足某个基础模型语义，例如处理器模型、到达模型、资源模型或理想化平台模型。

### M037

- 代表位置：`analysis/facts/model/sbf/periodic.v:39`
- 重复出现次数：10
- 原句：

```coq
  Hypothesis H_periodic_resource_model : periodic_resource_model Π γ sched.
```

- 注释：要求系统满足某个基础模型语义，例如处理器模型、到达模型、资源模型或理想化平台模型。

### M038

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/edf.v:245`
- 重复出现次数：9
- 原句：

```coq
      Hypothesis H_busy_prefix_arr : busy_interval_prefix arr_seq sched j t1 (job_arrival j).+1.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M039

- 代表位置：`results/rta/ovh/edf/floating_nonpreemptive.v:94`
- 重复出现次数：9
- 原句：

```coq
  Hypothesis H_arrivals_have_positive_job_costs :
    arrivals_have_positive_job_costs arr_seq.
```

- 注释：要求作业执行成本、任务执行成本或周期等基础参数满足正性或界约束。

### M040

- 代表位置：`analysis/abstract/ideal/iw_instantiation.v:530`
- 重复出现次数：8
- 原句：

```coq
    Hypothesis H_work_conserving : work_conserving_cl.
```

- 注释：要求调度器在有可执行工作时不无故空闲，这是典型的工作保守假设。

### M041

- 代表位置：`analysis/abstract/ideal/cumulative_bounds.v:16`
- 重复出现次数：7
- 原句：

```coq
  Hypothesis H_policy_respecsts_sequential_tasks : policy_respects_sequential_tasks JLFP.
```

- 注释：要求任务或作业是串行执行的，不允许同一实体并行推进。

### M042

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/elf.v:65`
- 重复出现次数：7
- 原句：

```coq
  Hypothesis H_respects_policy :
    respects_JLFP_policy_at_preemption_point arr_seq sched (ELF FP).
```

- 注释：要求优先级关系或时隙顺序满足自反、全序或反对称等结构性质，从而能作为合法调度策略的基础。

### M043

- 代表位置：`analysis/facts/priority/fifo.v:90`
- 重复出现次数：7
- 原句：

```coq
  Hypothesis H_respects_policy : respects_JLFP_policy_at_preemption_point arr_seq sched (FIFO Job).
```

- 注释：要求优先级关系或时隙顺序满足自反、全序或反对称等结构性质，从而能作为合法调度策略的基础。

### M044

- 代表位置：`analysis/facts/model/arrival_curves.v:25`
- 重复出现次数：6
- 原句：

```coq
  Hypothesis H_curve_is_valid : respects_max_arrivals arr_seq tsk (max_arrivals tsk).
```

- 注释：要求到达过程满足到达曲线或最大到达数量约束。

### M045

- 代表位置：`analysis/abstract/abstract_rta.v:52`
- 重复出现次数：5
- 原句：

```coq
  Hypothesis H_bounded_busy_interval_exists :
    busy_intervals_are_bounded_by arr_seq sched tsk L.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M046

- 代表位置：`analysis/abstract/IBF/task.v:255`
- 重复出现次数：4
- 原句：

```coq
    Hypothesis H_busy_interval : busy_interval sched j t1 t2.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M047

- 代表位置：`analysis/abstract/ideal/cumulative_bounds.v:50`
- 重复出现次数：4
- 原句：

```coq
  Hypothesis H_busy_interval : definitions.busy_interval sched j t1 t2.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M048

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/edf.v:283`
- 重复出现次数：4
- 原句：

```coq
      Hypothesis H_busy_prefix_L : busy_interval_prefix arr_seq sched j t1 (t1 + L).
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M049

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/edf.v:339`
- 重复出现次数：4
- 原句：

```coq
      Hypothesis H_no_busy_prefix_L : ~ busy_interval_prefix arr_seq sched j t1 (t1 + L).
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M050

- 代表位置：`analysis/facts/hyperperiod.v:39`
- 重复出现次数：4
- 原句：

```coq
  Hypothesis H_valid_periods : valid_periods ts.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M051

- 代表位置：`analysis/facts/hyperperiod.v:79`
- 重复出现次数：4
- 原句：

```coq
  Hypothesis H_valid_offset : valid_offset arr_seq tsk.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M052

- 代表位置：`analysis/facts/hyperperiod.v:80`
- 重复出现次数：4
- 原句：

```coq
  Hypothesis H_valid_period : valid_period tsk.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M053

- 代表位置：`analysis/facts/hyperperiod.v:81`
- 重复出现次数：4
- 原句：

```coq
  Hypothesis H_periodic_task : respects_periodic_task_model arr_seq tsk.
```

- 注释：要求系统满足某个基础模型语义，例如处理器模型、到达模型、资源模型或理想化平台模型。

### M054

- 代表位置：`analysis/facts/sporadic/arrival_bound.v:31`
- 重复出现次数：4
- 原句：

```coq
  Hypothesis H_sporadic_model : respects_sporadic_task_model arr_seq tsk.
```

- 注释：要求系统满足某个基础模型语义，例如处理器模型、到达模型、资源模型或理想化平台模型。

### M055

- 代表位置：`analysis/facts/sporadic/arrival_bound.v:32`
- 重复出现次数：4
- 原句：

```coq
  Hypothesis H_valid_inter_min_arrival : valid_task_min_inter_arrival_time tsk.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M056

- 代表位置：`implementation/refinements/EDF/fast_search_space.v:92`
- 重复出现次数：4
- 原句：

```coq
  Hypothesis H_valid_task_set : task_set_with_valid_arrivals ts.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M057

- 代表位置：`analysis/abstract/ideal/iw_instantiation.v:546`
- 重复出现次数：3
- 原句：

```coq
      Hypothesis H_job_cost_positive : 0 < job_cost j.
```

- 注释：要求作业执行成本、任务执行成本或周期等基础参数满足正性或界约束。

### M058

- 代表位置：`analysis/abstract/ideal/iw_instantiation.v:550`
- 重复出现次数：3
- 原句：

```coq
      Hypothesis H_busy_interval_prefix : busy_interval_prefix_ab j t1 t2.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M059

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/aux.v:66`
- 重复出现次数：3
- 原句：

```coq
  Hypothesis H_work_conserving : abstract.definitions.work_conserving arr_seq sched.
```

- 注释：要求调度器在有可执行工作时不无故空闲，这是典型的工作保守假设。

### M060

- 代表位置：`analysis/facts/busy_interval/service_inversion.v:40`
- 重复出现次数：3
- 原句：

```coq
    Hypothesis H_priority_is_reflexive : reflexive_priorities JLDP.
```

- 注释：要求优先级关系或时隙顺序满足自反、全序或反对称等结构性质，从而能作为合法调度策略的基础。

### M061

- 代表位置：`analysis/facts/interference.v:39`
- 重复出现次数：3
- 原句：

```coq
  Hypothesis H_compatible : JLFP_FP_compatible JLFP FP.
```

- 注释：要求优先级关系或时隙顺序满足自反、全序或反对称等结构性质，从而能作为合法调度策略的基础。

### M062

- 代表位置：`analysis/facts/model/overheads/sbf/fifo.v:116`
- 重复出现次数：3
- 原句：

```coq
  Hypothesis H_all_jobs_have_positive_cost :
    forall j,
      arrives_in arr_seq j ->
      job_cost_positive j.
```

- 注释：要求作业执行成本、任务执行成本或周期等基础参数满足正性或界约束。

### M063

- 代表位置：`implementation/facts/ideal_uni/preemption_aware.v:121`
- 重复出现次数：3
- 原句：

```coq
    Hypothesis H_valid_preemption_behavior : valid_nonpreemptive_readiness RM schedule.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M064

- 代表位置：`analysis/abstract/busy_interval.v:364`
- 重复出现次数：2
- 原句：

```coq
      Hypothesis H_is_busy_prefix : busy_interval_prefix t1 t_busy.+1.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M065

- 代表位置：`analysis/abstract/ideal/abstract_seq_rta.v:93`
- 重复出现次数：2
- 原句：

```coq
  Hypothesis H_interference_and_workload_consistent_with_sequential_tasks :
    interference_and_workload_consistent_with_sequential_tasks arr_seq sched tsk.
```

- 注释：要求任务或作业是串行执行的，不允许同一实体并行推进。

### M066

- 代表位置：`analysis/abstract/lower_bound_on_service.v:63`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_busy_interval : busy_interval_prefix sched j t1 t2.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M067

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/elf.v:86`
- 重复出现次数：2
- 原句：

```coq
  Hypothesis H_work_conserving : definitions.work_conserving arr_seq sched.
```

- 注释：要求调度器在有可执行工作时不无故空闲，这是典型的工作保守假设。

### M068

- 代表位置：`analysis/facts/busy_interval/pi_bound.v:82`
- 重复出现次数：2
- 原句：

```coq
  Hypothesis H_priority_inversion_is_bounded_by_blocking :
    forall j t1 t2,
      arrives_in arr_seq j ->
      job_of_task tsk j ->
      busy_interval_prefix arr_seq sched j t1 t2 ->
      max_lp_nonpreemptive_segment arr_seq j t1 <= blocking_bound (job_arrival j - t1).
```

- 注释：要求系统满足受限截止期、抢占模型或固定抢占点等调度语义。

### M069

- 代表位置：`analysis/facts/model/exceedance/SBF.v:50`
- 重复出现次数：2
- 原句：

```coq
  Hypothesis H_exceedance_in_busy_interval_bounded :
    forall j t1 t2,
      arrives_in arr_seq j ->
      job_of_task tsk j ->
        busy_interval_prefix arr_seq sched j t1 t2 ->
        \sum_(t1 <= t < t2) is_exceedance_exec (sched t) <= e.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M070

- 代表位置：`analysis/facts/model/overheads/sbf/fifo.v:77`
- 重复出现次数：2
- 原句：

```coq
  Hypothesis H_FIFO : policy_is_FIFO JLFP.
```

- 注释：要求优先级关系或时隙顺序满足自反、全序或反对称等结构性质，从而能作为合法调度策略的基础。

### M071

- 代表位置：`analysis/facts/model/rbf.v:290`
- 重复出现次数：2
- 原句：

```coq
  Hypothesis H_valid_arrival_curve : valid_arrival_curve (max_arrivals tsk).
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M072

- 代表位置：`analysis/facts/priority/gel.v:101`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_respects_policy : respects_JLFP_policy_at_preemption_point arr_seq sched (GEL Job Task).
```

- 注释：要求优先级关系或时隙顺序满足自反、全序或反对称等结构性质，从而能作为合法调度策略的基础。

### M073

- 代表位置：`analysis/facts/shifted_job_costs.v:33`
- 重复出现次数：2
- 原句：

```coq
  Hypothesis H_periodic_taskset : taskset_respects_periodic_task_model arr_seq ts.
```

- 注释：要求系统满足某个基础模型语义，例如处理器模型、到达模型、资源模型或理想化平台模型。

### M074

- 代表位置：`analysis/facts/tdma.v:20`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis time_slot_positive :
      valid_time_slot ts.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M075

- 代表位置：`analysis/facts/workload/edf_athep_bound.v:73`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_busy_interval : busy_interval arr_seq sched j t1 t2.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M076

- 代表位置：`implementation/facts/ideal_uni/preemption_aware.v:254`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_valid_preemption_function :
      forall j,
        arrives_in arr_seq j ->
        job_cannot_become_nonpreemptive_before_execution j.
```

- 注释：要求系统满足受限截止期、抢占模型或固定抢占点等调度语义。

### M077

- 代表位置：`results/rta/ideal/edf/bounded_nps.v:73`
- 重复出现次数：2
- 原句：

```coq
  Hypothesis H_respects_policy : respects_JLFP_policy_at_preemption_point arr_seq sched EDF.
```

- 注释：要求优先级关系或时隙顺序满足自反、全序或反对称等结构性质，从而能作为合法调度策略的基础。

### M078

- 代表位置：`analysis/abstract/IBF/task.v:185`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_interference_and_workload_consistent_with_sequential_tasks :
    interference_and_workload_consistent_with_sequential_tasks.
```

- 注释：要求任务或作业是串行执行的，不允许同一实体并行推进。

### M079

- 代表位置：`analysis/abstract/IBF/task.v:205`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_j1_cost_positive : job_cost_positive j1.
```

- 注释：要求作业执行成本、任务执行成本或周期等基础参数满足正性或界约束。

### M080

- 代表位置：`analysis/abstract/IBF/task.v:209`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_busy_interval : busy_interval sched j1 t1 t2.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M081

- 代表位置：`analysis/abstract/busy_interval.v:233`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_no_speculative_exec : no_speculative_execution.
```

- 注释：要求调度不发生 speculative execution。

### M082

- 代表位置：`analysis/abstract/busy_interval.v:266`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_is_busy_prefix : busy_interval_prefix sched j t1 t_busy.+1.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M083

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/edf.v:140`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_positive_service_inversion :
      cumulative_service_inversion arr_seq sched j t1 (t1 + δ) > 0.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M084

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/edf.v:211`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_L_bounds_bi_with_pi : longest_busy_interval_with_pi ts tsk <= SBF L.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M085

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/jlfp.v:118`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_service_inversion_bounded :
    service_inversion_is_bounded_by arr_seq sched tsk blocking_bound.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M086

- 代表位置：`analysis/abstract/restricted_supply/task_ibf_readiness.v:60`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_service_inversion_is_bounded :
    service_inversion_is_bounded arr_seq sched service_inversion_bound.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M087

- 代表位置：`analysis/abstract/restricted_supply/task_intra_interference_bound.v:81`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_service_inversion_is_bounded :
    service_inversion_is_bounded_by
     arr_seq sched tsk service_inversion_bound.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M088

- 代表位置：`analysis/definitions/finish_time.v:34`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_response_time_bounded : job_response_time_bound sched j R.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M089

- 代表位置：`analysis/definitions/schedulability.v:83`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_response_time_bounded : task_response_time_bound arr_seq sched tsk R.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M090

- 代表位置：`analysis/facts/SBF.v:64`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_valid_SBF : valid_pred_sbf arr_seq sched P SBF.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M091

- 代表位置：`analysis/facts/busy_interval/existence.v:139`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_busy_interval_prefix : busy_interval_prefix t1 t2.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M092

- 代表位置：`analysis/facts/busy_interval/existence.v:71`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_busy_interval : busy_interval t1 t2.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M093

- 代表位置：`analysis/facts/busy_interval/pi.v:468`
- 重复出现次数：1
- 原句：

```coq
          Hypothesis H_fpt_is_first_preemption_point :
            forall ρ,
              progr_t1 <= ρ <= progr_t1 + (job_max_nonpreemptive_segment jlp - ε) ->
              job_preemptable jlp ρ ->
              service sched jlp t1 + fpt <= ρ.
```

- 注释：要求系统满足受限截止期、抢占模型或固定抢占点等调度语义。

### M094

- 代表位置：`analysis/facts/busy_interval/pi.v:477`
- 重复出现次数：1
- 原句：

```coq
          Hypothesis H_progr_le_max_nonp_segment :
            fpt <= job_max_nonpreemptive_segment jlp - ε.
```

- 注释：要求系统满足受限截止期、抢占模型或固定抢占点等调度语义。

### M095

- 代表位置：`analysis/facts/busy_interval/service_inversion.v:276`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_service_inversion_positive : 0 < cumulative_service_inversion arr_seq sched j t1 t.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M096

- 代表位置：`analysis/facts/busy_interval/service_inversion.v:399`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_σ_constrained :
        service sched jlp t1
        <= σ
        <= service sched jlp t1 + (job_max_nonpreemptive_segment jlp - ε).
```

- 注释：要求系统满足受限截止期、抢占模型或固定抢占点等调度语义。

### M097

- 代表位置：`analysis/facts/delay_propagation.v:180`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_valid_arr_seq : valid_arrival_sequence arr_seq1.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M098

- 代表位置：`analysis/facts/delay_propagation.v:181`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_valid_ac : valid_taskset_arrival_curve ts1 max_arrivals1.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M099

- 代表位置：`analysis/facts/delay_propagation.v:40`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_valid_mapping :
    valid_delay_propagation_mapping
      JA1 JA2 job1_of task1_of delay_bound ts2.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M100

- 代表位置：`analysis/facts/delay_propagation.v:56`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_arr_seq_mapping :
    valid_arr_seq_propagation_mapping
      JA1 JA2 job1_of delay_bound arr_seq1 job2_of arrival_delay ts2.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M101

- 代表位置：`analysis/facts/jitter.v:163`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_valid_schedule :
    @valid_schedule _ original_arrival _ sched _ jitter_ready_instance arr_seq.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M102

- 代表位置：`analysis/facts/jitter.v:39`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_valid_jitter : valid_jitter_bounds ts.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M103

- 代表位置：`analysis/facts/model/dynamic_suspension.v:28`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_valid_dynamic_suspensions : valid_dynamic_suspensions.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M104

- 代表位置：`analysis/facts/model/rbf.v:317`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_arrival_curve_positive : max_arrivals tsk ε > 0.
```

- 注释：要求到达过程满足到达曲线或最大到达数量约束。

### M105

- 代表位置：`analysis/facts/model/task_cost.v:19`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_valid_job_cost : valid_job_cost j.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M106

- 代表位置：`analysis/facts/model/task_cost.v:45`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_valid_jobs : {in js, forall j, job_of_task tsk j && valid_job_cost j}.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M107

- 代表位置：`analysis/facts/preemption/job/limited.v:44`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_valid_limited_preemptions_job_model :
    valid_limited_preemptions_job_model arr_seq.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M108

- 代表位置：`analysis/facts/priority/classes.v:145`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_reflexive : reflexive hep_task.
```

- 注释：要求优先级关系或时隙顺序满足自反、全序或反对称等结构性质，从而能作为合法调度策略的基础。

### M109

- 代表位置：`analysis/facts/priority/classes.v:203`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_total : total hep_task.
```

- 注释：要求优先级关系或时隙顺序满足自反、全序或反对称等结构性质，从而能作为合法调度策略的基础。

### M110

- 代表位置：`analysis/facts/priority/fifo_ahep_bound.v:76`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_busy_window : classical.busy_interval arr_seq sched j t1 t2.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M111

- 代表位置：`analysis/facts/priority/jlfp_with_fp.v:26`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_valid_arrival_sequence : valid_arrival_sequence (arr_seq).
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M112

- 代表位置：`analysis/facts/shifted_job_costs.v:35`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_valid_offsets_in_taskset : valid_offsets arr_seq ts.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M113

- 代表位置：`analysis/facts/tdma.v:77`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis slot_order_total :
      total_slot_order ts.
```

- 注释：要求优先级关系或时隙顺序满足自反、全序或反对称等结构性质，从而能作为合法调度策略的基础。

### M114

- 代表位置：`analysis/facts/tdma.v:81`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis slot_order_antisymmetric :
      antisymmetric_slot_order ts.
```

- 注释：要求优先级关系或时隙顺序满足自反、全序或反对称等结构性质，从而能作为合法调度策略的基础。

### M115

- 代表位置：`analysis/facts/transform/edf_opt.v:479`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_EDF_prefix : forall t, t < t_edf -> EDF_at sched t.
```

- 注释：要求优先级关系或时隙顺序满足自反、全序或反对称等结构性质，从而能作为合法调度策略的基础。

### M116

- 代表位置：`analysis/facts/transform/wc_correctness.v:55`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_jobs_must_be_ready : jobs_must_be_ready_to_execute sched.
```

- 注释：要求作业只有在就绪之后才能执行。

### M117

- 代表位置：`implementation/facts/ideal_uni/prio_aware.v:31`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_total : total_priorities JLDP.
```

- 注释：要求优先级关系或时隙顺序满足自反、全序或反对称等结构性质，从而能作为合法调度策略的基础。

### M118

- 代表位置：`implementation/refinements/EDF/fast_search_space.v:94`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_all_tsk_positive_step :
    forall tsk, tsk \in ts -> fst (head (0,0) (steps_of (get_arrival_curve_prefix tsk))) > 0.
```

- 注释：要求到达过程满足到达曲线或最大到达数量约束。

### M119

- 代表位置：`implementation/refinements/arrival_curve_prefix.v:16`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_positive_step : fst (head (0,0) (steps_of (get_arrival_curve_prefix tsk))) > 0.
```

- 注释：要求到达过程满足到达曲线或最大到达数量约束。

### M120

- 代表位置：`model/task/arrival/example.v:65`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_valid_costs : jobs_have_valid_job_costs.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M121

- 代表位置：`results/generality/gel.v:104`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_reflexive : reflexive_task_priorities fp.
```

- 注释：要求优先级关系或时隙顺序满足自反、全序或反对称等结构性质，从而能作为合法调度策略的基础。

### M122

- 代表位置：`results/generality/gel.v:140`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_rt_bound :
        job_response_time_bound sched j' `|pp_delta tsk tsk'|.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M123

- 代表位置：`results/generality/gel.v:208`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_hp_delta_rtb :
      forall j j',
        arrives_in arr_seq j ->
        arrives_in arr_seq j' ->
        hp_task (job_task j) (job_task j') ->
        job_response_time_bound sched j' `|pp_delta (job_task j) (job_task j')|.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M124

- 代表位置：`results/optimality/edf.v:140`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_must_arrive : jobs_must_arrive_to_execute any_sched.
```

- 注释：要求作业只能在到达之后执行。

### M125

- 代表位置：`results/optimality/edf.v:141`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_completed_dont_execute : completed_jobs_dont_execute any_sched.
```

- 注释：要求已经完成的作业不再继续执行。

### M126

- 代表位置：`results/rta/ideal/elf/bounded_pi.v:147`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_work_conserving : work_conserving.work_conserving arr_seq sched.
```

- 注释：要求调度器在有可执行工作时不无故空闲，这是典型的工作保守假设。

### M127

- 代表位置：`results/rta/ideal/fifo/bounded_nps.v:380`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_R_max :
    forall (A : duration),
      is_in_concrete_search_space A ->
      exists (F : nat),
        A + F >= \sum_(tsko <- ts) task_request_bound_function tsko (A + ε)
        /\ F <= R.
```

- 注释：要求资源供给、请求或受限供给相关的分析模型满足相应语义。

### M128

- 代表位置：`results/transfer_schedulability/criterion.v:116`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_jobs_must_arrive_ref : jobs_must_arrive_to_execute ref_sched.
```

- 注释：要求作业只能在到达之后执行。

### M129

- 代表位置：`results/transfer_schedulability/criterion.v:117`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_jobs_exec_ref : (@completed_jobs_dont_execute _ _ ref_sched ref_job_cost).
```

- 注释：要求已经完成的作业不再继续执行。

### M130

- 代表位置：`results/transfer_schedulability/criterion.v:122`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_jobs_exec_on : (@completed_jobs_dont_execute _ _ online_sched online_job_cost).
```

- 注释：要求已经完成的作业不再继续执行。

### M131

- 代表位置：`results/transfer_schedulability/paper_model.v:228`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_well_formed_A :
    @valid_schedule _ _ _ (algA omega_0) (job_cost omega_0) (job_ready omega_0) arr_seq.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M132

- 代表位置：`results/transfer_schedulability/paper_model.v:230`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_well_formed_B :
    forall omega, @valid_schedule _ _ _ (algB omega) (job_cost omega) (job_ready omega) arr_seq.
```

- 注释：要求相关任务、作业、调度或资源模型参数满足合法性约束。

### M133

- 代表位置：`results/transfer_schedulability/paper_model.v:357`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_non_starvation :
    forall j,
      arrives_in arr_seq j ->
      { R : duration | @job_response_time_bound
                         _ _ (algA omega_0) (job_cost omega_0) _  j R }.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

### M134

- 代表位置：`results/transfer_schedulability/paper_model.v:485`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_non_starvation' :
    forall j,
      arrives_in arr_seq j ->
      forall omega,
        { R | @job_response_time_bound _ _ (algB omega) (job_cost omega) _  j R }.
```

- 注释：要求采用的服务反转、忙区间或响应时间分析语义成立。

## 2. 与数据结构有关的 Hypothesis（27 条）

### D001

- 代表位置：`analysis/abstract/IBF/task.v:121`
- 重复出现次数：88
- 原句：

```coq
  Hypothesis H_tsk_in_ts : tsk \in ts.
```

- 注释：说明某个元素或某对分析结果属于列表或集合表示的容器，这是列表式表示分析结果时常见的结构性前提。

### D002

- 代表位置：`analysis/abstract/IBF/task.v:249`
- 重复出现次数：59
- 原句：

```coq
    Hypothesis H_j_arrives : arrives_in arr_seq j.
```

- 注释：说明当前讨论的作业确实属于到达序列；这是把某个具体作业纳入显式输入集合的结构性前提。

### D003

- 代表位置：`analysis/abstract/ideal/cumulative_bounds.v:29`
- 重复出现次数：57
- 原句：

```coq
  Hypothesis H_all_jobs_from_taskset : all_jobs_from_taskset arr_seq ts.
```

- 注释：要求到达序列中的每个作业都能对应到任务集中的某个任务；这是把作业层对象和任务层对象连接起来的结构性前提。

### D004

- 代表位置：`analysis/abstract/IBF/task.v:107`
- 重复出现次数：42
- 原句：

```coq
  Hypothesis H_jobs_come_from_arrival_sequence : jobs_come_from_arrival_sequence sched arr_seq.
```

- 注释：要求调度里出现的作业都来自显式给出的到达序列，从而保证调度对象和输入对象一致。

### D005

- 代表位置：`analysis/abstract/IBF/task.v:250`
- 重复出现次数：36
- 原句：

```coq
    Hypothesis H_job_of_tsk : job_of_task tsk j.
```

- 注释：说明当前作业通过 `job_of_task`、`task_of_job` 或 `job_task` 这类映射与任务对象建立了对应关系。

### D006

- 代表位置：`analysis/abstract/busy_interval.v:157`
- 重复出现次数：25
- 原句：

```coq
  Hypothesis H_consistent_arrival_times : consistent_arrival_times arr_seq.
```

- 注释：要求到达序列中记录的到达时刻与作业的到达函数保持一致，避免两种表示之间不一致。

### D007

- 代表位置：`analysis/abstract/IBF/task.v:201`
- 重复出现次数：8
- 原句：

```coq
    Hypothesis H_j1_arrives : arrives_in arr_seq j1.
```

- 注释：说明当前讨论的作业确实属于到达序列；这是把某个具体作业纳入显式输入集合的结构性前提。

### D008

- 代表位置：`analysis/abstract/IBF/task.v:202`
- 重复出现次数：8
- 原句：

```coq
    Hypothesis H_j2_arrives : arrives_in arr_seq j2.
```

- 注释：说明当前讨论的作业确实属于到达序列；这是把某个具体作业纳入显式输入集合的结构性前提。

### D009

- 代表位置：`analysis/abstract/busy_interval.v:238`
- 重复出现次数：6
- 原句：

```coq
  Hypothesis H_arrival_sequence_is_a_set : arrival_sequence_uniq arr_seq.
```

- 注释：要求到达序列本身没有重复元素，因此可以把它当作集合使用。

### D010

- 代表位置：`analysis/facts/hyperperiod.v:170`
- 重复出现次数：6
- 原句：

```coq
  Hypothesis H_j1_task : job_task j1 = tsk.
```

- 注释：说明当前作业通过 `job_of_task`、`task_of_job` 或 `job_task` 这类映射与任务对象建立了对应关系。

### D011

- 代表位置：`analysis/facts/periodic/arrival_separation.v:40`
- 重复出现次数：5
- 原句：

```coq
    Hypothesis H_j2_of_task : job_task j2 = tsk.
```

- 注释：说明当前作业通过 `job_of_task`、`task_of_job` 或 `job_task` 这类映射与任务对象建立了对应关系。

### D012

- 代表位置：`analysis/abstract/IBF/task.v:363`
- 重复出现次数：4
- 原句：

```coq
        Hypothesis H_not_job_of_tsk : job_of_task tsk j'.
```

- 注释：说明当前作业通过 `job_of_task`、`task_of_job` 或 `job_task` 这类映射与任务对象建立了对应关系。

### D013

- 代表位置：`analysis/facts/priority/jlfp_with_fp.v:30`
- 重复出现次数：4
- 原句：

```coq
  Hypothesis H_task_set : uniq ts.
```

- 注释：要求到达序列本身没有重复元素，因此可以把它当作集合使用。

### D014

- 代表位置：`analysis/facts/workload/edf_athep_bound.v:96`
- 重复出现次数：4
- 原句：

```coq
      Hypothesis H_tsko_in_ts : tsk_o \in ts.
```

- 注释：说明某个元素或某对分析结果属于列表或集合表示的容器，这是列表式表示分析结果时常见的结构性前提。

### D015

- 代表位置：`analysis/abstract/IBF/task.v:328`
- 重复出现次数：3
- 原句：

```coq
        Hypothesis H_not_job_of_tsk : ~~ job_of_task tsk j'.
```

- 注释：说明当前作业通过 `job_of_task`、`task_of_job` 或 `job_task` 这类映射与任务对象建立了对应关系。

### D016

- 代表位置：`analysis/facts/model/service_of_jobs.v:471`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_no_duplicate_jobs : uniq jobs.
```

- 注释：要求到达序列本身没有重复元素，因此可以把它当作集合使用。

### D017

- 代表位置：`analysis/facts/tdma.v:17`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_task_in_ts : task \in ts.
```

- 注释：说明某个元素或某对分析结果属于列表或集合表示的容器，这是列表式表示分析结果时常见的结构性前提。

### D018

- 代表位置：`results/transfer_schedulability/paper_model.v:378`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_arrives : arrives_in arr_seq jf.
```

- 注释：说明当前讨论的作业确实属于到达序列；这是把某个具体作业纳入显式输入集合的结构性前提。

### D019

- 代表位置：`analysis/abstract/IBF/task.v:203`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_j1_from_tsk : job_of_task tsk j1.
```

- 注释：说明当前作业通过 `job_of_task`、`task_of_job` 或 `job_task` 这类映射与任务对象建立了对应关系。

### D020

- 代表位置：`analysis/abstract/IBF/task.v:204`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_j2_from_tsk : job_of_task tsk j2.
```

- 注释：说明当前作业通过 `job_of_task`、`task_of_job` 或 `job_task` 这类映射与任务对象建立了对应关系。

### D021

- 代表位置：`analysis/facts/busy_interval/service_inversion.v:344`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_jlp_arrives : arrives_in arr_seq jlp.
```

- 注释：说明当前讨论的作业确实属于到达序列；这是把某个具体作业纳入显式输入集合的结构性前提。

### D022

- 代表位置：`analysis/facts/delay_propagation.v:194`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_in_ts : tsk2 \in ts2.
```

- 注释：说明某个元素或某对分析结果属于列表或集合表示的容器，这是列表式表示分析结果时常见的结构性前提。

### D023

- 代表位置：`analysis/facts/job_index.v:23`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_same_task : job_task j1 = job_task j2.
```

- 注释：说明当前作业通过 `job_of_task`、`task_of_job` 或 `job_task` 这类映射与任务对象建立了对应关系。

### D024

- 代表位置：`analysis/facts/model/offset.v:24`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_job_of_task : job_task j = tsk.
```

- 注释：说明当前作业通过 `job_of_task`、`task_of_job` 或 `job_task` 这类映射与任务对象建立了对应关系。

### D025

- 代表位置：`analysis/facts/model/service_of_jobs.v:542`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_no_duplicate_jobs : uniq js.
```

- 注释：要求到达序列本身没有重复元素，因此可以把它当作集合使用。

### D026

- 代表位置：`analysis/facts/model/workload.v:290`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_j_in_jobs : j \in jobs.
```

- 注释：说明某个元素或某对分析结果属于列表或集合表示的容器，这是列表式表示分析结果时常见的结构性前提。

### D027

- 代表位置：`results/transfer_schedulability/criterion.v:111`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_jobs_arr_ref : jobs_come_from_arrival_sequence ref_sched arr_seq.
```

- 注释：要求调度里出现的作业都来自显式给出的到达序列，从而保证调度对象和输入对象一致。

## 3. 其他 Hypothesis（269 条）

### O001

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/elf.v:40`
- 重复出现次数：34
- 原句：

```coq
  Hypothesis H_priority_is_transitive : transitive_task_priorities FP.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O002

- 代表位置：`analysis/abstract/ideal/iw_instantiation.v:515`
- 重复出现次数：23
- 原句：

```coq
    Hypothesis H_work_bearing_readiness : work_bearing_readiness arr_seq sched.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O003

- 代表位置：`analysis/abstract/ideal/iw_instantiation.v:645`
- 重复出现次数：18
- 原句：

```coq
      Hypothesis H_L_positive : L > 0.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O004

- 代表位置：`analysis/facts/model/overheads/sbf/fifo.v:88`
- 重复出现次数：17
- 原句：

```coq
  Hypothesis H_no_superfluous_preemptions : no_superfluous_preemptions sched.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O005

- 代表位置：`analysis/abstract/restricted_supply/search_space/fifo_fixpoint.v:40`
- 重复出现次数：14
- 原句：

```coq
  Hypothesis H_SBF_monotone : sbf_is_monotone SBF.
```

- 注释：这是搜索空间缩减、界函数等价替换或单调性证明中的技术性条件。

### O006

- 代表位置：`analysis/abstract/IBF/task.v:327`
- 重复出现次数：10
- 原句：

```coq
        Hypothesis H_sched : scheduled_at sched j' t.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O007

- 代表位置：`analysis/definitions/progress.v:25`
- 重复出现次数：10
- 原句：

```coq
    Hypothesis H_t1_before_t2 : t1 <= t2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O008

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/edf.v:244`
- 重复出现次数：8
- 原句：

```coq
      Hypothesis H_arrives : t1 <= job_arrival j.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O009

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/elf.v:123`
- 重复出现次数：8
- 原句：

```coq
  Hypothesis H_L_positive : 0 < L.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O010

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/elf.v:41`
- 重复出现次数：8
- 原句：

```coq
  Hypothesis H_total_priorities : total_task_priorities FP.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O011

- 代表位置：`analysis/facts/transform/edf_opt.v:186`
- 重复出现次数：7
- 原句：

```coq
  Hypothesis H_no_deadline_misses : all_deadlines_met sched.
```

- 注释：这是程序构造、前缀变换、交换步骤或实现细节中的技术性前提。

### O012

- 代表位置：`analysis/abstract/ideal/cumulative_bounds.v:57`
- 重复出现次数：6
- 原句：

```coq
  Hypothesis H_Δ_in_busy : t1 + Δ <= t2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O013

- 代表位置：`results/rta/ideal/edf/bounded_nps.v:205`
- 重复出现次数：6
- 原句：

```coq
    Hypothesis H_fixed_point : L = total_rbf L.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O014

- 代表位置：`analysis/abstract/ideal/iw_instantiation.v:554`
- 重复出现次数：5
- 原句：

```coq
      Hypothesis H_t_in_busy_interval : t1 <= t < t2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O015

- 代表位置：`analysis/abstract/restricted_supply/abstract_rta.v:151`
- 重复出现次数：5
- 原句：

```coq
    Hypothesis H_inside_busy_interval : t1 + Δ < t2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O016

- 代表位置：`analysis/facts/edf_definitions.v:61`
- 重复出现次数：5
- 原句：

```coq
  Hypothesis H_no_deadline_misses : all_deadlines_of_arrivals_met arr_seq sched.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O017

- 代表位置：`analysis/facts/readiness/backlogged.v:72`
- 重复出现次数：5
- 原句：

```coq
  Hypothesis H_nonclairvoyant_job_readiness : nonclairvoyant_readiness RM.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O018

- 代表位置：`analysis/facts/behavior/arrivals.v:535`
- 重复出现次数：4
- 原句：

```coq
  Hypothesis H_scheduled_at : scheduled_at sched j t.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O019

- 代表位置：`analysis/facts/workload/edf_athep_bound.v:97`
- 重复出现次数：4
- 原句：

```coq
      Hypothesis H_neq : tsk_o != tsk.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O020

- 代表位置：`results/rta/ideal/edf/bounded_pi.v:271`
- 重复出现次数：4
- 原句：

```coq
    Hypothesis H_A_is_in_abstract_search_space :
      search_space.is_in_search_space L total_interference_bound A.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O021

- 代表位置：`analysis/abstract/ideal/cumulative_bounds.v:66`
- 重复出现次数：3
- 原句：

```coq
    Hypothesis H_priority_inversion_is_bounded :
      priority_inversion_is_bounded_by arr_seq sched tsk priority_inversion_bound.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O022

- 代表位置：`analysis/abstract/ideal/iw_instantiation.v:195`
- 重复出现次数：3
- 原句：

```coq
      Hypothesis H_j'_hep : hep_job j' j.
```

- 注释：这是为了当前分析分支引入的局部关系或判定条件，例如选择某个任务对、作业对或搜索结果。

### O023

- 代表位置：`analysis/abstract/ideal/iw_instantiation.v:648`
- 重复出现次数：3
- 原句：

```coq
      Hypothesis H_fixed_point : L = total_request_bound_function ts L.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O024

- 代表位置：`analysis/facts/busy_interval/existence.v:443`
- 重复出现次数：3
- 原句：

```coq
        Hypothesis H_delta_positive : delta > 0.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O025

- 代表位置：`analysis/facts/busy_interval/pi.v:161`
- 重复出现次数：3
- 原句：

```coq
    Hypothesis H_jlp_lower_priority : ~~ hep_job jlp j.
```

- 注释：这是为了当前分析分支引入的局部关系或判定条件，例如选择某个任务对、作业对或搜索结果。

### O026

- 代表位置：`analysis/facts/busy_interval/service_inversion.v:125`
- 重复出现次数：3
- 原句：

```coq
    Hypothesis H_supply : has_supply sched t.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O027

- 代表位置：`analysis/facts/hyperperiod.v:84`
- 重复出现次数：3
- 原句：

```coq
  Hypothesis H_infinite_jobs : infinite_jobs arr_seq.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O028

- 代表位置：`analysis/facts/transform/edf_opt.v:41`
- 重复出现次数：3
- 原句：

```coq
  Hypothesis H_not_idle : scheduled_at sched j1 t1.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O029

- 代表位置：`results/rta/ideal/fp/bounded_nps.v:162`
- 重复出现次数：3
- 原句：

```coq
    Hypothesis H_fixed_point : L = blocking_bound ts tsk + total_hep_rbf L.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O030

- 代表位置：`analysis/abstract/IBF/task.v:191`
- 重复出现次数：2
- 原句：

```coq
  Hypothesis H_task_interference_is_bounded :
    task_interference_is_bounded_by arr_seq sched tsk task_IBF.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O031

- 代表位置：`analysis/abstract/IBF/task.v:295`
- 重复出现次数：2
- 原句：

```coq
        Hypothesis H_idle : is_idle arr_seq sched t.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O032

- 代表位置：`analysis/abstract/abstract_rta.v:311`
- 重复出现次数：2
- 原句：

```coq
      Hypothesis H_small_fixpoint_solution : t1 + F < t2.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O033

- 代表位置：`analysis/abstract/ideal/iw_instantiation.v:121`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_idle : ideal_is_idle sched t.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O034

- 代表位置：`analysis/abstract/restricted_supply/task_ibf_readiness.v:66`
- 重复出现次数：2
- 原句：

```coq
  Hypothesis H_workload_is_bounded :
    athep_workload_is_bounded arr_seq sched tsk athep_workload_bound.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O035

- 代表位置：`analysis/facts/behavior/completion.v:311`
- 重复出现次数：2
- 原句：

```coq
  Hypothesis H_positive_cost : job_cost j > 0.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O036

- 代表位置：`analysis/facts/busy_interval/existence.v:436`
- 重复出现次数：2
- 原句：

```coq
        Hypothesis H_priority_inversion_is_bounded :
          is_priority_inversion_bounded_by priority_inversion_bound.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O037

- 代表位置：`analysis/facts/busy_interval/existence.v:623`
- 重复出现次数：2
- 原句：

```coq
      Hypothesis H_workload_is_bounded :
        forall t, priority_inversion_bound (job_arrival j - t) + hp_workload t (t + delta) <= delta.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O038

- 代表位置：`analysis/facts/busy_interval/existence.v:91`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_quiet : quiet_time t1.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O039

- 代表位置：`analysis/facts/busy_interval/service_inversion.v:273`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_t_le_t2 : t <= t2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O040

- 代表位置：`analysis/facts/model/sbf/periodic.v:136`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_q1_small : q1 < Π.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O041

- 代表位置：`analysis/facts/model/sbf/periodic.v:137`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_q2_small : q2 < Π.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O042

- 代表位置：`analysis/facts/transform/edf_opt.v:44`
- 重复出现次数：2
- 原句：

```coq
  Hypothesis H_deadline_not_missed : t1 < job_deadline j1.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O043

- 代表位置：`implementation/facts/extrapolated_arrival_curve.v:44`
- 重复出现次数：2
- 原句：

```coq
  Hypothesis H_sorted_leq : sorted_leq_steps ac_prefix.
```

- 注释：这是程序构造、前缀变换、交换步骤或实现细节中的技术性前提。

### O044

- 代表位置：`implementation/facts/extrapolated_arrival_curve.v:45`
- 重复出现次数：2
- 原句：

```coq
  Hypothesis H_no_inf_arrivals : no_inf_arrivals ac_prefix.
```

- 注释：这是程序构造、前缀变换、交换步骤或实现细节中的技术性前提。

### O045

- 代表位置：`implementation/facts/ideal_uni/preemption_aware.v:116`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_chooses_from_set : forall t s j, choose_job t s = Some j -> j \in s.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O046

- 代表位置：`results/rta/ideal/fifo/bounded_nps.v:343`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_in_abstract : is_in_abstract_search_space A.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O047

- 代表位置：`results/rta/ideal/fp/bounded_pi.v:149`
- 重复出现次数：2
- 原句：

```coq
  Hypothesis H_priority_inversion_is_bounded :
    priority_inversion_is_bounded_by
      arr_seq sched tsk (constant priority_inversion_bound).
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O048

- 代表位置：`results/rta/ideal/fp/bounded_pi.v:156`
- 重复出现次数：2
- 原句：

```coq
  Hypothesis H_fixed_point :
    L = priority_inversion_bound + total_hep_rbf L.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O049

- 代表位置：`util/bigcat.v:324`
- 重复出现次数：2
- 原句：

```coq
  Hypothesis H_no_partition_missing : forall x, x \in xs -> P x -> x_to_y x \in ys.
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O050

- 代表位置：`util/search_arg.v:174`
- 重复出现次数：2
- 原句：

```coq
  Hypothesis R_reflexive : reflexive R.
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O051

- 代表位置：`util/search_arg.v:175`
- 重复出现次数：2
- 原句：

```coq
  Hypothesis R_transitive : transitive R.
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O052

- 代表位置：`util/search_arg.v:176`
- 重复出现次数：2
- 原句：

```coq
  Hypothesis R_total : total R.
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O053

- 代表位置：`util/unit_growth.v:37`
- 重复出现次数：2
- 原句：

```coq
    Hypothesis H_is_interval : x1 <= x2.
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O054

- 代表位置：`analysis/abstract/IBF/task.v:265`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_inside_busy_interval : t1 + x < t2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O055

- 代表位置：`analysis/abstract/IBF/task.v:268`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_job_j_is_not_completed : ~~ completed_by sched j (t1 + x).
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O056

- 代表位置：`analysis/abstract/IBF/task.v:290`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_t_in_interval : t1 <= t < t1 + x.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O057

- 代表位置：`analysis/abstract/IBF/task.v:364`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_serv : service_at sched j' t = 0.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O058

- 代表位置：`analysis/abstract/IBF/task.v:432`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_serv : service_at sched j' t = 1.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O059

- 代表位置：`analysis/abstract/abstract_rta.v:116`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_job_interference_is_bounded_IBFP :
    job_interference_is_bounded_by
      arr_seq sched tsk IBF_P relative_arrival_time_of_job_is_A.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O060

- 代表位置：`analysis/abstract/abstract_rta.v:151`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_job_interference_is_bounded_IBFNP :
    job_interference_is_bounded_by
      arr_seq sched tsk IBF_NP relative_time_to_reach_rtct.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O061

- 代表位置：`analysis/abstract/abstract_rta.v:161`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_IBF_NP_ge_param : forall F Δ, F <= task_cost tsk + IBF_NP F Δ.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O062

- 代表位置：`analysis/abstract/abstract_rta.v:176`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_R_is_maximum :
    forall (A : duration),
      is_in_search_space A ->
      exists (F : duration),
        task_rtct tsk + IBF_P A F <= F
        /\ task_cost tsk + IBF_NP F (A + R) <= A + R.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O063

- 代表位置：`analysis/abstract/abstract_rta.v:243`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_Asp_le_A : A_sp <= A.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O064

- 代表位置：`analysis/abstract/abstract_rta.v:246`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_equivalent :
      are_equivalent_at_values_less_than (IBF_P A) (IBF_P A_sp) L.
```

- 注释：这是搜索空间缩减、界函数等价替换或单调性证明中的技术性条件。

### O065

- 代表位置：`analysis/abstract/abstract_rta.v:250`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_Asp_is_in_search_space : is_in_search_space A_sp.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O066

- 代表位置：`analysis/abstract/abstract_rta.v:256`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_F_fixpoint : task_rtct tsk + IBF_P A_sp F <= F.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O067

- 代表位置：`analysis/abstract/abstract_rta.v:260`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_Asp_R_fixpoint :
      task_cost tsk + IBF_NP F (A_sp + R) <= A_sp + R.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O068

- 代表位置：`analysis/abstract/abstract_rta.v:275`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_big_fixpoint_solution : t2 <= t1 + F.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O069

- 代表位置：`analysis/abstract/abstract_rta.v:314`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_big_fixpoint_solution : t2 <= t1 + (A_sp + R).
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O070

- 代表位置：`analysis/abstract/abstract_rta.v:347`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_small_fixpoint_solution2 : t1 + (A_sp + R) < t2.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O071

- 代表位置：`analysis/abstract/abstract_rta.v:367`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_job_cost_is_small : job_cost j <= task_rtct tsk.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O072

- 代表位置：`analysis/abstract/abstract_rta.v:398`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_job_cost_is_big : task_rtct tsk <= job_cost j.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O073

- 代表位置：`analysis/abstract/busy_interval.v:272`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_iw_bounded :
      cumulative_interfering_workload j t1 (t1 + δ) <= cumulative_interference j t1 (t1 + δ).
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O074

- 代表位置：`analysis/abstract/busy_interval.v:309`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_j_is_pending : pending sched j t_busy.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O075

- 代表位置：`analysis/abstract/busy_interval.v:370`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_δ_positive : δ > 0.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O076

- 代表位置：`analysis/abstract/busy_interval.v:371`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_workload_is_bounded :
        workload_of_job arr_seq j t1 (t1 + δ)
        + cumulative_interfering_workload j t1 (t1 + δ) <= δ.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O077

- 代表位置：`analysis/abstract/busy_interval.v:382`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_no_quiet_time : forall t, t1 < t <= t1 + δ -> ~ quiet_time t.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O078

- 代表位置：`analysis/abstract/ideal/abstract_rta.v:169`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_R_is_maximum_ideal :
    forall A,
      is_in_search_space A ->
      exists F,
        task_rtct tsk + interference_bound_function A (A + F) <= A + F
        /\ F + (task_cost tsk - task_rtct tsk) <= R.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O079

- 代表位置：`analysis/abstract/ideal/abstract_rta.v:90`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_job_interference_is_bounded :
    job_interference_is_bounded_by
      arr_seq sched tsk interference_bound_function (relative_arrival_time_of_job_is_A sched).
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O080

- 代表位置：`analysis/abstract/ideal/abstract_seq_rta.v:147`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_R_is_maximum_seq :
    forall (A : duration),
      is_in_search_space_seq A ->
      exists (F : duration),
        A + F >= (task_rbf (A + ε) - (task_cost tsk - task_rtct tsk)) + task_IBF A (A + F)
        /\ R >= F + (task_cost tsk - task_rtct tsk).
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O081

- 代表位置：`analysis/abstract/lower_bound_on_service.v:119`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_progress_le_job_cost : progress_of_job <= job_cost j.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O082

- 代表位置：`analysis/abstract/lower_bound_on_service.v:124`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_total_workload_is_bounded :
      progress_of_job + cumulative_interference j t1 (t1 + δ) <= δ.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O083

- 代表位置：`analysis/abstract/lower_bound_on_service.v:67`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_t1_le_t : t1 <= t.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O084

- 代表位置：`analysis/abstract/lower_bound_on_service.v:68`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_tδ_le_t2 : t + δ <= t2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O085

- 代表位置：`analysis/abstract/restricted_supply/abstract_rta.v:153`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_job_j_is_not_completed : ~~ completed_by sched j (t1 + Δ).
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O086

- 代表位置：`analysis/abstract/restricted_supply/abstract_rta.v:213`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_F_le_Δ : F <= Δ.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O087

- 代表位置：`analysis/abstract/restricted_supply/abstract_rta.v:214`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_enough_service : task_rtct tsk <= service sched j (t1 + F).
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O088

- 代表位置：`analysis/abstract/restricted_supply/abstract_rta.v:254`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_R_is_maximum_rs :
    forall (A : duration),
      is_in_search_space_rs A ->
      exists (F : duration),
        F <= A + R
        /\ task_rtct tsk + intra_IBF A F <= SBF F
        /\ SBF F + (task_cost tsk - task_rtct tsk) <= SBF (A + R).
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O089

- 代表位置：`analysis/abstract/restricted_supply/abstract_rta.v:99`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_intra_supply_interference_is_bounded :
    intra_interference_is_bounded_by arr_seq sched tsk intra_IBF.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O090

- 代表位置：`analysis/abstract/restricted_supply/abstract_seq_rta.v:113`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_interference_inside_reservation_is_bounded :
    task_intra_interference_is_bounded_by arr_seq sched tsk task_intra_IBF.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O091

- 代表位置：`analysis/abstract/restricted_supply/abstract_seq_rta.v:151`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_R_is_maximum_seq_rs :
    forall (A : duration),
      is_in_search_space_rs A ->
      exists (F : duration),
        F <= A + R
        /\ (task_rbf (A + ε) - (task_cost tsk - task_rtct tsk)) + task_intra_IBF A F <= SBF F
        /\ SBF F + (task_cost tsk - task_rtct tsk) <= SBF (A + R).
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O092

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/edf.v:136`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_interval_in_busy_prefix : t1 + δ <= t2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O093

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/edf.v:220`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_fixed_point : total_request_bound_function ts L <= SBF L.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O094

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/elf.v:124`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_fixed_point :
    forall (A : duration),
      blocking_bound ts tsk A + total_hep_request_bound_function_FP ts tsk L <= SBF L.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O095

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/fp.v:117`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_fixed_point :
    blocking_bound ts tsk + total_hep_request_bound_function_FP ts tsk L <= SBF L.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O096

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/jlfp.v:122`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_blocking_bound_max :
    forall A, blocking_bound 0 >= blocking_bound A.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O097

- 代表位置：`analysis/abstract/restricted_supply/bounded_bi/jlfp.v:129`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_fixed_point :
    blocking_bound 0 + total_request_bound_function ts L <= SBF L.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O098

- 代表位置：`analysis/abstract/restricted_supply/search_space/fifo_fixpoint.v:93`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_R_is_maximum :
    forall (A : duration),
      is_in_search_space ts L A ->
      exists (F : duration),
        SBF F >= total_request_bound_function ts (A + ε)
        /\ A + R >= F.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O099

- 代表位置：`analysis/abstract/restricted_supply/task_ibf_readiness.v:71`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_readiness_interference_bounded :
    readiness_interference_is_bounded arr_seq sched readiness_interference_bound.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O100

- 代表位置：`analysis/abstract/search_space.v:133`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_less_than : A_sp + F_sp < B.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O101

- 代表位置：`analysis/abstract/search_space.v:134`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_fixpoint : A_sp + F_sp >= interference_bound_function A_sp (A_sp + F_sp).
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O102

- 代表位置：`analysis/abstract/search_space.v:140`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_bounds_for_A : A_sp <= A <= A_sp + F_sp.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O103

- 代表位置：`analysis/abstract/search_space.v:141`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_equivalent :
      are_equivalent_at_values_less_than
        (interference_bound_function A)
        (interference_bound_function A_sp) B.
```

- 注释：这是搜索空间缩减、界函数等价替换或单调性证明中的技术性条件。

### O104

- 代表位置：`analysis/abstract/search_space.v:75`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_A_less_than_B : A < B.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O105

- 代表位置：`analysis/definitions/schedulability.v:86`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_R_le_deadline : R <= task_deadline tsk.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O106

- 代表位置：`analysis/facts/SBF.v:37`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_p2_implies_p1 :
      forall j t1 t2,
        arrives_in arr_seq j ->
        P2 j t1 t2 -> P1 j t1 t2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O107

- 代表位置：`analysis/facts/SBF.v:76`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_P_interval : P j t1 t2.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O108

- 代表位置：`analysis/facts/behavior/service.v:211`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_less_than_s : s < service sched j t.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O109

- 代表位置：`analysis/facts/behavior/service.v:579`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_same_service : service sched j t1 = service sched j t2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O110

- 代表位置：`analysis/facts/behavior/service.v:890`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_sched1_sched2_same_service_at :
      forall t, t1 <= t < t2 ->
           service_at sched1 j t = service_at sched2 j t.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O111

- 代表位置：`analysis/facts/busy_interval/carry_in.v:128`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_delta_positive : Δ > 0.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O112

- 代表位置：`analysis/facts/busy_interval/carry_in.v:129`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_workload_is_bounded :
    forall t,
      no_carry_in arr_seq sched t ->
      blackout_during sched t (t + Δ) + total_workload_between arr_seq t (t + Δ) <= Δ.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O113

- 代表位置：`analysis/facts/busy_interval/carry_in.v:152`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_no_carry_in : no_carry_in arr_seq sched t.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O114

- 代表位置：`analysis/facts/busy_interval/existence.v:248`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_no_quiet_time : forall t, t1 < t <= t1 + Δ -> ~ quiet_time t.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O115

- 代表位置：`analysis/facts/busy_interval/existence.v:366`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_j_is_pending : job_pending_at j t_busy.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O116

- 代表位置：`analysis/facts/busy_interval/existence.v:444`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_workload_is_bounded :
          priority_inversion_bound A + hp_workload t1 (t1 + delta) <= delta.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O117

- 代表位置：`analysis/facts/busy_interval/existence.v:454`
- 重复出现次数：1
- 原句：

```coq
          Hypothesis H_no_quiet_time :
            forall t, t1 < t <= t1 + delta -> ~ quiet_time t.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O118

- 代表位置：`analysis/facts/busy_interval/existence.v:616`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_priority_inversion_is_bounded :
        is_priority_inversion_bounded_by priority_inversion_bound .
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O119

- 代表位置：`analysis/facts/busy_interval/existence.v:92`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_not_quiet : ~ quiet_time t2.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O120

- 代表位置：`analysis/facts/busy_interval/hep_at_pt.v:349`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_preemption_time_exists :
    exists pr_t, preemption_time arr_seq sched pr_t /\ t1 <= pr_t <= t1 + K.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O121

- 代表位置：`analysis/facts/busy_interval/hep_at_pt.v:66`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_t_preemption_time : preemption_time arr_seq sched t.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O122

- 代表位置：`analysis/facts/busy_interval/pi.v:211`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_from_t1_before_t2 : t1 <= t_pi < t2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O123

- 代表位置：`analysis/facts/busy_interval/pi.v:212`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_PI_occurs : priority_inversion arr_seq sched j t_pi.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O124

- 代表位置：`analysis/facts/busy_interval/pi.v:266`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_ts1_in_busy_prefix : t1 <= ts1 < t2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O125

- 代表位置：`analysis/facts/busy_interval/pi.v:271`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_j1_sched : scheduled_at sched j1 ts1.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O126

- 代表位置：`analysis/facts/busy_interval/pi.v:272`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_j1_lower_prio : ~~ hep_job j1 j.
```

- 注释：这是为了当前分析分支引入的局部关系或判定条件，例如选择某个任务对、作业对或搜索结果。

### O127

- 代表位置：`analysis/facts/busy_interval/pi.v:276`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_ts2_in_busy_prefix : t1 <= ts2 < t2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O128

- 代表位置：`analysis/facts/busy_interval/pi.v:280`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_j2_sched : scheduled_at sched j2 ts2.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O129

- 代表位置：`analysis/facts/busy_interval/pi.v:281`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_j2_lower_prio : ~~ hep_job j2 j.
```

- 注释：这是为了当前分析分支引入的局部关系或判定条件，例如选择某个任务对、作业对或搜索结果。

### O130

- 代表位置：`analysis/facts/busy_interval/pi.v:402`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_is_idle : is_idle arr_seq sched t1.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O131

- 代表位置：`analysis/facts/busy_interval/pi.v:425`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_jhp_is_scheduled : scheduled_at sched jhp t1.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O132

- 代表位置：`analysis/facts/busy_interval/pi.v:426`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_jhp_hep_priority : hep_job jhp j.
```

- 注释：这是为了当前分析分支引入的局部关系或判定条件，例如选择某个任务对、作业对或搜索结果。

### O133

- 代表位置：`analysis/facts/busy_interval/pi.v:455`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_jlp_is_scheduled : scheduled_at sched jlp t1.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O134

- 代表位置：`analysis/facts/busy_interval/pi.v:467`
- 重复出现次数：1
- 原句：

```coq
          Hypothesis H_fpt_is_preemption_point : job_preemptable jlp (progr_t1 + fpt).
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O135

- 代表位置：`analysis/facts/busy_interval/pi.v:659`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_preemption_point : preemption_time arr_seq sched ppt.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O136

- 代表位置：`analysis/facts/busy_interval/pi.v:660`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_after_t1 : t1 <= ppt.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O137

- 代表位置：`analysis/facts/busy_interval/pi.v:71`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_jlp_lp : ~~hep_job jlp j.
```

- 注释：这是为了当前分析分支引入的局部关系或判定条件，例如选择某个任务对、作业对或搜索结果。

### O138

- 代表位置：`analysis/facts/busy_interval/pi.v:77`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_jlp_scheduled_at_t : scheduled_at sched jlp t.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O139

- 代表位置：`analysis/facts/busy_interval/service_inversion.v:389`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_t1_le_st_lt_t : t1 <= st < t.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O140

- 代表位置：`analysis/facts/busy_interval/service_inversion.v:390`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_jlp_sched : scheduled_at sched jlp st.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O141

- 代表位置：`analysis/facts/busy_interval/service_inversion.v:394`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_σ_is_pt : job_preemptable jlp σ.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O142

- 代表位置：`analysis/facts/delay_propagation.v:171`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_job2_of_singleton :
    (forall tsk1,
        tsk1 \in ts1 ->
        forall j1,
          job_task j1 = tsk1 ->
          size (job2_of j1) <= 1).
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O143

- 代表位置：`analysis/facts/hyperperiod.v:173`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_j1_arr_after_O_max : O_max <= job_arrival j1.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O144

- 代表位置：`analysis/facts/hyperperiod.v:174`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_j2_arr_after_O_max : O_max <= job_arrival j2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O145

- 代表位置：`analysis/facts/interference.v:145`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_no_supply : ~~ has_supply sched t.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O146

- 代表位置：`analysis/facts/interference.v:286`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_j_served : receives_service_at sched j t.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O147

- 代表位置：`analysis/facts/interference.v:373`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_j'_lp : ~~ hep_job j' j.
```

- 注释：这是为了当前分析分支引入的局部关系或判定条件，例如选择某个任务对、作业对或搜索结果。

### O148

- 代表位置：`analysis/facts/interference.v:407`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_quiet_time : classical.quiet_time arr_seq sched j t1.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O149

- 代表位置：`analysis/facts/job_index.v:252`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_positive_job_index : job_index arr_seq j > 0.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O150

- 代表位置：`analysis/facts/job_index.v:30`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_equal_index : job_index arr_seq j1 = job_index arr_seq j2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O151

- 代表位置：`analysis/facts/model/overheads/priority_bump.v:109`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_JLFP_is_FIFO : forall j1 j2, hep_job j1 j2 = (job_arrival j1 <= job_arrival j2).
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O152

- 代表位置：`analysis/facts/model/overheads/schedule_change_bound.v:148`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_t_in_busy_prefix : t1 < t <= t2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O153

- 代表位置：`analysis/facts/model/preemption.v:368`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_sched_t1 : scheduled_at sched j t1.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O154

- 代表位置：`analysis/facts/model/preemption.v:369`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_sched_t2 : scheduled_at sched j t2.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O155

- 代表位置：`analysis/facts/model/preemption.v:373`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_j_is_ready :
    forall t, t1 <= t < t2 -> job_ready sched j t.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O156

- 代表位置：`analysis/facts/model/rbf.v:146`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_also_satisfied : forall j, pred1 j -> pred2 (job_task j).
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O157

- 代表位置：`analysis/facts/model/rbf.v:718`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_job_arrival_lt : job_arrival j < t1 + Δ.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O158

- 代表位置：`analysis/facts/model/rbf.v:95`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_jobs_of_tsk : forall j, P j -> job_of_task tsk j.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O159

- 代表位置：`analysis/facts/model/sbf/periodic.v:214`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_k1_lt_k2 : k1 < k2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O160

- 代表位置：`analysis/facts/model/sequential.v:87`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_sequential : sequential_readiness JR arr_seq.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O161

- 代表位置：`analysis/facts/model/service_of_jobs.v:616`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_quiet_time : quiet_time arr_seq sched j t1.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O162

- 代表位置：`analysis/facts/periodic/arrival_separation.v:123`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_j1_neq_j2 : j1 <> j2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O163

- 代表位置：`analysis/facts/periodic/arrival_separation.v:131`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_j1_before_j2 : job_arrival j1 <= job_arrival j2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O164

- 代表位置：`analysis/facts/periodic/arrival_separation.v:41`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_consecutive_jobs : job_index arr_seq j2 = job_index arr_seq j1 + 1.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O165

- 代表位置：`analysis/facts/periodic/arrival_separation.v:75`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_index_difference_k : job_index arr_seq j1 + k = job_index arr_seq j2 .
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O166

- 代表位置：`analysis/facts/periodic/arrival_separation.v:76`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_job_arrival_lt : job_arrival j1 < job_arrival j2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O167

- 代表位置：`analysis/facts/priority/classes.v:158`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_transitive : transitive hep_task.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O168

- 代表位置：`analysis/facts/readiness/backlogged.v:82`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_shared_prefix : identical_prefix sched sched' h.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O169

- 代表位置：`analysis/facts/suspension.v:133`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis INtf : t1 <= tf < t2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O170

- 代表位置：`analysis/facts/suspension.v:137`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_suspended_tf : suspended sched j tf.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O171

- 代表位置：`analysis/facts/suspension.v:138`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_service_at_tf : service sched j tf = ρ.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O172

- 代表位置：`analysis/facts/suspension.v:139`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_before_tf :
        forall to,
          t1 <= to < tf ->
          ~~ (suspended sched j to && (service sched j to == ρ)).
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O173

- 代表位置：`analysis/facts/tdma.v:85`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis slot_order_transitive :
      transitive_slot_order.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O174

- 代表位置：`analysis/facts/transform/edf_opt.v:282`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_sched_orig : scheduled_at sched  j_orig t_edf.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O175

- 代表位置：`analysis/facts/transform/edf_opt.v:287`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_sched_edf : scheduled_at sched' j_edf t_edf.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O176

- 代表位置：`analysis/facts/transform/edf_opt.v:293`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_t_edf_le_t' : t_edf <= t'.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O177

- 代表位置：`analysis/facts/transform/edf_opt.v:294`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_sched' : scheduled_at sched' j' t'.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O178

- 代表位置：`analysis/facts/transform/edf_opt.v:297`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_arrival_j' : job_arrival j' <= t_edf.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O179

- 代表位置：`analysis/facts/transform/edf_wc.v:55`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_arrival_j2 : job_arrival j2 <= t1.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O180

- 代表位置：`analysis/facts/transform/edf_wc.v:61`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_t2_not_idle : scheduled_at sched j2 t2.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O181

- 代表位置：`analysis/facts/transform/edf_wc.v:77`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_backlogged_j_t : backlogged swap_sched j t.
```

- 注释：这是关于某个具体作业或调度状态在某个时刻是否空闲、是否挂起、是否可抢占等局部证明假设。

### O182

- 代表位置：`analysis/facts/transform/swaps.v:375`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_not_EDF :
    forall j1 j2,
      scheduled_at sched j1 t1 ->
      scheduled_at sched j2 t2 ->
      job_deadline j1 >=  job_deadline j2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O183

- 代表位置：`analysis/facts/transform/swaps.v:384`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_no_idle_time_at_t2 :
    forall j1,
      scheduled_at sched j1 t1 ->
      exists j2, scheduled_at sched j2 t2 /\ job_deadline j2 > t2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O184

- 代表位置：`analysis/facts/transform/swaps.v:402`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_deadline_met : job_meets_deadline sched j.
```

- 注释：这是程序构造、前缀变换、交换步骤或实现细节中的技术性前提。

### O185

- 代表位置：`analysis/facts/transform/wc_correctness.v:242`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis search_result_found : search_result = Some t_swap.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O186

- 代表位置：`analysis/facts/transform/wc_correctness.v:270`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_job_ready_sched' : job_ready sched' j t.
```

- 注释：这是程序构造、前缀变换、交换步骤或实现细节中的技术性前提。

### O187

- 代表位置：`analysis/facts/transform/wc_correctness.v:273`
- 重复出现次数：1
- 原句：

```coq
        Hypothesis H_search_result_none : search_result = None.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O188

- 代表位置：`analysis/facts/transform/wc_correctness.v:449`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_horizon_order : h1 <= h2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O189

- 代表位置：`analysis/facts/workload/edf_athep_bound.v:100`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_Δ_ge : A + ε + D tsk - D tsk_o <= Δ.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O190

- 代表位置：`analysis/facts/workload/elf_athep_bound.v:100`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_delta_ge : ((ep_task_interfering_interval_length tsk tsk_o A) <= delta%:R)%R.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O191

- 代表位置：`analysis/facts/workload/elf_athep_bound.v:83`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_delta_in_busy : t1 + delta < t2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O192

- 代表位置：`analysis/transform/prefix.v:46`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_f_maintains_P : forall sched t, P sched -> P (f sched t).
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O193

- 代表位置：`analysis/transform/prefix.v:74`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_f_maintains_P :
      forall sched t_ref,
        P sched -> P (f sched t_ref).
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O194

- 代表位置：`analysis/transform/prefix.v:79`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_f_grows_Q :
      forall sched t_ref,
        P sched ->
        (forall t', t' <  t_ref -> Q sched t') ->
        forall t', t' <= t_ref -> Q (f sched t_ref) t'.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O195

- 代表位置：`implementation/facts/extrapolated_arrival_curve.v:133`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_sorted_ltn : sorted_ltn_steps ac_prefix.
```

- 注释：这是程序构造、前缀变换、交换步骤或实现细节中的技术性前提。

### O196

- 代表位置：`implementation/facts/extrapolated_arrival_curve.v:192`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_positive : positive_horizon ac_prefix.
```

- 注释：这是程序构造、前缀变换、交换步骤或实现细节中的技术性前提。

### O197

- 代表位置：`implementation/facts/ideal_uni/preemption_aware.v:48`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_non_idling :
      forall t s,
        choose_job t s = idle_state <-> s = [::].
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O198

- 代表位置：`implementation/facts/ideal_uni/prio_aware.v:32`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_transitive : transitive_priorities JLDP.
```

- 注释：这是程序构造、前缀变换、交换步骤或实现细节中的技术性前提。

### O199

- 代表位置：`implementation/facts/maximal_arrival_sequence.v:36`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_job_generation_valid_number :
    forall (tsk : Task) (n : nat) (t : instant), tsk \in ts -> size (generate_jobs_at tsk n t) = n.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O200

- 代表位置：`implementation/facts/maximal_arrival_sequence.v:41`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_job_generation_valid_jobs :
    forall (tsk : Task) (n : nat) (t : instant) (j : Job),
      (j \in generate_jobs_at tsk n t) ->
      job_task j = tsk
      /\ job_arrival j = t
      /\ job_cost j <= task_cost tsk.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O201

- 代表位置：`implementation/facts/maximal_arrival_sequence.v:49`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_jobs_unique :
    forall (t1 t2 : instant),
      uniq (arrivals_between (concrete_arrival_sequence generate_jobs_at ts) t1 t2).
```

- 注释：这是程序构造、前缀变换、交换步骤或实现细节中的技术性前提。

### O202

- 代表位置：`implementation/refinements/EDF/fast_search_space.v:93`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_all_tsk_positive_cost : forall tsk, tsk \in ts -> 0 < task_cost tsk.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O203

- 代表位置：`results/generality/elf.v:41`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_FP_policy_is_same :
      forall tsk1 tsk2, ep_task tsk1 tsk2.
```

- 注释：这是为了当前分析分支引入的局部关系或判定条件，例如选择某个任务对、作业对或搜索结果。

### O204

- 代表位置：`results/generality/elf.v:89`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_distinct_fixed_priorities :
      forall tsk1 tsk2, tsk1 != tsk2 -> ~~ ep_task tsk1 tsk2.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O205

- 代表位置：`results/generality/gel.v:105`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_total : total_task_priorities fp.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O206

- 代表位置：`results/generality/gel.v:136`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_delta_pos : (pp_delta tsk tsk' >= 0)%R.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O207

- 代表位置：`results/generality/gel.v:178`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_unique_fixed_priorities :
      forall j j',
        arrives_in arr_seq j ->
        arrives_in arr_seq j' ->
        ~~ same_task j j' ->
        hep_task (job_task j) (job_task j') ->
        hp_task (job_task j) (job_task j').
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O208

- 代表位置：`results/generality/gel.v:190`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_hp_delta_pos :
      forall j j',
        arrives_in arr_seq j ->
        arrives_in arr_seq j' ->
        hp_task (job_task j) (job_task j') ->
        (pp_delta (job_task j) (job_task j') >= 0)%R.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O209

- 代表位置：`results/generality/gel.v:47`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_priority_point :
      forall tsk,
        task_priority_point tsk = task_deadline tsk.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O210

- 代表位置：`results/generality/gel.v:73`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_priority_point :
      forall tsk,
        task_priority_point tsk = 0.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O211

- 代表位置：`results/optimality/edf.v:144`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_all_deadlines_met : all_deadlines_met any_sched.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O212

- 代表位置：`results/rta/ideal/edf/bounded_nps.v:211`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_R_is_maximum :
      forall (A : duration),
        is_in_search_space L A ->
        exists (F : duration),
          A + F >= blocking_bound ts tsk A
                  + (task_rbf (A + ε) - (task_cost tsk - task_rtct tsk))
                  + bound_on_athep_workload ts tsk A (A + F)
          /\ R >= F + (task_cost tsk - task_rtct tsk).
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O213

- 代表位置：`results/rta/ideal/edf/bounded_pi.v:202`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_R_is_maximum :
    forall (A : duration),
      is_in_search_space A ->
      exists (F : duration),
        A + F >= priority_inversion_bound A
                + (task_rbf (A + ε) - (task_cost tsk - task_rtct tsk))
                + bound_on_athep_workload ts tsk  A (A + F)
        /\ R >= F + (task_cost tsk - task_rtct tsk).
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O214

- 代表位置：`results/rta/ideal/edf/bounded_pi.v:221`
- 重复出现次数：1
- 原句：

```coq
  (** ** Filling Out Hypothesis Of Abstract RTA Theorem *)
  (** In this section we prove that all hypotheses necessary to use
      the abstract theorem are satisfied. *)

  (** First, we prove that [task_IBF] is indeed a valid bound on the
      cumulative task interference. *)
  Lemma instantiated_task_interference_is_bounded :
    task_interference_is_bounded_by arr_seq sched tsk task_IBF.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O215

- 代表位置：`results/rta/ideal/edf/floating_nonpreemptive.v:110`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_R_is_maximum :
    forall (A : duration),
      is_in_search_space A ->
      exists (F : duration),
        A + F >= blocking_bound ts tsk A + task_rbf (A + ε)
                + bound_on_athep_workload ts tsk A (A + F)
        /\ R >= F.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O216

- 代表位置：`results/rta/ideal/edf/fully_nonpreemptive.v:108`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_R_is_maximum :
    forall A,
      is_in_search_space A ->
      exists F,
        A + F >= blocking_bound A + (task_rbf (A + ε) - (task_cost tsk - ε))
                + bound_on_athep_workload ts tsk A (A + F)
        /\ R >= F + (task_cost tsk - ε).
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O217

- 代表位置：`results/rta/ideal/edf/fully_preemptive.v:107`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_R_is_maximum :
    forall (A : duration),
      is_in_search_space A ->
      exists (F : duration),
        A + F >= task_rbf (A + ε) + bound_on_athep_workload ts tsk A (A + F)
        /\ R >= F.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O218

- 代表位置：`results/rta/ideal/edf/limited_preemptive.v:111`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_R_is_maximum :
    forall (A : duration),
      is_in_search_space A ->
      exists (F : duration),
        A + F >= blocking_bound ts tsk A
                + (task_rbf (A + ε) - (task_last_nonpr_segment tsk - ε))
                + bound_on_athep_workload ts tsk A (A + F)
        /\ R >= F + (task_last_nonpr_segment tsk - ε).
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O219

- 代表位置：`results/rta/ideal/elf/bounded_pi.v:168`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_priority_inversion_from_lp_tasks_is_bounded :
    priority_inversion_cond_is_bounded_by arr_seq sched tsk
      is_lower_priority (constant priority_inversion_lp_tasks_bound).
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O220

- 代表位置：`results/rta/ideal/elf/bounded_pi.v:178`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_priority_inversion_from_ep_tasks_is_bounded :
    priority_inversion_cond_is_bounded_by arr_seq sched tsk
      is_equal_priority priority_inversion_ep_tasks_bound.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O221

- 代表位置：`results/rta/ideal/elf/bounded_pi.v:207`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_priority_inversion_from_ep_tasks_concrete_bound :
    forall j t1,
      job_task j = tsk ->
      priority_inversion_ep_tasks_bound (job_arrival j - t1)
        <= \max_(i <- ts | ep_task_blocking_relevant i j t1) task_cost i.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O222

- 代表位置：`results/rta/ideal/elf/bounded_pi.v:254`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_fixed_point : L = priority_inversion_lp_tasks_bound + total_hep_rbf L.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O223

- 代表位置：`results/rta/ideal/elf/bounded_pi.v:408`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_task_priority : ep_task tsk tsk_o.
```

- 注释：这是为了当前分析分支引入的局部关系或判定条件，例如选择某个任务对、作业对或搜索结果。

### O224

- 代表位置：`results/rta/ideal/elf/bounded_pi.v:419`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_Δ_ge : (ep_task_intf_interval tsk_o A <= Δ%:R)%R.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O225

- 代表位置：`results/rta/ideal/elf/bounded_pi.v:618`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_R_is_maximum :
    forall (A : duration),
      is_in_search_space A ->
      exists (F : duration),
        A + F >= priority_inversion_bound A
                + bound_on_total_ep_workload A (A + F)
                + total_hp_rbf (A + F)
                + (task_request_bound_function tsk (A + ε)
                - (task_cost tsk - task_rtct tsk))
          /\ R >= F + (task_cost tsk - task_rtct tsk).
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O226

- 代表位置：`results/rta/ideal/fp/bounded_nps.v:170`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_R_is_maximum :
      forall (A : duration),
        is_in_search_space A ->
        exists (F : duration),
          A + F >= blocking_bound ts tsk
                  + (task_rbf (A + ε) - (task_cost tsk - task_rtct tsk))
                  + total_ohep_rbf (A + F)
          /\ F + (task_cost tsk - task_rtct tsk) <= R.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O227

- 代表位置：`results/rta/ideal/fp/bounded_pi.v:170`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_R_is_maximum :
    forall (A : duration),
      is_in_search_space A ->
      exists (F : duration),
        A + F >= priority_inversion_bound
                + (task_rbf (A + ε) - (task_cost tsk - task_rtct tsk))
                + total_ohep_rbf (A + F)
        /\ R >= F + (task_cost tsk - task_rtct tsk).
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O228

- 代表位置：`results/rta/ideal/fp/comp/fully_preemptive.v:101`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_L_is_fixpoint :
    Some L = find_fixpoint (total_hep_request_bound_function_FP ts tsk) h.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O229

- 代表位置：`results/rta/ideal/fp/comp/fully_preemptive.v:117`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_R_is_max_fixpoint :
    Some R = find_max_fixpoint L is_in_search_space recurrence h.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O230

- 代表位置：`results/rta/ideal/fp/floating_nonpreemptive.v:119`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_R_is_maximum :
    forall (A : duration),
      is_in_search_space A ->
      exists  (F : duration),
        A + F >= blocking_bound ts tsk + task_rbf (A + ε) + total_ohep_rbf (A + F)
        /\ R >= F.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O231

- 代表位置：`results/rta/ideal/fp/fully_nonpreemptive.v:107`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_fixed_point : L = blocking_bound + total_hep_rbf L.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O232

- 代表位置：`results/rta/ideal/fp/fully_nonpreemptive.v:118`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_R_is_maximum :
    forall (A : duration),
      is_in_search_space A ->
      exists (F : duration),
        A + F >= blocking_bound
                + (task_rbf (A + ε) - (task_cost tsk - ε))
                + total_ohep_rbf (A + F)
        /\ R >= F + (task_cost tsk - ε).
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O233

- 代表位置：`results/rta/ideal/fp/fully_preemptive.v:103`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_fixed_point : L = total_hep_rbf L.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O234

- 代表位置：`results/rta/ideal/fp/fully_preemptive.v:114`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_R_is_maximum :
    forall (A : duration),
      is_in_search_space A ->
      exists (F : duration),
        A + F >= task_rbf (A + ε) + total_ohep_rbf (A + F)
        /\ R >= F.
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O235

- 代表位置：`results/rta/ideal/fp/limited_preemptive.v:120`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_R_is_maximum :
    forall (A : duration),
      is_in_search_space A ->
      exists (F : duration),
        A + F >= blocking_bound ts tsk
                + (task_rbf (A + ε) - (task_last_nonpr_segment tsk - ε))
                + total_ohep_rbf (A + F)
        /\ R >= F + (task_last_nonpr_segment tsk - ε).
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O236

- 代表位置：`results/rta/ideal/fp/nonseq/bounded_pi.v:364`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_R_is_maximum :
    forall (A : duration),
      is_in_concrete_search_space A ->
      exists (F : duration),
        0 < F
        /\ A + F >= priority_inversion_bound + total_hep_rbf (A + F)
                    - (task_cost tsk - task_rtct tsk)
        /\ R >= F + (task_cost tsk - task_rtct tsk).
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O237

- 代表位置：`results/rta/ideal/gel/bounded_pi.v:175`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis H_Δ_ge : (interval tsk_o A <= Δ%:R)%R.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O238

- 代表位置：`results/rta/ideal/gel/bounded_pi.v:329`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_R_is_maximum :
    forall (A : duration),
      is_in_search_space A ->
      exists (F : duration),
        A + F >= priority_inversion_bound A
                + (task_request_bound_function tsk (A + ε) - (task_cost tsk - task_rtct tsk))
                + bound_on_total_hep_workload  A (A + F)
        /\ R >= F + (task_cost tsk - task_rtct tsk).
```

- 注释：这是一个不动点、最大值条件或递推方程约束，用于推动响应时间或搜索空间相关证明。

### O239

- 代表位置：`results/transfer_schedulability/criterion.v:1095`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_bounded_job_costs : forall j, online_job_cost j <= ref_job_cost j.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O240

- 代表位置：`results/transfer_schedulability/criterion.v:174`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_job_cost_bounded :
      forall j,
        online_job_cost j <= job_cost_bound j.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O241

- 代表位置：`results/transfer_schedulability/criterion.v:181`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_ref_cost_dominates :
      forall j,
        job_cost_bound j <= ref_job_cost j.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O242

- 代表位置：`results/transfer_schedulability/criterion.v:579`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_ts_criterion : transfer_schedulability_criterion.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O243

- 代表位置：`results/transfer_schedulability/paper_model.v:208`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_max_cost :
    forall omega j,
      job_cost omega j <= job_cost omega_0 j.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O244

- 代表位置：`results/transfer_schedulability/paper_model.v:215`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_max_delay :
    forall omega j j',
      job_delay omega j j'  <= job_delay omega_0 j j'.
```

- 注释：这是关于具体时刻、区间或中间变量大小关系的技术性假设，用于当前证明分支的数值推导。

### O245

- 代表位置：`results/transfer_schedulability/paper_model.v:397`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_trans : schedulability_transferred_AB omega.
```

- 注释：这是为了当前分析分支引入的局部关系或判定条件，例如选择某个任务对、作业对或搜索结果。

### O246

- 代表位置：`results/transfer_schedulability/paper_model.v:431`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_criterion : clairvoyant_criterion.
```

- 注释：这是为了当前分析分支引入的局部关系或判定条件，例如选择某个任务对、作业对或搜索结果。

### O247

- 代表位置：`results/transfer_schedulability/paper_model.v:462`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_criterion : nonclairvoyant_criterion.
```

- 注释：这是为了当前分析分支引入的局部关系或判定条件，例如选择某个任务对、作业对或搜索结果。

### O248

- 代表位置：`results/transfer_schedulability/paper_model.v:537`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_bounded :
      forall omega j in_arrival_sequence,
        online_finish_time_bounded' omega j in_arrival_sequence.
```

- 注释：这是一个服务于中间推导、分类讨论或证明结构的技术性假设，不直接描述基础调度模型，也不是由数据结构表示直接引入的结构条件。

### O249

- 代表位置：`util/bigcat.v:216`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_uniq_f : forall x, P x -> uniq (f x).
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O250

- 代表位置：`util/bigcat.v:219`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_no_elements_in_common :
      forall x y z,
        x \in f y -> x \in f z -> y = z.
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O251

- 代表位置：`util/bigcat.v:253`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_g_cancels_f : forall x y, y \in f x -> g y = x.
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O252

- 代表位置：`util/bigcat.v:75`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_uniq_seq : forall i, uniq (f i).
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O253

- 代表位置：`util/bigcat.v:78`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_no_elements_in_common :
      forall x i1 i2, x \in f i1 -> x \in f i2 -> i1 = i2.
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O254

- 代表位置：`util/fixpoint.v:67`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_f_mono : monotone leq f.
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O255

- 代表位置：`util/fixpoint.v:70`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis F1 : f 1 > 0.
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O256

- 代表位置：`util/subadditivity.v:60`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis h_subadditive : subadditive f.
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O257

- 代表位置：`util/sum.v:287`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis equal_before_d : forall g, g < d -> F1 (t1 + g) = F2 (t2 + g).
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O258

- 代表位置：`util/sum.v:375`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_xs_unique : uniq xs.
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O259

- 代表位置：`util/sum.v:376`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_ys_unique : uniq ys.
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O260

- 代表位置：`util/sum.v:427`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_mono : forall i, i \in r -> monotone leq (F i).
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O261

- 代表位置：`util/superadditivity.v:108`
- 重复出现次数：1
- 原句：

```coq
      Hypothesis h_non_zero : exists n, f n > 0.
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O262

- 代表位置：`util/superadditivity.v:167`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis h_superadditive_until : superadditive_until f h.
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O263

- 代表位置：`util/superadditivity.v:173`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis h_f'_min_extension :
      forall t,
        f' t = if t == h
               then minimal_superadditive_extension h
               else f t.
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O264

- 代表位置：`util/superadditivity.v:75`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis h_superadditive : superadditive f.
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O265

- 代表位置：`util/unit_growth.v:133`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_not_P_at_t1 : ~~ P t1.
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O266

- 代表位置：`util/unit_growth.v:136`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_P_at_t2 : P t2.
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O267

- 代表位置：`util/unit_growth.v:14`
- 重复出现次数：1
- 原句：

```coq
  Hypothesis H_unit_growth_function : unit_growth_function f.
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O268

- 代表位置：`util/unit_growth.v:41`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_between : f x1 <= y < f x2.
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

### O269

- 代表位置：`util/unit_growth.v:97`
- 重复出现次数：1
- 原句：

```coq
    Hypothesis H_between : f x1 <= y <= f x2.
```

- 注释：这是通用工具库中的技术性前提，用于基础列表、序或代数推理，与具体调度模型无直接对应。

