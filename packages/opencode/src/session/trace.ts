import fs from "fs/promises"
import path from "path"
import { Global } from "../global"
import { Log } from "@/util/log"
import type { ModelMessage } from "ai"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { createHash } from "crypto"

export namespace Trace {
  const log = Log.create({ service: "trace" })

  function root() {
    return process.env.OPENCODE_TRACE_DIR || path.join(Global.Path.data, "trace")
  }

  export const Event = {
    Request: BusEvent.define(
      "trace.request",
      z.object({
        sessionID: z.string(),
        timestamp: z.string(),
        step: z.number(),
        requestID: z.string().optional(),
        model: z.object({
          id: z.string(),
          providerID: z.string(),
        }),
        agent: z.string(),
        temperature: z.number().optional(),
        topP: z.number().optional(),
        topK: z.number().optional(),
        maxOutputTokens: z.number().optional(),
        tools: z.array(z.string()),
        system: z.object({
          count: z.number(),
          bytes: z.number(),
        }),
        messages: z.object({
          count: z.number(),
          bytes: z.number(),
        }),
        cache: z.object({
          promptCacheKey: z.string().optional(),
          providerOptionKeys: z.array(z.string()),
        }),
      }),
    ),
  }

  // ── Run-level grouping ──────────────────────────────────────────
  // A "run" represents a single opencode process invocation.
  // All sessions created during the same process are grouped under
  // trace/run-<YYYYMMDD-HHmmss>-<PID>/ so that parallel processes
  // never mix their traces.

  let rid: string | undefined
  let rdir: string | undefined
  let rstart: number | undefined
  let eventFilesEnabled = true
  let flatRun = false

  function pad2(n: number) {
    return String(n).padStart(2, "0")
  }

  let enabled = false

  /** Initialise a new run and enable trace recording. */
  export async function run(id?: string, options?: { events?: boolean; flat?: boolean }) {
    enabled = true
    eventFilesEnabled = options?.events ?? true
    flatRun = options?.flat ?? false
    if (rid) return rid
    const now = new Date()
    rid = id ?? `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}-${process.pid}`
    rdir = flatRun ? root() : path.join(root(), `run-${rid}`)
    rstart = Date.now()
    await fs.mkdir(rdir, { recursive: true })
    if (!flatRun) {
      await fs.writeFile(
        path.join(rdir, "run.json"),
        safe({
          id: rid,
          pid: process.pid,
          start: now.toISOString(),
          argv: process.argv.slice(2),
          cwd: process.cwd(),
        }),
      )
    }
    return rid
  }

  /** Return the current run ID, or undefined if not initialised. */
  export function runID() {
    return rid
  }

  /** Return the current run directory path. */
  export function runDir() {
    return rdir
  }

  /** Write run-level summary and wait for all session writes. */
  export async function runEnd() {
    if (!enabled) return
    if (!rdir || !rstart) return
    // wait for every tracked session to flush
    for (const s of sessions.values()) {
      await Promise.all(s.pending.slice())
    }
    if (flatRun) return
    const ids = [...sessions.keys()]
    const elapsed = Date.now() - rstart
    await fs.writeFile(
      path.join(rdir, "summary.json"),
      safe({
        id: rid,
        sessions: ids,
        elapsed,
        end: new Date().toISOString(),
      }),
    )
  }

  /** The base directory under which session folders are created. */
  function base() {
    return rdir ?? root()
  }

  // ── Per-session bookkeeping ─────────────────────────────────────
  let ready = false
  async function ensure() {
    if (ready) return
    await fs.mkdir(base(), { recursive: true })
    ready = true
  }

  interface Session {
    dir: string
    step: number
    seq: number
    start: number
    pending: Promise<void>[]
    requests: Map<number, RequestRecord>
  }

  type TokenUsage = {
    total?: number
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }

  type RequestRecord = {
    type: "request"
    timestamp: string
    request_id?: string
    session_id: string
    step: number
    agent: string
    model: string
    provider: string
    prompt_cache_key?: string
    parameters: {
      temperature?: number
      top_p?: number
      top_k?: number
      max_output_tokens?: number
    }
    hashes: {
      system_prompt_hash: string
      tools_schema_hash: string
      tools_schema_hash_kind: "tool_names"
      first_256_tokens_hash: string
      first_1024_tokens_hash: string
      first_2048_tokens_hash: string
      agents_md_hash?: string
      instructions_hash: string
      tool_output_hash: string
      hash_algorithm: "sha256"
      token_hash_kind: "whitespace"
    }
    counts: {
      system_messages: number
      system_bytes: number
      messages: number
      messages_bytes: number
      tools: number
      tool_results: number
    }
    flags: {
      was_compacted: boolean
    }
    tools: string[]
    provider_option_keys: string[]
    provider_options?: Record<string, unknown>
    system: string[]
    messages: ModelMessage[]
  }

