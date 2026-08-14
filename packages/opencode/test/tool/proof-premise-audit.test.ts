import { describe, expect, test } from "bun:test"
import path from "path"
import { auditCandidateLemma } from "../../src/tool/proof-premise-audit"
import { ProofPlanCandidateLemma } from "../../src/tool/proof-schema"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function candidate(name: string, role: "direct_apply" | "rewrite" | "transport" | "local_fact" | "automation_hint" = "direct_apply") {
  return ProofPlanCandidateLemma.parse({
    name,
    library: "local",
    role,
    reason: "premise-audit fixture",
  })
}

describe("tool.proof-premise-audit", () => {
  test("accepts a candidate whose premises are locally available", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "audit-usable.v")
    const source = [
      "Axiom pair_intro : forall P Q : Prop, P -> Q -> P /\\ Q.",
      "Lemma demo (P Q : Prop) (HP : P) (HQ : Q) : P /\\ Q.",
      "Proof.",
      "Admitted.",
      "",
    ].join("\n")
    await Bun.write(file, source)

    const audit = await Instance.provide({
      directory: tmp.path,
      fn: () => auditCandidateLemma({
        file,
        source,
        theorem: "demo",
        formalGoal: "P /\\ Q",
        candidate: candidate("pair_intro"),
      }),
    })
    expect(audit.verdict).toBe("usable")
    expect(audit.residual_premises).toEqual([])
    expect(audit.instantiation_fingerprint).toBeTruthy()
  }, 30000)

  test("reports a residual premise instead of approving an inapplicable route", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "audit-missing.v")
    const source = [
      "Axiom pair_intro : forall P Q : Prop, P -> Q -> P /\\ Q.",
      "Lemma demo (P Q : Prop) (HP : P) : P /\\ Q.",
      "Proof.",
      "Admitted.",
      "",
    ].join("\n")
    await Bun.write(file, source)

    const audit = await Instance.provide({
      directory: tmp.path,
      fn: () => auditCandidateLemma({
        file,
        source,
        theorem: "demo",
        formalGoal: "P /\\ Q",
        candidate: candidate("pair_intro"),
      }),
    })
    expect(audit.verdict).toBe("bridge_required")
    expect(audit.residual_premises.length).toBeGreaterThan(0)
    expect(audit.residual_premise_fingerprints).toHaveLength(audit.residual_premises.length)
  }, 30000)

  test("introduces node-local binders before probing the candidate conclusion", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "audit-quantified.v")
    const source = [
      "From mathcomp Require Import ssreflect ssrbool eqtype.",
      "Section Audit.",
      "Variable T : eqType.",
      "Variable P Q : pred T.",
      "Axiom pointwise : forall x : T, P x -> Q x.",
      "Lemma demo : True.",
      "Proof.",
      "  exact I.",
      "Qed.",
      "End Audit.",
      "",
    ].join("\n")
    await Bun.write(file, source)

    const audit = await Instance.provide({
      directory: tmp.path,
      fn: () => auditCandidateLemma({
        file,
        source,
        theorem: "demo",
        formalGoal: "forall x : T, P x -> Q x",
        candidate: candidate("pointwise"),
      }),
    })
    expect(audit.verdict).toBe("usable")
    expect(audit.residual_premises).toEqual([])
    expect(audit.diagnostic).not.toContain("Equality.sort")
  }, 30000)

  test("audits Fact declarations as theorem targets", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "audit-fact.v")
    const source = [
      "Axiom identity_fact : forall P : Prop, P -> P.",
      "Fact demo (P : Prop) (HP : P) : P.",
      "Proof.",
      "Admitted.",
      "",
    ].join("\n")
    await Bun.write(file, source)

    const audit = await Instance.provide({
      directory: tmp.path,
      fn: () => auditCandidateLemma({
        file,
        source,
        theorem: "demo",
        formalGoal: "P",
        candidate: candidate("identity_fact"),
      }),
    })
    expect(audit.verdict).toBe("usable")
  }, 30000)

  test("checks rewrite candidates for availability without requiring whole-node closure", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "audit-rewrite.v")
    const source = [
      "Axiom rewrite_piece : forall P Q : Prop, P = Q.",
      "Lemma demo (A B : Prop) : A /\\ B.",
      "Proof.",
      "Admitted.",
      "",
    ].join("\n")
    await Bun.write(file, source)

    const audit = await Instance.provide({
      directory: tmp.path,
      fn: () => auditCandidateLemma({
        file,
        source,
        theorem: "demo",
        formalGoal: "A /\\ B",
        candidate: candidate("rewrite_piece", "rewrite"),
      }),
    })
    expect(audit.verdict).toBe("available")
    expect(audit.exact_type).toContain("rewrite_piece")
    expect(audit.residual_premises).toEqual([])
  }, 30000)
})
