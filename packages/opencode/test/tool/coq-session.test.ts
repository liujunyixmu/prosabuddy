import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { createHash } from "crypto"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionProof } from "../../src/session/session-proof"
import { SessionProofWorkflow } from "../../src/session/proof-workflow"
import * as CoqProject from "../../src/tool/coq-project"
import {
  CoqSessionTool,
  findContextNormalizationAudit,
} from "../../src/tool/coq-session"
import type { Tool } from "../../src/tool/tool"
import { tmpdir } from "../fixture/fixture"

function context(sessionID: string, agent: Tool.Context["agent"] = "lemma"): Tool.Context {
  return {
    sessionID,
    messageID: `msg_${sessionID}`,
    callID: `call_${sessionID}`,
    agent,
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => {},
    ask: async () => {},
  }
}

function assignedRegionSource(note = "") {
  return [
    "Lemma demo : True.",
    "Proof.",
    "(* proof_region begin owner: lemma admit_id: gap_1 theorem: demo kind: pointwise_semantic_bridge target: Hgap *)",
    note,
    "have Hgap : True.",
    "{",
    "  admit. (* admit_id: gap_1 *)",
    "}",
    "(* proof_region end admit_id: gap_1 *)",
    "exact Hgap.",
    "Admitted.",
    "",
  ].filter((line) => line !== "").join("\n")
}

function bindAssignedRegion(sessionID: string, file: string, source: string) {
  SessionProof.set(sessionID, file, { line: 1, character: 0 }, "manual")
  SessionProofWorkflow.refresh(sessionID, file, source)
  SessionProofWorkflow.bindActiveLemmaAssignment(sessionID, {
    file,
    theorem: "demo",
    admit_id: "gap_1",
    goal: "True",
    replace: "Replace proof_region gap_1 while preserving Hgap : True.",
    skeleton: source,
    done: "Return a compiler-checkable proof of Hgap with no admit.",
  })
}

