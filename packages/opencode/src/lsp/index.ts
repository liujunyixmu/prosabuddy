import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Log } from "../util/log"
import { LSPClient } from "./client"
import path from "path"
import { pathToFileURL, fileURLToPath } from "url"
import { LSPServer } from "./server"
import z from "zod"
import { Config } from "../config/config"
import { spawn } from "child_process"
import { Instance } from "../project/instance"
import { Flag } from "@/flag/flag"

export namespace LSP {
  const log = Log.create({ service: "lsp" })

  export const Event = {
    Updated: BusEvent.define("lsp.updated", z.object({})),
    RocqServerStatus: LSPClient.Event.RocqServerStatus,
    RocqFileProgress: LSPClient.Event.RocqFileProgress,
    RocqExecutionInformation: LSPClient.Event.RocqExecutionInformation,
  }

  export const Range = z
    .object({
      start: z.object({
        line: z.number(),
        character: z.number(),
      }),
      end: z.object({
        line: z.number(),
        character: z.number(),
      }),
    })
    .meta({
      ref: "Range",
    })
  export type Range = z.infer<typeof Range>

  export const Symbol = z
    .object({
      name: z.string(),
      kind: z.number(),
      location: z.object({
        uri: z.string(),
        range: Range,
      }),
    })
    .meta({
      ref: "Symbol",
    })
  export type Symbol = z.infer<typeof Symbol>

  export const DocumentSymbol = z
    .object({
      name: z.string(),
      detail: z.string().optional(),
      kind: z.number(),
      range: Range,
      selectionRange: Range,
    })
    .meta({
      ref: "DocumentSymbol",
    })
  export type DocumentSymbol = z.infer<typeof DocumentSymbol>

  const RocqHyp = z.object({
    names: z.array(z.string()),
    ty: z.string(),
  })

  const RocqGoal = z.object({
    hyps: z.array(RocqHyp),
    ty: z.string(),
  })

  const RocqGoalConfig = z.object({
    goals: z.array(RocqGoal),
    stack: z.array(z.tuple([z.array(RocqGoal), z.array(RocqGoal)]).or(z.array(z.any()))).catch([]),
    bullet: z.string().nullable().optional(),
    shelf: z.array(RocqGoal).catch([]),
    given_up: z.array(RocqGoal).catch([]),
  })

  const RocqMessage = z.object({
    level: z.number().optional(),
    text: z.string(),
    range: Range.optional(),
  })

  export const RocqGoals = RocqGoalConfig
  export type RocqGoals = z.infer<typeof RocqGoals>

  export const RocqGoalAnswer = z.object({
    textDocument: z
      .object({
        uri: z.string(),
        version: z.number().optional(),
      })
      .optional(),
    position: z
      .object({
        line: z.number(),
        character: z.number(),
      })
      .optional(),
    range: Range.optional(),
    goals: RocqGoalConfig.optional(),
    messages: z.array(z.union([z.string(), RocqMessage])).catch([]),
    error: z.string().optional(),
  })
  export type RocqGoalAnswer = z.infer<typeof RocqGoalAnswer>

  export const RocqPetanqueResult = z.object({
    st: z.number(),
    hash: z.number().optional(),
    proof_finished: z.boolean(),
    feedback: z.array(z.tuple([z.number(), z.string()])).default([]),
  })
  export type RocqPetanqueResult = z.infer<typeof RocqPetanqueResult>

  export const RocqErrorData = z.object({
    feedback: z.array(
      z.object({
        level: z.number().optional(),
        text: z.string(),
        range: Range.optional(),
      }),
    ),
  })
  export type RocqErrorData = z.infer<typeof RocqErrorData>

  const filterExperimentalServers = (servers: Record<string, LSPServer.Info>) => {
    if (Flag.OPENCODE_EXPERIMENTAL_LSP_TY) {
      // If experimental flag is enabled, disable pyright
      if (servers["pyright"]) {
        log.info("LSP server pyright is disabled because OPENCODE_EXPERIMENTAL_LSP_TY is enabled")
        delete servers["pyright"]
      }
    } else {
      // If experimental flag is disabled, disable ty
      if (servers["ty"]) {
        delete servers["ty"]
      }
    }
  }

