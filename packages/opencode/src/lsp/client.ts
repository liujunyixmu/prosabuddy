import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import path from "path"
import { pathToFileURL, fileURLToPath } from "url"
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node"
import type { Diagnostic as VSCodeDiagnostic } from "vscode-languageserver-types"
import { Log } from "../util/log"
import { LANGUAGE_EXTENSIONS } from "./language"
import z from "zod"
import type { LSPServer } from "./server"
import { NamedError } from "@opencode-ai/util/error"
import { withTimeout } from "../util/timeout"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"

const DIAGNOSTICS_DEBOUNCE_MS = 150

const RocqFeedback = z.object({
  level: z.number().optional(),
  text: z.string(),
  range: z
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
    .optional(),
})

const RocqStateRange = z.object({
  start: z.object({
    line: z.number(),
    character: z.number(),
  }),
  end: z.object({
    line: z.number(),
    character: z.number(),
  }),
})

const RocqGoalHyp = z.object({
  names: z.array(z.string()),
  ty: z.string(),
})

const RocqCurrentGoal = z.object({
  hyps: z.array(RocqGoalHyp),
  ty: z.string(),
})

const RocqGoalSnapshot = z.object({
  goals: z
    .object({
      goals: z.array(RocqCurrentGoal),
    })
    .optional(),
  error: z.string().optional(),
})

export namespace LSPClient {
  const log = Log.create({ service: "lsp.client" })

  export type Info = NonNullable<Awaited<ReturnType<typeof create>>>

  export type Diagnostic = VSCodeDiagnostic
  export type RocqFeedback = z.infer<typeof RocqFeedback>

  export const InitializeError = NamedError.create(
    "LSPInitializeError",
    z.object({
      serverID: z.string(),
    }),
  )

  export const Event = {
    Diagnostics: BusEvent.define(
      "lsp.client.diagnostics",
      z.object({
        serverID: z.string(),
        path: z.string(),
      }),
    ),
    RocqServerStatus: BusEvent.define(
      "lsp.client.rocq.server-status",
      z.object({
        serverID: z.string(),
        root: z.string(),
        status: z.union([z.literal("Busy"), z.literal("Idle"), z.literal("Stopped")]),
        modname: z.string().optional(),
      }),
    ),
    RocqFileProgress: BusEvent.define(
      "lsp.client.rocq.file-progress",
      z.object({
        serverID: z.string(),
        root: z.string(),
        uri: z.string(),
        processing: z.array(
          z.object({
            range: RocqStateRange,
            kind: z.number().optional(),
          }),
        ),
      }),
    ),
    RocqExecutionInformation: BusEvent.define(
      "lsp.client.rocq.execution-information",
      z.object({
        serverID: z.string(),
        root: z.string(),
        uri: z.string(),
        range: RocqStateRange.optional(),
      }),
    ),
  }

