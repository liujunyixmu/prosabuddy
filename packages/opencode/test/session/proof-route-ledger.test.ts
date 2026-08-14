import { describe, expect, test } from "bun:test"
import { ProofRouteLedger } from "../../src/session/proof-route-ledger"
import { tmpdir } from "../fixture/fixture"

function source(context = "Context (P : Prop).", body = "exact I.") {
  return [
    "Section Demo.",
    context,
    "Lemma demo : True.",
    "Proof.",
    body,
    "Qed.",
    "End Demo.",
    "",
  ].join("\n")
}

function recordInput(workspace: string, file: string, theoremSource: string) {
  return {
    workspace,
    file,
    theorem: "demo",
    theorem_context_fingerprint: ProofRouteLedger.theoremContextFingerprint(theoremSource, "demo"),
    plan_fingerprint: "plan-worker-1",
    node_id: "completion-bound",
    admit_id: "gap-completion-bound",
    target_contract_fingerprint: ProofRouteLedger.targetContractFingerprint("target_claim"),
    kind: "lemma_missing_premise" as const,
    failed_lemma: "candidate_with_extra_premise",
    missing_premises: ["required bridge fact"],
    missing_premise_fingerprints: [
      ProofRouteLedger.premiseFingerprint("required bridge fact"),
    ],
    route_summary: "The chosen library lemma needs a premise absent from the local theorem context.",
    evidence: "Verified not_convertible context audit and a failed concrete local bridge.",
    confidence: "verified" as const,
    recommended_action: "prove_missing_premise" as const,
  }
}

function routePlan(
  failureID?: string,
  formalGoal = "target_claim",
  nodeID = "completion-bound",
) {
  return {
    plan_fingerprint: "different-plan",
    addresses_failure_ids: [],
    route_overrides: failureID
      ? [
          {
            failure_id: failureID,
            evidence: {
              kind: "different_instantiation" as const,
              previous_instantiation_fingerprint: "old-instantiation",
              candidate_instantiation_fingerprint: "new-instantiation",
            },
          },
        ]
      : [],
    nodes: [
      {
        paper_step_id: "step-1",
        node_id: nodeID,
        formal_goal: formalGoal,
        candidate_lemmas: [],
        prosa_candidate_lemmas: [
          {
            name: "candidate_with_extra_premise",
            audit: {
              verdict: "unresolved",
              instantiation_fingerprint: "old-instantiation",
              residual_premise_fingerprints: [
                ProofRouteLedger.premiseFingerprint("required bridge fact"),
              ],
            },
          },
        ],
        mathcomp_candidate_lemmas: [],
      },
    ],
  }
}

