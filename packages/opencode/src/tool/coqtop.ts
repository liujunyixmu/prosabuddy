import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./coqtop.txt"
import { Instance } from "../project/instance"
import path from "path"
import * as CoqProject from "./coq-project"
import { assertNoRewriteBang, assertNoIntuition } from "./coq-style-guard"
import { formatCoqSkillHints } from "./coq-skill-hints"

export const CoqtopTool = Tool.define("coqtop", {
  description: DESCRIPTION,
  parameters: z.object({
    command: z.enum(["check", "search", "print", "state", "eval"]).describe("The coqtop command to execute"),
    input: z.string().describe("The argument for the command (term, pattern, name, or Coq code)"),
    flags: z
      .string()
      .optional()
      .describe(
        "Extra coqtop flags (e.g. '-Q dir Module'). Project flags from _CoqProject/_RocqProject are auto-detected.",
      ),
    context: z.string().optional().describe("Coq source code to load before running the command"),
    filePath: z.string().optional().describe("Path to a .v file for project detection (optional)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "coqtop",
      patterns: ["*"],
      always: ["*"],
      metadata: { command: params.command },
    })

    if (params.command === "eval" || params.command === "state") {
      assertNoRewriteBang(params.input, `coqtop ${params.command} input`)
      assertNoIntuition(params.input, `coqtop ${params.command} input`)
    }

    // Build the Coq script to evaluate
    const script: string[] = []

    if (params.context) {
      script.push(params.context)
    }

    switch (params.command) {
      case "check":
        script.push(`Check ${params.input}.`)
        break
      case "search":
        script.push(`Search ${params.input}.`)
        break
      case "print":
        script.push(`Print ${params.input}.`)
        break
      case "state":
        script.push(params.input)
        script.push("Show.")
        break
      case "eval":
        script.push(params.input)
        break
    }

    const code = script.join("\n")

    // Auto-detect project flags using shared helper
    const projectInput = params.filePath
      ? (path.isAbsolute(params.filePath) ? params.filePath : path.resolve(Instance.directory, params.filePath))
      : Instance.directory
    const extraFlags = params.flags ? params.flags.split(/\s+/).filter(Boolean) : []
    const { exit, stdout, stderr } = await CoqProject.run(code, projectInput, extraFlags, { signal: ctx.abort })

    // Parse and simplify the output
    const raw = stdout.trim()
    const err = stderr.trim()

    if (exit !== 0 && err) {
      const lines = err.split("\n").filter((l: string) => !l.startsWith("Welcome") && l.trim())
      return {
        title: `coqtop ${params.command}: error`,
        output: `status: error\n${lines.join("\n")}${formatCoqSkillHints(lines.join("\n"))}`,
        metadata: { status: "error", command: params.command },
      }
    }

    // Clean coqtop/rocq output using shared function
    const cleaned = CoqProject.cleanOutput(raw)

    return {
      title: `coqtop ${params.command}`,
      output: `status: ok\n${cleaned}`,
      metadata: { status: "ok", command: params.command },
    }
  },
})
