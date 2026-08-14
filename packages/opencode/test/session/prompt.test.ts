import path from "path"
import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "url"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionProof } from "../../src/session/session-proof"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("session.prompt accepted-plan materialization tool gate", () => {
  test("keeps lookup tools available during the soft reminder grace window", () => {
    const tools: Record<string, unknown> = {
      read: {},
      grep: {},
      edit: {},
      coq_session: {},
      checkpoint: {},
    }

    const gate = SessionPrompt.applyAcceptedPlanMaterializationToolGate(tools, 15)

    expect(gate).toMatchObject({ active: false, warning_limit: 12, hard_limit: 16 })
    expect(Object.keys(tools).sort()).toEqual(["checkpoint", "coq_session", "edit", "grep", "read"])
  })

  test("gates broad lookup without changing the provider tool schema", async () => {
    const executable = () => ({ execute: async () => ({ output: "original" }) })
    const tools: Record<string, unknown> = {
      read: executable(),
      grep: executable(),
      glob: executable(),
      lsp: executable(),
      coqtop: executable(),
      bash: executable(),
      task: executable(),
      proof_plan: executable(),
      edit: {},
      multiedit: {},
      write: {},
      apply_patch: {},
      coq_session: {},
      petanque: {},
      checkpoint: {},
      coqc: {},
    }

    const gate = SessionPrompt.applyAcceptedPlanMaterializationToolGate(tools, 16)

    expect(gate.active).toBe(true)
    expect(gate.blocked_tools).toEqual(expect.arrayContaining([
      "read",
      "grep",
      "glob",
      "lsp",
      "coqtop",
      "bash",
      "task",
      "proof_plan",
    ]))
    expect(Object.keys(tools).sort()).toEqual([
      "apply_patch",
      "bash",
      "checkpoint",
      "coq_session",
      "coqc",
      "edit",
      "glob",
      "grep",
      "lsp",
      "multiedit",
      "petanque",
      "proof_plan",
      "read",
      "task",
      "coqtop",
      "write",
    ].sort())
    const blocked = await (tools.read as { execute: () => Promise<{ output: string }> }).execute()
    expect(blocked.output).toContain("accepted_plan_materialization_gate")
    expect(gate.removed_tools).toEqual([])
  })

  test("does not let invalid lookup or validation reset the passive lookup streak", () => {
    const targetFile = "/tmp/workspace/Lemma4.v"
    const messages = [
      {
        parts: [
          {
            type: "tool",
            tool: "read",
            state: { status: "completed", input: { filePath: "/tmp/workspace/prosa/example.v" } },
          },
          {
            type: "tool",
            tool: "invalid",
            state: {
              status: "completed",
              input: { tool: "read", error: "Model tried to call unavailable tool 'read'." },
            },
          },
          {
            type: "tool",
            tool: "coqc",
            state: { status: "completed", input: { filePath: targetFile } },
          },
          {
            type: "tool",
            tool: "checkpoint",
            state: { status: "completed", input: { filePath: targetFile } },
          },
        ],
      },
    ] as unknown as MessageV2.WithParts[]

    expect(SessionPrompt.acceptedPlanMaterializationLookupStreakForTest(messages, targetFile)).toBe(1)
  })

  test("resets the passive lookup streak only after an active proof attempt", () => {
    const targetFile = "/tmp/workspace/Lemma4.v"
    const messages = [
      {
        parts: [
          {
            type: "tool",
            tool: "read",
            state: { status: "completed", input: { filePath: "/tmp/workspace/prosa/example.v" } },
          },
          {
            type: "tool",
            tool: "invalid",
            state: { status: "completed", input: { tool: "read", error: "unavailable" } },
          },
          {
            type: "tool",
            tool: "coq_session",
            state: { status: "completed", input: { op: "step", tactic: "intros." } },
          },
        ],
      },
    ] as unknown as MessageV2.WithParts[]

    expect(SessionPrompt.acceptedPlanMaterializationLookupStreakForTest(messages, targetFile)).toBe(0)
  })
})

describe("session.prompt proof cache projection", () => {
  test("enables compact lemma history by default without changing ordinary agents", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const previous = process.env.OPENCODE_CACHE_PROJECT_TOOL_OUTPUTS
        process.env.OPENCODE_CACHE_PROJECT_TOOL_OUTPUTS = ""
        try {
          expect(SessionPrompt.cacheProjectionOptions({ name: "lemma" } as any)).toMatchObject({
            enabled: true,
            maxToolOutputChars: 2_000,
            maxProofToolOutputChars: 4_000,
            maxEditToolOutputChars: 1_000,
            maxEditToolInputChars: 1_000,
            maxAssistantTextChars: 4_000,
            maxReasoningChars: 2_000,
          })
          expect(SessionPrompt.cacheProjectionOptions({ name: "build" } as any)).toEqual({ enabled: false })
        } finally {
          if (previous === undefined) delete process.env.OPENCODE_CACHE_PROJECT_TOOL_OUTPUTS
          else process.env.OPENCODE_CACHE_PROJECT_TOOL_OUTPUTS = previous
        }
      },
    })
  })
})

