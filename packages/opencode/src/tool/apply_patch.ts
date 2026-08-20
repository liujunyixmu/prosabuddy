import z from "zod"
import * as path from "path"
import * as fs from "fs/promises"
import { Tool } from "./tool"
import { Bus } from "../bus"
import { FileWatcher } from "../file/watcher"
import { Instance } from "../project/instance"
import { Patch } from "../patch"
import { createTwoFilesPatch, diffLines } from "diff"
import { assertExternalDirectory } from "./external-directory"
import { trimDiff } from "./edit"
import { LSP } from "../lsp"
import { Filesystem } from "../util/filesystem"
import DESCRIPTION from "./apply_patch.txt"
import { File } from "../file"
import { assertNoRewriteBangInCoqFile, assertNoIntuitionInCoqFile } from "./coq-style-guard"
import { formatCoqSkillHints } from "./coq-skill-hints"
import { SessionProofWorkflow } from "@/session/proof-workflow"
import { ProofEditTransaction } from "@/session/proof-edit-transaction"
import { EditConflictGuard } from "./edit-conflict-guard"

const PatchParams = z.object({
  patchText: z.string().describe("The full patch text that describes all changes to be made"),
  takeover_running_region: z.boolean().optional().describe("Explicitly take over a running lemma-owned proof_region when this wide-scope agent must edit it."),
  takeover_reason: z.string().optional().describe("Required when takeover_running_region is true; records why the running region is being taken over."),
})

