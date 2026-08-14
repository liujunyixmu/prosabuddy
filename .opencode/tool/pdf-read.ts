/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { spawn } from "child_process"
import * as path from "path"
import * as fs from "fs"

export default tool({
  description: [
    "Extract text content from a PDF file using pdftotext.",
    "",
    "Use this tool when you need to read or analyze a PDF document.",
    "Supports extracting specific page ranges to keep output manageable.",
    "",
    "For large PDFs, extract a page range first to understand the structure,",
    "then request specific sections as needed.",
    "",
    "Returns: extracted text content from the PDF.",
  ].join("\n"),
  args: {
    file: tool.schema
      .string()
      .describe("Path to the PDF file (absolute or relative to project root)"),
    first: tool.schema
      .number()
      .optional()
      .describe("First page to extract (1-based, default: 1)"),
    last: tool.schema
      .number()
      .optional()
      .describe("Last page to extract (1-based, default: last page)"),
    layout: tool.schema
      .boolean()
      .optional()
      .describe("Preserve original physical layout (default: false). Useful for tables."),
  },
  async execute(args, context) {
    const target = path.isAbsolute(args.file)
      ? args.file
      : path.resolve(context.directory, args.file)

    if (!fs.existsSync(target))
      throw new Error(`File not found: ${target}`)
    if (!target.toLowerCase().endsWith(".pdf"))
      throw new Error(`Not a PDF file: ${target}`)

    const stat = fs.statSync(target)
    const mb = (stat.size / 1024 / 1024).toFixed(1)

    const flags: string[] = []
    if (args.first) flags.push("-f", String(args.first))
    if (args.last) flags.push("-l", String(args.last))
    if (args.layout) flags.push("-layout")
    // output to stdout
    flags.push(target, "-")

    const result = await run("pdftotext", flags, 30_000)

    if (result.code !== 0) {
      const err = result.stderr.trim() || `pdftotext exited with code ${result.code}`
      throw new Error(err)
    }

    const text = result.stdout.trim()
    if (!text) return `PDF is empty or contains only images (no extractable text). File: ${target} (${mb} MB)`

    const pages = args.first && args.last
      ? `pages ${args.first}-${args.last}`
      : args.first
        ? `from page ${args.first}`
        : args.last
          ? `pages 1-${args.last}`
          : "all pages"

    const lines = text.split("\n").length
    const header = `## PDF: ${path.basename(target)} (${mb} MB, ${lines} lines, ${pages})\n`

    // Truncate if enormous
    const limit = 200_000
    if (text.length > limit)
      return header + text.slice(0, limit) + `\n\n[... truncated at ${limit} chars, use page range to read more]`

    return header + text
  },
})

function run(cmd: string, args: string[], timeout: number): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], timeout })
    const out: Buffer[] = []
    const err: Buffer[] = []
    proc.stdout.on("data", (d) => out.push(d))
    proc.stderr.on("data", (d) => err.push(d))
    proc.on("close", (code) =>
      resolve({
        stdout: Buffer.concat(out).toString("utf-8"),
        stderr: Buffer.concat(err).toString("utf-8"),
        code: code ?? 1,
      }),
    )
    proc.on("error", (e) =>
      resolve({ stdout: "", stderr: e.message, code: 1 }),
    )
  })
}