  export async function create(input: { serverID: string; server: LSPServer.Handle; root: string }) {
    const l = log.clone().tag("serverID", input.serverID)
    l.info("starting client")

    const connection = createMessageConnection(
      new StreamMessageReader(input.server.process.stdout as any),
      new StreamMessageWriter(input.server.process.stdin as any),
    )

    const diagnostics = new Map<string, Diagnostic[]>()
    const rocq = {
      serverStatus: null as null | {
        status: "Busy" | "Idle" | "Stopped"
        modname?: string
      },
      fileProgress: new Map<
        string,
        {
          uri: string
          processing: { range: z.infer<typeof RocqStateRange>; kind?: number }[]
        }
      >(),
      executionInformation: new Map<string, { uri: string; range?: z.infer<typeof RocqStateRange> }>(),
      current: null as null | {
        uri: string
        goal?: string
        hyps: string[]
        error?: string
      },
      goalSeq: 0,
    }

    async function refreshCurrent(info: { uri: string; range?: z.infer<typeof RocqStateRange> }) {
      const seq = ++rocq.goalSeq
      if (!info.range) {
        if (seq !== rocq.goalSeq) return
        rocq.current = {
          uri: info.uri,
          hyps: [],
        }
        return
      }

      const result = await connection
        .sendRequest("proof/goals", {
          textDocument: {
            uri: info.uri,
          },
          position: {
            line: info.range.end.line,
            character: info.range.end.character,
          },
          mode: "After",
          pp_format: "Str",
          compact: true,
        })
        .catch(() => undefined)

      if (seq !== rocq.goalSeq) return
      if (!result) {
        rocq.current = {
          uri: info.uri,
          hyps: [],
          error: "Unable to load current goal",
        }
        return
      }

      const parsed = RocqGoalSnapshot.safeParse(result)
      if (!parsed.success) {
        rocq.current = {
          uri: info.uri,
          hyps: [],
          error: "Unable to parse current goal",
        }
        return
      }

      const goal = parsed.data.goals?.goals[0]
      rocq.current = {
        uri: info.uri,
        goal: goal?.ty,
        hyps: goal?.hyps.map((item) => `${item.names.join(", ")}: ${item.ty}`) ?? [],
        error: parsed.data.error,
      }
    }
    connection.onNotification("textDocument/publishDiagnostics", (params) => {
      const filePath = Filesystem.normalizePath(fileURLToPath(params.uri))
      l.info("textDocument/publishDiagnostics", {
        path: filePath,
        count: params.diagnostics.length,
      })
      const exists = diagnostics.has(filePath)
      diagnostics.set(filePath, params.diagnostics)
      if (!exists && input.serverID === "typescript") return
      Bus.publish(Event.Diagnostics, { path: filePath, serverID: input.serverID })
    })
    connection.onNotification("$/coq/serverStatus", (params) => {
      if (input.serverID !== "rocq-lsp") return
      const status = z
        .object({
          status: z.union([z.literal("Busy"), z.literal("Idle"), z.literal("Stopped")]),
          modname: z.string().optional(),
        })
        .safeParse(params)
      if (!status.success) return
      rocq.serverStatus = status.data
      Bus.publish(Event.RocqServerStatus, {
        serverID: input.serverID,
        root: input.root,
        ...status.data,
      })
    })
    connection.onNotification("$/coq/fileProgress", (params) => {
      if (input.serverID !== "rocq-lsp") return
      const progress = z
        .object({
          textDocument: z.object({
            uri: z.string(),
          }),
          processing: z.array(
            z.object({
              range: RocqStateRange,
              kind: z.number().optional(),
            }),
          ),
        })
        .safeParse(params)
      if (!progress.success) return
      rocq.fileProgress.set(progress.data.textDocument.uri, {
        uri: progress.data.textDocument.uri,
        processing: progress.data.processing,
      })
      Bus.publish(Event.RocqFileProgress, {
        serverID: input.serverID,
        root: input.root,
        uri: progress.data.textDocument.uri,
        processing: progress.data.processing,
      })
    })
    connection.onNotification("$/coq/executionInformation", async (params) => {
      if (input.serverID !== "rocq-lsp") return
      const info = z
        .object({
          textDocument: z.object({
            uri: z.string(),
          }),
          range: RocqStateRange.optional(),
        })
        .safeParse(params)
      if (!info.success) return
      rocq.executionInformation.set(info.data.textDocument.uri, {
        uri: info.data.textDocument.uri,
        range: info.data.range,
      })
      await refreshCurrent({
        uri: info.data.textDocument.uri,
        range: info.data.range,
      })
      Bus.publish(Event.RocqExecutionInformation, {
        serverID: input.serverID,
        root: input.root,
        uri: info.data.textDocument.uri,
        range: info.data.range,
      })
    })
    connection.onRequest("window/workDoneProgress/create", (params) => {
      l.info("window/workDoneProgress/create", params)
      return null
    })
    connection.onRequest("workspace/configuration", async () => {
      // Return server initialization options
      return [input.server.initialization ?? {}]
    })
    connection.onRequest("client/registerCapability", async () => {})
    connection.onRequest("client/unregisterCapability", async () => {})
    connection.onRequest("workspace/workspaceFolders", async () => [
      {
        name: "workspace",
        uri: pathToFileURL(input.root).href,
      },
    ])
    connection.listen()

    l.info("sending initialize")
    await withTimeout(
      connection.sendRequest("initialize", {
        rootUri: pathToFileURL(input.root).href,
        processId: input.server.process.pid,
        workspaceFolders: [
          {
            name: "workspace",
            uri: pathToFileURL(input.root).href,
          },
        ],
        initializationOptions: {
          ...input.server.initialization,
        },
        capabilities: {
          window: {
            workDoneProgress: true,
          },
          workspace: {
            configuration: true,
            didChangeWatchedFiles: {
              dynamicRegistration: true,
            },
          },
          textDocument: {
            synchronization: {
              didOpen: true,
              didChange: true,
            },
            publishDiagnostics: {
              versionSupport: true,
            },
          },
        },
      }),
      45_000,
    ).catch((err) => {
      l.error("initialize error", { error: err })
      throw new InitializeError(
        { serverID: input.serverID },
        {
          cause: err,
        },
      )
    })

    await connection.sendNotification("initialized", {})

    if (input.server.initialization) {
      await connection.sendNotification("workspace/didChangeConfiguration", {
        settings: input.server.initialization,
      })
    }

    const files: {
      [path: string]: number
    } = {}

    const result = {
      root: input.root,
      get serverID() {
        return input.serverID
      },
      get connection() {
        return connection
      },
      notify: {
        async open(input: { path: string }) {
          input.path = path.isAbsolute(input.path) ? input.path : path.resolve(Instance.directory, input.path)
          const text = await Filesystem.readText(input.path)
          const extension = path.extname(input.path)
          const languageId = LANGUAGE_EXTENSIONS[extension] ?? "plaintext"

          const version = files[input.path]
          if (version !== undefined) {
            log.info("workspace/didChangeWatchedFiles", input)
            await connection.sendNotification("workspace/didChangeWatchedFiles", {
              changes: [
                {
                  uri: pathToFileURL(input.path).href,
                  type: 2, // Changed
                },
              ],
            })

            const next = version + 1
            files[input.path] = next
            log.info("textDocument/didChange", {
              path: input.path,
              version: next,
            })
            await connection.sendNotification("textDocument/didChange", {
              textDocument: {
                uri: pathToFileURL(input.path).href,
                version: next,
              },
              contentChanges: [{ text }],
            })
            return
          }

          log.info("workspace/didChangeWatchedFiles", input)
          await connection.sendNotification("workspace/didChangeWatchedFiles", {
            changes: [
              {
                uri: pathToFileURL(input.path).href,
                type: 1, // Created
              },
            ],
          })

          log.info("textDocument/didOpen", input)
          diagnostics.delete(input.path)
          await connection.sendNotification("textDocument/didOpen", {
            textDocument: {
              uri: pathToFileURL(input.path).href,
              languageId,
              version: 0,
              text,
            },
          })
          files[input.path] = 0
          return
        },
      },
      get diagnostics() {
        return diagnostics
      },
      get rocq() {
        return rocq
      },
      async waitForDiagnostics(input: { path: string }) {
        const normalizedPath = Filesystem.normalizePath(
          path.isAbsolute(input.path) ? input.path : path.resolve(Instance.directory, input.path),
        )
        log.info("waiting for diagnostics", { path: normalizedPath })
        let unsub: () => void
        let debounceTimer: ReturnType<typeof setTimeout> | undefined
        return await withTimeout(
          new Promise<void>((resolve) => {
            unsub = Bus.subscribe(Event.Diagnostics, (event) => {
              if (event.properties.path === normalizedPath && event.properties.serverID === result.serverID) {
                // Debounce to allow LSP to send follow-up diagnostics (e.g., semantic after syntax)
                if (debounceTimer) clearTimeout(debounceTimer)
                debounceTimer = setTimeout(() => {
                  log.info("got diagnostics", { path: normalizedPath })
                  unsub?.()
                  resolve()
                }, DIAGNOSTICS_DEBOUNCE_MS)
              }
            })
          }),
          3000,
        )
          .catch(() => {})
          .finally(() => {
            if (debounceTimer) clearTimeout(debounceTimer)
            unsub?.()
          })
      },
      async shutdown() {
        l.info("shutting down")
        connection.end()
        connection.dispose()
        input.server.process.kill()
        l.info("shutdown")
      },
    }

    l.info("initialized")

    return result
  }
}
