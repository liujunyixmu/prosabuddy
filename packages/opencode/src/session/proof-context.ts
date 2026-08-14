import { LSP } from "../lsp"
import { Bus } from "../bus"
import { LSPClient } from "../lsp/client"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import path from "path"

/**
 * Proof binding: which file + position a session is currently tracking.
 */
export interface ProofBinding {
  file: string
  position: { line: number; character: number }
  updated: number
  stale: boolean
}

/**
 * Live proof context snapshot aggregated from rocq-lsp.
 * Produced by ProofContext.snapshot() and injected into prompts / pre-tool hooks.
 */
export interface ProofSnapshot {
  file: string
  position: { line: number; character: number }
  goal?: string
  hyps: string[]
  errors: { line: number; col: number; message: string }[]
  timestamp: number
  fresh: boolean
}

export namespace ProofContext {
  const log = Log.create({ service: "proof-context" })

  // Per-session proof binding (set by IDE/ACP/TUI via setBinding)
  const bindings = new Map<string, ProofBinding>()
  // Per-session cached snapshot
  const cache = new Map<string, ProofSnapshot>()
  // Stale flags per session — set by event listeners, cleared on refresh
  const staleSet = new Set<string>()

  /**
   * Set or update the proof binding for a session.
   */
  export function setBinding(sessionID: string, file: string, position: { line: number; character: number }) {
    bindings.set(sessionID, { file, position, updated: Date.now(), stale: false })
    staleSet.add(sessionID) // force refresh on next ensure()
  }

  /**
   * Get the current proof binding for a session.
   */
  export function getBinding(sessionID: string): ProofBinding | undefined {
    return bindings.get(sessionID)
  }

  /**
   * Mark a session's cached snapshot as stale.
   * Called from event-driven listeners when the bound file changes.
   */
  export function markStale(sessionID: string) {
    staleSet.add(sessionID)
    const b = bindings.get(sessionID)
    if (b) b.stale = true
  }

  /**
   * Get the cached snapshot without refreshing.
   * Returns undefined if no snapshot has been taken yet.
   */
  export function cached(sessionID: string): ProofSnapshot | undefined {
    const snap = cache.get(sessionID)
    if (!snap) return undefined
    return { ...snap, fresh: !staleSet.has(sessionID) }
  }

  /**
   * Produce a fresh proof snapshot for the given file and position.
   * Touches the file, waits for diagnostics, fetches proof/goals, and
   * collects errors. The result is cached per sessionID.
   */
  export async function snapshot(
    sessionID: string,
    file: string,
    position: { line: number; character: number },
  ): Promise<ProofSnapshot> {
    log.info("snapshot", { sessionID, file, position })

    // 1. Touch file and wait for diagnostics
    await LSP.touchFile(file, true)

    // 2. Wait briefly for rocq-lsp to settle (server status → Idle)
    await waitIdle(file, 2000)

    // 3. Fetch proof/goals at position
    const goals = await LSP.rocqGoals({
      file,
      line: position.line,
      character: position.character,
      mode: "After",
      pp_format: "Str",
      compact: true,
    }).catch((err) => {
      log.error("failed to fetch proof goals", { err })
      return undefined
    })

    const first = goals?.goals?.goals[0]
    const hyps = first?.hyps.map((h) => `${h.names.join(", ")}: ${h.ty}`) ?? []
    const goal = first?.ty

    // 4. Collect errors (severity 1 = error) for this file
    const diags = await LSP.diagnostics()
    const raw = diags[file] ?? []
    const errors = raw
      .filter((d) => (d.severity ?? 1) === 1)
      .map((d) => ({
        line: d.range.start.line + 1,
        col: d.range.start.character + 1,
        message: d.message,
      }))

    // Also include error from goal answer messages
    if (goals?.error) {
      errors.push({ line: position.line + 1, col: position.character + 1, message: goals.error })
    }
    for (const msg of goals?.messages ?? []) {
      const text = typeof msg === "string" ? msg : msg.text
      if (text) errors.push({ line: position.line + 1, col: position.character + 1, message: text })
    }

    const snap: ProofSnapshot = {
      file,
      position,
      goal,
      hyps,
      errors,
      timestamp: Date.now(),
      fresh: true,
    }

    cache.set(sessionID, snap)
    staleSet.delete(sessionID)
    return snap
  }

