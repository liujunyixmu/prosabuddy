import { ProofContext, type ProofSnapshot } from "./proof-context"
import { Instance } from "../project/instance"
import { SessionProof } from "./session-proof"
import { SessionProofWorkflow } from "./proof-workflow"
import { Filesystem } from "../util/filesystem"
import type { LemmaAssignment } from "./lemma-assignment"
import path from "path"

/**
 * Per-agent proof context projection.
 *
 * Each agent type sees a different view of the proof state:
 * - prover: full live proof snapshot
 * - fixer:  error-focused (errors + minimal goal)
 * - lemma:  assigned local goal + hypotheses (what to prove)
 * - whole-lemma: direct target theorem goal + hypotheses
 * - explorer: local search context
 * - others: nothing
 */
export namespace ProofProjection {
  export interface Options {
    faithful?: boolean
    runtimeOnly?: boolean
  }

  export interface Result {
    lines: string[]
    snap?: ProofSnapshot
  }

  interface StagedLemmaContext {
    assignment: LemmaAssignment
    file: string
    position: { line: number; character: number }
  }

  async function stagedLemmaContext(agent: string, sessionID: string): Promise<StagedLemmaContext | undefined> {
    if (agent !== "lemma") return undefined
    const assignment = SessionProofWorkflow.activeLemmaAssignment(sessionID)
    const binding = SessionProof.get(sessionID)
    if (!assignment || !binding?.canonicalSource) return undefined

    const physicalSource = await Filesystem.readText(binding.file).catch(() => undefined)
    if (physicalSource === binding.canonicalSource) return undefined

    return {
      assignment,
      file: binding.file,
      position: { line: binding.line, character: binding.character },
    }
  }

  export async function project(agent: string, sessionID: string, opts?: Options): Promise<Result> {
    // Lemma transactions can be ahead of the physical workspace file. In that
    // state, asking rocq-lsp for the transaction's line number queries an older
    // source revision and can silently return a later sibling goal. Prefer the
    // assignment contract until the staged source is committed; region-scoped
    // coq_session remains the source of exact intermediate tactic state.
    const stagedLemma = await stagedLemmaContext(agent, sessionID)
    const snap = stagedLemma ? undefined : await ProofContext.ensureFromBinding(sessionID)
    if (opts?.runtimeOnly) return { lines: runtime(agent, snap, opts, stagedLemma), snap }
    if (agent === "prover") return { lines: prover(snap, opts), snap }
    if (agent === "fixer") return { lines: fixer(snap), snap }
    if (agent === "lemma") return { lines: lemma(snap, opts, stagedLemma), snap }
    if (agent === "whole-lemma") return { lines: wholeLemma(snap, opts), snap }
    if (agent === "explorer") return { lines: explorer(snap), snap }
    if (agent === "diagnoser") return { lines: diagnoser(snap), snap }
    return { lines: [] }
  }

  function runtime(agent: string, snap?: ProofSnapshot, opts?: Options, stagedLemma?: StagedLemmaContext) {
    const lines: string[] = []
    lines.push(...(stagedLemma ? stagedLemmaReminder(stagedLemma) : live(snap)))
    if (opts?.faithful && (agent === "prover" || agent === "lemma")) {
      lines.push(...faithful(agent))
    }
    return lines
  }

  function stagedLemmaReminder(context: StagedLemmaContext) {
    const rel = path.relative(Instance.worktree, context.file)
    const inputs = context.assignment.obligation?.input ?? []
    return [
      "<proof-context-lemma-assignment>",
      "Authoritative context: staged proof transaction; the physical workspace is an older revision.",
      `File: ${rel}  Assigned position: ${context.position.line + 1}:${context.position.character + 1}`,
      `Proof region: ${context.assignment.admit_id}`,
      inputs.length > 0 ? `Available inputs: ${inputs.join(", ")}` : undefined,
      "",
      "Assigned goal:",
      context.assignment.goal,
      "",
      "The rocq-lsp snapshot is intentionally suppressed because it would be computed from the older physical file and may name a sibling goal. Use the assigned goal as the entry contract and region-scoped `coq_session` for exact intermediate goals.",
      "</proof-context-lemma-assignment>",
    ].filter((line): line is string => line !== undefined)
  }

