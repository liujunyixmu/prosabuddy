import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"
import { ProofEditTransaction } from "../../src/session/proof-edit-transaction"
import { EditTool } from "../../src/tool/edit"
import { ApplyPatchTool } from "../../src/tool/apply_patch"
import { CheckpointTool } from "../../src/tool/checkpoint"
import { FileTime } from "../../src/file/time"
import { Session } from "../../src/session"
import { SessionProof } from "../../src/session/session-proof"
import { SessionStatus } from "../../src/session/status"
import { tmpdir } from "../fixture/fixture"

const source = [
  "Module ResponseTimeAnalysisEDF.",
  "Lemma Lemma3_05 : True.",
  "Proof.",
  "  exact I.",
  "Qed.",
  "End ResponseTimeAnalysisEDF.",
  "",
].join("\n")

function context(sessionID: string, onAsk: () => void = () => {}) {
  return {
    sessionID,
    messageID: "",
    callID: "",
    // The transaction itself is configured as a fixer child. Use a neutral
    // tool agent here so this unit test does not also require a persisted
    // proof-workflow session row for the unrelated wide-agent takeover guard.
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => {},
    ask: async () => onAsk(),
  }
}

describe("proof edit transaction", () => {
  test("allows a theorem-tail repair to add only the final newline", async () => {
    await using fixture = await tmpdir({ git: true })
    const file = path.join(fixture.path, "lemma3-final-newline.v")
    const sourceWithoutFinalNewline = source.trimEnd()
    await fs.writeFile(file, sourceWithoutFinalNewline, "utf-8")

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const session = await Session.create({})
        SessionProof.set(session.id, file, { line: 2, character: 0 }, "manual")
        await ProofEditTransaction.begin({
          sessionID: session.id,
          parentSessionID: session.id,
          agent: "fixer",
          file,
          source: sourceWithoutFinalNewline,
          scope: { kind: "theorem_body", theorem: "Lemma3_05" },
        })
        FileTime.read(session.id, file)

        const edit = await EditTool.init()
        const result = await edit.execute(
          {
            filePath: file,
            oldString: "  exact I.\nQed.\nEnd ResponseTimeAnalysisEDF.",
            newString: "  pose proof I as H.\n  exact H.\nQed.\nEnd ResponseTimeAnalysisEDF.\n",
          },
          context(session.id),
        )

        expect(result.output).toContain("Edit staged in proof transaction")
        expect(ProofEditTransaction.source(session.id, file)).toEndWith("End ResponseTimeAnalysisEDF.\n")
        expect(await fs.readFile(file, "utf-8")).toBe(sourceWithoutFinalNewline)

        ProofEditTransaction.abort(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("rejects the worker2-style copied Qed and End suffix", async () => {
    await using fixture = await tmpdir({ git: true })
    const file = path.join(fixture.path, "lemma3.v")
    await fs.writeFile(file, source, "utf-8")

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionID = "worker2-regression"
        await ProofEditTransaction.begin({
          sessionID,
          parentSessionID: "parent",
          agent: "fixer",
          file,
          source,
          scope: { kind: "theorem_body", theorem: "Lemma3_05" },
        })
        FileTime.read(sessionID, file)
        const edit = await EditTool.init()
        await expect(
          edit.execute(
            {
              filePath: file,
              oldString: "Proof.\n  exact I.",
              newString: [
                "Proof.",
                "  exact I.",
                "Qed.",
                "End ResponseTimeAnalysisEDF.",
                "  unfold response_time_bounded_by.",
              ].join("\n"),
            },
            context(sessionID),
          ),
        ).rejects.toThrow("proof_transaction_structure_rejection")
        expect(await fs.readFile(file, "utf-8")).toBe(source)
        ProofEditTransaction.abort(sessionID)
      },
    })
  })

  test("journals an uncommittable draft and restores it across a fresh parent session", async () => {
    await using fixture = await tmpdir({ git: true })
    const file = path.join(fixture.path, "lemma3.v")
    await fs.writeFile(file, source, "utf-8")

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionID = "worker-unaccepted"
        await ProofEditTransaction.begin({
          sessionID,
          parentSessionID: "parent",
          agent: "fixer",
          file,
          source,
          scope: { kind: "theorem_body", theorem: "Lemma3_05" },
        })
        FileTime.read(sessionID, file)
        const edit = await EditTool.init()
        const result = await edit.execute(
          {
            filePath: file,
            oldString: "  exact I.",
            newString: "  constructor.",
          },
          context(sessionID),
        )
        expect(result.output).toContain("Edit staged in proof transaction")
        expect(await fs.readFile(file, "utf-8")).toBe(source)
        expect(ProofEditTransaction.source(sessionID, file)).toContain("constructor.")
        expect(ProofEditTransaction.requiresValidation(sessionID, file)).toBe(true)
        expect(ProofEditTransaction.active(sessionID)?.validation_pending).toBe(true)

        const finalized = await ProofEditTransaction.finalize(sessionID)
        expect(finalized?.status).toBe("recoverable")
        expect(await fs.readFile(file, "utf-8")).toBe(source)

        const resumed = await ProofEditTransaction.begin({
          sessionID: "worker-unaccepted-resumed",
          parentSessionID: "fresh-parent",
          agent: "fixer",
          file,
          source,
          scope: { kind: "theorem_body", theorem: "Lemma3_05" },
        })
        expect(resumed?.transaction_id).toBe(finalized?.transaction_id)
        expect(resumed?.recovered).toBe(true)
        expect(ProofEditTransaction.source("worker-unaccepted-resumed", file)).toContain("constructor.")
        ProofEditTransaction.abort("worker-unaccepted-resumed")
      },
    })
  })

  test("hands an uncommittable repair draft back to the parent without writing the workspace", async () => {
    await using fixture = await tmpdir({ git: true })
    const file = path.join(fixture.path, "lemma3.v")
    await fs.writeFile(file, source, "utf-8")

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const parentSessionID = "repair-parent"
        const childSessionID = "repair-child"
        await ProofEditTransaction.begin({
          sessionID: childSessionID,
          parentSessionID,
          agent: "fixer",
          file,
          source,
          scope: { kind: "theorem_body", theorem: "Lemma3_05" },
        })
        const childDraft = source.replace("  exact I.", "  constructor.")
        ProofEditTransaction.stage({
          sessionID: childSessionID,
          file,
          before: source,
          after: childDraft,
        })

        const handedOff = await ProofEditTransaction.finalize(childSessionID, {
          handoffToSessionID: parentSessionID,
        })
        expect(handedOff?.status).toBe("handed_off")
        expect(handedOff?.handed_off).toBe(true)
        expect(await fs.readFile(file, "utf-8")).toBe(source)
        expect(ProofEditTransaction.source(parentSessionID, file)).toBe(childDraft)
        expect(ProofEditTransaction.requiresStagedRead(parentSessionID, file)).toBe(true)

        FileTime.read(parentSessionID, file)
        const edit = await EditTool.init()
        await expect(
          edit.execute(
            {
              filePath: file,
              oldString: "  constructor.",
              newString: "  pose proof I as H.\n  exact H.",
            },
            context(parentSessionID),
          ),
        ).rejects.toThrow("proof_transaction_resync_required")
        ProofEditTransaction.acknowledgeStagedRead(parentSessionID, file)
        const parentResult = await edit.execute(
          {
            filePath: file,
            oldString: "  constructor.",
            newString: "  pose proof I as H.\n  exact H.",
          },
          context(parentSessionID),
        )
        expect(parentResult.output).toContain("Edit staged in proof transaction")
        expect(await fs.readFile(file, "utf-8")).toBe(source)
        const parentDraft = ProofEditTransaction.source(parentSessionID, file)!
        ProofEditTransaction.markAccepted({
          sessionID: parentSessionID,
          file,
          source: parentDraft,
          level: "hard",
          receipt: { kind: "final_qed" },
        })
        expect((await ProofEditTransaction.finalizeHandedOffAccepted(parentSessionID))?.status).toBe("committed")
        expect(await fs.readFile(file, "utf-8")).toBe(parentDraft)
      },
    })
  })

  test("retargets a handed-off transaction to the next proof region without losing the staged prefix", async () => {
    await using fixture = await tmpdir({ git: true })
    const file = path.join(fixture.path, "lemma3.v")
    const beginOne = "(* proof_region begin owner: lemma admit_id: gap_1 theorem: Lemma3_05 *)"
    const endOne = "(* proof_region end admit_id: gap_1 *)"
    const beginTwo = "(* proof_region begin owner: lemma admit_id: gap_2 theorem: Lemma3_05 *)"
    const endTwo = "(* proof_region end admit_id: gap_2 *)"
    const regionSource = [
      "Module ResponseTimeAnalysisEDF.",
      "Lemma Lemma3_05 : True.",
      "Proof.",
      beginOne,
      "  have Hone : True. { admit. }",
      endOne,
      beginTwo,
      "  have Htwo : True. { admit. }",
      endTwo,
      "  exact Hone.",
      "Admitted.",
      "End ResponseTimeAnalysisEDF.",
      "",
    ].join("\n")
    await fs.writeFile(file, regionSource, "utf-8")

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const parentSessionID = "region-parent"
        const childSessionID = "region-two-child"
        await ProofEditTransaction.begin({
          sessionID: parentSessionID,
          parentSessionID: "root",
          agent: "lemma",
          file,
          source: regionSource,
          scope: {
            kind: "proof_region",
            theorem: "Lemma3_05",
            beginMarker: beginOne,
            endMarker: endOne,
          },
        })

        const firstSolved = regionSource.replace("have Hone : True. { admit. }", "have Hone : True. { exact I. }")
        ProofEditTransaction.stage({
          sessionID: parentSessionID,
          file,
          before: regionSource,
          after: firstSolved,
        })

        const transferred = ProofEditTransaction.transfer({
          fromSessionID: parentSessionID,
          toSessionID: childSessionID,
          file,
          theorem: "Lemma3_05",
          scope: {
            kind: "proof_region",
            theorem: "Lemma3_05",
            beginMarker: beginTwo,
            endMarker: endTwo,
          },
        })
        expect(transferred).toMatchObject({ scope: "proof_region", handed_off: true })
        expect(ProofEditTransaction.source(childSessionID, file)).toBe(firstSolved)

        const bothSolved = firstSolved.replace("have Htwo : True. { admit. }", "have Htwo : True. { exact I. }")
        expect(() =>
          ProofEditTransaction.stage({
            sessionID: childSessionID,
            file,
            before: firstSolved,
            after: bothSolved,
          }),
        ).not.toThrow()
        expect(ProofEditTransaction.source(childSessionID, file)).toBe(bothSolved)

        const rewritesCertifiedPrefix = bothSolved.replace("have Hone : True. { exact I. }", "have Hone : True. { constructor. }")
        expect(() =>
          ProofEditTransaction.stage({
            sessionID: childSessionID,
            file,
            before: bothSolved,
            after: rewritesCertifiedPrefix,
          }),
        ).toThrow("lemma child edits must remain inside the assigned proof_region")

        ProofEditTransaction.abort(childSessionID)
      },
    })
  })

  test("supports multiple proof regions that share a generic end marker", async () => {
    await using fixture = await tmpdir({ git: true })
    const file = path.join(fixture.path, "lemma4.v")
    const beginOne = "(* proof_region begin owner: lemma admit_id: gap_1 theorem: Lemma4_05 *)"
    const beginTwo = "(* proof_region begin owner: lemma admit_id: gap_2 theorem: Lemma4_05 *)"
    const sharedEnd = "(* proof_region end *)"
    const regionSource = [
      "Lemma Lemma4_05 : True.",
      "Proof.",
      beginOne,
      "  have Hone : True. { admit. }",
      sharedEnd,
      beginTwo,
      "  have Htwo : True. { admit. }",
      sharedEnd,
      "  exact Hone.",
      "Admitted.",
      "",
    ].join("\n")
    await fs.writeFile(file, regionSource, "utf-8")

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        await ProofEditTransaction.begin({
          sessionID: "generic-end-child",
          parentSessionID: "root",
          agent: "lemma",
          file,
          source: regionSource,
          scope: {
            kind: "proof_region",
            theorem: "Lemma4_05",
            beginMarker: beginOne,
            endMarker: sharedEnd,
          },
        })

        const solvedFirst = regionSource.replace("have Hone : True. { admit. }", "have Hone : True. { exact I. }")
        expect(() =>
          ProofEditTransaction.stage({
            sessionID: "generic-end-child",
            file,
            before: regionSource,
            after: solvedFirst,
          }),
        ).not.toThrow()
        expect(ProofEditTransaction.source("generic-end-child", file)).toBe(solvedFirst)

        const siblingEdit = solvedFirst.replace("have Htwo : True. { admit. }", "have Htwo : True. { exact I. }")
        expect(() =>
          ProofEditTransaction.stage({
            sessionID: "generic-end-child",
            file,
            before: solvedFirst,
            after: siblingEdit,
          }),
        ).toThrow("lemma child edits must remain inside the assigned proof_region")
        ProofEditTransaction.abort("generic-end-child")
      },
    })
  })

  test("recovers the latest theorem transaction across a fresh root session even when its scope changed", async () => {
    await using fixture = await tmpdir({ git: true })
    const file = path.join(fixture.path, "lemma3.v")
    await fs.writeFile(file, source, "utf-8")

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const oldRoot = "old-root"
        await ProofEditTransaction.begin({
          sessionID: oldRoot,
          parentSessionID: "",
          agent: "prover",
          file,
          source,
          scope: { kind: "theorem_spine", theorem: "Lemma3_05" },
        })
        const remodeled = source.replace("  exact I.", "  pose proof I as H.\n  exact H.")
        ProofEditTransaction.stage({ sessionID: oldRoot, file, before: source, after: remodeled })
        expect((await ProofEditTransaction.finalize(oldRoot))?.status).toBe("recoverable")

        // A later stale region/body attempt must not hide the broader
        // theorem-spine remodel when a fresh root chooses a recovery draft.
        await ProofEditTransaction.begin({
          sessionID: "later-narrow-worker",
          parentSessionID: "later-root",
          agent: "lemma",
          file,
          source,
          scope: { kind: "theorem_body", theorem: "Lemma3_05" },
        })
        const laterNarrowDraft = source.replace("  exact I.", "  constructor.")
        ProofEditTransaction.stage({
          sessionID: "later-narrow-worker",
          file,
          before: source,
          after: laterNarrowDraft,
        })
        expect((await ProofEditTransaction.finalize("later-narrow-worker"))?.status).toBe("recoverable")

        const recovered = ProofEditTransaction.recoverLatest({
          sessionID: "fresh-root",
          parentSessionID: "",
          agent: "prover",
          file,
          source,
          theorem: "Lemma3_05",
        })
        expect(recovered).toMatchObject({
          recovered: true,
          scope: "theorem_spine",
          staged: true,
        })
        expect(ProofEditTransaction.source("fresh-root", file)).toBe(remodeled)

        const child = ProofEditTransaction.transfer({
          fromSessionID: "fresh-root",
          toSessionID: "fresh-child",
          file,
          theorem: "Lemma3_05",
        })
        expect(child).toMatchObject({ handed_off: true, scope: "theorem_spine" })
        expect(ProofEditTransaction.source("fresh-child", file)).toBe(remodeled)
        expect(ProofEditTransaction.active("fresh-root")).toBeUndefined()
        ProofEditTransaction.abort("fresh-child")
      },
    })
  })

  test("fresh prover adopts an idle in-memory transaction instead of reading stale disk source", async () => {
    await using fixture = await tmpdir({ git: true })
    const file = path.join(fixture.path, "lemma3.v")
    await fs.writeFile(file, source, "utf-8")

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const staged = source.replace("  exact I.", "  pose proof I as H.\n  exact H.")
        await ProofEditTransaction.begin({
          sessionID: "idle-old-root",
          parentSessionID: "",
          agent: "prover",
          file,
          source,
          scope: { kind: "theorem_body", theorem: "Lemma3_05" },
        })
        ProofEditTransaction.stage({
          sessionID: "idle-old-root",
          file,
          before: source,
          after: staged,
        })
        SessionStatus.set("idle-old-root", { type: "idle" })

        const recovered = ProofEditTransaction.recoverLatest({
          sessionID: "fresh-root",
          parentSessionID: "",
          agent: "prover",
          file,
          source,
          theorem: "Lemma3_05",
        })

        expect(recovered).toMatchObject({ recovered: true, staged: true })
        expect(ProofEditTransaction.active("idle-old-root")).toBeUndefined()
        expect(ProofEditTransaction.source("fresh-root", file)).toBe(staged)
        ProofEditTransaction.abort("fresh-root")
      },
    })
  })

  test("fresh recovery preserves cumulative sibling-region edits", async () => {
    await using fixture = await tmpdir({ git: true })
    const file = path.join(fixture.path, "lemma3.v")
    const beginA = "(* proof_region begin admit_id: region_a *)"
    const endA = "(* proof_region end admit_id: region_a *)"
    const beginB = "(* proof_region begin admit_id: region_b *)"
    const endB = "(* proof_region end admit_id: region_b *)"
    const regionalSource = [
      "Module ResponseTimeAnalysisEDF.",
      "Lemma Lemma3_05 : True.",
      "Proof.",
      beginA,
      "  pose proof I as HA.",
      endA,
      beginB,
      "  exact I.",
      endB,
      "Qed.",
      "End ResponseTimeAnalysisEDF.",
      "",
    ].join("\n")
    await fs.writeFile(file, regionalSource, "utf-8")

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        await ProofEditTransaction.begin({
          sessionID: "region-a-child",
          parentSessionID: "root",
          agent: "lemma",
          file,
          source: regionalSource,
          scope: {
            kind: "proof_region",
            theorem: "Lemma3_05",
            beginMarker: beginA,
            endMarker: endA,
          },
        })
        const afterA = regionalSource.replace("  pose proof I as HA.", "  pose proof I as HA_certified.")
        ProofEditTransaction.stage({
          sessionID: "region-a-child",
          file,
          before: regionalSource,
          after: afterA,
        })

        ProofEditTransaction.transfer({
          fromSessionID: "region-a-child",
          toSessionID: "region-b-child",
          file,
          theorem: "Lemma3_05",
          scope: {
            kind: "proof_region",
            theorem: "Lemma3_05",
            beginMarker: beginB,
            endMarker: endB,
          },
        })
        const afterB = afterA.replace("  exact I.", "  exact HA_certified.")
        ProofEditTransaction.stage({
          sessionID: "region-b-child",
          file,
          before: afterA,
          after: afterB,
        })
        expect((await ProofEditTransaction.finalize("region-b-child"))?.status).toBe("recoverable")

        const recovered = ProofEditTransaction.recoverLatest({
          sessionID: "fresh-root",
          parentSessionID: "",
          agent: "prover",
          file,
          source: regionalSource,
          theorem: "Lemma3_05",
        })
        expect(recovered).toMatchObject({
          recovered: true,
          scope: "proof_region",
          staged: true,
        })
        expect(ProofEditTransaction.source("fresh-root", file)).toBe(afterB)

        const escaped = afterB.replace("HA_certified", "HA_outside")
        expect(() =>
          ProofEditTransaction.stage({
            sessionID: "fresh-root",
            file,
            before: afterB,
            after: escaped,
          }),
        ).toThrow("proof_transaction_scope_rejection")
        ProofEditTransaction.abort("fresh-root")
      },
    })
  })

  test("returns the last lemma transaction to parent theorem finalization scope", async () => {
    await using fixture = await tmpdir({ git: true })
    const file = path.join(fixture.path, "lemma3.v")
    const begin = "(* proof_region begin admit_id: region_a *)"
    const end = "(* proof_region end admit_id: region_a *)"
    const admitted = [
      "Module ResponseTimeAnalysisEDF.",
      "Lemma Lemma3_05 : True.",
      "Proof.",
      begin,
      "  admit.",
      end,
      "Admitted.",
      "End ResponseTimeAnalysisEDF.",
      "",
    ].join("\n")
    await fs.writeFile(file, admitted, "utf-8")

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        await ProofEditTransaction.begin({
          sessionID: "parent-prover",
          parentSessionID: "",
          agent: "prover",
          file,
          source: admitted,
          scope: { kind: "theorem_body", theorem: "Lemma3_05" },
        })
        ProofEditTransaction.transfer({
          fromSessionID: "parent-prover",
          toSessionID: "last-lemma-child",
          file,
          theorem: "Lemma3_05",
          scope: {
            kind: "proof_region",
            theorem: "Lemma3_05",
            beginMarker: begin,
            endMarker: end,
          },
        })
        const regionSolved = admitted.replace("  admit.", "  exact I.")
        ProofEditTransaction.stage({
          sessionID: "last-lemma-child",
          file,
          before: admitted,
          after: regionSolved,
        })

        const handedOff = await ProofEditTransaction.finalize("last-lemma-child", {
          handoffToSessionID: "parent-prover",
          handoffScope: { kind: "theorem_body", theorem: "Lemma3_05" },
        })
        expect(handedOff).toMatchObject({ status: "handed_off", scope: "theorem_body" })

        const finalized = regionSolved.replace("Admitted.", "Qed.")
        const staged = ProofEditTransaction.stage({
          sessionID: "parent-prover",
          file,
          before: regionSolved,
          after: finalized,
        })
        expect(staged).toMatchObject({ scope: "theorem_body", staged: true })
        expect(ProofEditTransaction.source("parent-prover", file)).toBe(finalized)
        ProofEditTransaction.abort("parent-prover")
      },
    })
  })

  test("fresh prover widens a recoverable lemma scope for final Qed", async () => {
    await using fixture = await tmpdir({ git: true })
    const file = path.join(fixture.path, "lemma3.v")
    const begin = "(* proof_region begin admit_id: region_a *)"
    const end = "(* proof_region end admit_id: region_a *)"
    const admitted = [
      "Lemma Lemma3_05 : True.",
      "Proof.",
      begin,
      "  admit.",
      end,
      "Admitted.",
      "",
    ].join("\n")
    await fs.writeFile(file, admitted, "utf-8")

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        await ProofEditTransaction.begin({
          sessionID: "stopped-last-child",
          parentSessionID: "old-parent",
          agent: "lemma",
          file,
          source: admitted,
          scope: {
            kind: "proof_region",
            theorem: "Lemma3_05",
            beginMarker: begin,
            endMarker: end,
          },
        })
        const regionSolved = admitted.replace("  admit.", "  exact I.")
        ProofEditTransaction.stage({
          sessionID: "stopped-last-child",
          file,
          before: admitted,
          after: regionSolved,
        })
        expect((await ProofEditTransaction.finalize("stopped-last-child"))?.status).toBe("recoverable")

        const recovered = ProofEditTransaction.recoverLatest({
          sessionID: "fresh-parent",
          parentSessionID: "",
          agent: "prover",
          file,
          source: admitted,
          theorem: "Lemma3_05",
          minimumScope: { kind: "theorem_body", theorem: "Lemma3_05" },
        })
        expect(recovered).toMatchObject({ recovered: true, scope: "theorem_body" })

        const finalized = regionSolved.replace("Admitted.", "Qed.")
        expect(() =>
          ProofEditTransaction.stage({
            sessionID: "fresh-parent",
            file,
            before: regionSolved,
            after: finalized,
          }),
        ).not.toThrow()
        ProofEditTransaction.abort("fresh-parent")
      },
    })
  })

  test("fresh repair recovery forks from the best certified snapshot without deleting the newer draft", async () => {
    await using fixture = await tmpdir({ git: true })
    const file = path.join(fixture.path, "lemma3.v")
    await fs.writeFile(file, source, "utf-8")

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const certified = source.replace("  exact I.", "  pose proof I as H.\n  exact H.")
        const experimental = certified.replace("  exact H.", "  fail.")
        await ProofEditTransaction.begin({
          sessionID: "repair-old-root",
          parentSessionID: "",
          agent: "prover",
          file,
          source,
          scope: { kind: "theorem_body", theorem: "Lemma3_05" },
        })
        ProofEditTransaction.stage({ sessionID: "repair-old-root", file, before: source, after: certified })
        ProofEditTransaction.markAccepted({
          sessionID: "repair-old-root",
          file,
          source: certified,
          level: "hard",
          receipt: { kind: "region_certified" },
        })
        ProofEditTransaction.stage({
          sessionID: "repair-old-root",
          file,
          before: certified,
          after: experimental,
        })
        SessionStatus.set("repair-old-root", { type: "idle" })

        const recovered = ProofEditTransaction.recoverLatest({
          sessionID: "repair-fresh-root",
          parentSessionID: "",
          agent: "prover",
          file,
          source,
          theorem: "Lemma3_05",
          preferCertifiedBaseline: true,
        })

        expect(recovered).toMatchObject({
          recovered: true,
          recovery_base: "best_certified",
          committable_snapshot: true,
          certified_revision: 1,
          preserved_draft_revision: 2,
        })
        expect(recovered?.preserved_draft_hash).toBeTruthy()
        expect(ProofEditTransaction.source("repair-fresh-root", file)).toBe(certified)
        expect(ProofEditTransaction.active("repair-old-root")).toBeUndefined()
        ProofEditTransaction.abort("repair-fresh-root")
      },
    })
  })

  test("restores a recovery-only certified snapshot without making it workspace-committable", async () => {
    await using fixture = await tmpdir({ git: true })
    const file = path.join(fixture.path, "lemma3-recovery-only.v")
    await fs.writeFile(file, source, "utf-8")

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const certified = source.replace("  exact I.", "  pose proof I as Hcert.\n  exact Hcert.")
        const failedDraft = certified.replace("  exact Hcert.", "  fail.")
        await ProofEditTransaction.begin({
          sessionID: "recovery-only-old",
          parentSessionID: "",
          agent: "prover",
          file,
          source,
          scope: { kind: "theorem_body", theorem: "Lemma3_05" },
        })
        ProofEditTransaction.stage({ sessionID: "recovery-only-old", file, before: source, after: certified })
        const marked = ProofEditTransaction.markCertifiedRecovery({
          sessionID: "recovery-only-old",
          file,
          source: certified,
          level: "hard",
          receipt: {
            kind: "region_certified",
            certified_semantic_debt_count: 2,
            after_unresolved_semantic_debt: 3,
          },
        })
        expect(marked).toMatchObject({
          accepted_snapshot: true,
          committable_snapshot: false,
          certified_revision: 1,
          certified_region_count: 2,
          validation_pending: false,
        })
        expect(ProofEditTransaction.requiresValidation("recovery-only-old", file)).toBe(false)
        ProofEditTransaction.stage({
          sessionID: "recovery-only-old",
          file,
          before: certified,
          after: failedDraft,
        })
        expect(ProofEditTransaction.requiresValidation("recovery-only-old", file)).toBe(true)
        SessionStatus.set("recovery-only-old", { type: "idle" })

        const recovered = ProofEditTransaction.recoverLatest({
          sessionID: "recovery-only-fresh",
          parentSessionID: "",
          agent: "prover",
          file,
          source,
          theorem: "Lemma3_05",
        })
        expect(recovered).toMatchObject({
          recovered: true,
          recovery_base: "best_certified",
          committable_snapshot: false,
          certified_revision: 1,
          certified_region_count: 2,
          preserved_draft_revision: 2,
          validation_pending: false,
        })
        expect(ProofEditTransaction.source("recovery-only-fresh", file)).toBe(certified)
        expect(ProofEditTransaction.requiresValidation("recovery-only-fresh", file)).toBe(false)
        expect(await fs.readFile(file, "utf-8")).toBe(source)
        ProofEditTransaction.abort("recovery-only-fresh")
      },
    })
  })

  test("restores the snapshot with the most certified regions instead of the latest certified draft", async () => {
    await using fixture = await tmpdir({ git: true })
    const file = path.join(fixture.path, "lemma3-best-certificate.v")
    await fs.writeFile(file, source, "utf-8")

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const mostCertified = source.replace("  exact I.", "  pose proof I as Hbest.\n  exact Hbest.")
        const newerButWorse = mostCertified.replace("Hbest", "Hnewer")
        const failedDraft = newerButWorse.replace("  exact Hnewer.", "  fail.")
        await ProofEditTransaction.begin({
          sessionID: "best-certificate-old",
          parentSessionID: "",
          agent: "prover",
          file,
          source,
          scope: { kind: "theorem_body", theorem: "Lemma3_05" },
        })
        ProofEditTransaction.stage({
          sessionID: "best-certificate-old",
          file,
          before: source,
          after: mostCertified,
        })
        ProofEditTransaction.markCertifiedRecovery({
          sessionID: "best-certificate-old",
          file,
          source: mostCertified,
          receipt: {
            kind: "region_certified",
            certified_semantic_debt_count: 3,
            after_unresolved_semantic_debt: 2,
          },
        })
        expect(ProofEditTransaction.requiresValidation("best-certificate-old", file)).toBe(false)
        ProofEditTransaction.stage({
          sessionID: "best-certificate-old",
          file,
          before: mostCertified,
          after: newerButWorse,
        })
        expect(ProofEditTransaction.requiresValidation("best-certificate-old", file)).toBe(true)
        const newerMarked = ProofEditTransaction.markCertifiedRecovery({
          sessionID: "best-certificate-old",
          file,
          source: newerButWorse,
          receipt: {
            kind: "region_certified",
            certified_semantic_debt_count: 2,
            after_unresolved_semantic_debt: 3,
          },
        })
        expect(newerMarked).toMatchObject({
          certified_revision: 1,
          recovery_snapshot_updated: false,
          validation_pending: false,
        })
        expect(ProofEditTransaction.requiresValidation("best-certificate-old", file)).toBe(false)
        ProofEditTransaction.stage({
          sessionID: "best-certificate-old",
          file,
          before: newerButWorse,
          after: failedDraft,
        })
        SessionStatus.set("best-certificate-old", { type: "idle" })

        const recovered = ProofEditTransaction.recoverLatest({
          sessionID: "best-certificate-fresh",
          parentSessionID: "",
          agent: "prover",
          file,
          source,
          theorem: "Lemma3_05",
        })
        expect(recovered).toMatchObject({
          recovery_base: "best_certified",
          certified_revision: 1,
          certified_region_count: 3,
          preserved_draft_revision: 3,
        })
        expect(ProofEditTransaction.source("best-certificate-fresh", file)).toBe(mostCertified)
        ProofEditTransaction.abort("best-certificate-fresh")
      },
    })
  })

  test("chooses the transaction with the most certified regions before scope or recency", async () => {
    await using fixture = await tmpdir({ git: true })
    const file = path.join(fixture.path, "lemma3-best-transaction.v")
    await fs.writeFile(file, source, "utf-8")

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const better = source.replace("  exact I.", "  pose proof I as Hbetter.\n  exact Hbetter.")
        await ProofEditTransaction.begin({
          sessionID: "better-body-transaction",
          parentSessionID: "",
          agent: "prover",
          file,
          source,
          scope: { kind: "theorem_body", theorem: "Lemma3_05" },
        })
        ProofEditTransaction.stage({
          sessionID: "better-body-transaction",
          file,
          before: source,
          after: better,
        })
        ProofEditTransaction.markCertifiedRecovery({
          sessionID: "better-body-transaction",
          file,
          source: better,
          receipt: {
            kind: "region_certified",
            certified_semantic_debt_count: 4,
            after_unresolved_semantic_debt: 1,
          },
        })
        expect((await ProofEditTransaction.finalize("better-body-transaction"))?.status).toBe("recoverable")

        const newer = source.replace("  exact I.", "  pose proof I as Hnewer.\n  exact Hnewer.")
        await ProofEditTransaction.begin({
          sessionID: "newer-spine-transaction",
          parentSessionID: "",
          agent: "prover",
          file,
          source,
          scope: { kind: "theorem_spine", theorem: "Lemma3_05" },
        })
        ProofEditTransaction.stage({
          sessionID: "newer-spine-transaction",
          file,
          before: source,
          after: newer,
        })
        ProofEditTransaction.markCertifiedRecovery({
          sessionID: "newer-spine-transaction",
          file,
          source: newer,
          receipt: {
            kind: "region_certified",
            certified_semantic_debt_count: 1,
            after_unresolved_semantic_debt: 4,
          },
        })
        expect((await ProofEditTransaction.finalize("newer-spine-transaction"))?.status).toBe("recoverable")

        const recovered = ProofEditTransaction.recoverLatest({
          sessionID: "best-transaction-fresh",
          parentSessionID: "",
          agent: "prover",
          file,
          source,
          theorem: "Lemma3_05",
        })
        expect(recovered).toMatchObject({
          scope: "theorem_body",
          recovery_base: "best_certified",
          certified_region_count: 4,
        })
        expect(ProofEditTransaction.source("best-transaction-fresh", file)).toBe(better)
        ProofEditTransaction.abort("best-transaction-fresh")
      },
    })
  })

  test("stalled repair yields the best certified snapshot and preserves the failed draft", async () => {
    await using fixture = await tmpdir({ git: true })
    const file = path.join(fixture.path, "lemma3.v")
    await fs.writeFile(file, source, "utf-8")

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const certified = source.replace("  exact I.", "  pose proof I as H.\n  exact H.")
        const failed = certified.replace("  exact H.", "  fail.")
        await ProofEditTransaction.begin({
          sessionID: "repair-stalled-child",
          parentSessionID: "repair-stalled-parent",
          agent: "prover",
          file,
          source,
          scope: { kind: "theorem_body", theorem: "Lemma3_05" },
        })
        ProofEditTransaction.stage({ sessionID: "repair-stalled-child", file, before: source, after: certified })
        ProofEditTransaction.markAccepted({
          sessionID: "repair-stalled-child",
          file,
          source: certified,
          receipt: { kind: "region_certified" },
        })
        ProofEditTransaction.stage({ sessionID: "repair-stalled-child", file, before: certified, after: failed })

        const yielded = ProofEditTransaction.yieldStalledRepair({
          sessionID: "repair-stalled-child",
          handoffToSessionID: "repair-stalled-parent",
          handoffScope: { kind: "theorem_body", theorem: "Lemma3_05" },
        })
        expect(yielded).toMatchObject({
          status: "handed_off",
          handoff_session_id: "repair-stalled-parent",
          recovery_base: "best_certified",
          certified_revision: 1,
          preserved_draft_revision: 2,
          yielded_from_revision: 2,
        })
        expect(yielded?.yielded_from_hash).toBe(yielded?.preserved_draft_hash)
        expect(yielded?.resume_revision).toBeGreaterThan(yielded?.yielded_from_revision ?? 0)
        expect(ProofEditTransaction.source("repair-stalled-parent", file)).toBe(certified)
        expect(ProofEditTransaction.active("repair-stalled-child")).toBeUndefined()
        expect(await fs.readFile(file, "utf-8")).toBe(source)
        ProofEditTransaction.abort("repair-stalled-parent")
      },
    })
  })

  test("stalled repair without a certificate returns to base and journals the failed draft", async () => {
    await using fixture = await tmpdir({ git: true })
    const file = path.join(fixture.path, "lemma3.v")
    await fs.writeFile(file, source, "utf-8")

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const failed = source.replace("  exact I.", "  fail.")
        await ProofEditTransaction.begin({
          sessionID: "repair-no-cert-child",
          parentSessionID: "repair-no-cert-parent",
          agent: "prover",
          file,
          source,
          scope: { kind: "theorem_body", theorem: "Lemma3_05" },
        })
        ProofEditTransaction.stage({ sessionID: "repair-no-cert-child", file, before: source, after: failed })

        const yielded = ProofEditTransaction.yieldStalledRepair({
          sessionID: "repair-no-cert-child",
          handoffToSessionID: "repair-no-cert-parent",
          handoffScope: { kind: "theorem_body", theorem: "Lemma3_05" },
        })
        expect(yielded).toMatchObject({
          status: "handed_off",
          handoff_session_id: "repair-no-cert-parent",
          recovery_base: "current_draft",
          committable_snapshot: false,
          preserved_draft_revision: 1,
          yielded_from_revision: 1,
        })
        expect(yielded?.yielded_from_hash).toBe(yielded?.preserved_draft_hash)
        expect(ProofEditTransaction.source("repair-no-cert-parent", file)).toBe(source)
        expect(await fs.readFile(file, "utf-8")).toBe(source)
        ProofEditTransaction.abort("repair-no-cert-parent")
      },
    })
  })

  test("stalled lemma handoff preserves the exact unaccepted draft for parent review", async () => {
    await using fixture = await tmpdir({ git: true })
    const file = path.join(fixture.path, "lemma3.v")
    await fs.writeFile(file, source, "utf-8")

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const failed = source.replace("  exact I.", "  pose proof I as Hroute.\n  fail.")
        await ProofEditTransaction.begin({
          sessionID: "lemma-stalled-child",
          parentSessionID: "lemma-stalled-parent",
          agent: "lemma",
          file,
          source,
          scope: { kind: "theorem_body", theorem: "Lemma3_05" },
        })
        ProofEditTransaction.stage({
          sessionID: "lemma-stalled-child",
          file,
          before: source,
          after: failed,
        })
        ProofEditTransaction.markDebug({
          sessionID: "lemma-stalled-child",
          file,
          source: failed,
          receipt: {
            kind: "first_error_advanced",
            level: "debug",
            first_error_after: { line: 3, normalized_error: "The command has indeed failed" },
          },
        })

        const yielded = ProofEditTransaction.yieldStalledRepair({
          sessionID: "lemma-stalled-child",
          handoffToSessionID: "lemma-stalled-parent",
          handoffScope: { kind: "theorem_body", theorem: "Lemma3_05" },
          draftPolicy: "preserve_current",
        })
        expect(yielded).toMatchObject({
          status: "handed_off",
          handoff_session_id: "lemma-stalled-parent",
          draft_policy: "preserve_current",
          draft_preserved: true,
          recovery_base: "current_draft",
          validation_pending: true,
          yielded_from_revision: 1,
          resume_revision: 1,
          diagnostic_revision: 1,
          diagnostic_progress_level: "debug",
          preserved_draft_revision: 1,
        })
        expect(yielded?.resume_hash).toBe(yielded?.yielded_from_hash)
        expect(yielded?.diagnostic_receipt).toMatchObject({ kind: "first_error_advanced" })
        expect(ProofEditTransaction.source("lemma-stalled-parent", file)).toBe(failed)
        expect(ProofEditTransaction.requiresStagedRead("lemma-stalled-parent", file)).toBe(true)
        ProofEditTransaction.acknowledgeStagedRead("lemma-stalled-parent", file)
        expect(ProofEditTransaction.requiresStagedRead("lemma-stalled-parent", file)).toBe(false)
        expect(await fs.readFile(file, "utf-8")).toBe(source)
        ProofEditTransaction.abort("lemma-stalled-parent")
      },
    })
  })

  test("commits the last compiler-accepted snapshot atomically", async () => {
    await using fixture = await tmpdir({ git: true })
    const file = path.join(fixture.path, "lemma3.v")
    await fs.writeFile(file, source, "utf-8")
    await fs.chmod(file, 0o600)

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionID = "worker-accepted"
        await ProofEditTransaction.begin({
          sessionID,
          parentSessionID: "parent",
          agent: "fixer",
          file,
          source,
          scope: { kind: "theorem_body", theorem: "Lemma3_05" },
        })
        const accepted = source.replace("  exact I.", "  constructor.")
        ProofEditTransaction.stage({ sessionID, file, before: source, after: accepted })
        ProofEditTransaction.markAccepted({
          sessionID,
          file,
          source: accepted,
          level: "hard",
          receipt: { kind: "compiler_certificate" },
        })

        // A later failed experiment remains staged, but must not replace the
        // last accepted source selected for commit.
        const laterFailed = accepted.replace("  constructor.", "  fail.")
        ProofEditTransaction.stage({ sessionID, file, before: accepted, after: laterFailed })
        const finalized = await ProofEditTransaction.finalize(sessionID)
        expect(finalized?.status).toBe("committed")
        expect(await fs.readFile(file, "utf-8")).toBe(accepted)
        expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
        expect((await fs.readdir(fixture.path)).filter((entry) => entry.endsWith(".tmp"))).toEqual([])
      },
    })
  })

  test("apply_patch updates the staged view without touching the workspace file", async () => {
    await using fixture = await tmpdir({ git: true })
    const file = path.join(fixture.path, "lemma3.v")
    await fs.writeFile(file, source, "utf-8")

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionID = "worker-patch"
        await ProofEditTransaction.begin({
          sessionID,
          parentSessionID: "parent",
          agent: "fixer",
          file,
          source,
          scope: { kind: "theorem_body", theorem: "Lemma3_05" },
        })
        const applyPatch = await ApplyPatchTool.init()
        const result = await applyPatch.execute(
          {
            patchText: [
              "*** Begin Patch",
              "*** Update File: lemma3.v",
              "@@",
              "-  exact I.",
              "+  constructor.",
              "*** End Patch",
            ].join("\n"),
          },
          context(sessionID),
        )
        expect(result.output).toContain("Staged the authorized proof edit")
        expect(await fs.readFile(file, "utf-8")).toBe(source)
        expect(ProofEditTransaction.source(sessionID, file)).toContain("constructor.")
        ProofEditTransaction.abort(sessionID)
      },
    })
  })

  test("explicit theorem-spine authorization permits a substantive statement remodel", async () => {
    await using fixture = await tmpdir({ git: true })
    const file = path.join(fixture.path, "lemma3.v")
    await fs.writeFile(file, source, "utf-8")

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionID = "worker-spine-remodel"
        await ProofEditTransaction.begin({
          sessionID,
          parentSessionID: "parent",
          agent: "prover",
          file,
          source,
          scope: { kind: "theorem_spine", theorem: "Lemma3_05" },
        })
        const remodeled = source
          .replace("Lemma Lemma3_05 : True.", "Lemma Lemma3_05 : True /\\ True.")
          .replace("  exact I.", "  split; exact I.")
        const staged = ProofEditTransaction.stage({ sessionID, file, before: source, after: remodeled })
        expect(staged?.scope).toBe("theorem_spine")
        expect(ProofEditTransaction.source(sessionID, file)).toContain("True /\\ True")
        expect(await fs.readFile(file, "utf-8")).toBe(source)
        ProofEditTransaction.abort(sessionID)
      },
    })
  })

  test("checkpoint compiles staged source and records an accepted snapshot", async () => {
    await using fixture = await tmpdir({ git: true })
    const file = path.join(fixture.path, "checkpoint.v")
    const admitted = "Lemma demo : True.\nProof.\n  admit.\nAdmitted.\n"
    const proved = "Lemma demo : True.\nProof.\n  exact I.\nQed.\n"
    await fs.writeFile(file, admitted, "utf-8")

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })
        SessionProof.set(child.id, file, { line: 2, character: 2 }, "manual")
        await ProofEditTransaction.begin({
          sessionID: child.id,
          parentSessionID: parent.id,
          agent: "fixer",
          file,
          source: admitted,
          scope: { kind: "theorem_body", theorem: "demo" },
        })
        ProofEditTransaction.stage({ sessionID: child.id, file, before: admitted, after: proved })

        const checkpoint = await CheckpointTool.init()
        const result = await checkpoint.execute(
          { file, reason: "milestone" },
          context(child.id),
        )
        expect(result.output).toContain("accepted_progress: true")
        expect(result.output).toContain("hard snapshot updated")
        expect(await fs.readFile(file, "utf-8")).toBe(admitted)

        const finalized = await ProofEditTransaction.finalize(child.id)
        expect(finalized?.status).toBe("committed")
        expect(await fs.readFile(file, "utf-8")).toBe(proved)
        await Session.remove(child.id)
        await Session.remove(parent.id)
      },
    })
  })
})