  /**
   * Conditionally refresh: only if the cache is stale or missing.
   */
  export async function ensure(
    sessionID: string,
    file: string,
    position: { line: number; character: number },
  ): Promise<ProofSnapshot> {
    if (!staleSet.has(sessionID)) {
      const hit = cache.get(sessionID)
      if (hit && hit.file === file && hit.position.line === position.line && hit.position.character === position.character)
        return { ...hit, fresh: true }
    }
    return snapshot(sessionID, file, position)
  }

  /**
   * Convenience: refresh using the stored binding for this session.
   * Returns undefined if no binding is set.
   */
  export async function ensureFromBinding(sessionID: string): Promise<ProofSnapshot | undefined> {
    const b = bindings.get(sessionID)
    if (!b) return undefined
    return ensure(sessionID, b.file, b.position)
  }

  /**
   * Render a snapshot as text for prompt injection.
   */
  export function render(snap: ProofSnapshot): string {
    const rel = path.relative(Instance.worktree, snap.file)
    const lines: string[] = [
      `File: ${rel}  Position: ${snap.position.line + 1}:${snap.position.character + 1}`,
    ]

    if (snap.hyps.length > 0) {
      lines.push("", "Hypotheses:")
      for (const h of snap.hyps) lines.push(`  ${h}`)
      lines.push("========================")
    }

    lines.push("", "Goal:")
    lines.push(snap.goal ?? "(no goal)")

    if (snap.errors.length > 0) {
      lines.push("", "Errors:")
      for (const e of snap.errors) {
        lines.push(`  [${e.line}:${e.col}] ${e.message}`)
      }
    }

    if (!snap.fresh) lines.push("", "(note: this snapshot may be stale — file was modified since last refresh)")

    return lines.join("\n")
  }

  /**
   * Clear cached data for a session.
   */
  export function clear(sessionID: string) {
    cache.delete(sessionID)
    staleSet.delete(sessionID)
    bindings.delete(sessionID)
  }

  /**
   * Subscribe to LSP events and mark bound sessions as stale when
   * their tracked file receives new diagnostics or execution info.
   * Call once at startup.
   */
  export function subscribe() {
    Bus.subscribe(LSPClient.Event.Diagnostics, (event) => {
      for (const [sid, b] of bindings) {
        if (b.file === event.properties.path) {
          markStale(sid)
        }
      }
    })
    Bus.subscribe(LSP.Event.RocqExecutionInformation, (event) => {
      for (const [sid, b] of bindings) {
        // Match by relative path within root — execution info uses relative paths
        if (b.file.endsWith(event.properties.uri) || event.properties.uri.endsWith(path.basename(b.file))) {
          markStale(sid)
        }
      }
    })
    Bus.subscribe(LSP.Event.RocqFileProgress, (event) => {
      for (const [sid, b] of bindings) {
        if (b.file.endsWith(event.properties.uri) || event.properties.uri.endsWith(path.basename(b.file))) {
          markStale(sid)
        }
      }
    })
    log.info("subscribed to LSP events for stale marking")
  }

  // ── internal helpers ──

  async function waitIdle(file: string, timeout: number): Promise<void> {
    // Check current status first
    const statuses = await LSP.status()
    const rocq = statuses.find((s) => s.id === "rocq-lsp")
    if (rocq?.rocq?.state === "Idle") return

    // Wait for Idle event with timeout
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const unsub = Bus.subscribe(LSP.Event.RocqServerStatus, (event) => {
        if (event.properties.status === "Idle") {
          if (timer) clearTimeout(timer)
          unsub()
          resolve()
        }
      })
      timer = setTimeout(() => {
        unsub()
        resolve()
      }, timeout)
    })
  }
}
