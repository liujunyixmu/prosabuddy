#!/usr/bin/env bun
import fs from "fs/promises"
import path from "path"
import { Instance } from "../src/project/instance"
import { SessionProofWorkflow } from "../src/session/proof-workflow"

const DEFAULT_BENCHMARKS = [
  "2009-RTSS-Lemma1",
  "2009-RTSS-Extend1_10",
  "2009-RTSS-Lemma2-1",
  "2009-RTSS-Lemma3",
]

async function exists(filepath: string) {
  return fs.stat(filepath).then(() => true).catch(() => false)
}

async function directCoqFile(dir: string) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".v"))
    .map((entry) => path.join(dir, entry.name))
    .sort()
  return files[0]
}

async function resolveTarget(repoRoot: string, target: string) {
  const absolute = path.isAbsolute(target) ? target : path.resolve(repoRoot, target)
  if (await exists(absolute)) {
    const stat = await fs.stat(absolute)
    if (stat.isFile()) return absolute
    if (stat.isDirectory()) return directCoqFile(absolute)
  }

  const testspace = path.join(repoRoot, "testspace")
  const candidate = path.join(testspace, target)
  if (await exists(candidate)) return directCoqFile(candidate)
  return undefined
}

async function main() {
  const repoRoot = path.resolve(import.meta.dir, "../../..")
  const inputs = process.argv.slice(2)
  const targets = inputs.length > 0 ? inputs : DEFAULT_BENCHMARKS
  const reports = []

  for (const target of targets) {
    const file = await resolveTarget(repoRoot, target)
    if (!file) {
      reports.push({ target, status: "missing" })
      continue
    }

    const report = await Instance.provide({
      directory: repoRoot,
      fn: () => SessionProofWorkflow.dryRunFile(file),
    })
    reports.push({ target, status: "ok", ...report })
  }

  console.log(JSON.stringify({ generated_at: new Date().toISOString(), reports }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
