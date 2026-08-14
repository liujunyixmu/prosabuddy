import z from "zod"
import { text } from "node:stream/consumers"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import { Tool } from "./tool"
import { Filesystem } from "../util/filesystem"
import { Ripgrep } from "../file/ripgrep"
import { Process } from "../util/process"

import DESCRIPTION from "./grep.txt"
import { Instance } from "../project/instance"
import path from "path"
import { assertExternalDirectory } from "./external-directory"
import { ProofEditTransaction } from "@/session/proof-edit-transaction"
import { Glob } from "@/util/glob"

const MAX_LINE_LENGTH = 2000

export const GrepTool = Tool.define("grep", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
    include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
  }),
  async execute(params, ctx) {
    if (!params.pattern) {
      throw new Error("pattern is required")
    }

    await ctx.ask({
      permission: "grep",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        path: params.path,
        include: params.include,
      },
    })

    let searchPath = params.path ?? Instance.directory
    searchPath = path.isAbsolute(searchPath) ? searchPath : path.resolve(Instance.directory, searchPath)
    await assertExternalDirectory(ctx, searchPath, { kind: "directory" })

    const rgPath = await Ripgrep.filepath()
    const args = ["-nH", "--hidden", "--no-messages", "--field-match-separator=|", "--regexp", params.pattern]
    if (params.include) {
      args.push("--glob", params.include)
    }
    args.push(searchPath)

    const diskProc = Process.spawn([rgPath, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      abort: ctx.abort,
    })

    if (!diskProc.stdout || !diskProc.stderr) {
      throw new Error("Process output not available")
    }

    const output = await text(diskProc.stdout)
    const errorOutput = await text(diskProc.stderr)
    const exitCode = await diskProc.exited

    const transaction = ProofEditTransaction.active(ctx.sessionID)
    const transactionFile = transaction?.file
    const transactionSource = transactionFile
      ? ProofEditTransaction.source(ctx.sessionID, transactionFile)
      : undefined
    const searchStat = Filesystem.stat(searchPath)
    const relativeTransactionPath = transactionFile && searchStat?.isDirectory()
      ? path.relative(searchPath, transactionFile)
      : transactionFile
        ? path.basename(transactionFile)
        : undefined
    const transactionInSearchPath = Boolean(
      transactionFile &&
      searchStat &&
      (searchStat.isDirectory()
        ? relativeTransactionPath !== undefined &&
          relativeTransactionPath !== "" &&
          !relativeTransactionPath.startsWith(`..${path.sep}`) &&
          relativeTransactionPath !== ".." &&
          !path.isAbsolute(relativeTransactionPath)
        : path.normalize(searchPath) === path.normalize(transactionFile)),
    )
    const transactionMatchesInclude = Boolean(
      transactionFile &&
      relativeTransactionPath &&
      (!params.include ||
        Glob.match(params.include, path.basename(transactionFile)) ||
        Glob.match(params.include, relativeTransactionPath.replaceAll(path.sep, "/"))),
    )
    const searchTransaction = Boolean(
      transaction && transactionSource !== undefined && transactionInSearchPath && transactionMatchesInclude,
    )

    let transactionOutput = ""
    let transactionErrorOutput = ""
    let transactionExitCode: number | undefined
    if (searchTransaction) {
      // Keep ripgrep's exact regex semantics. Some Bun/Node child-process
      // combinations silently drop data written to a piped stdin, so search a
      // short-lived local snapshot rather than falling back to JS RegExp.
      const snapshotDir = await mkdtemp(path.join(os.tmpdir(), "opencode-proof-grep-"))
      const snapshotFile = path.join(snapshotDir, path.basename(transactionFile!))
      try {
        await writeFile(snapshotFile, transactionSource!, "utf8")
        const transactionProc = Process.spawn(
          [
            rgPath,
            "-nH",
            "--no-messages",
            "--field-match-separator=|",
            "--regexp",
            params.pattern,
            snapshotFile,
          ],
          {
            stdout: "pipe",
            stderr: "pipe",
            abort: ctx.abort,
          },
        )
        if (!transactionProc.stdout || !transactionProc.stderr) {
          throw new Error("Process output not available")
        }
        transactionOutput = await text(transactionProc.stdout)
        transactionErrorOutput = await text(transactionProc.stderr)
        transactionExitCode = await transactionProc.exited
      } finally {
        await rm(snapshotDir, { recursive: true, force: true })
      }
    }

    // Exit codes: 0 = matches found, 1 = no matches, 2 = errors (but may still have matches)
    // With --no-messages, we suppress error output but still get exit code 2 for broken symlinks etc.
    if (exitCode !== 0 && exitCode !== 1 && exitCode !== 2) {
      throw new Error(`ripgrep failed: ${errorOutput}`)
    }
    if (
      transactionExitCode !== undefined &&
      transactionExitCode !== 0 &&
      transactionExitCode !== 1 &&
      transactionExitCode !== 2
    ) {
      throw new Error(`ripgrep failed for staged proof transaction: ${transactionErrorOutput}`)
    }

    const hasErrors = exitCode === 2 || transactionExitCode === 2

    // Handle both Unix (\n) and Windows (\r\n) line endings
    const diskLines = output.trim().split(/\r?\n/)
    const transactionLines = transactionOutput.trim().split(/\r?\n/)
    const matches: {
      path: string
      modTime: number
      lineNum: number
      lineText: string
      transactionRevision?: number
    }[] = []

    for (const line of diskLines) {
      if (!line) continue

      const [filePath, lineNumStr, ...lineTextParts] = line.split("|")
      if (!filePath || !lineNumStr || lineTextParts.length === 0) continue
      if (searchTransaction && transactionFile && path.normalize(filePath) === path.normalize(transactionFile)) continue

      const lineNum = parseInt(lineNumStr, 10)
      const lineText = lineTextParts.join("|")

      const stats = Filesystem.stat(filePath)
      if (!stats) continue

      matches.push({
        path: filePath,
        modTime: stats.mtime.getTime(),
        lineNum,
        lineText,
      })
    }

    if (searchTransaction && transactionFile && transaction) {
      const stats = Filesystem.stat(transactionFile)
      if (stats) {
        for (const line of transactionLines) {
          if (!line) continue
          const [, lineNumStr, ...lineTextParts] = line.split("|")
          if (!lineNumStr || lineTextParts.length === 0) continue
          matches.push({
            path: transactionFile,
            modTime: stats.mtime.getTime(),
            lineNum: parseInt(lineNumStr, 10),
            lineText: lineTextParts.join("|"),
            transactionRevision: transaction.revision,
          })
        }
      }
    }

    matches.sort((a, b) => b.modTime - a.modTime)

    const limit = 100
    const truncated = matches.length > limit
    const finalMatches = truncated ? matches.slice(0, limit) : matches

    if (finalMatches.length === 0) {
      return {
        title: params.pattern,
        metadata: {
          matches: 0,
          truncated: false,
          transaction_file: searchTransaction ? transactionFile : undefined,
          transaction_revision: searchTransaction ? transaction?.revision : undefined,
        },
        output: "No files found",
      }
    }

    const totalMatches = matches.length
    const outputLines = [`Found ${totalMatches} matches${truncated ? ` (showing first ${limit})` : ""}`]

    let currentFile = ""
    for (const match of finalMatches) {
      if (currentFile !== match.path) {
        if (currentFile !== "") {
          outputLines.push("")
        }
        currentFile = match.path
        outputLines.push(`${match.path}:`)
        if (match.transactionRevision !== undefined) {
          outputLines.push(`  [staged proof transaction revision ${match.transactionRevision}]`)
        }
      }
      const truncatedLineText =
        match.lineText.length > MAX_LINE_LENGTH ? match.lineText.substring(0, MAX_LINE_LENGTH) + "..." : match.lineText
      outputLines.push(`  Line ${match.lineNum}: ${truncatedLineText}`)
    }

    if (truncated) {
      outputLines.push("")
      outputLines.push(
        `(Results truncated: showing ${limit} of ${totalMatches} matches (${totalMatches - limit} hidden). Consider using a more specific path or pattern.)`,
      )
    }

    if (hasErrors) {
      outputLines.push("")
      outputLines.push("(Some paths were inaccessible and skipped)")
    }

    return {
      title: params.pattern,
      metadata: {
        matches: totalMatches,
        truncated,
        transaction_file: searchTransaction ? transactionFile : undefined,
        transaction_revision: searchTransaction ? transaction?.revision : undefined,
      },
      output: outputLines.join("\n"),
    }
  },
})
