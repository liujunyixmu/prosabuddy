import { describe, expect, test } from "bun:test"
import { ProofPlan, ProofPlanReview, ProofPlanStep, EnvFeedback, CheckpointResult, CoqProjectContext, SessionSummary, CoqSessionState } from "../../src/tool/proof-schema"

describe("proof-schema", () => {
  test("upgrades persisted proof reviews to the current four-revision budget", () => {
    const review = ProofPlanReview.parse({
      status: "reject",
      semantic_fingerprint: "legacy-plan",
      hard_errors: [],
      warnings: [],
      materialization_allowed: false,
      max_semantic_revisions: 1,
    })
    expect(review.max_semantic_revisions).toBe(4)
  })

  test("ProofPlanStep validates required fields", () => {
    const valid = ProofPlanStep.parse({
      paper_step_id: "step_1",
      paper_claim: "Prove commutativity of addition",
      formal_goal: "forall n m, n + m = m + n",
      candidate_lemmas: ["Nat.add_comm"],
      required_hypotheses: [],
      fallback_plan: [],
      done_when: "Qed succeeds",
    })
    expect(valid.paper_step_id).toBe("step_1")
    expect(valid.candidate_lemmas).toEqual(["Nat.add_comm"])
  })

  test("candidate roles distinguish direct application from local proof support", () => {
    const step = ProofPlanStep.parse({
      paper_step_id: "step_roles",
      paper_claim: "Use a rewrite while proving a larger goal.",
      formal_goal: "A /\\ B",
      candidate_lemmas: [],
      prosa_candidate_lemmas: [
        { name: "rewrite_piece", library: "prosa", role: "rewrite", reason: "rewrite a subterm" },
      ],
      required_hypotheses: [],
      fallback_plan: [],
      done_when: "The target compiles.",
    })
    expect(step.prosa_candidate_lemmas[0]?.role).toBe("rewrite")
  })

  test("ProofPlanStep rejects missing paper_claim", () => {
    expect(() => ProofPlanStep.parse({
      paper_step_id: "step_1",
      formal_goal: "forall n, n + 0 = n",
      candidate_lemmas: [],
      required_hypotheses: [],
      fallback_plan: [],
      done_when: "Qed",
    })).toThrow()
  })

  test("ProofPlan validates DAG node metadata", () => {
    const valid = ProofPlan.parse({
      theorem: "demo",
      root_goal: "demo",
      nodes: [
        {
          paper_step_id: "paper_step_001",
          node_id: "node_001_shape_transport",
          kind: "shape_transport",
          layer: "mathcomp",
          depends_on: ["theorem_context"],
          source: { kind: "proof_text", label: "demo:1", excerpt: "Use leqnn." },
          input: { hypotheses: [], definitions: [], facts: ["theorem_context"] },
          output: { hypotheses: [], definitions: [], facts: ["True"] },
          expected: {
            proof_contract: "Create one local leaf.",
            target_shape: "local_fact",
            evidence_required: ["mathcomp evidence"],
          },
          target: { normal_form: "True", shape: "local_fact", evidence: ["mathcomp:I"] },
          target_normal_form: "True",
          paper_claim: "Close the local fact.",
          formal_goal: "True",
          candidate_lemmas: ["I"],
          prosa_candidate_lemmas: [],
          mathcomp_candidate_lemmas: [{ name: "I", library: "mathcomp", reason: "fixture" }],
          required_hypotheses: [],
          fallback_plan: [],
          done_when: "Qed succeeds",
          consumers: ["parent_composition"],
          claim_delta: "Reduce the theorem root to one local shape fact.",
          transformations: ["representation_bridge"],
          delegation_candidate: true,
          risk: "low",
          evidence_status: "verified",
        },
      ],
      edges: [],
      ready_nodes: ["node_001_shape_transport"],
      planner_contract: {
        marker_fields_required_for_lemma_delegation: ["plan_node", "evidence"],
        note: "Materialize this DAG before delegation.",
      },
    })

    expect(valid.nodes[0]?.kind).toBe("shape_transport")
    expect(valid.nodes[0]?.target?.evidence).toEqual(["mathcomp:I"])
    expect(valid.nodes[0]?.delegation_candidate).toBe(true)
    expect(valid.nodes[0]?.transformations).toEqual(["representation_bridge"])
  })

  test("EnvFeedback validates kind enum", () => {
    const valid = EnvFeedback.parse({
      kind: "environment_problem",
      summary: "missing lemma Nat.add_comm",
      missing_symbol: "Nat.add_comm",
    })
    expect(valid.kind).toBe("environment_problem")
  })

  test("CheckpointResult validates same_as_previous", () => {
    const valid = CheckpointResult.parse({
      status: "error",
      first_error_file: "test.v",
      first_error_line: 10,
      first_error_message: "type mismatch",
      warning_summary: [],
      same_as_previous: true,
    })
    expect(valid.same_as_previous).toBe(true)
  })

  test("CoqProjectContext validates resolved context", () => {
    const valid = CoqProjectContext.parse({
      root: "/workspace",
      file: "/workspace/test.v",
      theorem: "add_comm",
      project_path: "/workspace/_CoqProject",
      flags: ["-Q", ".", "MyLib"],
      cwd: "/workspace",
      preamble: "Require Import Arith.",
    })
    expect(valid.theorem).toBe("add_comm")
    expect(valid.flags).toHaveLength(3)
  })

  test("CoqProjectContext allows null project_path", () => {
    const valid = CoqProjectContext.parse({
      root: "/workspace",
      file: "/workspace/test.v",
      theorem: "add_comm",
      project_path: null,
      flags: [],
      cwd: "/workspace",
      preamble: "",
    })
    expect(valid.project_path).toBeNull()
  })

  test("SessionSummary validates frontier data", () => {
    const valid = SessionSummary.parse({
      last_success: "intros.",
      last_failure: null,
      last_error_class: "proof_progress",
      remaining_goals: 2,
      frontier: "Goal: forall n, n + 0 = n",
      changed: true,
    })
    expect(valid.remaining_goals).toBe(2)
    expect(valid.changed).toBe(true)
  })

  test("CoqSessionState includes project and summary", () => {
    const valid = CoqSessionState.parse({
      session_id: "s1",
      loaded_file: "test content",
      focused_goal: "forall n, n + 0 = n",
      local_hyps: [],
      tactic_history: [],
      snapshots: {},
      last_error: null,
      warning_summary: [],
      project: {
        root: "/w",
        file: "/w/t.v",
        theorem: "th",
        project_path: null,
        flags: [],
        cwd: "/w",
        preamble: "",
      },
      summary: {
        last_success: null,
        last_failure: null,
        last_error_class: null,
        remaining_goals: null,
        frontier: null,
        changed: false,
      },
    })
    expect(valid.project?.theorem).toBe("th")
    expect(valid.summary?.changed).toBe(false)
  })

  test("CoqSessionState snapshot includes summary", () => {
    const valid = CoqSessionState.parse({
      session_id: "s1",
      loaded_file: "",
      focused_goal: "",
      local_hyps: [],
      tactic_history: [],
      snapshots: {
        snap1: {
          id: "snap1",
          goal: "test",
          hyps: [],
          tactic_index: 0,
          context: "",
          summary: {
            last_success: "intros.",
            last_failure: null,
            last_error_class: null,
            remaining_goals: 1,
            frontier: "Goal: test",
            changed: false,
          },
        },
      },
      last_error: null,
      warning_summary: [],
    })
    expect(valid.snapshots.snap1.summary?.last_success).toBe("intros.")
  })
})
