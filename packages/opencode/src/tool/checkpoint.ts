import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./checkpoint.txt"
import { Instance } from "../project/instance"
import path from "path"
import { Filesystem } from "../util/filesystem"
import { createHash } from "crypto"
import * as CoqProject from "./coq-project"
import type { CheckpointResult } from "./proof-schema"
import { SessionProofWorkflow } from "@/session/proof-workflow"
import { parseCoqCompilerOutput } from "./coq-diagnostics"
import { assertNoRewriteBangInCoqFile, assertNoIntuitionInCoqFile } from "./coq-style-guard"
import { ProofEditTransaction } from "@/session/proof-edit-transaction"

const DEFAULT_TIMEOUT_MS = 120_000

function checkpointTimeoutMs() {
  const raw = process.env.OPENCODE_COQC_TIMEOUT_MS
  if (!raw) return DEFAULT_TIMEOUT_MS
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS
}

function formatMs(ms: number) {
  if (ms % 1000 === 0) return `${ms / 1000}s`
  return `${ms}ms`
}

// Track last checkpoint hash per session+file
const hashes = new Map<string, string>()

function hashError(input: {
  filepath: string
  source: string
  firstFile: string | null
  firstLine: number | null
  message: string
}): string {
  return createHash("sha256")
    .update([input.filepath, input.source, input.firstFile ?? "", input.firstLine ?? "", input.message].join("\n"))
    .digest("hex")
    .slice(0, 16)
}

const ALLOWED_REASONS = ["node_completed", "bridge_lemma", "milestone"]