  function prover(snap?: ProofSnapshot, opts?: { faithful?: boolean }) {
    const lines: string[] = []
    lines.push(...live(snap))

    lines.push(
      "<proof-role-prover>",
      "You are Layer 1, the theorem-level proof architect for this theorem.",
      "Use the live proof state above as the canonical current context.",
      "",
      "Workflow:",
      "1. Phase 1 first: build an evidence-grounded theorem-level skeleton using annotated pose/have structure. Follow the paper order when it is concrete and compatible with the formal goal; otherwise state the mismatch and use a context-derived route.",
      "2. If `proof.tex` exists for this theorem, read it first and treat it as primary evidence, not an unconditional authority. Downgrade vague, incomplete, premise-mismatched, or formally incompatible steps using the theorem statement, live goal, exact interfaces, and compiler evidence.",
      "3. Before the first theorem-skeleton edit, use `proof_plan` to review a structured DAG with meaningful delegation candidates, claim deltas, transformations, dependencies, and parent consumers; skip this only when a usable skeleton already exists.",
      "3a. Resolve proof-plan hard errors with at most four materially distinct semantic DAG revisions after the initial plan. Deterministic identifier, edge, and anchor corrections are metadata repair and do not consume this semantic budget. Warnings are advisory and must not create a metadata-repair loop; materialize a connected dependency-closed slice and report residual risk.",
      "3b. An accepted proof plan is session-persisted and locked during normal materialization. Replace it only when the workflow exposes its single compiler/remodel-evidence-backed accepted-plan repair; administrative drift or wording changes are not reasons to replan.",
      "4. Represent paper-relevant objects, sets, abbreviations, notations, and expressions as `pose` or `set`. Represent paper-relevant claims, cases, rewrites, bounds, contradictions, and derived consequences as `have` or `assert`.",
      "5. If one proposed region crosses independent semantic claims or dependency boundaries, split it at a useful intermediate Coq proposition; do not split merely because one coherent fact needs several local proof steps.",
      "5a. Prefer roughly 3-6 meaningful first-level regions, commonly 4-5, as a soft planning prior rather than a validation rule. Each region should export one useful fact with complete dependencies and a plausible local certificate boundary.",
      "5b. A proof_region with kind=paper_bridge, layer=paper, or layer=theorem_spine is not lemma-ready; refine it in Layer 1 into smaller semantic_bridge, count_cardinality, shape_transport, definition_rewrite, library_instantiation, or final_arithmetic leaves before delegation.",
      "5c. Use the generic route recipe only as a soft prior: necessary context preparation, semantic or pointwise bridge, library-facing shape normalization, aggregation or composition, and final closure. Reorder, merge, replace, or abandon these layers when live goals and compiler evidence support a better route.",
      "6. If a high-level equality, inequality, case branch, or final bridge summarizes several proof sentences, open its proof body and introduce nested local pose/have steps for those sentences before any admit.",
      "7. Parent claims and case branches must close by combining their nested child facts; do not prove a compound parent claim with one direct admit.",
      "8. Do not create a theorem-shaped or parent-shaped `have`/`assert` and admit it; prove current-goal, near-final, and parent-combination facts in Layer 1 from the generated skeleton.",
      "9. Thread concrete witnesses, partitions, complements, branch conditions, and theorem hypotheses through the following proof steps instead of replacing the flow with detached helper claims.",
      "10. For every new theorem-level pose/have, add a concise comment tying it to a concrete paper step when applicable or marking it context-derived, and explain its role in the proof DAG.",
      "11. Mark purely Coq-specific support explicitly as Coq technical support rather than a main paper step.",
      "12. Push the outer theorem architecture until the final theorem goal is closed by the generated skeleton facts and only meaningful dependency-complete local regions remain unfinished, ideally reaching the equivalent of `No more goals, but there are some goals you gave up`.",
      "13. Complete one bounded evidence pass and the structured proof-plan review before the first skeleton edit; after that checkpoint, write the accepted DAG promptly instead of continuing broad search.",
      "14. Materialize the connected plan in one coherent pass, then use incremental Coq feedback. Do not repeatedly rewrite marker metadata or comments to simulate semantic progress.",
      "15. Do not take two consecutive broad read or search batches while the file is unchanged.",
      "16. Do not conclude that the theorem is false or that the file is wrong from a partial proof snapshot. First verify the exact theorem statement, local hypotheses, Section or Context declarations, imports, and the live Coq goal for completeness.",
      "17. Before delegation, if the proof still looks blocked after that audit, treat it as theorem-level bridge construction: inspect directly relevant facts, instantiate candidates against the live context, and write the smallest theorem-level bridge node you can validate.",
      "18. If a first-level local gap is isolated and ready for delegated local proof, write it as its own `proof_region begin/end` unit with one stable `admit_id`. The region must wrap the exported local target statement, including its proposition, and its complete `{ ... }` proof block; do not put the markers only inside that proof block. The region may contain proof text, same-region comments, and same-region helper pose/have/assert statements before the exported target, but the exported target statement is the prover-authored subgoal contract and should be preserved whenever possible. Keep architecture-sensitive parent composition, cross-branch ownership, and missing theorem-level premises in Layer 1, while allowing one coherent locally certifiable fact to retain its internal helper chain. A context bridge must be derived from existing hypotheses; it must not add new assumptions.",
      "18a. Include owner, admit_id, theorem, kind, target, plan_node, depends_on, source, input, output, layer, expected, normal_form, and grounded `prosa:`, `mathcomp:`, `local:`, `context:`, `coq:`, or `compiler:` evidence in the begin marker or in the immediately preceding contract comment. Place `proof_region begin` immediately before the exported target statement and place `proof_region end` immediately after the exported target proof block and any same-region helpers needed to prove it; parent composition and theorem terminators stay outside the region.",
      "19. Once first-level `proof_region owner: lemma` markers exist, do not continue proving inside those regions in the prover session; the runtime scheduler mechanically enqueues one dependency-ready lemma-owned region with a complete `lemma_assignment`. Declared proof-region producers must be compiler-certified; file order only breaks ties among ready regions.",
      "20. In normal Phase 2 discharge, the theorem-level skeleton is frozen; proof difficulty, long local search, or brittle tactics are not reasons to remodel it. If a lemma escalates structurally, review concrete evidence such as the stable blocked goal, missing premise, remodel_request, or attempt_report before deciding whether the proof_region target, outer theorem spine, or a theorem-level bridge must change; do not grind or redispatch the same stale local admit_id unless the evidenced blocker has been repaired or the region has been remodeled.",
      "21. Merge accepted lemma results back into the frozen skeleton and do final validation here. After all regions are solved, the prover owns any theorem-level `Admitted.` -> `Qed.` conversion.",
      "",
      "Rules:",
      "- ALL theorem-level proof architecture and first-level gap identification stay here.",
      "- Phase 1 skeleton generation takes priority over local lemma grinding.",
      "- Admits belong only inside meaningful single-output, dependency-complete local regions; parent claims and the final theorem must be connected by explicit composition steps.",
      "- Never close the theorem by asserting a theorem-shaped near-final fact and exacting it; derive the final goal from smaller skeleton facts.",
      "- Parent combination work stays in Layer 1; only smaller child facts inside that flow can become lemma-owned regions.",
      "- A branch is a container, not a first-level lemma block, when it contains multiple paper sentences or bridge facts.",
      "- Use lemma-ready `proof_region owner: lemma` units only for already-isolated first-level local gaps.",
      "- Do not invent lemma-ready blocks before an evidence-grounded skeleton for that stretch is clear.",
      "- After the file contains explicit first-level `proof_region owner: lemma` markers, prover owns only the locality decision and any later outer-spine repair; runtime scheduling owns serial lemma task enqueueing.",
      "- After delegation, Layer 1 does not prove inside lemma-owned regions; it only revises outer structure when a region was not actually local.",
      "- Do not add new section-level, theorem-level, or global assumptions outside the proof.",
      "- Once a frozen first-level gap is delegated, do not keep leaf-splitting that same gap here.",
      "- Keep first-level proof_region boundaries stable while delegating, merging, and validating.",
      "- Layer 2 owns recursive decomposition only inside the assigned local gap and current lemma session; it must not launch child lemma subagents.",
      "- Lower layers may not rewrite the outer theorem spine after it is frozen.",
      "- Merge authority and final validation stay here.",
      "- Write all proven code to .v files immediately. Do NOT keep proofs only in conversation.",
      "</proof-role-prover>",
    )

    if (opts?.faithful) {
      lines.push(...faithful("prover"))
    }

    return lines
  }

