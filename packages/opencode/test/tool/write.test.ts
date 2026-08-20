import { describe, test, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { WriteTool } from "../../src/tool/write"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionProof } from "../../src/session/session-proof"
import { ProofEditTransaction } from "../../src/session/proof-edit-transaction"
import { FileTime } from "../../src/file/time"
import { Session } from "../../src/session"

const ctx = {
  sessionID: "test-write-session",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.write", () => {
  describe("new file creation", () => {
    test("writes content to new file", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "newfile.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const write = await WriteTool.init()
          const result = await write.execute(
            {
              filePath: filepath,
              content: "Hello, World!",
            },
            ctx,
          )

          expect(result.output).toContain("Wrote file successfully")
          expect(result.metadata.exists).toBe(false)

          const content = await fs.readFile(filepath, "utf-8")
          expect(content).toBe("Hello, World!")
        },
      })
    })

    test("creates parent directories if needed", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "nested", "deep", "file.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const write = await WriteTool.init()
          await write.execute(
            {
              filePath: filepath,
              content: "nested content",
            },
            ctx,
          )

          const content = await fs.readFile(filepath, "utf-8")
          expect(content).toBe("nested content")
        },
      })
    })

    test("handles relative paths by resolving to instance directory", async () => {
      await using tmp = await tmpdir()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const write = await WriteTool.init()
          await write.execute(
            {
              filePath: "relative.txt",
              content: "relative content",
            },
            ctx,
          )

          const content = await fs.readFile(path.join(tmp.path, "relative.txt"), "utf-8")
          expect(content).toBe("relative content")
        },
      })
    })
  })

  describe("existing file overwrite", () => {
    test("stages bound proof rewrites in the active transaction without touching disk", async () => {
      await using tmp = await tmpdir({ git: true })
      const filepath = path.join(tmp.path, "theorem.v")
      const source = "Lemma demo : True.\nProof.\n  admit.\nAdmitted.\n"
      const replacement = "Lemma demo : True.\nProof.\n  exact I.\nQed.\n"
      await fs.writeFile(filepath, source, "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          SessionProof.set(session.id, filepath, { line: 1, character: 0 }, "manual")
          await ProofEditTransaction.begin({
            sessionID: session.id,
            parentSessionID: "",
            agent: "prover",
            file: filepath,
            source,
            scope: { kind: "theorem_body", theorem: "demo" },
          })
          FileTime.read(session.id, filepath)

          const write = await WriteTool.init()
          const result = await write.execute(
            { filePath: filepath, content: replacement },
            { ...ctx, sessionID: session.id, agent: "prover" },
          )

          expect(result.output).toContain("Write staged in proof transaction")
          expect(result.metadata.proof_edit_transaction).toMatchObject({ revision: 1 })
          expect(result.metadata.diagnostics).toEqual({})
          expect(ProofEditTransaction.source(session.id, filepath)).toBe(replacement)
          expect(await fs.readFile(filepath, "utf-8")).toBe(source)

          ProofEditTransaction.abort(session.id)
          SessionProof.clear(session.id)
          await Session.remove(session.id)
        },
      })
    })

    test("rejects destructive bound theorem overwrite before permission or write", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "theorem.v")
      const source = "Lemma demo : True.\nProof.\n  admit.\nAdmitted.\n"
      await fs.writeFile(filepath, source, "utf-8")
      let permissionAsked = false

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const { FileTime } = await import("../../src/file/time")
          FileTime.read(session.id, filepath)
          SessionProof.set(session.id, filepath, { line: 1, character: 0 }, "manual")
          const write = await WriteTool.init()
          await expect(
            write.execute(
              {
                filePath: filepath,
                content: "Lemma replacement : True.\nProof. exact I. Qed.\n",
              },
              {
                ...ctx,
                sessionID: session.id,
                ask: async () => {
                  permissionAsked = true
                },
              },
            ),
          ).rejects.toThrow("proof_scope_integrity_rejection")
          expect(permissionAsked).toBe(false)
          expect(await fs.readFile(filepath, "utf-8")).toBe(source)
          await Session.remove(session.id)
          expect(SessionProof.get(session.id)).toBeUndefined()
        },
      })
    })

    test("rejects recreating a missing bound theorem before permission or write", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "theorem.v")
      const source = "Lemma demo : True.\nProof.\n  admit.\nAdmitted.\n"
      await fs.writeFile(filepath, source, "utf-8")
      let permissionAsked = false

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          SessionProof.set(session.id, filepath, { line: 1, character: 0 }, "manual")
          await fs.unlink(filepath)
          const write = await WriteTool.init()
          await expect(
            write.execute(
              {
                filePath: filepath,
                content: source,
              },
              {
                ...ctx,
                sessionID: session.id,
                ask: async () => {
                  permissionAsked = true
                },
              },
            ),
          ).rejects.toThrow("cannot initialize a bound proof scope without pristine existing source")
          expect(permissionAsked).toBe(false)
          await expect(fs.readFile(filepath, "utf-8")).rejects.toThrow()
          await Session.remove(session.id)
        },
      })
    })

    test("overwrites existing file content", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "existing.txt")
      await fs.writeFile(filepath, "old content", "utf-8")

      // First read the file to satisfy FileTime requirement
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { FileTime } = await import("../../src/file/time")
          FileTime.read(ctx.sessionID, filepath)

          const write = await WriteTool.init()
          const result = await write.execute(
            {
              filePath: filepath,
              content: "new content",
            },
            ctx,
          )

          expect(result.output).toContain("Wrote file successfully")
          expect(result.metadata.exists).toBe(true)

          const content = await fs.readFile(filepath, "utf-8")
          expect(content).toBe("new content")
        },
      })
    })

    test("returns diff in metadata for existing files", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "old", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { FileTime } = await import("../../src/file/time")
          FileTime.read(ctx.sessionID, filepath)

          const write = await WriteTool.init()
          const result = await write.execute(
            {
              filePath: filepath,
              content: "new",
            },
            ctx,
          )

          // Diff should be in metadata
          expect(result.metadata).toHaveProperty("filepath", filepath)
          expect(result.metadata).toHaveProperty("exists", true)
        },
      })
    })
  })

  describe("file permissions", () => {
    test("sets file permissions when writing sensitive data", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "sensitive.json")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const write = await WriteTool.init()
          await write.execute(
            {
              filePath: filepath,
              content: JSON.stringify({ secret: "data" }),
            },
            ctx,
          )

          // On Unix systems, check permissions
          if (process.platform !== "win32") {
            const stats = await fs.stat(filepath)
            expect(stats.mode & 0o777).toBe(0o644)
          }
        },
      })
    })
  })

  describe("content types", () => {
    test("writes JSON content", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "data.json")
      const data = { key: "value", nested: { array: [1, 2, 3] } }

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const write = await WriteTool.init()
          await write.execute(
            {
              filePath: filepath,
              content: JSON.stringify(data, null, 2),
            },
            ctx,
          )

          const content = await fs.readFile(filepath, "utf-8")
          expect(JSON.parse(content)).toEqual(data)
        },
      })
    })

    test("writes binary-safe content", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "binary.bin")
      const content = "Hello\x00World\x01\x02\x03"

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const write = await WriteTool.init()
          await write.execute(
            {
              filePath: filepath,
              content,
            },
            ctx,
          )

          const buf = await fs.readFile(filepath)
          expect(buf.toString()).toBe(content)
        },
      })
    })

    test("writes empty content", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "empty.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const write = await WriteTool.init()
          await write.execute(
            {
              filePath: filepath,
              content: "",
            },
            ctx,
          )

          const content = await fs.readFile(filepath, "utf-8")
          expect(content).toBe("")

          const stats = await fs.stat(filepath)
          expect(stats.size).toBe(0)
        },
      })
    })

    test("writes multi-line content", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "multiline.txt")
      const lines = ["Line 1", "Line 2", "Line 3", ""].join("\n")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const write = await WriteTool.init()
          await write.execute(
            {
              filePath: filepath,
              content: lines,
            },
            ctx,
          )

          const content = await fs.readFile(filepath, "utf-8")
          expect(content).toBe(lines)
        },
      })
    })

    test("handles different line endings", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "crlf.txt")
      const content = "Line 1\r\nLine 2\r\nLine 3"

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const write = await WriteTool.init()
          await write.execute(
            {
              filePath: filepath,
              content,
            },
            ctx,
          )

          const buf = await fs.readFile(filepath)
          expect(buf.toString()).toBe(content)
        },
      })
    })
  })

  describe("error handling", () => {
    test("throws error when OS denies write access", async () => {
      await using tmp = await tmpdir()
      const readonlyPath = path.join(tmp.path, "readonly.txt")

      // Create a read-only file
      await fs.writeFile(readonlyPath, "test", "utf-8")
      await fs.chmod(readonlyPath, 0o444)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { FileTime } = await import("../../src/file/time")
          FileTime.read(ctx.sessionID, readonlyPath)

          const write = await WriteTool.init()
          await expect(
            write.execute(
              {
                filePath: readonlyPath,
                content: "new content",
              },
              ctx,
            ),
          ).rejects.toThrow()
        },
      })
    })
  })

  describe("title generation", () => {
    test("returns relative path as title", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "src", "components", "Button.tsx")
      await fs.mkdir(path.dirname(filepath), { recursive: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const write = await WriteTool.init()
          const result = await write.execute(
            {
              filePath: filepath,
              content: "export const Button = () => {}",
            },
            ctx,
          )

          expect(result.title).toEndWith(path.join("src", "components", "Button.tsx"))
        },
      })
    })
  })
})
