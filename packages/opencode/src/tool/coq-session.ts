import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./coq-session.txt"
import { createHash, randomBytes } from "crypto"
import { Instance } from "../project/instance"
import path from "path"
import * as CoqProject from "./coq-project"
import type { CoqSessionState, EnvFeedback, TacticRecord, SessionSummary } from "./proof-schema"
import { assertNoRewriteBang, assertNoIntuition } from "./coq-style-guard"
import { formatCoqSkillHints } from "./coq-skill-hints"
import {
  ContextNormalizationAuditSchema,
  type ContextNormalizationAudit,
} from "@/session/lemma-assignment"
import { SessionProofWorkflow } from "@/session/proof-workflow"
import { ProofEditTransaction } from "@/session/proof-edit-transaction"

function rid() {
  return "snap_" + randomBytes(4).toString("hex")
}

// In-memory session storage
const sessions = new Map<string, CoqSessionState>()
const contextAudits = new Map<string, Map<string, ContextNormalizationAudit>>()
const MAX_CONTEXT_AUDITS_PER_SESSION = 16
const MAX_CONTEXT_AUDIT_SESSIONS = 256

function compactText(text: string, limit = 240) {
  const normalized = text.replace(/\s+/g, " ").trim()
  return normalized.length <= limit ? normalized : normalized.slice(0, limit - 3) + "..."
}

function fingerprint(text: string) {
  return createHash("sha256").update(text).digest("hex")
}

function normalizedGoalText(text: string) {
  return text
    .replace(/^\s*\d+\s+(?:sub)?goals?\s*/i, "")
    .replace(/^\s*goal\s+\d+(?:\s*\/\s*\d+)?\s*:\s*/gim, "")
    .replace(/File "[^"]+", line \d+, characters \d+-\d+:[\s\S]*?(?=\n\S|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function goalConclusion(text: string) {
  const separator = text.lastIndexOf("============================")
  return normalizedGoalText(separator >= 0 ? text.slice(separator + "============================".length) : text)
}

function remainingGoals(text: string) {
  const match = text.match(/(\d+)\s+(?:sub)?goals?/i)
  if (match) return Number.parseInt(match[1])
  if (/no more goals|no goals?/i.test(text)) return 0
  return undefined
}

function goalIdentity(text: string) {
  const strict = text.replace(/\s+/g, " ").trim()
  const semantic = normalizedGoalText(text)
  const conclusion = goalConclusion(text)
  return {
    strict_fingerprint: fingerprint(strict),
    semantic_fingerprint: fingerprint(semantic),
    conclusion_fingerprint: fingerprint(conclusion),
    conclusion,
    remaining_goals: remainingGoals(text),
  }
}

function normalizedComparisonVariants(text: string) {
  const normalized = normalizedGoalText(text)
  const variants = new Set([normalized])
  let round = 0
  let square = 0
  let curly = 0

  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index]
    if (char === "(") round += 1
    else if (char === ")") round = Math.max(0, round - 1)
    else if (char === "[") square += 1
    else if (char === "]") square = Math.max(0, square - 1)
    else if (char === "{") curly += 1
    else if (char === "}") curly = Math.max(0, curly - 1)
    if (round !== 0 || square !== 0 || curly !== 0) continue

    const pair = normalized.slice(index, index + 2)
    const singleComparison = char === ">" && normalized[index - 1] !== "=" && normalized[index + 1] !== "="
    if (pair !== ">=" && !singleComparison) continue
    const width = pair === ">=" ? 2 : 1
    const left = normalized.slice(0, index).trim()
    const right = normalized.slice(index + width).trim()
    if (!left || !right) continue
    variants.add(normalizedGoalText(`${right} ${pair === ">=" ? "<=" : "<"} ${left}`))
    break
  }
  return variants
}

function expectedGoalMatches(actual: ReturnType<typeof goalIdentity>, expectedGoal: string, expectedFingerprint?: string) {
  if (actual.remaining_goals !== undefined && actual.remaining_goals !== 1) return false
  const expectedVariants = normalizedComparisonVariants(expectedGoal)
  // Assignment fingerprints have historically been produced from either the
  // full normalized goal (including hypotheses) or the conclusion alone.
  // Coq also prints `lhs >= rhs` canonically as `rhs <= lhs`; include that
  // notation-equivalent conclusion before declaring a session desynchronized.
  const candidateFingerprints = new Set([
    expectedFingerprint,
    ...[...expectedVariants].map(fingerprint),
  ].filter((value): value is string => Boolean(value)))
  const fingerprintMatches =
    candidateFingerprints.has(actual.semantic_fingerprint) ||
    candidateFingerprints.has(actual.conclusion_fingerprint)
  return fingerprintMatches || expectedVariants.has(actual.conclusion)
}