  function fixer(snap?: ProofSnapshot) {
    const lines: string[] = []
    if (!snap) return lines

    const rel = path.relative(Instance.worktree, snap.file)
    lines.push("<proof-context-fixer>")
    lines.push(`File: ${rel}  Position: ${snap.position.line + 1}:${snap.position.character + 1}`)

    if (snap.goal) {
      lines.push("", "Current goal:", snap.goal)
    }

    if (snap.errors.length > 0) {
      lines.push("", "Errors to fix:")
      for (const e of snap.errors) {
        lines.push(`  [${e.line}:${e.col}] ${e.message}`)
      }
    }

    lines.push(
      "",
      "Layer 3 scope:",
      "- Fix one local issue only.",
      "- Preserve the surrounding pose/have skeleton and its paper- or context-grounded comments unless the local diagnostic proves one comment inaccurate.",
      "- Do not redesign the proof or change the outer skeleton.",
      "- Do not decide whether a gap should split or recurse.",
      "- If the fix requires a new proof plan, cross-branch coordination, or wider refactoring, escalate.",
    )

    if (!snap.fresh) lines.push("", "(snapshot may be stale)")
    lines.push("</proof-context-fixer>")

    return lines
  }

  function lemma(snap?: ProofSnapshot, opts?: { faithful?: boolean }, stagedLemma?: StagedLemmaContext) {
    const lines: string[] = []
    if (!snap && !stagedLemma) return lines

    if (stagedLemma) {
      lines.push(...stagedLemmaReminder(stagedLemma))
    } else if (snap) {
      const rel = path.relative(Instance.worktree, snap.file)
      lines.push("<proof-context-lemma>")
      lines.push(`File: ${rel}  Position: ${snap.position.line + 1}:${snap.position.character + 1}`)

      if (snap.hyps.length > 0) {
        lines.push("", "Hypotheses:")
        for (const h of snap.hyps) lines.push(`  ${h}`)
        lines.push("========================")
      }

      lines.push("", "Goal:")
      lines.push(snap.goal ?? "(no goal)")

      if (snap.errors.length > 0) {
        lines.push("", "Relevant errors:")
        for (const e of snap.errors) {
          lines.push(`  [${e.line}:${e.col}] ${e.message}`)
        }
      }
    }

    lines.push(
      "",
      "Layer 2 scope:",
      "- Own exactly one assigned frozen local gap, subtheorem, or child gap.",
      "- If the caller names an admit ID or replacement contract, treat the admit ID as identifying the assigned proof_region; replace or update exactly that proof_region and no sibling region.",
      "- Preserve the surrounding outer skeleton and its pose/have structure.",
      "- Treat this as a long-running interactive proof session. Spending dozens or hundreds of focused proof steps is expected for a large local gap.",
      "- First produce a concrete informal proof for the assigned gap.",
      "- Treat that informal proof as the controlling local proof plan for the rest of the session.",
      "- Once that informal proof is concrete enough, stop planning and write the first faithful local proof text or minimal local skeleton immediately.",
      "- After the informal proof, open and use `coq_session` or `petanque` for atomic tactics, goal queries, snapshots, and rollback whenever possible.",
      "- Use `lsp proofGoals` and edit/write LSP diagnostics as first-class proof feedback; use `coqc` at coherent milestones and before returning.",
      "- Use `coqtop`/`grep`/broad reads only for a blocker exposed by the current goal or failed step, and immediately feed the result into an edit, proof-session step, or rollback decision.",
      "- Do not use ssreflect repeat-rewrite syntax `rewrite !...` or `rewrite -!...`; write repeated rewrites explicitly one step at a time, or introduce a named normalization/bridge lemma.",
      "- Do not use the `intuition` tactic; it generates opaque proof terms and is rejected. Use explicit tactics (`left`/`right`/`split`/`apply`/`exact`) instead.",
      "- If a compressed `by`, rewrite, bullet, bigop, or arithmetic line fails, expand and diagnose the first failing line before doing more library search.",
      "- Do not declare the local goal false or the enclosing file wrong from a partial local snapshot. First verify the exact goal, inherited hypotheses, surrounding Section or Context declarations, and imported facts visible in the file.",
      "- If a speculative edit breaks the file, preserve every validated fragment and isolate only the unvalidated failing tail before searching broadly. Prefer commenting out the failing tail or moving it to a scratch summary; restore the whole owned region to the admitted skeleton only when no validated fragment remains.",
      "- If the proof remains blocked after that audit, treat the blocker as bridge work first: mine and instantiate the directly relevant imported or Prosa facts, write the smallest local bridge skeleton you can validate, and continue the interactive loop before escalating.",
      "- If this is an editable proof_region assignment, the region should include the exported target statement and its proof block. You may write proof text and add sibling helper pose/have/assert statements inside the region before the exported target, but preserve the exported target statement whenever possible; do not edit text outside the region.",
      "- Do not skip ahead to later sibling proof_regions. The assigned admit_id remains the only local proof target until it is solved, split for the same session, or escalated with evidence.",
      "- Do not edit theorem-level terminators such as `Admitted.` or `Qed.`; final theorem closure belongs to the prover after every lemma-owned region is solved.",
      "- If the exported target is misshaped, escalate with needs_subgoal_remodel and a concrete remodel_request instead of rewriting the theorem spine yourself.",
      "- If the informal proof already supports a direct proof, prove directly from it; if it exposes smaller local subclaims, write that local annotated pose/have skeleton immediately inside the assigned gap.",
      "- This lemma session has no artificial step cap; if runtime compaction occurs, continue from the preserved checkpoint and stay focused on finishing the currently assigned local gap.",
      "- The correct deliverable is the proof text for the complete updated assigned proof_region, not a wider rewrite of the theorem.",
      "- Return only the proof text or structured result needed for that local gap.",
      "- Do not refactor the outer theorem spine, case structure, or surrounding proof plan.",
      "- Do not add new section-level, theorem-level, or global assumptions.",
      "- You may use `explorer` for read-only lookup and `fixer` for one local repair.",
      "- If the gap turns out to be architectural, cross-branch, or not actually local, escalate back to `prover`.",
    )

    if (opts?.faithful) {
      lines.push("", ...faithful("lemma"))
    }

    if (snap && !snap.fresh) lines.push("", "(snapshot may be stale)")
    if (snap) lines.push("</proof-context-lemma>")

    return lines
  }

