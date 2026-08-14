import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import * as ProofContextModule from "../../src/session/proof-context"
import * as SessionProofModule from "../../src/session/session-proof"
import * as ProofWorkflowModule from "../../src/session/proof-workflow"
import { ProofProjection } from "../../src/session/proof-projection"

describe("session.proof-projection layered proof workflow", () => {
  let ensureFromBindingSpy: ReturnType<typeof spyOn> | undefined
  let sessionProofSpy: ReturnType<typeof spyOn> | undefined
  let activeAssignmentSpy: ReturnType<typeof spyOn> | undefined

  afterEach(() => {
    ensureFromBindingSpy?.mockRestore()
    sessionProofSpy?.mockRestore()
    activeAssignmentSpy?.mockRestore()
  })

  test("prover projection reinforces theorem-level phase control", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ensureFromBindingSpy = spyOn(ProofContextModule.ProofContext, "ensureFromBinding").mockImplementation(async () => ({
          file: `${tmp.path}/theorem.v`,
          position: { line: 9, character: 2 },
          goal: "forall x, P x -> Q x",
          hyps: ["x : nat", "Hx : P x"],
          errors: [],
          timestamp: Date.now(),
          fresh: true,
        }))

        const result = await ProofProjection.project("prover", "session-1", { faithful: true })
        const text = result.lines.join("\n")

        expect(text).toContain("Phase 1 first: build an evidence-grounded theorem-level skeleton")
        expect(text).toContain("primary evidence, not an unconditional authority")
        expect(text).toContain("use `proof_plan` to review a structured DAG")
        expect(text).toContain("at most four materially distinct semantic DAG revisions")
        expect(text).toContain("accepted proof plan is session-persisted and locked")
        expect(text).toContain("write the accepted DAG promptly instead of continuing broad search")
        expect(text).toContain("write it as its own `proof_region begin/end` unit")
        expect(text).toContain("do not continue proving inside those regions in the prover session")
        expect(text).toContain("After all regions are solved, the prover owns any theorem-level `Admitted.` -> `Qed.` conversion")
        expect(text).toContain("runtime scheduling owns serial lemma task enqueueing")
        expect(text).toContain("paper step when applicable or marking it context-derived")
        expect(text).toContain("Do not add new section-level, theorem-level, or global assumptions")
        expect(text).toContain("PAPER-FAITHFUL MODE IS ACTIVE.")
      },
    })
  })

  test("runtime projection keeps live context without repeating static prover policy", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ensureFromBindingSpy = spyOn(ProofContextModule.ProofContext, "ensureFromBinding").mockImplementation(async () => ({
          file: `${tmp.path}/theorem.v`,
          position: { line: 9, character: 2 },
          goal: "forall x, P x -> Q x",
          hyps: ["x : nat", "Hx : P x"],
          errors: [],
          timestamp: Date.now(),
          fresh: true,
        }))

        const result = await ProofProjection.project("prover", "session-1", { runtimeOnly: true })
        const text = result.lines.join("\n")

        expect(text).toContain("<proof-context-live>")
        expect(text).toContain("forall x, P x -> Q x")
        expect(text).not.toContain("Phase 1 first: translate the paper proof")
        expect(text).not.toContain("write it as its own `proof_region begin/end` unit")
      },
    })
  })

  test("lemma projection reinforces local skeleton-before-recursion workflow", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ensureFromBindingSpy = spyOn(ProofContextModule.ProofContext, "ensureFromBinding").mockImplementation(async () => ({
          file: `${tmp.path}/lemma.v`,
          position: { line: 21, character: 4 },
          goal: "service_bound <= response_bound",
          hyps: ["service_bound : nat", "response_bound : nat"],
          errors: [{ line: 22, col: 7, message: "Unable to unify." }],
          timestamp: Date.now(),
          fresh: true,
        }))

        const result = await ProofProjection.project("lemma", "session-2", { faithful: true })
        const text = result.lines.join("\n")

        expect(text).toContain("Treat this as a long-running interactive proof session")
        expect(text).toContain("Use `lsp proofGoals` and edit/write LSP diagnostics as first-class proof feedback")
        expect(text).toContain("if it exposes smaller local subclaims, write that local annotated pose/have skeleton immediately inside the assigned gap")
        expect(text).toContain("Own exactly one assigned frozen local gap")
        expect(text).toContain("Do not add new section-level, theorem-level, or global assumptions.")
        expect(text).toContain("PAPER-FAITHFUL MODE IS ACTIVE.")
      },
    })
  })

  test("lemma runtime suppresses an LSP sibling goal when the staged transaction is ahead of disk", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/lemma.v`
        await Bun.write(file, "Goal old_sibling.\nAdmitted.\n")

        sessionProofSpy = spyOn(SessionProofModule.SessionProof, "get").mockReturnValue({
          file,
          uri: `file://${file}`,
          line: 7,
          character: 2,
          source: "parent",
          locked: false,
          stale: false,
          canonicalSource: "Goal assigned_region.\nAdmitted.\n",
          updated: Date.now(),
        })
        activeAssignmentSpy = spyOn(
          ProofWorkflowModule.SessionProofWorkflow,
          "activeLemmaAssignment",
        ).mockReturnValue({
          file,
          theorem: "Target",
          admit_id: "target_region",
          goal: "assigned_region",
          goal_fingerprint: "assigned-fingerprint",
          proof_position: { line: 7, character: 2 },
          replace: "replace target_region",
          skeleton: "have H : assigned_region. { admit. }",
          done: "compile target_region",
          obligation: {
            kind: "semantic_bridge",
            dependencies: [],
            input: ["Hctx"],
            prosa_candidate_lemmas: [],
            mathcomp_candidate_lemmas: [],
            shape_evidence: [],
          },
        })
        ensureFromBindingSpy = spyOn(ProofContextModule.ProofContext, "ensureFromBinding").mockImplementation(
          async () => {
            throw new Error("rocq-lsp must not be queried against the older physical revision")
          },
        )

        const result = await ProofProjection.project("lemma", "session-staged", { runtimeOnly: true })
        const text = result.lines.join("\n")

        expect(text).toContain("Authoritative context: staged proof transaction")
        expect(text).toContain("Proof region: target_region")
        expect(text).toContain("assigned_region")
        expect(text).toContain("Available inputs: Hctx")
        expect(text).not.toContain("old_sibling")
        expect(ensureFromBindingSpy).not.toHaveBeenCalled()
      },
    })
  })
})
