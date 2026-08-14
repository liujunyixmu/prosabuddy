import { describe, expect, test } from "bun:test"
import { createHash } from "crypto"
import type { Tool } from "../../src/tool/tool"
import { ProofPlanTool, reviewProofPlan, semanticPlanFingerprint } from "../../src/tool/proof-plan"
import { ProofPlan, type ProofPlanStep as ProofPlanStepValue } from "../../src/tool/proof-schema"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionProof } from "../../src/session/session-proof"
import { SessionProofWorkflow } from "../../src/session/proof-workflow"
import { ProofRouteLedger } from "../../src/session/proof-route-ledger"
import { ProofEditTransaction } from "../../src/session/proof-edit-transaction"
import { auditCandidateLemma } from "../../src/tool/proof-premise-audit"
import { tmpdir } from "../fixture/fixture"

function context(sessionID: string): Tool.Context {
  return {
    sessionID,
    messageID: `msg-${sessionID}`,
    callID: `call-${sessionID}`,
    agent: "prover",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => {},
    ask: async () => {},
  }
}

function node(overrides: Partial<ProofPlanStepValue> = {}): ProofPlanStepValue {
  return {
    paper_step_id: "step-1",
    node_id: "leaf-1",
    kind: "semantic_bridge",
    layer: "semantic",
    paper_claim: "Prove a strict intermediate fact.",
    formal_goal: "A",
    candidate_lemmas: ["supporting_fact"],
    prosa_candidate_lemmas: [],
    mathcomp_candidate_lemmas: [],
    required_hypotheses: ["HA"],
    fallback_plan: [],
    done_when: "The strict child is available.",
    depends_on: ["HA"],
    dependency_uses: [],
    consumers: ["parent_composition"],
    claim_delta: "Replace A /\\ B with the strict child A.",
    transformations: ["semantic_bound"],
    delegation_candidate: true,
    risk: "low",
    evidence_status: "candidate",
    ...overrides,
  }
}

