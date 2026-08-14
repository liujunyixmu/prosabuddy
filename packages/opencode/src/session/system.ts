import { Instance } from "../project/instance"

import PROMPT_COQPROVER from "./prompt/coqprover.txt"
import PROMPT_PROOF_WORKFLOW_PRINCIPLES from "./prompt/proof-workflow-principles.txt"
import type { Provider } from "@/provider/provider"

const SHARED_PROOF_WORKFLOW_PROMPT = [
  "# Shared Proof Workflow Policy",
  PROMPT_PROOF_WORKFLOW_PRINCIPLES.trim(),
].join("\n\n")

export namespace SystemPrompt {
  export function instructions() {
    return [PROMPT_COQPROVER.trim(), SHARED_PROOF_WORKFLOW_PROMPT].join("\n\n")
  }

  export function provider(_model: Provider.Model) {
    return [PROMPT_COQPROVER, SHARED_PROOF_WORKFLOW_PROMPT]
  }

  export async function environment(model: Provider.Model) {
    const project = Instance.project
    return [
      [
        `You are CoqProver powered by ${model.api.id}.`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  WORKSPACE BOUNDARY: All file operations (read, write, edit, search, compile) MUST stay within ${Instance.directory}. Accessing paths outside this directory is forbidden.`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `</env>`,
      ].join("\n"),
    ]
  }
}
