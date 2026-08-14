#!/usr/bin/env bun
/**
 * Trace Analysis: extract repair_episode data from main traces.
 *
 * Scans trace/run-* directories for sessions containing error-repair loops
 * (consecutive failures on coq_session step or coqc tool calls).
 *
 * Usage: bun packages/opencode/script/trace-analysis.ts [trace-dir]
 *
 * Output: JSON array of RepairEpisode objects + summary stats to stdout.
 */

import fs from "fs/promises"
import path from "path"

interface ToolEvent {
  timestamp: string
  type: string
  data: {
    tool?: string
    callID?: string
    input?: Record<string, unknown>
    output?: unknown
    error?: string
    elapsed?: number
  }
}

interface RepairEpisode {
  run: string
  session: string
  step_range: [number, number]
  node_id: string | null
  initial_error: string
  error_class: string
  attempts: number
  resolved: boolean
  tactics: string[]
  errors: string[]
  tokens_estimate: number
}

async function read(filepath: string): Promise<unknown> {
  const txt = await Bun.file(filepath).text().catch(() => "")
  if (!txt) return undefined
  return JSON.parse(txt)
}

async function dirs(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name))
}

/** Load all trace events for a session step, sorted by sequence */
async function events(folder: string): Promise<ToolEvent[]> {
  const files = await fs.readdir(folder).catch(() => [] as string[])
  const jsons = files.filter((f) => f.endsWith(".json") && f !== "request.json").sort()
  const result: ToolEvent[] = []
  for (const f of jsons) {
    const evt = await read(path.join(folder, f)) as ToolEvent | undefined
    if (evt?.type) result.push(evt)
  }
  return result
}

/** Detect repair episodes in a session's trace */
async function analyze(dir: string): Promise<RepairEpisode[]> {
  const steps = await dirs(dir)
  steps.sort()

  // Collect all tool-result events across steps
  const results: Array<{
    step: number
    tool: string
    input: Record<string, unknown>
    output: string
    error: string | undefined
    kind: string | undefined
  }> = []

  for (const folder of steps) {
    const m = path.basename(folder).match(/^step-(\d+)$/)
    if (!m) continue
    const num = parseInt(m[1])
    const evts = await events(folder)
    for (const evt of evts) {
      if (!evt.type.startsWith("tool-result_")) continue
      const tool = evt.data.tool ?? ""
      if (tool !== "coq_session" && tool !== "coqc" && tool !== "checkpoint") continue
      const out = typeof evt.data.output === "string" ? evt.data.output : JSON.stringify(evt.data.output ?? "")
      const kind = out.match(/\[(environment_problem|syntax_or_engine_problem|proof_progress)\]/)?.[1]
      results.push({
        step: num,
        tool,
        input: (evt.data.input ?? {}) as Record<string, unknown>,
        output: out.slice(0, 500),
        error: evt.data.error,
        kind,
      })
    }
  }

  // Find consecutive failure runs
  const episodes: RepairEpisode[] = []
  let streak: typeof results = []

  for (const r of results) {
    const failed = r.kind === "environment_problem" || r.kind === "syntax_or_engine_problem" || !!r.error
    if (failed) {
      streak.push(r)
    } else {
      if (streak.length >= 2) {
        const node = (streak[0].input.node_id as string) ?? null
        const tactic = streak.map((s) => (s.input.tactic as string) ?? (s.input.op as string) ?? "").filter(Boolean)
        const errs = streak.map((s) => s.error ?? s.output.slice(0, 200))
        episodes.push({
          run: path.basename(path.dirname(dir)),
          session: path.basename(dir),
          step_range: [streak[0].step, streak[streak.length - 1].step],
          node_id: node,
          initial_error: errs[0],
          error_class: streak[0].kind ?? "unknown",
          attempts: streak.length,
          resolved: r.kind === "proof_progress",
          tactics: tactic,
          errors: errs,
          tokens_estimate: streak.length * 4000,
        })
      }
      streak = []
    }
  }
  // Trailing unresolved streak
  if (streak.length >= 2) {
    const node = (streak[0].input.node_id as string) ?? null
    episodes.push({
      run: path.basename(path.dirname(dir)),
      session: path.basename(dir),
      step_range: [streak[0].step, streak[streak.length - 1].step],
      node_id: node,
      initial_error: streak[0].error ?? streak[0].output.slice(0, 200),
      error_class: streak[0].kind ?? "unknown",
      attempts: streak.length,
      resolved: false,
      tactics: streak.map((s) => (s.input.tactic as string) ?? "").filter(Boolean),
      errors: streak.map((s) => s.error ?? s.output.slice(0, 200)),
      tokens_estimate: streak.length * 4000,
    })
  }

  return episodes
}

async function main() {
  const root = process.argv[2] ?? path.join(process.env.XDG_DATA_HOME ?? path.join(process.env.HOME!, ".local/share"), "opencode/trace")

  console.error(`Scanning traces in: ${root}`)

  const runs = await dirs(root)
  const all: RepairEpisode[] = []

  for (const run of runs.sort()) {
    const sessions = await dirs(run)
    for (const sess of sessions) {
      if (path.basename(sess) === "run.json" || path.basename(sess) === "summary.json") continue
      const episodes = await analyze(sess)
      all.push(...episodes)
    }
  }

  // Summary stats
  const total = all.length
  const resolved = all.filter((e) => e.resolved).length
  const avg = total > 0 ? all.reduce((s, e) => s + e.attempts, 0) / total : 0
  const tokens = all.reduce((s, e) => s + e.tokens_estimate, 0)
  const classes: Record<string, number> = {}
  for (const e of all) classes[e.error_class] = (classes[e.error_class] ?? 0) + 1

  const summary = {
    total_episodes: total,
    resolved,
    unresolved: total - resolved,
    fix_rate: total > 0 ? (resolved / total * 100).toFixed(1) + "%" : "N/A",
    avg_attempts: avg.toFixed(1),
    total_tokens_estimate: tokens,
    by_class: classes,
  }

  console.error("\n=== Summary ===")
  console.error(JSON.stringify(summary, null, 2))
  console.log(JSON.stringify({ summary, episodes: all }, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