describe("session.proof-route-ledger", () => {
  test("persists across fresh sessions and deduplicates a verified failure", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = `${tmp.path}/theorem.v`
    const theoremSource = source()
    const first = ProofRouteLedger.recordRouteFailure(recordInput(tmp.path, file, theoremSource))
    const repeated = ProofRouteLedger.recordRouteFailure(recordInput(tmp.path, file, theoremSource))

    const fromFreshSession = ProofRouteLedger.getActiveRouteFailures({
      workspace: tmp.path,
      file,
      theorem: "demo",
      source: theoremSource,
    })
    expect(repeated.id).toBe(first.id)
    expect(repeated.occurrence_count).toBe(2)
    expect(fromFreshSession).toHaveLength(1)
    expect(fromFreshSession[0]?.recommended_action).toBe("prove_missing_premise")
    expect(ProofRouteLedger.routeFailurePrompt(fromFreshSession)).toContain("materialization hard constraint")
    expect(ProofRouteLedger.routeFailurePrompt(fromFreshSession)).toContain("not a global lemma blacklist")
    expect(ProofRouteLedger.routeFailurePrompt(fromFreshSession)).toContain("missing_premises=required bridge fact")
    expect(ProofRouteLedger.routeFailurePrompt(fromFreshSession)).toContain("missing_premise_fingerprints=")
    expect(ProofRouteLedger.routeFailurePrompt(fromFreshSession)).toContain("missing_premise_certified")

    ProofRouteLedger.clearScope({ workspace: tmp.path, file, theorem: "demo" })
  }, 30000)

  test("administrative plan, node, and admit renames do not create a fresh semantic failure", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = `${tmp.path}/theorem.v`
    const theoremSource = source()
    const first = ProofRouteLedger.recordRouteFailure(recordInput(tmp.path, file, theoremSource))
    const renamed = ProofRouteLedger.recordRouteFailure({
      ...recordInput(tmp.path, file, theoremSource),
      plan_fingerprint: "plan-worker-2",
      node_id: "completion-bound-v2",
      admit_id: "gap-completion-bound-v2",
    })

    expect(renamed.id).toBe(first.id)
    expect(renamed.occurrence_count).toBe(2)
    expect(
      ProofRouteLedger.assessKnownRouteReuse(
        [renamed],
        routePlan(undefined, "target_claim", "completion-bound-v3"),
      ).blocked,
    ).toBe(true)

    ProofRouteLedger.clearScope({ workspace: tmp.path, file, theorem: "demo" })
  }, 30000)

  test("does not leak failures across workspaces", async () => {
    await using left = await tmpdir({ git: true })
    await using right = await tmpdir({ git: true })
    const theoremSource = source()
    const relativeFile = "theorem.v"
    ProofRouteLedger.recordRouteFailure(recordInput(left.path, relativeFile, theoremSource))

    expect(
      ProofRouteLedger.getActiveRouteFailures({
        workspace: right.path,
        file: relativeFile,
        theorem: "demo",
        source: theoremSource,
      }),
    ).toEqual([])

    ProofRouteLedger.clearScope({ workspace: left.path, file: relativeFile, theorem: "demo" })
  }, 30000)

  test("ignores proof-body churn but stales a receipt when theorem context changes", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = `${tmp.path}/theorem.v`
    const original = source()
    ProofRouteLedger.recordRouteFailure(recordInput(tmp.path, file, original))

    expect(
      ProofRouteLedger.getActiveRouteFailures({
        workspace: tmp.path,
        file,
        theorem: "demo",
        source: source("Context (P : Prop).", "idtac. exact I."),
      }),
    ).toHaveLength(1)
    expect(
      ProofRouteLedger.getActiveRouteFailures({
        workspace: tmp.path,
        file,
        theorem: "demo",
        source: source("Context (P Q : Prop)."),
      }),
    ).toEqual([])

    ProofRouteLedger.clearScope({ workspace: tmp.path, file, theorem: "demo" })
  }, 30000)

  test("tentative receipts do not constrain a route", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = `${tmp.path}/theorem.v`
    const receipt = ProofRouteLedger.recordRouteFailure({
      ...recordInput(tmp.path, file, source()),
      confidence: "tentative",
    })

    const assessment = ProofRouteLedger.assessKnownRouteReuse([receipt], routePlan())
    expect(assessment.override_required).toBe(false)
    expect(assessment.warnings).toEqual([])

    ProofRouteLedger.clearScope({ workspace: tmp.path, file, theorem: "demo" })
  }, 30000)

  test("verified exact-route reuse is blocked until machine evidence validates an override", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = `${tmp.path}/theorem.v`
    const receipt = ProofRouteLedger.recordRouteFailure(recordInput(tmp.path, file, source()))

    const constrained = ProofRouteLedger.assessKnownRouteReuse([receipt], routePlan())
    const unverifiedOverride = ProofRouteLedger.assessKnownRouteReuse([receipt], routePlan(receipt.id))
    const overridden = ProofRouteLedger.assessKnownRouteReuse([receipt], routePlan(receipt.id), {
      verified_override_ids: new Set([receipt.id]),
    })
    expect(constrained.blocked).toBe(true)
    expect(constrained.override_required).toBe(true)
    expect(constrained.blocks[0]?.code).toBe("verified_failed_route_reuse")
    expect(unverifiedOverride.blocked).toBe(true)
    expect(overridden.blocked).toBe(false)
    expect(overridden.override_required).toBe(false)
    expect(overridden.warnings).toEqual([])

    ProofRouteLedger.clearScope({ workspace: tmp.path, file, theorem: "demo" })
  }, 30000)

  test("requires a structured audit before reusing a verified failed lemma through the legacy candidate list", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = `${tmp.path}/theorem.v`
    const receipt = ProofRouteLedger.recordRouteFailure(recordInput(tmp.path, file, source()))
    const base = routePlan()
    const plan = {
      ...base,
      nodes: base.nodes.map((entry, index) => index === 0
        ? {
            ...entry,
            candidate_lemmas: ["candidate_with_extra_premise"],
            prosa_candidate_lemmas: [],
          }
        : entry),
    }

    const assessment = ProofRouteLedger.assessKnownRouteReuse([receipt], plan)
    expect(assessment.blocked).toBe(true)
    expect(assessment.blocks[0]?.code).toBe("verified_failed_route_requires_audit")
    expect(assessment.blocks[0]?.message).toContain("structured audited candidate")

    ProofRouteLedger.clearScope({ workspace: tmp.path, file, theorem: "demo" })
  }, 30000)

  test("returns every active verified failure for enforcement instead of truncating at five", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = `${tmp.path}/theorem.v`
    const theoremSource = source()
    for (let index = 0; index < 6; index++) {
      ProofRouteLedger.recordRouteFailure({
        ...recordInput(tmp.path, file, theoremSource),
        failed_lemma: `candidate_${index}`,
        target_contract_fingerprint: ProofRouteLedger.targetContractFingerprint(`target_${index}`),
      })
    }

    expect(
      ProofRouteLedger.getActiveRouteFailures({
        workspace: tmp.path,
        file,
        theorem: "demo",
        source: theoremSource,
      }),
    ).toHaveLength(6)

    ProofRouteLedger.clearScope({ workspace: tmp.path, file, theorem: "demo" })
  }, 30000)

  test("does not turn a failed lemma into a theorem-context-wide blacklist", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = `${tmp.path}/theorem.v`
    const receipt = ProofRouteLedger.recordRouteFailure(recordInput(tmp.path, file, source()))

    const assessment = ProofRouteLedger.assessKnownRouteReuse(
      [receipt],
      routePlan(undefined, "different_local_target sched"),
    )
    expect(assessment.blocked).toBe(false)

    ProofRouteLedger.clearScope({ workspace: tmp.path, file, theorem: "demo" })
  }, 30000)

  test("a structured persisted override still requires current machine validation", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = `${tmp.path}/theorem.v`
    const receipt = ProofRouteLedger.recordRouteFailure(recordInput(tmp.path, file, source()))
    const updated = ProofRouteLedger.recordRouteOverride({
      failure_id: receipt.id,
      evidence: {
        kind: "different_instantiation",
        previous_instantiation_fingerprint: "old-instantiation",
        candidate_instantiation_fingerprint: "new-instantiation",
      },
    })

    const assessment = ProofRouteLedger.assessKnownRouteReuse([updated], routePlan())
    const revalidated = ProofRouteLedger.assessKnownRouteReuse([updated], routePlan(), {
      verified_override_ids: new Set([receipt.id]),
    })
    expect(assessment.override_required).toBe(true)
    expect(revalidated.override_required).toBe(false)
    expect(ProofRouteLedger.addressRouteFailure(receipt.id)?.status).toBe("addressed")
    expect(
      ProofRouteLedger.getActiveRouteFailures({
        workspace: tmp.path,
        file,
        theorem: "demo",
        source: source(),
      }),
    ).toEqual([])

    ProofRouteLedger.clearScope({ workspace: tmp.path, file, theorem: "demo" })
  }, 30000)
})