function assertAuditExpression(label: string, expression: string) {
  if (expression.includes("\n") || expression.includes("\r")) {
    throw new Error(`${label} must be one bounded Coq expression without newlines`)
  }
  if (/\p{Cc}/u.test(expression) || /[";]/.test(expression)) {
    throw new Error(`${label} contains control, string, or tactic-separator syntax`)
  }
  if (
    /\(\*|\*\)|\b(?:Qed|Defined|Admitted|Abort|Proof|Goal|Theorem|Lemma|Definition|Fact|Remark|Example|Ltac|Tactic|Require|Import|Export|Redirect|Print|Check|Search|Locate|About|Eval|Compute|Set|Unset|Open|Close|Module|Section|End|Variable|Variables|Context|Axiom|Parameter|Parameters|Inductive|CoInductive|Record|Class|Instance|Program|Obligation|Hint|Notation|Infix|Arguments|Canonical|Coercion|Scheme|Declare)\b/i.test(
      expression,
    )
  ) {
    throw new Error(`${label} contains command or tactic syntax; inspect accepts expressions only`)
  }
  const opening = new Map<string, string>([[")", "("], ["]", "["], ["}", "{"]])
  const stack: string[] = []
  for (let index = 0; index < expression.length; index++) {
    const char = expression[index]
    if (char === "(" || char === "[" || char === "{") stack.push(char)
    else if (opening.has(char)) {
      if (stack.pop() !== opening.get(char)) {
        throw new Error(`${label} has unbalanced delimiters and could escape the audit term`)
      }
    }
    if (char === ".") {
      const previous = expression[index - 1]
      const next = expression[index + 1]
      if (!previous || !next || !/[A-Za-z0-9_']/.test(previous) || !/[A-Za-z0-9_']/.test(next)) {
        throw new Error(`${label} contains a Coq sentence terminator; inspect accepts one term only`)
      }
    }
  }
  if (stack.length > 0) {
    throw new Error(`${label} has unbalanced delimiters and could escape the audit term`)
  }
}

function recordContextAudit(sessionID: string, audit: ContextNormalizationAudit) {
  const parsed = ContextNormalizationAuditSchema.parse({ ...audit, verified: true })
  const existing = contextAudits.get(sessionID) ?? new Map<string, ContextNormalizationAudit>()
  existing.set(parsed.audit_id, parsed)
  while (existing.size > MAX_CONTEXT_AUDITS_PER_SESSION) {
    const first = existing.keys().next().value
    if (!first) break
    existing.delete(first)
  }
  contextAudits.set(sessionID, existing)
  while (contextAudits.size > MAX_CONTEXT_AUDIT_SESSIONS) {
    const first = contextAudits.keys().next().value
    if (!first) break
    contextAudits.delete(first)
  }
  return parsed
}

export function findContextNormalizationAudit(sessionID: string, auditID: string) {
  return contextAudits.get(sessionID)?.get(auditID)
}

export function currentCoqProofState(sessionID: string) {
  const session = sessions.get(sessionID)
  if (!session) return undefined
  return {
    goal: session.focused_goal,
    hypotheses: [...session.local_hyps],
    goal_fingerprint: session.semantic_goal_fingerprint,
    expected_goal_fingerprint: session.expected_goal_fingerprint,
    source_hash: session.source_hash,
    certified_prefix_fingerprint: session.certified_prefix_fingerprint,
    admit_id: session.region_admit_id,
    last_error: session.last_error,
  }
}

function auditOutcome(exit: number, output: string): ContextNormalizationAudit["outcome"] {
  if (exit === 0) return "convertible"
  if (/unable to unify|cannot unify|not convertible|reflexivity tactic failed/i.test(output)) {
    return "not_convertible"
  }
  return "inconclusive"
}

/** Compute frontier view from current session state */
function frontier(session: CoqSessionState): string {
  const parts = [`Goal: ${session.focused_goal.slice(0, 300)}`]
  if (session.local_hyps.length > 0) parts.push(`Hyps: ${session.local_hyps.join(", ")}`)
  return parts.join("\n")
}

/** Build a SessionSummary from current state and feedback */
function summarize(session: CoqSessionState, fb?: EnvFeedback, prev?: string): SessionSummary {
  const last = session.tactic_history[session.tactic_history.length - 1]
  return {
    last_success: last?.result === "success" ? last.tactic : session.summary?.last_success ?? null,
    last_failure: last?.result === "failure" ? last.tactic : session.summary?.last_failure ?? null,
    last_error_class: fb ? fb.kind : session.summary?.last_error_class ?? null,
    remaining_goals: fb?.remaining_goals ?? session.summary?.remaining_goals ?? null,
    frontier: frontier(session),
    changed: prev !== session.focused_goal,
  }
}

function classify(exit: number, stdout: string, stderr: string): EnvFeedback {
  const err = stderr.toLowerCase()
  if (exit === 0 && !err.includes("error")) {
    // Parse goal from output
    const goal = stdout.match(/\d+ (?:sub)?goals?\s*\n([\s\S]*?)(?:\n\n|$)/)?.[1]?.trim()
    const remaining = stdout.match(/(\d+) (?:sub)?goals?/)?.[1]
    return {
      kind: "proof_progress",
      summary: goal ? `Goal: ${goal.slice(0, 200)}` : "Tactic succeeded",
      new_goal: goal,
      remaining_goals: remaining ? parseInt(remaining) : undefined,
    }
  }
  if (err.includes("not found") || err.includes("unable to unify") || err.includes("no matching") || err.includes("cannot find")) {
    const missing = stderr.match(/(?:not found|cannot find)\s+(\S+)/i)?.[1]
    return {
      kind: "environment_problem",
      summary: stderr.split("\n").filter((l: string) => l.trim()).slice(0, 3).join(" | "),
      missing_symbol: missing,
    }
  }
  if (err.includes("syntax error") || err.includes("parse error") || err.includes("illegal")) {
    return {
      kind: "syntax_or_engine_problem",
      summary: stderr.split("\n").filter((l: string) => l.trim()).slice(0, 3).join(" | "),
    }
  }
  // Default: environment problem
  return {
    kind: "environment_problem",
    summary: stderr.split("\n").filter((l: string) => l.trim()).slice(0, 3).join(" | "),
  }
}

function buildScript(session: CoqSessionState, extra?: string): string {
  // Reconstruct from project preamble if available, else fall back to loaded_file
  const base = session.project?.preamble ?? session.loaded_file
  const parts = [base]
  // Replay tactic history for successful tactics
  for (const t of session.tactic_history) {
    if (t.result === "success") parts.push(t.tactic)
  }
  if (extra) parts.push(extra)
  return parts.join("\n")
}

/** Run coqtop using session's stored project context when available */
async function runSession(
  session: CoqSessionState,
  code: string,
  signal?: AbortSignal,
): Promise<{ exit: number; stdout: string; stderr: string }> {
  if (session.project) {
    return CoqProject.run(code, session.project.file, session.project.flags.length > 0 ? [] : undefined, { signal })
  }
  return CoqProject.run(code, undefined, undefined, { signal })
}

function theoremStartContext(content: string, theorem: string) {
  const lines = content.split("\n")
  let ctxEnd = lines.length
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].match(new RegExp(`(Theorem|Lemma|Proposition|Corollary)\\s+${theorem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`))) continue
    for (let cursor = index; cursor < lines.length; cursor++) {
      const trimmed = lines[cursor].trim()
      if (trimmed === "Proof." || trimmed.startsWith("Proof ") || trimmed === "Proof with") {
        ctxEnd = cursor + 1
        break
      }
      if (trimmed.endsWith(".") && cursor > index) {
        ctxEnd = cursor + 1
        break
      }
    }
    break
  }
  return { lines, ctxEnd, loaded: lines.slice(0, ctxEnd).join("\n") }
}