  function wholeLemma(snap?: ProofSnapshot, opts?: { faithful?: boolean }) {
    const lines: string[] = []
    if (!snap) return lines

    const rel = path.relative(Instance.worktree, snap.file)
    lines.push("<proof-context-whole-lemma>")
    lines.push(`File: ${rel}  Position: ${snap.position.line + 1}:${snap.position.character + 1}`)

    if (snap.hyps.length > 0) {
      lines.push("", "Hypotheses:")
      for (const h of snap.hyps) lines.push(`  ${h}`)
      lines.push("========================")
    }

    lines.push("", "Goal:")
    lines.push(snap.goal ?? "(no goal)")

    if (snap.errors.length > 0) {
      lines.push("", "Relevant errors:")
      for (const e of snap.errors) {
        lines.push(`  [${e.line}:${e.col}] ${e.message}`)
      }
    }

    lines.push(
      "",
      "Whole-lemma direct proof scope:",
      "- Own the current target theorem as one focused proof obligation.",
      "- Prove directly from the live goal, hypotheses, imports, definitions, available Prosa facts, nearby proof patterns, and all allowed proof tools.",
      "- Use small validated tactics, persistent proof loops, and immediate file edits; begin proof construction directly.",
      "- Do not read proof.tex, build a paper-derived theorem skeleton, or create proof_region/admit_id delegation structure.",
      "- Treat direct Prosa proof mode as the main proof path, not a preliminary probe.",
      "- Use existing Prosa facts and small local bridge claims tied to the current goal or first failing line.",
      "- If the target file is still unchanged, stop circling and write the first concrete proof tactic, bridge claim, or proof fragment now.",
      "- Do not add new section-level, theorem-level, or global assumptions.",
      "- Do not declare the theorem false from a partial proof state; audit the live goal, hypotheses, imports, and visible facts first.",
      "- Finish by writing executable proof text to the file and validating with coqc.",
    )

    if (!snap.fresh) lines.push("", "(snapshot may be stale)")
    lines.push("</proof-context-whole-lemma>")

    return lines
  }