describe("tool.proof_plan bounded semantic review", () => {
  test("rejects a theorem-equivalent delegated leaf", () => {
    const plan = ProofPlan.parse({
      theorem: "demo",
      root_goal: "A /\\ B",
      nodes: [node({ formal_goal: "A /\\ B", target_normal_form: "A /\\ B" })],
      edges: [],
      ready_nodes: ["leaf-1"],
      planner_contract: { marker_fields_required_for_lemma_delegation: [], note: "fixture" },
    })

    const review = reviewProofPlan(plan)
    expect(review.status).toBe("reject")
    expect(review.hard_errors.map((entry) => entry.code)).toContain("parent_equivalent_leaf")
  })

  test("rejects a disconnected delegated leaf", () => {
    const plan = ProofPlan.parse({
      theorem: "demo",
      root_goal: "A /\\ B",
      nodes: [node({ consumers: [] })],
      edges: [],
      ready_nodes: ["leaf-1"],
      planner_contract: { marker_fields_required_for_lemma_delegation: [], note: "fixture" },
    })

    const review = reviewProofPlan(plan)
    expect(review.hard_errors.map((entry) => entry.code)).toContain("disconnected_leaf")
  })

  test("warns about compound leaves without blocking materialization", () => {
    const plan = ProofPlan.parse({
      theorem: "demo",
      root_goal: "A /\\ B",
      nodes: [node({ transformations: ["semantic_bound", "count_cardinality"] })],
      edges: [],
      ready_nodes: ["leaf-1"],
      planner_contract: { marker_fields_required_for_lemma_delegation: [], note: "fixture" },
    })

    const review = reviewProofPlan(plan)
    expect(review.materialization_allowed).toBe(true)
    expect(review.warnings.map((entry) => entry.code)).toContain("compound_leaf")
  })

  test("warns when a region combines several high-risk semantic transformations", () => {
    const plan = ProofPlan.parse({
      theorem: "demo",
      root_goal: "A /\\ B",
      nodes: [
        node({
          transformations: ["semantic_bound", "count_cardinality", "sum_exchange", "arithmetic"],
        }),
      ],
      edges: [],
      ready_nodes: ["leaf-1"],
      planner_contract: { marker_fields_required_for_lemma_delegation: [], note: "fixture" },
    })

    const review = reviewProofPlan(plan)
    expect(review.materialization_allowed).toBe(true)
    expect(review.warnings.map((entry) => entry.code)).toContain("region_too_coarse")
  })

  test("rejects a branch composition that does not consume its premise even when labeled low risk", () => {
    const plan = ProofPlan.parse({
      theorem: "demo",
      root_goal: "A /\\ B",
      nodes: [
        node({
          risk: "low",
          transformations: ["parent_composition"],
          required_hypotheses: ["Hge : c <= I"],
          composition_certificate: {
            steps: [{ step_id: "close", input_refs: ["HA"], output_proposition: "A" }],
          },
        }),
      ],
      edges: [],
      ready_nodes: ["leaf-1"],
      planner_contract: { marker_fields_required_for_lemma_delegation: [], note: "fixture" },
    })

    const review = reviewProofPlan(plan)
    expect(review.hard_errors.map((entry) => entry.code)).toContain("required_hypothesis_unmapped")
  })

  test("rejects a declared dependency whose exported fact is not consumed", () => {
    const producer = node({
      paper_step_id: "producer-step",
      node_id: "producer",
      formal_goal: "P",
      target_normal_form: "P",
      required_hypotheses: [],
      depends_on: [],
      consumers: ["leaf-1"],
      output: { hypotheses: [], definitions: [], facts: ["Hprod : P"] },
      risk: "low",
      composition_certificate: undefined,
    })
    const consumer = node({
      risk: "medium",
      depends_on: ["producer"],
      dependency_uses: [{ producer_node: "producer", output_anchor: "Hprod" }],
      required_hypotheses: ["HA"],
      composition_certificate: {
        steps: [{ step_id: "close", input_refs: ["HA"], output_proposition: "A" }],
      },
    })
    const plan = ProofPlan.parse({
      theorem: "demo",
      root_goal: "A /\\ B",
      nodes: [producer, consumer],
      edges: [{ from: "producer", to: "leaf-1" }],
      ready_nodes: ["producer"],
      planner_contract: { marker_fields_required_for_lemma_delegation: [], note: "fixture" },
    })

    const review = reviewProofPlan(plan)
    expect(review.warnings.map((entry) => entry.code)).toContain("dependency_not_consumed")
  })

  test("resolves a composition input producer node ID to its exported output anchor", () => {
    const producer = node({
      paper_step_id: "producer-step",
      node_id: "producer",
      formal_goal: "P",
      target_normal_form: "P",
      required_hypotheses: [],
      depends_on: [],
      consumers: ["leaf-1"],
      output: { hypotheses: [], definitions: [], facts: ["Hprod : P"] },
      risk: "low",
      composition_certificate: undefined,
    })
    const consumer = node({
      risk: "medium",
      depends_on: ["producer"],
      dependency_uses: [{ producer_node: "producer", output_anchor: "Hprod" }],
      required_hypotheses: ["HA"],
      composition_certificate: {
        steps: [{ step_id: "close", input_refs: ["HA", "producer"], output_proposition: "A" }],
      },
    })
    const plan = ProofPlan.parse({
      theorem: "demo",
      root_goal: "A /\\ B",
      nodes: [producer, consumer],
      edges: [{ from: "producer", to: "leaf-1" }],
      ready_nodes: ["producer"],
      planner_contract: { marker_fields_required_for_lemma_delegation: [], note: "fixture" },
    })

    const review = reviewProofPlan(plan)
    expect(review.hard_errors.map((entry) => entry.code)).not.toContain("dependency_not_consumed")
    expect(review.warnings.map((entry) => entry.code)).not.toContain("dependency_not_consumed")
  })

  test("requires residual premises to come from a real dependency or compiler certificate", () => {
    const premise = ProofRouteLedger.premiseFingerprint("Q")
    const candidate = {
      name: "pair_intro",
      library: "prosa" as const,
      reason: "build the conjunction",
      premise_sources: [],
      audit: {
        lemma: "pair_intro",
        target_contract_fingerprint: ProofRouteLedger.targetContractFingerprint("A"),
        conclusion_compatible: true,
        residual_premises: ["Q"],
        residual_premise_fingerprints: [premise],
        verdict: "bridge_required" as const,
        audited_at: Date.now(),
      },
    }
    const blocked = ProofPlan.parse({
      theorem: "demo",
      root_goal: "A /\\ B",
      nodes: [node({ candidate_lemmas: [], prosa_candidate_lemmas: [candidate] })],
      edges: [],
      ready_nodes: ["leaf-1"],
      planner_contract: { marker_fields_required_for_lemma_delegation: [], note: "fixture" },
    })
    const selfClaimedLocal = ProofPlan.parse({
      ...blocked,
      nodes: [
        {
          ...blocked.nodes[0],
          prosa_candidate_lemmas: [
            {
              ...candidate,
              premise_sources: [{ premise_fingerprint: premise, status: "exact_local" as const }],
            },
          ],
        },
      ],
    })
    const dependencyMapped = ProofPlan.parse({
      ...blocked,
      nodes: [
        node({
          paper_step_id: "step-0",
          node_id: "premise-q",
          formal_goal: "Q",
          target_normal_form: "Q",
          candidate_lemmas: [],
          required_hypotheses: [],
          depends_on: [],
          consumers: ["leaf-1"],
          delegation_candidate: false,
        }),
        {
          ...blocked.nodes[0],
          depends_on: ["premise-q"],
          prosa_candidate_lemmas: [
            {
              ...candidate,
              premise_sources: [
                {
                  premise_fingerprint: premise,
                  status: "dependency_node" as const,
                  dependency_node: "premise-q",
                },
              ],
            },
          ],
        },
      ],
      edges: [{ from: "premise-q", to: "leaf-1" }],
      ready_nodes: ["premise-q"],
    })

    expect(reviewProofPlan(blocked).hard_errors.map((entry) => entry.code)).toContain(
      "candidate_unresolved_premise",
    )
    expect(reviewProofPlan(selfClaimedLocal).hard_errors.map((entry) => entry.code)).toContain(
      "candidate_premise_local_evidence_invalid",
    )
    expect(reviewProofPlan(dependencyMapped).hard_errors.map((entry) => entry.code)).not.toContain(
      "candidate_unresolved_premise",
    )
    expect(reviewProofPlan(dependencyMapped).hard_errors.map((entry) => entry.code)).not.toContain(
      "candidate_premise_dependency_missing",
    )
  })

  test("enforces premise audits on non-delegated theorem-level nodes", () => {
    const premise = ProofRouteLedger.premiseFingerprint("Q")
    const plan = ProofPlan.parse({
      theorem: "demo",
      root_goal: "A /\\ B",
      nodes: [
        node({
          node_id: "layer-1",
          paper_step_id: "layer-1",
          formal_goal: "A /\\ B",
          target_normal_form: "A /\\ B",
          delegation_candidate: false,
          depends_on: [],
          consumers: ["parent_composition"],
          candidate_lemmas: [],
          prosa_candidate_lemmas: [
            {
              name: "whole_theorem_candidate",
              library: "prosa",
              reason: "exercise theorem-level premise enforcement",
              premise_sources: [],
              audit: {
                lemma: "whole_theorem_candidate",
                target_contract_fingerprint: ProofRouteLedger.targetContractFingerprint("A /\\ B"),
                conclusion_compatible: true,
                residual_premises: ["Q"],
                residual_premise_fingerprints: [premise],
                verdict: "bridge_required",
                audited_at: Date.now(),
              },
            },
          ],
        }),
      ],
      edges: [],
      ready_nodes: ["layer-1"],
      planner_contract: { marker_fields_required_for_lemma_delegation: [], note: "fixture" },
    })

    const review = reviewProofPlan(plan)
    expect(review.materialization_allowed).toBe(false)
    expect(review.hard_errors.map((entry) => entry.code)).toContain("candidate_unresolved_premise")
  })

  test("rejects an invented compiler certificate for a residual premise", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/certificate-audit.v`
        const source = [
          "Axiom supporting_fact : forall A B : Prop, A -> B -> B.",
          "Lemma demo (A B : Prop) (HA : A) : A /\\ B.",
          "Proof.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)
        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 1, character: 0 }, "manual")
        const candidate = {
          name: "supporting_fact",
          library: "prosa" as const,
          reason: "candidate with a residual premise",
          premise_sources: [],
        }
        const audit = await auditCandidateLemma({
          file,
          source,
          theorem: "demo",
          formalGoal: "B",
          candidate,
        })
        expect(audit.residual_premise_fingerprints.length).toBeGreaterThan(0)
        const premise = audit.residual_premise_fingerprints[0]!
        const tool = await ProofPlanTool.init()
        const result = await tool.execute(
          {
            theorem: "demo",
            root_goal: "A /\\ B",
            nodes: [
              node({
                formal_goal: "B",
                target_normal_form: "B",
                candidate_lemmas: [],
                depends_on: [],
                required_hypotheses: [],
                prosa_candidate_lemmas: [
                  {
                    ...candidate,
                    premise_sources: [
                      {
                        premise_fingerprint: premise,
                        status: "compiler_certified" as const,
                        certificate_id: "invented-certificate",
                      },
                    ],
                  },
                ],
              }),
            ],
            edges: [],
          },
          context(session.id),
        )

        expect(result.metadata.review?.hard_errors.map((entry) => entry.code)).toContain(
          "candidate_premise_certificate_invalid",
        )
        expect(result.metadata.recommended_action).toBe("repair_plan_route")

        await Session.remove(session.id)
      },
    })
  })

  test("semantic fingerprint ignores evidence wording but changes with the DAG", () => {
    const base = ProofPlan.parse({
      theorem: "demo",
      root_goal: "A /\\ B",
      nodes: [node()],
      edges: [],
      ready_nodes: ["leaf-1"],
      planner_contract: { marker_fields_required_for_lemma_delegation: [], note: "fixture" },
    })
    const metadataOnly = ProofPlan.parse({
      ...base,
      nodes: [{ ...base.nodes[0], candidate_lemmas: ["renamed_evidence"], source_excerpt: "longer prose" }],
    })
    const semanticChange = ProofPlan.parse({
      ...base,
      nodes: [{ ...base.nodes[0], formal_goal: "B" }],
    })

    expect(semanticPlanFingerprint(metadataOnly)).toBe(semanticPlanFingerprint(base))
    expect(semanticPlanFingerprint(semanticChange)).not.toBe(semanticPlanFingerprint(base))
  })

  test("keeps text extraction backward compatible and reports bounded convergence", async () => {
    const tool = await ProofPlanTool.init()
    const result = await tool.execute(
      { text: "First expose A.\nThen combine A with B.", theorem: "demo", root_goal: "A /\\ B" },
      context("proof-plan-text"),
    )

    expect(result.metadata.nodes).toHaveLength(2)
    expect(result.metadata.review?.max_semantic_revisions).toBe(4)
    expect(result.metadata.recommended_action).toBe("materialize_once")
  })

  test("places a rejected structured-plan verdict before the full payload", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/verdict-first.v`
        await Bun.write(file, "Lemma demo (A B : Prop) : A /\\ B.\nProof.\nAdmitted.\n")
        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        const tool = await ProofPlanTool.init()
        const result = await tool.execute(
          {
            theorem: "demo",
            root_goal: "A /\\ B",
            nodes: [node({ formal_goal: "A /\\ B", target_normal_form: "A /\\ B" })],
            edges: [],
          },
          context(session.id),
        )

        expect(result.output.startsWith("PROOF_PLAN_VERDICT\n")).toBe(true)
        expect(result.output).toContain("planning_status: planning")
        expect(result.output).toContain("review_status: reject")
        expect(result.output).toContain("materialization_allowed: false")
        expect(result.output.indexOf("review_status: reject")).toBeLessThan(
          result.output.indexOf("END_PROOF_PLAN_VERDICT"),
        )

        await Session.remove(session.id)
      },
    })
  })

  test("permits four semantic revisions while still bounding failed plan generation", async () => {
    const tool = await ProofPlanTool.init()
    const invalid = {
      theorem: "bounded-invalid",
      root_goal: "A /\\ B",
      nodes: [node({ formal_goal: "A /\\ B", target_normal_form: "A /\\ B" })],
      edges: [],
    }
    const first = await tool.execute(invalid, context("bounded-invalid"))
    const second = await tool.execute(
      { ...invalid, nodes: [node({ formal_goal: "A", consumers: [] })] },
      context("bounded-invalid"),
    )
    const third = await tool.execute(
      { ...invalid, nodes: [node({ formal_goal: "B", consumers: [] })] },
      context("bounded-invalid"),
    )
    const fourth = await tool.execute(
      { ...invalid, nodes: [node({ formal_goal: "A \\/ B", consumers: [] })] },
      context("bounded-invalid"),
    )
    const fifth = await tool.execute(
      { ...invalid, nodes: [node({ formal_goal: "B \\/ A", consumers: [] })] },
      context("bounded-invalid"),
    )

    expect(first.metadata.recommended_action).toBe("revise_semantic_dag")
    expect(second.metadata.semantic_revision_number).toBe(1)
    expect(second.metadata.revision_budget_exhausted).toBe(false)
    expect(second.metadata.recommended_action).toBe("revise_semantic_dag")
    expect(third.metadata.semantic_revision_number).toBe(2)
    expect(third.metadata.revision_budget_exhausted).toBe(false)
    expect(fourth.metadata.semantic_revision_number).toBe(3)
    expect(fourth.metadata.revision_budget_exhausted).toBe(false)
    expect(fifth.metadata.semantic_revision_number).toBe(4)
    expect(fifth.metadata.revision_budget_exhausted).toBe(true)
    expect(fifth.metadata.recommended_action).toBe("stop_and_report_best_plan")

    const repair = {
      theorem: "bounded-repair",
      root_goal: "A /\\ B",
      nodes: [node({ formal_goal: "A /\\ B", target_normal_form: "A /\\ B" })],
      edges: [],
    }
    await tool.execute(repair, context("bounded-repair"))
    const repaired = await tool.execute(
      { ...repair, nodes: [node({ formal_goal: "A", target_normal_form: "A" })] },
      context("bounded-repair"),
    )

    expect(repaired.metadata.semantic_revision_number).toBe(1)
    expect(repaired.metadata.revision_budget_exhausted).toBe(false)
    expect(repaired.metadata.recommended_action).toBe("materialize_once")
  })

  test("does not let route-only failures exceed the four-revision budget", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/route-budget.v`
        await Bun.write(file, "Lemma demo (A B : Prop) : A /\\ B.\nProof.\nAdmitted.\n")
        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        const tool = await ProofPlanTool.init()
        const submit = (id: string, goal: string) =>
          tool.execute(
            {
              theorem: "demo",
              root_goal: "A /\\ B",
              nodes: [
                node({
                  node_id: id,
                  paper_step_id: `step-${id}`,
                  formal_goal: goal,
                  target_normal_form: goal,
                  candidate_lemmas: [],
                  prosa_candidate_lemmas: [
                    {
                      name: "missing_candidate",
                      library: "prosa" as const,
                      reason: "exercise the route-only audit gate",
                      premise_sources: [],
                    },
                  ],
                  depends_on: [],
                  required_hypotheses: [],
                }),
              ],
              edges: [],
            },
            context(session.id),
          )

        const first = await submit("leaf-a", "A")
        const second = await submit("leaf-b", "B")
        const third = await submit("leaf-ab", "A \\/ B")
        const fourth = await submit("leaf-ba", "B \\/ A")
        const fifth = await submit("leaf-aa", "A /\\ A")
        const sixth = await submit("leaf-bb", "B /\\ B")

        expect(first.metadata.recommended_action).toBe("repair_plan_route")
        expect(second.metadata.recommended_action).toBe("repair_plan_route")
        expect(third.metadata.recommended_action).toBe("repair_plan_route")
        expect(third.metadata.semantic_revision_number).toBe(2)
        expect(fourth.metadata.recommended_action).toBe("repair_plan_route")
        expect(fifth.metadata.recommended_action).toBe("repair_plan_route")
        expect(fifth.metadata.semantic_revision_number).toBe(4)
        expect(sixth.metadata.recommended_action).toBe("start_new_plan_generation")
        expect(sixth.metadata.revision_budget_exhausted).toBe(true)
        expect(sixth.metadata.terminal_verdict?.recoverable).toBe(true)
        expect(
          SessionProofWorkflow.getDecompositionPlanState(session.id, file)?.attempted_semantic_fingerprints,
        ).toHaveLength(5)

        await Session.remove(session.id)
      },
    })
  })

  test("binds proof-plan review to the active staged skeleton", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/staged-plan-source.v`
        const diskSource = "Lemma demo (A B : Prop) : A /\\ B.\nProof.\nAdmitted.\n"
        const stagedSource = [
          "Lemma demo (A B : Prop) : A /\\ B.",
          "Proof.",
          "(* proof_region begin owner: lemma admit_id: gap-a theorem: demo kind: semantic_bridge target: Ha plan_node: leaf-1 depends_on: none source: context-derived input: A output: Ha layer: semantic expected: local_fact normal_form: \"A\" evidence: mathcomp:I *)",
          "have Ha : A. { admit. }",
          "(* proof_region end admit_id: gap-a *)",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, diskSource)
        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        await ProofEditTransaction.begin({
          sessionID: session.id,
          parentSessionID: session.id,
          agent: "prover",
          file,
          source: diskSource,
          scope: { kind: "theorem_body", theorem: "demo" },
        })
        ProofEditTransaction.stage({
          sessionID: session.id,
          file,
          before: diskSource,
          after: stagedSource,
        })

        const tool = await ProofPlanTool.init()
        const accepted = await tool.execute(
          {
            theorem: "demo",
            root_goal: "A /\\ B",
            nodes: [node({ depends_on: [], required_hypotheses: [], target_normal_form: "A" })],
            edges: [],
          },
          context(session.id),
        )

        expect(accepted.metadata.recommended_action).toBe("materialize_once")
        const state = SessionProofWorkflow.getDecompositionPlanState(session.id, file)
        expect(state?.source_hash_before_materialization).toBe(
          createHash("sha256").update(stagedSource).digest("hex"),
        )
        expect(state?.source_hash_before_materialization).not.toBe(
          createHash("sha256").update(diskSource).digest("hex"),
        )
        expect(await Bun.file(file).text()).toBe(diskSource)

        ProofEditTransaction.abort(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("persists and locks an accepted plan instead of accepting a replacement split", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/plan-lock.v`
        await Bun.write(file, "Lemma demo (A B : Prop) : A /\\ B.\nProof.\nAdmitted.\n")
        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        const tool = await ProofPlanTool.init()
        const accepted = await tool.execute(
          {
            theorem: "demo",
            root_goal: "A /\\ B",
            nodes: [node({ depends_on: [], required_hypotheses: [], target_normal_form: "A" })],
            edges: [],
          },
          context(session.id),
        )
        const replacement = await tool.execute(
          {
            theorem: "demo_rephrased",
            root_goal: "B /\\ A",
            nodes: [
              node({
                node_id: "leaf-2",
                formal_goal: "B",
                paper_claim: "Prove a different strict intermediate fact.",
                claim_delta: "Replace A /\\ B with the strict child B.",
                depends_on: [],
                required_hypotheses: [],
                target_normal_form: "B",
              }),
            ],
            edges: [],
          },
          context(session.id),
        )

        expect(accepted.metadata.planning_status).toBe("accepted")
        expect(accepted.metadata.recommended_action).toBe("materialize_once")
        expect(replacement.metadata.accepted_plan_locked).toBe(true)
        expect(replacement.metadata.recommended_action).toBe("materialize_accepted_plan")
        expect(replacement.metadata.nodes[0]?.node_id).toBe("leaf-1")
        expect(SessionProofWorkflow.getDecompositionPlanState(session.id, file)?.accepted_plan?.nodes[0]?.node_id).toBe(
          "leaf-1",
        )

        await Session.remove(session.id)
      },
    })
  })

  test("exhausts repeated rejected plans and recomputes materialization review per theorem source", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/bounded-materialization.v`
        const initial = "Lemma demo (A B : Prop) : A /\\ B.\nProof.\nAdmitted.\n"
        await Bun.write(file, initial)
        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        const tool = await ProofPlanTool.init()
        const rejectedInput = {
          theorem: "demo",
          root_goal: "A /\\ B",
          nodes: [node({ formal_goal: "A /\\ B", target_normal_form: "A /\\ B" })],
          edges: [],
        }
        await tool.execute(rejectedInput, context(session.id))
        const repeated = await tool.execute(rejectedInput, context(session.id))
        const recovered = await tool.execute(
          {
            theorem: "demo",
            root_goal: "A /\\ B",
            nodes: [node({ depends_on: [], required_hypotheses: [], target_normal_form: "A" })],
            edges: [],
          },
          context(session.id),
        )

        expect(repeated.metadata.planning_status).toBe("exhausted")
        expect(repeated.metadata.recommended_action).toBe("start_new_plan_generation")
        expect(repeated.metadata.terminal_verdict?.recoverable).toBe(true)
        expect(recovered.metadata.recommended_action).toBe("materialize_once")
        expect(recovered.metadata.planning_generation).toBe(1)
        expect(SessionProofWorkflow.getDecompositionPlanState(session.id, file)?.accepted_plan).toBeDefined()

        SessionProofWorkflow.clear(session.id)
        await Bun.write(file, initial)
        SessionProofWorkflow.refresh(session.id, file, initial)
        const accepted = await tool.execute(
          {
            theorem: "demo",
            root_goal: "A /\\ B",
            nodes: [node({ depends_on: [], required_hypotheses: [], target_normal_form: "A" })],
            edges: [],
          },
          context(session.id),
        )
        expect(accepted.metadata.recommended_action).toBe("materialize_once")

        const materialized = [
          "Lemma demo (A B : Prop) : A /\\ B.",
          "Proof.",
          "(* proof_region begin owner: lemma admit_id: gap-a theorem: demo kind: semantic_bridge target: Hleaf plan_node: leaf-1 depends_on: none source: context-derived input: A output: Hleaf layer: semantic expected: local_fact normal_form: \"A\" evidence: mathcomp:I *)",
          "have Hleaf : A.",
          "{ admit. }",
          "(* proof_region end admit_id: gap-a *)",
          "split; first exact Hleaf.",
          "admit.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, materialized)
        const reviewed = SessionProofWorkflow.refresh(session.id, file, materialized).state.decomposition_plan
          ?.materialization_review
        expect(reviewed?.status).toBe("matched")
        expect(reviewed?.missing_plan_nodes).toEqual([])
        expect(SessionProofWorkflow.classifyDecompositionCheckpoint(session.id, file, materialized).status).toBe(
          "ready",
        )
        expect((await SessionProofWorkflow.suggestNextSubtask(session.id, []))?.task.lemma_assignment?.admit_id).toBe(
          "gap-a",
        )

        const changedAfterReview = materialized.replace("plan_node: leaf-1", "plan_node: replacement-node")
        await Bun.write(file, changedAfterReview)
        const drifted = SessionProofWorkflow.refresh(session.id, file, changedAfterReview).state.decomposition_plan
          ?.materialization_review
        expect(drifted?.status).toBe("drifted")
        expect(drifted?.missing_plan_nodes).toEqual(["leaf-1"])
        expect(drifted?.unexpected_regions).toEqual(["gap-a"])
        expect(await SessionProofWorkflow.suggestNextSubtask(session.id, [])).toBeUndefined()

        await Bun.write(file, materialized)
        const reconciledState = SessionProofWorkflow.refresh(session.id, file, materialized).state.decomposition_plan
        expect(reconciledState?.materialization_review?.status).toBe("matched")
        expect(reconciledState?.administrative_reconciliation_count).toBe(1)
        expect((await SessionProofWorkflow.suggestNextSubtask(session.id, []))?.task.lemma_assignment?.admit_id).toBe(
          "gap-a",
        )

        await Session.remove(session.id)
      },
    })
  })

  test("allows one evidence-backed accepted-plan repair revision and locks the replacement", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/accepted-repair.v`
        const initial = "Lemma demo (A B : Prop) : A /\\ B.\nProof.\nAdmitted.\n"
        await Bun.write(file, initial)
        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        const tool = await ProofPlanTool.init()
        await tool.execute(
          {
            theorem: "demo",
            root_goal: "A /\\ B",
            nodes: [node({ depends_on: [], required_hypotheses: [], target_normal_form: "A" })],
            edges: [],
          },
          context(session.id),
        )

        const materialized = [
          "Lemma demo (A B : Prop) : A /\\ B.",
          "Proof.",
          "(* proof_region begin owner: lemma admit_id: gap-a theorem: demo kind: semantic_bridge target: Ha plan_node: leaf-1 depends_on: none source: context-derived input: A output: Ha layer: semantic expected: local_fact normal_form: \"A\" evidence: mathcomp:I *)",
          "have Ha : A. { admit. }",
          "(* proof_region end admit_id: gap-a *)",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, materialized)
        const state = SessionProofWorkflow.refresh(session.id, file, materialized).state
        SessionProofWorkflow.set(session.id, {
          ...state,
          queue: state.queue.map((item) => ({
            ...item,
            status: "escalated" as const,
            escalation_type: "needs_subgoal_remodel" as const,
            escalation_reason: "the accepted leaf contract is too strong after compiler inspection",
          })),
          updated: Date.now(),
        })

        const replacement = await tool.execute(
          {
            theorem: "demo",
            root_goal: "A /\\ B",
            nodes: [
              node({
                node_id: "leaf-2",
                paper_step_id: "step-2",
                formal_goal: "B",
                paper_claim: "Use the compiler-backed weaker local contract.",
                claim_delta: "Replace the failed child A with child B.",
                depends_on: [],
                required_hypotheses: [],
                target_normal_form: "B",
              }),
            ],
            edges: [],
          },
          context(session.id),
        )
        expect(replacement.metadata.recommended_action).toBe("materialize_once")
        expect(replacement.metadata.nodes[0]?.node_id).toBe("leaf-2")
        expect(SessionProofWorkflow.getDecompositionPlanState(session.id, file)?.repair_revision_number).toBe(1)
        expect(SessionProofWorkflow.getDecompositionPlanState(session.id, file)?.materialization_review).toBeUndefined()
        expect(SessionProofWorkflow.get(session.id)?.queue).toEqual([])

        const secondReplacement = await tool.execute(
          {
            theorem: "demo",
            root_goal: "A /\\ B",
            nodes: [
              node({
                node_id: "leaf-3",
                paper_step_id: "step-3",
                formal_goal: "A",
                depends_on: [],
                required_hypotheses: [],
                target_normal_form: "A",
              }),
            ],
            edges: [],
          },
          context(session.id),
        )
        expect(secondReplacement.metadata.accepted_plan_locked).toBe(true)
        expect(secondReplacement.metadata.nodes[0]?.node_id).toBe("leaf-2")

        await Session.remove(session.id)
      },
    })
  })

  test("keeps an accepted-plan repair open for route-only corrections on the same replacement DAG", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/accepted-route-repair.v`
        const initial = [
          "Axiom supporting_fact : forall A B : Prop, A -> B -> B.",
          "Lemma demo (A B : Prop) (HA : A) : A /\\ B.",
          "Proof.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, initial)
        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 1, character: 0 }, "manual")
        const tool = await ProofPlanTool.init()
        await tool.execute(
          {
            theorem: "demo",
            root_goal: "A /\\ B",
            nodes: [
              node({
                candidate_lemmas: [],
                depends_on: [],
                required_hypotheses: [],
                target_normal_form: "A",
              }),
            ],
            edges: [],
          },
          context(session.id),
        )

        const materialized = [
          "Axiom supporting_fact : forall A B : Prop, A -> B -> B.",
          "Lemma demo (A B : Prop) (HA : A) : A /\\ B.",
          "Proof.",
          "(* proof_region begin owner: lemma admit_id: gap-a theorem: demo kind: semantic_bridge target: Ha plan_node: leaf-1 depends_on: none source: context-derived input: HA output: Ha layer: semantic expected: local_fact normal_form: \"A\" evidence: local:HA *)",
          "have Ha : A. { admit. }",
          "(* proof_region end admit_id: gap-a *)",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, materialized)
        const state = SessionProofWorkflow.refresh(session.id, file, materialized).state
        SessionProofWorkflow.set(session.id, {
          ...state,
          queue: state.queue.map((item) => ({
            ...item,
            status: "escalated" as const,
            escalation_type: "needs_subgoal_remodel" as const,
            escalation_reason: "compiler evidence requires a different local target",
          })),
          updated: Date.now(),
        })

        const replacementNode = node({
          node_id: "leaf-2",
          paper_step_id: "step-2",
          formal_goal: "B",
          paper_claim: "Use a different compiler-backed local target.",
          claim_delta: "Replace child A with child B.",
          candidate_lemmas: [],
          depends_on: [],
          required_hypotheses: [],
          target_normal_form: "B",
        })
        const rejected = await tool.execute(
          {
            theorem: "demo",
            root_goal: "A /\\ B",
            nodes: [
              {
                ...replacementNode,
                prosa_candidate_lemmas: [
                  {
                    name: "supporting_fact",
                    library: "prosa" as const,
                    reason: "candidate requires a premise audit",
                    premise_sources: [],
                  },
                ],
              },
            ],
            edges: [],
          },
          context(session.id),
        )

        expect(rejected.metadata.recommended_action).toBe("repair_plan_route")
        expect(rejected.metadata.nodes[0]?.node_id).toBe("leaf-2")
        expect(rejected.metadata.review?.hard_errors.map((entry) => entry.code)).toContain(
          "candidate_unresolved_premise",
        )
        const eligibility = SessionProofWorkflow.getAcceptedPlanRepairEligibility(session.id, file, materialized)
        expect(eligibility.available).toBe(true)
        expect(eligibility.mode).toBe("route_repair")

        const corrected = await tool.execute(
          {
            theorem: "demo",
            root_goal: "A /\\ B",
            nodes: [{ ...replacementNode, prosa_candidate_lemmas: [] }],
            edges: [],
          },
          context(session.id),
        )
        expect(corrected.metadata.recommended_action).toBe("materialize_once")
        expect(corrected.metadata.nodes[0]?.node_id).toBe("leaf-2")
        expect(SessionProofWorkflow.getDecompositionPlanState(session.id, file)?.repair_revision_number).toBe(1)

        await Session.remove(session.id)
      },
    })
  })

  test("reuses an already matching skeleton after an accepted-plan repair revision", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/accepted-repair-existing-skeleton.v`
        const initial = "Lemma demo (A B : Prop) : A /\\ B.\nProof.\nAdmitted.\n"
        await Bun.write(file, initial)
        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        const tool = await ProofPlanTool.init()
        await tool.execute(
          {
            theorem: "demo",
            root_goal: "A /\\ B",
            nodes: [
              node({
                depends_on: [],
                required_hypotheses: [],
                consumers: ["parent_composition"],
                target_normal_form: "A",
              }),
            ],
            edges: [],
          },
          context(session.id),
        )

        const materialized = [
          "Lemma demo (A B : Prop) : A /\\ B.",
          "Proof.",
          "(* proof_region begin owner: lemma admit_id: gap-a theorem: demo kind: semantic_bridge target: Ha plan_node: leaf-1 depends_on: none source: context-derived input: A output: Ha layer: semantic expected: local_fact normal_form: \"A\" evidence: mathcomp:I *)",
          "have Ha : A.",
          "{ admit. }",
          "(* proof_region end admit_id: gap-a *)",
          "admit.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, materialized)
        const state = SessionProofWorkflow.refresh(session.id, file, materialized).state
        expect(state.decomposition_plan?.materialization_review?.status).toBe("matched")
        SessionProofWorkflow.set(session.id, {
          ...state,
          queue: state.queue.map((item) => ({
            ...item,
            status: "escalated" as const,
            escalation_type: "needs_subgoal_remodel" as const,
            escalation_reason: "compiler evidence requires revising the accepted DAG",
          })),
          updated: Date.now(),
        })

        const replacement = await tool.execute(
          {
            theorem: "demo",
            root_goal: "A /\\ B",
            nodes: [
              node({
                depends_on: [],
                required_hypotheses: [],
                consumers: ["theorem"],
                target_normal_form: "A",
              }),
            ],
            edges: [],
          },
          context(session.id),
        )
        expect(replacement.metadata.recommended_action).toBe("materialize_once")
        expect(SessionProofWorkflow.getDecompositionPlanState(session.id, file)?.materialization_review?.status).toBe(
          "matched",
        )

        const refreshed = SessionProofWorkflow.refresh(session.id, file, materialized).state
        expect(refreshed.queue.map((item) => item.admit_id)).toEqual(["gap-a"])
        expect((await SessionProofWorkflow.suggestNextSubtask(session.id, []))?.task.lemma_assignment?.admit_id).toBe(
          "gap-a",
        )

        await Session.remove(session.id)
      },
    })
  })

  test("does not close materialization when only another theorem changes", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/theorem-scoped-materialization.v`
        const target = [
          "Lemma demo (A B : Prop) : A /\\ B.",
          "Proof.",
          "(* proof_region begin owner: lemma admit_id: gap-a theorem: demo kind: semantic_bridge target: Ha plan_node: leaf-1 depends_on: none source: context-derived input: A output: Ha layer: semantic expected: local_fact normal_form: \"A\" evidence: mathcomp:I *)",
          "have Ha : A. { admit. }",
          "(* proof_region end admit_id: gap-a *)",
          "Admitted.",
        ].join("\n")
        const initial = `${target}\nLemma helper : True.\nProof. exact I. Qed.\n`
        await Bun.write(file, initial)
        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        const tool = await ProofPlanTool.init()
        await tool.execute(
          {
            theorem: "demo",
            root_goal: "A /\\ B",
            nodes: [node({ depends_on: [], required_hypotheses: [], target_normal_form: "A" })],
            edges: [],
          },
          context(session.id),
        )

        const helperOnlyChange = `${target}\nLemma helper : True.\nProof. idtac; exact I. Qed.\n`
        await Bun.write(file, helperOnlyChange)
        const refreshed = SessionProofWorkflow.refresh(session.id, file, helperOnlyChange).state.decomposition_plan
        expect(refreshed?.materialization_review).toBeUndefined()
        expect(
          SessionProofWorkflow.previewDecompositionMaterialization(session.id, file, helperOnlyChange)?.review,
        ).toBeUndefined()

        await Session.remove(session.id)
      },
    })
  })

  test("keeps a bound text extraction as an unlocked draft until structured nodes are submitted", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/text-draft.v`
        await Bun.write(file, "Lemma demo (A B : Prop) : A /\\ B.\nProof.\nAdmitted.\n")
        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        const tool = await ProofPlanTool.init()
        const draft = await tool.execute(
          { text: "First expose A.\nThen combine it with B.", theorem: "demo", root_goal: "A /\\ B" },
          context(session.id),
        )

        expect(draft.metadata.planning_status).toBe("draft")
        expect(draft.metadata.recommended_action).toBe("submit_structured_plan")
        expect(SessionProofWorkflow.getDecompositionPlanState(session.id, file)).toBeUndefined()

        const accepted = await tool.execute(
          {
            theorem: "demo",
            root_goal: "A /\\ B",
            nodes: [node({ depends_on: [], required_hypotheses: [], target_normal_form: "A" })],
            edges: [],
          },
          context(session.id),
        )
        expect(accepted.metadata.planning_status).toBe("accepted")
        await Session.remove(session.id)
      },
    })
  })

  test("does not record the one-time review until every expected leaf is present", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/incomplete-materialization.v`
        const initial = "Lemma demo (A B : Prop) : A /\\ B.\nProof.\nAdmitted.\n"
        await Bun.write(file, initial)
        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        const tool = await ProofPlanTool.init()
        await tool.execute(
          {
            theorem: "demo",
            root_goal: "A /\\ B",
            nodes: [
              node({ node_id: "leaf-a", paper_step_id: "step-a", formal_goal: "A", target_normal_form: "A" }),
              node({ node_id: "leaf-b", paper_step_id: "step-b", formal_goal: "B", target_normal_form: "B" }),
            ],
            edges: [],
          },
          context(session.id),
        )
        const duplicateOnly = [
          "Lemma demo (A B : Prop) : A /\\ B.",
          "Proof.",
          "(* proof_region begin owner: lemma admit_id: gap-a1 theorem: demo kind: semantic_bridge target: Ha1 plan_node: leaf-a depends_on: HA source: context-derived input: A output: Ha1 layer: semantic expected: local_fact normal_form: \"A\" evidence: mathcomp:I *)",
          "have Ha1 : A. { admit. }",
          "(* proof_region end admit_id: gap-a1 *)",
          "(* proof_region begin owner: lemma admit_id: gap-a2 theorem: demo kind: semantic_bridge target: Ha2 plan_node: leaf-a depends_on: HA source: context-derived input: A output: Ha2 layer: semantic expected: local_fact normal_form: \"A\" evidence: mathcomp:I *)",
          "have Ha2 : A. { admit. }",
          "(* proof_region end admit_id: gap-a2 *)",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, duplicateOnly)
        const refreshed = SessionProofWorkflow.refresh(session.id, file, duplicateOnly).state.decomposition_plan
        const preview = SessionProofWorkflow.previewDecompositionMaterialization(session.id, file, duplicateOnly)
        expect(refreshed?.materialization_review).toBeUndefined()
        expect(preview?.missing_plan_nodes).toEqual(["leaf-b"])
        expect(preview?.duplicate_plan_nodes).toEqual(["leaf-a"])
        await Session.remove(session.id)
      },
    })
  })

  test("blocks fresh lemma dispatch when any region is outside the accepted plan", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/dispatch-gate.v`
        const initial = "Lemma demo (A B : Prop) : A /\\ B.\nProof.\nAdmitted.\n"
        await Bun.write(file, initial)
        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        const tool = await ProofPlanTool.init()
        await tool.execute(
          {
            theorem: "demo",
            root_goal: "A /\\ B",
            nodes: [node({ node_id: "leaf-a", paper_step_id: "step-a", target_normal_form: "A" })],
            edges: [],
          },
          context(session.id),
        )
        const source = [
          "Lemma demo (A B : Prop) : A /\\ B.",
          "Proof.",
          "(* proof_region begin owner: lemma admit_id: gap-a theorem: demo kind: semantic_bridge target: Ha plan_node: leaf-a depends_on: HA source: context-derived input: A output: Ha layer: semantic expected: local_fact normal_form: \"A\" evidence: mathcomp:I *)",
          "have Ha : A. { admit. }",
          "(* proof_region end admit_id: gap-a *)",
          "(* proof_region begin owner: lemma admit_id: rogue theorem: demo kind: semantic_bridge target: Hrogue plan_node: not-in-plan depends_on: HA source: context-derived input: B output: Hrogue layer: semantic expected: local_fact normal_form: \"B\" evidence: mathcomp:I *)",
          "have Hrogue : B. { admit. }",
          "(* proof_region end admit_id: rogue *)",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)
        const refreshed = SessionProofWorkflow.refresh(session.id, file, source).state.decomposition_plan
        expect(refreshed?.materialization_review?.status).toBe("drifted")
        expect(refreshed?.materialization_review?.unexpected_regions).toEqual(["rogue"])
        expect(await SessionProofWorkflow.suggestNextSubtask(session.id, [])).toBeUndefined()
        const workflow = SessionProofWorkflow.get(session.id)!
        SessionProofWorkflow.set(session.id, {
          ...workflow,
          queue: workflow.queue.map((item) =>
            item.admit_id === "gap-a"
              ? {
                  ...item,
                  status: "escalated" as const,
                  escalation_type: "needs_subgoal_remodel" as const,
                  escalation_reason: "compiler evidence requires a different proof DAG",
                }
              : item,
          ),
          updated: Date.now(),
        })
        await expect(
          SessionProofWorkflow.assertProofTaskDispatchAllowed({
            sessionID: session.id,
            subagentType: "lemma",
            proofProducing: true,
            lemmaAssignment: { file, theorem: "demo", admit_id: "gap-a" } as any,
          }),
        ).rejects.toThrow("call proof_plan with the one evidence-backed structural repair revision")
        await Session.remove(session.id)
      },
    })
  })

  test("retains a solved region for an accepted non-delegated setup node", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/solved-setup-region.v`
        const initial = "Lemma demo (A B : Prop) (HA : A) : A /\\ B.\nProof.\nAdmitted.\n"
        await Bun.write(file, initial)
        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        const tool = await ProofPlanTool.init()
        const setup = node({
          node_id: "setup",
          paper_step_id: "setup-step",
          formal_goal: "A",
          target_normal_form: "A",
          delegation_candidate: false,
          depends_on: [],
          required_hypotheses: ["HA"],
          consumers: ["leaf-b"],
        })
        const leaf = node({
          node_id: "leaf-b",
          paper_step_id: "leaf-step",
          formal_goal: "B",
          target_normal_form: "B",
          depends_on: ["setup"],
          required_hypotheses: [],
        })
        await tool.execute(
          {
            theorem: "demo",
            root_goal: "A /\\ B",
            nodes: [setup, leaf],
            edges: [{ from: "setup", to: "leaf-b" }],
          },
          context(session.id),
        )
        const source = [
          "Lemma demo (A B : Prop) (HA : A) : A /\\ B.",
          "Proof.",
          "(* proof_region begin owner: lemma admit_id: setup-gap theorem: demo kind: semantic_bridge target: Hsetup plan_node: setup depends_on: none source: context input: HA output: Hsetup layer: semantic expected: local normal_form: \"A\" evidence: coq:exact *)",
          "have Hsetup : A. { exact HA. }",
          "(* proof_region end admit_id: setup-gap *)",
          "(* proof_region begin owner: lemma admit_id: gap-b theorem: demo kind: semantic_bridge target: HB plan_node: leaf-b depends_on: setup source: context input: Hsetup output: HB layer: semantic expected: local normal_form: \"B\" evidence: mathcomp:I *)",
          "have HB : B. { admit. }",
          "(* proof_region end admit_id: gap-b *)",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, source)
        const refreshed = SessionProofWorkflow.refresh(session.id, file, source).state.decomposition_plan
        expect(refreshed?.materialization_review?.unexpected_regions).toEqual([])
        expect(refreshed?.materialization_review?.status).toBe("matched")
        await Session.remove(session.id)
      },
    })
  })

  test("anchors materialization source hash when the revised plan is accepted", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/acceptance-source.v`
        const initial = "Lemma demo (A B : Prop) : A /\\ B.\nProof.\nAdmitted.\n"
        await Bun.write(file, initial)
        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        const tool = await ProofPlanTool.init()
        await tool.execute(
          {
            theorem: "demo",
            root_goal: "A /\\ B",
            nodes: [node({ formal_goal: "A /\\ B", target_normal_form: "A /\\ B" })],
            edges: [],
          },
          context(session.id),
        )
        const preacceptedSource = [
          "Lemma demo (A B : Prop) : A /\\ B.",
          "Proof.",
          "(* proof_region begin owner: lemma admit_id: gap-a theorem: demo kind: semantic_bridge target: Ha plan_node: leaf-a depends_on: none source: context-derived input: A output: Ha layer: semantic expected: local_fact normal_form: \"A\" evidence: mathcomp:I *)",
          "have Ha : A. { admit. }",
          "(* proof_region end admit_id: gap-a *)",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, preacceptedSource)
        const accepted = await tool.execute(
          {
            theorem: "demo",
            root_goal: "A /\\ B",
            nodes: [
              node({
                node_id: "leaf-a",
                paper_step_id: "step-a",
                depends_on: [],
                required_hypotheses: [],
                target_normal_form: "A",
              }),
            ],
            edges: [],
          },
          context(session.id),
        )
        expect(accepted.metadata.planning_status).toBe("accepted")
        expect(
          SessionProofWorkflow.previewDecompositionMaterialization(session.id, file, preacceptedSource)?.review,
        ).toBeUndefined()
        await Session.remove(session.id)
      },
    })
  })

  test("scopes existing proof regions to the theorem at the proof binding", () => {
    const source = [
      "Lemma first (A : Prop) : A.",
      "Proof.",
      "(* proof_region begin owner: lemma admit_id: first-gap theorem: first kind: semantic_bridge target: Hfirst plan_node: first-leaf depends_on: none source: context input: A output: Hfirst layer: semantic expected: local normal_form: \"A\" evidence: mathcomp:I *)",
      "have Hfirst : A. { admit. }",
      "(* proof_region end admit_id: first-gap *)",
      "Admitted.",
      "Lemma second (B : Prop) : B.",
      "Proof.",
      "Admitted.",
    ].join("\n")
    const theorem = SessionProofWorkflow.theoremAtProofPosition(source, { line: 6, character: 0 })
    expect(theorem).toBe("second")
    expect(SessionProofWorkflow.hasProofRegionsForTheorem(source, theorem)).toBe(false)
    expect(SessionProofWorkflow.hasProofRegionsForTheorem(source, "first")).toBe(true)
  })

  test("rejects a bound plan whose submitted theorem or root goal disagrees with the source", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/bound-anchor.v`
        await Bun.write(file, "Lemma actual (A B : Prop) : A /\\ B.\nProof.\nAdmitted.\n")
        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        const tool = await ProofPlanTool.init()
        const result = await tool.execute(
          {
            theorem: "typo_theorem",
            root_goal: "B /\\ A",
            nodes: [node({ depends_on: [], required_hypotheses: [], target_normal_form: "A" })],
            edges: [],
          },
          context(session.id),
        )

        expect(result.metadata.planning_status).toBe("planning")
        expect(result.metadata.theorem).toBe("actual")
        expect(result.metadata.root_goal).toBe("A /\\ B")
        expect(result.metadata.review?.hard_errors.map((entry) => entry.code)).toEqual(
          expect.arrayContaining(["bound_theorem_mismatch", "bound_root_goal_mismatch"]),
        )
        expect(SessionProofWorkflow.getDecompositionPlanState(session.id, file)?.status).toBe("planning")
        await Session.remove(session.id)
      },
    })
  })

  test("accepts harmless parentheses and a trailing terminator in a bound root goal", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/bound-root-formatting.v`
        await Bun.write(file, "Lemma actual (A B : Prop) : A /\\ B.\nProof.\nAdmitted.\n")
        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        const tool = await ProofPlanTool.init()
        const result = await tool.execute(
          {
            theorem: "actual",
            root_goal: "(A /\\ B).",
            nodes: [
              node({
                formal_goal: "A",
                target_normal_form: "A",
                depends_on: [],
                required_hypotheses: [],
              }),
            ],
            edges: [],
          },
          context(session.id),
        )

        expect(result.metadata.review?.hard_errors.map((entry) => entry.code)).not.toContain(
          "bound_root_goal_mismatch",
        )
        expect(result.metadata.planning_status).toBe("accepted")
        await Session.remove(session.id)
      },
    })
  })

  test("accepts harmless binder colon whitespace in a bound root goal", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/bound-root-binder-formatting.v`
        await Bun.write(
          file,
          "Lemma actual : forall (j: Job) a b, P j a b.\nProof.\nAdmitted.\n",
        )
        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        const tool = await ProofPlanTool.init()
        const result = await tool.execute(
          {
            theorem: "actual",
            root_goal: "forall (j : Job) a b, P j a b",
            nodes: [
              node({
                formal_goal: "P j a b",
                target_normal_form: "P j a b",
                depends_on: [],
                required_hypotheses: [],
              }),
            ],
            edges: [],
          },
          context(session.id),
        )

        expect(result.metadata.review?.hard_errors.map((entry) => entry.code)).not.toContain(
          "bound_root_goal_mismatch",
        )
        expect(result.metadata.planning_status).toBe("accepted")
        await Session.remove(session.id)
      },
    })
  })

  test("rebinding within one file starts a theorem-local plan instead of reusing the old lock", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/rebind-plan.v`
        await Bun.write(
          file,
          [
            "Lemma first (A B : Prop) : A /\\ B.",
            "Proof.",
            "Admitted.",
            "Lemma second (C D : Prop) : C /\\ D.",
            "Proof.",
            "Admitted.",
            "",
          ].join("\n"),
        )
        const session = await Session.create({})
        const tool = await ProofPlanTool.init()
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        const first = await tool.execute(
          {
            theorem: "first",
            root_goal: "A /\\ B",
            nodes: [node({ depends_on: [], required_hypotheses: [], target_normal_form: "A" })],
            edges: [],
          },
          context(session.id),
        )
        expect(first.metadata.planning_status).toBe("accepted")

        SessionProof.set(session.id, file, { line: 3, character: 0 }, "manual")
        const second = await tool.execute(
          {
            theorem: "second",
            root_goal: "C /\\ D",
            nodes: [
              node({
                node_id: "leaf-c",
                paper_step_id: "step-c",
                formal_goal: "C",
                target_normal_form: "C",
                depends_on: [],
                required_hypotheses: [],
              }),
            ],
            edges: [],
          },
          context(session.id),
        )

        expect(second.metadata.planning_status).toBe("accepted")
        expect(second.metadata.accepted_plan_locked).toBe(false)
        expect(second.metadata.theorem).toBe("second")
        expect(SessionProofWorkflow.getDecompositionPlanState(session.id, file)?.theorem).toBe("second")
        await Session.remove(session.id)
      },
    })
  })

  test("applies the live accepted-plan gate to manual and resumed lemma dispatch", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/dispatch-gate.v`
        const initial = "Lemma demo (A B : Prop) : A /\\ B.\nProof.\nAdmitted.\n"
        await Bun.write(file, initial)
        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        const tool = await ProofPlanTool.init()
        await tool.execute(
          {
            theorem: "demo",
            root_goal: "A /\\ B",
            nodes: [
              node({
                node_id: "leaf-a",
                paper_step_id: "step-a",
                depends_on: [],
                required_hypotheses: [],
                target_normal_form: "A",
              }),
            ],
            edges: [],
          },
          context(session.id),
        )

        const rogue = [
          "Lemma demo (A B : Prop) : A /\\ B.",
          "Proof.",
          "(* proof_region begin owner: lemma admit_id: rogue theorem: demo kind: semantic_bridge target: HB plan_node: not-in-plan depends_on: none source: context input: B output: HB layer: semantic expected: local normal_form: \"B\" evidence: mathcomp:I *)",
          "have HB : B. { admit. }",
          "(* proof_region end admit_id: rogue *)",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, rogue)
        await expect(
          SessionProofWorkflow.assertFreshLemmaAssignmentLocality(session.id, file, { admit_id: "rogue" }),
        ).rejects.toThrow("accepted plan materialization")

        const clean = [
          "Lemma demo (A B : Prop) : A /\\ B.",
          "Proof.",
          "(* proof_region begin owner: lemma admit_id: gap-a theorem: demo kind: semantic_bridge target: HA plan_node: leaf-a depends_on: none source: context input: A output: HA layer: semantic expected: local normal_form: \"A\" evidence: mathcomp:I *)",
          "have HA : A. { admit. }",
          "(* proof_region end admit_id: gap-a *)",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, clean)
        const state = SessionProofWorkflow.refresh(session.id, file, clean).state
        const cleanSuggestion = await SessionProofWorkflow.suggestNextSubtask(session.id, [])
        const resumeAssignment = cleanSuggestion?.task.lemma_assignment
        expect(resumeAssignment?.admit_id).toBe("gap-a")
        SessionProofWorkflow.set(session.id, {
          ...state,
          queue: state.queue.map((item) => ({ ...item, status: "split" as const, task_id: "resume-task" })),
          active_admit_id: "gap-a",
          active_task_id: "resume-task",
          updated: Date.now(),
        })
        const drifted = clean.replace(
          "Admitted.",
          [
            "(* proof_region begin owner: lemma admit_id: rogue theorem: demo kind: semantic_bridge target: HB plan_node: not-in-plan depends_on: none source: context input: B output: HB layer: semantic expected: local normal_form: \"B\" evidence: mathcomp:I *)",
            "have HB : B. { admit. }",
            "(* proof_region end admit_id: rogue *)",
            "Admitted.",
          ].join("\n"),
        )
        await Bun.write(file, drifted)
        expect(await SessionProofWorkflow.suggestNextSubtask(session.id, [])).toBeUndefined()
        await expect(
          SessionProofWorkflow.assertProofTaskDispatchAllowed({
            sessionID: session.id,
            subagentType: "lemma",
            proofProducing: true,
            lemmaAssignment: resumeAssignment,
          }),
        ).rejects.toThrow("unexpected_regions=[rogue]")
        await Session.remove(session.id)
      },
    })
  })

  test("hard-rejects verified cross-session route reuse before materialization", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/route-ledger.v`
        const theoremSource = [
          "Axiom supporting_fact : forall A B : Prop, A -> B -> B.",
          "Lemma demo (A B : Prop) (HA : A) : A /\\ B.",
          "Proof.",
          "Admitted.",
          "",
        ].join("\n")
        await Bun.write(file, theoremSource)
        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 0, character: 0 }, "manual")
        const candidate = {
          name: "supporting_fact",
          library: "prosa" as const,
          reason: "reuses the previously failed audited route",
          premise_sources: [],
        }
        const audit = await auditCandidateLemma({
          file,
          source: theoremSource,
          theorem: "demo",
          formalGoal: "B",
          candidate,
        })
        expect(audit.verdict).toBe("bridge_required")
        expect(audit.residual_premises.length).toBeGreaterThan(0)
        const receipt = ProofRouteLedger.recordRouteFailure({
          workspace: tmp.path,
          file,
          theorem: "demo",
          theorem_context_fingerprint: ProofRouteLedger.theoremContextFingerprint(theoremSource, "demo"),
          node_id: "leaf-1",
          target_contract_fingerprint: ProofRouteLedger.targetContractFingerprint("B"),
          kind: "lemma_missing_premise",
          failed_lemma: "supporting_fact",
          missing_premises: audit.residual_premises,
          missing_premise_fingerprints: audit.residual_premise_fingerprints,
          route_summary: "supporting_fact was previously selected without its required premise",
          evidence: "verified interface inspection and a failed local derivation",
          confidence: "verified",
          recommended_action: "prove_missing_premise",
        })
        const tool = await ProofPlanTool.init()
        const input = {
          theorem: "demo",
          root_goal: "A /\\ B",
          nodes: [
            node({
              depends_on: [],
              required_hypotheses: [],
              formal_goal: "B",
              target_normal_form: "B",
              candidate_lemmas: [],
              prosa_candidate_lemmas: [
                {
                  ...candidate,
                  audit,
                },
              ],
            }),
          ],
          edges: [],
        }
        const warned = await tool.execute(input, context(session.id))

        expect(warned.metadata.route_failure_review.blocked).toBe(true)
        expect(warned.metadata.route_failure_review.override_required).toBe(true)
        expect(warned.metadata.review?.hard_errors.map((entry) => entry.code)).toContain(
          "verified_failed_route_reuse",
        )
        expect(warned.metadata.review?.materialization_allowed).toBe(false)
        expect(
          ProofRouteLedger.getActiveRouteFailures({
            workspace: tmp.path,
            file,
            theorem: "demo",
            source: theoremSource,
          })[0]?.overrides,
        ).toHaveLength(0)

        ProofRouteLedger.clearScope({ workspace: tmp.path, file, theorem: "demo" })
        await Session.remove(session.id)
      },
    })
  })
})
