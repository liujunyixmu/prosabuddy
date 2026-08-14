import path from "path"
import fs from "fs/promises"
import os from "os"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import type { CoqProjectContext } from "./proof-schema"
import { which } from "../util/which"

const LEGACY_PROSA_ROOT = "/home/junyi/Prosa"
const DEFAULT_COQ_TIMEOUT_MS = 120_000
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const KILL_GRACE_MS = 5_000

export type ProcessOptions = {
  timeoutMs?: number
  signal?: AbortSignal
  maxOutputBytes?: number
}

export type ProcessResult = {
  exit: number
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
  outputLimitExceeded: boolean
}

function positiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function subprocessMaxOutputBytes() {
  return positiveInteger(process.env.OPENCODE_SUBPROCESS_MAX_OUTPUT_BYTES, DEFAULT_MAX_OUTPUT_BYTES)
}

function coqTimeoutMs() {
  return positiveInteger(
    process.env.OPENCODE_COQTOP_TIMEOUT_MS ?? process.env.OPENCODE_COQC_TIMEOUT_MS,
    DEFAULT_COQ_TIMEOUT_MS,
  )
}

function killProcessGroup(proc: Bun.Subprocess<"ignore", "pipe", "pipe">, signal: NodeJS.Signals) {
  try {
    if (process.platform !== "win32") {
      process.kill(-proc.pid, signal)
      return
    }
  } catch {}

  try {
    proc.kill(signal)
  } catch {}
}

async function readBounded(
  stream: ReadableStream<Uint8Array>,
  state: { captured: number; exceeded: boolean },
  maxOutputBytes: number,
  onLimit: () => void,
) {
  const reader = stream.getReader()
  const chunks: Buffer[] = []
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      const remaining = Math.max(0, maxOutputBytes - state.captured)
      if (remaining > 0) {
        const kept = chunk.subarray(0, remaining)
        chunks.push(kept)
        state.captured += kept.byteLength
      }
      if (chunk.byteLength > remaining && !state.exceeded) {
        state.exceeded = true
        onLimit()
      }
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString("utf8")
}

/** Run a bounded subprocess in its own process group. */
export async function runProcess(args: string[], cwd: string, options: ProcessOptions = {}): Promise<ProcessResult> {
  const runArgs = process.platform === "win32" ? args : ["setsid", ...args]
  const proc = Bun.spawn(runArgs, { stdout: "pipe", stderr: "pipe", cwd })
  const timeoutMs = options.timeoutMs ?? coqTimeoutMs()
  const maxOutputBytes = options.maxOutputBytes ?? subprocessMaxOutputBytes()
  const capture = { captured: 0, exceeded: false }
  let timedOut = false
  let aborted = false
  let terminating = false
  let killTimer: Timer | undefined

  const terminate = () => {
    if (terminating) return
    terminating = true
    killProcessGroup(proc, "SIGTERM")
    killTimer = setTimeout(() => killProcessGroup(proc, "SIGKILL"), KILL_GRACE_MS)
    killTimer.unref?.()
  }
  const abortHandler = () => {
    aborted = true
    terminate()
  }
  if (options.signal?.aborted) abortHandler()
  else options.signal?.addEventListener("abort", abortHandler, { once: true })

  const timeoutTimer = setTimeout(() => {
    timedOut = true
    terminate()
  }, timeoutMs)
  timeoutTimer.unref?.()

  try {
    const [exit, stdout, stderr] = await Promise.all([
      proc.exited,
      readBounded(proc.stdout, capture, maxOutputBytes, terminate),
      readBounded(proc.stderr, capture, maxOutputBytes, terminate),
    ])
    return {
      exit,
      stdout,
      stderr,
      timedOut,
      aborted,
      outputLimitExceeded: capture.exceeded,
    }
  } finally {
    clearTimeout(timeoutTimer)
    if (killTimer) clearTimeout(killTimer)
    options.signal?.removeEventListener("abort", abortHandler)
  }
}

function candidateProsaRoots() {
  return [
    process.env.OPENCODE_PROSA_ROOT,
    path.resolve(import.meta.dirname, "../../../../prosaworkspace"),
    path.resolve(process.cwd(), "prosaworkspace"),
  ].filter((candidate): candidate is string => Boolean(candidate))
}

export function prosaWorkspaceRoot() {
  return candidateProsaRoots().find((candidate) => Filesystem.stat(candidate)?.isDirectory())
}

export function normalizeLoadpathFlags(flags: string[]) {
  const prosaRoot = prosaWorkspaceRoot()
  if (!prosaRoot) return flags

  return flags.map((flag) => (path.normalize(flag) === LEGACY_PROSA_ROOT ? prosaRoot : flag))
}

