import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { LSP } from "../../src/lsp"
import { Session } from "../../src/session"
import { SessionProof } from "../../src/session/session-proof"
import { SessionProofWorkflow } from "../../src/session/proof-workflow"
import { ProofRouteLedger } from "../../src/session/proof-route-ledger"
import { ProofEditTransaction } from "../../src/session/proof-edit-transaction"
import { ProofPlan, ProofPlanReview } from "../../src/tool/proof-schema"
import { tmpdir } from "../fixture/fixture"

describe("session.proof-workflow lemma scheduling", () => {
  let scaffoldSpy: ReturnType<typeof spyOn> | undefined
  let lspTouchSpy: ReturnType<typeof spyOn> | undefined
  let lspDiagnosticsSpy: ReturnType<typeof spyOn> | undefined

  beforeEach(() => {
    scaffoldSpy = spyOn(SessionProofWorkflow.Validation, "scaffold").mockImplementation(async () => ({
      ok: true,
      validator: "checkpoint-coqc",
      status: "ok",
    }))
    lspTouchSpy = spyOn(LSP, "touchFile").mockImplementation(async () => undefined)
    lspDiagnosticsSpy = spyOn(LSP, "diagnostics").mockImplementation(async () => ({}))
  })

  afterEach(() => {
    scaffoldSpy?.mockRestore()
    lspTouchSpy?.mockRestore()
    lspDiagnosticsSpy?.mockRestore()
    scaffoldSpy = undefined
    lspTouchSpy = undefined
    lspDiagnosticsSpy = undefined
  })

  function regionBegin(admitID: string, target: string, normalForm = "True") {
    return `(* proof_region begin owner: lemma admit_id: ${admitID} theorem: demo kind: pointwise_semantic_bridge target: ${target} plan_node: node_${target} depends_on: theorem_context source: paper_step_001 input: theorem_context output: ${target} layer: coq_shape expected: local_fact normal_form: "${normalForm}" evidence: mathcomp:I informal proof: prove the local fact from I. *)`
  }

  function proofRegionText(source: string, admitID: string) {
    const begin = source.indexOf(`proof_region begin owner: lemma admit_id: ${admitID}`)
    const start = begin < 0 ? -1 : source.lastIndexOf("(*", begin)
    const endMarker = `(* proof_region end admit_id: ${admitID} *)`
    const end = source.indexOf(endMarker, begin)
    if (start < 0 || end < 0) throw new Error(`missing proof region ${admitID}`)
    return source.slice(start, end + endMarker.length)
  }

  function regionBeginWithoutInformal(admitID: string, target: string) {
    return `(* proof_region begin owner: lemma admit_id: ${admitID} theorem: demo kind: pointwise_semantic_bridge target: ${target} plan_node: node_${target} depends_on: theorem_context source: paper_step_001 input: theorem_context output: ${target} layer: coq_shape expected: local_fact normal_form: "True" evidence: mathcomp:I *)`
  }

  function boundedTheorem(body = "  admit.\nAdmitted.") {
    return [
      "From mathcomp Require Import all_ssreflect.",
      "",
      "Lemma demo : True.",
      "Proof.",
      body,
      "",
      "Lemma untouched : True.",
      "Proof. exact I. Qed.",
      "",
    ].join("\n")
  }

  test("suggestion and repair validation use the supplied staged source instead of stale disk", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/staged-source.v`
        const disk = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_old", "Hold"),
          "have Hold : True. { admit. }",
          "(* proof_region end admit_id: gap_old *)",
          "exact Hold.",
          "Admitted.",
          "",
        ].join("\n")
        const staged = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_new", "Hnew"),
          "have Hnew : True. { admit. }",
          "(* proof_region end admit_id: gap_new *)",
          "exact Hnew.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, disk)

        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        const suggestion = await SessionProofWorkflow.suggestNextSubtask(session.id, [], staged)
        expect(suggestion?.task.lemma_assignment?.admit_id).toBe("gap_new")

        await expect(
          SessionProofWorkflow.assertRepairAssignmentCurrent(
            session.id,
            file,
            {
              file,
              theorem: "demo",
              admit_id: "gap_old",
              escalation_type: "needs_subgoal_remodel",
              reason: "old compiler failure",
            },
            staged,
          ),
        ).rejects.toThrow("proof_repair_assignment_stale_revision")

        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("does not dispatch an unvalidated active transaction revision", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/resumed-staged-source.v`
        const disk = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_old", "Hold"),
          "have Hold : True. { admit. }",
          "(* proof_region end admit_id: gap_old *)",
          "exact Hold.",
          "Admitted.",
          "",
        ].join("\n")
        const staged = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_new", "Hnew"),
          "have Hnew : True. { admit. }",
          "(* proof_region end admit_id: gap_new *)",
          "exact Hnew.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, disk)

        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        await ProofEditTransaction.begin({
          sessionID: session.id,
          parentSessionID: session.id,
          agent: "prover",
          file,
          source: disk,
          scope: { kind: "theorem_body", theorem: "demo" },
        })
        ProofEditTransaction.stage({ sessionID: session.id, file, before: disk, after: staged })

        const suggestion = await SessionProofWorkflow.suggestNextSubtask(session.id, [])
        expect(suggestion).toBeUndefined()
        expect(ProofEditTransaction.active(session.id)?.validation_pending).toBe(true)
        expect(await Bun.file(file).text()).toBe(disk)

        ProofEditTransaction.abort(session.id)
        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("reads a distributed contract from leading comments inside the staged proof region", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/post-marker-contract.v`
        const source = [
          "Lemma demo : True.",
          "Proof.",
          "(* proof_region begin owner: lemma admit_id: gap_1 theorem: demo kind: pointwise_semantic_bridge target: Hbridge *)",
          "(* plan_node: node_Hbridge *)",
          "(* depends_on: theorem_context *)",
          "(* source: context-derived local bridge *)",
          "(* input: theorem_context *)",
          "(* output: Hbridge *)",
          "(* layer: coq_shape *)",
          "(* lemma_ready_layer: coq_shape *)",
          "(* expected: prove the exported local fact *)",
          "(* normal_form: True *)",
          "(* target_shape_review: accepted *)",
          "(* evidence: mathcomp:I *)",
          "have Hbridge : True.",
          "{ (* admit_id: gap_1 *) admit. }",
          "(* proof_region end admit_id: gap_1 *)",
          "exact Hbridge.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)

        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")

        const next = await SessionProofWorkflow.planNextSubtask(session.id, [], source)
        expect(next?.agent).toBe("lemma")
        expect(next?.lemma_assignment?.admit_id).toBe("gap_1")
        expect(next?.lemma_assignment?.obligation).toMatchObject({
          proof_plan_node: "node_Hbridge",
          dependencies: ["theorem_context"],
          source: "context-derived local bridge",
          input: ["theorem_context"],
          output: "Hbridge",
          layer: "coq_shape",
          expected: "prove the exported local fact",
          target_normal_form: "True",
          shape_evidence: ["mathcomp:I"],
        })

        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("checkpoint scaffold compiles a supplied staged source without mutating stale disk", async () => {
    scaffoldSpy?.mockRestore()
    scaffoldSpy = undefined
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/staged-scaffold.v`
        const disk = "This is stale and invalid Coq source.\n"
        const staged = "Lemma demo : True.\nProof.\nexact I.\nQed.\n"
        await Bun.write(file, disk)

        const result = await SessionProofWorkflow.Validation.scaffold(file, staged)
        expect(result.ok).toBe(true)
        expect(await Bun.file(file).text()).toBe(disk)
      },
    })
  })

  test("pending dispatch validates staged source and ignores stale disk LSP diagnostics", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/staged-dispatch.v`
        const disk = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_old", "Hold"),
          "have Hold : True. { admit. }",
          "(* proof_region end admit_id: gap_old *)",
          "exact Hold.",
          "Admitted.",
          "",
        ].join("\n")
        const staged = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_new", "Hnew"),
          "have Hnew : True. { admit. }",
          "(* proof_region end admit_id: gap_new *)",
          "exact Hnew.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, disk)
        lspDiagnosticsSpy?.mockImplementation(async () => ({
          [file]: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 },
              },
              severity: 1,
              message: "stale disk diagnostic outside the staged region",
            },
          ],
        }))

        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        const next = await SessionProofWorkflow.planNextSubtask(session.id, [], staged)

        expect(next?.agent).toBe("lemma")
        expect(next?.lemma_assignment?.admit_id).toBe("gap_new")
        expect(scaffoldSpy).toHaveBeenCalledWith(file, staged)
        expect(lspTouchSpy).not.toHaveBeenCalled()

        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("accepts a mechanically repaired candidate route without spending a semantic DAG revision", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/route-repair.v`
        const source = "Lemma demo : True.\nProof.\nAdmitted.\n"
        await Bun.write(file, source)
        const session = await Session.create({})
        const plan = ProofPlan.parse({
          theorem: "demo",
          root_goal: "True",
          nodes: [
            {
              paper_step_id: "step-1",
              node_id: "leaf-1",
              paper_claim: "derive the local fact",
              formal_goal: "True",
              candidate_lemmas: [],
              prosa_candidate_lemmas: [],
              mathcomp_candidate_lemmas: [],
              required_hypotheses: [],
              fallback_plan: [],
              done_when: "the local fact is available",
              depends_on: [],
              consumers: ["parent_composition"],
              transformations: [],
              delegation_candidate: true,
            },
          ],
          edges: [],
          ready_nodes: ["leaf-1"],
          planner_contract: { marker_fields_required_for_lemma_delegation: [], note: "fixture" },
        })
        const blocked = ProofPlanReview.parse({
          status: "reject",
          semantic_fingerprint: "same-semantic-dag",
          hard_errors: [
            {
              severity: "hard_error",
              code: "candidate_unresolved_premise",
              message: "candidate needs an unmapped premise",
              node_id: "leaf-1",
            },
          ],
          warnings: [],
          materialization_allowed: false,
          max_semantic_revisions: 4,
        })
        const repaired = ProofPlanReview.parse({
          status: "ready",
          semantic_fingerprint: "same-semantic-dag",
          hard_errors: [],
          warnings: [],
          materialization_allowed: true,
          max_semantic_revisions: 4,
        })

        const first = SessionProofWorkflow.recordDecompositionPlanAttempt({
          sessionID: session.id,
          file,
          source,
          plan,
          review: blocked,
        })
        const repeated = SessionProofWorkflow.recordDecompositionPlanAttempt({
          sessionID: session.id,
          file,
          source,
          plan,
          review: blocked,
        })
        const repairedAttempt = SessionProofWorkflow.recordDecompositionPlanAttempt({
          sessionID: session.id,
          file,
          source,
          plan,
          review: repaired,
        })

        expect(first.state.status).toBe("planning")
        expect(first.recommended_action).toBe("repair_plan_route")
        expect(repeated.state.status).toBe("planning")
        expect(repeated.state.semantic_revision_number).toBe(0)
        expect(repeated.recommended_action).toBe("repair_plan_route")
        expect(repairedAttempt.state.status).toBe("accepted")
        expect(repairedAttempt.state.semantic_revision_number).toBe(0)
        expect(repairedAttempt.same_semantic_plan).toBe(true)
        expect(repairedAttempt.recommended_action).toBe("materialize_once")

        SessionProofWorkflow.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("recovers a compatible accepted decomposition plan in a fresh session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/fresh-plan.v`
        const source = "Lemma demo : True.\nProof.\nAdmitted.\n"
        await Bun.write(file, source)
        const original = await Session.create({})
        const fresh = await Session.create({})
        SessionProof.set(original.id, file, { line: 1, character: 0 }, "manual")
        SessionProof.set(fresh.id, file, { line: 1, character: 0 }, "manual")

        const plan = ProofPlan.parse({
          theorem: "demo",
          root_goal: "True",
          nodes: [
            {
              paper_step_id: "step-1",
              node_id: "node_Hlocal",
              paper_claim: "derive the local fact",
              formal_goal: "True",
              candidate_lemmas: [],
              prosa_candidate_lemmas: [],
              mathcomp_candidate_lemmas: [],
              required_hypotheses: [],
              fallback_plan: [],
              done_when: "the local fact is available",
              depends_on: [],
              consumers: ["parent_composition"],
              transformations: [],
              delegation_candidate: true,
            },
          ],
          edges: [],
          ready_nodes: ["node_Hlocal"],
          planner_contract: { marker_fields_required_for_lemma_delegation: [], note: "fixture" },
        })
        const review = ProofPlanReview.parse({
          status: "ready",
          semantic_fingerprint: "accepted-fresh-session-plan",
          hard_errors: [],
          warnings: [],
          materialization_allowed: true,
          max_semantic_revisions: 4,
        })
        SessionProofWorkflow.recordDecompositionPlanAttempt({
          sessionID: original.id,
          file,
          source,
          plan,
          review,
        })

        const recovered = SessionProofWorkflow.refresh(fresh.id, file, source).state.decomposition_plan
        expect(recovered?.status).toBe("accepted")
        expect(recovered?.accepted_semantic_fingerprint).toBe("accepted-fresh-session-plan")
        expect(recovered?.accepted_plan?.nodes.map((node) => node.node_id)).toEqual(["node_Hlocal"])

        const changed = source.replace("True", "False")
        const incompatible = await Session.create({})
        SessionProof.set(incompatible.id, file, { line: 1, character: 0 }, "manual")
        expect(SessionProofWorkflow.refresh(incompatible.id, file, changed).state.decomposition_plan).toBeUndefined()

        SessionProofWorkflow.clear(original.id)
        SessionProofWorkflow.clear(fresh.id)
        SessionProofWorkflow.clear(incompatible.id)
        SessionProof.clear(original.id)
        SessionProof.clear(fresh.id)
        SessionProof.clear(incompatible.id)
        await Session.remove(original.id)
        await Session.remove(fresh.id)
        await Session.remove(incompatible.id)
      },
    })
  })

  test("allows only the runner-authorized target proof span", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const source = boundedTheorem()
        await Bun.write(file, source)
        SessionProof.set(session.id, file, { line: 3, character: 0 }, "manual")

        expect(() =>
          SessionProofWorkflow.assertBoundProofBodyMutationAllowed({
            sessionID: session.id,
            file,
            before: source,
            after: boundedTheorem("  exact I.\nQed."),
          }),
        ).not.toThrow()
        expect(() =>
          SessionProofWorkflow.assertBoundProofBodyMutationAllowed({
            sessionID: session.id,
            file,
            before: source,
            after: `${boundedTheorem("  exact I.\nQed.")}\n`,
          }),
        ).not.toThrow()
        expect(() =>
          SessionProofWorkflow.assertBoundProofBodyMutationAllowed({
            sessionID: session.id,
            file,
            before: source,
            after: source.replace("Lemma demo : True.", "Lemma demo : False."),
          }),
        ).toThrow("proof_scope_integrity_rejection")
        expect(() =>
          SessionProofWorkflow.assertBoundProofBodyMutationAllowed({
            sessionID: session.id,
            file,
            before: source,
            after: source.replace("From mathcomp", "From Coq"),
          }),
        ).toThrow("proof_scope_integrity_rejection")
        expect(() =>
          SessionProofWorkflow.assertBoundProofBodyMutationAllowed({
            sessionID: session.id,
            file,
            before: source,
            after: source.replace("Lemma untouched : True.", "Lemma untouched : False."),
          }),
        ).toThrow("proof_scope_integrity_rejection")
        expect(() =>
          SessionProofWorkflow.assertBoundProofBodyMutationAllowed({
            sessionID: session.id,
            file,
            before: source,
            after: `${boundedTheorem("  exact I.\nQed.")}\nCheck True.\n`,
          }),
        ).toThrow("proof_scope_integrity_rejection")

        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("keeps the best rejected plan diagnostic and accepts a corrected recovery generation", async () => {
    await using tmp = await tmpdir({ git: true })
    const previousMode = process.env.OPENCODE_PROOF_WORKFLOW_MODE
    process.env.OPENCODE_PROOF_WORKFLOW_MODE = "prooftex_structured_workflow"

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const file = `${tmp.path}/exhausted.v`
          const session = await Session.create({})
          const source = boundedTheorem()
          await Bun.write(file, source)
          SessionProof.set(session.id, file, { line: 3, character: 0 }, "manual")
          const plan = ProofPlan.parse({
            theorem: "demo",
            root_goal: "True",
            nodes: [
              {
                paper_step_id: "bad-root",
                node_id: "bad-root",
                paper_claim: "delegate the complete theorem",
                formal_goal: "True",
                candidate_lemmas: [],
                prosa_candidate_lemmas: [],
                mathcomp_candidate_lemmas: [],
                required_hypotheses: [],
                fallback_plan: [],
                done_when: "the theorem is delegated",
                depends_on: [],
                consumers: ["parent_composition"],
                transformations: [],
                delegation_candidate: true,
              },
            ],
            edges: [],
            ready_nodes: ["bad-root"],
            planner_contract: { marker_fields_required_for_lemma_delegation: [], note: "fixture" },
          })
          const rejected = ProofPlanReview.parse({
            status: "reject",
            semantic_fingerprint: "rejected-root-plan",
            hard_errors: [
              {
                severity: "hard_error",
                code: "parent_equivalent_leaf",
                message: "the theorem root cannot be delegated",
                node_id: "bad-root",
              },
            ],
            warnings: [],
            materialization_allowed: false,
            max_semantic_revisions: 4,
          })
          const worsePlan = ProofPlan.parse({
            ...plan,
            nodes: [{ ...plan.nodes[0]!, paper_step_id: "worse-root", node_id: "worse-root" }],
            ready_nodes: ["worse-root"],
          })
          const worseReview = ProofPlanReview.parse({
            ...rejected,
            semantic_fingerprint: "worse-rejected-root-plan",
            hard_errors: [
              ...rejected.hard_errors,
              {
                severity: "hard_error",
                code: "disconnected_leaf",
                message: "the rejected node is also disconnected",
                node_id: "worse-root",
              },
            ],
          })
          SessionProofWorkflow.recordDecompositionPlanAttempt({
            sessionID: session.id,
            file,
            source,
            plan,
            review: rejected,
          })
          const exhausted = SessionProofWorkflow.recordDecompositionPlanAttempt({
            sessionID: session.id,
            file,
            source,
            plan: worsePlan,
            review: worseReview,
          })
          const repeatedWorse = SessionProofWorkflow.recordDecompositionPlanAttempt({
            sessionID: session.id,
            file,
            source,
            plan: worsePlan,
            review: worseReview,
          })

          expect(exhausted.state.status).toBe("planning")
          expect(repeatedWorse.state.status).toBe("exhausted")
          expect(repeatedWorse.recommended_action).toBe("start_new_plan_generation")
          expect(repeatedWorse.state.terminal_verdict?.status).toBe("semantic_incomplete")
          expect(repeatedWorse.state.terminal_verdict?.recoverable).toBe(true)
          expect(repeatedWorse.state.best_rejected_review?.semantic_fingerprint).toBe("rejected-root-plan")
          expect(repeatedWorse.state.last_review.semantic_fingerprint).toBe("worse-rejected-root-plan")
          expect(() =>
            SessionProofWorkflow.assertBoundProofBodyMutationAllowed({
              sessionID: session.id,
              file,
              before: source,
              after: boundedTheorem("  exact I.\nQed."),
            }),
          ).toThrow("decomposition_plan_materialization_rejection")

          const acceptedReview = ProofPlanReview.parse({
            ...rejected,
            status: "ready",
            semantic_fingerprint: "corrected-recovery-plan",
            hard_errors: [],
            materialization_allowed: true,
          })
          const recovered = SessionProofWorkflow.recordDecompositionPlanAttempt({
            sessionID: session.id,
            file,
            source,
            plan,
            review: acceptedReview,
          })
          expect(recovered.state.status).toBe("accepted")
          expect(recovered.state.planning_generation).toBe(1)
          expect(recovered.recommended_action).toBe("materialize_once")

          SessionProofWorkflow.clear(session.id)
          SessionProof.clear(session.id)
          await Session.remove(session.id)
        },
      })
    } finally {
      if (previousMode === undefined) delete process.env.OPENCODE_PROOF_WORKFLOW_MODE
      else process.env.OPENCODE_PROOF_WORKFLOW_MODE = previousMode
    }
  })

  test("makes the second exhausted planning generation final", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/final-exhaustion.v`
        const session = await Session.create({})
        const source = boundedTheorem()
        await Bun.write(file, source)
        SessionProof.set(session.id, file, { line: 3, character: 0 }, "manual")
        const plan = ProofPlan.parse({
          theorem: "demo",
          root_goal: "True",
          nodes: [{
            paper_step_id: "bad-root",
            node_id: "bad-root",
            paper_claim: "delegate the complete theorem",
            formal_goal: "True",
            candidate_lemmas: [],
            prosa_candidate_lemmas: [],
            mathcomp_candidate_lemmas: [],
            required_hypotheses: [],
            fallback_plan: [],
            done_when: "the theorem is delegated",
            depends_on: [],
            consumers: ["parent_composition"],
            transformations: [],
            delegation_candidate: true,
          }],
          edges: [],
          ready_nodes: ["bad-root"],
          planner_contract: { marker_fields_required_for_lemma_delegation: [], note: "fixture" },
        })
        const rejected = ProofPlanReview.parse({
          status: "reject",
          semantic_fingerprint: "same-rejected-plan",
          hard_errors: [{
            severity: "hard_error",
            code: "parent_equivalent_leaf",
            message: "the theorem root cannot be delegated",
            node_id: "bad-root",
          }],
          warnings: [],
          materialization_allowed: false,
          max_semantic_revisions: 4,
        })
        const submit = () => SessionProofWorkflow.recordDecompositionPlanAttempt({
          sessionID: session.id,
          file,
          source,
          plan,
          review: rejected,
        })

        submit()
        const firstExhaustion = submit()
        const recoveryStart = submit()
        const finalExhaustion = submit()

        expect(firstExhaustion.state.terminal_verdict?.recoverable).toBe(true)
        expect(recoveryStart.state.status).toBe("planning")
        expect(recoveryStart.state.planning_generation).toBe(1)
        expect(finalExhaustion.state.status).toBe("exhausted")
        expect(finalExhaustion.state.terminal_verdict?.recoverable).toBe(false)
        expect(finalExhaustion.recommended_action).toBe("stop_and_report_best_plan")

        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("recognizes both supported structured decomposition workflow modes", () => {
    const previousMode = process.env.OPENCODE_PROOF_WORKFLOW_MODE
    try {
      process.env.OPENCODE_PROOF_WORKFLOW_MODE = "decomposition"
      expect(SessionProofWorkflow.decompositionModeEnabled()).toBe(true)
      process.env.OPENCODE_PROOF_WORKFLOW_MODE = "prooftex_structured_workflow"
      expect(SessionProofWorkflow.decompositionModeEnabled()).toBe(true)
      process.env.OPENCODE_PROOF_WORKFLOW_MODE = "direct_prosa_probe"
      expect(SessionProofWorkflow.decompositionModeEnabled()).toBe(false)
    } finally {
      if (previousMode === undefined) delete process.env.OPENCODE_PROOF_WORKFLOW_MODE
      else process.env.OPENCODE_PROOF_WORKFLOW_MODE = previousMode
    }
  })

  test("allows line-zero auto-binding for a file with one theorem", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const source = [
          "From mathcomp Require Import all_ssreflect.",
          "",
          "Lemma demo : True.",
          "Proof.",
          "  admit.",
          "Admitted.",
          "",
        ].join("\n")
        const completed = source.replace("  admit.\nAdmitted.", "  exact I.\nQed.")
        await Bun.write(file, source)
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "auto")

        expect(() =>
          SessionProofWorkflow.assertBoundProofBodyMutationAllowed({
            sessionID: session.id,
            file,
            before: source,
            after: completed,
          }),
        ).not.toThrow()

        await Session.remove(session.id)
      },
    })
  })

  test("extracts the complete root goal when its conclusion has a top-level forall binder", () => {
    const source = [
      "Lemma quantified_goal : forall x : nat, x = x.",
      "Proof.",
      "move=> x.",
      "reflexivity.",
      "Qed.",
      "",
    ].join("\n")

    expect(
      SessionProofWorkflow.theoremTargetAtProofPosition(source, { line: 1, character: 0 })?.root_goal,
    ).toBe("forall x : nat, x = x")
  })

  test("shares the immutable proof snapshot across a parent-child lineage", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })
        const source = boundedTheorem()
        const bodyEdit = boundedTheorem("  exact I.\nQed.")
        await Bun.write(file, source)
        SessionProof.set(parent.id, file, { line: 3, character: 0 }, "manual")
        SessionProof.inherit(parent.id, child.id)
        SessionProofWorkflow.inheritBoundProofScope(parent.id, child.id)
        SessionProofWorkflow.assertBoundProofBodyMutationAllowed({
          sessionID: parent.id,
          file,
          before: source,
          after: bodyEdit,
        })

        expect(() =>
          SessionProofWorkflow.assertBoundProofBodyMutationAllowed({
            sessionID: child.id,
            file,
            before: bodyEdit,
            after: bodyEdit.replace("Lemma demo : True.", "Lemma demo : False."),
          }),
        ).toThrow("proof_scope_integrity_rejection")

        SessionProofWorkflow.clear(child.id)
        SessionProof.clear(child.id)
        await Session.remove(child.id)
        SessionProofWorkflow.clear(parent.id)
        SessionProof.clear(parent.id)
        await Session.remove(parent.id)
      },
    })
  })

  test("rejects protected bytes changed after binding but before the first edit", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const source = boundedTheorem()
        await Bun.write(file, source)
        SessionProof.set(session.id, file, { line: 3, character: 0 }, "manual")
        const externallyChanged = source.replace("Lemma demo : True.", "Lemma demo : False.")

        expect(() =>
          SessionProofWorkflow.assertBoundProofBodyMutationAllowed({
            sessionID: session.id,
            file,
            before: externallyChanged,
            after: externallyChanged.replace("  admit.\nAdmitted.", "  exact I.\nQed."),
          }),
        ).toThrow("current bound file does not match the immutable session snapshot")

        await Session.remove(session.id)
      },
    })
  })

  test("keeps legacy bindings without snapshots fail closed across rebinding and inheritance", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })
        const source = boundedTheorem()
        await Bun.write(file, source)
        SessionProof.set(parent.id, file, { line: 3, character: 0 }, "manual", {
          canonicalSource: null,
        })

        expect(SessionProof.get(parent.id)?.canonicalSource).toBeUndefined()
        SessionProof.set(parent.id, file, { line: 3, character: 0 }, "manual")
        expect(SessionProof.get(parent.id)?.canonicalSource).toBeUndefined()

        SessionProof.inherit(parent.id, child.id)
        expect(SessionProof.get(child.id)?.canonicalSource).toBeUndefined()
        expect(() =>
          SessionProofWorkflow.assertBoundProofBodyMutationAllowed({
            sessionID: child.id,
            file,
            before: source,
            after: boundedTheorem("  exact I.\nQed."),
          }),
        ).toThrow("bound proof has no canonical source snapshot")

        await Session.remove(child.id)
        await Session.remove(parent.id)
      },
    })
  })

  test("does not leak bound proof snapshots across independent sessions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const first = await Session.create({})
        const second = await Session.create({})
        const source = boundedTheorem()
        const independentlyChanged = source.replace("Lemma demo : True.", "Lemma demo : 1 = 1.")
        await Bun.write(file, source)
        SessionProof.set(first.id, file, { line: 3, character: 0 }, "manual")
        await Bun.write(file, independentlyChanged)
        SessionProof.set(second.id, file, { line: 3, character: 0 }, "manual")
        SessionProofWorkflow.assertBoundProofBodyMutationAllowed({
          sessionID: first.id,
          file,
          before: source,
          after: boundedTheorem("  exact I.\nQed."),
        })

        expect(() =>
          SessionProofWorkflow.assertBoundProofBodyMutationAllowed({
            sessionID: second.id,
            file,
            before: independentlyChanged,
            after: independentlyChanged.replace("  admit.\nAdmitted.", "  reflexivity.\nDefined."),
          }),
        ).not.toThrow()

        SessionProofWorkflow.clear(first.id)
        SessionProof.clear(first.id)
        await Session.remove(first.id)
        SessionProofWorkflow.clear(second.id)
        SessionProof.clear(second.id)
        await Session.remove(second.id)
      },
    })
  })

  test("schedules lemma-owned proof regions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hgap"),
            "have Hgap : True.",
            "{ (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hgap.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const next = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(next?.agent).toBe("lemma")
        expect(next?.description).toBe("Prove gap_1")
        expect(next?.lemma_assignment?.admit_id).toBe("gap_1")

        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue[0]?.owner).toBe("lemma")
        expect(state?.phase).toBe("delegating")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("schedules lemma-owned proof regions with bare end markers", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hgap"),
            "have Hgap : True.",
            "{ (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end *)",
            "exact Hgap.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const next = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(next?.agent).toBe("lemma")
        expect(next?.description).toBe("Prove gap_1")
        expect(next?.lemma_assignment?.admit_id).toBe("gap_1")
        expect(next?.lemma_assignment?.skeleton).toContain("(* proof_region end *)")

        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue[0]?.owner).toBe("lemma")
        expect(state?.phase).toBe("delegating")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("blocks lemma scheduling without proof DAG locality evidence", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            "(* proof_region begin owner: lemma admit_id: gap_1 theorem: demo kind: pointwise_semantic_bridge target: Hgap *)",
            "have Hgap : True.",
            "{ (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hgap.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const next = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(next?.agent).toBe("prover")
        expect(next?.description).toBe("Repair gap_1")
        expect(next?.proof_repair_assignment?.admit_id).toBe("gap_1")
        expect(next?.proof_repair_assignment?.escalation_type).toBe("needs_subgoal_remodel")
        expect(scaffoldSpy?.mock.calls.length).toBe(0)

        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue[0]?.status).toBe("escalated")
        expect(state?.queue[0]?.escalation_type).toBe("needs_subgoal_remodel")
        expect(state?.queue[0]?.escalation_reason).toContain(
          "not yet a dependency-complete, locally certifiable proof DAG node",
        )
        expect(state?.queue[0]?.escalation_reason).toContain(
          "Region size and internal tactic count are not rejection criteria",
        )
        expect(state?.active_repair?.admit_id).toBe("gap_1")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("releases the fallback guard when even an administrative edit creates a new theorem revision", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            "(* proof_region begin owner: lemma admit_id: gap_1 theorem: demo kind: pointwise_semantic_bridge target: Hgap *)",
            "have Hgap : True.",
            "{ (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hgap.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const repair = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(repair?.proof_repair_assignment?.admit_id).toBe("gap_1")

        const messages = [
          {
            info: { id: "msg_1", role: "assistant" },
            parts: Array.from({ length: 5 }, (_, index) => ({
              type: "tool",
              tool: index % 2 === 0 ? "read" : "grep",
              state: {
                status: "completed",
                input: index % 2 === 0 ? { filePath: file } : { pattern: "Hgap" },
                output: "lookup",
                title: "lookup",
                metadata: {},
                time: { start: index + 1, end: index + 2 },
              },
            })),
          },
        ] as any

        const baseline = await SessionProofWorkflow.assessFallbackGuard(sessionID, messages)
        expect(baseline?.tripped).toBe(false)
        expect(baseline?.guard.passive_lookup_streak).toBe(5)

        const commentOnly = (await Bun.file(file).text()).replace(
          "have Hgap : True.",
          "(* administrative note *)\nhave Hgap : True.",
        )
        await Bun.write(file, commentOnly)
        SessionProofWorkflow.recordSourceMutation(file, commentOnly)

        const released = await SessionProofWorkflow.assessFallbackGuard(sessionID, messages)
        expect(released).toBeUndefined()
        expect(SessionProofWorkflow.get(sessionID)?.active_repair).toBeUndefined()
        expect(SessionProofWorkflow.get(sessionID)?.fallback_guard).toBeUndefined()

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("recognizes accepted checkpoint progress for the bound file", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            "(* proof_region begin owner: lemma admit_id: gap_1 theorem: demo kind: pointwise_semantic_bridge target: Hgap *)",
            "have Hgap : True.",
            "{ (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hgap.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        expect((await SessionProofWorkflow.planNextSubtask(sessionID, []))?.description).toBe("Repair gap_1")
        await SessionProofWorkflow.assessFallbackGuard(sessionID, [])
        const progressTime =
          (SessionProofWorkflow.get(sessionID)?.active_repair?.accepted_progress_baseline_at ?? Date.now()) + 1

        const messages = [
          {
            info: { id: "msg_1", role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "checkpoint",
                state: {
                  status: "completed",
                  input: { file, reason: "milestone" },
                  output: "accepted",
                  title: "checkpoint",
                  metadata: {
                    proof_status: {
                      proof_progress: {
                        accepted: true,
                        receipt: { kind: "region_certified", admit_id: "gap_1" },
                        current: { unfinished_count: 1 },
                      },
                    },
                  },
                  time: { start: progressTime, end: progressTime },
                },
              },
              ...Array.from({ length: 5 }, (_, index) => ({
                type: "tool",
                tool: index % 2 === 0 ? "read" : "grep",
                state: {
                  status: "completed",
                  input: index % 2 === 0 ? { filePath: file } : { pattern: "Hgap" },
                  output: "lookup",
                  title: "lookup",
                  metadata: {},
                  time: { start: progressTime + index + 1, end: progressTime + index + 2 },
                },
              })),
            ],
          },
        ] as any

        const first = await SessionProofWorkflow.assessFallbackGuard(sessionID, messages)
        const repeated = await SessionProofWorkflow.assessFallbackGuard(sessionID, messages)
        expect(first?.guard.passive_lookup_streak).toBe(5)
        expect(first?.tripped).toBe(false)
        expect(repeated?.tripped).toBe(false)

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("trips fallback guard when theorem repair task finishes without changing the stale blocker", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            "(* proof_region begin owner: lemma admit_id: gap_1 theorem: demo kind: pointwise_semantic_bridge target: Hgap *)",
            "have Hgap : True.",
            "{ (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hgap.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const repair = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(repair?.proof_repair_assignment?.admit_id).toBe("gap_1")
        await SessionProofWorkflow.assessFallbackGuard(sessionID, [])

        const messages = [
          {
            info: { id: "msg_1", role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  input: {
                    subagent_type: "prover",
                    proof_repair_assignment: repair?.proof_repair_assignment,
                  },
                  output: "no file edit",
                  title: "Repair gap_1",
                  metadata: {
                    proof_scope: "theorem_repair",
                    proof_repair_assignment: repair?.proof_repair_assignment,
                  },
                  time: { start: 1, end: 2 },
                },
              },
            ],
          },
        ] as any

        const stalled = await SessionProofWorkflow.assessFallbackGuard(sessionID, messages)
        expect(stalled?.tripped).toBe(true)
        expect(stalled?.message).toContain("repair_outcome=structured_escalation")
        expect(await SessionProofWorkflow.planNextSubtask(sessionID, [])).toBeUndefined()
        expect(SessionProofWorkflow.get(sessionID)?.fallback_guard?.tripped_at).toBeNumber()

        const changed = (await Bun.file(file).text()).replace("Proof.\n", "Proof.\npose proof I as Hseed.\n")
        await Bun.write(file, changed)
        SessionProofWorkflow.recordSourceMutation(file, changed)

        const released = await SessionProofWorkflow.assessFallbackGuard(sessionID, messages)
        expect(released?.tripped).toBe(false)
        expect(released?.guard.source_fingerprint).not.toBe(stalled?.guard.source_fingerprint)
        expect(SessionProofWorkflow.get(sessionID)?.fallback_guard?.tripped_at).toBeUndefined()

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("allows five identical non-materializing repair children and locks the sixth dispatch", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            "(* proof_region begin owner: lemma admit_id: gap_1 theorem: demo kind: pointwise_semantic_bridge target: Hgap *)",
            "have Hgap : True.",
            "{ (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hgap.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        const repair = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(repair?.proof_repair_assignment?.admit_id).toBe("gap_1")
        await SessionProofWorkflow.assessFallbackGuard(sessionID, [])

        const messages: any[] = []
        for (let attempt = 1; attempt <= 5; attempt++) {
          messages.push({
            info: { id: `msg_parent_takeover_${attempt}`, role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  input: {
                    subagent_type: "prover",
                    proof_repair_assignment: repair?.proof_repair_assignment,
                  },
                  output: [
                    "repair_child_no_materialization: runtime is returning this scoped repair to the parent prover",
                    "reason: theorem-repair child reached the semantic liveness cutoff",
                    "repeated_compiler_signature=compiler-same; signature_streak=3",
                  ].join("\n"),
                  title: "Repair gap_1",
                  metadata: {
                    proof_scope: "theorem_repair",
                    proof_repair_assignment: repair?.proof_repair_assignment,
                  },
                  time: { start: attempt * 2 - 1, end: attempt * 2 },
                },
              },
            ],
          })

          const assessed = await SessionProofWorkflow.assessFallbackGuard(sessionID, messages)
          expect(assessed?.message).toContain(`identical_repair_failures=${attempt}/5`)
          expect(SessionProofWorkflow.get(sessionID)?.active_repair?.continuation_count).toBe(attempt)
          if (attempt < 5) {
            expect(assessed?.tripped).toBe(false)
            expect((assessed as any)?.repairRedispatchWarning).toBe(true)
            expect(SessionProofWorkflow.get(sessionID)?.fallback_guard?.tripped_at).toBeUndefined()
            const allowed = await SessionProofWorkflow.assertProofTaskDispatchAllowed({
              sessionID,
              subagentType: "prover",
              proofProducing: true,
              proofRepairAssignment: repair?.proof_repair_assignment,
            })
            expect(allowed.decision).toBe("allowed_matching_repair")
          } else {
            expect(assessed?.tripped).toBe(true)
            expect((assessed as any)?.parentRepairTakeoverRequired).toBe(true)
          }
        }

        expect(SessionProofWorkflow.get(sessionID)?.active_repair?.admit_id).toBe("gap_1")
        expect(SessionProofWorkflow.get(sessionID)?.fallback_guard?.tripped_at).toBeNumber()
        expect(SessionProofWorkflow.get(sessionID)?.fallback_guard?.dispatch_lock_scope).toBe("repair_child_yield")
        expect(await SessionProofWorkflow.planNextSubtask(sessionID, messages)).toBeUndefined()
        await expect(
          SessionProofWorkflow.assertProofTaskDispatchAllowed({
            sessionID,
            subagentType: "prover",
            proofProducing: true,
            proofRepairAssignment: repair?.proof_repair_assignment,
          }),
        ).rejects.toThrow("proof_task_dispatch_blocked")

        const locked = SessionProofWorkflow.get(sessionID)!
        locked.queue[0]!.status = "pending"
        SessionProofWorkflow.set(sessionID, locked)
        expect(await SessionProofWorkflow.planNextSubtask(sessionID, messages)).toBeUndefined()

        const remodeled = (await Bun.file(file).text()).replace("Proof.\n", "Proof.\npose proof I as Hseed.\n")
        await Bun.write(file, remodeled)
        const released = await SessionProofWorkflow.planNextSubtask(sessionID, messages)
        expect(released?.description).toBe("Repair gap_1")
        expect(SessionProofWorkflow.get(sessionID)?.fallback_guard).toBeUndefined()

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("carries identical repair-child incidents into a fresh root session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const source = [
          "Lemma demo : True.",
          "Proof.",
          "(* proof_region begin owner: lemma admit_id: gap_1 theorem: demo kind: pointwise_semantic_bridge target: Hgap *)",
          "have Hgap : True.",
          "{ (* admit_id: gap_1 *)",
          "  admit.",
          "}",
          "(* proof_region end admit_id: gap_1 *)",
          "exact Hgap.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)

        const first = await Session.create({})
        SessionProof.set(first.id, file, { line: 1, character: 0 }, "manual")
        const repair = await SessionProofWorkflow.planNextSubtask(first.id, [])
        expect(repair?.proof_repair_assignment?.admit_id).toBe("gap_1")
        await SessionProofWorkflow.assessFallbackGuard(first.id, [])

        const firstMessages = [{
          info: { id: "msg_first_repair", role: "assistant" },
          parts: [{
            type: "tool",
            tool: "task",
            state: {
              status: "completed",
              input: { subagent_type: "prover", proof_repair_assignment: repair?.proof_repair_assignment },
              output: [
                "repair_child_no_materialization: returning unchanged repair",
                "repeated_compiler_signature=compiler-same; signature_streak=3",
              ].join("\n"),
              title: "Repair gap_1",
              metadata: { proof_scope: "theorem_repair", proof_repair_assignment: repair?.proof_repair_assignment },
              time: { start: 1, end: 2 },
            },
          }],
        }] as any
        const firstAssessment = await SessionProofWorkflow.assessFallbackGuard(first.id, firstMessages)
        expect(firstAssessment?.message).toContain("identical_repair_failures=1/5")

        const second = await Session.create({})
        SessionProof.set(second.id, file, { line: 1, character: 0 }, "manual")
        const refreshed = SessionProofWorkflow.refresh(second.id, file, source).state
        expect(refreshed.repair_incidents?.[0]?.repeat_count).toBe(0)
        SessionProofWorkflow.set(second.id, {
          ...refreshed,
          active_repair: repair!.proof_repair_assignment,
          fallback_guard: undefined,
          updated: Date.now(),
        })

        const secondMessages = [{
          info: { id: "msg_second_repair", role: "assistant" },
          parts: [{
            type: "tool",
            tool: "task",
            state: {
              status: "completed",
              input: { subagent_type: "prover", proof_repair_assignment: repair?.proof_repair_assignment },
              output: [
                "repair_child_no_materialization: returning unchanged repair",
                "repeated_compiler_signature=compiler-same; signature_streak=3",
              ].join("\n"),
              title: "Repair gap_1",
              metadata: { proof_scope: "theorem_repair", proof_repair_assignment: repair?.proof_repair_assignment },
              time: { start: 3, end: 4 },
            },
          }],
        }] as any
        const secondAssessment = await SessionProofWorkflow.assessFallbackGuard(second.id, secondMessages)
        expect(secondAssessment?.message).toContain("identical_repair_failures=2/5")
        expect(SessionProofWorkflow.get(second.id)?.repair_incidents?.[0]?.repeat_count).toBe(1)

        for (const session of [first, second]) {
          SessionProofWorkflow.clear(session.id)
          SessionProof.clear(session.id)
          await Session.remove(session.id)
        }
      },
    })
  })

  test("active theorem repair suppresses recursive repair and lemma scheduling", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const parent = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            "(* proof_region begin owner: lemma admit_id: gap_1 theorem: demo kind: pointwise_semantic_bridge target: Hgap *)",
            "have Hgap : True.",
            "{ (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hgap.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const parentID = parent.id
        SessionProof.set(parentID, file, { line: 1, character: 0 }, "manual")

        const repair = await SessionProofWorkflow.planNextSubtask(parentID, [])
        expect(repair?.description).toBe("Repair gap_1")
        expect(repair?.proof_repair_assignment?.admit_id).toBe("gap_1")

        const duplicate = await SessionProofWorkflow.planNextSubtask(parentID, [])
        expect(duplicate).toBeUndefined()

        const child = await Session.create({ parentID })
        SessionProof.inherit(parentID, child.id)
        SessionProofWorkflow.bindActiveRepair(child.id, repair!.proof_repair_assignment!)

        const childScheduled = await SessionProofWorkflow.planNextSubtask(child.id, [])
        expect(childScheduled).toBeUndefined()

        const childState = SessionProofWorkflow.get(child.id)
        expect(childState?.active_repair?.admit_id).toBe("gap_1")
        expect(childState?.queue).toEqual([])

        const passiveRepairLookups = [
          {
            info: { id: "msg_repair", role: "assistant" },
            parts: Array.from({ length: 6 }, (_, index) => ({
              type: "tool",
              tool: index % 2 === 0 ? "read" : "grep",
              state: {
                status: "completed",
                input: index % 2 === 0 ? { filePath: file } : { pattern: "Hgap" },
                output: "lookup",
                title: "lookup",
                metadata: {},
                time: { start: index + 1, end: index + 2 },
              },
            })),
          },
        ] as any
        expect(await SessionProofWorkflow.assessFallbackGuard(child.id, passiveRepairLookups)).toBeUndefined()

        const repairActions = (count: number) =>
          [
            {
              info: { id: `msg_repair_${count}`, role: "assistant" },
              parts: Array.from({ length: count }, (_, index) => ({
                type: "tool",
                tool: index % 3 === 0 ? "coq_session" : index % 3 === 1 ? "read" : "grep",
                state: {
                  status: "completed",
                  input:
                    index % 3 === 0
                      ? { op: "step" }
                      : index % 3 === 1
                        ? { filePath: file }
                        : { pattern: "Hgap" },
                  output: "investigation",
                  title: "investigation",
                  metadata: {},
                  time: { start: index + 1, end: index + 2 },
                },
              })),
            },
          ] as any

        const warning = await SessionProofWorkflow.assessFallbackGuard(child.id, repairActions(12))
        expect(warning?.tripped).toBe(false)
        expect((warning as any)?.repairChildWarning).toBe(true)
        expect(warning?.guard.passive_lookup_streak).toBe(12)

        const stopped = await SessionProofWorkflow.assessFallbackGuard(child.id, repairActions(20))
        expect(stopped?.tripped).toBe(true)
        expect((stopped as any)?.repairChildNoMaterialization).toBe(true)
        expect(stopped?.message).toContain("without a new compiler-backed proof progress receipt")

        const acceptedEpoch = [
          {
            info: { id: "msg_repair_epoch", role: "assistant", time: { created: 1, completed: 200 } },
            parts: [
              ...repairActions(70)[0].parts,
              {
                type: "tool",
                tool: "checkpoint",
                state: {
                  status: "completed",
                  input: { file, reason: "milestone" },
                  output: "accepted progress",
                  title: "checkpoint",
                  metadata: {
                    proof_status: {
                      proof_progress: {
                        accepted: true,
                        receipt: { kind: "region_certified" },
                      },
                    },
                  },
                  time: { start: 199, end: 200 },
                },
              },
              ...repairActions(11)[0].parts.map((part: any, index: number) => ({
                ...part,
                state: {
                  ...part.state,
                  time: { start: 201 + index * 2, end: 202 + index * 2 },
                },
              })),
            ],
          },
        ] as any
        const freshEpoch = await SessionProofWorkflow.assessFallbackGuard(child.id, acceptedEpoch)
        expect(freshEpoch).toBeUndefined()

        const planResetMessages = [
          {
            info: { id: "msg_repair_plan_reset", role: "assistant" },
            parts: [
              ...repairActions(70)[0].parts,
              {
                type: "tool",
                tool: "proof_plan",
                state: {
                  status: "completed",
                  input: { action: "revise" },
                  output: "accepted repair revision",
                  title: "proof plan",
                  metadata: {},
                  time: { start: 80, end: 81 },
                },
              },
              ...repairActions(12)[0].parts,
            ],
          },
        ] as any
        const planDidNotReset = await SessionProofWorkflow.assessFallbackGuard(child.id, planResetMessages)
        expect(planDidNotReset?.tripped).toBe(true)
        expect((planDidNotReset as any)?.repairChildNoMaterialization).toBe(true)
        expect(planDidNotReset?.guard.passive_lookup_streak).toBe(83)

        const repairedSource = (await Bun.file(file).text()).replace("  admit.", "  exact I.")
        await Bun.write(file, repairedSource)
        const refreshedChild = SessionProofWorkflow.refresh(child.id, file, repairedSource).state
        expect(refreshedChild.active_repair).toBeUndefined()
        expect(refreshedChild.fallback_guard).toBeUndefined()
        expect(refreshedChild.queue[0]?.status).toBe("unvalidated")

        const childAfterRepairEdit = await SessionProofWorkflow.planNextSubtask(child.id, [])
        expect(childAfterRepairEdit).toBeUndefined()
        await expect(
          SessionProofWorkflow.assertProofTaskDispatchAllowed({
            sessionID: child.id,
            subagentType: "prover",
            proofProducing: true,
            proofRepairAssignment: repair!.proof_repair_assignment,
          }),
        ).rejects.toThrow("theorem repair worker")

        SessionProofWorkflow.clear(child.id)
        SessionProof.clear(child.id)
        await Session.remove(child.id)
        SessionProofWorkflow.clear(parentID)
        SessionProof.clear(parentID)
        await Session.remove(parentID)
      },
    })
  })

  test("unchanged theorem repair dispatch is locked across new root sessions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/cross-session-repair.v`
        const source = [
          "Lemma demo : True.",
          "Proof.",
          "(* proof_region begin owner: lemma admit_id: gap_1 theorem: demo kind: pointwise_semantic_bridge target: Hgap *)",
          "have Hgap : True.",
          "{ (* admit_id: gap_1 *)",
          "  admit.",
          "}",
          "(* proof_region end admit_id: gap_1 *)",
          "exact Hgap.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)

        const firstRoot = await Session.create({})
        const secondRoot = await Session.create({})
        SessionProof.set(firstRoot.id, file, { line: 1, character: 0 }, "manual")
        SessionProof.set(secondRoot.id, file, { line: 1, character: 0 }, "manual")

        const firstRepair = await SessionProofWorkflow.planNextSubtask(firstRoot.id, [])
        expect(firstRepair?.description).toBe("Repair gap_1")

        const duplicate = await SessionProofWorkflow.planNextSubtask(secondRoot.id, [])
        expect(duplicate).toBeUndefined()
        const locked = SessionProofWorkflow.get(secondRoot.id)
        expect(locked?.active_repair?.admit_id).toBe("gap_1")
        expect(locked?.fallback_guard?.dispatch_lock_scope).toBe("cross_session")
        expect(locked?.fallback_guard?.reason).toContain("do not launch another identical repair child")
        const takeover = await SessionProofWorkflow.assessFallbackGuard(secondRoot.id, [])
        expect(takeover?.tripped).toBe(true)
        expect((takeover as any)?.parentRepairTakeoverRequired).toBe(true)
        expect(takeover?.message).toContain("substantive theorem proof/contract change")

        const commentOnly = source.replace("have Hgap : True.", "(* administrative note *)\nhave Hgap : True.")
        await Bun.write(file, commentOnly)
        const commentRevisionRepair = await SessionProofWorkflow.planNextSubtask(secondRoot.id, [])
        expect(commentRevisionRepair?.description).toBe("Repair gap_1")
        expect(SessionProofWorkflow.get(secondRoot.id)?.fallback_guard?.dispatch_lock_scope).toBeUndefined()

        const substantive = commentOnly.replace("have Hgap : True.", "have Hgap : True /\\ True.")
        await Bun.write(file, substantive)
        const changedRepair = await SessionProofWorkflow.planNextSubtask(secondRoot.id, [])
        expect(changedRepair?.description).toBe("Repair gap_1")
        expect(SessionProofWorkflow.get(secondRoot.id)?.fallback_guard?.dispatch_lock_scope).toBeUndefined()

        SessionProofWorkflow.clear(firstRoot.id)
        SessionProofWorkflow.clear(secondRoot.id)
        SessionProof.clear(firstRoot.id)
        SessionProof.clear(secondRoot.id)
        await Session.remove(firstRoot.id)
        await Session.remove(secondRoot.id)
      },
    })
  })

  test("proof task workers allow scoped lemma/fixer helpers but block nested wide provers", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hgap"),
            "have Hgap : True.",
            "{ (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hgap.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        SessionProof.set(parent.id, file, { line: 1, character: 0 }, "manual")
        const suggestion = await SessionProofWorkflow.suggestNextSubtask(parent.id, [])
        const scheduled = suggestion?.task
        expect(scheduled?.agent).toBe("lemma")
        expect(scheduled?.lemma_assignment).toBeDefined()
        SessionProof.inherit(parent.id, child.id)
        SessionProofWorkflow.bindProofTaskWorker(child.id, "coq-prover")

        const explorer = await SessionProofWorkflow.assertProofTaskDispatchAllowed({
          sessionID: child.id,
          subagentType: "explorer",
          proofProducing: false,
        })
        expect(explorer.decision).toBe("allowed_non_proof_task")

        const fixer = await SessionProofWorkflow.assertProofTaskDispatchAllowed({
          sessionID: child.id,
          subagentType: "fixer",
          proofProducing: true,
        })
        expect(fixer.decision).toBe("allowed_without_active_repair")

        const lemma = await SessionProofWorkflow.assertProofTaskDispatchAllowed({
          sessionID: child.id,
          subagentType: "lemma",
          proofProducing: true,
          lemmaAssignment: scheduled!.lemma_assignment,
        })
        expect(lemma.decision).toBe("allowed_without_active_repair")

        for (const subagentType of ["coq-prover", "coqprover", "whole-lemma", "prover", "lemma"]) {
          await expect(
            SessionProofWorkflow.assertProofTaskDispatchAllowed({
              sessionID: child.id,
              subagentType,
              proofProducing: true,
            }),
          ).rejects.toThrow("cannot launch unscoped nested proof task")
        }

        SessionProofWorkflow.clear(child.id)
        SessionProof.clear(child.id)
        await Session.remove(child.id)
        SessionProofWorkflow.clear(parent.id)
        SessionProof.clear(parent.id)
        await Session.remove(parent.id)
      },
    })
  })

  test("extracts the preceding local have goal for lemma assignments", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "H_left_boundary_capacity", "size carry_in_tasks <= num_cpus - 1"),
            "have H_left_boundary_capacity :",
            "  size carry_in_tasks <= num_cpus - 1.",
            "(* paper sentence explaining this local fact. *)",
            "{",
            "  admit. (* admit_id: gap_1 *)",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact H_left_boundary_capacity.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const next = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(next?.lemma_assignment?.goal).toBe("size carry_in_tasks <= num_cpus - 1")
        expect(next?.lemma_assignment?.skeleton).toContain("have H_left_boundary_capacity")
        expect(next?.lemma_assignment?.skeleton).toContain(regionBegin("gap_1", "H_left_boundary_capacity", "size carry_in_tasks <= num_cpus - 1"))
        expect(next?.lemma_assignment?.replace).toContain("wrap the exported local target statement")
        expect(next?.lemma_assignment?.replace).toContain("keep its name and proposition unchanged whenever possible")
        expect(next?.lemma_assignment?.proof_position).toEqual({ line: 6, character: 1 })
        expect(next?.lemma_assignment?.goal_fingerprint).toBeString()

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("suggests the next lemma task without marking it running", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hgap"),
            "have Hgap : True.",
            "{ (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hgap.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const suggestion = await SessionProofWorkflow.suggestNextSubtask(sessionID, [])
        expect(suggestion?.task.agent).toBe("lemma")
        expect(suggestion?.task.description).toBe("Prove gap_1")
        expect(suggestion?.task.lemma_assignment?.admit_id).toBe("gap_1")
        expect(suggestion?.pending.map((item) => item.admit_id)).toEqual(["gap_1"])

        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue[0]?.status).toBe("pending")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("suggests resuming a split lemma task", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hgap"),
            "have Hgap : True.",
            "{ (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hgap.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const messages = [
          {
            info: { id: "msg_1", role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  metadata: {
                    sessionId: "ses_child",
                    lemma_assignment: {
                      admit_id: "gap_1",
                    },
                    proof_result_summary: {
                      status: "split",
                    },
                    model: {
                      providerID: "openai",
                      modelID: "gpt-5.4",
                    },
                  },
                },
              },
            ],
          },
        ] as any

        const suggestion = await SessionProofWorkflow.suggestNextSubtask(sessionID, messages)
        expect(suggestion?.task.description).toBe("Resume gap_1")
        expect(suggestion?.task.task_id).toBe("ses_child")
        expect(suggestion?.task.lemma_assignment?.admit_id).toBe("gap_1")
        expect(suggestion?.task.model).toEqual({ providerID: "openai", modelID: "gpt-5.4" })

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("uses file order only as a tie-breaker among dependency-ready proof regions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const source = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hone"),
          "have Hone : True.",
          "{ (* admit_id: gap_1 *)",
          "  admit.",
          "}",
          "(* proof_region end admit_id: gap_1 *)",
          regionBegin("gap_2", "Htwo"),
          "have Htwo : True.",
          "{ (* admit_id: gap_2 *)",
          "  admit.",
          "}",
          "(* proof_region end admit_id: gap_2 *)",
          "exact Hone.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        const messages = [
          {
            info: { id: "msg_1", role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  metadata: {
                    sessionId: "ses_later",
                    lemma_assignment: {
                      admit_id: "gap_2",
                    },
                    proof_result_summary: {
                      status: "split",
                    },
                  },
                },
              },
            ],
          },
        ] as any

        const suggestion = await SessionProofWorkflow.suggestNextSubtask(sessionID, messages)
        expect(suggestion?.task.description).toBe("Prove gap_1")
        expect(suggestion?.task.lemma_assignment?.admit_id).toBe("gap_1")
        expect(suggestion?.pending.map((item) => item.admit_id)).toEqual(["gap_1", "gap_2"])

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("schedules an independent later region when an earlier region is not dependency-ready", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const source = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hone").replace("depends_on: theorem_context", "depends_on: node_Htwo"),
          "have Hone : True.",
          "{ (* admit_id: gap_1 *) admit. }",
          "(* proof_region end admit_id: gap_1 *)",
          regionBegin("gap_2", "Htwo"),
          "have Htwo : True.",
          "{ (* admit_id: gap_2 *) admit. }",
          "(* proof_region end admit_id: gap_2 *)",
          "exact Htwo.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const suggestion = await SessionProofWorkflow.suggestNextSubtask(sessionID, [])
        expect(suggestion?.task.description).toBe("Prove gap_2")
        expect(suggestion?.task.lemma_assignment?.admit_id).toBe("gap_2")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("resumes a split first region instead of scheduling a later region", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const source = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hone"),
          "have Hone : True.",
          "{ (* admit_id: gap_1 *)",
          "  admit.",
          "}",
          "(* proof_region end admit_id: gap_1 *)",
          regionBegin("gap_2", "Htwo"),
          "have Htwo : True.",
          "{ (* admit_id: gap_2 *)",
          "  admit.",
          "}",
          "(* proof_region end admit_id: gap_2 *)",
          "exact Hone.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const first = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(first?.lemma_assignment?.admit_id).toBe("gap_1")

        const messages = [
          {
            info: { id: "msg_1", role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  metadata: {
                    sessionId: "ses_gap_1",
                    lemma_assignment: first?.lemma_assignment,
                    proof_result_summary: {
                      status: "split",
                    },
                  },
                },
              },
            ],
          },
        ] as any

        const resumed = await SessionProofWorkflow.planNextSubtask(sessionID, messages)
        expect(resumed?.description).toBe("Resume gap_1")
        expect(resumed?.task_id).toBe("ses_gap_1")
        expect(resumed?.lemma_assignment?.admit_id).toBe("gap_1")

        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue.map((item) => [item.admit_id, item.status])).toEqual([
          ["gap_1", "running"],
          ["gap_2", "pending"],
        ])

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("does not suggest a duplicate task while the first region is running", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hone"),
            "have Hone : True.",
            "{ (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            regionBegin("gap_2", "Htwo"),
            "have Htwo : True.",
            "{ (* admit_id: gap_2 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_2 *)",
            "exact Hone.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const first = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(first?.lemma_assignment?.admit_id).toBe("gap_1")

        const suggestion = await SessionProofWorkflow.suggestNextSubtask(sessionID, [])
        expect(suggestion).toBeUndefined()

        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue.map((item) => [item.admit_id, item.status])).toEqual([
          ["gap_1", "running"],
          ["gap_2", "pending"],
        ])

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("schedules a later region only after the previous region is solved", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const pendingSource = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hone"),
          "have Hone : True.",
          "{ (* admit_id: gap_1 *)",
          "  admit.",
          "}",
          "(* proof_region end admit_id: gap_1 *)",
          regionBegin("gap_2", "Htwo"),
          "have Htwo : True.",
          "{ (* admit_id: gap_2 *)",
          "  admit.",
          "}",
          "(* proof_region end admit_id: gap_2 *)",
          "exact Hone.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, pendingSource)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const first = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(first?.lemma_assignment?.admit_id).toBe("gap_1")

        const solvedSource = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hone"),
          "have Hone : True.",
          "{",
          "  exact I.",
          "}",
          "(* proof_region end admit_id: gap_1 *)",
          regionBegin("gap_2", "Htwo"),
          "have Htwo : True.",
          "{ (* admit_id: gap_2 *)",
          "  admit.",
          "}",
          "(* proof_region end admit_id: gap_2 *)",
          "exact Hone.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, solvedSource)

        const messages = [
          {
            info: { id: "msg_1", role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  metadata: {
                    sessionId: "ses_gap_1",
                    lemma_assignment: first?.lemma_assignment,
                    proof_result_summary: {
                      status: "solved",
                    },
                    proof_result: {
                      proof_text: proofRegionText(solvedSource, "gap_1"),
                    },
                  },
                },
              },
            ],
          },
        ] as any

        const second = await SessionProofWorkflow.planNextSubtask(sessionID, messages)
        expect(second?.description).toBe("Prove gap_2")
        expect(second?.lemma_assignment?.admit_id).toBe("gap_2")

        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue.map((item) => [item.admit_id, item.status])).toEqual([
          ["gap_1", "solved"],
          ["gap_2", "running"],
        ])

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("certifies a solved region when the compiler reaches a later theorem-level error", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        scaffoldSpy?.mockRestore()
        scaffoldSpy = spyOn(SessionProofWorkflow.Validation, "scaffold").mockImplementation(async () => ({
          ok: false,
          validator: "checkpoint-coqc",
          status: "error",
          first_error_line: 7,
          failure_kind: "compiler_error",
          message: "Error: No applicable tactic in the theorem-level connector.",
        }))

        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const pendingSource = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hone"),
          "have Hone : True.",
          "{ admit. }",
          "(* proof_region end admit_id: gap_1 *)",
          "first [exact Hone | fail].",
          "Admitted.",
          "",
        ].join("\n")
        const solvedSource = pendingSource.replace("{ admit. }", "{ exact I. }")
        await Bun.write(file, pendingSource)

        SessionProof.set(session.id, file, { line: 1, character: 0 }, "manual")
        const first = await SessionProofWorkflow.planNextSubtask(session.id, [])
        await Bun.write(file, solvedSource)
        const messages = [
          {
            info: { id: "msg_later_scaffold_error", role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  metadata: {
                    sessionId: "ses_gap_1",
                    lemma_assignment: first?.lemma_assignment,
                    proof_result_summary: { status: "solved" },
                    proof_result: { proof_text: proofRegionText(solvedSource, "gap_1") },
                  },
                },
              },
            ],
          },
        ] as any

        await SessionProofWorkflow.planNextSubtask(session.id, messages)
        const state = SessionProofWorkflow.get(session.id)
        expect(state?.queue[0]?.status).toBe("solved")
        expect(state?.queue[0]?.validation_certificate?.compiler_signature).toBeTruthy()
        expect(state?.queue[0]?.escalation_type).toBeUndefined()

        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("does not certify a solved result when the compiler error remains inside the region", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        scaffoldSpy?.mockRestore()
        scaffoldSpy = spyOn(SessionProofWorkflow.Validation, "scaffold").mockImplementation(async () => ({
          ok: false,
          validator: "checkpoint-coqc",
          status: "error",
          first_error_line: 5,
          failure_kind: "compiler_error",
          message: "Error: The proof term has the wrong type.",
        }))

        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const pendingSource = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hone"),
          "have Hone : True.",
          "{ admit. }",
          "(* proof_region end admit_id: gap_1 *)",
          "exact Hone.",
          "Admitted.",
          "",
        ].join("\n")
        const invalidSource = pendingSource.replace("{ admit. }", "{ exact I. }")
        await Bun.write(file, pendingSource)

        SessionProof.set(session.id, file, { line: 1, character: 0 }, "manual")
        const first = await SessionProofWorkflow.planNextSubtask(session.id, [])
        await Bun.write(file, invalidSource)
        const messages = [
          {
            info: { id: "msg_region_error", role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  metadata: {
                    sessionId: "ses_gap_1",
                    lemma_assignment: first?.lemma_assignment,
                    proof_result_summary: { status: "solved" },
                    proof_result: { proof_text: proofRegionText(invalidSource, "gap_1") },
                  },
                },
              },
            ],
          },
        ] as any

        const repair = await SessionProofWorkflow.planNextSubtask(session.id, messages)
        expect(repair?.proof_repair_assignment?.escalation_type).toBe("needs_subgoal_remodel")
        expect(SessionProofWorkflow.get(session.id)?.queue[0]?.validation_certificate).toBeUndefined()

        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("certifies a solved lemma from the parent staged revision while disk is still stale", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const pendingSource = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hone"),
          "have Hone : True.",
          "{ (* admit_id: gap_1 *)",
          "  admit.",
          "}",
          "(* proof_region end admit_id: gap_1 *)",
          "exact Hone.",
          "Admitted.",
          "",
        ].join("\n")
        const solvedSource = pendingSource.replace("{ (* admit_id: gap_1 *)\n  admit.\n}", "{\n  exact I.\n}")
        await Bun.write(file, pendingSource)

        SessionProof.set(session.id, file, { line: 1, character: 0 }, "manual")
        const first = await SessionProofWorkflow.planNextSubtask(session.id, [])
        expect(first?.lemma_assignment?.admit_id).toBe("gap_1")

        await ProofEditTransaction.begin({
          sessionID: session.id,
          parentSessionID: session.id,
          agent: "prover",
          file,
          source: pendingSource,
          scope: { kind: "theorem_body", theorem: "demo" },
        })
        ProofEditTransaction.stage({
          sessionID: session.id,
          file,
          before: pendingSource,
          after: solvedSource,
        })

        const messages = [
          {
            info: { id: "msg_staged", role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  metadata: {
                    sessionId: "ses_gap_1",
                    lemma_assignment: first?.lemma_assignment,
                    proof_result_summary: { status: "solved" },
                    proof_result: { proof_text: proofRegionText(solvedSource, "gap_1") },
                  },
                },
              },
            ],
          },
        ] as any

        const next = await SessionProofWorkflow.planNextSubtask(session.id, messages, solvedSource)
        expect(next).toBeUndefined()
        expect(SessionProofWorkflow.get(session.id)?.queue[0]?.status).toBe("solved")
        expect(await Bun.file(file).text()).toBe(pendingSource)
        expect(ProofEditTransaction.source(session.id, file)).toBe(solvedSource)

        ProofEditTransaction.abort(session.id)
        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("does not treat admit removal as solved before compiler validation", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const source = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hone"),
          "have Hone : True.",
          "{ exact I. }",
          "(* proof_region end admit_id: gap_1 *)",
          regionBegin("gap_2", "Htwo"),
          "have Htwo : True.",
          "{ admit. }",
          "(* proof_region end admit_id: gap_2 *)",
          "exact Hone.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        const { state } = SessionProofWorkflow.refresh(sessionID, file, source)

        expect(state.queue.map((item) => [item.admit_id, item.status])).toEqual([
          ["gap_1", "unvalidated"],
          ["gap_2", "pending"],
        ])
        expect(state.phase).toBe("delegating")
        expect(state.queue[0]?.validation_certificate).toBeUndefined()

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("advances only after the exact source receives a compiler certificate", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const source = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hone"),
          "have Hone : True.",
          "{ exact I. }",
          "(* proof_region end admit_id: gap_1 *)",
          regionBegin("gap_2", "Htwo"),
          "have Htwo : True.",
          "{ admit. }",
          "(* proof_region end admit_id: gap_2 *)",
          "exact Hone.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        SessionProofWorkflow.refresh(sessionID, file, source)

        const lifecycle = await SessionProofWorkflow.recordCompilerResult({
          sessionID,
          file,
          source,
          validator: "coqc",
          ok: true,
        })
        expect(lifecycle.action).toBe("certified")
        expect(SessionProofWorkflow.get(sessionID)?.queue[0]?.status).toBe("solved")
        expect(SessionProofWorkflow.get(sessionID)?.queue[0]?.validation_certificate).toBeDefined()

        const next = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(next?.lemma_assignment?.admit_id).toBe("gap_2")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("does not count an existing proof-region certificate again in a later child session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const parent = await Session.create({})
        const child = await Session.create({})
        const source = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hone"),
          "have Hone : True.",
          "{ exact I. }",
          "(* proof_region end admit_id: gap_1 *)",
          regionBegin("gap_2", "Htwo"),
          "have Htwo : True.",
          "{ admit. }",
          "(* proof_region end admit_id: gap_2 *)",
          "exact Hone.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)

        SessionProof.set(parent.id, file, { line: 1, character: 0 }, "manual")
        SessionProofWorkflow.refresh(parent.id, file, source)
        const first = await SessionProofWorkflow.recordCompilerResult({
          sessionID: parent.id,
          file,
          source,
          validator: "coqc",
          ok: true,
        })
        expect(first).toMatchObject({ action: "certified", admit_id: "gap_1" })

        SessionProof.set(child.id, file, { line: 1, character: 0 }, "manual")
        SessionProofWorkflow.refresh(child.id, file, source)
        expect(SessionProofWorkflow.get(child.id)?.queue[0]?.status).toBe("solved")
        expect(SessionProofWorkflow.get(child.id)?.queue[0]?.validation_certificate).toEqual(
          SessionProofWorkflow.get(parent.id)?.queue[0]?.validation_certificate,
        )

        const repeated = await SessionProofWorkflow.recordCompilerResult({
          sessionID: child.id,
          file,
          source,
          validator: "coqc",
          ok: true,
        })
        expect(repeated.action).toBe("unchanged")
        expect(repeated.admit_id).toBeUndefined()
        expect(repeated.next_action).toContain("exact-prefix proof-region certificates")
        expect(SessionProofWorkflow.get(child.id)?.queue[0]?.status).toBe("solved")

        const status = SessionProofWorkflow.classifyCoqcSuccess(child.id, file, source, repeated)
        expect(status.proof_progress.status).toBe("baseline")
        expect(status.proof_progress.accepted).toBe(false)
        expect(status.proof_progress.receipt).toBeUndefined()

        SessionProofWorkflow.clear(parent.id)
        SessionProofWorkflow.clear(child.id)
        SessionProof.clear(parent.id)
        SessionProof.clear(child.id)
        await Session.remove(parent.id)
        await Session.remove(child.id)
      },
    })
  })

  test("invalidates a certificate when the certified proof prefix changes", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const source = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hone"),
          "have Hone : True.",
          "{ exact I. }",
          "(* proof_region end admit_id: gap_1 *)",
          regionBegin("gap_2", "Htwo"),
          "have Htwo : True.",
          "{ admit. }",
          "(* proof_region end admit_id: gap_2 *)",
          "exact Hone.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        SessionProofWorkflow.refresh(sessionID, file, source)
        await SessionProofWorkflow.recordCompilerResult({
          sessionID,
          file,
          source,
          validator: "coqc",
          ok: true,
        })
        expect(SessionProofWorkflow.get(sessionID)?.queue[0]?.status).toBe("solved")

        const changed = source.replace("{ exact I. }", "{ exact (I : True). }")
        await Bun.write(file, changed)
        SessionProofWorkflow.recordSourceMutation(file, changed)

        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue[0]?.status).toBe("unvalidated")
        expect(state?.queue[0]?.validation_certificate).toBeUndefined()
        expect(state?.queue[1]?.status).toBe("pending")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("compiler failure reopens the affected certified region but preserves its prefix", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const source = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hone"),
          "have Hone : True.",
          "{ exact I. }",
          "(* proof_region end admit_id: gap_1 *)",
          regionBegin("gap_2", "Htwo"),
          "have Htwo : True.",
          "{ exact I. }",
          "(* proof_region end admit_id: gap_2 *)",
          "exact Hone.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        SessionProofWorkflow.refresh(sessionID, file, source)
        await SessionProofWorkflow.recordCompilerResult({
          sessionID,
          file,
          source,
          validator: "coqc",
          ok: true,
        })
        expect(SessionProofWorkflow.get(sessionID)?.queue.map((item) => item.status)).toEqual(["solved", "solved"])

        const failure = await SessionProofWorkflow.recordCompilerResult({
          sessionID,
          file,
          source,
          validator: "coqc",
          ok: false,
          first_error_file: file,
          first_error_line: 9,
          first_error_message: "Error: second proof region no longer typechecks.",
        })

        expect(failure.action).toBe("invalidated")
        expect(failure.admit_id).toBe("gap_2")
        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue[0]?.status).toBe("solved")
        expect(state?.queue[0]?.validation_certificate).toBeDefined()
        expect(state?.queue[1]?.status).toBe("unvalidated")
        expect(state?.queue[1]?.validation_certificate).toBeUndefined()
        expect(state?.queue[1]?.validation_failure?.message).toContain("no longer typechecks")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("certifies a hole-free region when Coq reaches a later incomplete Qed", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const source = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hone"),
          "have Hone : True.",
          "{ exact I. }",
          "(* proof_region end admit_id: gap_1 *)",
          regionBegin("gap_2", "Htwo"),
          "have Htwo : True.",
          "{ admit. }",
          "(* proof_region end admit_id: gap_2 *)",
          "exact Hone.",
          "Qed.",
          "",
        ].join("\n")
        await Bun.write(file, source)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        SessionProofWorkflow.refresh(sessionID, file, source)
        expect(SessionProofWorkflow.get(sessionID)?.queue.map((item) => item.status)).toEqual([
          "unvalidated",
          "pending",
        ])

        const qedLine = source.split("\n").findIndex((line) => line === "Qed.") + 1
        const lifecycle = await SessionProofWorkflow.recordCompilerResult({
          sessionID,
          file,
          source,
          validator: "coqc",
          ok: false,
          first_error_file: file,
          first_error_line: qedLine,
          first_error_message: "Attempt to save an incomplete proof because of admitted goals.",
        })

        expect(lifecycle.action).toBe("certified")
        expect(lifecycle.admit_id).toBe("gap_1")
        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue[0]?.status).toBe("solved")
        expect(state?.queue[0]?.validation_certificate).toBeDefined()
        expect(state?.queue[1]?.status).toBe("pending")

        const proofStatus = SessionProofWorkflow.classifyCoqcFailure(sessionID, file, source, {
          first_error_line: qedLine,
          first_error_message: "Attempt to save an incomplete proof because of admitted goals.",
          lifecycle,
        })
        expect(proofStatus.proof_progress.status).toBe("advanced")
        expect(proofStatus.proof_progress.accepted).toBe(true)
        expect(proofStatus.proof_progress.level).toBe("hard")
        expect(proofStatus.proof_progress.workspace_committable).toBe(false)

        const next = await SessionProofWorkflow.planNextSubtask(sessionID, [], source)
        expect(next?.agent).toBe("lemma")
        expect(next?.lemma_assignment?.admit_id).toBe("gap_2")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("does not certify a source that changed while compilation was in flight", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const compiledSource = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hone"),
          "have Hone : True.",
          "{ exact I. }",
          "(* proof_region end admit_id: gap_1 *)",
          "exact Hone.",
          "Admitted.",
          "",
        ].join("\n")
        const changedSource = compiledSource.replace("exact I.", "exact (I : True).")
        await Bun.write(file, compiledSource)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        SessionProofWorkflow.refresh(sessionID, file, compiledSource)
        await Bun.write(file, changedSource)

        const lifecycle = await SessionProofWorkflow.recordCompilerResult({
          sessionID,
          file,
          source: compiledSource,
          validator: "coqc",
          ok: true,
        })
        expect(lifecycle.action).toBe("source_changed")
        expect(SessionProofWorkflow.get(sessionID)?.queue[0]?.status).toBe("unvalidated")
        expect(SessionProofWorkflow.get(sessionID)?.queue[0]?.validation_certificate).toBeUndefined()

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("keeps a compiler-invalid replacement unresolved and blocks later regions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        scaffoldSpy?.mockRestore()
        scaffoldSpy = spyOn(SessionProofWorkflow.Validation, "scaffold").mockImplementation(async () => ({
          ok: false,
          validator: "checkpoint-coqc",
          status: "error",
          first_error_line: 5,
          failure_kind: "compiler_error",
          message: "Error: the replacement proof does not typecheck.",
        }))

        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const source = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hone"),
          "have Hone : True.",
          "{ exact missing_term. }",
          "(* proof_region end admit_id: gap_1 *)",
          regionBegin("gap_2", "Htwo"),
          "have Htwo : True.",
          "{ admit. }",
          "(* proof_region end admit_id: gap_2 *)",
          "exact Hone.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        SessionProofWorkflow.refresh(sessionID, file, source)

        const repair = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(repair?.description).toBe("Repair gap_1")
        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue[0]?.status).toBe("escalated")
        expect(state?.queue[0]?.validation_certificate).toBeUndefined()
        expect(state?.queue[1]?.status).toBe("pending")
        expect(state?.active_repair?.admit_id).toBe("gap_1")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("compiler-valid same-id theorem repair clears the repair transaction", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let valid = false
        scaffoldSpy?.mockRestore()
        scaffoldSpy = spyOn(SessionProofWorkflow.Validation, "scaffold").mockImplementation(async () =>
          valid
            ? {
                ok: true,
                validator: "checkpoint-coqc",
                status: "ok",
              }
            : {
                ok: false,
                validator: "checkpoint-coqc",
                status: "error",
                first_error_line: 5,
                failure_kind: "compiler_error",
                message: "Error: replacement still contains the blocker.",
              },
        )

        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const pending = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hone"),
          "have Hone : True.",
          "{ admit. }",
          "(* proof_region end admit_id: gap_1 *)",
          "exact Hone.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, pending)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        expect((await SessionProofWorkflow.planNextSubtask(sessionID, []))?.description).toBe("Repair gap_1")
        expect(SessionProofWorkflow.get(sessionID)?.active_repair?.admit_id).toBe("gap_1")

        valid = true
        const repaired = pending.replace("{ admit. }", "{ exact I. }")
        await Bun.write(file, repaired)

        expect(await SessionProofWorkflow.planNextSubtask(sessionID, [])).toBeUndefined()
        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue[0]?.status).toBe("solved")
        expect(state?.queue[0]?.validation_certificate).toBeDefined()
        expect(state?.active_repair).toBeUndefined()
        expect(state?.fallback_guard).toBeUndefined()

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("treats empty proof blocks as pending lemma holes", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const source = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hempty"),
          "have Hempty : True.",
          "{",
          "}",
          "(* proof_region end admit_id: gap_1 *)",
          "exact Hempty.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const next = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(next?.agent).toBe("lemma")
        expect(next?.lemma_assignment?.admit_id).toBe("gap_1")

        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue[0]?.status).toBe("running")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("preserves running ownership while the delegated lemma edits its region", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const source = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hgap"),
          "have Hgap : True.",
          "{ admit. }",
          "(* proof_region end admit_id: gap_1 *)",
          "exact Hgap.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        const first = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(first?.description).toBe("Prove gap_1")

        const running = SessionProofWorkflow.get(sessionID)!
        SessionProofWorkflow.set(sessionID, {
          ...running,
          queue: running.queue.map((item) =>
            item.admit_id === "gap_1" ? { ...item, task_id: "ses_gap_1" } : item,
          ),
          active_task_id: "ses_gap_1",
        })

        const changed = source.replace("{ admit. }", "{ pose proof I as Hlocal. admit. }")
        await Bun.write(file, changed)
        SessionProofWorkflow.recordSourceMutation(file, changed)

        const afterEdit = SessionProofWorkflow.get(sessionID)
        expect(afterEdit?.queue[0]?.status).toBe("running")
        expect(afterEdit?.queue[0]?.task_id).toBe("ses_gap_1")
        expect(afterEdit?.active_admit_id).toBe("gap_1")
        expect(afterEdit?.active_task_id).toBe("ses_gap_1")

        const messages = [
          {
            info: { id: "msg_1", role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  metadata: {
                    sessionId: "ses_gap_1",
                    lemma_assignment: first?.lemma_assignment,
                    proof_result_summary: {
                      status: "escalate",
                      escalation_type: "needs_subgoal_remodel",
                      escalate_reason: "The local target needs a theorem-level bridge.",
                    },
                  },
                },
              },
            ],
          },
        ] as any

        const repair = await SessionProofWorkflow.planNextSubtask(sessionID, messages)
        expect(repair?.description).toBe("Repair gap_1")
        expect(repair?.proof_repair_assignment?.admit_id).toBe("gap_1")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("escalates a detached running region after its lease expires", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const region = [
          regionBegin("gap_1", "Hgap"),
          "have Hgap : True.",
          "{ admit. }",
          "(* proof_region end admit_id: gap_1 *)",
        ].join("\n")
        const source = ["Lemma demo : True.", "Proof.", region, "exact Hgap.", "Admitted.", ""].join("\n")
        await Bun.write(file, source)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        await SessionProofWorkflow.planNextSubtask(sessionID, [])
        const running = SessionProofWorkflow.get(sessionID)!
        running.queue[0]!.running_lease_expires_at = Date.now() - 1
        SessionProofWorkflow.set(sessionID, running)

        const changed = source.replace(region, "")
        await Bun.write(file, changed)
        SessionProofWorkflow.recordSourceMutation(file, changed)

        const detached = SessionProofWorkflow.get(sessionID)
        expect(detached?.queue[0]?.status).toBe("running")
        expect(detached?.active_admit_id).toBe("gap_1")

        const repair = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(repair?.description).toBe("Repair gap_1")
        expect(repair?.proof_repair_assignment?.escalation_type).toBe("not_local")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("blocks lemma edits after the first unresolved local proof hole", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const source = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hfirst"),
          "have Hfirst : True.",
          "{",
          "}",
          "have Hsecond : True.",
          "{",
          "}",
          "(* proof_region end admit_id: gap_1 *)",
          "exact Hfirst.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        const first = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        if (!first?.lemma_assignment) throw new Error("missing lemma assignment")

        const lemmaSessionID = "ses_lemma_prefix_guard"
        SessionProofWorkflow.bindActiveLemmaAssignment(lemmaSessionID, first.lemma_assignment)

        const firstSolved = source.replace("have Hfirst : True.\n{\n}", "have Hfirst : True.\n{\n  exact I.\n}")
        expect(() => SessionProofWorkflow.assertLemmaSequentialEditAllowed({
          sessionID: lemmaSessionID,
          agent: "lemma",
          file,
          before: source,
          after: firstSolved,
        })).not.toThrow()

        const firstSolvedWithoutBraces = source.replace("have Hfirst : True.\n{\n}", "have Hfirst : True by exact I.")
        expect(() => SessionProofWorkflow.assertLemmaSequentialEditAllowed({
          sessionID: lemmaSessionID,
          agent: "lemma",
          file,
          before: source,
          after: firstSolvedWithoutBraces,
        })).toThrow("must preserve the partition braces")

        const firstSolvedWithoutTarget = source.replace(
          "have Hfirst : True.\n{\n}",
          "{\n  exact I.\n}",
        )
        expect(() => SessionProofWorkflow.assertLemmaSequentialEditAllowed({
          sessionID: lemmaSessionID,
          agent: "lemma",
          file,
          before: source,
          after: firstSolvedWithoutTarget,
        })).toThrow("must preserve exported target Hfirst")

        const firstSolvedWithChangedTarget = source.replace(
          "have Hfirst : True.\n{\n}",
          "have Hfirst : False.\n{\n  exact I.\n}",
        )
        expect(() => SessionProofWorkflow.assertLemmaSequentialEditAllowed({
          sessionID: lemmaSessionID,
          agent: "lemma",
          file,
          before: source,
          after: firstSolvedWithChangedTarget,
        })).toThrow("must preserve the proposition of exported target Hfirst")

        const firstAdmitted = source.replace("have Hfirst : True.\n{\n}", "have Hfirst : True.\n{\n  admit.\n}")
        const admittedPrefixSpy = spyOn(SessionProofWorkflow.Validation, "prefix").mockImplementation(async () => ({
          ok: true,
          validator: "checkpoint-coqc",
          status: "ok",
        }))
        const admittedPrefix = await SessionProofWorkflow.recordLemmaPrefixValidation({
          sessionID: lemmaSessionID,
          agent: "lemma",
          file,
          source: firstAdmitted,
        })
        expect(admittedPrefix?.ok).toBe(true)
        expect(admittedPrefix?.prefix_complete).toBe(false)
        admittedPrefixSpy.mockRestore()

        const secondSolved = source.replace("have Hsecond : True.\n{\n}", "have Hsecond : True.\n{\n  exact I.\n}")
        expect(() => SessionProofWorkflow.assertLemmaSequentialEditAllowed({
          sessionID: lemmaSessionID,
          agent: "lemma",
          file,
          before: source,
          after: secondSolved,
        })).toThrow("cannot edit text after the first unresolved local proof hole")

        const bothSolved = firstSolved.replace("have Hsecond : True.\n{\n}", "have Hsecond : True.\n{\n  exact I.\n}")
        expect(() => SessionProofWorkflow.assertLemmaSequentialEditAllowed({
          sessionID: lemmaSessionID,
          agent: "lemma",
          file,
          before: firstSolved,
          after: bothSolved,
        })).toThrow("cannot edit text after the first unresolved local proof hole")

        const prefixSpy = spyOn(SessionProofWorkflow.Validation, "prefix").mockImplementation(async (_file, maskedSource) => {
          expect(maskedSource).toContain("have Hsecond : True.\n{\n  admit.\n}")
          return { ok: true, validator: "checkpoint-coqc", status: "ok" }
        })
        const prefix = await SessionProofWorkflow.recordLemmaPrefixValidation({
          sessionID: lemmaSessionID,
          agent: "lemma",
          file,
          source: firstSolved,
        })
        expect(prefix?.ok).toBe(true)
        prefixSpy.mockRestore()

        expect(() => SessionProofWorkflow.assertLemmaSequentialEditAllowed({
          sessionID: lemmaSessionID,
          agent: "lemma",
          file,
          before: firstSolved,
          after: bothSolved,
        })).not.toThrow()

        const outsideEdit = source.replace("exact Hfirst.", "exact Hsecond.")
        expect(() => SessionProofWorkflow.assertLemmaSequentialEditAllowed({
          sessionID: lemmaSessionID,
          agent: "lemma",
          file,
          before: source,
          after: outsideEdit,
        })).toThrow("may edit only its assigned proof_region")

        SessionProofWorkflow.clear(sessionID)
        SessionProofWorkflow.clear(lemmaSessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("treats an inline admit_id marker as part of the current sequential hole", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const source = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hfirst"),
          "have Hfirst : True.",
          "{",
          "  admit. (* admit_id: gap_1 *)",
          "}",
          "have Hsecond : True.",
          "{",
          "  admit.",
          "}",
          "(* proof_region end admit_id: gap_1 *)",
          "exact Hfirst.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        const first = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        if (!first?.lemma_assignment) throw new Error("missing lemma assignment")

        const lemmaSessionID = "ses_inline_admit_marker_guard"
        SessionProofWorkflow.bindActiveLemmaAssignment(lemmaSessionID, first.lemma_assignment)

        const firstSolved = source.replace("  admit. (* admit_id: gap_1 *)", "  exact I.")
        expect(() =>
          SessionProofWorkflow.assertLemmaSequentialEditAllowed({
            sessionID: lemmaSessionID,
            agent: "lemma",
            file,
            before: source,
            after: firstSolved,
          }),
        ).not.toThrow()

        const laterSiblingEdited = source.replace(
          "have Hsecond : True.\n{\n  admit.\n}",
          "have Hsecond : True.\n{\n  exact I.\n}",
        )
        expect(() =>
          SessionProofWorkflow.assertLemmaSequentialEditAllowed({
            sessionID: lemmaSessionID,
            agent: "lemma",
            file,
            before: source,
            after: laterSiblingEdited,
          }),
        ).toThrow("cannot edit text after the first unresolved local proof hole")

        SessionProofWorkflow.clear(sessionID)
        SessionProofWorkflow.clear(lemmaSessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("does not replace the validated lemma prefix baseline when resuming", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const source = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hfirst"),
          "have Hfirst : True.",
          "{",
          "}",
          "have Hsecond : True.",
          "{",
          "}",
          "(* proof_region end admit_id: gap_1 *)",
          "exact Hfirst.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        const first = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        if (!first?.lemma_assignment) throw new Error("missing lemma assignment")

        const lemmaSessionID = "ses_resume_prefix_guard"
        SessionProofWorkflow.bindActiveLemmaAssignment(lemmaSessionID, first.lemma_assignment, source, "fresh")

        const firstSolved = source.replace("have Hfirst : True.\n{\n}", "have Hfirst : True.\n{\n  exact I.\n}")
        SessionProofWorkflow.bindActiveLemmaAssignment(
          lemmaSessionID,
          first.lemma_assignment,
          firstSolved,
          "resume",
        )

        const bothSolved = firstSolved.replace(
          "have Hsecond : True.\n{\n}",
          "have Hsecond : True.\n{\n  exact I.\n}",
        )
        expect(() =>
          SessionProofWorkflow.assertLemmaSequentialEditAllowed({
            sessionID: lemmaSessionID,
            agent: "lemma",
            file,
            before: firstSolved,
            after: bothSolved,
          }),
        ).toThrow("cannot edit text after the first unresolved local proof hole")

        const prefixSpy = spyOn(SessionProofWorkflow.Validation, "prefix").mockImplementation(async () => ({
          ok: true,
          validator: "checkpoint-coqc",
          status: "ok",
        }))
        const validation = await SessionProofWorkflow.recordLemmaPrefixValidation({
          sessionID: lemmaSessionID,
          agent: "lemma",
          file,
          source: firstSolved,
        })
        expect(validation?.ok).toBe(true)

        SessionProofWorkflow.bindActiveLemmaAssignment(
          lemmaSessionID,
          first.lemma_assignment,
          firstSolved,
          "resume",
        )
        expect(() =>
          SessionProofWorkflow.assertLemmaSequentialEditAllowed({
            sessionID: lemmaSessionID,
            agent: "lemma",
            file,
            before: firstSolved,
            after: bothSolved,
          }),
        ).not.toThrow()

        const missingBaselineSessionID = "ses_missing_resume_prefix_guard"
        SessionProofWorkflow.bindActiveLemmaAssignment(
          missingBaselineSessionID,
          first.lemma_assignment,
          firstSolved,
          "resume",
        )
        expect(() =>
          SessionProofWorkflow.assertLemmaSequentialEditAllowed({
            sessionID: missingBaselineSessionID,
            agent: "lemma",
            file,
            before: firstSolved,
            after: bothSolved,
          }),
        ).toThrow("has no trusted validated prefix baseline")

        const recovered = await SessionProofWorkflow.recordLemmaPrefixValidation({
          sessionID: missingBaselineSessionID,
          agent: "lemma",
          file,
          source: firstSolved,
        })
        expect(recovered?.ok).toBe(true)
        expect(recovered?.message).toContain("restored the missing resume validation baseline")
        prefixSpy.mockRestore()

        SessionProofWorkflow.clear(sessionID)
        SessionProofWorkflow.clear(lemmaSessionID)
        SessionProofWorkflow.clear(missingBaselineSessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("does not schedule later regions after an earlier escalation", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hone"),
            "have Hone : True.",
            "{ (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            regionBegin("gap_2", "Htwo"),
            "have Htwo : True.",
            "{ (* admit_id: gap_2 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_2 *)",
            "exact Hone.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const first = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(first?.lemma_assignment?.admit_id).toBe("gap_1")

        const messages = [
          {
            info: { id: "msg_1", role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  metadata: {
                    sessionId: "ses_gap_1",
                    lemma_assignment: first?.lemma_assignment,
                    proof_result_summary: {
                      status: "escalate",
                      escalation_type: "needs_subgoal_remodel",
                      escalate_reason: "The exported target is too weak.",
                    },
                  },
                },
              },
            ],
          },
        ] as any

        const next = await SessionProofWorkflow.planNextSubtask(sessionID, messages)
        expect(next?.agent).toBe("prover")
        expect(next?.description).toBe("Repair gap_1")
        expect(next?.proof_repair_assignment?.admit_id).toBe("gap_1")
        expect(next?.proof_repair_assignment?.escalation_type).toBe("needs_subgoal_remodel")

        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.phase).toBe("prover")
        expect(state?.queue.map((item) => [item.admit_id, item.status])).toEqual([
          ["gap_1", "escalated"],
          ["gap_2", "pending"],
        ])

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("schedules editable proof regions with obligation metadata", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hxxx"),
            "have Hxxx :",
            "  True.",
            "{",
            "  (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hxxx.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const next = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(next?.agent).toBe("lemma")
        expect(next?.lemma_assignment?.admit_id).toBe("gap_1")
        expect(next?.lemma_assignment?.goal).toBe("True")
        expect(next?.lemma_assignment?.obligation?.kind).toBe("pointwise_semantic_bridge")
        expect(next?.lemma_assignment?.obligation?.target_name).toBe("Hxxx")
        expect(next?.lemma_assignment?.editable_region?.mode).toBe("region")
        expect(next?.lemma_assignment?.editable_region?.can_add_sibling_helpers).toBe(true)

        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue[0]?.editable_mode).toBe("region")
        expect(state?.queue[0]?.target_name).toBe("Hxxx")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("infers the exported local fact when target contains a proposition", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            '(* proof_region begin owner: lemma admit_id: gap_1 theorem: demo kind: pointwise_semantic_bridge plan_node: node_Hbridge depends_on: theorem_context source: paper_step_001 input: theorem_context output: Hbridge layer: coq_shape expected: local_fact normal_form: "forall x : nat, True" evidence: mathcomp:I',
            "   target: forall x : nat, True *)",
            "have Hbridge : forall x : nat, True.",
            "{ intro x. admit. }",
            "(* proof_region end admit_id: gap_1 *)",
            "exact I.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const next = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(next?.agent).toBe("lemma")
        expect(next?.lemma_assignment?.admit_id).toBe("gap_1")
        expect(next?.lemma_assignment?.obligation?.target_name).toBe("Hbridge")
        expect(next?.lemma_assignment?.goal).toBe("forall x : nat, True")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("does not dispatch proof regions with mismatched or nested same admit_id markers", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hxxx"),
            regionBegin("gap_1", "Hyyy"),
            "have Hyyy : True.",
            "{ (* admit_id: gap_1 *) admit. }",
            "(* proof_region end admit_id: gap_1 *)",
            "have Hxxx : True.",
            "{ (* admit_id: gap_1 *) admit. }",
            "exact Hxxx.",
            "(* proof_region end admit_id: gap_2 *)",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const next = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(next).toBeUndefined()
        expect(SessionProofWorkflow.get(sessionID)?.queue).toEqual([])

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("scopes the lemma queue to the theorem at the bound proof position", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/two-theorems.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma first (A : Prop) : A.",
            "Proof.",
            "(* proof_region begin owner: lemma admit_id: first-gap theorem: first kind: semantic_bridge target: HA plan_node: first-leaf depends_on: none source: context input: A output: HA layer: semantic expected: local normal_form: \"A\" evidence: mathcomp:I *)",
            "have HA : A. { admit. }",
            "(* proof_region end admit_id: first-gap *)",
            "Admitted.",
            "Lemma second (B : Prop) : B.",
            "Proof.",
            "(* proof_region begin owner: lemma admit_id: second-gap theorem: second kind: semantic_bridge target: HB plan_node: second-leaf depends_on: none source: context input: B output: HB layer: semantic expected: local normal_form: \"B\" evidence: mathcomp:I *)",
            "have HB : B. { admit. }",
            "(* proof_region end admit_id: second-gap *)",
            "Admitted.",
            "",
          ].join("\n"),
        )

        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        const firstState = SessionProofWorkflow.refresh(session.id, file, await Bun.file(file).text()).state
        SessionProofWorkflow.set(session.id, {
          ...firstState,
          queue: firstState.queue.map((item) => ({ ...item, status: "running" as const, task_id: "first-task" })),
          active_admit_id: "first-gap",
          active_task_id: "first-task",
          updated: Date.now(),
        })
        SessionProof.set(session.id, file, { line: 6, character: 0 }, "manual")
        const next = await SessionProofWorkflow.suggestNextSubtask(session.id, [])
        expect(next?.task.lemma_assignment?.admit_id).toBe("second-gap")
        expect(next?.task.lemma_assignment?.theorem).toBe("second")
        expect(SessionProofWorkflow.get(session.id)?.queue.map((item) => item.admit_id)).toEqual(["second-gap"])
        expect(SessionProofWorkflow.classifyCoqcSuccess(session.id, file, await Bun.file(file).text()).theorem).toBe(
          "second",
        )

        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("reports compiler lifecycle progress for the caller's bound theorem", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/compiler-scope.v`
        const source = [
          "Lemma first : True.",
          "Proof.",
          "(* proof_region begin owner: lemma admit_id: first-gap theorem: first kind: semantic_bridge target: Hfirst plan_node: first-leaf depends_on: none source: context input: True output: Hfirst layer: semantic expected: local normal_form: \"True\" evidence: mathcomp:I *)",
          "have Hfirst : True. { exact I. }",
          "(* proof_region end admit_id: first-gap *)",
          "exact Hfirst.",
          "Qed.",
          "Lemma second : True.",
          "Proof.",
          "(* proof_region begin owner: lemma admit_id: second-gap theorem: second kind: semantic_bridge target: Hsecond plan_node: second-leaf depends_on: none source: context input: True output: Hsecond layer: semantic expected: local normal_form: \"True\" evidence: mathcomp:I *)",
          "have Hsecond : True. { exact I. }",
          "(* proof_region end admit_id: second-gap *)",
          "exact Hsecond.",
          "Qed.",
          "",
        ].join("\n")
        await Bun.write(file, source)
        const firstSession = await Session.create({})
        const secondSession = await Session.create({})
        SessionProof.set(firstSession.id, file, { line: 0, character: 0 }, "manual")
        SessionProof.set(secondSession.id, file, { line: 7, character: 0 }, "manual")
        SessionProofWorkflow.refresh(firstSession.id, file, source)
        SessionProofWorkflow.refresh(secondSession.id, file, source)

        const lifecycle = await SessionProofWorkflow.recordCompilerResult({
          sessionID: secondSession.id,
          file,
          source,
          validator: "coqc",
          ok: true,
        })
        expect(lifecycle.action).toBe("certified")
        expect(lifecycle.admit_id).toBe("second-gap")
        expect(lifecycle.affected_sessions).toBe(2)
        expect(SessionProofWorkflow.get(firstSession.id)?.queue[0]?.status).toBe("solved")
        expect(SessionProofWorkflow.get(secondSession.id)?.queue[0]?.status).toBe("solved")

        SessionProofWorkflow.clear(firstSession.id)
        SessionProofWorkflow.clear(secondSession.id)
        SessionProof.clear(firstSession.id)
        SessionProof.clear(secondSession.id)
        await Session.remove(firstSession.id)
        await Session.remove(secondSession.id)
      },
    })
  })

  test("rejects overlapping regions, duplicate admit ids, and marker theorem spoofing", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cases = [
          {
            name: "overlap",
            source: [
              "Lemma demo (A B : Prop) : A /\\ B.",
              "Proof.",
              "(* proof_region begin owner: lemma admit_id: outer theorem: demo kind: semantic_bridge target: HA plan_node: leaf-a depends_on: none source: context input: A output: HA layer: semantic expected: local normal_form: \"A\" evidence: mathcomp:I *)",
              "(* proof_region begin owner: lemma admit_id: inner theorem: demo kind: semantic_bridge target: HB plan_node: leaf-b depends_on: none source: context input: B output: HB layer: semantic expected: local normal_form: \"B\" evidence: mathcomp:I *)",
              "have HB : B. { admit. }",
              "(* proof_region end admit_id: inner *)",
              "have HA : A. { admit. }",
              "(* proof_region end admit_id: outer *)",
              "Admitted.",
              "",
            ].join("\n"),
          },
          {
            name: "duplicate",
            source: [
              "Lemma demo (A B : Prop) : A /\\ B.",
              "Proof.",
              regionBegin("same-gap", "HA", "A"),
              "have HA : A. { admit. }",
              "(* proof_region end admit_id: same-gap *)",
              regionBegin("same-gap", "HB", "B"),
              "have HB : B. { admit. }",
              "(* proof_region end admit_id: same-gap *)",
              "Admitted.",
              "",
            ].join("\n"),
          },
          {
            name: "spoofed-theorem",
            source: [
              "Lemma demo : True.",
              "Proof.",
              "(* proof_region begin owner: lemma admit_id: spoof theorem: other kind: semantic_bridge target: H plan_node: leaf depends_on: none source: context input: True output: H layer: semantic expected: local normal_form: \"True\" evidence: mathcomp:I *)",
              "have H : True. { admit. }",
              "(* proof_region end admit_id: spoof *)",
              "Admitted.",
              "",
            ].join("\n"),
          },
        ]

        for (const entry of cases) {
          const file = `${tmp.path}/${entry.name}.v`
          const session = await Session.create({})
          await Bun.write(file, entry.source)
          SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
          expect(await SessionProofWorkflow.suggestNextSubtask(session.id, [])).toBeUndefined()
          expect(SessionProofWorkflow.get(session.id)?.queue).toEqual([])
          SessionProofWorkflow.clear(session.id)
          SessionProof.clear(session.id)
          await Session.remove(session.id)
        }
      },
    })
  })

  test("blocks scheduling when proof_region markers do not include the exported target statement", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            "have Hxxx : True.",
            "{",
            "  " + regionBegin("gap_1", "Hxxx"),
            "  admit. (* admit_id: gap_1 *)",
            "  (* proof_region end admit_id: gap_1 *)",
            "}",
            "exact Hxxx.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const next = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(next?.agent).toBe("prover")
        expect(next?.description).toBe("Repair gap_1")
        expect(next?.proof_repair_assignment?.admit_id).toBe("gap_1")
        expect(next?.proof_repair_assignment?.reason).toContain("must wrap exported target statement Hxxx")

        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue[0]?.status).toBe("escalated")
        expect(state?.queue[0]?.escalation_type).toBe("needs_subgoal_remodel")
        expect(state?.queue[0]?.escalation_reason).toContain("must wrap exported target statement Hxxx")
        expect(state?.phase).toBe("prover")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("records structural remodel escalations and stops redispatching the stale admit", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hxxx"),
            "have Hxxx :",
            "  True.",
            "{",
            "  (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hxxx.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const first = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(first?.lemma_assignment?.admit_id).toBe("gap_1")
        expect(SessionProofWorkflow.get(sessionID)?.active_admit_id).toBe("gap_1")
        expect(SessionProofWorkflow.get(sessionID)?.active_admit_id).toBe("gap_1")

        const remodelRequest = {
          current_target: "have Hxxx : True",
          why_current_target_is_wrong: "The target needs a preceding bridge before it can be proved locally.",
          proposed_preceding_helper: "have Hyyy : True",
          proposed_region_shape: "Introduce Hyyy before Hxxx inside the same proof_region.",
          should_lift_to_theorem_level: false,
        }
        const messages = [
          {
            info: { id: "msg_1", role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  metadata: {
                    sessionId: "ses_child",
                    lemma_assignment: first?.lemma_assignment,
                    proof_result_summary: {
                      status: "escalate",
                      escalation_type: "needs_subgoal_remodel",
                      escalate_reason: "The delegated target needs to be remodeled.",
                      remodel_request: remodelRequest,
                    },
                  },
                },
              },
            ],
          },
        ] as any

        const next = await SessionProofWorkflow.planNextSubtask(sessionID, messages)
        expect(next?.agent).toBe("prover")
        expect(next?.description).toBe("Repair gap_1")
        expect(next?.proof_repair_assignment?.admit_id).toBe("gap_1")
        expect(next?.proof_repair_assignment?.remodel_request).toEqual(remodelRequest)

        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue[0]?.status).toBe("escalated")
        expect(state?.queue[0]?.escalation_type).toBe("needs_subgoal_remodel")
        expect(state?.latest_escalation?.remodel_request).toEqual(remodelRequest)

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("blocks dispatch when checkpoint scaffold gate fails", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        scaffoldSpy?.mockRestore()
        scaffoldSpy = spyOn(SessionProofWorkflow.Validation, "scaffold").mockImplementation(async () => ({
          ok: false,
          validator: "checkpoint-coqc",
          status: "error",
          first_error_line: 1,
          failure_kind: "compiler_error",
          message: "Syntax error outside the delegated region.",
        }))

        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hxxx"),
            "have Hxxx :",
            "  True.",
            "{",
            "  (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hxxx.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const next = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(next?.agent).toBe("prover")
        expect(next?.description).toBe("Repair gap_1")
        expect(next?.proof_repair_assignment?.escalation_type).toBe("blocked_by_sibling_syntax")

        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue[0]?.status).toBe("escalated")
        expect(state?.queue[0]?.escalation_type).toBe("blocked_by_sibling_syntax")
        expect(state?.queue[0]?.escalation_reason).toContain("checkpoint-coqc scaffold gate failed")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("does not misclassify an error inside the delegated region as sibling syntax", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        scaffoldSpy?.mockRestore()
        scaffoldSpy = spyOn(SessionProofWorkflow.Validation, "scaffold").mockImplementation(async () => ({
          ok: false,
          validator: "checkpoint-coqc",
          status: "error",
          first_error_line: 5,
          failure_kind: "compiler_error",
          message: "Error: The delegated target is malformed.",
        }))

        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hxxx"),
            "have Hxxx :",
            "  True.",
            "{",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hxxx.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const next = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(next?.proof_repair_assignment?.escalation_type).toBe("needs_subgoal_remodel")
        expect(SessionProofWorkflow.get(sessionID)?.queue[0]?.escalation_type).toBe("needs_subgoal_remodel")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("stops repeated checkpoint repair after the proof region is renamed", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        scaffoldSpy?.mockRestore()
        scaffoldSpy = spyOn(SessionProofWorkflow.Validation, "scaffold").mockImplementation(async () => ({
          ok: false,
          validator: "checkpoint-coqc",
          status: "error",
          first_error_line: 1,
          failure_kind: "compiler_error",
          message: "Error: Syntax error outside the delegated region.",
        }))

        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const source = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hxxx"),
          "have Hxxx : True.",
          "{ admit. }",
          "(* proof_region end admit_id: gap_1 *)",
          "exact Hxxx.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const first = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(first?.description).toBe("Repair gap_1")
        expect(SessionProofWorkflow.get(sessionID)?.repair_incidents?.[0]?.repeat_count).toBe(0)

        await Bun.write(file, source.replaceAll("gap_1", "gap_renamed"))
        const repeated = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(repeated).toBeUndefined()

        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.active_repair?.admit_id).toBe("gap_renamed")
        expect(state?.repair_incidents).toHaveLength(1)
        expect(state?.repair_incidents?.[0]?.repeat_count).toBe(1)
        expect(state?.fallback_guard?.tripped_at).toBeNumber()
        expect(state?.fallback_guard?.reason).toContain("admit_id, marker, comment, and whitespace changes")

        const guard = await SessionProofWorkflow.assessFallbackGuard(sessionID, [])
        expect(guard?.tripped).toBe(true)
        expect(guard?.message).toContain("same checkpoint failure recurred")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("keeps materially different checkpoint repairs eligible beyond six attempts", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let failure = 0
        scaffoldSpy?.mockRestore()
        scaffoldSpy = spyOn(SessionProofWorkflow.Validation, "scaffold").mockImplementation(async () => ({
          ok: false,
          validator: "checkpoint-coqc",
          status: "error",
          first_error_line: 1,
          failure_kind: "compiler_error",
          message: `Error: Distinct scaffold failure ${++failure}.`,
        }))

        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const sourceFor = (index: number) => [
          "Lemma demo : True.",
          "Proof.",
          regionBegin(`gap_${index}`, `Hxxx${index}`),
          `have Hxxx${index} : True.`,
          "{ admit. }",
          `(* proof_region end admit_id: gap_${index} *)`,
          `exact Hxxx${index}.`,
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, sourceFor(0))

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        for (let index = 0; index < 8; index++) {
          await Bun.write(file, sourceFor(index))
          const repair = await SessionProofWorkflow.planNextSubtask(sessionID, [])
          expect(repair?.description).toBe(`Repair gap_${index}`)
        }

        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.active_repair?.admit_id).toBe("gap_7")
        expect(state?.repair_incidents).toHaveLength(8)
        expect(state?.fallback_guard?.tripped_at).toBeUndefined()

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("rejects solved lemma results that modify text outside proof_region", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hxxx"),
            "have Hxxx :",
            "  True.",
            "{",
            "  (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hxxx.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const first = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(first?.lemma_assignment?.admit_id).toBe("gap_1")

        const nonlocalSource = [
            "Lemma demo : True.",
            "Proof.",
            "pose proof I as Houtside.",
            regionBegin("gap_1", "Hxxx"),
            "have Hxxx :",
            "  True.",
            "{",
            "  exact I.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hxxx.",
            "Admitted.",
            "",
          ].join("\n")
        await Bun.write(file, nonlocalSource)

        const messages = [
          {
            info: { id: "msg_1", role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  metadata: {
                    sessionId: "ses_child",
                    lemma_assignment: first?.lemma_assignment,
                    proof_result_summary: {
                      status: "solved",
                    },
                    proof_result: {
                      proof_text: proofRegionText(nonlocalSource, "gap_1"),
                    },
                  },
                },
              },
            ],
          },
        ] as any

        const next = await SessionProofWorkflow.planNextSubtask(sessionID, messages)
        expect(next?.agent).toBe("prover")
        expect(next?.description).toBe("Repair gap_1")
        expect(next?.proof_repair_assignment?.escalation_type).toBe("not_local")

        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue[0]?.status).toBe("escalated")
        expect(state?.queue[0]?.escalation_type).toBe("not_local")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("rejects solved proof regions when the exported target disappears", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hxxx"),
            "have Hxxx :",
            "  True.",
            "{",
            "  (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact I.",
            "Qed.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const first = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(first?.lemma_assignment?.obligation?.target_name).toBe("Hxxx")

        const retargetedSource = [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hxxx"),
            "have Hyyy : True.",
            "{ exact I. }",
            "(* proof_region end admit_id: gap_1 *)",
            "exact I.",
            "Qed.",
            "",
          ].join("\n")
        await Bun.write(file, retargetedSource)

        const messages = [
          {
            info: { id: "msg_1", role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  metadata: {
                    sessionId: "ses_child",
                    lemma_assignment: first?.lemma_assignment,
                    proof_result_summary: {
                      status: "solved",
                    },
                    proof_result: {
                      proof_text: proofRegionText(retargetedSource, "gap_1"),
                    },
                  },
                },
              },
            ],
          },
        ] as any

        const next = await SessionProofWorkflow.planNextSubtask(sessionID, messages)
        expect(next?.agent).toBe("prover")
        expect(next?.description).toBe("Repair gap_1")
        expect(next?.proof_repair_assignment?.escalation_type).toBe("needs_subgoal_remodel")

        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue[0]?.status).toBe("escalated")
        expect(state?.queue[0]?.escalation_type).toBe("needs_subgoal_remodel")
        expect(state?.queue[0]?.escalation_reason).toContain("removed exported target Hxxx")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("accepts solved proof regions only when final theorem gate passes", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hxxx"),
            "have Hxxx :",
            "  True.",
            "{",
            "  (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hxxx.",
            "Qed.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const first = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(SessionProofWorkflow.get(sessionID)?.active_admit_id).toBe("gap_1")
        const finalSource = [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hxxx"),
            "have Hxxx :",
            "  True.",
            "{",
            "  exact I.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hxxx.",
            "Qed.",
            "",
          ].join("\n")
        await Bun.write(file, finalSource)

        const messages = [
          {
            info: { id: "msg_1", role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  metadata: {
                    sessionId: "ses_child",
                    lemma_assignment: first?.lemma_assignment,
                    proof_result_summary: {
                      status: "solved",
                    },
                    proof_result: {
                      proof_text: proofRegionText(finalSource, "gap_1"),
                    },
                  },
                },
              },
            ],
          },
        ] as any

        const next = await SessionProofWorkflow.planNextSubtask(sessionID, messages)
        expect(next).toBeUndefined()

        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue[0]?.status).toBe("solved")
        expect(state?.phase).toBe("complete")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("returns to prover finalization when final theorem still uses Admitted", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hxxx"),
            "have Hxxx :",
            "  True.",
            "{",
            "  (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hxxx.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const first = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(SessionProofWorkflow.get(sessionID)?.active_admit_id).toBe("gap_1")
        const admittedSource = [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hxxx"),
            "have Hxxx :",
            "  True.",
            "{",
            "  exact I.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hxxx.",
            "Admitted.",
            "",
          ].join("\n")
        await Bun.write(file, admittedSource)

        const messages = [
          {
            info: { id: "msg_1", role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  metadata: {
                    sessionId: "ses_child",
                    lemma_assignment: first?.lemma_assignment,
                    proof_result_summary: {
                      status: "solved",
                    },
                    proof_result: {
                      proof_text: proofRegionText(admittedSource, "gap_1"),
                    },
                  },
                },
              },
            ],
          },
        ] as any

        const next = await SessionProofWorkflow.planNextSubtask(sessionID, messages)
        expect(next).toBeUndefined()

        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue[0]?.status).toBe("solved")
        expect(state?.queue[0]?.escalation_type).toBeUndefined()
        expect(state?.phase).toBe("prover")

        const source = await Bun.file(file).text()
        const report = SessionProofWorkflow.analyzeSource(file, source, state)
        expect(report.final_theorem_gate.ok).toBe(false)
        expect(report.final_theorem_gate.reason).toContain("requires theorem demo to end with Qed")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("releases expired running regions whose task completed without structured outcome", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hxxx"),
            "have Hxxx : True.",
            "{ (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hxxx.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        const first = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(first?.lemma_assignment?.admit_id).toBe("gap_1")

        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue[0]?.status).toBe("running")
        state!.queue[0]!.running_lease_expires_at = Date.now() - 1

        const messages = [
          {
            info: { id: "msg_1", role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  metadata: {
                    sessionId: "ses_child",
                    lemma_assignment: first?.lemma_assignment,
                  },
                },
              },
            ],
          },
        ] as any

        const next = await SessionProofWorkflow.planNextSubtask(sessionID, messages)
        expect(next?.description).toBe("Prove gap_1")
        expect(next?.lemma_assignment?.admit_id).toBe("gap_1")

        const updated = SessionProofWorkflow.get(sessionID)
        expect(updated?.queue[0]?.status).toBe("running")
        expect(updated?.queue[0]?.running_release_reason).toContain("completed without a structured proof_result")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("resumes expired running regions with a resumable task_id", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hxxx"),
            "have Hxxx : True.",
            "{ (* admit_id: gap_1 *)",
            "  admit.",
            "}",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hxxx.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        await SessionProofWorkflow.planNextSubtask(sessionID, [])

        const state = SessionProofWorkflow.get(sessionID)
        state!.queue[0]!.task_id = "ses_child"
        state!.queue[0]!.running_lease_expires_at = Date.now() - 1

        const resumed = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(resumed?.description).toBe("Resume gap_1")
        expect(resumed?.task_id).toBe("ses_child")
        expect(resumed?.lemma_assignment?.admit_id).toBe("gap_1")
        expect(SessionProofWorkflow.get(sessionID)?.queue[0]?.running_lease_expires_at).toBeGreaterThan(Date.now())

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("rejects solved lemma results without exact proof_text", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const pendingSource = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hxxx"),
          "have Hxxx : True.",
          "{ (* admit_id: gap_1 *)",
          "  admit.",
          "}",
          "(* proof_region end admit_id: gap_1 *)",
          "exact Hxxx.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, pendingSource)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        const first = await SessionProofWorkflow.planNextSubtask(sessionID, [])

        const source = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hxxx"),
          "have Hxxx : True.",
          "{ exact I. }",
          "(* proof_region end admit_id: gap_1 *)",
          "exact Hxxx.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)

        const messages = [
          {
            info: { id: "msg_1", role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  metadata: {
                    sessionId: "ses_child",
                    lemma_assignment: first?.lemma_assignment,
                    proof_result_summary: { status: "solved" },
                    proof_result: { proof_text: "not the assigned region" },
                  },
                },
              },
            ],
          },
        ] as any

        await SessionProofWorkflow.planNextSubtask(sessionID, messages)
        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue[0]?.status).toBe("escalated")
        expect(state?.queue[0]?.escalation_type).toBe("not_local")
        expect(state?.queue[0]?.escalation_reason).toContain("exactly equal")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("rejects solved lemma regions without an informal-proof comment", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const pendingSource = [
          "Lemma demo : True.",
          "Proof.",
          regionBeginWithoutInformal("gap_1", "Hxxx"),
          "have Hxxx : True.",
          "{ (* admit_id: gap_1 *)",
          "  admit.",
          "}",
          "(* proof_region end admit_id: gap_1 *)",
          "exact Hxxx.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, pendingSource)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        const first = await SessionProofWorkflow.planNextSubtask(sessionID, [])

        const source = [
          "Lemma demo : True.",
          "Proof.",
          regionBeginWithoutInformal("gap_1", "Hxxx"),
          "have Hxxx : True.",
          "{ exact I. }",
          "(* proof_region end admit_id: gap_1 *)",
          "exact Hxxx.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)

        const messages = [
          {
            info: { id: "msg_1", role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  metadata: {
                    sessionId: "ses_child",
                    lemma_assignment: first?.lemma_assignment,
                    proof_result_summary: { status: "solved" },
                    proof_result: { proof_text: proofRegionText(source, "gap_1") },
                  },
                },
              },
            ],
          },
        ] as any

        await SessionProofWorkflow.planNextSubtask(sessionID, messages)
        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue[0]?.status).toBe("escalated")
        expect(state?.queue[0]?.escalation_type).toBe("not_local")
        expect(state?.queue[0]?.escalation_reason).toContain("informal-proof")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("classifies compile success separately from final theorem success", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const nonfinal = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hxxx"),
          "have Hxxx : True.",
          "{ exact I. }",
          "(* proof_region end admit_id: gap_1 *)",
          "exact Hxxx.",
          "Admitted.",
          "",
        ].join("\n")
        const nonfinalStatus = SessionProofWorkflow.classifyCoqcSuccess(sessionID, file, nonfinal)
        expect(nonfinalStatus.status_detail).toBe("compile_success_nonfinal")
        expect(nonfinalStatus.proof_progress.status).toBe("baseline")
        expect(nonfinalStatus.proof_progress.accepted).toBe(false)

        const final = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hxxx"),
          "have Hxxx : True.",
          "{ exact I. }",
          "(* proof_region end admit_id: gap_1 *)",
          "exact Hxxx.",
          "Qed.",
          "",
        ].join("\n")
        const finalStatus = SessionProofWorkflow.classifyCoqcSuccess(sessionID, file, final)
        expect(finalStatus.status_detail).toBe("final_theorem_success")
        expect(finalStatus.proof_progress.status).toBe("final_theorem_success")
        expect(finalStatus.proof_progress.accepted).toBe(true)

        const bareFinal = [
          "Lemma demo : True.",
          "Proof.",
          "exact I.",
          "Admitted.",
          "",
        ].join("\n")
        const bareStatus = SessionProofWorkflow.classifyCoqcSuccess(sessionID, file, bareFinal)
        expect(bareStatus.status_detail).toBe("compile_success_nonfinal")
        expect(bareStatus.proof_progress.accepted).toBe(false)

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("ignores admit and theorem-like text inside Coq comments and strings", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const sessionID = session.id
        const source = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hxxx"),
          "(* The old draft used admit. and corresponded to Lemma 2. *)",
          "have Hxxx : True.",
          "{ idtac \"admit. Lemma fake\"; exact I. }",
          "(* proof_region end admit_id: gap_1 *)",
          "exact Hxxx.",
          "Qed.",
          "",
        ].join("\n")
        await Bun.write(file, source)
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const refreshed = SessionProofWorkflow.refresh(sessionID, file, source).state
        expect(refreshed.queue[0]?.status).toBe("unvalidated")

        const status = SessionProofWorkflow.classifyCoqcSuccess(sessionID, file, source)
        expect(status.theorem).toBe("demo")
        expect(status.status_detail).toBe("final_theorem_success")
        expect(status.has_unfinished_proof).toBe(false)
        expect(status.proof_progress.current.unfinished_count).toBe(0)

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("infers the final theorem without treating comment text as a declaration", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const source = [
          "Theorem direct_target : True.",
          "Proof.",
          "(* This corresponds to Lemma 2; an old draft ended with Admitted. *)",
          "idtac \"Theorem fake used admit.\".",
          "exact I.",
          "Qed.",
          "",
        ].join("\n")
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")

        const status = SessionProofWorkflow.classifyCoqcSuccess(session.id, file, source)
        expect(status.theorem).toBe("direct_target")
        expect(status.final_theorem_gate.ok).toBe(true)
        expect(status.proof_progress.current.unfinished_count).toBe(0)

        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("accepts a direct Qed proof without proof regions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const source = [
          "Lemma helper : True.",
          "Proof.",
          "exact I.",
          "Qed.",
          "Theorem direct_target : True.",
          "Proof.",
          "exact I.",
          "Qed.",
          "",
        ].join("\n")
        const status = SessionProofWorkflow.classifyCoqcSuccess(sessionID, file, source)
        expect(status.theorem).toBe("direct_target")
        expect(status.status_detail).toBe("final_theorem_success")
        expect(status.final_theorem_gate.ok).toBe(true)
        expect(status.proof_progress.accepted).toBe(true)

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("recognizes Fact declarations as proof workflow targets", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/fact.v`
        const session = await Session.create({})
        const source = [
          "Fact direct_fact : True.",
          "Proof.",
          "exact I.",
          "Qed.",
          "",
        ].join("\n")
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")

        const status = SessionProofWorkflow.classifyCoqcSuccess(session.id, file, source)
        expect(status.theorem).toBe("direct_fact")
        expect(status.status_detail).toBe("final_theorem_success")
        expect(status.final_theorem_gate.ok).toBe(true)

        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("accepts nonfinal progress only with a compiler-certified proof region", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const twoPending = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hone"),
          "have Hone : True.",
          "{ admit. }",
          "(* proof_region end admit_id: gap_1 *)",
          regionBegin("gap_2", "Htwo"),
          "have Htwo : True.",
          "{ admit. }",
          "(* proof_region end admit_id: gap_2 *)",
          "exact Hone.",
          "Admitted.",
          "",
        ].join("\n")

        const baseline = SessionProofWorkflow.classifyCoqcSuccess(sessionID, file, twoPending)
        expect(baseline.proof_progress.status).toBe("baseline")
        expect(baseline.proof_progress.accepted).toBe(false)

        const repeated = SessionProofWorkflow.classifyCoqcSuccess(sessionID, file, twoPending)
        expect(repeated.proof_progress.status).toBe("stalled")
        expect(repeated.proof_progress.accepted).toBe(false)

        const onePending = twoPending.replace("have Hone : True.\n{ admit. }", "have Hone : True.\n{ exact I. }")
        const syntacticReduction = SessionProofWorkflow.classifyCoqcSuccess(sessionID, file, onePending)
        expect(syntacticReduction.proof_progress.status).toBe("stalled")
        expect(syntacticReduction.proof_progress.accepted).toBe(false)
        expect(syntacticReduction.proof_progress.current.unfinished_count).toBeLessThan(
          baseline.proof_progress.current.unfinished_count,
        )

        const advanced = SessionProofWorkflow.classifyCoqcSuccess(sessionID, file, onePending, {
          action: "certified",
          admit_id: "gap_1",
          old_status: "unvalidated",
          new_status: "solved",
          compiler_signature: "compiler-ok",
          next_action: "continue",
          affected_sessions: 1,
        })
        expect(advanced.proof_progress.status).toBe("advanced")
        expect(advanced.proof_progress.accepted).toBe(true)

        const repeatedAdvanced = SessionProofWorkflow.classifyCoqcSuccess(sessionID, file, onePending)
        expect(repeatedAdvanced.proof_progress.status).toBe("stalled")
        expect(repeatedAdvanced.proof_progress.accepted).toBe(false)

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("accepts compiler-failure progress only when the stable sentence anchor moves forward", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/failure-frontier.v`
        const session = await Session.create({})
        const sessionID = session.id
        const source = [
          "Lemma demo : True.",
          "Proof.",
          "pose proof I as Hone.",
          "pose proof I as Htwo.",
          "exact I.",
          "Qed.",
          "",
        ].join("\n")
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")

        const baseline = SessionProofWorkflow.classifyCoqcFailure(sessionID, file, source, {
          first_error_line: 3,
          first_error_message: "Error: first failing sentence",
        })
        expect(baseline.proof_progress.status).toBe("baseline")
        expect(baseline.proof_progress.accepted).toBe(false)

        const insertedBeforeSameFailure = source.replace(
          "pose proof I as Hone.",
          "pose proof I as Hzero.\npose proof I as Hone.",
        )
        const sameFailingSentence = SessionProofWorkflow.classifyCoqcFailure(
          sessionID,
          file,
          insertedBeforeSameFailure,
          {
            first_error_line: 4,
            first_error_message: "Error: first failing sentence after an inserted command",
          },
        )
        expect(sameFailingSentence.proof_progress.status).toBe("stalled")
        expect(sameFailingSentence.proof_progress.accepted).toBe(false)

        const advanced = SessionProofWorkflow.classifyCoqcFailure(sessionID, file, source, {
          first_error_line: 4,
          first_error_message: "Error: later failing sentence",
        })
        expect(advanced.proof_progress.status).toBe("advanced")
        expect(advanced.proof_progress.accepted).toBe(false)
        expect(advanced.proof_progress.level).toBe("debug")
        expect(advanced.proof_progress.workspace_committable).toBe(false)
        expect(advanced.proof_progress.receipt?.kind).toBe("first_error_advanced")

        const shiftedOnly = source.replace("Proof.\n", "Proof.\n(* line-number-only drift *)\n")
        const repeatedAnchor = SessionProofWorkflow.classifyCoqcFailure(sessionID, file, shiftedOnly, {
          first_error_line: 5,
          first_error_message: "Error: same later failing sentence",
        })
        expect(repeatedAnchor.proof_progress.status).toBe("stalled")
        expect(repeatedAnchor.proof_progress.accepted).toBe(false)
        expect(repeatedAnchor.proof_progress.receipt).toBeUndefined()

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("blocks wide agents from editing running regions without explicit takeover", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const before = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hxxx"),
          "have Hxxx : True.",
          "{ (* admit_id: gap_1 *)",
          "  admit.",
          "}",
          "(* proof_region end admit_id: gap_1 *)",
          "exact Hxxx.",
          "Admitted.",
          "",
        ].join("\n")
        const after = before.replace("  admit.", "  exact I.")
        await Bun.write(file, before)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        await SessionProofWorkflow.planNextSubtask(sessionID, [])

        expect(() => SessionProofWorkflow.assertWideAgentRunningRegionEditAllowed({
          sessionID,
          agent: "prover",
          file,
          before,
          after,
        })).toThrow("cannot edit running lemma-owned proof_region")

        expect(SessionProofWorkflow.assertWideAgentRunningRegionEditAllowed({
          sessionID,
          agent: "prover",
          file,
          before,
          after,
          takeover: true,
          takeoverReason: "remodeling stale local target",
        })).toEqual([{ sessionID, admit_id: "gap_1" }])

        const recorded = SessionProofWorkflow.recordWideAgentRunningRegionTakeover({
          agent: "prover",
          file,
          before,
          after,
          takeoverReason: "remodeling stale local target",
        })
        expect(recorded).toEqual([{ sessionID, admit_id: "gap_1" }])

        const state = SessionProofWorkflow.get(sessionID)
        expect(state?.queue[0]?.status).toBe("pending")
        expect(state?.queue[0]?.takeover_agent).toBe("prover")
        expect(state?.queue[0]?.running_release_reason).toContain("taken over by prover")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("blocks wide agents from editing solved prefix before the first unresolved region", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const before = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hone"),
          "have Hone : True.",
          "{ exact I. }",
          "(* proof_region end admit_id: gap_1 *)",
          "have Hone_done := Hone.",
          regionBegin("gap_2", "Htwo"),
          "have Htwo : True.",
          "{ (* admit_id: gap_2 *)",
          "  admit.",
          "}",
          "(* proof_region end admit_id: gap_2 *)",
          "exact Htwo.",
          "Admitted.",
          "",
        ].join("\n")
        const after = before.replace("{ exact I. }", "{ exact I. (* stale rewrite *) }")
        await Bun.write(file, before)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        SessionProofWorkflow.refresh(sessionID, file, before)
        await SessionProofWorkflow.recordCompilerResult({
          sessionID,
          file,
          source: before,
          validator: "coqc",
          ok: true,
        })

        expect(() => SessionProofWorkflow.assertWideAgentRunningRegionEditAllowed({
          sessionID,
          agent: "prover",
          file,
          before,
          after,
        })).toThrow("cannot edit compiler-certified proof_region gap_1")

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("allows theorem-level repair edits after the solved prefix and before the blocker region", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem.v`
        const session = await Session.create({})
        const before = [
          "Lemma demo : True.",
          "Proof.",
          regionBegin("gap_1", "Hone"),
          "have Hone : True.",
          "{ exact I. }",
          "(* proof_region end admit_id: gap_1 *)",
          regionBegin("gap_2", "Htwo"),
          "have Htwo : True.",
          "{ (* admit_id: gap_2 *)",
          "  admit.",
          "}",
          "(* proof_region end admit_id: gap_2 *)",
          "exact Htwo.",
          "Admitted.",
          "",
        ].join("\n")
        const after = before.replace(
          `${"(* proof_region end admit_id: gap_1 *)\n"}${regionBegin("gap_2", "Htwo")}`,
          [
            "(* proof_region end admit_id: gap_1 *)",
            "have Hbridge : True.",
            "{ exact I. }",
            regionBegin("gap_2", "Htwo"),
          ].join("\n"),
        )
        await Bun.write(file, before)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        SessionProofWorkflow.refresh(sessionID, file, before)
        await SessionProofWorkflow.recordCompilerResult({
          sessionID,
          file,
          source: before,
          validator: "coqc",
          ok: true,
        })

        expect(SessionProofWorkflow.assertWideAgentRunningRegionEditAllowed({
          sessionID,
          agent: "prover",
          file,
          before,
          after,
        })).toEqual([])

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("context-normalization escalations receive only one bounded corrective resume", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const variants = [
          { name: "missing", review: undefined },
          {
            name: "inconclusive",
            review: {
              applicable: true,
              audit_id: "audit_inconclusive",
              verified: true,
              outcome: "inconclusive",
              failed_local_bridge: false,
              action: "resume_once_for_targeted_local_evidence",
            },
          },
          {
            name: "convertible",
            review: {
              applicable: true,
              audit_id: "audit_convertible",
              verified: true,
              outcome: "convertible",
              failed_local_bridge: false,
              action: "resume_once_for_targeted_local_evidence",
            },
          },
        ] as const

        for (const [index, variant] of variants.entries()) {
          const file = `${tmp.path}/context-${variant.name}.v`
          const session = await Session.create({})
          const source = [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hgap"),
            "have Hgap : True.",
            "{ admit. }",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hgap.",
            "Admitted.",
            "",
          ].join("\n")
          await Bun.write(file, source)

          const sessionID = session.id
          SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
          const first = await SessionProofWorkflow.planNextSubtask(sessionID, [])
          expect(first?.description).toBe("Prove gap_1")

          const attemptReport = {
            informal_proof_summary: "Instantiate the hidden argument and expose the local equality.",
            validated_fragments: [],
            failed_tactics_or_edits: ["reflexivity did not close the displayed goal"],
            stable_blocker_goal: "True",
            suspected_missing_bridge: "a hidden Section argument may need an explicit local bridge",
            context_mismatch_basis: "hidden_arguments",
            proposed_children: [],
            recommended_action: "strengthen_context",
          }
          const firstResult = {
            info: { id: `msg_${index}_1`, role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  metadata: {
                    sessionId: `ses_context_${index}`,
                    lemma_assignment: first?.lemma_assignment,
                    proof_result_summary: {
                      status: "escalate",
                      escalation_type: "needs_context_strengthening",
                      escalate_reason: "The hidden argument shape is not exposed in the local goal.",
                      attempt_report: attemptReport,
                    },
                    ...(variant.review ? { context_audit_review: variant.review } : {}),
                  },
                },
              },
            ],
          }

          const resumed = await SessionProofWorkflow.planNextSubtask(sessionID, [firstResult] as any)
          expect(resumed?.agent).toBe("lemma")
          expect(resumed?.description).toBe("Resume gap_1")
          expect(resumed?.task_id).toBe(`ses_context_${index}`)
          expect(resumed?.prompt).toContain("one bounded corrective resume")
          expect(SessionProofWorkflow.get(sessionID)?.queue[0]?.context_audit_resume_count).toBe(1)

          const secondResult = {
            ...firstResult,
            info: { id: `msg_${index}_2`, role: "assistant" },
          }
          const repair = await SessionProofWorkflow.planNextSubtask(
            sessionID,
            [firstResult, secondResult] as any,
          )
          expect(repair?.agent).toBe("prover")
          expect(repair?.description).toBe("Repair gap_1")
          expect(repair?.proof_repair_assignment?.escalation_type).toBe("needs_context_strengthening")

          SessionProofWorkflow.clear(sessionID)
          SessionProof.clear(sessionID)
          await Session.remove(sessionID)
        }
      },
    })
  })

  test("verified non-convertibility plus a failed local bridge escalates immediately", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/context-nonconvertible.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hgap"),
            "have Hgap : True.",
            "{ admit. }",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hgap.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        const first = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        const messages = [
          {
            info: { id: "msg_nonconvertible", role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  metadata: {
                    sessionId: "ses_nonconvertible",
                    lemma_assignment: first?.lemma_assignment,
                    proof_result_summary: {
                      status: "escalate",
                      escalation_type: "needs_context_strengthening",
                      escalate_reason: "The two instantiated forms are not definitionally equal.",
                      attempt_report: {
                        informal_proof_summary: "Try to bridge the two instantiated forms locally.",
                        validated_fragments: [],
                        failed_tactics_or_edits: ["exact Hbridge failed"],
                        stable_blocker_goal: "True",
                        context_mismatch_basis: "module_instantiation",
                        failed_local_bridge: "assert (Hbridge : left = right) by reflexivity failed with Unable to unify.",
                        proposed_children: [],
                        recommended_action: "strengthen_context",
                      },
                    },
                    context_audit_review: {
                      applicable: true,
                      audit_id: "audit_nonconvertible",
                      verified: true,
                      outcome: "not_convertible",
                      failed_local_bridge: true,
                      action: "accept_with_verified_nonconvertibility",
                    },
                  },
                },
              },
            ],
          },
        ] as any

        const repair = await SessionProofWorkflow.planNextSubtask(sessionID, messages)
        expect(repair?.agent).toBe("prover")
        expect(repair?.description).toBe("Repair gap_1")
        expect(SessionProofWorkflow.get(sessionID)?.queue[0]?.context_audit_resume_count).toBeUndefined()
        const routeFailures = ProofRouteLedger.getActiveRouteFailures({
          workspace: tmp.path,
          file,
          theorem: "demo",
          source: await Bun.file(file).text(),
        })
        expect(routeFailures).toHaveLength(1)
        expect(routeFailures[0]?.confidence).toBe("verified")
        expect(routeFailures[0]?.recommended_action).toBe("replace_lemma")

        ProofRouteLedger.clearScope({ workspace: tmp.path, file, theorem: "demo" })
        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })

  test("persists needs_preceding_bridge evidence without hard-banning an unaudited child report", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/missing-premise-route.v`
        const session = await Session.create({})
        await Bun.write(
          file,
          [
            "Lemma demo : True.",
            "Proof.",
            regionBegin("gap_1", "Hgap"),
            "have Hgap : True.",
            "{ admit. }",
            "(* proof_region end admit_id: gap_1 *)",
            "exact Hgap.",
            "Admitted.",
            "",
          ].join("\n"),
        )

        SessionProof.set(session.id, file, { line: 1, character: 0 }, "manual")
        const first = await SessionProofWorkflow.planNextSubtask(session.id, [])
        const messages = [
          {
            info: { id: "msg_missing_premise", role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  metadata: {
                    sessionId: "ses_missing_premise",
                    lemma_assignment: first?.lemma_assignment,
                    proof_result_summary: {
                      status: "escalate",
                      escalation_type: "needs_preceding_bridge",
                      escalate_reason: "pair_intro requires Q before it can close the local target.",
                      attempt_report: {
                        informal_proof_summary: "Apply pair_intro after deriving Q.",
                        validated_fragments: [],
                        failed_tactics_or_edits: ["eapply pair_intro left Q unresolved"],
                        stable_blocker_goal: "True",
                        suspected_missing_bridge: "Q",
                        failed_local_bridge: "assert (HQ : Q) by assumption failed because Q is absent",
                        proposed_children: [],
                        recommended_action: "add_preceding_helper",
                      },
                    },
                  },
                },
              },
            ],
          },
        ] as any

        await SessionProofWorkflow.planNextSubtask(session.id, messages)
        const routeFailures = ProofRouteLedger.getActiveRouteFailures({
          workspace: tmp.path,
          file,
          theorem: "demo",
          source: await Bun.file(file).text(),
        })
        expect(routeFailures).toHaveLength(1)
        expect(routeFailures[0]?.failed_lemma).toBe("pair_intro")
        expect(routeFailures[0]?.missing_premises).toEqual(["Q"])
        expect(routeFailures[0]?.confidence).toBe("tentative")
        expect(routeFailures[0]?.recommended_action).toBe("prove_missing_premise")

        ProofRouteLedger.clearScope({ workspace: tmp.path, file, theorem: "demo" })
        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("proof-task dispatch lock is released when the theorem revision or admit_id changes", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/dispatch.v`
        const session = await Session.create({})
        const source = [
          "Lemma demo : True.",
          "Proof.",
          "(* proof_region begin owner: lemma admit_id: gap_1 theorem: demo kind: pointwise_semantic_bridge target: Hgap *)",
          "have Hgap : True.",
          "{ admit. }",
          "(* proof_region end admit_id: gap_1 *)",
          "exact Hgap.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)

        const sessionID = session.id
        SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
        const repair = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        const assignment = repair?.proof_repair_assignment
        expect(assignment).toBeDefined()

        await expect(
          SessionProofWorkflow.assertProofTaskDispatchAllowed({
            sessionID,
            subagentType: "fixer",
            proofProducing: true,
          }),
        ).rejects.toThrow("proof_task_dispatch_blocked")

        const matching = await SessionProofWorkflow.assertProofTaskDispatchAllowed({
          sessionID,
          subagentType: "prover",
          proofProducing: true,
          proofRepairAssignment: assignment,
        })
        expect(matching.decision).toBe("allowed_matching_repair")

        const commentOnly = source.replace("have Hgap : True.", "(* administrative note *)\nhave Hgap : True.")
        await Bun.write(file, commentOnly)
        const commentReleased = await SessionProofWorkflow.assertProofTaskDispatchAllowed({
          sessionID,
          subagentType: "fixer",
          proofProducing: true,
        })
        expect(commentReleased.decision).toBe("allowed_without_active_repair")
        expect(SessionProofWorkflow.get(sessionID)?.active_repair).toBeUndefined()
        expect(SessionProofWorkflow.get(sessionID)?.fallback_guard).toBeUndefined()

        const commentRepair = await SessionProofWorkflow.planNextSubtask(sessionID, [])
        expect(commentRepair?.proof_repair_assignment?.admit_id).toBe("gap_1")

        const markerOnly = commentOnly.replaceAll("gap_1", "gap_renamed")
        await Bun.write(file, markerOnly)
        const markerReleased = await SessionProofWorkflow.assertProofTaskDispatchAllowed({
          sessionID,
          subagentType: "fixer",
          proofProducing: true,
        })
        expect(markerReleased.decision).toBe("allowed_without_active_repair")
        expect(SessionProofWorkflow.get(sessionID)?.active_repair).toBeUndefined()
        expect(SessionProofWorkflow.get(sessionID)?.fallback_guard).toBeUndefined()
        expect(SessionProofWorkflow.get(sessionID)?.queue[0]?.admit_id).toBe("gap_renamed")

        const substantive = markerOnly.replace("{ admit. }", "{ exact I. }")
        await Bun.write(file, substantive)
        const substantiveReleased = await SessionProofWorkflow.assertProofTaskDispatchAllowed({
          sessionID,
          subagentType: "fixer",
          proofProducing: true,
        })
        expect(substantiveReleased.decision).toBe("allowed_without_active_repair")

        const lifecycle = await SessionProofWorkflow.recordCompilerResult({
          sessionID,
          file,
          source: substantive,
          validator: "checkpoint-coqc",
          ok: true,
        })
        expect(lifecycle.action).toBe("certified")

        const released = await SessionProofWorkflow.assertProofTaskDispatchAllowed({
          sessionID,
          subagentType: "fixer",
          proofProducing: true,
        })
        expect(released.decision).toBe("allowed_without_active_repair")
        expect(SessionProofWorkflow.get(sessionID)?.active_repair).toBeUndefined()

        SessionProofWorkflow.clear(sessionID)
        SessionProof.clear(sessionID)
        await Session.remove(sessionID)
      },
    })
  })
})
