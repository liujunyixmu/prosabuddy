#!/usr/bin/env bun
/**
 * A/B Experiment: Compare full-context (baseline) vs fixer-subagent (treatment)
 * error repair on extracted repair_episode data.
 *
 * Usage:
 *   1. First run trace-analysis.ts to produce episodes JSON:
 *      bun packages/opencode/script/trace-analysis.ts > episodes.json
 *
 *   2. Then run this experiment:
 *      bun packages/opencode/script/experiment-fixer.ts episodes.json
 *
 * For each repair_episode, we extract the four-piece context bundle and
 * compare how a single LLM call performs under:
 *   A) Full conversation context (simulated by reading the trace's request.json)
 *   B) Focused four-piece fixer context only
 *
 * Output: comparative metrics as JSON to stdout.
 */

import fs from "fs/promises"
import path from "path"

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

interface ExperimentResult {
  episode: RepairEpisode
  baseline: TrialResult
  treatment: TrialResult
}

interface TrialResult {
  prompt_tokens: number
  context_lines: number
  // These would be filled in by actual LLM calls in a live experiment
  // For now we compute the context size differential
  method: "full_context" | "fixer_four_piece"
}

async function read(filepath: string): Promise<unknown> {
  const txt = await Bun.file(filepath).text().catch(() => "")
  if (!txt) return undefined
  return JSON.parse(txt)
}

/** Reconstruct the full context size from a trace step's request.json */
async function baseline(root: string, episode: RepairEpisode): Promise<TrialResult> {
  const step = episode.step_range[0]
  const folder = path.join(root, episode.run, episode.session, `step-${String(step).padStart(3, "0")}`)
  const req = await read(path.join(folder, "request.json")) as any
  if (!req) {
    return { prompt_tokens: episode.tokens_estimate, context_lines: 0, method: "full_context" }
  }

  // Estimate token count from messages
  const msgs = req.messages ?? []
  let chars = 0
  for (const m of msgs) {
    if (typeof m.content === "string") chars += m.content.length
    if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (typeof p === "string") chars += p.length
        if (p?.text) chars += p.text.length
      }
    }
  }
  for (const s of req.system ?? []) {
    if (typeof s === "string") chars += s.length
    if (s?.text) chars += s.text.length
  }

  return {
    prompt_tokens: Math.ceil(chars / 4),
    context_lines: msgs.length,
    method: "full_context",
  }
}

/** Estimate the four-piece fixer context size */
function treatment(episode: RepairEpisode): TrialResult {
  // Four-piece context is much smaller:
  // 1. Error message: ~100 chars
  // 2. Error line: ~80 chars
  // 3. Goal state: ~500 chars (typical Coq goal)
  // 4. Environment (hyps): ~1000 chars (typical)
  // + ruled_out_paths: ~200 chars per path
  // + system prompt: ~2000 chars (fixer prompt)
  const errors = episode.errors.reduce((s, e) => s + e.length, 0)
  const tactics = episode.tactics.reduce((s, t) => s + t.length, 0)
  const fixed = 2000 + 500 + 1000
  const chars = fixed + errors + tactics

  return {
    prompt_tokens: Math.ceil(chars / 4),
    context_lines: 4 + episode.errors.length,
    method: "fixer_four_piece",
  }
}

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error("Usage: bun experiment-fixer.ts <episodes.json> [trace-dir]")
    process.exit(1)
  }

  const data = await read(file) as { summary: unknown; episodes: RepairEpisode[] } | undefined
  if (!data?.episodes) {
    console.error("Invalid episodes file")
    process.exit(1)
  }

  const root = process.argv[3] ?? path.join(process.env.XDG_DATA_HOME ?? path.join(process.env.HOME!, ".local/share"), "opencode/trace")

  const results: ExperimentResult[] = []

  for (const episode of data.episodes) {
    const a = await baseline(root, episode)
    const b = treatment(episode)
    results.push({ episode, baseline: a, treatment: b })
  }

  // Aggregate metrics
  const n = results.length
  if (n === 0) {
    console.error("No episodes to analyze")
    process.exit(0)
  }

  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length
  const sum = (arr: number[]) => arr.reduce((s, v) => s + v, 0)

  const metrics = {
    episodes: n,
    baseline_avg_tokens: Math.round(avg(results.map((r) => r.baseline.prompt_tokens))),
    treatment_avg_tokens: Math.round(avg(results.map((r) => r.treatment.prompt_tokens))),
    token_reduction_pct: (
      (1 - sum(results.map((r) => r.treatment.prompt_tokens)) / sum(results.map((r) => r.baseline.prompt_tokens))) * 100
    ).toFixed(1) + "%",
    baseline_total_tokens: sum(results.map((r) => r.baseline.prompt_tokens)),
    treatment_total_tokens: sum(results.map((r) => r.treatment.prompt_tokens)),
    baseline_resolved_pct: ((results.filter((r) => r.episode.resolved).length / n) * 100).toFixed(1) + "%",
    avg_attempts_per_episode: avg(results.map((r) => r.episode.attempts)).toFixed(1),
    by_class: Object.fromEntries(
      [...new Set(results.map((r) => r.episode.error_class))].map((cls) => {
        const sub = results.filter((r) => r.episode.error_class === cls)
        return [cls, {
          count: sub.length,
          avg_baseline_tokens: Math.round(avg(sub.map((r) => r.baseline.prompt_tokens))),
          avg_treatment_tokens: Math.round(avg(sub.map((r) => r.treatment.prompt_tokens))),
        }]
      }),
    ),
  }

  console.error("\n=== Experiment Results ===")
  console.error(JSON.stringify(metrics, null, 2))
  console.error(`\nKey insight: fixer context is ${metrics.token_reduction_pct} smaller than full context`)
  console.log(JSON.stringify({ metrics, results }, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
