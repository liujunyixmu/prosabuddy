import z from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { createTwoFilesPatch } from "diff"
import DESCRIPTION from "./write.txt"
import { Bus } from "../bus"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { FileTime } from "../file/time"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { trimDiff } from "./edit"
import { assertExternalDirectory } from "./external-directory"
import { assertNoRewriteBangInCoqFile, assertNoIntuitionInCoqFile } from "./coq-style-guard"
import { SessionProofWorkflow } from "@/session/proof-workflow"

const MAX_DIAGNOSTICS_PER_FILE = 20
const MAX_PROJECT_DIAGNOSTICS_FILES = 5

export const WriteTool = Tool.define("write", {
  description: DESCRIPTION,
  parameters: z.object({
    content: z.string().describe("The content to write to the file"),
    filePath: z.string().describe("The absolute path to the file to write (must be absolute, not relative)"),
    takeover_running_region: z.boolean().optional().describe("Explicitly take over a running lemma-owned proof_region when this wide-scope agent must edit it."),
    takeover_reason: z.string().optional().describe("Required when takeover_running_region is true; records why the running region is being taken over."),
  }),
  async execute(params, ctx) {
    const filepath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
    await assertExternalDirectory(ctx, filepath)

    const exists = await Filesystem.exists(filepath)
    const contentOld = exists ? await Filesystem.readText(filepath) : ""
    if (exists) await FileTime.assert(ctx.sessionID, filepath)
    assertNoRewriteBangInCoqFile(filepath, params.content)
    assertNoIntuitionInCoqFile(filepath, params.content)
    SessionProofWorkflow.assertLemmaSequentialEditAllowed({
      sessionID: ctx.sessionID,
      agent: ctx.agent,
      file: filepath,
      before: contentOld,
      after: params.content,
    })
    let proofWorkflowTakeover = SessionProofWorkflow.assertWideAgentRunningRegionEditAllowed({
      sessionID: ctx.sessionID,
      agent: ctx.agent,
      file: filepath,
      before: contentOld,
      after: params.content,
      takeover: params.takeover_running_region,
      takeoverReason: params.takeover_reason,
    })
    SessionProofWorkflow.assertBoundProofBodyMutationAllowed({
      sessionID: ctx.sessionID,
      file: filepath,
      before: contentOld,
      after: params.content,
    })

    const diff = trimDiff(createTwoFilesPatch(filepath, filepath, contentOld, params.content))
    await ctx.ask({
      permission: "edit",
      patterns: [path.relative(Instance.worktree, filepath)],
      always: ["*"],
      metadata: {
        filepath,
        diff,
      },
    })

    await Filesystem.write(filepath, params.content, 0o644)
    await Bus.publish(File.Event.Edited, {
      file: filepath,
    })
    await Bus.publish(FileWatcher.Event.Updated, {
      file: filepath,
      event: exists ? "change" : "add",
    })
    if (params.takeover_running_region && params.takeover_reason?.trim()) {
      proofWorkflowTakeover = SessionProofWorkflow.recordWideAgentRunningRegionTakeover({
        agent: ctx.agent,
        file: filepath,
        before: contentOld,
        after: params.content,
        takeoverReason: params.takeover_reason,
      })
    }
    SessionProofWorkflow.recordSourceMutation(filepath, params.content)
    FileTime.read(ctx.sessionID, filepath)

    let output = "Wrote file successfully."
    await LSP.touchFile(filepath, true)
    const diagnostics = await LSP.diagnostics()
    const normalizedFilepath = Filesystem.normalizePath(filepath)
    let projectDiagnosticsCount = 0
    for (const [file, issues] of Object.entries(diagnostics)) {
      const errors = issues.filter((item) => item.severity === 1)
      if (errors.length === 0) continue
      const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
      const suffix =
        errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
      if (file === normalizedFilepath) {
        output += `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${filepath}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
        continue
      }
      if (projectDiagnosticsCount >= MAX_PROJECT_DIAGNOSTICS_FILES) continue
      projectDiagnosticsCount++
      output += `\n\nLSP errors detected in other files:\n<diagnostics file="${file}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
    }

    return {
      title: path.relative(Instance.worktree, filepath),
      metadata: {
        diagnostics,
        filepath,
        exists: exists,
        ...(proofWorkflowTakeover.length > 0 ? { proof_workflow_takeover: proofWorkflowTakeover } : {}),
      },
      output,
    }
  },
})
