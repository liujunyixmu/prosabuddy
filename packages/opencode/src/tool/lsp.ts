import z from "zod"
import { Tool } from "./tool"
import path from "path"
import { LSP } from "../lsp"
import DESCRIPTION from "./lsp.txt"
import { Instance } from "../project/instance"
import { pathToFileURL } from "url"
import { assertExternalDirectory } from "./external-directory"
import { Filesystem } from "../util/filesystem"
import { ProofContext } from "../session/proof-context"
import { SessionProof } from "../session/session-proof"
import { formatCoqSkillHints } from "./coq-skill-hints"

const operations = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
  "proofGoals",
] as const

export const LspTool = Tool.define("lsp", {
  description: DESCRIPTION,
  parameters: z.object({
    operation: z.enum(operations).describe("The LSP operation to perform"),
    filePath: z.string().describe("The absolute or relative path to the file"),
    line: z.number().int().min(1).describe("The line number (1-based, as shown in editors)"),
    character: z.number().int().min(1).describe("The character offset (1-based, as shown in editors)"),
  }),
  execute: async (args, ctx) => {
    const file = path.isAbsolute(args.filePath) ? args.filePath : path.join(Instance.directory, args.filePath)
    await assertExternalDirectory(ctx, file)

    await ctx.ask({
      permission: "lsp",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })
    const uri = pathToFileURL(file).href
    const position = {
      file,
      line: args.line - 1,
      character: args.character - 1,
    }

    const relPath = path.relative(Instance.worktree, file)
    const title = `${args.operation} ${relPath}:${args.line}:${args.character}`

    const exists = await Filesystem.exists(file)
    if (!exists) {
      throw new Error(`File not found: ${file}`)
    }

    const available = await LSP.hasClients(file)
    if (!available) {
      throw new Error("No LSP server available for this file type.")
    }

    await LSP.touchFile(file, true)

    const result: unknown[] = await (async () => {
      switch (args.operation) {
        case "goToDefinition":
          return LSP.definition(position)
        case "findReferences":
          return LSP.references(position)
        case "hover":
          return LSP.hover(position)
        case "documentSymbol":
          return LSP.documentSymbol(uri)
        case "workspaceSymbol":
          return LSP.workspaceSymbol("")
        case "goToImplementation":
          return LSP.implementation(position)
        case "prepareCallHierarchy":
          return LSP.prepareCallHierarchy(position)
        case "incomingCalls":
          return LSP.incomingCalls(position)
        case "outgoingCalls":
          return LSP.outgoingCalls(position)
        case "proofGoals":
          ProofContext.setBinding(ctx.sessionID, file, { line: position.line, character: position.character })
          SessionProof.set(ctx.sessionID, file, { line: position.line, character: position.character }, "tool")
          return [await LSP.rocqGoals(position)]
      }
    })()

    const output = (() => {
      if (result.length === 0) return `No results found for ${args.operation}`
      return JSON.stringify(result, null, 2)
    })()
    const rocqErrorText = args.operation === "proofGoals" ? rocqProofGoalErrorText(result) : ""

    return {
      title,
      metadata: { result },
      output: output + (rocqErrorText ? formatCoqSkillHints(rocqErrorText) : ""),
    }
  },
})

function rocqProofGoalErrorText(result: unknown[]) {
  const messages: string[] = []
  for (const item of result) {
    if (!item || typeof item !== "object") continue
    const record = item as { error?: unknown; messages?: unknown }
    if (typeof record.error === "string" && record.error.trim()) messages.push(record.error)
    if (!Array.isArray(record.messages)) continue
    for (const message of record.messages) {
      if (typeof message === "string" && /error|fail|warning/i.test(message)) messages.push(message)
      if (message && typeof message === "object") {
        const text = (message as { text?: unknown }).text
        if (typeof text === "string" && /error|fail|warning/i.test(text)) messages.push(text)
      }
    }
  }
  return messages.join("\n")
}