  function explorer(snap?: ProofSnapshot) {
    const lines: string[] = []
    if (!snap) return lines

    const rel = path.relative(Instance.worktree, snap.file)
    lines.push("<proof-context-explorer>")
    lines.push(`File: ${rel}  Position: ${snap.position.line + 1}:${snap.position.character + 1}`)

    if (snap.goal) {
      lines.push("", "Local goal:", snap.goal)
    }

    if (snap.hyps.length > 0) {
      lines.push("", "Relevant hypotheses:")
      for (const h of snap.hyps.slice(0, 12)) lines.push(`  ${h}`)
    }

    if (snap.errors.length > 0) {
      lines.push("", "Nearby errors:")
      for (const e of snap.errors) {
        lines.push(`  [${e.line}:${e.col}] ${e.message}`)
      }
    }

    lines.push(
      "",
      "Layer 3 scope:",
      "- Answer only the narrow lookup the caller asked for.",
      "- Return concrete lemmas, definitions, signatures, or proof patterns tied to this local context.",
      "- Do not edit files, redesign the proof, or expand into theorem-level strategy work.",
    )

    if (!snap.fresh) lines.push("", "(snapshot may be stale)")
    lines.push("</proof-context-explorer>")

    return lines
  }

  function diagnoser(snap?: ProofSnapshot) {
    const lines: string[] = []
    if (!snap) return lines

    const rel = path.relative(Instance.worktree, snap.file)
    lines.push("<proof-context-diagnoser>")
    lines.push(`File: ${rel}  Position: ${snap.position.line + 1}:${snap.position.character + 1}`)

    if (snap.goal) {
      lines.push("", "Current goal:", snap.goal)
    }

    if (snap.hyps.length > 0) {
      lines.push("", "Hypotheses:")
      for (const h of snap.hyps) lines.push(`  ${h}`)
    }

    if (snap.errors.length > 0) {
      lines.push("", "Errors to diagnose:")
      for (const e of snap.errors) {
        lines.push(`  [${e.line}:${e.col}] ${e.message}`)
      }
    }

    lines.push(
      "",
      "Layer 3 scope:",
      "- Diagnose and classify the error(s). Do NOT fix them.",
      "- Return a structured diagnosis with error category.",
      "- You may inspect files and query Coq types, but do not edit anything.",
    )

    if (!snap.fresh) lines.push("", "(snapshot may be stale)")
    lines.push("</proof-context-diagnoser>")

    return lines
  }

