import z from "zod"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { LSP } from "../lsp"
import path from "path"
import { Log } from "../util/log"
import { randomBytes } from "crypto"
import { assertNoRewriteBang, assertNoIntuition } from "./coq-style-guard"
import { formatCoqSkillHints } from "./coq-skill-hints"

const log = Log.create({ service: "petanque" })

// Petanque session state
interface PetanqueSession {
  id: string
  uri: string
  state: number | null
  theorem: string
  history: { tac: string; state: number }[]
}

const sessions = new Map<string, PetanqueSession>()

function abs(file: string) {
  return path.isAbsolute(file) ? file : path.resolve(Instance.directory, file)
}

const DESCRIPTION = `Petanque: Interact with Rocq/Coq proofs through LSP using single-step execution.

This tool provides a more efficient alternative to coq_session for proof development,
using rocq-lsp's Petanque API for incremental tactic execution.

Operations:
- start: Start a new proof session for a specific theorem
- run: Execute a tactic or command in the current session
- goals: Get the current proof goals
- close: End the proof session

The run operation rejects ssreflect repeat-rewrite syntax rewrite !... and rewrite -!...; use explicit rewrites or a named normalization bridge instead.
The run operation also rejects the intuition tactic; use explicit tactics (left/right/split/apply/exact) instead.

The tool maintains proof state on the server, enabling efficient backtracking
and parallel proof exploration.`

export const PetanqueTool = Tool.define("petanque", {
  description: DESCRIPTION,
  parameters: z.object({
    op: z.enum(["start", "run", "goals", "close"]).describe("Petanque operation"),
    file: z.string().optional().describe("Path to the .v file (required for start)"),
    theorem: z.string().optional().describe("Theorem name to prove (required for start)"),
    tactic: z.string().optional().describe("Tactic to execute (required for run)"),
    position: z
      .object({
        line: z.number().describe("0-indexed line number"),
        character: z.number().describe("0-indexed character position"),
      })
      .optional()
      .describe("Position in file for state retrieval (alternative to theorem)"),
  }),
  async execute(params, ctx): Promise<{ title: string; output: string; metadata: Record<string, any> }> {
    await ctx.ask({
      permission: "petanque",
      patterns: ["*"],
      always: ["*"],
      metadata: { op: params.op },
    })

    const key = ctx.sessionID

    switch (params.op) {
      case "start": {
        if (!params.file) throw new Error("start requires file path")
        if (!params.theorem && !params.position) throw new Error("start requires theorem name or position")

        const file = abs(params.file)

        let state: number

        if (params.theorem) {
          const result = await LSP.rocqPetanqueStart({
            file,
            theorem: params.theorem,
          })
          state = result.st
        } else if (params.position) {
          const result = await LSP.rocqPetanqueStart({
            file,
            position: params.position,
          })
          state = result.st
        } else {
          throw new Error("Either theorem or position must be provided")
        }

        const goals = await LSP.rocqPetanqueGoals({
          file,
          state,
        })

        const sid = "pet_" + randomBytes(4).toString("hex")
        const session: PetanqueSession = {
          id: sid,
          uri: file,
          state,
          theorem: params.theorem ?? `pos:${params.position?.line}:${params.position?.character}`,
          history: [],
        }
        sessions.set(key, session)

        const goalStr = goals.goals.length > 0 ? formatGoals(goals) : "No goals (proof complete?)"

        return {
          title: `Petanque session started for ${session.theorem}`,
          output: `Session ${sid} started\n\n${goalStr}`,
          metadata: { op: "start" as const, session_id: sid, state, goals_count: goals.goals.length },
        }
      }

      case "run": {
        const session = sessions.get(key)
        if (!session || session.state === null) throw new Error("No petanque session. Use start first.")
        if (!params.tactic) throw new Error("run requires tactic")
        assertNoRewriteBang(params.tactic, "petanque tactic")
        assertNoIntuition(params.tactic, "petanque tactic")

        const file = abs(params.file ?? session.uri)

        const run = await LSP.rocqPetanqueRun({
          file,
          state: session.state,
          tactic: params.tactic,
        })

        if (run.ok) {
          const result = run.result

          // Store history for potential backtracking
          session.history.push({ tac: params.tactic, state: session.state })
          session.state = result.st

          const goals = await LSP.rocqPetanqueGoals({
            file,
            state: session.state,
          })

          const fb = result.feedback.length > 0 ? "\nFeedback: " + result.feedback.map(([_, m]) => m).join("\n") : ""
          const goalStr = goals.goals.length > 0 ? formatGoals(goals) : "No more goals!"
          const status = result.proof_finished ? " [Proof complete!]" : ""

          return {
            title: `Tactic: ${params.tactic.slice(0, 40)}${status}`,
            output: `${goalStr}${fb}`,
            metadata: {
              op: "run",
              session_id: session.id,
              state: session.state,
              proof_finished: result.proof_finished,
              goals_count: goals.goals.length,
            },
          }
        }

        const fb = run.error.feedback.length > 0 ? `\nFeedback:\n${run.error.feedback.map((x) => x.text).join("\n")}` : ""
        const message = `${run.error.message}${fb}`
        return {
          title: `Tactic failed: ${params.tactic.slice(0, 30)}`,
          output: `Error: ${message}${formatCoqSkillHints(message)}`,
          metadata: { op: "run", session_id: session.id, error: true },
        }
      }

      case "goals": {
        const session = sessions.get(key)
        if (!session || session.state === null) throw new Error("No petanque session. Use start first.")

        const file = abs(params.file ?? session.uri)
        const goals = await LSP.rocqPetanqueGoals({
          file,
          state: session.state,
        })

        const goalStr = goals.goals.length > 0 ? formatGoals(goals) : "No goals"

        return {
          title: "Current goals",
          output: goalStr,
          metadata: { op: "goals", session_id: session.id, goals_count: goals.goals.length },
        }
      }

      case "close": {
        const session = sessions.get(key)
        if (!session) throw new Error("No petanque session to close")

        const history = session.history.length
        sessions.delete(key)

        return {
          title: "Session closed",
          output: `Petanque session ${session.id} closed. ${history} tactics executed.`,
          metadata: { op: "close", session_id: session.id, tactics_count: history },
        }
      }

      default:
        throw new Error(`Unknown operation: ${params.op}`)
    }
  },
})

/** Format Petanque goals into readable string */
function formatGoals(goals: { goals: { hyps: { names: string[]; ty: string }[]; ty: string }[] }): string {
  if (goals.goals.length === 0) return "No goals"

  const parts: string[] = []
  for (let i = 0; i < goals.goals.length; i++) {
    const g = goals.goals[i]
    if (goals.goals.length > 1) parts.push(`Goal ${i + 1}/${goals.goals.length}:`)

    // Format hypotheses
    if (g.hyps.length > 0) {
      for (const h of g.hyps) {
        const names = h.names.join(", ")
        parts.push(`  ${names} : ${h.ty}`)
      }
      parts.push("  " + "=".repeat(40))
    }

    // Format goal type
    parts.push(`  ${g.ty}`)
    if (i < goals.goals.length - 1) parts.push("")
  }

  return parts.join("\n")
}
