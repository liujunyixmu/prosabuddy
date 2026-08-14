import { Config } from "../config/config"
import z from "zod"
import { Provider } from "../provider/provider"
import { generateObject, streamObject, type ModelMessage } from "ai"
import { SystemPrompt } from "../session/system"
import { Instance } from "../project/instance"
import { Truncate } from "../tool/truncation"
import { Auth } from "../auth"
import { ProviderTransform } from "../provider/transform"

import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_FIXER from "./prompt/fixer.txt"
import PROMPT_DIAGNOSER from "./prompt/diagnoser.txt"
import PROMPT_LEMMA from "./prompt/lemma.txt"
import PROMPT_WHOLE_LEMMA from "./prompt/whole-lemma.txt"
import PROMPT_PROVER from "./prompt/prover.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import { PermissionNext } from "@/permission/next"
import { pipe, sortBy, values } from "remeda"
import path from "path"

export namespace Agent {
  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      mode: z.enum(["subagent", "primary", "all"]),
      native: z.boolean().optional(),
      hidden: z.boolean().optional(),
      topP: z.number().optional(),
      temperature: z.number().optional(),
      color: z.string().optional(),
      permission: PermissionNext.Ruleset,
      model: z
        .object({
          modelID: z.string(),
          providerID: z.string(),
        })
        .optional(),
      variant: z.string().optional(),
      prompt: z.string().optional(),
      options: z.record(z.string(), z.any()),
    })
    .meta({
      ref: "Agent",
    })
  export type Info = z.infer<typeof Info>

  const state = Instance.state(async () => {
    const cfg = await Config.get()

    const defaults = PermissionNext.fromConfig({
      "*": "allow",
      doom_loop: "ask",
      external_directory: "ask",
      question: "deny",
      plan_enter: "deny",
      plan_exit: "deny",
      bash: "deny",
      webfetch: "deny",
      websearch: "deny",
      codesearch: "deny",
      skill: "deny",
    })
    const user = PermissionNext.fromConfig(cfg.permission ?? {})
    const sensitiveRead = PermissionNext.fromConfig({
      read: {
        "*/.env": "ask",
        "*/.env.local": "ask",
        "*/.env.production": "ask",
        "*/.env.development.local": "ask",
      },
    })

    const result: Record<string, Info> = {
      prover: {
        name: "prover",
        description:
          "Layer 1 Coq theorem prover. Owns theorem-level phase control: paper-faithful skeleton generation first, then lemma-by-lemma discharge, first-level gap delegation, result merging, and final validation.",
        prompt: PROMPT_PROVER,
        options: {},
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            read: "allow",
            glob: "allow",
            grep: "allow",
            edit: "allow",
            write: "allow",
            coqc: "allow",
            coqtop: "allow",
            proof_plan: "allow",
            coq_session: "allow",
            checkpoint: "allow",
            bash: "allow",
            todowrite: "allow",
            task: "allow",
            skill: "allow",
          }),
          sensitiveRead,
          user,
        ),
        mode: "primary",
        native: true,
      },
      explorer: {
        name: "explorer",
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            grep: "allow",
            glob: "allow",
            read: "allow",
            external_directory: "ask",
          }),
          sensitiveRead,
          user,
        ),
        description: "Fast read-only subagent for locating Coq lemmas, definitions, equation references, and proof patterns that support a specific paper step or pose/have obligation.",
        prompt: PROMPT_EXPLORE,
        options: {},
        mode: "subagent",
        native: true,
      },
      "whole-lemma": {
        name: "whole-lemma",
        description:
          "Layer 1 direct whole-theorem prover with lemma-agent proof discipline. Wide fallback, not a lemma-local worker: owns the current target theorem as one focused proof obligation without paper-skeleton or prooftex orchestration.",
        prompt: PROMPT_WHOLE_LEMMA,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            read: "allow",
            glob: "allow",
            grep: "allow",
            edit: "allow",
            write: "allow",
            coqc: "allow",
            coqtop: "allow",
            coq_session: "allow",
            lsp: "allow",
            petanque: "allow",
            bash: "allow",
            task: "allow",
            todowrite: "deny",
            skill: "allow",
          }),
          sensitiveRead,
          user,
        ),
        options: {},
        mode: "primary",
        native: true,
      },
      lemma: {
        name: "lemma",
        description:
          "Layer 2 long-running local subtheorem prover for one assigned frozen gap. Preserves the outer skeleton, uses Coq/LSP tools iteratively for the owned gap, and may choose direct proof, same-region helpers, or same-session recursive decomposition inside that assignment.",
        prompt: PROMPT_LEMMA,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            read: "allow",
            glob: "allow",
            grep: "allow",
            edit: "allow",
            write: "allow",
            coqc: "allow",
            coqtop: "allow",
            coq_session: "allow",
            lsp: "allow",
            petanque: "allow",
            bash: "allow",
            task: {
              "*": "allow",
              lemma: "deny",
            },
            todowrite: "deny",
            skill: "allow",
          }),
          sensitiveRead,
          user,
        ),
        options: {},
        mode: "subagent",
        native: true,
      },
      fixer: {
        name: "fixer",
        description: "Layer 3 surgical error repair subagent. Wide fallback, not a lemma-local worker: receives focused local context and applies minimal fixes without rewriting the established pose/have skeleton or paper-faithful proof order.",
        prompt: PROMPT_FIXER,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            read: "allow",
            glob: "allow",
            grep: "allow",
            edit: "allow",
            coqc: "allow",
            coqtop: "allow",
            coq_session: "allow",
            bash: "allow",
            write: "deny",
            proof_plan: "deny",
            task: "deny",
            todowrite: "deny",
            skill: "allow",
          }),
          sensitiveRead,
          user,
        ),
        options: {},
        mode: "subagent",
        native: true,
      },
      diagnoser: {
        name: "diagnoser",
        description: "Error diagnosis subagent. Classifies Coq failures into local technical issues versus genuinely missing logical ingredients so higher layers can decide whether to fix locally, add local support, or escalate.",
        prompt: PROMPT_DIAGNOSER,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            glob: "allow",
            grep: "allow",
            coqtop: "allow",
            external_directory: "ask",
            task: "deny",
            edit: "deny",
            write: "deny",
            todowrite: "deny",
            skill: "allow",
          }),
          sensitiveRead,
          user,
        ),
        options: {},
        mode: "subagent",
        native: true,
      },
      compaction: {
        name: "compaction",
        mode: "primary",
        native: true,
        hidden: true,
        prompt: PROMPT_COMPACTION,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        options: {},
      },
      title: {
        name: "title",
        mode: "primary",
        options: {},
        native: true,
        hidden: true,
        temperature: 0.5,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        prompt: PROMPT_TITLE,
      },
    }

    for (const [key, value] of Object.entries(cfg.agent ?? {})) {
      if (value.disable) {
        delete result[key]
        continue
      }
      let item = result[key]
      if (!item)
        item = result[key] = {
          name: key,
          mode: "all",
          permission: PermissionNext.merge(defaults, sensitiveRead, user),
          options: {},
          native: false,
        }
      if (value.model) item.model = Provider.parseModel(value.model)
      item.variant = value.variant ?? item.variant
      item.prompt = value.prompt ?? item.prompt
      item.description = value.description ?? item.description
      item.temperature = value.temperature ?? item.temperature
      item.topP = value.top_p ?? item.topP
      item.mode = value.mode ?? item.mode
      item.color = value.color ?? item.color
      item.hidden = value.hidden ?? item.hidden
      item.name = value.name ?? item.name
      item.options = { ...item.options, ...(value.options ?? {}) }
      item.permission = PermissionNext.merge(item.permission, PermissionNext.fromConfig(value.permission ?? {}))
    }

    const skillDirectories = PermissionNext.fromConfig({
      external_directory: {
        [path.join(Instance.directory, ".opencode", "skill", "*")]: "allow",
        [path.join(Instance.worktree, ".opencode", "skill", "*")]: "allow",
      },
    })
    for (const name in result) {
      result[name].permission = PermissionNext.merge(result[name].permission, skillDirectories)
    }

    // Ensure Truncate.GLOB is allowed unless explicitly configured
    for (const name in result) {
      const agent = result[name]
      const explicit = agent.permission.some((r) => {
        if (r.permission !== "external_directory") return false
        if (r.action !== "deny") return false
        return r.pattern === Truncate.GLOB
      })
      if (explicit) continue

      result[name].permission = PermissionNext.merge(
        result[name].permission,
        PermissionNext.fromConfig({ external_directory: { [Truncate.GLOB]: "allow" } }),
      )
    }

    return result
  })

  export async function get(agent: string) {
    return state().then((x) => x[agent])
  }

  export async function list() {
    const cfg = await Config.get()
    return pipe(
      await state(),
      values(),
      sortBy([(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "prover"), "desc"]),
    )
  }

  export async function defaultAgent() {
    const cfg = await Config.get()
    const agents = await state()

    if (cfg.default_agent) {
      const agent = agents[cfg.default_agent]
      if (!agent) throw new Error(`default agent "${cfg.default_agent}" not found`)
      if (agent.mode === "subagent") throw new Error(`default agent "${cfg.default_agent}" is a subagent`)
      if (agent.hidden === true) throw new Error(`default agent "${cfg.default_agent}" is hidden`)
      return agent.name
    }

    // Default to prover agent
    if (agents["prover"]) return "prover"

    const primaryVisible = Object.values(agents).find((a) => a.mode !== "subagent" && a.hidden !== true)
    if (!primaryVisible) throw new Error("no primary visible agent found")
    return primaryVisible.name
  }
}