export const CheckpointTool = Tool.define("checkpoint", {
  description: DESCRIPTION,
  parameters: z.object({
    file: z.string().describe("Path to the .v file to compile"),
    reason: z.enum(["node_completed", "bridge_lemma", "milestone"]).describe("Why this checkpoint is being taken"),
    flags: z.string().optional().describe("Extra coqc flags"),
  }),
  async execute(params, ctx): Promise<{ title: string; output: string; metadata: Record<string, any> }> {
    let filepath = params.file
    if (!path.isAbsolute(filepath)) filepath = path.resolve(Instance.directory, filepath)
    if (!Filesystem.contains(Instance.directory, filepath))
      throw new Error(`File must be within workspace: ${Instance.directory}`)
    if (!filepath.endsWith(".v")) throw new Error("File must be a .v (Coq source) file")
    if (!Filesystem.stat(filepath)) throw new Error(`File not found: ${filepath}`)
    const stagedTransaction = ProofEditTransaction.isTarget(ctx.sessionID, filepath)
    const compiledSource = await ProofEditTransaction.readSource(ctx.sessionID, filepath)
    assertNoRewriteBangInCoqFile(filepath, compiledSource)
    assertNoIntuitionInCoqFile(filepath, compiledSource)

    // Validate checkpoint reason
    if (!ALLOWED_REASONS.includes(params.reason))
      throw new Error(`Invalid checkpoint reason: ${params.reason}. Allowed: ${ALLOWED_REASONS.join(", ")}`)

    await ctx.ask({
      permission: "coqc",
      patterns: [filepath],
      always: ["*"],
      metadata: { checkpoint: true, reason: params.reason },
    })

    // Auto-detect _CoqProject flags using shared helper
    const resolved = await CoqProject.resolve(filepath)

    const extraFlags = params.flags ? params.flags.split(/\s+/).filter(Boolean) : []
    let code: number
    let stdout = ""
    let stderr = ""
    let timedOut = false
    let aborted = false
    let outputLimitExceeded = false
    let stagedValidation: SessionProofWorkflow.ValidationResult | undefined
    if (stagedTransaction) {
      stagedValidation = await SessionProofWorkflow.Validation.prefix(filepath, compiledSource, extraFlags, {
        signal: ctx.abort,
      })
      code = stagedValidation.ok ? 0 : 1
      stderr = stagedValidation.message ?? ""
    } else {
      const args = [...CoqProject.coqcCmd(), ...resolved.flags, ...extraFlags, filepath]
      const timeoutMs = checkpointTimeoutMs()
      const result = await CoqProject.runProcess(args, resolved.cwd, { timeoutMs, signal: ctx.abort })
      code = result.exit
      stdout = result.stdout
      stderr = result.stderr
      timedOut = result.timedOut
      aborted = result.aborted
      outputLimitExceeded = result.outputLimitExceeded
    }

    const rel = path.relative(Instance.directory, filepath)

    if (timedOut) {
      const partial = [
        stdout.trim() ? `partial stdout:\n${stdout.trim()}` : "",
        stderr.trim() ? `partial stderr:\n${stderr.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n")
      throw new Error(
        [`checkpoint timed out after ${formatMs(checkpointTimeoutMs())} while compiling ${rel}; process group was killed.`, partial]
          .filter(Boolean)
          .join("\n"),
      )
    }
    if (aborted) throw new Error(`checkpoint was aborted while compiling ${rel}; process group was killed.`)
    if (outputLimitExceeded) {
      throw new Error(
        `checkpoint exceeded the ${CoqProject.subprocessMaxOutputBytes()} byte output limit while compiling ${rel}; process group was killed.`,
      )
    }

    if (code === 0) {
      const lemmaPrefixValidation = await SessionProofWorkflow.recordLemmaPrefixValidation({
        sessionID: ctx.sessionID,
        agent: ctx.agent,
        file: filepath,
        source: compiledSource,
      })
      const proofRegionLifecycle = await SessionProofWorkflow.recordCompilerResult({
        sessionID: ctx.sessionID,
        file: filepath,
        source: compiledSource,
        validator: "checkpoint",
        ok: true,
        validated_source_current: stagedTransaction,
      })
      const proofStatus = SessionProofWorkflow.classifyCoqcSuccess(
        ctx.sessionID,
        filepath,
        compiledSource,
        proofRegionLifecycle,
      )
      const decompositionCheckpoint = SessionProofWorkflow.decompositionModeEnabled()
        ? SessionProofWorkflow.classifyDecompositionCheckpoint(ctx.sessionID, filepath, compiledSource)
        : undefined
      let proofTransaction = proofStatus.proof_progress.workspace_committable
        ? ProofEditTransaction.markAccepted({
            sessionID: ctx.sessionID,
            file: filepath,
            source: compiledSource,
            level: proofStatus.proof_progress.level === "structural" ? "structural" : "hard",
            receipt: proofStatus.proof_progress.receipt,
          })
        : proofStatus.proof_progress.accepted &&
            (proofStatus.proof_progress.level === "hard" || proofStatus.proof_progress.level === "structural")
          ? ProofEditTransaction.markCertifiedRecovery({
              sessionID: ctx.sessionID,
              file: filepath,
              source: compiledSource,
              level: proofStatus.proof_progress.level,
              receipt: proofStatus.proof_progress.receipt,
            })
        : proofStatus.proof_progress.level === "debug"
          ? ProofEditTransaction.markDebug({
              sessionID: ctx.sessionID,
              file: filepath,
              source: compiledSource,
              receipt: proofStatus.proof_progress.receipt,
            })
          : ProofEditTransaction.active(ctx.sessionID)
      if (proofStatus.final_theorem_gate.ok && proofStatus.proof_progress.workspace_committable) {
        proofTransaction =
          (await ProofEditTransaction.finalizeHandedOffAccepted(ctx.sessionID)) ?? proofTransaction
      }

      // Summarize warnings
      const warns = stderr.split("\n").filter((l: string) => l.includes("Warning")).map((l: string) => l.trim())
      const grouped: Record<string, number> = {}
      for (const w of warns) {
        const cat = w.match(/Warning:\s*(\S+)/)?.[1] ?? "other"
        grouped[cat] = (grouped[cat] ?? 0) + 1
      }
      const summary = Object.entries(grouped).map(([k, v]) => `${k}: ${v}`).join(", ")

      const result: CheckpointResult = {
        status: "ok",
        first_error_file: null,
        first_error_line: null,
        first_error_message: null,
        warning_summary: summary ? [summary] : [],
        same_as_previous: false,
      }

      // Clear checkpoint hash on success
      const hkey = `${ctx.sessionID}:${filepath}`
      hashes.delete(hkey)

      const toolStatus = decompositionCheckpoint
        ? decompositionCheckpoint.terminal_ready
          ? "decomposition_ready"
          : "decomposition_incomplete"
        : "ok"

      return {
        title: `checkpoint ${rel}: ${toolStatus}`,
        output: [
          `status: ${toolStatus}`,
          decompositionCheckpoint ? "compile_status: success" : undefined,
          decompositionCheckpoint ? `decomposition_status: ${decompositionCheckpoint.status}` : undefined,
          decompositionCheckpoint ? `terminal_ready: ${decompositionCheckpoint.terminal_ready}` : undefined,
          `proof_progress: ${proofStatus.proof_progress.status}`,
          `progress_level: ${proofStatus.proof_progress.level ?? "none"}`,
          `accepted_progress: ${proofStatus.proof_progress.accepted}`,
          `unfinished_count: ${proofStatus.proof_progress.current.unfinished_count}`,
          proofStatus.proof_progress.previous
            ? `previous_unfinished_count: ${proofStatus.proof_progress.previous.unfinished_count}`
            : undefined,
          `proof_progress_reason: ${proofStatus.proof_progress.reason}`,
          stagedTransaction
            ? `proof_transaction: ${proofStatus.proof_progress.workspace_committable ? `${proofStatus.proof_progress.level} snapshot updated` : "debug draft journaled for further repair"}`
            : undefined,
          lemmaPrefixValidation?.ok
            ? `lemma_prefix_validation: ok - ${lemmaPrefixValidation.prefix_complete ? "current blocker complete" : lemmaPrefixValidation.message ?? "current prefix compiles but current blocker is still pending"}`
            : lemmaPrefixValidation
              ? `lemma_prefix_validation: fail - ${lemmaPrefixValidation.message ?? "prefix checkpoint failed"}`
              : undefined,
          `proof_region_lifecycle: ${JSON.stringify(proofRegionLifecycle)}`,
          decompositionCheckpoint
            ? `decomposition_checkpoint: ${JSON.stringify(decompositionCheckpoint)}`
            : undefined,
          proofStatus.status_detail === "compile_success_nonfinal" && !proofStatus.proof_progress.accepted
            ? "next_action: this checkpoint is not accepted proof progress; obtain a new proof_region compiler certificate or complete the final Qed proof"
            : undefined,
          summary ? `warnings: ${summary}` : "no warnings",
        ].filter((line): line is string => Boolean(line)).join("\n"),
        metadata: {
          status: toolStatus as string,
          ...(decompositionCheckpoint
            ? {
                compile_status: "success",
                decomposition_status: decompositionCheckpoint.status,
                terminal_ready: decompositionCheckpoint.terminal_ready,
                decomposition_checkpoint: decompositionCheckpoint,
              }
            : {}),
          same: false,
          reason: params.reason,
          proof_status: proofStatus,
          proof_region_lifecycle: proofRegionLifecycle,
          ...(proofTransaction ? { proof_edit_transaction: proofTransaction } : {}),
          ...(lemmaPrefixValidation ? { lemma_prefix_validation: lemmaPrefixValidation } : {}),
        },
      }
    }

    const diagnostics = parseCoqCompilerOutput(stdout, stderr)
    const lines = stderr.split("\n")
    const firstFile = stagedValidation ? filepath : (diagnostics.firstError?.file ?? null)
    const firstLine = stagedValidation?.first_error_line ?? diagnostics.firstError?.line ?? null
    const firstMsg = stagedValidation?.message ?? diagnostics.firstError?.message ?? null

    // Warning summary
    const warns = lines.filter((l: string) => l.includes("Warning")).map((l: string) => l.trim())
    const grouped: Record<string, number> = {}
    for (const w of warns) {
      const cat = w.match(/Warning:\s*(\S+)/)?.[1] ?? "other"
      grouped[cat] = (grouped[cat] ?? 0) + 1
    }
    const warnSummary = Object.entries(grouped).map(([k, v]) => `${k}: ${v}`)

    // Compute error hash and check if same as previous
    const errHash = hashError({
      filepath,
      source: compiledSource,
      firstFile,
      firstLine,
      message: firstMsg ?? diagnostics.output,
    })
    const hkey = `${ctx.sessionID}:${filepath}`
    const prev = hashes.get(hkey)
    const same = prev === errHash

    // Store hash for next comparison
    hashes.set(hkey, errHash)

    const result: CheckpointResult = {
      status: "error",
      first_error_file: firstFile,
      first_error_line: firstLine,
      first_error_message: firstMsg,
      warning_summary: warnSummary,
      same_as_previous: same,
    }

    const proofRegionLifecycle = await SessionProofWorkflow.recordCompilerResult({
      sessionID: ctx.sessionID,
      file: filepath,
      source: compiledSource,
      validator: "checkpoint",
      ok: false,
      first_error_file: firstFile ?? undefined,
      first_error_line: firstLine ?? undefined,
      first_error_message: firstMsg ?? undefined,
      validated_source_current: stagedTransaction,
    })
    const proofStatus = SessionProofWorkflow.classifyCoqcFailure(ctx.sessionID, filepath, compiledSource, {
      first_error_line: firstLine ?? undefined,
      first_error_message: firstMsg ?? undefined,
      lifecycle: proofRegionLifecycle,
    })
    const proofTransaction = proofStatus.proof_progress.accepted &&
        (proofStatus.proof_progress.level === "hard" || proofStatus.proof_progress.level === "structural")
      ? ProofEditTransaction.markCertifiedRecovery({
          sessionID: ctx.sessionID,
          file: filepath,
          source: compiledSource,
          level: proofStatus.proof_progress.level,
          receipt: proofStatus.proof_progress.receipt,
        })
      : proofStatus.proof_progress.level === "debug"
        ? ProofEditTransaction.markDebug({
            sessionID: ctx.sessionID,
            file: filepath,
            source: compiledSource,
            receipt: proofStatus.proof_progress.receipt,
          })
        : ProofEditTransaction.active(ctx.sessionID)
    const lemmaPrefixValidation = await SessionProofWorkflow.recordLemmaPrefixValidation({
      sessionID: ctx.sessionID,
      agent: ctx.agent,
      file: filepath,
      source: compiledSource,
    })

    const output = [
      `status: error${same ? " (SAME AS PREVIOUS — update node state before recompiling)" : ""}`,
      lemmaPrefixValidation?.ok
        ? `lemma_prefix_validation: ok - ${lemmaPrefixValidation.prefix_complete ? "current blocker complete" : lemmaPrefixValidation.message ?? "current prefix compiles but current blocker is still pending"}`
        : lemmaPrefixValidation
          ? `lemma_prefix_validation: fail - ${lemmaPrefixValidation.message ?? "prefix checkpoint failed"}`
          : "",
      lemmaPrefixValidation?.ok && lemmaPrefixValidation.prefix_complete
        ? "next_action: advance to the next local proof hole toward completing the target theorem; keep later partition braces intact"
        : lemmaPrefixValidation
          ? "next_action: repair the current first proof block with an edit toward a compiling theorem proof; do not switch to broad read-only search or unrelated edits"
          : "",
      `proof_region_lifecycle: ${JSON.stringify(proofRegionLifecycle)}`,
      `proof_progress: ${proofStatus.proof_progress.status}`,
      `progress_level: ${proofStatus.proof_progress.level ?? "none"}`,
      `accepted_progress: ${proofStatus.proof_progress.accepted}`,
      `proof_progress_reason: ${proofStatus.proof_progress.reason}`,
      stagedTransaction
        ? `proof_transaction: ${proofStatus.proof_progress.workspace_committable ? `${proofStatus.proof_progress.level} snapshot updated` : "debug draft journaled for further repair"}`
        : "",
      firstFile ? `file: ${firstFile}` : "",
      firstLine ? `line: ${firstLine}` : "",
      firstMsg ? `error: ${firstMsg}` : `error: ${diagnostics.output.slice(0, 500)}`,
      warnSummary.length > 0 ? `warnings: ${warnSummary.join(", ")}` : "",
    ].filter(Boolean).join("\n")

    return {
      title: `checkpoint ${rel}: ${lemmaPrefixValidation?.ok && lemmaPrefixValidation.prefix_complete ? "lemma-prefix-ok" : "error"}${same ? " (same)" : ""}`,
      output,
      metadata: {
        status: "error",
        same,
        reason: params.reason,
        proof_status: proofStatus,
        proof_region_lifecycle: proofRegionLifecycle,
        ...(proofTransaction ? { proof_edit_transaction: proofTransaction } : {}),
        ...(lemmaPrefixValidation ? { lemma_prefix_validation: lemmaPrefixValidation } : {}),
      },
    }
  },
})
