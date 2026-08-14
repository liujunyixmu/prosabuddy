/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { spawn } from "child_process"
import * as path from "path"
import * as fs from "fs"

/**
 * coq-serapi: Interact with Coq via SerAPI (coqtop) for step-by-step proof
 * verification. Sends Coq commands one at a time to a persistent process
 * and returns goal states, making it possible to debug proofs interactively.
 *
 * This is the "interactive" companion to coq-check.
 * - coq-check: full-file compilation (pass/fail)
 * - coq-serapi: step-by-step tactic execution with goal feedback
 */

// Global process pool keyed by project root
const sessions: Map<
  string,
  {
    proc: ReturnType<typeof spawn>
    buffer: string
    ready: boolean
  }
> = new Map()

export default tool({
  description: [
    "Execute Coq commands interactively via coqtop and return proof state.",
    "",
    "This tool maintains a persistent coqtop session per project, allowing",
    "step-by-step proof development. You can:",
    "- Send individual tactics and see the resulting goal state",
    "- Check what goals remain after each step",
    "- Reset the session to start fresh",
    "- Load dependencies before attempting a proof",
    "",
    "Use this for interactive proof debugging. For full-file compilation,",
    "use the coq-check tool instead.",
    "",
    "Actions:",
    "- 'exec': Execute one or more Coq commands and return goal state",
    "- 'reset': Kill the current session and start fresh",
    "- 'goals': Show current proof goals without executing anything",
  ].join("\n"),
  args: {
    action: tool.schema
      .enum(["exec", "reset", "goals"])
      .describe("Action to perform"),
    commands: tool.schema
      .string()
      .optional()
      .describe(
        "Coq commands to execute (for 'exec' action). " +
          "Can be multiple commands separated by periods. " +
          "Example: 'Require Import Arith. Lemma foo : 1 + 1 = 2. Proof. auto.'"
      ),
    project_root: tool.schema
      .string()
      .optional()
      .describe("Coq project root directory (where _CoqProject lives)"),
    timeout: tool.schema
      .number()
      .optional()
      .describe("Timeout per command in ms (default: 30000)"),
  },
  async execute(args, context) {
    const projectRoot = args.project_root
      ? path.isAbsolute(args.project_root)
        ? args.project_root
        : path.resolve(context.directory, args.project_root)
      : context.directory

    const timeout = args.timeout ?? 30_000

    if (args.action === "reset") {
      killSession(projectRoot)
      return "Session reset. A fresh coqtop will be started on the next exec."
    }

    // Ensure session exists
    const session = await getOrCreateSession(projectRoot)

    if (args.action === "goals") {
      const result = await sendCommand(session, "Show.", timeout)
      return formatGoalOutput(result)
    }

    if (args.action === "exec") {
      if (!args.commands) throw new Error("commands is required for exec action")

      // Split commands by period at end of statements
      const commands = splitCoqCommands(args.commands)
      const results: string[] = []

      for (const cmd of commands) {
        const trimmed = cmd.trim()
        if (!trimmed) continue

        const result = await sendCommand(session, trimmed, timeout)

        if (result.includes("Error:") || result.includes("Syntax error:")) {
          results.push(`**Command:** \`${trimmed}\``)
          results.push(`**Result:** ERROR`)
          results.push("```")
          results.push(result.trim())
          results.push("```")
          results.push("")
          // Don't continue after an error
          break
        }

        results.push(`**Command:** \`${trimmed}\``)
        if (result.trim()) {
          results.push("```")
          results.push(result.trim())
          results.push("```")
        } else {
          results.push("*(accepted, no output)*")
        }
        results.push("")
      }

      return results.join("\n")
    }

    throw new Error(`Unknown action: ${args.action}`)
  },
})

function splitCoqCommands(input: string): string[] {
  // Smart split: respect nested structures
  const commands: string[] = []
  let depth = 0
  let current = ""

  for (const char of input) {
    if (char === "(" || char === "{") depth++
    if (char === ")" || char === "}") depth--
    current += char
    if (char === "." && depth === 0) {
      commands.push(current.trim())
      current = ""
    }
  }
  if (current.trim()) commands.push(current.trim())
  return commands
}

function killSession(key: string) {
  const session = sessions.get(key)
  if (session) {
    try {
      session.proc.kill("SIGTERM")
    } catch {}
    sessions.delete(key)
  }
}

async function getOrCreateSession(projectRoot: string) {
  const existing = sessions.get(projectRoot)
  if (existing && !existing.proc.killed) return existing

  // Read _CoqProject for flags
  const coqProjectPath = path.join(projectRoot, "_CoqProject")
  const coqArgs: string[] = ["-emacs"]

  if (fs.existsSync(coqProjectPath)) {
    const content = fs.readFileSync(coqProjectPath, "utf-8")
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#") || trimmed.endsWith(".v")) continue
      // Handle -arg specially: extract the inner argument
      if (trimmed.startsWith("-arg ")) {
        coqArgs.push(trimmed.slice(5).trim().replace(/^"(.*)"$/, "$1"))
      } else {
        coqArgs.push(...trimmed.split(/\s+/))
      }
    }
  }

  const proc = spawn("coqtop", coqArgs, {
    cwd: projectRoot,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  })

  const session = { proc, buffer: "", ready: false }
  sessions.set(projectRoot, session)

  // Wait for initial prompt
  await new Promise<void>((resolve) => {
    const handler = (chunk: Buffer) => {
      session.buffer += chunk.toString()
      // coqtop in -emacs mode signals readiness with prompts
      if (session.buffer.includes("<prompt>")) {
        session.ready = true
        resolve()
      }
    }
    proc.stdout?.on("data", handler)
    proc.stderr?.on("data", (chunk: Buffer) => {
      session.buffer += chunk.toString()
    })
    // Fallback: ready after 3s even without prompt
    setTimeout(() => {
      session.ready = true
      resolve()
    }, 3000)
  })

  session.buffer = ""
  return session
}

function sendCommand(
  session: { proc: ReturnType<typeof spawn>; buffer: string; ready: boolean },
  command: string,
  timeout: number
): Promise<string> {
  return new Promise((resolve) => {
    session.buffer = ""

    const timer = setTimeout(() => {
      resolve(session.buffer + "\n[coq-serapi] Timeout after " + timeout + "ms")
    }, timeout)

    const handler = (chunk: Buffer) => {
      session.buffer += chunk.toString()
      // Check for prompt indicating command completed
      if (session.buffer.includes("<prompt>")) {
        clearTimeout(timer)
        session.proc.stdout?.off("data", handler)
        // Clean up prompt markers for readability
        const output = session.buffer
          .replace(/<prompt>[\s\S]*?<\/prompt>/g, "")
          .trim()
        resolve(output)
      }
    }

    session.proc.stdout?.on("data", handler)

    // Send the command followed by newline
    const cmd = command.endsWith(".") ? command : command + "."
    session.proc.stdin?.write(cmd + "\n")
  })
}

function formatGoalOutput(raw: string): string {
  if (!raw.trim()) return "No goals."
  return ["## Current Proof Goals", "```coq", raw.trim(), "```"].join("\n")
}