function offsetAt(content: string, position: { line: number; character: number }) {
  const lines = content.split("\n")
  if (position.line < 0 || position.line >= lines.length) return undefined
  if (position.character < 0 || position.character > lines[position.line].length) return undefined
  let offset = 0
  for (let index = 0; index < position.line; index++) offset += lines[index].length + 1
  return offset + position.character
}

function hypothesesFromGoal(goal: string) {
  const separator = goal.lastIndexOf("============================")
  if (separator < 0) return []
  return goal
    .slice(0, separator)
    .replace(/^\s*\d+\s+(?:sub)?goals?\s*/i, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

async function refreshAssignedRegionBase(sessionID: string, session: CoqSessionState) {
  if (!session.source_file || !session.project) return false
  const content = await ProofEditTransaction.readSource(sessionID, session.source_file)
  if (session.region_binding === "explicit") {
    if (!session.proof_position) {
      throw new Error("session_state_desync: explicit proof_region session has no proof_position")
    }
    const offset = offsetAt(content, session.proof_position)
    if (offset === undefined) {
      throw new Error(
        `session_state_desync: explicit proof_region ${session.region_admit_id ?? "unnamed"} proof_position is unavailable`,
      )
    }
    const prefix = content.slice(0, offset)
    const prefixFingerprint = fingerprint(prefix)
    let changed = false
    if (prefixFingerprint !== session.certified_prefix_fingerprint) {
      const loaded = session.open_context ? `${session.open_context}\n${prefix}` : prefix
      session.loaded_file = loaded
      session.project = await CoqProject.context(session.source_file, session.project.theorem, loaded)
      session.certified_prefix_fingerprint = prefixFingerprint
      changed = true
    }
    session.source_hash = fingerprint(content)
    return changed
  }
  if (!session.region_admit_id) return false
  const region = SessionProofWorkflow.assignedRegionSessionContext(
    sessionID,
    session.source_file,
    session.project.theorem,
    content,
    session.region_admit_id,
  )
  if (!region) throw new Error(`session_state_desync: active assignment for ${session.region_admit_id} is unavailable`)
  let changed = false
  if (region.certified_prefix_fingerprint !== session.certified_prefix_fingerprint) {
    const loaded = session.open_context ? `${session.open_context}\n${region.prefix}` : region.prefix
    session.loaded_file = loaded
    session.project = await CoqProject.context(session.source_file, session.project.theorem, loaded)
    session.certified_prefix_fingerprint = region.certified_prefix_fingerprint
    session.proof_position = region.proof_position
    changed = true
  }
  session.source_hash = region.source_hash
  session.expected_goal = region.expected_goal
  session.expected_goal_fingerprint = region.expected_goal_fingerprint
  return changed
}

async function synchronizeSession(sessionID: string, session: CoqSessionState, signal?: AbortSignal) {
  const expectedCurrent = session.semantic_goal_fingerprint
  for (let attempt = 1; attempt <= 2; attempt++) {
    let prefixChanged = false
    try {
      prefixChanged = await refreshAssignedRegionBase(sessionID, session)
    } catch (error) {
      session.last_error = error instanceof Error ? error.message : String(error)
      session.desync_count = attempt
      continue
    }
    const result = await runSession(session, buildScript(session, "Show."), signal)
    if (result.exit !== 0) {
      session.last_error = compactText([result.stdout, result.stderr].filter(Boolean).join("\n"), 1000)
      session.desync_count = attempt
      continue
    }
    const goal = CoqProject.cleanOutput(result.stdout)
    const identity = goalIdentity(goal)
    const currentMatches = expectedCurrent ? identity.semantic_fingerprint === expectedCurrent : true
    const entryMatches =
      session.tactic_history.filter((record) => record.result === "success").length > 0 ||
      !session.expected_goal ||
      expectedGoalMatches(identity, session.expected_goal, session.expected_goal_fingerprint)
    if (currentMatches && entryMatches) {
      session.focused_goal = goal
      session.local_hyps = hypothesesFromGoal(goal)
      session.goal_fingerprint = identity.strict_fingerprint
      session.semantic_goal_fingerprint = identity.semantic_fingerprint
      session.desync_count = 0
      session.last_error = null
      return { ok: true as const, resynced: prefixChanged || attempt > 1, identity }
    }
    session.last_error = [
      "session_state_desync:",
      `current_goal_match=${currentMatches}`,
      `current_expected=${expectedCurrent ?? "none"}`,
      `current_observed=${identity.semantic_fingerprint}`,
      `entry_goal_match=${entryMatches}`,
      `entry_expected=${session.expected_goal_fingerprint ?? "none"}`,
      `entry_observed_semantic=${identity.semantic_fingerprint}`,
      `entry_observed_conclusion=${identity.conclusion_fingerprint}`,
    ].join(" ")
    session.desync_count = attempt
  }
  return { ok: false as const }
}

export const CoqSessionTool = Tool.define("coq_session", {
  description: DESCRIPTION,
  parameters: z.object({
    op: z.enum(["open", "step", "goal", "inspect", "snapshot", "undo", "close", "status"]).describe("Session operation"),
    file: z.string().optional().describe("Path to .v file containing the theorem (for open)"),
    theorem: z.string().optional().describe("Theorem name to prove (for open)"),
    tactic: z.string().optional().describe("Single tactic to apply (for step)"),
    snapshot_id: z.string().optional().describe("Snapshot ID to rollback to (for undo)"),
    context: z.string().optional().describe("Additional Coq context to load before the theorem (for open)"),
    scope: z.enum(["theorem", "assigned_region"]).optional().describe("Open at theorem start or at the active assigned proof_region"),
    admit_id: z.string().optional().describe("Assigned proof_region identifier for a region-scoped open"),
    proof_position: z
      .object({ line: z.number().int().nonnegative(), character: z.number().int().nonnegative() })
      .optional()
      .describe("Explicit 0-based proof entry position for a region-scoped open"),
    expected_goal: z.string().optional().describe("Expected proof-region entry goal used for desynchronization checks"),
    expected_goal_fingerprint: z.string().optional().describe("Normalized expected goal fingerprint"),
    symbols: z
      .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_']*(?:\.[A-Za-z_][A-Za-z0-9_']*)*$/))
      .max(8)
      .optional()
      .describe("Small list of qualified symbols to Check during a read-only context inspection"),
    left_expression: z.string().max(1000).optional().describe("Left Coq expression for inspect convertibility"),
    right_expression: z.string().max(1000).optional().describe("Right Coq expression for inspect convertibility"),
  }),
  async execute(params, ctx): Promise<{ title: string; output: string; metadata: Record<string, any> }> {
    await ctx.ask({
      permission: "coq_session",
      patterns: ["*"],
      always: ["*"],
      metadata: { op: params.op },
    })

    const key = ctx.sessionID

    switch (params.op) {
      case "open": {
        if (!params.file) throw new Error("open requires file path")
        if (!params.theorem) throw new Error("open requires theorem name")

        let filepath = params.file
        if (!path.isAbsolute(filepath)) filepath = path.resolve(Instance.directory, filepath)
        ProofEditTransaction.assertStagedReadSynchronized(ctx.sessionID, filepath, "opening a Coq session")
        const content = await ProofEditTransaction.readSource(ctx.sessionID, filepath)
        const theoremContext = theoremStartContext(content, params.theorem)
        const liveLemmaAssignment = SessionProofWorkflow.activeLemmaAssignment(ctx.sessionID)
        if (ctx.agent === "lemma" && liveLemmaAssignment && params.scope === "theorem") {
          throw new Error(
            `session_state_desync: lemma worker ${ctx.sessionID} is assigned to proof_region ${liveLemmaAssignment.admit_id}; theorem-scope open is not permitted`,
          )
        }
        const assignedRegion = params.scope === "theorem"
          ? undefined
          : SessionProofWorkflow.assignedRegionSessionContext(
              ctx.sessionID,
              filepath,
              params.theorem,
              content,
              params.admit_id,
            )
        const explicitOffset = params.proof_position ? offsetAt(content, params.proof_position) : undefined
        if (params.scope === "assigned_region" && !assignedRegion && explicitOffset === undefined) {
          throw new Error("assigned_region open requires a live lemma assignment or an explicit proof_position")
        }
        const proofPosition = assignedRegion?.proof_position ?? params.proof_position
        const loaded = assignedRegion?.prefix ??
          (explicitOffset !== undefined ? content.slice(0, explicitOffset) : theoremContext.loaded)
        const extra = params.context ? params.context + "\n" + loaded : loaded
        const expectedGoal = params.expected_goal ?? assignedRegion?.expected_goal
        const expectedGoalFingerprint = params.expected_goal_fingerprint ?? assignedRegion?.expected_goal_fingerprint ??
          (expectedGoal ? fingerprint(normalizedGoalText(expectedGoal)) : undefined)
        const regionAdmitID = assignedRegion?.assignment.admit_id ?? params.admit_id
        const regionScoped = Boolean(assignedRegion || explicitOffset !== undefined || params.scope === "assigned_region")
        const regionBinding = assignedRegion ? "assigned" : regionScoped ? "explicit" : undefined
        const ctxEnd = proofPosition ? proofPosition.line + 1 : theoremContext.ctxEnd
        const lines = theoremContext.lines

        // Detect enclosing Section and its Variable/Hypothesis/Context declarations
        const vars: string[] = []
        let depth = 0
        let section: string | null = null
        for (let i = 0; i < ctxEnd; i++) {
          const trimmed = lines[i].trim()
          const open = trimmed.match(/^Section\s+(\w+)\s*\./)
          if (open) {
            depth++
            section = open[1]
          }
          if (trimmed.match(/^End\s+\w+\s*\./)) depth--
          if (depth > 0 && trimmed.match(/^(Variable|Variables|Hypothesis|Hypotheses|Context)\b/)) {
            vars.push(trimmed)
          }
        }

        // Resolve and persist project context
        const proj = await CoqProject.context(filepath, params.theorem, extra)

        // Run initial query to get the goal
        const result = await CoqProject.run(extra + "\nShow.", filepath, undefined, { signal: ctx.abort })
        const goal = CoqProject.cleanOutput(result.stdout)
        const hyps = hypothesesFromGoal(goal)
        const identity = goalIdentity(goal)
        const entryMatches =
          result.exit === 0 && (!expectedGoal || expectedGoalMatches(identity, expectedGoal, expectedGoalFingerprint))
        const desyncCount = entryMatches ? 0 : 2

        const sid = "sess_" + randomBytes(4).toString("hex")
        const initial: SessionSummary = {
          last_success: null,
          last_failure: null,
          last_error_class: null,
          remaining_goals: null,
          frontier: `Goal: ${goal.slice(0, 300)}`,
          changed: false,
        }
        const session: CoqSessionState = {
          session_id: sid,
          loaded_file: extra,
          focused_goal: goal,
          local_hyps: hyps,
          tactic_history: [],
          snapshots: {
            initial: {
              id: "initial",
              goal,
              hyps,
              tactic_index: 0,
              context: extra,
              goal_fingerprint: identity.strict_fingerprint,
              semantic_goal_fingerprint: identity.semantic_fingerprint,
              summary: initial,
            },
          },
          last_error: null,
          warning_summary: [],
          project: proj,
          source_file: filepath,
          open_context: params.context,
          source_hash: assignedRegion?.source_hash ?? fingerprint(content),
          certified_prefix_fingerprint: assignedRegion?.certified_prefix_fingerprint ?? fingerprint(loaded),
          region_admit_id: regionAdmitID,
          region_binding: regionBinding,
          proof_position: proofPosition,
          goal_fingerprint: identity.strict_fingerprint,
          semantic_goal_fingerprint: identity.semantic_fingerprint,
          expected_goal: expectedGoal,
          expected_goal_fingerprint: expectedGoalFingerprint,
          desync_count: desyncCount,
          summary: initial,
        }
        sessions.set(key, session)

        // Build section context hint for the agent
        let hint = ""
        if (vars.length > 0) {
          hint = `\n\n[Section context: ${section ?? "anonymous"}]\n`
            + `Section variables (will become forall when Section closes):\n`
            + vars.map((v) => `  ${v}`).join("\n")
            + `\nNOTE: Lemmas proved in this Section will have these as forall-quantified args outside the Section. Use apply/eapply/specialize to instantiate them — do NOT use strong induction to re-derive.`
        }

        return {
          title: entryMatches
            ? `Session opened for ${params.theorem}${regionAdmitID ? `:${regionAdmitID}` : ""}`
            : `session_state_desync: ${params.theorem}${regionAdmitID ? `:${regionAdmitID}` : ""}`,
          output: entryMatches
            ? `Session ${sid}\nScope: ${regionScoped ? `proof_region ${regionAdmitID ?? "explicit"}` : "theorem start"}\nGoal fingerprint: ${identity.semantic_fingerprint}\nGoal:\n${goal}\nHypotheses: ${hyps.length > 0 ? hyps.join(", ") : "(none detected)"}${hint}`
            : `session_state_desync\nexpected_goal_fingerprint: ${expectedGoalFingerprint ?? "unknown"}\nactual_goal_fingerprint: ${identity.conclusion_fingerprint}\nactual_remaining_goals: ${identity.remaining_goals ?? "unknown"}\nThe session was opened but tactics are blocked until automatic resynchronization succeeds.`,
          metadata: {
            op: "open",
            session_id: sid,
            section_vars: vars,
            scope: regionScoped ? "assigned_region" : "theorem",
            region_binding: regionBinding,
            admit_id: regionAdmitID,
            goal_fingerprint: identity.semantic_fingerprint,
            expected_goal_fingerprint: expectedGoalFingerprint,
            kind: entryMatches ? "proof_progress" : "session_state_desync",
          },
        }
      }

      case "step": {
        const session = sessions.get(key)
        if (!session) throw new Error("No session open. Use open first.")
        if (!params.tactic) throw new Error("step requires a tactic")
        assertNoRewriteBang(params.tactic, "coq_session step tactic")
        assertNoIntuition(params.tactic, "coq_session step tactic")

        // Enforce single-tactic rule: reject if > 3 sentences
        const count = params.tactic.split(".").filter((s) => s.trim()).length
        if (count > 3) throw new Error("step() accepts at most 3 tactic sentences. Break into smaller steps.")

        const synchronized = await synchronizeSession(key, session, ctx.abort)
        if (!synchronized.ok) {
          return {
            title: "session_state_desync",
            output: [
              "session_state_desync",
              `admit_id: ${session.region_admit_id ?? "theorem"}`,
              `expected_goal_fingerprint: ${session.semantic_goal_fingerprint ?? session.expected_goal_fingerprint ?? "unknown"}`,
              `desync_count: ${session.desync_count}`,
              session.last_error ? `reason: ${session.last_error}` : undefined,
              "The tactic was not submitted. Reopen the assigned region after checking the certified prefix and assignment goal.",
            ].filter((line): line is string => Boolean(line)).join("\n"),
            metadata: {
              op: "step",
              session_id: session.session_id,
              kind: "session_state_desync",
              admit_id: session.region_admit_id,
              desync_count: session.desync_count,
              tactic_applied: false,
            },
          }
        }

        const prev = session.focused_goal

        // Build script with current history + new tactic + Show.
        const script = buildScript(session, params.tactic + "\nShow.")
        const result = await runSession(session, script, ctx.abort)
        const fb = classify(result.exit, result.stdout, result.stderr)

        const record: TacticRecord = {
          tactic: params.tactic,
          result: fb.kind === "proof_progress" ? "success" : "failure",
          feedback: fb,
          time: new Date().toISOString(),
        }
        session.tactic_history.push(record)

        const cleaned = CoqProject.cleanOutput(result.stdout)
        if (fb.kind === "proof_progress") {
          session.focused_goal = cleaned || fb.new_goal || "No goals"
          const identity = goalIdentity(session.focused_goal)
          session.local_hyps = hypothesesFromGoal(session.focused_goal)
          session.goal_fingerprint = identity.strict_fingerprint
          session.semantic_goal_fingerprint = identity.semantic_fingerprint
          session.desync_count = 0
        } else {
          session.last_error = fb.summary
        }

        // Update session summary
        session.summary = summarize(session, fb, prev)

        return {
          title: `step: ${params.tactic.slice(0, 40)}... [${fb.kind}]`,
          output: `[${fb.kind}] ${fb.summary}\n\nGoal: ${session.focused_goal.slice(0, 500)}${
            fb.kind === "proof_progress" ? "" : formatCoqSkillHints(`${fb.summary}\n${session.focused_goal}`)
          }`,
          metadata: {
            op: "step" as string,
            session_id: session.session_id,
            kind: fb.kind,
            resynced: synchronized.resynced,
            goal_fingerprint: session.semantic_goal_fingerprint,
            admit_id: session.region_admit_id,
          },
        }
      }

      case "goal": {
        const session = sessions.get(key)
        if (!session) throw new Error("No session open. Use open first.")

        const prev = session.focused_goal
        const synchronized = await synchronizeSession(key, session, ctx.abort)
        if (!synchronized.ok) {
          return {
            title: "session_state_desync",
            output: `session_state_desync\nadmit_id: ${session.region_admit_id ?? "theorem"}\ndesync_count: ${session.desync_count}${session.last_error ? `\nreason: ${session.last_error}` : ""}`,
            metadata: {
              op: "goal",
              session_id: session.session_id,
              kind: "session_state_desync",
              admit_id: session.region_admit_id,
            },
          }
        }
        const cleaned = session.focused_goal
        const remaining = synchronized.identity.remaining_goals

        // Update summary
        session.summary = summarize(session, undefined, prev)

        return {
          title: "Current goal",
          output: `Goal fingerprint: ${session.semantic_goal_fingerprint}\nGoal:\n${cleaned}\nHypotheses: ${session.local_hyps.join(", ") || "(none)"}\nRemaining: ${remaining ?? "unknown"}`,
          metadata: {
            op: "goal" as string,
            session_id: session.session_id,
            kind: "proof_progress",
            goal_fingerprint: session.semantic_goal_fingerprint,
            admit_id: session.region_admit_id,
            resynced: synchronized.resynced,
          },
        }
      }

      case "inspect": {
        const session = sessions.get(key)
        if (!session) throw new Error("No session open. Use open first.")
        if (!params.left_expression || !params.right_expression) {
          throw new Error("inspect requires left_expression and right_expression")
        }
        assertAuditExpression("left_expression", params.left_expression)
        assertAuditExpression("right_expression", params.right_expression)
        const synchronized = await synchronizeSession(key, session, ctx.abort)
        if (!synchronized.ok) {
          return {
            title: "session_state_desync",
            output: "session_state_desync: context inspection was not run because the live goal could not be resynchronized",
            metadata: { op: "inspect", session_id: session.session_id, kind: "session_state_desync" },
          }
        }

        const symbols = params.symbols ?? []
        const auditID = "audit_" + randomBytes(6).toString("hex")
        const assertion = `__prosabuddy_context_audit_${auditID.slice(-8)}`
        const commands = [
          ...symbols.map((symbol) => `Check ${symbol}.`),
          `assert (${assertion} : (${params.left_expression}) = (${params.right_expression})) by reflexivity.`,
          `clear ${assertion}.`,
          "Show.",
        ]
        const result = await runSession(session, buildScript(session, commands.join("\n")), ctx.abort)
        const diagnostic = compactText([result.stdout, result.stderr].filter(Boolean).join("\n"), 1000)
        const audit = recordContextAudit(key, {
          audit_id: auditID,
          outcome: auditOutcome(result.exit, diagnostic),
          inspected_symbols: symbols,
          left_expression: params.left_expression,
          right_expression: params.right_expression,
          left_summary: compactText(params.left_expression),
          right_summary: compactText(params.right_expression),
          goal_fingerprint: session.semantic_goal_fingerprint ?? fingerprint(session.focused_goal),
          hypotheses_fingerprint: fingerprint(session.local_hyps.join("\n")),
          diagnostic: diagnostic || undefined,
          verified: true,
        })

        return {
          title: `Context audit: ${audit.outcome}`,
          output: [
            `audit_id: ${audit.audit_id}`,
            `outcome: ${audit.outcome}`,
            `left: ${audit.left_summary}`,
            `right: ${audit.right_summary}`,
            symbols.length > 0 ? `symbols: ${symbols.join(", ")}` : undefined,
            audit.diagnostic ? `diagnostic: ${audit.diagnostic}` : undefined,
            "next_action: treat this as diagnostic evidence only; convertible favors a local bridge, not proof completion, while inconclusive does not forbid structured escalation after one targeted retry",
          ]
            .filter((line): line is string => Boolean(line))
            .join("\n"),
          metadata: { op: "inspect", session_id: session.session_id, context_audit: audit },
        }
      }

      case "snapshot": {
        const session = sessions.get(key)
        if (!session) throw new Error("No session open. Use open first.")

        const id = rid()
        session.snapshots[id] = {
          id,
          goal: session.focused_goal,
          hyps: [...session.local_hyps],
          tactic_index: session.tactic_history.length,
          context: buildScript(session),
          goal_fingerprint: session.goal_fingerprint,
          semantic_goal_fingerprint: session.semantic_goal_fingerprint,
          summary: session.summary ? { ...session.summary } : undefined,
        }

        return {
          title: `Snapshot created: ${id}`,
          output: `Snapshot ${id} at tactic index ${session.tactic_history.length}\nGoal: ${session.focused_goal.slice(0, 200)}`,
          metadata: { op: "snapshot" as string, session_id: session.session_id },
        }
      }

      case "undo": {
        const session = sessions.get(key)
        if (!session) throw new Error("No session open. Use open first.")
        if (!params.snapshot_id) throw new Error("undo requires snapshot_id")

        const snap = session.snapshots[params.snapshot_id]
        if (!snap) throw new Error(`Snapshot not found: ${params.snapshot_id}. Available: ${Object.keys(session.snapshots).join(", ")}`)

        // Rollback: truncate tactic history to snapshot point
        session.tactic_history = session.tactic_history.slice(0, snap.tactic_index)
        session.focused_goal = snap.goal
        session.local_hyps = [...snap.hyps]
        session.goal_fingerprint = snap.goal_fingerprint ?? goalIdentity(snap.goal).strict_fingerprint
        session.semantic_goal_fingerprint =
          snap.semantic_goal_fingerprint ?? goalIdentity(snap.goal).semantic_fingerprint
        session.desync_count = 0
        session.last_error = null
        // Restore summary from snapshot or reset
        session.summary = snap.summary ? { ...snap.summary } : session.summary

        return {
          title: `Rolled back to snapshot ${params.snapshot_id}`,
          output: `Restored to tactic index ${snap.tactic_index}\nGoal: ${snap.goal.slice(0, 200)}`,
          metadata: { op: "undo" as string, session_id: session.session_id },
        }
      }

      case "close": {
        const session = sessions.get(key)
        if (!session) throw new Error("No session open. Use open first.")

        const successes = session.tactic_history.filter((t) => t.result === "success").length
        const failures = session.tactic_history.filter((t) => t.result === "failure").length
        const summary = `Session ${session.session_id} closed. ${successes} successful, ${failures} failed tactics. ${Object.keys(session.snapshots).length} snapshots.`

        sessions.delete(key)

        return {
          title: "Session closed",
          output: summary,
          metadata: { op: "close", session_id: session.session_id },
        }
      }

      case "status": {
        const session = sessions.get(key)
        if (!session) throw new Error("No session open. Use open first.")

        const lines = [
          `Session: ${session.session_id}`,
          `Scope: ${session.region_admit_id ? `proof_region ${session.region_admit_id}` : "theorem"}`,
          `Goal fingerprint: ${session.semantic_goal_fingerprint ?? "unknown"}`,
          `Desync count: ${session.desync_count}`,
          `Goal: ${session.focused_goal.slice(0, 300)}`,
          `Hypotheses: ${session.local_hyps.join(", ") || "(none)"}`,
          `Tactics: ${session.tactic_history.length} (${session.tactic_history.filter((t) => t.result === "success").length} ok, ${session.tactic_history.filter((t) => t.result === "failure").length} fail)`,
          `Snapshots: ${Object.keys(session.snapshots).join(", ")}`,
          session.last_error ? `Last error: ${session.last_error}` : "",
        ].filter(Boolean)

        return {
          title: "Session status",
          output: lines.join("\n"),
          metadata: { op: "status", session_id: session.session_id },
        }
      }

      default:
        throw new Error(`Unknown operation: ${params.op}`)
    }
  },
})
