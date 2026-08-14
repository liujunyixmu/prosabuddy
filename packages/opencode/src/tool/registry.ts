import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TodoWriteTool, TodoReadTool } from "./todo"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { BashTool } from "./bash"
import { MultiEditTool } from "./multiedit"
import { LspTool } from "./lsp"
import { PlanExitTool } from "./plan"
import { QuestionTool } from "./question"
import { WebFetchTool } from "./webfetch"
import { WebSearchTool } from "./websearch"
import { CodeSearchTool } from "./codesearch"
import { BatchTool } from "./batch"
import { SkillTool } from "./skill"
import { ListTool } from "./ls"
import { ApplyPatchTool } from "./apply_patch"
import type { Agent } from "../agent/agent"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Log } from "@/util/log"
import { CoqcTool } from "./coqc"
import { CoqtopTool } from "./coqtop"
import { ProofPlanTool } from "./proof-plan"
import { CoqSessionTool } from "./coq-session"
import { CheckpointTool } from "./checkpoint"
import { PetanqueTool } from "./petanque"
import { Config } from "@/config/config"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import z from "zod"

export namespace ToolRegistry {
  const log = Log.create({ service: "tool.registry" })

  const builtin = [
    InvalidTool,
    ReadTool,
    GlobTool,
    GrepTool,
    EditTool,
    MultiEditTool,
    WriteTool,
    BashTool,
    TaskTool,
    TodoWriteTool,
    TodoReadTool,
    ListTool,
    LspTool,
    PlanExitTool,
    QuestionTool,
    WebFetchTool,
    WebSearchTool,
    CodeSearchTool,
    BatchTool,
    SkillTool,
    ApplyPatchTool,
    CoqcTool,
    CoqtopTool,
    ProofPlanTool,
    CoqSessionTool,
    CheckpointTool,
    PetanqueTool,
  ]

  function zodFromCustomArg(input: any): z.ZodType {
    if (input instanceof z.ZodType) return input
    if (!input || typeof input !== "object") return z.any()
    switch (input.type) {
      case "string":
        return z.string()
      case "number":
        return z.number()
      case "integer":
        return z.number().int()
      case "boolean":
        return z.boolean()
      case "array":
        return z.array(zodFromCustomArg(input.items))
      case "object":
        return z.record(z.string(), z.any())
      default:
        return z.any()
    }
  }

  function customParameters(args: any) {
    if (args instanceof z.ZodType) return args
    if (!args || typeof args !== "object") return z.object({})
    return z.object(
      Object.fromEntries(Object.entries(args).map(([key, value]) => [key, zodFromCustomArg(value)])),
    )
  }

  async function customToolFiles() {
    const roots = new Set<string>([path.join(Instance.directory, ".opencode")])
    for (const dir of await Config.directories()) {
      if (path.basename(dir) === ".opencode") roots.add(dir)
    }

    const files: { id: string; file: string }[] = []
    for (const root of roots) {
      for (const dirname of ["tool", "tools"]) {
        const dir = path.join(root, dirname)
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
        for (const entry of entries) {
          if (!entry.isFile()) continue
          if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".js")) continue
          const id = path.basename(entry.name, path.extname(entry.name))
          if (builtin.some((item) => item.id === id) || files.some((item) => item.id === id)) continue
          files.push({ id, file: path.join(dir, entry.name) })
        }
      }
    }
    return files
  }

  async function customTools(): Promise<Tool.Info[]> {
    return (await customToolFiles()).map(({ id, file }) =>
      Tool.define(id, async () => {
        await Config.waitForDependencies()
        const mod = await import(pathToFileURL(file).href)
        const custom = mod.default ?? mod
        const execute = custom.execute
        if (typeof execute !== "function") throw new Error(`Custom tool ${id} must export an execute function`)
        return {
          description: custom.description ?? id,
          parameters: customParameters(custom.args),
          async execute(args, ctx) {
            const result = await execute(args, ctx)
            if (typeof result === "string") return { title: id, metadata: {}, output: result }
            return {
              title: result?.title ?? id,
              metadata: result?.metadata ?? {},
              output: String(result?.output ?? result ?? ""),
              attachments: result?.attachments,
            }
          },
        }
      }),
    )
  }

  async function all(): Promise<Tool.Info[]> {
    return [...builtin, ...(await customTools())]
  }

  export async function ids() {
    return [...builtin.map((t) => t.id), ...(await customToolFiles()).map((t) => t.id)]
  }

  export async function tools(
    model: {
      providerID: string
      modelID: string
    },
    agent?: Agent.Info,
  ) {
    const items = await all()
    const result = await Promise.all(
      items.map(async (t) => {
        using _ = log.time(t.id)
        const tool = await t.init({ agent })
        return {
          id: t.id,
          ...tool,
          description: tool.description,
          parameters: tool.parameters,
        }
      }),
    )
    return result
  }
}