  const state = Instance.state(
    async () => {
      const clients: LSPClient.Info[] = []
      const servers: Record<string, LSPServer.Info> = {}
      const cfg = await Config.get()

      if (cfg.lsp === false) {
        log.info("all LSPs are disabled")
        return {
          broken: new Set<string>(),
          servers,
          clients,
          spawning: new Map<string, Promise<LSPClient.Info | undefined>>(),
        }
      }

      for (const server of Object.values(LSPServer)) {
        servers[server.id] = server
      }

      filterExperimentalServers(servers)

      for (const [name, item] of Object.entries(cfg.lsp ?? {})) {
        const existing = servers[name]
        if (item.disabled) {
          log.info(`LSP server ${name} is disabled`)
          delete servers[name]
          continue
        }
        const run = existing?.spawn
        servers[name] = {
          ...existing,
          id: name,
          root: existing?.root ?? (async () => Instance.directory),
          extensions: item.extensions ?? existing?.extensions ?? [],
          spawn: async (root) => {
            if (!item.command && run) {
              const handle = await run(root, {
                env: item.env,
                initialization: item.initialization,
              })
              if (!handle) return handle
              return {
                ...handle,
                initialization: {
                  ...handle.initialization,
                  ...item.initialization,
                },
              }
            }
            if (!item.command) return undefined
            return {
              process: spawn(item.command[0], item.command.slice(1), {
                cwd: root,
                env: {
                  ...process.env,
                  ...item.env,
                },
              }),
              initialization: item.initialization,
              env: item.env,
            }
          },
        }
      }

      log.info("enabled LSP servers", {
        serverIds: Object.values(servers)
          .map((server) => server.id)
          .join(", "),
      })

      return {
        broken: new Set<string>(),
        servers,
        clients,
        spawning: new Map<string, Promise<LSPClient.Info | undefined>>(),
      }
    },
    async (state) => {
      await Promise.all(state.clients.map((client) => client.shutdown()))
    },
  )

  export async function init() {
    return state()
  }

  const RocqState = z.union([z.literal("Busy"), z.literal("Idle"), z.literal("Stopped")])

  const RocqProgress = z
    .object({
      path: z.string(),
      count: z.number(),
    })
    .meta({
      ref: "LSPRocqProgress",
    })

  const RocqExecution = z
    .object({
      path: z.string(),
      range: Range.optional(),
    })
    .meta({
      ref: "LSPRocqExecution",
    })

  const RocqCurrent = z
    .object({
      path: z.string(),
      goal: z.string().optional(),
      hyps: z.array(z.string()),
      error: z.string().optional(),
    })
    .meta({
      ref: "LSPRocqCurrent",
    })

  const RocqStatus = z
    .object({
      state: RocqState.optional(),
      modname: z.string().optional(),
      progress: z.array(RocqProgress),
      execution: z.array(RocqExecution),
      current: RocqCurrent.optional(),
    })
    .meta({
      ref: "LSPRocqStatus",
    })

  export const Status = z
    .object({
      id: z.string(),
      name: z.string(),
      root: z.string(),
      status: z.union([z.literal("connected"), z.literal("error")]),
      rocq: RocqStatus.optional(),
    })
    .meta({
      ref: "LSPStatus",
    })
  export type Status = z.infer<typeof Status>

  export async function status() {
    return state().then((x) =>
      x.clients.map((client) => ({
        id: client.serverID,
        name: x.servers[client.serverID].id,
        root: path.relative(Instance.directory, client.root),
        status: "connected" as const,
        rocq:
          client.serverID === "rocq-lsp"
            ? {
                state: client.rocq.serverStatus?.status,
                modname: client.rocq.serverStatus?.modname,
                progress: [...client.rocq.fileProgress.values()]
                  .map((item) => ({
                    path: path.relative(client.root, fileURLToPath(item.uri)),
                    count: item.processing.length,
                  }))
                  .toSorted((a, b) => a.path.localeCompare(b.path)),
                execution: [...client.rocq.executionInformation.values()]
                  .map((item) => ({
                    path: path.relative(client.root, fileURLToPath(item.uri)),
                    range: item.range,
                  }))
                  .toSorted((a, b) => a.path.localeCompare(b.path)),
                current: client.rocq.current
                  ? {
                      path: path.relative(client.root, fileURLToPath(client.rocq.current.uri)),
                      goal: client.rocq.current.goal,
                      hyps: client.rocq.current.hyps,
                      error: client.rocq.current.error,
                    }
                  : undefined,
              }
            : undefined,
      })),
    )
  }