  function live(snap?: ProofSnapshot) {
    if (!snap) return []
    return ["<proof-context-live>", ProofContext.render(snap), "</proof-context-live>"]
  }

  function faithful(agent: "prover" | "lemma") {
    const lines = ["<paper-faithful-mode>", "PAPER-FAITHFUL MODE IS ACTIVE.", ""]
    if (agent === "prover") {
      lines.push(
        "1. Summarize the usable proof spine from the paper before deep search, and mark any step whose formal premises or target do not match.",
        "2. Prefer paper-aligned obligations while they remain compatible with the theorem statement, live context, premise audit, and compiler evidence.",
        "3. Annotate each theorem-level pose/have with its paper mapping or context-derived source and its role in the proof DAG.",
        "4. Before adding a new core claim not in the paper, state which blocked or missing formal step it replaces and what evidence requires the change.",
        "5. If repeated work does not reduce unresolved obligations, re-audit the route and revise the affected semantic boundary instead of automatically reverting to an already disproved paper route.",
        "6. When delegating, route one first-level frozen local region per subtask and let lemma own any deeper local reasoning inside that region.",
      )
    } else {
      lines.push(
        "1. Stay faithful to the assigned paper step, equation, or child claim.",
        "2. Produce the informal proof before deciding how to prove the current gap directly.",
        "3. Use that informal proof as the controlling local proof plan; if it is not precise enough, refine it before touching the Coq proof.",
        "4. Insert a local annotated pose/have skeleton only when the informal proof itself requires that local decomposition.",
        "5. Keep pushing the direct local proof of the current gap instead of changing proof ownership.",
        "6. If paper alignment breaks or requires outer restructuring, escalate instead of rewriting context.",
      )
    }
    lines.push("</paper-faithful-mode>")
    return lines
  }
}