  const sessions = new Map<string, Session>()

  function safe(data: unknown): string {
    return JSON.stringify(
      data,
      (_key, val) => {
        if (val instanceof Error) return { name: val.name, message: val.message, stack: val.stack }
        if (typeof val === "bigint") return val.toString()
        if (val instanceof ArrayBuffer || val instanceof Uint8Array) return "[binary]"
        return val
      },
      2,
    )
  }

  function safeLine(data: unknown): string {
    return JSON.stringify(data, (_key, val) => {
      if (val instanceof Error) return { name: val.name, message: val.message, stack: val.stack }
      if (typeof val === "bigint") return val.toString()
      if (val instanceof ArrayBuffer || val instanceof Uint8Array) return "[binary]"
      return val
    })
  }

  function stable(data: unknown): string {
    return JSON.stringify(data, (_key, val) => {
      if (val instanceof Error) return { name: val.name, message: val.message, stack: val.stack }
      if (typeof val === "bigint") return val.toString()
      if (val instanceof ArrayBuffer || val instanceof Uint8Array) return "[binary]"
      if (!val || typeof val !== "object" || Array.isArray(val)) return val
      return Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
    })
  }

  function sha256(input: unknown) {
    return createHash("sha256").update(typeof input === "string" ? input : stable(input)).digest("hex")
  }

  function textFromContent(content: unknown): string {
    if (typeof content === "string") return content
    if (!Array.isArray(content)) return stable(content)
    return content
      .map((part) => {
        if (!part || typeof part !== "object") return stable(part)
        if ("text" in part && typeof part.text === "string") return part.text
        if ("output" in part && typeof part.output === "string") return part.output
        if ("value" in part && typeof part.value === "string") return part.value
        return stable(part)
      })
      .join("\n")
  }

  function promptText(system: string[], messages: ModelMessage[]) {
    return [
      ...system,
      ...messages.map((message) => `${message.role}: ${textFromContent(message.content)}`),
    ].join("\n")
  }

  function firstTokenHash(text: string, count: number) {
    return sha256(text.split(/\s+/).filter(Boolean).slice(0, count).join(" "))
  }

  function toolResultText(messages: ModelMessage[]) {
    return messages
      .filter((message) => message.role === "tool")
      .map((message) => textFromContent(message.content))
      .join("\n")
  }

  function hasCompaction(messages: ModelMessage[]) {
    return messages.some((message) => textFromContent(message.content).includes("What did we do so far?"))
  }

  function usageRecord(tokens: TokenUsage) {
    const promptTokens = tokens.input + tokens.cache.read + tokens.cache.write
    const promptCacheHitTokens = tokens.cache.read
    const promptCacheMissTokens = tokens.input
    return {
      prompt_tokens: promptTokens,
      prompt_cache_hit_tokens: promptCacheHitTokens,
      cached_tokens: promptCacheHitTokens,
      prompt_cache_miss_tokens: promptCacheMissTokens,
      cache_write_tokens: tokens.cache.write,
      output_tokens: tokens.output,
      reasoning_tokens: tokens.reasoning,
      total_tokens: tokens.total,
      cache_read_ratio: promptTokens > 0 ? promptCacheHitTokens / promptTokens : 0,
    }
  }

  function byteLength(data: unknown) {
    return Buffer.byteLength(typeof data === "string" ? data : safe(data), "utf8")
  }

  async function write(session: Session, filepath: string, data: unknown) {
    await fs.mkdir(path.dirname(filepath), { recursive: true }).catch(() => {})
    await fs.writeFile(filepath, safe(data)).catch((e) => {
      log.error("trace write failed", { path: filepath, error: e })
    })
  }

  async function appendJsonl(session: Session, filepath: string, data: unknown) {
    await fs.mkdir(path.dirname(filepath), { recursive: true }).catch(() => {})
    await fs.appendFile(filepath, safeLine(data) + "\n").catch((e) => {
      log.error("trace append failed", { path: filepath, error: e })
    })
  }

  function track(session: Session, p: Promise<void>) {
    session.pending.push(p)
    p.finally(() => {
      const idx = session.pending.indexOf(p)
      if (idx !== -1) session.pending.splice(idx, 1)
    })
  }