/** Detect if we're using Rocq 9.0+ (has `rocq` binary) */
export function isRocq(): boolean {
  return !!which("rocq")
}

/** Get the appropriate coqtop/rocq command */
export function coqtopCmd(): string[] {
  if (isRocq()) return ["rocq", "top"]
  return ["coqtop"]
}

/** Get the appropriate coqc/rocq command */
export function coqcCmd(): string[] {
  if (isRocq()) return ["rocq", "c"]
  return ["coqc"]
}

/** Walk up from dir to find _RocqProject or _CoqProject file */
export function find(dir: string): string | undefined {
  let current = dir
  while (current !== path.dirname(current)) {
    // Try _RocqProject first (Rocq 9.0+)
    const rocqCandidate = path.join(current, "_RocqProject")
    if (Filesystem.stat(rocqCandidate)) return rocqCandidate
    // Fall back to _CoqProject
    const coqCandidate = path.join(current, "_CoqProject")
    if (Filesystem.stat(coqCandidate)) return coqCandidate
    current = path.dirname(current)
  }
  return undefined
}

/** Parse _CoqProject content into coqc/coqtop flags */
export function parse(content: string): string[] {
  const flags: string[] = []
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    if (trimmed.endsWith(".v")) continue
    const tokens = trimmed.match(/"[^"]*"|\S+/g)
    if (!tokens) continue
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i].replace(/^"|"$/g, "")
      if (token === "-arg" && tokens[i + 1]) {
        const value = tokens[++i].replace(/^"|"$/g, "")
        const expanded = value.match(/"[^"]*"|\S+/g)
        if (expanded) flags.push(...expanded.map((t) => t.replace(/^"|"$/g, "")))
        continue
      }
      flags.push(token)
    }
  }
  return flags
}

function inputDirectory(input: string) {
  const abs = path.isAbsolute(input) ? input : path.resolve(Instance.directory, input)
  return Filesystem.stat(abs)?.isDirectory() ? abs : path.dirname(abs)
}

/** Resolve project context for a given file or directory path. */
export async function resolve(input: string): Promise<{ flags: string[]; cwd: string; project: string | null }> {
  const dir = inputDirectory(input)
  const proj = find(dir)
  if (!proj) return { flags: [], cwd: Instance.directory, project: null }
  const content = await fs.readFile(proj, "utf-8")
  return { flags: normalizeLoadpathFlags(parse(content)), cwd: path.dirname(proj), project: proj }
}

export async function withTemporaryScript<T>(
  prefix: string,
  code: string,
  use: (script: string) => Promise<T>,
  root = os.tmpdir(),
): Promise<T> {
  const directory = await fs.mkdtemp(path.join(root, prefix))
  const script = path.join(directory, "input.v")
  try {
    await fs.writeFile(script, code, "utf8")
    return await use(script)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

/** Build a full CoqProjectContext for session binding */
export async function context(file: string, theorem: string, preamble: string): Promise<CoqProjectContext> {
  const abs = path.isAbsolute(file) ? file : path.resolve(Instance.directory, file)
  const resolved = await resolve(abs)
  return {
    root: Instance.directory,
    file: abs,
    theorem,
    project_path: resolved.project,
    flags: resolved.flags,
    cwd: resolved.cwd,
    preamble,
  }
}

/** Run coqtop/rocq in batch mode with resolved project context */
export async function run(
  code: string,
  file?: string,
  extra?: string[],
  options: ProcessOptions = {},
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const abs = file ? (path.isAbsolute(file) ? file : path.resolve(Instance.directory, file)) : undefined
  const resolved = await resolve(abs ?? Instance.directory)

  const cmd = coqtopCmd()
  const args = [...cmd, "-batch", ...resolved.flags, ...(extra ?? [])]
  return withTemporaryScript("opencode-coqsession-", code, async (script) => {
    const result = await runProcess([...args, "-l", script], resolved.cwd, options)
    if (result.timedOut) throw new Error(`Coq process timed out after ${options.timeoutMs ?? coqTimeoutMs()}ms`)
    if (result.aborted) throw new Error("Coq process was aborted and its process group was killed")
    if (result.outputLimitExceeded) {
      throw new Error(`Coq process exceeded the ${options.maxOutputBytes ?? subprocessMaxOutputBytes()} byte output limit`)
    }
    return { exit: result.exit, stdout: result.stdout.trim(), stderr: result.stderr.trim() }
  })
}

/** Clean Coq/Rocq output by removing welcome messages and prompts */
export function cleanOutput(output: string): string {
  return output
    .split("\n")
    .filter((l) => !l.match(/^Welcome to (?:Coq|Rocq|the Rocq Prover)/i) && !l.match(/^(?:Coq|Rocq) </) && l.trim())
    .join("\n")
    .trim()
}
