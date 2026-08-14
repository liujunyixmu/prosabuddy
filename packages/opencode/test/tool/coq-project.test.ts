import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { normalizeLoadpathFlags, parse, resolve, runProcess, withTemporaryScript } from "../../src/tool/coq-project"
import { tmpdir } from "../fixture/fixture"

describe("coq-project", () => {
  test("runProcess kills a timed-out process group", async () => {
    const result = await runProcess(["sh", "-c", "sleep 5"], process.cwd(), { timeoutMs: 50 })
    expect(result.timedOut).toBe(true)
    expect(result.exit).not.toBe(0)
  })

  test("runProcess caps combined subprocess output", async () => {
    const result = await runProcess(
      ["sh", "-c", "head -c 65536 /dev/zero | tr '\\0' x"],
      process.cwd(),
      { timeoutMs: 5_000, maxOutputBytes: 1024 },
    )
    expect(result.outputLimitExceeded).toBe(true)
    expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(1024)
  })

  describe("parse", () => {
    test("extracts flags from _CoqProject content", () => {
      const content = `-Q . MyLib\n-R theories Theories\nfile.v\nother.v`
      const flags = parse(content)
      expect(flags).toEqual(["-Q", ".", "MyLib", "-R", "theories", "Theories"])
    })

    test("ignores comments and empty lines", () => {
      const content = `# comment\n\n-Q . Lib\n# another comment`
      const flags = parse(content)
      expect(flags).toEqual(["-Q", ".", "Lib"])
    })

    test("ignores .v file references", () => {
      const content = `src/main.v\nlib/helper.v\n-Q . Lib`
      const flags = parse(content)
      expect(flags).toEqual(["-Q", ".", "Lib"])
    })

    test("handles quoted arguments", () => {
      const content = `-Q "my dir" MyLib`
      const flags = parse(content)
      expect(flags).toEqual(["-Q", "my dir", "MyLib"])
    })

    test("expands _CoqProject -arg entries into compiler flags", () => {
      const content = `-arg "-w -notation-overriden,-parsing,-projection-no-head-constant,-ambiguous-paths"\n-R /home/junyi/Prosa prosa`
      const flags = parse(content)
      expect(flags).toEqual([
        "-w",
        "-notation-overriden,-parsing,-projection-no-head-constant,-ambiguous-paths",
        "-R",
        "/home/junyi/Prosa",
        "prosa",
      ])
    })

    test("returns empty for empty content", () => {
      expect(parse("")).toEqual([])
      expect(parse("\n\n")).toEqual([])
    })

    test("rewrites legacy Prosa root when configured", () => {
      const before = process.env.OPENCODE_PROSA_ROOT
      process.env.OPENCODE_PROSA_ROOT = process.cwd()
      try {
        const flags = normalizeLoadpathFlags(["-R", "/home/junyi/Prosa", "prosa"])
        expect(flags).toEqual(["-R", process.cwd(), "prosa"])
      } finally {
        if (before === undefined) delete process.env.OPENCODE_PROSA_ROOT
        else process.env.OPENCODE_PROSA_ROOT = before
      }
    })
  })

  describe("resolve", () => {
    test("finds the same project from a file path or its directory", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const project = path.join(dir, "project")
          const nested = path.join(project, "proofs")
          await fs.mkdir(nested, { recursive: true })
          await Bun.write(path.join(project, "_CoqProject"), "-R prosa prosa\n")
          await Bun.write(path.join(nested, "theorem.v"), "Check nat.\n")
          return { project, nested }
        },
      })

      const fromFile = await resolve(path.join(tmp.extra.nested, "theorem.v"))
      const fromDirectory = await resolve(tmp.extra.nested)

      expect(fromFile).toEqual(fromDirectory)
      expect(fromFile.cwd).toBe(tmp.extra.project)
      expect(fromFile.project).toBe(path.join(tmp.extra.project, "_CoqProject"))
      expect(fromFile.flags).toEqual(["-R", "prosa", "prosa"])
    })
  })

  describe("withTemporaryScript", () => {
    test("writes under the supplied temporary root and removes the script afterward", async () => {
      await using tmp = await tmpdir()
      let script = ""

      const result = await withTemporaryScript(
        "coq-project-test-",
        "Check nat.\n",
        async (scriptPath) => {
          script = scriptPath
          expect(scriptPath.startsWith(tmp.path + path.sep)).toBe(true)
          expect(await fs.readFile(scriptPath, "utf8")).toBe("Check nat.\n")
          return "ok"
        },
        tmp.path,
      )

      expect(result).toBe("ok")
      expect(
        await fs
          .stat(script)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
    })
  })
})