  async function restore(folder: string): Promise<{ step: number; seq: number }> {
    const entries = await fs.readdir(folder).catch(() => [] as string[])
    let step = 0
    let seq = 0
    for (const e of entries) {
      const m = e.match(/^step-(\d+)$/)
      if (!m) continue
      const n = parseInt(m[1], 10)
      if (n > step) step = n
    }
    if (step > 0) {
      const files = await fs.readdir(path.join(folder, `step-${String(step).padStart(3, "0")}`)).catch(() => [] as string[])
      for (const f of files) {
        const m = f.match(/^(\d+)_/)
        if (!m) continue
        const n = parseInt(m[1], 10)
        if (n > seq) seq = n
      }
    }
    return { step, seq }
  }

  export async function begin(sessionID: string) {
    if (sessions.has(sessionID)) return sessions.get(sessionID)!
    if (!enabled) {
      const session: Session = { dir: path.join(root(), sessionID), step: 0, seq: 0, start: Date.now(), pending: [], requests: new Map() }
      sessions.set(sessionID, session)
      return session
    }
    await ensure()
    const folder = path.join(base(), sessionID)
    const prev = await restore(folder)
    const session: Session = { dir: folder, step: prev.step, seq: prev.seq, start: Date.now(), pending: [], requests: new Map() }
    sessions.set(sessionID, session)
    return session
  }

  export async function end(sessionID: string) {
    if (!enabled) return
    if (!eventFilesEnabled) return
    const session = sessions.get(sessionID)
    if (!session) return
    // Wait for all in-flight writes to complete
    await Promise.all(session.pending.slice())
    const elapsed = Date.now() - session.start
    await write(session, path.join(session.dir, "summary.json"), {
      sessionID,
      run: rid,
      steps: session.step,
      events: session.seq,
      elapsed,
      end: new Date().toISOString(),
    })
  }

  export async function currentStep(sessionID: string) {
    const session = sessions.get(sessionID)
    if (session) return session.step
    if (!enabled) return 0
    const folder = path.join(base(), sessionID)
    const prev = await restore(folder)
    return prev.step
  }

  function stepDir(session: Session) {
    return path.join(session.dir, `step-${String(session.step).padStart(3, "0")}`)
  }

  export async function request(sessionID: string, input: {
    requestID?: string
    model: { id: string; providerID: string }
    agent: string
    system: string[]
    messages: ModelMessage[]
    tools: string[]
    temperature?: number
    topP?: number
    topK?: number
    maxOutputTokens?: number
    providerOptions?: Record<string, unknown>
    cache?: {
      promptCacheKey?: string
      providerOptionKeys?: string[]
    }
  }) {
    const session = await begin(sessionID)
    session.step++
    if (!enabled) return
    const timestamp = new Date().toISOString()
    const fullPromptText = promptText(input.system, input.messages)
    const toolNames = [...input.tools].sort()
    const systemText = input.system.join("\n")
    const toolOutput = toolResultText(input.messages)
    const instructionsText = [systemText, input.messages.filter((message) => message.role === "system").map((message) => textFromContent(message.content)).join("\n")]
      .filter(Boolean)
      .join("\n")
    const event = {
      sessionID,
      timestamp,
      step: session.step,
      requestID: input.requestID,
      model: input.model,
      agent: input.agent,
      temperature: input.temperature,
      topP: input.topP,
      topK: input.topK,
      maxOutputTokens: input.maxOutputTokens,
      tools: input.tools,
      system: {
        count: input.system.length,
        bytes: byteLength(input.system),
      },
      messages: {
        count: input.messages.length,
        bytes: byteLength(input.messages),
      },
      cache: {
        promptCacheKey: input.cache?.promptCacheKey,
        providerOptionKeys: input.cache?.providerOptionKeys ?? Object.keys(input.providerOptions ?? {}),
      },
    }
    const record: RequestRecord = {
      type: "request",
      timestamp,
      request_id: input.requestID,
      session_id: sessionID,
      step: session.step,
      agent: input.agent,
      model: input.model.id,
      provider: input.model.providerID,
      prompt_cache_key: input.cache?.promptCacheKey,
      parameters: {
        temperature: input.temperature,
        top_p: input.topP,
        top_k: input.topK,
        max_output_tokens: input.maxOutputTokens,
      },
      hashes: {
        system_prompt_hash: sha256(systemText),
        tools_schema_hash: sha256(toolNames),
        tools_schema_hash_kind: "tool_names",
        first_256_tokens_hash: firstTokenHash(fullPromptText, 256),
        first_1024_tokens_hash: firstTokenHash(fullPromptText, 1024),
        first_2048_tokens_hash: firstTokenHash(fullPromptText, 2048),
        instructions_hash: sha256(instructionsText),
        tool_output_hash: sha256(toolOutput),
        hash_algorithm: "sha256",
        token_hash_kind: "whitespace",
      },
      counts: {
        system_messages: input.system.length,
        system_bytes: byteLength(input.system),
        messages: input.messages.length,
        messages_bytes: byteLength(input.messages),
        tools: input.tools.length,
        tool_results: input.messages.filter((message) => message.role === "tool").length,
      },
      flags: {
        was_compacted: hasCompaction(input.messages),
      },
      tools: input.tools,
      provider_option_keys: input.cache?.providerOptionKeys ?? Object.keys(input.providerOptions ?? {}),
      provider_options: input.providerOptions,
      system: input.system,
      messages: input.messages,
    }
    // A request record is needed only until the matching step result is
    // appended. Keep at most the current in-flight request so an interrupted
    // or missing step cannot retain every full prompt in a long-running
    // traced session.
    for (const step of session.requests.keys()) {
      if (step < session.step) session.requests.delete(step)
    }
    session.requests.set(session.step, record)
    await Bus.publish(Event.Request, event)
  }