  async function getClients(file: string) {
    const s = await state()
    const extension = path.parse(file).ext || file
    const result: LSPClient.Info[] = []

    async function schedule(server: LSPServer.Info, root: string, key: string) {
      const handle = await server
        .spawn(root)
        .then((value) => {
          if (!value) s.broken.add(key)
          return value
        })
        .catch((err) => {
          s.broken.add(key)
          log.error(`Failed to spawn LSP server ${server.id}`, { error: err })
          return undefined
        })

      if (!handle) return undefined
      log.info("spawned lsp server", { serverID: server.id })

      const client = await LSPClient.create({
        serverID: server.id,
        server: handle,
        root,
      }).catch((err) => {
        s.broken.add(key)
        handle.process.kill()
        log.error(`Failed to initialize LSP client ${server.id}`, { error: err })
        return undefined
      })

      if (!client) {
        handle.process.kill()
        return undefined
      }

      const existing = s.clients.find((x) => x.root === root && x.serverID === server.id)
      if (existing) {
        handle.process.kill()
        return existing
      }

      s.clients.push(client)
      return client
    }

    for (const server of Object.values(s.servers)) {
      if (server.extensions.length && !server.extensions.includes(extension)) continue

      const root = await server.root(file)
      if (!root) continue
      if (s.broken.has(root + server.id)) continue

      const match = s.clients.find((x) => x.root === root && x.serverID === server.id)
      if (match) {
        result.push(match)
        continue
      }

      const inflight = s.spawning.get(root + server.id)
      if (inflight) {
        const client = await inflight
        if (!client) continue
        result.push(client)
        continue
      }

      const task = schedule(server, root, root + server.id)
      s.spawning.set(root + server.id, task)

      task.finally(() => {
        if (s.spawning.get(root + server.id) === task) {
          s.spawning.delete(root + server.id)
        }
      })

      const client = await task
      if (!client) continue

      result.push(client)
      Bus.publish(Event.Updated, {})
    }

    return result
  }

  export async function hasClients(file: string) {
    const s = await state()
    const extension = path.parse(file).ext || file
    for (const server of Object.values(s.servers)) {
      if (server.extensions.length && !server.extensions.includes(extension)) continue
      const root = await server.root(file)
      if (!root) continue
      if (s.broken.has(root + server.id)) continue
      return true
    }
    return false
  }

  export async function touchFile(input: string, waitForDiagnostics?: boolean) {
    log.info("touching file", { file: input })
    const clients = await getClients(input)
    await Promise.all(
      clients.map(async (client) => {
        const wait = waitForDiagnostics ? client.waitForDiagnostics({ path: input }) : Promise.resolve()
        await client.notify.open({ path: input })
        return wait
      }),
    ).catch((err) => {
      log.error("failed to touch file", { err, file: input })
    })
  }

  export async function diagnostics() {
    const results: Record<string, LSPClient.Diagnostic[]> = {}
    for (const result of await runAll(async (client) => client.diagnostics)) {
      for (const [path, diagnostics] of result.entries()) {
        const arr = results[path] || []
        arr.push(...diagnostics)
        results[path] = arr
      }
    }
    return results
  }

  export async function hover(input: { file: string; line: number; character: number }) {
    return run(input.file, (client) => {
      return client.connection
        .sendRequest("textDocument/hover", {
          textDocument: {
            uri: pathToFileURL(input.file).href,
          },
          position: {
            line: input.line,
            character: input.character,
          },
        })
        .catch(() => null)
    })
  }