describe("tool.coq_session context inspection", () => {
  let contextSpy: ReturnType<typeof spyOn> | undefined
  let runSpy: ReturnType<typeof spyOn> | undefined

  afterEach(() => {
    contextSpy?.mockRestore()
    runSpy?.mockRestore()
    contextSpy = undefined
    runSpy = undefined
  })

  test("inspect records verified read-only convertibility evidence without changing tactic state", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/inspect.v`
        await Bun.write(file, ["Lemma demo : True.", "Proof.", "  exact I.", "Qed.", ""].join("\n"))

        let auditOutcome: "convertible" | "not_convertible" | "inconclusive" = "convertible"
        contextSpy = spyOn(CoqProject, "context").mockImplementation(async (_file, theorem, preamble) => ({
          root: tmp.path,
          file,
          theorem,
          project_path: null,
          flags: [],
          cwd: tmp.path,
          preamble,
        }))
        runSpy = spyOn(CoqProject, "run").mockImplementation(async (code) => {
          if (!code.includes("__prosabuddy_context_audit_")) {
            return {
              exit: 0,
              stdout: "1 goal\n\n============================\nTrue",
              stderr: "",
            }
          }
          if (auditOutcome === "convertible") {
            return { exit: 0, stdout: "1 goal\n\n============================\nTrue", stderr: "" }
          }
          if (auditOutcome === "not_convertible") {
            return { exit: 1, stdout: "", stderr: "Error: Unable to unify right with left." }
          }
          return { exit: 1, stdout: "", stderr: "Error: Syntax error while parsing the inspection." }
        })

        const tool = await CoqSessionTool.init()
        const cases = ["convertible", "not_convertible", "inconclusive"] as const
        for (const [index, expected] of cases.entries()) {
          auditOutcome = expected
          const sessionID = `coq-inspect-${index}`
          const ctx = context(sessionID)
          await tool.execute({ op: "open", file, theorem: "demo" }, ctx)
          const before = await tool.execute({ op: "status" }, ctx)
          const inspected = await tool.execute(
            {
              op: "inspect",
              symbols: ["I"],
              left_expression: "True",
              right_expression: "True",
            },
            ctx,
          )
          const after = await tool.execute({ op: "status" }, ctx)

          expect(inspected.metadata.context_audit).toMatchObject({
            outcome: expected,
            inspected_symbols: ["I"],
            left_expression: "True",
            right_expression: "True",
            verified: true,
          })
          const auditID = inspected.metadata.context_audit.audit_id as string
          expect(findContextNormalizationAudit(sessionID, auditID)).toEqual(
            inspected.metadata.context_audit,
          )
          expect(before.output).toContain("Tactics: 0 (0 ok, 0 fail)")
          expect(after.output).toBe(before.output)

          await tool.execute({ op: "close" }, ctx)
        }
      },
    })
  })

  test("open ignores blank inspect-only expressions while inspect still requires them", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/open-with-blank-inspect-fields.v`
        await Bun.write(file, ["Lemma demo : True.", "Proof.", "  exact I.", "Qed.", ""].join("\n"))
        contextSpy = spyOn(CoqProject, "context").mockImplementation(async (_file, theorem, preamble) => ({
          root: tmp.path,
          file,
          theorem,
          project_path: null,
          flags: [],
          cwd: tmp.path,
          preamble,
        }))
        runSpy = spyOn(CoqProject, "run").mockImplementation(async () => ({
          exit: 0,
          stdout: "1 goal\n\n============================\nTrue",
          stderr: "",
        }))

        const tool = await CoqSessionTool.init()
        const ctx = context("coq-open-blank-inspect-fields")
        const opened = await tool.execute(
          { op: "open", file, theorem: "demo", left_expression: "", right_expression: "" },
          ctx,
        )
        expect(opened.metadata.op).toBe("open")

        await expect(
          tool.execute({ op: "inspect", left_expression: "", right_expression: "" }, ctx),
        ).rejects.toThrow("inspect requires left_expression and right_expression")

        await tool.execute({ op: "close" }, ctx)
      },
    })
  })

  test("inspect rejects expressions that can escape into vernacular commands", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/inspect-injection.v`
        await Bun.write(file, ["Lemma demo : True.", "Proof.", "  exact I.", "Qed.", ""].join("\n"))
        contextSpy = spyOn(CoqProject, "context").mockImplementation(async (_file, theorem, preamble) => ({
          root: tmp.path,
          file,
          theorem,
          project_path: null,
          flags: [],
          cwd: tmp.path,
          preamble,
        }))
        let injected = false
        runSpy = spyOn(CoqProject, "run").mockImplementation(async (code) => {
          if (code.includes("Redirect")) injected = true
          return { exit: 0, stdout: "1 goal\n\n============================\nTrue", stderr: "" }
        })

        const tool = await CoqSessionTool.init()
        const ctx = context("coq-inspect-injection")
        await tool.execute({ op: "open", file, theorem: "demo" }, ctx)
        await expect(
          tool.execute(
            {
              op: "inspect",
              left_expression:
                'True) = (True)) by reflexivity. Redirect "/tmp/should-not-run" Print True. assert (__x : (True',
              right_expression: "True",
            },
            ctx,
          ),
        ).rejects.toThrow()
        expect(injected).toBe(false)

        const qualified = await tool.execute(
          {
            op: "inspect",
            left_expression: "Datatypes.True",
            right_expression: "Datatypes.True",
          },
          ctx,
        )
        expect(qualified.metadata.context_audit.outcome).toBe("convertible")
        await tool.execute({ op: "close" }, ctx)
      },
    })
  })

  test("lemma open defaults to the assigned proof-region entry goal", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/assigned-region.v`
        const source = assignedRegionSource()
        const session = await Session.create({})
        await Bun.write(file, source)
        bindAssignedRegion(session.id, file, source)

        const preambles: string[] = []
        contextSpy = spyOn(CoqProject, "context").mockImplementation(async (_file, theorem, preamble) => {
          preambles.push(preamble)
          return {
            root: tmp.path,
            file,
            theorem,
            project_path: null,
            flags: [],
            cwd: tmp.path,
            preamble,
          }
        })
        runSpy = spyOn(CoqProject, "run").mockImplementation(async () => ({
          exit: 0,
          stdout: "1 goal\n\n============================\nTrue",
          stderr: "",
        }))

        const tool = await CoqSessionTool.init()
        const ctx = context(session.id)
        await expect(
          tool.execute({ op: "open", file, theorem: "demo", scope: "theorem" }, ctx),
        ).rejects.toThrow("theorem-scope open is not permitted")
        const opened = await tool.execute({ op: "open", file, theorem: "demo" }, ctx)

        expect(opened.metadata).toMatchObject({
          scope: "assigned_region",
          admit_id: "gap_1",
          kind: "proof_progress",
        })
        expect(opened.output).toContain("Scope: proof_region gap_1")
        expect(opened.output).toContain("1 goal")
        expect(preambles[0]?.trimEnd().endsWith("{")).toBe(true)
        expect(preambles[0]).not.toContain("admit. (* admit_id: gap_1 *)")

        await tool.execute({ op: "close" }, ctx)
        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("parent explicit proof-region open can step without a lemma assignment", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/explicit-region.v`
        const source = assignedRegionSource()
        const session = await Session.create({})
        await Bun.write(file, source)
        SessionProof.set(session.id, file, { line: 1, character: 0 }, "manual")

        contextSpy = spyOn(CoqProject, "context").mockImplementation(async (_file, theorem, preamble) => ({
          root: tmp.path,
          file,
          theorem,
          project_path: null,
          flags: [],
          cwd: tmp.path,
          preamble,
        }))
        runSpy = spyOn(CoqProject, "run").mockImplementation(async (code) =>
          code.includes("exact I.")
            ? { exit: 0, stdout: "No more goals.", stderr: "" }
            : { exit: 0, stdout: "1 goal\n\n============================\nTrue", stderr: "" },
        )

        const tool = await CoqSessionTool.init()
        const ctx = context(session.id, "prover")
        const opened = await tool.execute(
          {
            op: "open",
            file,
            theorem: "demo",
            scope: "assigned_region",
            admit_id: "gap_1",
            proof_position: { line: 5, character: 2 },
            expected_goal: "True",
          },
          ctx,
        )
        expect(opened.metadata).toMatchObject({
          scope: "assigned_region",
          region_binding: "explicit",
          admit_id: "gap_1",
        })

        const stepped = await tool.execute({ op: "step", tactic: "exact I." }, ctx)
        expect(stepped.metadata).toMatchObject({
          kind: "proof_progress",
          admit_id: "gap_1",
        })
        expect(stepped.output).toContain("[proof_progress]")
        expect(stepped.output).not.toContain("active assignment")

        await tool.execute({ op: "close" }, ctx)
        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("step rebuilds a drifted certified prefix before replaying tactics", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/prefix-drift.v`
        const source = assignedRegionSource()
        const session = await Session.create({})
        await Bun.write(file, source)
        bindAssignedRegion(session.id, file, source)

        const preambles: string[] = []
        contextSpy = spyOn(CoqProject, "context").mockImplementation(async (_file, theorem, preamble) => {
          preambles.push(preamble)
          return {
            root: tmp.path,
            file,
            theorem,
            project_path: null,
            flags: [],
            cwd: tmp.path,
            preamble,
          }
        })
        runSpy = spyOn(CoqProject, "run").mockImplementation(async (code) =>
          code.includes("exact I.")
            ? { exit: 0, stdout: "No more goals.", stderr: "" }
            : { exit: 0, stdout: "1 goal\n\n============================\nTrue", stderr: "" },
        )

        const tool = await CoqSessionTool.init()
        const ctx = context(session.id)
        await tool.execute({ op: "open", file, theorem: "demo" }, ctx)

        const drifted = assignedRegionSource("(* harmless certified-prefix note *)")
        await Bun.write(file, drifted)
        const stepped = await tool.execute({ op: "step", tactic: "exact I." }, ctx)

        expect(stepped.metadata).toMatchObject({
          kind: "proof_progress",
          resynced: true,
          admit_id: "gap_1",
        })
        expect(preambles).toHaveLength(2)
        expect(preambles[1]).toContain("harmless certified-prefix note")

        await tool.execute({ op: "close" }, ctx)
        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("accepts an expected fingerprint produced from the full semantic goal", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/semantic-fingerprint.v`
        const source = assignedRegionSource()
        const session = await Session.create({})
        await Bun.write(file, source)
        bindAssignedRegion(session.id, file, source)

        contextSpy = spyOn(CoqProject, "context").mockImplementation(async (_file, theorem, preamble) => ({
          root: tmp.path,
          file,
          theorem,
          project_path: null,
          flags: [],
          cwd: tmp.path,
          preamble,
        }))
        const goal = "1 goal\n\nH : True\n============================\nTrue"
        runSpy = spyOn(CoqProject, "run").mockImplementation(async (code) =>
          code.includes("exact I.")
            ? { exit: 0, stdout: "No more goals.", stderr: "" }
            : { exit: 0, stdout: goal, stderr: "" },
        )
        const semanticFingerprint = createHash("sha256")
          .update("H : True ============================ True")
          .digest("hex")

        const tool = await CoqSessionTool.init()
        const ctx = context(session.id)
        const opened = await tool.execute(
          {
            op: "open",
            file,
            theorem: "demo",
            expected_goal: "True",
            expected_goal_fingerprint: semanticFingerprint,
          },
          ctx,
        )
        expect(opened.metadata.kind).toBe("proof_progress")

        const stepped = await tool.execute({ op: "step", tactic: "exact I." }, ctx)
        expect(stepped.metadata).toMatchObject({ kind: "proof_progress", admit_id: "gap_1" })

        await tool.execute({ op: "close" }, ctx)
        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("accepts a greater-equal assignment goal when Coq prints the reversed less-equal form", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/comparison-notation.v`
        const source = assignedRegionSource()
        const session = await Session.create({})
        await Bun.write(file, source)
        bindAssignedRegion(session.id, file, source)
        const expected = "left >= right"
        const expectedFingerprint = createHash("sha256").update(expected).digest("hex")
        SessionProofWorkflow.bindActiveLemmaAssignment(session.id, {
          file,
          theorem: "demo",
          admit_id: "gap_1",
          goal: expected,
          goal_fingerprint: expectedFingerprint,
          replace: "Replace proof_region gap_1 while preserving its exported target.",
          skeleton: source,
          done: "Return a compiler-checkable proof with no admit.",
        })

        contextSpy = spyOn(CoqProject, "context").mockImplementation(async (_file, theorem, preamble) => ({
          root: tmp.path,
          file,
          theorem,
          project_path: null,
          flags: [],
          cwd: tmp.path,
          preamble,
        }))
        runSpy = spyOn(CoqProject, "run").mockImplementation(async (code) =>
          code.includes("exact I.")
            ? { exit: 0, stdout: "No more goals.", stderr: "" }
            : { exit: 0, stdout: "1 goal\n\n============================\nright <= left", stderr: "" },
        )
        const tool = await CoqSessionTool.init()
        const ctx = context(session.id)
        const opened = await tool.execute(
          {
            op: "open",
            file,
            theorem: "demo",
          },
          ctx,
        )
        expect(opened.metadata.kind).toBe("proof_progress")

        const stepped = await tool.execute({ op: "step", tactic: "exact I." }, ctx)
        expect(stepped.metadata).toMatchObject({ kind: "proof_progress", admit_id: "gap_1" })

        await tool.execute({ op: "close" }, ctx)
        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("two goal mismatches return session_state_desync without submitting the tactic", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = `${tmp.path}/goal-desync.v`
        const source = assignedRegionSource()
        const session = await Session.create({})
        await Bun.write(file, source)
        bindAssignedRegion(session.id, file, source)

        contextSpy = spyOn(CoqProject, "context").mockImplementation(async (_file, theorem, preamble) => ({
          root: tmp.path,
          file,
          theorem,
          project_path: null,
          flags: [],
          cwd: tmp.path,
          preamble,
        }))
        const submitted: string[] = []
        let calls = 0
        runSpy = spyOn(CoqProject, "run").mockImplementation(async (code) => {
          submitted.push(code)
          calls += 1
          return calls === 1
            ? { exit: 0, stdout: "1 goal\n\n============================\nTrue", stderr: "" }
            : { exit: 0, stdout: "1 goal\n\n============================\nFalse", stderr: "" }
        })

        const tool = await CoqSessionTool.init()
        const ctx = context(session.id)
        await tool.execute({ op: "open", file, theorem: "demo" }, ctx)
        const blocked = await tool.execute({ op: "step", tactic: "exact I." }, ctx)

        expect(blocked.metadata).toMatchObject({
          kind: "session_state_desync",
          tactic_applied: false,
          desync_count: 2,
        })
        expect(blocked.output).toContain("session_state_desync")
        expect(submitted.filter((code) => code.includes("exact I."))).toHaveLength(0)
        expect(submitted).toHaveLength(3)

        await tool.execute({ op: "close" }, ctx)
        SessionProofWorkflow.clear(session.id)
        SessionProof.clear(session.id)
        await Session.remove(session.id)
      },
    })
  })
})
