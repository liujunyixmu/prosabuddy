import { describe, expect, test } from "bun:test"
import path from "path"
import { GrepTool } from "../../src/tool/grep"
import { Instance } from "../../src/project/instance"
import { ProofEditTransaction } from "../../src/session/proof-edit-transaction"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

const projectRoot = path.join(__dirname, "../..")

describe("tool.grep", () => {
  test("basic search", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const grep = await GrepTool.init()
        const result = await grep.execute(
          {
            pattern: "export",
            path: path.join(projectRoot, "src/tool"),
            include: "*.ts",
          },
          ctx,
        )
        expect(result.metadata.matches).toBeGreaterThan(0)
        expect(result.output).toContain("Found")
      },
    })
  })

  test("no matches returns correct output", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), "hello world")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const grep = await GrepTool.init()
        const result = await grep.execute(
          {
            pattern: "xyznonexistentpatternxyz123",
            path: tmp.path,
          },
          ctx,
        )
        expect(result.metadata.matches).toBe(0)
        expect(result.output).toBe("No files found")
      },
    })
  })

  test("handles CRLF line endings in output", async () => {
    // This test verifies the regex split handles both \n and \r\n
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Create a test file with content
        await Bun.write(path.join(dir, "test.txt"), "line1\nline2\nline3")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const grep = await GrepTool.init()
        const result = await grep.execute(
          {
            pattern: "line",
            path: tmp.path,
          },
          ctx,
        )
        expect(result.metadata.matches).toBeGreaterThan(0)
      },
    })
  })

  test("searches the active staged proof revision instead of stale disk", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = path.join(tmp.path, "theorem.v")
        const diskSource = [
          "Lemma demo : True.",
          "Proof.",
          "  (* disk_only *)",
          "  exact I.",
          "Qed.",
          "",
        ].join("\n")
        const stagedSource = diskSource.replace("disk_only", "staged_only")
        await Bun.write(file, diskSource)
        const sessionID = "grep-staged-proof"
        await ProofEditTransaction.begin({
          sessionID,
          parentSessionID: sessionID,
          agent: "prover",
          file,
          source: diskSource,
          scope: { kind: "theorem_body", theorem: "demo" },
        })
        ProofEditTransaction.stage({ sessionID, file, before: diskSource, after: stagedSource })

        const grep = await GrepTool.init()
        const stagedContext = { ...ctx, sessionID }
        const directoryResult = await grep.execute(
          { pattern: "staged_only", path: tmp.path, include: "*.v" },
          stagedContext,
        )
        expect(directoryResult.metadata.transaction_revision).toBe(1)
        expect(directoryResult.output).toContain("staged_only")
        expect(directoryResult.output).toContain("staged proof transaction revision 1")

        const staleResult = await grep.execute(
          { pattern: "disk_only", path: tmp.path, include: "*.v" },
          stagedContext,
        )
        expect(staleResult.metadata.matches).toBe(0)
        expect(staleResult.output).toBe("No files found")

        const fileResult = await grep.execute({ pattern: "staged_only", path: file }, stagedContext)
        expect(fileResult.output).toContain("staged_only")

        const excludedResult = await grep.execute(
          { pattern: "staged_only", path: tmp.path, include: "*.txt" },
          stagedContext,
        )
        expect(excludedResult.metadata.matches).toBe(0)

        ProofEditTransaction.abort(sessionID)
      },
    })
  })
})

describe("CRLF regex handling", () => {
  test("regex correctly splits Unix line endings", () => {
    const unixOutput = "file1.txt|1|content1\nfile2.txt|2|content2\nfile3.txt|3|content3"
    const lines = unixOutput.trim().split(/\r?\n/)
    expect(lines.length).toBe(3)
    expect(lines[0]).toBe("file1.txt|1|content1")
    expect(lines[2]).toBe("file3.txt|3|content3")
  })

  test("regex correctly splits Windows CRLF line endings", () => {
    const windowsOutput = "file1.txt|1|content1\r\nfile2.txt|2|content2\r\nfile3.txt|3|content3"
    const lines = windowsOutput.trim().split(/\r?\n/)
    expect(lines.length).toBe(3)
    expect(lines[0]).toBe("file1.txt|1|content1")
    expect(lines[2]).toBe("file3.txt|3|content3")
  })

  test("regex handles mixed line endings", () => {
    const mixedOutput = "file1.txt|1|content1\nfile2.txt|2|content2\r\nfile3.txt|3|content3"
    const lines = mixedOutput.trim().split(/\r?\n/)
    expect(lines.length).toBe(3)
  })
})