  enum SymbolKind {
    File = 1,
    Module = 2,
    Namespace = 3,
    Package = 4,
    Class = 5,
    Method = 6,
    Property = 7,
    Field = 8,
    Constructor = 9,
    Enum = 10,
    Interface = 11,
    Function = 12,
    Variable = 13,
    Constant = 14,
    String = 15,
    Number = 16,
    Boolean = 17,
    Array = 18,
    Object = 19,
    Key = 20,
    Null = 21,
    EnumMember = 22,
    Struct = 23,
    Event = 24,
    Operator = 25,
    TypeParameter = 26,
  }

  const kinds = [
    SymbolKind.Class,
    SymbolKind.Function,
    SymbolKind.Method,
    SymbolKind.Interface,
    SymbolKind.Variable,
    SymbolKind.Constant,
    SymbolKind.Struct,
    SymbolKind.Enum,
  ]

  export async function workspaceSymbol(query: string) {
    return runAll((client) =>
      client.connection
        .sendRequest("workspace/symbol", {
          query,
        })
        .then((result: any) => result.filter((x: LSP.Symbol) => kinds.includes(x.kind)))
        .then((result: any) => result.slice(0, 10))
        .catch(() => []),
    ).then((result) => result.flat() as LSP.Symbol[])
  }

  export async function documentSymbol(uri: string) {
    const file = fileURLToPath(uri)
    return run(file, (client) =>
      client.connection
        .sendRequest("textDocument/documentSymbol", {
          textDocument: {
            uri,
          },
        })
        .catch(() => []),
    )
      .then((result) => result.flat() as (LSP.DocumentSymbol | LSP.Symbol)[])
      .then((result) => result.filter(Boolean))
  }

