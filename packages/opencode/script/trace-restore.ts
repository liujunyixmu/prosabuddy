#!/usr/bin/env bun

import path from "path"
import { fileURLToPath } from "url"
import { Identifier } from "../src/id/id"

type RawText = {
  type: "text"
  text: string
}

type RawToolCall = {
  type: "tool-call"
  toolCallId: string
  toolName: string
  input?: Record<string, unknown>
}

type RawToolResult = {
  type: "tool-result"
  toolCallId: string
  toolName: string
  output?: unknown
}

type RawPart = RawText | RawToolCall | RawToolResult

type RawMessage = {
  role: "user" | "assistant" | "tool"
  content: RawPart[]
}

type RawRequest = {
  step: number
  agent: string
  model: {
    id: string
    providerID: string
  }
  system: string[]
  messages: RawMessage[]
}

type Args = {
  req: string
  dir?: string
  sessionFile?: string
  providerID: string
  modelID: string
  title?: string
  bind?: string
  prompt?: string
  run: boolean
  history: boolean
  exactPrefix: boolean
  noTask: boolean
}

function usage() {
  return [
    "Usage:",
    "  bun packages/opencode/script/trace-restore.ts <request.json|step-dir> [options]",
    "",
    "Options:",
    "  --dir <path>          Override restored working directory",
    "  --provider <id>       Continuation provider (default: github-copilot)",
    "  --model <id>          Continuation model (default: gpt-5-mini)",
    "  --title <text>        Session title",
    "  --session-file <path>  Write the restored session ID to a file",
    "  --bind <file:line:col>  Optional proof-context binding",
    "  --run                 Immediately continue the restored session",
    "  --no-history          Skip visible history import; keep exact raw prefix only",
    "  --visible-only        Import visible history without reusing the source system prompt",
    "  --prompt <text>       Inject a continuation user message after restore",
    "  --no-task             Deny the task tool (disable subagent delegation)",
  ].join("\n")
}

function parse() {
  const argv = process.argv.slice(2)
  const first = argv[0]
  if (!first || first === "--help" || first === "-h") {
    process.stdout.write(usage() + "\n")
    process.exit(0)
  }

  const args: Args = {
    req: first,
    providerID: "github-copilot",
    modelID: "gpt-5-mini",
    run: false,
    history: true,
    exactPrefix: true,
    noTask: false,
  }

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--run") {
      args.run = true
      continue
    }
    if (arg === "--no-history") {
      args.history = false
      continue
    }
    if (arg === "--visible-only") {
      args.exactPrefix = false
      continue
    }
    if (arg === "--dir") {
      args.dir = argv[++i]
      continue
    }
    if (arg === "--provider") {
      args.providerID = argv[++i] ?? args.providerID
      continue
    }
    if (arg === "--model") {
      args.modelID = argv[++i] ?? args.modelID
      continue
    }
    if (arg === "--title") {
      args.title = argv[++i]
      continue
    }
    if (arg === "--session-file") {
      args.sessionFile = argv[++i]
      continue
    }
    if (arg === "--bind") {
      args.bind = argv[++i]
      continue
    }
    if (arg === "--prompt") {
      args.prompt = argv[++i]
      continue
    }
    if (arg === "--no-task") {
      args.noTask = true
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return args
}

async function readReq(input: string) {
  const resolved = path.resolve(input)
  const file = (await Bun.file(resolved).exists()) ? resolved : path.join(resolved, "request.json")
  const exists = await Bun.file(file).exists()
  if (!exists) throw new Error(`Request file not found: ${file}`)
  return {
    file,
    req: (await Bun.file(file).json()) as RawRequest,
  }
}

async function readRun(file: string) {
  const run = path.resolve(file, "../../run.json")
  const exists = await Bun.file(run).exists()
  if (!exists) return undefined
  return (await Bun.file(run).json()) as { cwd?: string; id?: string }
}

function out(val: unknown) {
  if (typeof val === "string") return val
  if (val && typeof val === "object") {
    if ("value" in val && typeof val.value === "string") return val.value
    if ("text" in val && typeof val.text === "string") return val.text
  }
  return JSON.stringify(val, null, 2)
}

