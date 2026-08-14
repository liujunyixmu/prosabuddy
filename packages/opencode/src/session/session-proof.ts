import { Database, eq } from "@/storage/db"
import { SessionProofTable } from "./session-proof.sql"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Log } from "@/util/log"
import { LSP } from "@/lsp"
import { LSPClient } from "@/lsp/client"
import z from "zod"
import { pathToFileURL } from "url"
import { readFileSync } from "fs"
import path from "path"

export namespace SessionProof {
  const log = Log.create({ service: "session-proof" })

  export const Source = z.enum(["auto", "tool", "ide", "parent", "manual"])
  export type Source = z.infer<typeof Source>

  export const Binding = z.object({
    file: z.string(),
    uri: z.string(),
    line: z.number(),
    character: z.number(),
    source: Source,
    locked: z.boolean(),
    stale: z.boolean(),
    version: z.number().optional(),
    canonicalSource: z.string().optional(),
    updated: z.number(),
  })
  export type Binding = z.infer<typeof Binding>

  export const Event = {
    Updated: BusEvent.define(
      "session.proof.updated",
      z.object({
        sessionID: z.string(),
        binding: Binding,
      }),
    ),
    Cleared: BusEvent.define(
      "session.proof.cleared",
      z.object({ sessionID: z.string() }),
    ),
    Stale: BusEvent.define(
      "session.proof.stale",
      z.object({ sessionID: z.string(), file: z.string() }),
    ),
  }

  const cache = new Map<string, Binding>()

  function toBinding(row: typeof SessionProofTable.$inferSelect): Binding {
    return {
      file: row.file,
      uri: row.uri,
      line: row.line,
      character: row.character,
      source: row.source,
      locked: row.locked,
      stale: row.stale,
      version: row.doc_version ?? undefined,
      canonicalSource: row.canonical_source ?? undefined,
      updated: row.time_updated,
    }
  }

  export function get(sessionID: string): Binding | undefined {
    const hit = cache.get(sessionID)
    if (hit) return hit

    const row = Database.use((db) =>
      db.select().from(SessionProofTable).where(eq(SessionProofTable.session_id, sessionID)).get(),
    )
    if (!row) return undefined

    const binding = toBinding(row)
    cache.set(sessionID, binding)
    return binding
  }

  export function set(
    sessionID: string,
    file: string,
    position: { line: number; character: number },
    source: Source,
    opts?: { locked?: boolean; version?: number; canonicalSource?: string | null },
  ): Binding {
    const uri = pathToFileURL(file).href
    const now = Date.now()
    const locked = opts?.locked ?? false
    const previous = get(sessionID)
    const canonicalSource = (() => {
      if (opts?.canonicalSource === null) return undefined
      if (opts?.canonicalSource !== undefined) return opts.canonicalSource
      if (previous && path.normalize(previous.file) === path.normalize(file)) {
        return previous.canonicalSource
      }
      if (!file.endsWith(".v")) return undefined
      try {
        return readFileSync(file, "utf-8")
      } catch {
        return undefined
      }
    })()

    Database.use((db) =>
      db
        .insert(SessionProofTable)
        .values({
          session_id: sessionID,
          file,
          uri,
          line: position.line,
          character: position.character,
          source,
          locked,
          stale: false,
          doc_version: opts?.version ?? null,
          canonical_source: canonicalSource ?? null,
          time_created: now,
          time_updated: now,
        })
        .onConflictDoUpdate({
          target: SessionProofTable.session_id,
          set: {
            file,
            uri,
            line: position.line,
            character: position.character,
            source,
            locked,
            stale: false,
            doc_version: opts?.version ?? null,
            canonical_source: canonicalSource ?? null,
            time_updated: now,
          },
        })
        .run(),
    )

    const binding: Binding = {
      file,
      uri,
      line: position.line,
      character: position.character,
      source,
      locked,
      stale: false,
      version: opts?.version,
      canonicalSource,
      updated: now,
    }
    cache.set(sessionID, binding)
    log.info("set", { sessionID, file, line: position.line, character: position.character, source })
    Bus.publish(Event.Updated, { sessionID, binding })
    return binding
  }

  export function clear(sessionID: string) {
    Database.use((db) =>
      db.delete(SessionProofTable).where(eq(SessionProofTable.session_id, sessionID)).run(),
    )
    cache.delete(sessionID)
    Bus.publish(Event.Cleared, { sessionID })
  }

  export function markStale(sessionID: string) {
    const binding = get(sessionID)
    if (!binding) return

    Database.use((db) =>
      db
        .update(SessionProofTable)
        .set({ stale: true, time_updated: Date.now() })
        .where(eq(SessionProofTable.session_id, sessionID))
        .run(),
    )

    binding.stale = true
    cache.set(sessionID, binding)
    Bus.publish(Event.Stale, { sessionID, file: binding.file })
  }

  export function touch(sessionID: string) {
    Database.use((db) =>
      db
        .update(SessionProofTable)
        .set({ stale: false, time_updated: Date.now() })
        .where(eq(SessionProofTable.session_id, sessionID))
        .run(),
    )

    const binding = cache.get(sessionID)
    if (binding) {
      binding.stale = false
      binding.updated = Date.now()
    }
  }

  export function inherit(parentID: string, childID: string): Binding | undefined {
    const parent = get(parentID)
    if (!parent) return undefined
    if (parent.locked) return undefined
    return set(childID, parent.file, { line: parent.line, character: parent.character }, "parent", {
      canonicalSource: parent.canonicalSource ?? null,
    })
  }

  export function subscribe() {
    Bus.subscribe(LSPClient.Event.Diagnostics, (event) => {
      for (const [sid, b] of cache) {
        if (b.file === event.properties.path) markStale(sid)
      }
    })
    Bus.subscribe(LSP.Event.RocqExecutionInformation, (event) => {
      for (const [sid, b] of cache) {
        if (b.file.endsWith(event.properties.uri) || event.properties.uri.endsWith(b.file.split("/").pop()!))
          markStale(sid)
      }
    })
    Bus.subscribe(LSP.Event.RocqFileProgress, (event) => {
      for (const [sid, b] of cache) {
        if (b.file.endsWith(event.properties.uri) || event.properties.uri.endsWith(b.file.split("/").pop()!))
          markStale(sid)
      }
    })
    log.info("subscribed to LSP events for stale marking")
  }

  export function warm() {
    const rows = Database.use((db) => db.select().from(SessionProofTable).all())
    for (const row of rows) cache.set(row.session_id, toBinding(row))
    log.info("warmed cache", { count: rows.length })
  }
}
