/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { spawn } from "child_process"
import * as path from "path"
import * as fs from "fs"

/**
 * coq-check: Compile a .v file with coqc and return structured error output.
 *
 * This tool runs `coqc` on a target file within a Coq project directory,
 * captures compilation output (errors, warnings), and returns it in a
 * structured format the agent can reason about for iterative fixing.
 */
export default tool({
  description: [
    "Compile a Coq .v file using coqc and return structured compilation results.",
    "",
    "Use this tool to verify whether a Coq proof file compiles successfully.",
    "If compilation fails, the output contains structured error messages with",
    "line numbers and error descriptions that can be used to fix the proof.",
    "",
    "The tool automatically detects _CoqProject files for build configuration.",
    "You can specify a custom project root if needed.",
    "",
    "Returns: compilation status (success/failure), errors with line numbers,",
    "warnings, and the full compiler output.",
  ].join("\n"),
  args: {
    file: tool.schema
      .string()
      .describe("Absolute or relative path to the .v file to compile"),
    project_root: tool.schema
      .string()
      .optional()
      .describe(
        "Root directory of the Coq project (where _CoqProject is). " +
          "If omitted, searches upward from the file location."
      ),
    timeout: tool.schema
      .number()
      .optional()
      .describe("Timeout in milliseconds (default: 120000 = 2 min)"),
    extra_args: tool.schema
      .string()
      .optional()
      .describe(
        "Extra arguments to pass to coqc, e.g. '-Q . MyLib' or '-R . prosa'"
      ),
  },
  async execute(args, context) {
    const filePath = path.isAbsolute(args.file)
      ? args.file
      : path.resolve(context.directory, args.file)

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    // Find project root by walking up to locate _CoqProject
    const projectRoot = args.project_root
      ? path.isAbsolute(args.project_root)
        ? args.project_root
        : path.resolve(context.directory, args.project_root)
      : findProjectRoot(filePath)

    // Read _CoqProject for flags
    const coqProjectPath = path.join(projectRoot, "_CoqProject")
    let projectFlags: string[] = []
    if (fs.existsSync(coqProjectPath)) {
      const content = fs.readFileSync(coqProjectPath, "utf-8")
      projectFlags = parseCoqProject(content)
    }

    // Build coqc command
    const extraArgs = args.extra_args ? args.extra_args.split(/\s+/) : []
    const coqcArgs = [...projectFlags, ...extraArgs, filePath]

    const timeout = args.timeout ?? 120_000

    // Execute coqc
    const result = await runCoqc(coqcArgs, projectRoot, timeout)

    // Parse errors
    const errors = parseCoqErrors(result.stderr + "\n" + result.stdout)

    const status = result.exitCode === 0 ? "SUCCESS" : "FAILURE"

    const output = [
      `## Coq Compilation Result: ${status}`,
      `**File:** ${filePath}`,
      `**Project Root:** ${projectRoot}`,
      `**Exit Code:** ${result.exitCode}`,
      "",
    ]

    if (errors.length > 0) {
      output.push(`### Errors (${errors.length})`)
      for (const err of errors) {
        output.push(
          `- **Line ${err.line}${err.col ? ", Col " + err.col : ""}** [${err.severity}]: ${err.message}`
        )
      }
      output.push("")
    }

    if (result.stderr.trim()) {
      output.push("### Full Compiler Output")
      output.push("```")
      output.push(result.stderr.trim())
      output.push("```")
    }

    if (result.stdout.trim()) {
      output.push("### Stdout")
      output.push("```")
      output.push(result.stdout.trim())
      output.push("```")
    }

    if (status === "SUCCESS") {
      output.push("The file compiled successfully with no errors.")
    }

    return output.join("\n")
  },
})

function findProjectRoot(filePath: string): string {
  let dir = path.dirname(filePath)
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "_CoqProject"))) return dir
    // Also check for Makefile.coq.local or coq-makefile indicators
    if (fs.existsSync(path.join(dir, "Makefile.conf"))) return dir
    dir = path.dirname(dir)
  }
  return path.dirname(filePath)
}

function parseCoqProject(content: string): string[] {
  const flags: string[] = []
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    // Skip .v file listings, only keep flags
    if (trimmed.endsWith(".v")) continue
    // Parse flags like -R, -Q, -arg
    const parts = trimmed.split(/\s+/)
    flags.push(...parts)
  }
  return flags
}

interface CoqError {
  line: number
  col?: number
  severity: "Error" | "Warning" | "Info"
  message: string
}

function parseCoqErrors(output: string): CoqError[] {
  const errors: CoqError[] = []
  // Coq error format: File "path", line N, characters M-M:
  // or: Error: message
  const regex =
    /File "([^"]+)", line (\d+), characters? (\d+)-?(\d+)?:\s*\n?(Error|Warning):\s*([\s\S]*?)(?=(?:File "|$))/g
  let match
  while ((match = regex.exec(output)) !== null) {
    errors.push({
      line: parseInt(match[2], 10),
      col: match[3] ? parseInt(match[3], 10) : undefined,
      severity: match[5] as "Error" | "Warning",
      message: match[6].trim().split("\n")[0],
    })
  }

  // Also catch standalone Errors not tied to a file location
  const standaloneRegex = /^Error:\s*(.+)$/gm
  while ((match = standaloneRegex.exec(output)) !== null) {
    // Avoid duplicates
    if (!errors.some((e) => e.message === match[1].trim())) {
      errors.push({
        line: 0,
        severity: "Error",
        message: match[1].trim(),
      })
    }
  }

  return errors
}

function runCoqc(
  args: string[],
  cwd: string,
  timeout: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""

    const proc = spawn("coqc", args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    const timer = setTimeout(() => {
      proc.kill("SIGTERM")
      stderr += `\n[coq-check] Process killed after ${timeout}ms timeout`
    }, timeout)

    proc.once("exit", (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: code ?? 1 })
    })

    proc.once("error", (err) => {
      clearTimeout(timer)
      resolve({ stdout, stderr: stderr + "\n" + err.message, exitCode: 1 })
    })
  })
}