export const ApplyPatchTool = Tool.define("apply_patch", {
  description: DESCRIPTION,
  parameters: PatchParams,
  async execute(params, ctx) {
    if (!params.patchText) {
      throw new Error("patchText is required")
    }

    // Parse the patch to get hunks
    let hunks: Patch.Hunk[]
    try {
      const parseResult = Patch.parsePatch(params.patchText)
      hunks = parseResult.hunks
    } catch (error) {
      throw new Error(`apply_patch verification failed: ${error}`)
    }

    if (hunks.length === 0) {
      const normalized = params.patchText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
      if (normalized === "*** Begin Patch\n*** End Patch") {
        throw new Error("patch rejected: empty patch")
      }
      throw new Error("apply_patch verification failed: no hunks found")
    }

    const activeProofTransaction = ProofEditTransaction.active(ctx.sessionID)
    if (activeProofTransaction) {
      ProofEditTransaction.assertStagedReadSynchronized(
        ctx.sessionID,
        activeProofTransaction.file,
        "applying a proof patch",
      )
      const targets = hunks.flatMap((hunk) => [
        path.resolve(Instance.directory, hunk.path),
        ...(hunk.type === "update" && hunk.move_path ? [path.resolve(Instance.directory, hunk.move_path)] : []),
      ])
      ProofEditTransaction.assertPatchTargets(ctx.sessionID, targets)
      if (hunks.length !== 1 || hunks[0].type !== "update" || hunks[0].move_path) {
        throw new Error(
          "proof_transaction_scope_rejection: proof child patches may update the authorized file but may not add, delete, or move it",
        )
      }
    }

    // Validate file paths and check permissions
    const fileChanges: Array<{
      filePath: string
      oldContent: string
      newContent: string
      type: "add" | "update" | "delete" | "move"
      movePath?: string
      diff: string
      additions: number
      deletions: number
    }> = []

    let totalDiff = ""

    for (const hunk of hunks) {
      const filePath = path.resolve(Instance.directory, hunk.path)
      await assertExternalDirectory(ctx, filePath)

      switch (hunk.type) {
        case "add": {
          const oldContent = ""
          const newContent =
            hunk.contents.length === 0 || hunk.contents.endsWith("\n") ? hunk.contents : `${hunk.contents}\n`
          const diff = trimDiff(createTwoFilesPatch(filePath, filePath, oldContent, newContent))

          let additions = 0
          let deletions = 0
          for (const change of diffLines(oldContent, newContent)) {
            if (change.added) additions += change.count || 0
            if (change.removed) deletions += change.count || 0
          }

          fileChanges.push({
            filePath,
            oldContent,
            newContent,
            type: "add",
            diff,
            additions,
            deletions,
          })

          totalDiff += diff + "\n"
          break
        }

        case "update": {
          // Check if file exists for update
          const stats = await fs.stat(filePath).catch(() => null)
          if (!stats || stats.isDirectory()) {
            throw new Error(`apply_patch verification failed: Failed to read file to update: ${filePath}`)
          }

          const oldContent = ProofEditTransaction.source(ctx.sessionID, filePath) ?? await fs.readFile(filePath, "utf-8")
          let newContent = oldContent

          // Apply the update chunks to get new content
          EditConflictGuard.assertAllowed({ sessionID: ctx.sessionID, file: filePath, source: oldContent })
          try {
            const fileUpdate = Patch.deriveNewContentsFromChunks(filePath, hunk.chunks, oldContent)
            newContent = fileUpdate.content
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const conflict = /failed to find expected lines|invalid context|context mismatch/i.test(message)
            if (conflict) {
              throw new Error(
                `apply_patch verification failed:\n${EditConflictGuard.recordFailure({
                  sessionID: ctx.sessionID,
                  file: filePath,
                  source: oldContent,
                  reason: message,
                })}`,
              )
            }
            throw new Error(`apply_patch verification failed: ${error}`)
          }
          EditConflictGuard.recordSuccess(ctx.sessionID, filePath)

          const diff = trimDiff(createTwoFilesPatch(filePath, filePath, oldContent, newContent))

          let additions = 0
          let deletions = 0
          for (const change of diffLines(oldContent, newContent)) {
            if (change.added) additions += change.count || 0
            if (change.removed) deletions += change.count || 0
          }

          const movePath = hunk.move_path ? path.resolve(Instance.directory, hunk.move_path) : undefined
          await assertExternalDirectory(ctx, movePath)

          fileChanges.push({
            filePath,
            oldContent,
            newContent,
            type: hunk.move_path ? "move" : "update",
            movePath,
            diff,
            additions,
            deletions,
          })

          totalDiff += diff + "\n"
          break
        }

        case "delete": {
          const contentToDelete = await fs.readFile(filePath, "utf-8").catch((error) => {
            throw new Error(`apply_patch verification failed: ${error}`)
          })
          const deleteDiff = trimDiff(createTwoFilesPatch(filePath, filePath, contentToDelete, ""))

          const deletions = contentToDelete.split("\n").length

          fileChanges.push({
            filePath,
            oldContent: contentToDelete,
            newContent: "",
            type: "delete",
            diff: deleteDiff,
            additions: 0,
            deletions,
          })

          totalDiff += deleteDiff + "\n"
          break
        }
      }
    }

    for (const change of fileChanges) {
      if (change.type === "delete") continue
      assertNoRewriteBangInCoqFile(change.movePath ?? change.filePath, change.newContent)
      assertNoIntuitionInCoqFile(change.movePath ?? change.filePath, change.newContent)
    }

    let proofWorkflowTakeover: Array<{ sessionID: string; admit_id: string }> = []
    for (const change of fileChanges) {
      const target = change.movePath ?? change.filePath
      SessionProofWorkflow.assertLemmaSequentialEditAllowed({
        sessionID: ctx.sessionID,
        agent: ctx.agent,
        file: target,
        before: change.oldContent,
        after: change.newContent,
      })
      proofWorkflowTakeover.push(
        ...SessionProofWorkflow.assertWideAgentRunningRegionEditAllowed({
          sessionID: ctx.sessionID,
          agent: ctx.agent,
          file: target,
          before: change.oldContent,
          after: change.newContent,
          takeover: params.takeover_running_region,
          takeoverReason: params.takeover_reason,
        }),
      )
      SessionProofWorkflow.assertBoundProofBodyMutationAllowed({
        sessionID: ctx.sessionID,
        file: change.filePath,
        destinationFile: target,
        before: change.oldContent,
        after: change.newContent,
      })
    }

    // Build per-file metadata for UI rendering (used for both permission and result)
    const files = fileChanges.map((change) => ({
      filePath: change.filePath,
      relativePath: path.relative(Instance.worktree, change.movePath ?? change.filePath).replaceAll("\\", "/"),
      type: change.type,
      diff: change.diff,
      before: change.oldContent,
      after: change.newContent,
      additions: change.additions,
      deletions: change.deletions,
      movePath: change.movePath,
    }))

    // Check permissions if needed
    const relativePaths = fileChanges.map((c) => path.relative(Instance.worktree, c.filePath).replaceAll("\\", "/"))
    await ctx.ask({
      permission: "edit",
      patterns: relativePaths,
      always: ["*"],
      metadata: {
        filepath: relativePaths.join(", "),
        diff: totalDiff,
        files,
      },
    })

    // Apply the changes, or stage the single authorized proof-file update.
    const updates: Array<{ file: string; event: "add" | "change" | "unlink" }> = []
    let proofTransaction: ProofEditTransaction.Summary | undefined

    if (activeProofTransaction) {
      const change = fileChanges[0]
      proofTransaction = ProofEditTransaction.stage({
        sessionID: ctx.sessionID,
        file: change.filePath,
        before: change.oldContent,
        after: change.newContent,
      })
      if (proofTransaction && params.takeover_running_region && params.takeover_reason?.trim()) {
        const target = change.movePath ?? change.filePath
        proofWorkflowTakeover = SessionProofWorkflow.recordWideAgentRunningRegionTakeover({
          agent: ctx.agent,
          file: target,
          before: change.oldContent,
          after: change.newContent,
          takeoverReason: params.takeover_reason,
        })
      }
    } else {
      for (const change of fileChanges) {
        const edited = change.type === "delete" ? undefined : (change.movePath ?? change.filePath)
        switch (change.type) {
          case "add":
            // Create parent directories (recursive: true is safe on existing/root dirs)
            await fs.mkdir(path.dirname(change.filePath), { recursive: true })
            await fs.writeFile(change.filePath, change.newContent, "utf-8")
            updates.push({ file: change.filePath, event: "add" })
            break

          case "update":
            await fs.writeFile(change.filePath, change.newContent, "utf-8")
            updates.push({ file: change.filePath, event: "change" })
            break

          case "move":
            if (change.movePath) {
              // Create parent directories (recursive: true is safe on existing/root dirs)
              await fs.mkdir(path.dirname(change.movePath), { recursive: true })
              await fs.writeFile(change.movePath, change.newContent, "utf-8")
              await fs.unlink(change.filePath)
              updates.push({ file: change.filePath, event: "unlink" })
              updates.push({ file: change.movePath, event: "add" })
            }
            break

          case "delete":
            await fs.unlink(change.filePath)
            updates.push({ file: change.filePath, event: "unlink" })
            break
        }

        if (edited) {
          await Bus.publish(File.Event.Edited, {
            file: edited,
          })
        }
      }
    }

    if (!proofTransaction && params.takeover_running_region && params.takeover_reason?.trim()) {
      proofWorkflowTakeover = []
      for (const change of fileChanges) {
        const target = change.movePath ?? change.filePath
        proofWorkflowTakeover.push(
          ...SessionProofWorkflow.recordWideAgentRunningRegionTakeover({
            agent: ctx.agent,
            file: target,
            before: change.oldContent,
            after: change.newContent,
            takeoverReason: params.takeover_reason,
          }),
        )
      }
    }

    if (!proofTransaction) {
      for (const change of fileChanges) {
        if (change.type === "delete") continue
        const target = change.movePath ?? change.filePath
        SessionProofWorkflow.recordSourceMutation(target, change.newContent)
      }

      // Publish file change events
      for (const update of updates) {
        await Bus.publish(FileWatcher.Event.Updated, update)
      }

      // Notify LSP of file changes and collect diagnostics
      for (const change of fileChanges) {
        if (change.type === "delete") continue
        const target = change.movePath ?? change.filePath
        await LSP.touchFile(target, true)
      }
    }
    const diagnostics = proofTransaction ? {} : await LSP.diagnostics()

    // Generate output summary
    const summaryLines = fileChanges.map((change) => {
      if (change.type === "add") {
        return `A ${path.relative(Instance.worktree, change.filePath).replaceAll("\\", "/")}`
      }
      if (change.type === "delete") {
        return `D ${path.relative(Instance.worktree, change.filePath).replaceAll("\\", "/")}`
      }
      const target = change.movePath ?? change.filePath
      return `M ${path.relative(Instance.worktree, target).replaceAll("\\", "/")}`
    })
    let output = proofTransaction
      ? `Success. Staged the authorized proof edit in transaction ${proofTransaction.transaction_id}; the workspace file remains unchanged until accepted progress is committed.\n${summaryLines.join("\n")}`
      : `Success. Updated the following files:\n${summaryLines.join("\n")}`

    // Report LSP errors for changed files
    const MAX_DIAGNOSTICS_PER_FILE = 20
    for (const change of fileChanges) {
      if (change.type === "delete") continue
      const target = change.movePath ?? change.filePath
      const normalized = Filesystem.normalizePath(target)
      const issues = diagnostics[normalized] ?? []
      const errors = issues.filter((item) => item.severity === 1)
      if (errors.length > 0) {
        const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
        const suffix =
          errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
        const diagnosticText = limited.map(LSP.Diagnostic.pretty).join("\n")
        const skillHints = target.endsWith(".v") ? formatCoqSkillHints(diagnosticText) : ""
        output += `\n\nLSP errors detected in ${path.relative(Instance.worktree, target).replaceAll("\\", "/")}, please fix:\n<diagnostics file="${target}">\n${diagnosticText}${suffix}\n</diagnostics>${skillHints}`
      }
    }

    return {
      title: output,
      metadata: {
        diff: totalDiff,
        files,
        diagnostics,
        ...(proofTransaction ? { proof_edit_transaction: proofTransaction } : {}),
        ...(proofWorkflowTakeover.length > 0 ? { proof_workflow_takeover: proofWorkflowTakeover } : {}),
      },
      output,
    }
  },
})