function bind(input?: string) {
  if (!input) return undefined
  const [file, line, col] = input.split(":")
  return {
    file,
    position: {
      line: Math.max(0, Number(line ?? "1") - 1),
      character: Math.max(0, Number(col ?? "1") - 1),
    },
  }
}

function next(clock: { now: number }) {
  clock.now += 1
  return clock.now
}

function make(clock: { now: number }, prefix: Parameters<typeof Identifier.create>[0]) {
  return Identifier.create(prefix, false, next(clock))
}

async function importVisible(input: {
  sessionID: string
  req: RawRequest
  clock: { now: number }
}) {
  const { Session } = await import("../src/session")

  let user = ""
  const msgs = input.req.messages

  for (let idx = 0; idx < msgs.length; ) {
    const msg = msgs[idx]

    if (msg.role === "user") {
      const id = make(input.clock, "message")
      user = id
      await Session.updateMessage({
        id,
        sessionID: input.sessionID,
        role: "user",
        time: { created: next(input.clock) },
        agent: input.req.agent,
        model: {
          providerID: input.req.model.providerID,
          modelID: input.req.model.id,
        },
      })
      for (const part of msg.content) {
        if (part.type !== "text") continue
        await Session.updatePart({
          id: make(input.clock, "part"),
          sessionID: input.sessionID,
          messageID: id,
          type: "text",
          text: part.text,
        })
      }
      idx += 1
      continue
    }

    if (msg.role === "assistant") {
      const id = make(input.clock, "message")
      await Session.updateMessage({
        id,
        sessionID: input.sessionID,
        role: "assistant",
        parentID: user,
        mode: input.req.agent,
        agent: input.req.agent,
        modelID: input.req.model.id,
        providerID: input.req.model.providerID,
        path: { cwd: "", root: "" },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        time: { created: next(input.clock) },
      })

      const waits = new Map<string, RawToolCall>()
      for (const part of msg.content) {
        if (part.type === "text") {
          await Session.updatePart({
            id: make(input.clock, "part"),
            sessionID: input.sessionID,
            messageID: id,
            type: "text",
            text: part.text,
          })
          continue
        }
        if (part.type === "tool-call") {
          waits.set(part.toolCallId, part)
        }
      }

      let end = idx + 1
      while (end < msgs.length && msgs[end].role === "tool") end += 1

      const seen = new Set<string>()
      for (let cur = idx + 1; cur < end; cur++) {
        for (const part of msgs[cur].content) {
          if (part.type !== "tool-result") continue
          seen.add(part.toolCallId)
          const call = waits.get(part.toolCallId)
          await Session.updatePart({
            id: make(input.clock, "part"),
            sessionID: input.sessionID,
            messageID: id,
            type: "tool",
            callID: part.toolCallId,
            tool: part.toolName,
            state: {
              status: "completed",
              input: call?.input ?? {},
              output: out(part.output),
              title: part.toolName,
              metadata: {},
              time: {
                start: next(input.clock),
                end: next(input.clock),
              },
            },
          })
        }
      }

      for (const [callID, part] of waits) {
        if (seen.has(callID)) continue
        await Session.updatePart({
          id: make(input.clock, "part"),
          sessionID: input.sessionID,
          messageID: id,
          type: "tool",
          callID,
          tool: part.toolName,
          state: {
            status: "error",
            input: part.input ?? {},
            error: "Imported trace has no matching tool result",
            time: {
              start: next(input.clock),
              end: next(input.clock),
            },
          },
        })
      }

      idx = end
      continue
    }

    const id = make(input.clock, "message")
    await Session.updateMessage({
      id,
      sessionID: input.sessionID,
      role: "assistant",
      parentID: user,
      mode: input.req.agent,
      agent: input.req.agent,
      modelID: input.req.model.id,
      providerID: input.req.model.providerID,
      path: { cwd: "", root: "" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      time: { created: next(input.clock) },
    })
    for (const part of msg.content) {
      if (part.type !== "tool-result") continue
      await Session.updatePart({
        id: make(input.clock, "part"),
        sessionID: input.sessionID,
        messageID: id,
        type: "tool",
        callID: part.toolCallId,
        tool: part.toolName,
        state: {
          status: "completed",
          input: {},
          output: out(part.output),
          title: part.toolName,
          metadata: {},
          time: {
            start: next(input.clock),
            end: next(input.clock),
          },
        },
      })
    }
    idx += 1
  }
}

async function main() {
  const args = parse()
  const { file, req } = await readReq(args.req)
  const run = await readRun(path.dirname(file))
  const dir = path.resolve(args.dir ?? run?.cwd ?? process.cwd())
  const note = args.title ?? `Trace restore step ${req.step}`
  const tip = bind(args.bind)

  const { Instance } = await import("../src/project/instance")
  const { InstanceBootstrap } = await import("../src/project/bootstrap")
  const { Session } = await import("../src/session")
  const { SessionPrompt } = await import("../src/session/prompt")
  const { SessionRestore } = await import("../src/session/restore")
  const { ProofContext } = await import("../src/session/proof-context")
  const { SessionProof } = await import("../src/session/session-proof")

  await Instance.provide({
    directory: dir,
    init: InstanceBootstrap,
    fn: async () => {
      const permission = args.noTask
        ? [{ permission: "task" as const, action: "deny" as const, pattern: "*" }]
        : undefined
      const session = await Session.create({ title: note, permission })
      const clock = { now: Date.now() - 10_000 }

      if (args.history) {
        await importVisible({
          sessionID: session.id,
          req,
          clock,
        })
      }

      const anchor = make(clock, "message")
      await Session.updateMessage({
        id: anchor,
        sessionID: session.id,
        role: "user",
        time: { created: next(clock) },
        agent: req.agent,
        model: {
          providerID: args.providerID,
          modelID: args.modelID,
        },
      })
      await Session.updatePart({
        id: make(clock, "part"),
        sessionID: session.id,
        messageID: anchor,
        type: "text",
        synthetic: true,
        text: args.exactPrefix
          ? `Restored exact trace prefix from ${file}. Continuation model: ${args.providerID}/${args.modelID}.`
          : `Imported visible history from ${file}; the source system prompt was intentionally not restored. Continuation model: ${args.providerID}/${args.modelID}.`,
      })

      if (args.exactPrefix) {
        await SessionRestore.set(session.id, {
          anchor,
          system: req.system,
          messages: req.messages as any,
          source: {
            trace: file,
            step: req.step,
            session: path.basename(path.dirname(file)),
            run: run?.id,
          },
        })
      }

      if (args.prompt) {
        const uid = make(clock, "message")
        await Session.updateMessage({
          id: uid,
          sessionID: session.id,
          role: "user",
          time: { created: next(clock) },
          agent: req.agent,
          model: {
            providerID: args.providerID,
            modelID: args.modelID,
          },
        })
        await Session.updatePart({
          id: make(clock, "part"),
          sessionID: session.id,
          messageID: uid,
          type: "text",
          text: args.prompt,
        })
      }

      if (tip) {
        const file = path.isAbsolute(tip.file) ? tip.file : path.resolve(dir, tip.file)
        ProofContext.setBinding(session.id, file, tip.position)
        SessionProof.set(session.id, file, tip.position, "manual")
      }

      if (args.run) {
        await SessionPrompt.loop({ sessionID: session.id })
      }

      if (args.sessionFile) {
        await Bun.write(path.resolve(args.sessionFile), session.id + "\n")
      }

      process.stdout.write(
        JSON.stringify(
          {
            sessionID: session.id,
            directory: dir,
            restored: file,
            sourceModel: `${req.model.providerID}/${req.model.id}`,
            continueModel: `${args.providerID}/${args.modelID}`,
            run: args.run,
            history: args.history,
            exactPrefix: args.exactPrefix,
          },
          null,
          2,
        ) + "\n",
      )
    },
  })
}

await main().catch((err) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err)
  process.stderr.write(msg + "\n")
  process.exit(1)
})