  export async function definition(input: { file: string; line: number; character: number }) {
    return run(input.file, (client) =>
      client.connection
        .sendRequest("textDocument/definition", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
        })
        .catch(() => null),
    ).then((result) => result.flat().filter(Boolean))
  }

  export async function references(input: { file: string; line: number; character: number }) {
    return run(input.file, (client) =>
      client.connection
        .sendRequest("textDocument/references", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
          context: { includeDeclaration: true },
        })
        .catch(() => []),
    ).then((result) => result.flat().filter(Boolean))
  }

  export async function implementation(input: { file: string; line: number; character: number }) {
    return run(input.file, (client) =>
      client.connection
        .sendRequest("textDocument/implementation", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
        })
        .catch(() => null),
    ).then((result) => result.flat().filter(Boolean))
  }

  export async function prepareCallHierarchy(input: { file: string; line: number; character: number }) {
    return run(input.file, (client) =>
      client.connection
        .sendRequest("textDocument/prepareCallHierarchy", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
        })
        .catch(() => []),
    ).then((result) => result.flat().filter(Boolean))
  }

  export async function incomingCalls(input: { file: string; line: number; character: number }) {
    return run(input.file, async (client) => {
      const items = (await client.connection
        .sendRequest("textDocument/prepareCallHierarchy", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
        })
        .catch(() => [])) as any[]
      if (!items?.length) return []
      return client.connection.sendRequest("callHierarchy/incomingCalls", { item: items[0] }).catch(() => [])
    }).then((result) => result.flat().filter(Boolean))
  }

  export async function outgoingCalls(input: { file: string; line: number; character: number }) {
    return run(input.file, async (client) => {
      const items = (await client.connection
        .sendRequest("textDocument/prepareCallHierarchy", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
        })
        .catch(() => [])) as any[]
      if (!items?.length) return []
      return client.connection.sendRequest("callHierarchy/outgoingCalls", { item: items[0] }).catch(() => [])
    }).then((result) => result.flat().filter(Boolean))
  }

  async function runAll<T>(input: (client: LSPClient.Info) => Promise<T>): Promise<T[]> {
    const clients = await state().then((x) => x.clients)
    const tasks = clients.map((x) => input(x))
    return Promise.all(tasks)
  }

  async function run<T>(file: string, input: (client: LSPClient.Info) => Promise<T>): Promise<T[]> {
    const clients = await getClients(file)
    const tasks = clients.map((x) => input(x))
    return Promise.all(tasks)
  }

  export namespace Diagnostic {
    export function pretty(diagnostic: LSPClient.Diagnostic) {
      const severityMap = {
        1: "ERROR",
        2: "WARN",
        3: "INFO",
        4: "HINT",
      }

      const severity = severityMap[diagnostic.severity || 1]
      const line = diagnostic.range.start.line + 1
      const col = diagnostic.range.start.character + 1

      return `${severity} [${line}:${col}] ${diagnostic.message}`
    }
  }

  function isRocq(client: LSPClient.Info) {
    return client.serverID === "rocq-lsp"
  }

  async function runRocq<T>(file: string, input: (client: LSPClient.Info) => Promise<T>) {
    const clients = await getClients(file)
    const client = clients.find(isRocq)
    if (!client) throw new Error("rocq-lsp is not available. Install via: opam install coq-lsp")
    return input(client)
  }

  export async function rocqGoals(input: {
    file: string
    line: number
    character: number
    mode?: "Prev" | "After"
    command?: string
    pp_format?: "Str" | "Pp" | "Box"
    compact?: boolean
  }) {
    await touchFile(input.file)
    const result = await runRocq(input.file, (client) =>
      client.connection.sendRequest("proof/goals", {
        textDocument: {
          uri: pathToFileURL(input.file).href,
        },
        position: {
          line: input.line,
          character: input.character,
        },
        ...(input.mode ? { mode: input.mode } : {}),
        ...(input.command ? { command: input.command } : {}),
        ...(input.pp_format ? { pp_format: input.pp_format } : {}),
        ...(typeof input.compact === "boolean" ? { compact: input.compact } : {}),
      }),
    )
    return RocqGoalAnswer.parse(result)
  }

  export async function rocqDocument(input: { file: string; ast?: boolean; goals?: "Str" | "Pp" }) {
    await touchFile(input.file)
    return runRocq(input.file, (client) =>
      client.connection.sendRequest("coq/getDocument", {
        textDocument: {
          uri: pathToFileURL(input.file).href,
        },
        ...(input.ast ? { ast: true } : {}),
        ...(input.goals ? { goals: input.goals } : {}),
      }),
    )
  }

  export async function rocqSaveVo(input: { file: string }) {
    await touchFile(input.file)
    return runRocq(input.file, (client) =>
      client.connection.sendRequest("coq/saveVo", {
        textDocument: {
          uri: pathToFileURL(input.file).href,
        },
      }),
    )
  }

  export async function rocqPetanqueStart(input: {
    file: string
    theorem?: string
    position?: { line: number; character: number }
  }) {
    await touchFile(input.file)
    return runRocq(input.file, async (client) => {
      const uri = pathToFileURL(input.file).href
      const result = input.theorem
        ? await client.connection.sendRequest("petanque/start", {
            uri,
            thm: input.theorem,
          })
        : await client.connection.sendRequest("petanque/get_state_at_pos", {
            uri,
            position: input.position,
          })
      return RocqPetanqueResult.omit({ feedback: true }).parse(result)
    })
  }

  export async function rocqPetanqueRun(input: { file: string; state: number; tactic: string }) {
    await touchFile(input.file)
    try {
      const result = await runRocq(input.file, (client) =>
        client.connection.sendRequest("petanque/run", {
          st: input.state,
          tac: input.tactic,
        }),
      )
      return {
        ok: true as const,
        result: RocqPetanqueResult.parse(result),
      }
    } catch (error: any) {
      const data = RocqErrorData.safeParse(error?.data)
      return {
        ok: false as const,
        error: {
          message: error?.message || error?.data?.message || String(error),
          feedback: data.success ? data.data.feedback : [],
        },
      }
    }
  }

  export async function rocqPetanqueGoals(input: { file: string; state: number }) {
    await touchFile(input.file)
    const result = await runRocq(input.file, (client) =>
      client.connection.sendRequest("petanque/goals", {
        st: input.state,
      }),
    )
    return RocqGoalConfig.parse(result)
  }
}