describe("session.prompt missing file", () => {
  test("auto-binds Coq target files named in benchmark prompts", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "Lemma3.v"), "Lemma demo : True. Proof. exact I. Qed.\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "prover",
          noReply: true,
          parts: [
            {
              type: "text",
              text: "The target file is `Lemma3.v`. The theorem to prove is `demo`. Validate with `coqc Lemma3.v`.",
            },
          ],
        })

        const binding = SessionProof.get(session.id)
        expect(binding?.file).toBe(path.join(tmp.path, "Lemma3.v"))

        await Session.remove(session.id)
        SessionProof.clear(session.id)
      },
    })
  })

  test("prefers the explicit proof target over an attached placeholder file", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "Lemma4.v"), "Lemma demo : True. Proof. exact I. Qed.\n")
        await Bun.write(path.join(dir, "DO_NOT_CREATE.v"), "From mathcomp Require Import all_ssreflect.\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const placeholder = path.join(tmp.path, "DO_NOT_CREATE.v")

        await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "prover",
          noReply: true,
          parts: [
            {
              type: "file",
              filename: "DO_NOT_CREATE.v",
              mime: "text/plain",
              url: `file://${placeholder}`,
            },
            {
              type: "text",
              text: "The target file is `Lemma4.v`, the theorem is `demo`. Validate with `coqc Lemma4.v`.",
            },
          ],
        })

        expect(SessionProof.get(session.id)?.file).toBe(path.join(tmp.path, "Lemma4.v"))
        await Session.remove(session.id)
        SessionProof.clear(session.id)
      },
    })
  })

  test("repairs a persisted automatic placeholder binding on continuation", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "Lemma4.v"), "Lemma demo : True. Proof. exact I. Qed.\n")
        await Bun.write(path.join(dir, "DO_NOT_CREATE.v"), "From mathcomp Require Import all_ssreflect.\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        SessionProof.set(
          session.id,
          path.join(tmp.path, "DO_NOT_CREATE.v"),
          { line: 0, character: 0 },
          "auto",
        )

        await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "prover",
          noReply: true,
          parts: [
            {
              type: "text",
              text: "The target file is `Lemma4.v`, the theorem is `demo`. Validate with `coqc Lemma4.v`.",
            },
          ],
        })

        expect(SessionProof.get(session.id)?.file).toBe(path.join(tmp.path, "Lemma4.v"))
        await Session.remove(session.id)
        SessionProof.clear(session.id)
      },
    })
  })

  test("does not fail the prompt when a file part is missing", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const missing = path.join(tmp.path, "does-not-exist.ts")
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [
            { type: "text", text: "please review @does-not-exist.ts" },
            {
              type: "file",
              mime: "text/plain",
              url: `file://${missing}`,
              filename: "does-not-exist.ts",
            },
          ],
        })

        if (msg.info.role !== "user") throw new Error("expected user message")

        const hasFailure = msg.parts.some(
          (part) => part.type === "text" && part.synthetic && part.text.includes("Read tool failed to read"),
        )
        expect(hasFailure).toBe(true)

        await Session.remove(session.id)
      },
    })
  })

  test("keeps stored part order stable when file resolution is async", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const missing = path.join(tmp.path, "still-missing.ts")
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [
            {
              type: "file",
              mime: "text/plain",
              url: `file://${missing}`,
              filename: "still-missing.ts",
            },
            { type: "text", text: "after-file" },
          ],
        })

        if (msg.info.role !== "user") throw new Error("expected user message")

        const stored = await MessageV2.get({
          sessionID: session.id,
          messageID: msg.info.id,
        })
        const text = stored.parts.filter((part) => part.type === "text").map((part) => part.text)

        expect(text[0]?.startsWith("Called the Read tool with the following input:")).toBe(true)
        expect(text[1]?.includes("Read tool failed to read")).toBe(true)
        expect(text[2]).toBe("after-file")

        await Session.remove(session.id)
      },
    })
  })
})

describe("session.prompt special characters", () => {
  test("handles filenames with # character", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "file#name.txt"), "special content\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const template = "Read @file#name.txt"
        const parts = await SessionPrompt.resolvePromptParts(template)
        const fileParts = parts.filter((part) => part.type === "file")

        expect(fileParts.length).toBe(1)
        expect(fileParts[0].filename).toBe("file#name.txt")
        expect(fileParts[0].url).toContain("%23")

        const decodedPath = fileURLToPath(fileParts[0].url)
        expect(decodedPath).toBe(path.join(tmp.path, "file#name.txt"))

        const message = await SessionPrompt.prompt({
          sessionID: session.id,
          parts,
          noReply: true,
        })
        const stored = await MessageV2.get({ sessionID: session.id, messageID: message.info.id })
        const textParts = stored.parts.filter((part) => part.type === "text")
        const hasContent = textParts.some((part) => part.text.includes("special content"))
        expect(hasContent).toBe(true)

        await Session.remove(session.id)
      },
    })
  })
})

describe("session.prompt agent variant", () => {
  test("applies agent variant only when using agent model", async () => {
    const prev = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = "test-openai-key"

    try {
      await using tmp = await tmpdir({
        git: true,
        config: {
          agent: {
            build: {
              model: "openai/gpt-5.2",
              variant: "xhigh",
            },
          },
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})

          const other = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            model: { providerID: "opencode", modelID: "kimi-k2.5-free" },
            noReply: true,
            parts: [{ type: "text", text: "hello" }],
          })
          if (other.info.role !== "user") throw new Error("expected user message")
          expect(other.info.variant).toBeUndefined()

          const match = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [{ type: "text", text: "hello again" }],
          })
          if (match.info.role !== "user") throw new Error("expected user message")
          expect(match.info.model).toEqual({ providerID: "openai", modelID: "gpt-5.2" })
          expect(match.info.variant).toBe("xhigh")

          const override = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            variant: "high",
            parts: [{ type: "text", text: "hello third" }],
          })
          if (override.info.role !== "user") throw new Error("expected user message")
          expect(override.info.variant).toBe("high")

          await Session.remove(session.id)
        },
      })
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = prev
    }
  })
})
