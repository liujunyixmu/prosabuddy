import { createHash } from "crypto"
import path from "path"
import z from "zod"
import { and, Database, desc, eq } from "@/storage/db"
import { ProofRouteFailureTable } from "./proof-route-ledger.sql"

export namespace ProofRouteLedger {
  export const FailureKind = z.enum([
    "lemma_missing_premise",
    "lemma_interface_mismatch",
    "unprovable_target_contract",
    "missing_plan_dependency",
    "wrong_normal_form",
    "repeated_semantic_failure",
  ])
  export type FailureKind = z.infer<typeof FailureKind>

  export const RecommendedAction = z.enum([
    "replace_lemma",
    "prove_missing_premise",
    "refine_current_region",
    "split_affected_subgraph",
    "replace_theorem_route",
  ])
  export type RecommendedAction = z.infer<typeof RecommendedAction>

  export const RouteOverrideEvidence = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("missing_premise_certified"),
      premise_fingerprint: z.string().min(1),
      admit_id: z.string().min(1),
      compiler_signature: z.string().min(1),
      source_hash: z.string().min(1),
    }),
    z.object({
      kind: z.literal("different_instantiation"),
      previous_instantiation_fingerprint: z.string().min(1),
      candidate_instantiation_fingerprint: z.string().min(1),
    }),
    z.object({
      kind: z.literal("failure_audit_invalidated"),
      audit_id: z.string().min(1),
      compiler_signature: z.string().min(1),
      source_hash: z.string().min(1),
    }),
  ])
  export type RouteOverrideEvidence = z.infer<typeof RouteOverrideEvidence>

  export const RouteOverride = z.object({
    failure_id: z.string().min(1),
    evidence: RouteOverrideEvidence,
  })
  export type RouteOverride = z.infer<typeof RouteOverride>

  const LegacyRouteOverride = z.object({
    failure_id: z.string().min(1),
    reason: z.string().min(1),
    evidence: z.string().min(1),
  })

  export const Receipt = z.object({
    id: z.string().min(1),
    workspace: z.string().min(1),
    file: z.string().min(1),
    theorem: z.string().min(1),
    theorem_context_fingerprint: z.string().min(1),
    plan_fingerprint: z.string().min(1).optional(),
    node_id: z.string().min(1).optional(),
    admit_id: z.string().min(1).optional(),
    target_contract_fingerprint: z.string().min(1).optional(),
    kind: FailureKind,
    failed_lemma: z.string().min(1).optional(),
    lemma_type_fingerprint: z.string().min(1).optional(),
    failed_instantiation_fingerprint: z.string().min(1).optional(),
    missing_premises: z.array(z.string().min(1)).default([]),
    missing_premise_fingerprints: z.array(z.string().min(1)).default([]),
    route_summary: z.string().min(1),
    evidence: z.string().min(1),
    confidence: z.enum(["tentative", "verified"]),
    recommended_action: RecommendedAction,
    occurrence_count: z.number().int().positive(),
    status: z.enum(["active", "addressed", "superseded", "stale"]),
    created_at: z.number().int().positive(),
    updated_at: z.number().int().positive(),
  })
  export type Receipt = z.infer<typeof Receipt>

  const StoredReceipt = Receipt.extend({
    overrides: z.array(z.union([RouteOverride, LegacyRouteOverride])).default([]),
  })
  export type StoredReceipt = z.infer<typeof StoredReceipt>

  export const RecordInput = Receipt.omit({
    id: true,
    occurrence_count: true,
    status: true,
    created_at: true,
    updated_at: true,
  })
  // Callers may omit fields with schema defaults; recordRouteFailure parses
  // them before constructing the persisted receipt.
  export type RecordInput = z.input<typeof RecordInput>

  type ScopeInput = {
    workspace: string
    file: string
    theorem: string
    source: string
  }

  type ReusePlan = {
    plan_fingerprint?: string
    addresses_failure_ids?: string[]
    route_overrides?: RouteOverride[]
    nodes: {
      node_id?: string
      paper_step_id: string
      formal_goal?: string
      candidate_lemmas: string[]
      prosa_candidate_lemmas: {
        name: string
        audit?: {
          verdict?: string
          instantiation_fingerprint?: string
          residual_premise_fingerprints?: string[]
        }
      }[]
      mathcomp_candidate_lemmas: {
        name: string
        audit?: {
          verdict?: string
          instantiation_fingerprint?: string
          residual_premise_fingerprints?: string[]
        }
      }[]
    }[]
  }

  type RouteBlock = {
    failure_id: string
    code: "verified_failed_route_reuse" | "verified_failed_route_requires_audit"
    message: string
    node_id?: string
  }

  function hash(value: string) {
    return createHash("sha256").update(value).digest("hex")
  }

  function normalizedText(value: string | undefined) {
    return (value ?? "")
      .replace(/\(\*[\s\S]*?\*\)/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  }

  function normalizedScope(workspace: string, file: string) {
    const normalizedWorkspace = path.resolve(workspace)
    const normalizedFile = path.resolve(path.isAbsolute(file) ? file : path.join(normalizedWorkspace, file))
    return { workspace: normalizedWorkspace, file: normalizedFile }
  }

  function maskCommentsAndStrings(source: string) {
    const masked = [...source]
    let commentDepth = 0
    let inString = false
    for (let index = 0; index < source.length; index++) {
      if (commentDepth > 0) {
        masked[index] = source[index] === "\n" ? "\n" : " "
        if (source[index] === "(" && source[index + 1] === "*") {
          masked[index + 1] = " "
          commentDepth += 1
          index += 1
        } else if (source[index] === "*" && source[index + 1] === ")") {
          masked[index + 1] = " "
          commentDepth -= 1
          index += 1
        }
        continue
      }
      if (inString) {
        masked[index] = source[index] === "\n" ? "\n" : " "
        if (source[index] === '"' && source[index - 1] !== "\\") inString = false
        continue
      }
      if (source[index] === "(" && source[index + 1] === "*") {
        masked[index] = " "
        masked[index + 1] = " "
        commentDepth = 1
        index += 1
      } else if (source[index] === '"') {
        masked[index] = " "
        inString = true
      }
    }
    return masked.join("")
  }

  function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  /**
   * Fingerprint only the active Section/Module assumptions and theorem
   * declaration. Proof bodies are deliberately excluded so local repair edits
   * do not invalidate useful route evidence.
   */
  export function theoremContextFingerprint(source: string, theorem: string) {
    const masked = maskCommentsAndStrings(source)
    const declaration = new RegExp(
      `\\b(?:Lemma|Theorem|Corollary|Proposition|Fact|Remark|Example)\\s+${escapeRegExp(theorem)}\\b`,
      "g",
    ).exec(masked)
    if (!declaration) return hash(`unresolved-theorem\n${theorem}`)
    const prefix = masked.slice(0, declaration.index)
    const proof = /\bProof\s*\./g.exec(masked.slice(declaration.index))
    const declarationEnd = proof ? declaration.index + proof.index : masked.length
    const theoremDeclaration = source.slice(declaration.index, declarationEnd)

    const frames: { name: string; header: string; assumptions: string[] }[] = [
      { name: "<root>", header: "", assumptions: [] },
    ]
    let commandStart = 0
    for (let index = 0; index < prefix.length; index++) {
      if (prefix[index] !== ".") continue
      const command = prefix.slice(commandStart, index + 1).replace(/\s+/g, " ").trim()
      commandStart = index + 1
      if (!command) continue
      const open = /^(Section|Module(?:\s+Type)?)\s+([A-Za-z0-9_']+)/.exec(command)
      if (open) {
        frames.push({ name: open[2], header: command, assumptions: [] })
        continue
      }
      const close = /^End\s+([A-Za-z0-9_']+)/.exec(command)
      if (close) {
        const match = frames.map((frame) => frame.name).lastIndexOf(close[1])
        if (match > 0) frames.splice(match)
        continue
      }
      if (
        /^(?:Context|Variable|Variables|Hypothesis|Hypotheses|Parameter|Parameters|Axiom|Axioms|Implicit\s+Types|Generalizable\s+(?:All\s+)?Variables)\b/.test(
          command,
        )
      ) {
        frames.at(-1)!.assumptions.push(command)
      }
    }
    const activeContext = frames.flatMap((frame) => [frame.header, ...frame.assumptions]).filter(Boolean)
    return hash(
      [...activeContext, theoremDeclaration]
        .map((entry) => normalizedText(entry))
        .join("\n"),
    )
  }

  export function targetContractFingerprint(target: string) {
    return hash(normalizedText(target))
  }

  export function premiseFingerprint(premise: string) {
    return hash(normalizedText(premise))
  }

  function semanticFingerprint(input: z.output<typeof RecordInput>) {
    const coordinates = [
      input.kind,
      input.target_contract_fingerprint,
      normalizedText(input.failed_lemma),
      input.lemma_type_fingerprint,
      input.failed_instantiation_fingerprint,
      [...input.missing_premise_fingerprints].sort().join("|"),
    ]
    // plan/node/admit identifiers are administrative coordinates. Renaming a
    // region or rebuilding an equivalent plan must not create a fresh semantic
    // route after the same lemma/target/instantiation/premise combination has
    // already been mechanically verified to fail.
    if (!coordinates.slice(1).some(Boolean)) coordinates.push(normalizedText(input.route_summary))
    return hash(coordinates.join("\n"))
  }

  function fromRow(row: typeof ProofRouteFailureTable.$inferSelect) {
    return StoredReceipt.parse(JSON.parse(row.payload))
  }

  export function recordRouteFailure(raw: RecordInput) {
    const parsed = RecordInput.parse(raw)
    const scope = normalizedScope(parsed.workspace, parsed.file)
    const contextFingerprint = parsed.theorem_context_fingerprint
    const input: z.output<typeof RecordInput> = {
      ...parsed,
      ...scope,
      theorem_context_fingerprint: contextFingerprint,
      missing_premise_fingerprints:
        parsed.missing_premise_fingerprints.length > 0
          ? parsed.missing_premise_fingerprints
          : parsed.missing_premises.map(premiseFingerprint),
    }
    const fingerprint = semanticFingerprint(input)
    const existing = Database.use((db) =>
      db
        .select()
        .from(ProofRouteFailureTable)
        .where(
          and(
            eq(ProofRouteFailureTable.workspace, scope.workspace),
            eq(ProofRouteFailureTable.file, scope.file),
            eq(ProofRouteFailureTable.theorem, input.theorem),
            eq(ProofRouteFailureTable.theorem_context_fingerprint, contextFingerprint),
            eq(ProofRouteFailureTable.semantic_fingerprint, fingerprint),
          ),
        )
        .get(),
    )
    const now = Date.now()
    const previous = existing ? fromRow(existing) : undefined
    const receipt = StoredReceipt.parse({
      ...input,
      id: previous?.id ?? `route-failure-${hash(`${scope.workspace}\n${scope.file}\n${input.theorem}\n${contextFingerprint}\n${fingerprint}`).slice(0, 24)}`,
      confidence: previous?.confidence === "verified" ? "verified" : input.confidence,
      occurrence_count: (previous?.occurrence_count ?? 0) + 1,
      status: "active",
      created_at: previous?.created_at ?? now,
      updated_at: now,
      overrides: previous?.overrides ?? [],
    })
    Database.use((db) =>
      db
        .insert(ProofRouteFailureTable)
        .values({
          id: receipt.id,
          workspace: receipt.workspace,
          file: receipt.file,
          theorem: receipt.theorem,
          theorem_context_fingerprint: receipt.theorem_context_fingerprint,
          semantic_fingerprint: fingerprint,
          confidence: receipt.confidence,
          status: receipt.status,
          payload: JSON.stringify(receipt),
          time_created: receipt.created_at,
          time_updated: receipt.updated_at,
        })
        .onConflictDoUpdate({
          target: ProofRouteFailureTable.id,
          set: {
            confidence: receipt.confidence,
            status: receipt.status,
            payload: JSON.stringify(receipt),
            time_updated: receipt.updated_at,
          },
        })
        .run(),
    )
    return receipt
  }

  export function getActiveRouteFailures(input: ScopeInput, limit?: number) {
    const scope = normalizedScope(input.workspace, input.file)
    const contextFingerprint = theoremContextFingerprint(input.source, input.theorem)
    const scopedRows = Database.use((db) =>
      db
        .select()
        .from(ProofRouteFailureTable)
        .where(
          and(
            eq(ProofRouteFailureTable.workspace, scope.workspace),
            eq(ProofRouteFailureTable.file, scope.file),
            eq(ProofRouteFailureTable.theorem, input.theorem),
            eq(ProofRouteFailureTable.status, "active"),
          ),
        )
        .orderBy(desc(ProofRouteFailureTable.time_updated))
        .all(),
    )
    for (const row of scopedRows) {
      if (row.theorem_context_fingerprint === contextFingerprint) continue
      const receipt = StoredReceipt.parse({ ...fromRow(row), status: "stale", updated_at: Date.now() })
      Database.use((db) =>
        db
          .update(ProofRouteFailureTable)
          .set({ status: "stale", payload: JSON.stringify(receipt), time_updated: receipt.updated_at })
          .where(eq(ProofRouteFailureTable.id, receipt.id))
          .run(),
      )
    }
    const active = scopedRows.filter((row) => row.theorem_context_fingerprint === contextFingerprint)
    return (limit === undefined ? active : active.slice(0, Math.max(0, limit))).map(fromRow)
  }

  export function recordRouteOverride(override: RouteOverride) {
    const parsed = RouteOverride.parse(override)
    const row = Database.use((db) =>
      db.select().from(ProofRouteFailureTable).where(eq(ProofRouteFailureTable.id, parsed.failure_id)).get(),
    )
    if (!row) throw new Error(`unknown route failure ${parsed.failure_id}`)
    const previous = fromRow(row)
    const now = Date.now()
    const receipt = StoredReceipt.parse({
      ...previous,
      overrides: [...previous.overrides.filter((entry) => RouteOverride.safeParse(entry).success === false), parsed],
      updated_at: now,
    })
    Database.use((db) =>
      db
        .update(ProofRouteFailureTable)
        .set({ payload: JSON.stringify(receipt), time_updated: now })
        .where(eq(ProofRouteFailureTable.id, receipt.id))
        .run(),
    )
    return receipt
  }

  export function addressRouteFailure(id: string, status: "addressed" | "superseded" = "addressed") {
    const row = Database.use((db) =>
      db.select().from(ProofRouteFailureTable).where(eq(ProofRouteFailureTable.id, id)).get(),
    )
    if (!row) return undefined
    const now = Date.now()
    const receipt = StoredReceipt.parse({ ...fromRow(row), status, updated_at: now })
    Database.use((db) =>
      db
        .update(ProofRouteFailureTable)
        .set({ status, payload: JSON.stringify(receipt), time_updated: now })
        .where(eq(ProofRouteFailureTable.id, id))
        .run(),
    )
    return receipt
  }

  export function clearScope(input: Pick<ScopeInput, "workspace" | "file" | "theorem">) {
    const scope = normalizedScope(input.workspace, input.file)
    Database.use((db) =>
      db
        .delete(ProofRouteFailureTable)
        .where(
          and(
            eq(ProofRouteFailureTable.workspace, scope.workspace),
            eq(ProofRouteFailureTable.file, scope.file),
            eq(ProofRouteFailureTable.theorem, input.theorem),
          ),
        )
        .run(),
    )
  }

  export function assessKnownRouteReuse(
    failures: StoredReceipt[],
    plan: ReusePlan,
    options: { verified_override_ids?: Set<string> } = {},
  ) {
    const inlineOverrides = new Map((plan.route_overrides ?? []).map((entry) => [entry.failure_id, entry]))
    const candidates: {
      name: string
      node_id?: string
      formal_goal?: string
      structured: boolean
      audit?: {
        verdict?: string
        instantiation_fingerprint?: string
        residual_premise_fingerprints?: string[]
      }
    }[] = plan.nodes.flatMap((node) => [
      ...node.candidate_lemmas.map((name) => ({
        name,
        node_id: node.node_id,
        formal_goal: node.formal_goal,
        structured: false,
      })),
      ...node.prosa_candidate_lemmas.map((entry) => ({
        ...entry,
        node_id: node.node_id,
        formal_goal: node.formal_goal,
        structured: true,
      })),
      ...node.mathcomp_candidate_lemmas.map((entry) => ({
        ...entry,
        node_id: node.node_id,
        formal_goal: node.formal_goal,
        structured: true,
      })),
    ])
    const blocks: RouteBlock[] = []
    for (const failure of failures) {
      if (failure.confidence !== "verified") continue
      const sameLemmaAndTarget = failure.failed_lemma
        ? candidates.filter((candidate) => {
            if (candidate.name !== failure.failed_lemma) return false
            if (!failure.target_contract_fingerprint) return true
            return Boolean(
              candidate.formal_goal &&
              targetContractFingerprint(candidate.formal_goal) === failure.target_contract_fingerprint,
            )
          })
        : []
      const auditRequired = Boolean(
        failure.failed_instantiation_fingerprint || failure.missing_premise_fingerprints.length > 0,
      )
      const unauditedCandidate = auditRequired
        ? sameLemmaAndTarget.find((candidate) => !candidate.structured || !candidate.audit)
        : undefined
      const matchingCandidates = failure.failed_lemma
          ? sameLemmaAndTarget.filter((candidate) => {
            if (failure.failed_instantiation_fingerprint) {
              if (!candidate.audit?.instantiation_fingerprint) return false
              if (candidate.audit.instantiation_fingerprint !== failure.failed_instantiation_fingerprint) return false
            }
            if (failure.missing_premise_fingerprints.length > 0) {
              if (!candidate.audit) return false
              const residual = candidate.audit.residual_premise_fingerprints ?? []
              if (candidate.audit.verdict === "usable" || residual.length === 0) return false
              if (!failure.missing_premise_fingerprints.every((premise) => residual.includes(premise))) return false
            }
            return true
          })
        : []
      const reusesFailedLemma = matchingCandidates.length > 0
      // A semantic-plan fingerprint deliberately ignores evidence wording and
      // candidate names, so it is not precise enough for a hard ban by itself.
      // Only an exact failed lemma/target/premise route is blocked.
      if (!reusesFailedLemma && !unauditedCandidate) continue
      const override = inlineOverrides.get(failure.id)
      const persistedOverride = failure.overrides.findLast((entry) => RouteOverride.safeParse(entry).success)
      const hasVerifiedOverride = Boolean(
        options.verified_override_ids?.has(failure.id) && (override || persistedOverride),
      )
      if (hasVerifiedOverride) continue
      blocks.push({
        failure_id: failure.id,
        code: unauditedCandidate ? "verified_failed_route_requires_audit" : "verified_failed_route_reuse",
        node_id: matchingCandidates[0]?.node_id ?? unauditedCandidate?.node_id ?? failure.node_id,
        message: unauditedCandidate
          ? `Verified route failure ${failure.id} names the same lemma and target, but the candidate was submitted without the mechanical premise/instantiation audit needed to show that this is a different route. Submit it as a structured audited candidate, change the lemma or target, or prove the recorded missing premise with a current compiler certificate.`
          : `Verified route failure ${failure.id} cannot be materialized again in the same theorem context. Change the lemma or target route, prove the recorded missing premise with a current compiler certificate, use a mechanically different audited instantiation, or invalidate the original audit with compiler-backed evidence. Free-form route_override text is not accepted.`,
      })
    }
    return {
      blocked: blocks.length > 0,
      override_required: blocks.length > 0,
      blocks,
      warnings: [] as RouteBlock[],
    }
  }

  function compact(value: string, max = 220) {
    const normalized = value.replace(/\s+/g, " ").trim()
    return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`
  }

  export function routeFailurePrompt(failures: StoredReceipt[]) {
    if (failures.length === 0) return undefined
    return [
      "<cross-session-route-failure-ledger>",
      "The following route-level failures were recorded for this exact workspace, file, theorem, and theorem-context fingerprint.",
      "Tentative entries are advisory. A verified exact failed route is a materialization hard constraint for this theorem context: do not reuse the same failed lemma/instantiation/missing-premise route.",
      "The constraint is not a global lemma blacklist. A retry is allowed only after a machine-verifiable context change, a current compiler certificate for the missing premise, a genuinely different premise-audited instantiation, or compiler-backed invalidation of the original audit.",
      "Free-form route_override prose is not accepted. Structured override evidence kinds are missing_premise_certified, different_instantiation, and failure_audit_invalidated.",
      ...failures.slice(0, 5).map((failure) =>
        [
          `- id=${failure.id}`,
          `confidence=${failure.confidence}`,
          `kind=${failure.kind}`,
          failure.node_id ? `node=${failure.node_id}` : undefined,
          failure.admit_id ? `admit=${failure.admit_id}` : undefined,
          failure.failed_lemma ? `failed_lemma=${failure.failed_lemma}` : undefined,
          failure.lemma_type_fingerprint ? `lemma_type_fingerprint=${failure.lemma_type_fingerprint}` : undefined,
          failure.failed_instantiation_fingerprint
            ? `failed_instantiation_fingerprint=${failure.failed_instantiation_fingerprint}`
            : undefined,
          failure.missing_premises.length > 0
            ? `missing_premises=${compact(failure.missing_premises.join(" | "), 420)}`
            : undefined,
          failure.missing_premise_fingerprints.length > 0
            ? `missing_premise_fingerprints=${failure.missing_premise_fingerprints.join(",")}`
            : undefined,
          `recommended=${failure.recommended_action}`,
          `occurrences=${failure.occurrence_count}`,
          `route=${compact(failure.route_summary)}`,
          `evidence=${compact(failure.evidence)}`,
        ].filter(Boolean).join("; "),
      ),
      "</cross-session-route-failure-ledger>",
    ].join("\n")
  }
}
