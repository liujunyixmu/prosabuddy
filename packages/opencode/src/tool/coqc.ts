import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./coqc.txt"
import { Instance } from "../project/instance"
import path from "path"
import { Filesystem } from "../util/filesystem"
import * as CoqProject from "./coq-project"
import { assertNoRewriteBangInCoqFile, assertNoIntuitionInCoqFile } from "./coq-style-guard"
import { formatCoqSkillHints } from "./coq-skill-hints"
import { SessionProofWorkflow } from "@/session/proof-workflow"
import { parseCoqCompilerOutput } from "./coq-diagnostics"
import { ProofEditTransaction } from "@/session/proof-edit-transaction"

const DEFAULT_TIMEOUT_MS = 120_000

function coqcTimeoutMs() {
  const raw = process.env.OPENCODE_COQC_TIMEOUT_MS
  if (!raw) return DEFAULT_TIMEOUT_MS
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS
}

function formatMs(ms: number) {
  if (ms % 1000 === 0) return `${ms / 1000}s`
  return `${ms}ms`
}

export const CoqcTool = Tool.define("coqc", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("Absolute path to the .v file to compile"),
    flags: z.string().optional().describe("Extra coqc flags (e.g. '-Q dir Module'). Project flags from _CoqProject are auto-detected."),
  }),
  async execute(params, ctx) {
    let filepath = params.filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(Instance.directory, filepath)
    }

    if (!Filesystem.contains(Instance.directory, filepath)) {
      throw new Error(`File must be within workspace: ${Instance.directory}`)
    }

    if (!filepath.endsWith(".v")) {
      throw new Error("File must be a .v (Coq source) file")
    }

    const stat = Filesystem.stat(filepath)
    if (!stat) throw new Error(`File not found: ${filepath}`)

    const stagedTransaction = ProofEditTransaction.isTarget(ctx.sessionID, filepath)
    const coqcSource = await ProofEditTransaction.readSource(ctx.sessionID, filepath)
    assertNoRewriteBangInCoqFile(filepath, coqcSource)
    assertNoIntuitionInCoqFile(filepath, coqcSource)

    await ctx.ask({
      permission: "coqc",
      patterns: [filepath],
      always: ["*"],
      metadata: { filepath },
    })

    // Resolve and normalize _CoqProject/_RocqProject flags through the same
    // helper used by scaffold and checkpoint validation.
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
      stagedValidation = await SessionProofWorkflow.Validation.prefix(filepath, coqcSource, extraFlags, {
        signal: ctx.abort,
      })
      code = stagedValidation.ok ? 0 : 1
      stderr = stagedValidation.message ?? ""
    } else {
      // Use rocq c for Rocq 9.0+, coqc for older versions
      const args = [...CoqProject.coqcCmd(), ...resolved.flags, ...extraFlags, filepath]
      const timeoutMs = coqcTimeoutMs()
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
        [`coqc timed out after ${formatMs(coqcTimeoutMs())} while compiling ${rel}; process group was killed.`, partial]
          .filter(Boolean)
          .join("\n") + formatCoqSkillHints(partial || "coqc timed out"),
      )
    }
    if (aborted) throw new Error(`coqc was aborted while compiling ${rel}; process group was killed.`)
    if (outputLimitExceeded) {
      throw new Error(
        `coqc exceeded the ${CoqProject.subprocessMaxOutputBytes()} byte output limit while compiling ${rel}; process group was killed.`,
      )
    }

    if (code === 0) {
      const lemmaPrefixValidation = await SessionProofWorkflow.recordLemmaPrefixValidation({
        sessionID: ctx.sessionID,
        agent: ctx.agent,
        file: filepath,
        source: coqcSource,
      })
      const proofRegionLifecycle = await SessionProofWorkflow.recordCompilerResult({
        sessionID: ctx.sessionID,
        file: filepath,
        source: coqcSource,
        validator: "coqc",
        ok: true,
        validated_source_current: stagedTransaction,
      })
      const proofStatus = SessionProofWorkflow.classifyCoqcSuccess(
        ctx.sessionID,
        filepath,
        coqcSource,
        proofRegionLifecycle,
      )
      const decompositionCheckpoint = SessionProofWorkflow.decompositionModeEnabled()
        ? SessionProofWorkflow.classifyDecompositionCheckpoint(ctx.sessionID, filepath, coqcSource)
        : undefined
      const proofStatusMetadata: unknown = proofStatus
      const statusDetail: string = proofStatus.status_detail
      let proofTransaction = proofStatus.proof_progress.workspace_committable
        ? ProofEditTransaction.markAccepted({
            sessionID: ctx.sessionID,
            file: filepath,
            source: coqcSource,
            level: proofStatus.proof_progress.level === "structural" ? "structural" : "hard",
            receipt: proofStatus.proof_progress.receipt,
          })
        : proofStatus.proof_progress.accepted &&
            (proofStatus.proof_progress.level === "hard" || proofStatus.proof_progress.level === "structural")
          ? ProofEditTransaction.markCertifiedRecovery({
              sessionID: ctx.sessionID,
              file: filepath,
              source: coqcSource,
              level: proofStatus.proof_progress.level,
              receipt: proofStatus.proof_progress.receipt,
            })
        : proofStatus.proof_progress.level === "debug"
          ? ProofEditTransaction.markDebug({
              sessionID: ctx.sessionID,
              file: filepath,
              source: coqcSource,
              receipt: proofStatus.proof_progress.receipt,
            })
          : ProofEditTransaction.active(ctx.sessionID)
      if (proofStatus.final_theorem_gate.ok && proofStatus.proof_progress.workspace_committable) {
        proofTransaction =
          (await ProofEditTransaction.finalizeHandedOffAccepted(ctx.sessionID)) ?? proofTransaction
      }
      const toolStatus = decompositionCheckpoint
        ? decompositionCheckpoint.terminal_ready
          ? "decomposition_ready"
          : "decomposition_incomplete"
        : "success"
      return {
        title: `coqc ${rel}: ${decompositionCheckpoint ? toolStatus : statusDetail}`,
        output: [
          `status: ${toolStatus}`,
          decompositionCheckpoint ? "compile_status: success" : undefined,
          decompositionCheckpoint ? `decomposition_status: ${decompositionCheckpoint.status}` : undefined,
          decompositionCheckpoint ? `terminal_ready: ${decompositionCheckpoint.terminal_ready}` : undefined,
          `status_detail: ${statusDetail}`,
          proofStatus.theorem ? `theorem: ${proofStatus.theorem}` : undefined,
          `has_unfinished_proof: ${proofStatus.has_unfinished_proof}`,
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
          proofStatus.final_theorem_gate.ok
            ? "final_theorem_gate: ok"
            : `final_theorem_gate: fail - ${proofStatus.final_theorem_gate.reason}`,
          lemmaPrefixValidation?.ok
            ? `lemma_prefix_validation: ok - ${lemmaPrefixValidation.prefix_complete ? "current blocker complete" : lemmaPrefixValidation.message ?? "current prefix compiles but current blocker is still pending"}`
            : lemmaPrefixValidation
              ? `lemma_prefix_validation: fail - ${lemmaPrefixValidation.message ?? "prefix checkpoint failed"}`
              : undefined,
          `proof_region_lifecycle: ${JSON.stringify(proofRegionLifecycle)}`,
          decompositionCheckpoint
            ? `decomposition_checkpoint: ${JSON.stringify(decompositionCheckpoint)}`
            : undefined,
          statusDetail === "compile_success_nonfinal" && !proofStatus.proof_progress.accepted
            ? "next_action: this compile is not accepted proof progress; obtain a new proof_region compiler certificate or complete the final Qed proof"
            : undefined,
          stdout.trim() ? `output:\n${stdout.trim()}` : undefined,
        ].filter((line): line is string => Boolean(line)).join("\n"),
        metadata: {
          status: toolStatus,
          ...(decompositionCheckpoint
            ? {
                compile_status: "success",
                decomposition_status: decompositionCheckpoint.status,
                terminal_ready: decompositionCheckpoint.terminal_ready,
                decomposition_checkpoint: decompositionCheckpoint,
              }
            : {}),
          status_detail: statusDetail,
          filepath,
          errors: [] as { line: number; message: string }[],
          proof_status: proofStatusMetadata,
          proof_region_lifecycle: proofRegionLifecycle,
          ...(proofTransaction ? { proof_edit_transaction: proofTransaction } : {}),
          ...(lemmaPrefixValidation ? { lemma_prefix_validation: lemmaPrefixValidation } : {}),
        },
      }
    }

    const diagnostics = parseCoqCompilerOutput(stdout, stderr)
    if (stagedValidation) {
      diagnostics.firstError = {
        severity: "error",
        file: filepath,
        line: stagedValidation.first_error_line,
        message: stagedValidation.message ?? "staged Coq compilation failed",
      }
      diagnostics.errors = [diagnostics.firstError]
    }
    const proofRegionLifecycle = await SessionProofWorkflow.recordCompilerResult({
      sessionID: ctx.sessionID,
      file: filepath,
      source: coqcSource,
      validator: "coqc",
      ok: false,
      first_error_file: diagnostics.firstError?.file,
      first_error_line: diagnostics.firstError?.line,
      first_error_message: diagnostics.firstError?.message,
      validated_source_current: stagedTransaction,
    })
    const proofStatus = SessionProofWorkflow.classifyCoqcFailure(ctx.sessionID, filepath, coqcSource, {
      first_error_line: diagnostics.firstError?.line,
      first_error_message: diagnostics.firstError?.message,
      lifecycle: proofRegionLifecycle,
    })
    const proofTransaction = proofStatus.proof_progress.accepted &&
        (proofStatus.proof_progress.level === "hard" || proofStatus.proof_progress.level === "structural")
      ? ProofEditTransaction.markCertifiedRecovery({
          sessionID: ctx.sessionID,
          file: filepath,
          source: coqcSource,
          level: proofStatus.proof_progress.level,
          receipt: proofStatus.proof_progress.receipt,
        })
      : proofStatus.proof_progress.level === "debug"
        ? ProofEditTransaction.markDebug({
            sessionID: ctx.sessionID,
            file: filepath,
            source: coqcSource,
            receipt: proofStatus.proof_progress.receipt,
          })
        : ProofEditTransaction.active(ctx.sessionID)
    const lemmaPrefixValidation = await SessionProofWorkflow.recordLemmaPrefixValidation({
      sessionID: ctx.sessionID,
      agent: ctx.agent,
      file: filepath,
      source: coqcSource,
    })
    const errors = diagnostics.errors.map((error) => ({ line: error.line ?? 0, message: error.message }))

    const summary = errors.length > 0
      ? errors.map((e) => `line ${e.line}: ${e.message}`).join("\n---\n")
      : diagnostics.output

    return {
      title: `coqc ${rel}: ${lemmaPrefixValidation?.ok ? "lemma-prefix-ok" : "fail"}`,
      output: [
        "status: fail",
        lemmaPrefixValidation?.ok
          ? `lemma_prefix_validation: ok - ${lemmaPrefixValidation.prefix_complete ? "current blocker complete" : lemmaPrefixValidation.message ?? "current prefix compiles but current blocker is still pending"}`
          : lemmaPrefixValidation
            ? `lemma_prefix_validation: fail - ${lemmaPrefixValidation.message ?? "prefix checkpoint failed"}`
            : undefined,
        lemmaPrefixValidation?.ok && lemmaPrefixValidation.prefix_complete
          ? "next_action: advance to the next local proof hole toward completing the target theorem; keep later partition braces intact"
          : lemmaPrefixValidation
            ? "next_action: repair the current first proof block with an edit toward a compiling theorem proof; do not switch to broad read-only search or unrelated edits"
            : undefined,
        `proof_region_lifecycle: ${JSON.stringify(proofRegionLifecycle)}`,
        `proof_progress: ${proofStatus.proof_progress.status}`,
        `progress_level: ${proofStatus.proof_progress.level ?? "none"}`,
        `accepted_progress: ${proofStatus.proof_progress.accepted}`,
        `proof_progress_reason: ${proofStatus.proof_progress.reason}`,
        stagedTransaction
          ? `proof_transaction: ${proofStatus.proof_progress.workspace_committable ? `${proofStatus.proof_progress.level} snapshot updated` : "debug draft journaled for further repair"}`
          : undefined,
        `errors:\n${summary}${formatCoqSkillHints(summary)}`,
      ].filter((line): line is string => Boolean(line)).join("\n"),
      metadata: {
        status: "fail",
        status_detail: lemmaPrefixValidation?.ok && lemmaPrefixValidation.prefix_complete ? "lemma_prefix_success_full_compile_failed" : "compile_failed",
        filepath,
        errors,
        proof_status: proofStatus,
        proof_region_lifecycle: proofRegionLifecycle,
        ...(proofTransaction ? { proof_edit_transaction: proofTransaction } : {}),
        ...(lemmaPrefixValidation ? { lemma_prefix_validation: lemmaPrefixValidation } : {}),
      },
    }
  },
})