  export async function event(sessionID: string, type: string, data: unknown) {
    const session = sessions.get(sessionID)
    if (!session) {
      // Session may not be initialised yet — ensure it is and retry
      const s = await begin(sessionID)
      s.seq++
      if (!enabled || !eventFilesEnabled) return
      const folder = stepDir(s)
      const idx = String(s.seq).padStart(4, "0")
      track(s, write(s, path.join(folder, `${idx}_${type}.json`), {
        timestamp: new Date().toISOString(),
        type,
        data,
      }))
      return
    }
    session.seq++
    if (!enabled || !eventFilesEnabled) return
    const folder = stepDir(session)
    const idx = String(session.seq).padStart(4, "0")
    track(session, write(session, path.join(folder, `${idx}_${type}.json`), {
      timestamp: new Date().toISOString(),
      type,
      data,
    }))
  }

  export async function tool(sessionID: string, input: {
    name: string
    callID: string
    args: unknown
  }) {
    return event(sessionID, `tool-call_${input.name}`, {
      callID: input.callID,
      tool: input.name,
      input: input.args,
    })
  }

  export async function result(sessionID: string, input: {
    name: string
    callID: string
    args: unknown
    output: unknown
    metadata?: unknown
    title?: string
    error?: string
    elapsed?: number
  }) {
    return event(sessionID, `tool-result_${input.name}`, {
      callID: input.callID,
      tool: input.name,
      input: input.args,
      output: input.output,
      metadata: input.metadata,
      title: input.title,
      error: input.error,
      elapsed: input.elapsed,
    })
  }

  export async function text(sessionID: string, content: string) {
    return event(sessionID, "text", { content })
  }

  export async function reasoning(sessionID: string, content: string) {
    return event(sessionID, "reasoning", { content })
  }

  export async function step(sessionID: string, data: {
    reason: string
    tokens: TokenUsage
    cost: number
  }) {
    const session = sessions.get(sessionID)
    if (enabled && session) {
      const currentStep = session.step
      const request = session.requests.get(currentStep)
      const row = request
        ? {
            ...request,
            finish: {
              reason: data.reason,
              cost: data.cost,
            },
            usage: usageRecord(data.tokens),
          }
        : {
            type: "request_usage",
            timestamp: new Date().toISOString(),
            session_id: sessionID,
            step: session.step,
            finish: {
              reason: data.reason,
              cost: data.cost,
            },
            usage: usageRecord(data.tokens),
          }
      track(session, appendJsonl(session, path.join(base(), "requests.jsonl"), row))
      // appendJsonl retains its own reference to row. Releasing the map entry
      // here prevents completed requests (including their full messages) from
      // accumulating for the lifetime of the process.
      session.requests.delete(currentStep)
    }
    return event(sessionID, "step-finish", data)
  }

  /** Lightweight lifecycle diagnostic used by tests and supervisors. */
  export function pendingRequestCount(sessionID: string) {
    return sessions.get(sessionID)?.requests.size ?? 0
  }

  export async function error(sessionID: string, err: unknown) {
    return event(sessionID, "error", {
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
    })
  }
}
