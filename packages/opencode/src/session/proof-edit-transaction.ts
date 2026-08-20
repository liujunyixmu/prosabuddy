import path from "path"
import { createHash, randomUUID } from "crypto"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { FileTime } from "@/file/time"
import { Bus } from "@/bus"
import { File } from "@/file"
import { FileWatcher } from "@/file/watcher"
import { SessionStatus } from "./status"
import { and, Database, desc, eq } from "@/storage/db"
import { SessionProofWorkflow } from "./proof-workflow"
import {
  ProofEditTransactionRevisionTable,
  ProofEditTransactionTable,
} from "./proof-edit-transaction.sql"

export namespace ProofEditTransaction {
  export type AuthorizedScope =
    | {
        kind: "proof_region"
        theorem: string
        beginMarker: string
        endMarker: string
      }
    | {
        kind: "theorem_body"
        theorem: string
      }
    | {
        kind: "theorem_spine"
        theorem: string
      }

  type TheoremBoundary = {
    theoremPrefix: string
    prefix: string
    suffix: string
  }

  type RegionBoundary = {
    prefix: string
    suffix: string
  }

  type Transaction = {
    id: string
    workspace: string
    sessionID: string
    parentSessionID: string
    agent: string
    file: string
    baseSource: string
    baseHash: string
    stagedSource: string
    revision: number
    bestRevision?: number
    bestCommittableSource?: string
    bestProgressLevel?: "hard" | "structural"
    bestReceipt?: unknown
    bestRecoveryRevision?: number
    bestRecoverySource?: string
    bestRecoveryProgressLevel?: "hard" | "structural"
    bestRecoveryReceipt?: unknown
    bestRecoveryCertifiedRegionCount?: number
    bestRecoveryUnresolvedDebt?: number
    recoveryBase: "current_draft" | "best_certified"
    preservedDraftRevision?: number
    preservedDraftHash?: string
    scope: AuthorizedScope
    theoremBoundary?: TheoremBoundary
    regionBoundary?: RegionBoundary
    recovered: boolean
    handedOff: boolean
    synchronizedRevision?: number
    createdAt: number
    updatedAt: number
  }

  type PersistedPayload = {
    version: 1
    agent: string
    scope: AuthorizedScope
  }

  export type Summary = {
    transaction_id: string
    file: string
    scope: AuthorizedScope["kind"]
    staged: boolean
    revision: number
    source_hash: string
    recovered: boolean
    committable_snapshot: boolean
    progress_level?: "hard" | "structural"
    recovery_base: "current_draft" | "best_certified"
    certified_revision?: number
    certified_region_count?: number
    certified_unresolved_debt?: number
    preserved_draft_revision?: number
    preserved_draft_hash?: string
    /** @deprecated Kept for trace compatibility with older workers. */
    accepted_snapshot: boolean
    handed_off: boolean
    validation_pending: boolean
  }

  export type FinalizeResult =
    | (Summary & { status: "committed"; receipt?: unknown })
    | (Summary & { status: "discarded" })
    | (Summary & { status: "recoverable" })
    | (Summary & { status: "handed_off"; handoff_session_id: string })
    | (Summary & { status: "unchanged" })

  export type StalledRepairYield = Summary & {
    status: "handed_off" | "recoverable"
    handoff_session_id?: string
    yielded_from_revision: number
    yielded_from_hash: string
    resume_revision: number
    resume_hash: string
    draft_policy: "preserve_current" | "prefer_certified"
    draft_preserved: boolean
    diagnostic_revision?: number
    diagnostic_progress_level?: "hard" | "structural" | "debug"
    diagnostic_receipt?: unknown
  }

  const state = Instance.state(() => new Map<string, Transaction>())

  function normalize(file: string) {
    return path.normalize(path.isAbsolute(file) ? file : path.resolve(Instance.directory, file))
  }

  function workspace() {
    return path.resolve(Instance.worktree === "/" ? Instance.directory : Instance.worktree)
  }

  function hash(source: string) {
    return createHash("sha256").update(source).digest("hex")
  }

  function protectedSuffixStart(source: string, protectedSuffix: string) {
    if (source.endsWith(protectedSuffix)) return source.length - protectedSuffix.length

    // Preserve the structural suffix exactly while tolerating the harmless
    // final-newline difference produced by whole-tail theorem repairs.
    const stableSuffix = protectedSuffix.replace(/[ \t\r\n]+$/, "")
    const stableSource = source.replace(/[ \t\r\n]+$/, "")
    if (!stableSource.endsWith(stableSuffix)) return undefined
    return stableSource.length - stableSuffix.length
  }

  function protectedSuffixMatches(source: string, protectedSuffix: string) {
    return protectedSuffixStart(source, protectedSuffix) !== undefined
  }

  function scopeKey(scope: AuthorizedScope) {
    return hash(JSON.stringify(scope))
  }

  function scopeRank(scope: AuthorizedScope) {
    if (scope.kind === "theorem_spine") return 3
    if (scope.kind === "theorem_body") return 2
    return 1
  }

  function broaderScope(current: AuthorizedScope, minimum?: AuthorizedScope) {
    if (!minimum) return current
    if (minimum.theorem !== current.theorem) {
      throw new Error(
        `proof_transaction_scope_rejection: cannot reauthorize theorem ${current.theorem} as ${minimum.theorem}`,
      )
    }
    return scopeRank(minimum) > scopeRank(current) ? minimum : current
  }

  function payload(transaction: Transaction): PersistedPayload {
    return {
      version: 1,
      agent: transaction.agent,
      scope: transaction.scope,
    }
  }

  function updateJournal(transaction: Transaction, status: string) {
    Database.use((db) =>
      db
        .update(ProofEditTransactionTable)
        .set({
          status,
          scope_key: scopeKey(transaction.scope),
          payload: JSON.stringify(payload(transaction)),
          owner_session_id: transaction.sessionID,
          parent_session_id: transaction.parentSessionID,
          current_revision: transaction.revision,
          best_revision: transaction.bestRevision,
          best_progress_level: transaction.bestProgressLevel,
          time_updated: transaction.updatedAt,
        })
        .where(eq(ProofEditTransactionTable.id, transaction.id))
        .run(),
    )
  }

  function revisionID(transactionID: string, revision: number) {
    return `${transactionID}:${revision}`
  }

  function appendRevision(transaction: Transaction, source: string) {
    const now = transaction.updatedAt
    Database.use((db) =>
      db
        .insert(ProofEditTransactionRevisionTable)
        .values({
          id: revisionID(transaction.id, transaction.revision),
          transaction_id: transaction.id,
          revision: transaction.revision,
          source_hash: hash(source),
          source,
          time_created: now,
          time_updated: now,
        })
        .run(),
    )

    // Keep the immutable base, the best committable revision, and a bounded
    // recent edit history. This preserves failed work without allowing an
    // unbounded proof journal to consume the database.
    const rows = Database.use((db) =>
      db
        .select({ id: ProofEditTransactionRevisionTable.id, revision: ProofEditTransactionRevisionTable.revision })
        .from(ProofEditTransactionRevisionTable)
        .where(eq(ProofEditTransactionRevisionTable.transaction_id, transaction.id))
        .orderBy(desc(ProofEditTransactionRevisionTable.revision))
        .all(),
    )
    const keep = new Set([
      0,
      transaction.revision,
      ...(transaction.bestRevision === undefined ? [] : [transaction.bestRevision]),
      ...(transaction.bestRecoveryRevision === undefined ? [] : [transaction.bestRecoveryRevision]),
      ...rows.slice(0, 24).map((row) => row.revision),
    ])
    for (const row of rows) {
      if (keep.has(row.revision)) continue
      Database.use((db) =>
        db.delete(ProofEditTransactionRevisionTable).where(eq(ProofEditTransactionRevisionTable.id, row.id)).run(),
      )
    }
  }

  function recordRevisionValidation(input: {
    transaction: Transaction
    level: "hard" | "structural" | "debug"
    receipt?: unknown
  }) {
    const now = Date.now()
    Database.use((db) =>
      db
        .update(ProofEditTransactionRevisionTable)
        .set({
          progress_level: input.level,
          receipt: input.receipt === undefined ? undefined : JSON.stringify(input.receipt),
          time_updated: now,
        })
        .where(eq(ProofEditTransactionRevisionTable.id, revisionID(input.transaction.id, input.transaction.revision)))
        .run(),
    )
  }

  function revisionProgressLevel(transaction: Transaction, revision = transaction.revision) {
    return Database.use((db) =>
      db
        .select({ progress_level: ProofEditTransactionRevisionTable.progress_level })
        .from(ProofEditTransactionRevisionTable)
        .where(eq(ProofEditTransactionRevisionTable.id, revisionID(transaction.id, revision)))
        .get(),
    )?.progress_level
  }

  function revisionDiagnostic(transaction: Transaction, revision = transaction.revision) {
    const row = Database.use((db) =>
      db
        .select({
          progress_level: ProofEditTransactionRevisionTable.progress_level,
          receipt: ProofEditTransactionRevisionTable.receipt,
        })
        .from(ProofEditTransactionRevisionTable)
        .where(eq(ProofEditTransactionRevisionTable.id, revisionID(transaction.id, revision)))
        .get(),
    )
    if (!row?.progress_level) return undefined
    let receipt: unknown
    if (row.receipt) {
      try {
        receipt = JSON.parse(row.receipt)
      } catch {
        receipt = row.receipt
      }
    }
    return {
      revision,
      progressLevel: row.progress_level,
      receipt,
    }
  }

  function currentRevisionCertified(transaction: Transaction) {
    if (transaction.bestRevision === transaction.revision) return true
    const level = revisionProgressLevel(transaction)
    if (level === "hard" || level === "structural") return true

    // Recovery may fork the exact best compiler-certified source into a new
    // revision solely to preserve a newer failed draft or widen the authorized
    // scope.  The bytes being proved have not changed, so the copied revision
    // retains the certificate even though its new journal row has not been
    // compiled independently.
    return Boolean(
      transaction.bestRecoverySource === transaction.stagedSource &&
        (transaction.bestRecoveryProgressLevel === "hard" ||
          transaction.bestRecoveryProgressLevel === "structural"),
    )
  }

  function validationPending(transaction: Transaction) {
    return transaction.stagedSource !== transaction.baseSource && !currentRevisionCertified(transaction)
  }

  type RecoveryCandidate = {
    revision: number
    source: string
    level: "hard" | "structural"
    receipt?: unknown
    certifiedRegionCount: number
    unresolvedDebt?: number
  }

  function parsedReceipt(receipt: unknown) {
    if (typeof receipt !== "string") return receipt
    try {
      return JSON.parse(receipt) as unknown
    } catch {
      return undefined
    }
  }

  function recoveryEvidence(level: "hard" | "structural", receipt: unknown) {
    const parsed = parsedReceipt(receipt)
    const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined
    const explicitCount = record?.certified_semantic_debt_count
    const unresolved = record?.after_unresolved_semantic_debt
    const kind = typeof record?.kind === "string" ? record.kind : undefined
    const certifiedRegionCount = typeof explicitCount === "number" && Number.isFinite(explicitCount)
      ? Math.max(0, Math.floor(explicitCount))
      : level === "hard" && ["region_certified", "missing_premise_certified", "semantic_debt_reduced", "final_qed"].includes(kind ?? "")
        ? 1
        : 0
    return {
      receipt: parsed,
      certifiedRegionCount,
      unresolvedDebt:
        typeof unresolved === "number" && Number.isFinite(unresolved)
          ? Math.max(0, Math.floor(unresolved))
          : undefined,
    }
  }

  function recoveryCandidateBetter(left: RecoveryCandidate, right: RecoveryCandidate | undefined) {
    if (!right) return true
    if (left.certifiedRegionCount !== right.certifiedRegionCount) {
      return left.certifiedRegionCount > right.certifiedRegionCount
    }
    if (left.unresolvedDebt !== right.unresolvedDebt) {
      if (left.unresolvedDebt === undefined) return false
      if (right.unresolvedDebt === undefined) return true
      return left.unresolvedDebt < right.unresolvedDebt
    }
    if (left.level !== right.level) return left.level === "hard"
    return left.revision > right.revision
  }

  function recoveryCandidateCompare(left: RecoveryCandidate | undefined, right: RecoveryCandidate | undefined) {
    if (left && !right) return -1
    if (!left && right) return 1
    if (!left || !right) return 0
    if (left.certifiedRegionCount !== right.certifiedRegionCount) {
      return right.certifiedRegionCount - left.certifiedRegionCount
    }
    if (left.unresolvedDebt !== right.unresolvedDebt) {
      if (left.unresolvedDebt === undefined) return 1
      if (right.unresolvedDebt === undefined) return -1
      return left.unresolvedDebt - right.unresolvedDebt
    }
    if (left.level !== right.level) return left.level === "hard" ? -1 : 1
    return right.revision - left.revision
  }

  function bestRecoveryCandidate(transactionID: string) {
    const rows = Database.use((db) =>
      db
        .select()
        .from(ProofEditTransactionRevisionTable)
        .where(eq(ProofEditTransactionRevisionTable.transaction_id, transactionID))
        .all(),
    )
    let best: RecoveryCandidate | undefined
    for (const row of rows) {
      if (row.progress_level !== "hard" && row.progress_level !== "structural") continue
      const evidence = recoveryEvidence(row.progress_level, row.receipt)
      const candidate: RecoveryCandidate = {
        revision: row.revision,
        source: row.source,
        level: row.progress_level,
        receipt: evidence.receipt,
        certifiedRegionCount: evidence.certifiedRegionCount,
        unresolvedDebt: evidence.unresolvedDebt,
      }
      if (recoveryCandidateBetter(candidate, best)) best = candidate
    }
    return best
  }

  function considerRecoveryCandidate(
    transaction: Transaction,
    input: { source: string; level: "hard" | "structural"; receipt?: unknown },
  ) {
    const evidence = recoveryEvidence(input.level, input.receipt)
    const candidate: RecoveryCandidate = {
      revision: transaction.revision,
      source: input.source,
      level: input.level,
      receipt: evidence.receipt,
      certifiedRegionCount: evidence.certifiedRegionCount,
      unresolvedDebt: evidence.unresolvedDebt,
    }
    const previous = transaction.bestRecoveryRevision === undefined
      ? undefined
      : {
          revision: transaction.bestRecoveryRevision,
          source: transaction.bestRecoverySource!,
          level: transaction.bestRecoveryProgressLevel!,
          receipt: transaction.bestRecoveryReceipt,
          certifiedRegionCount: transaction.bestRecoveryCertifiedRegionCount ?? 0,
          unresolvedDebt: transaction.bestRecoveryUnresolvedDebt,
        }
    if (!recoveryCandidateBetter(candidate, previous)) return false
    transaction.bestRecoveryRevision = candidate.revision
    transaction.bestRecoverySource = candidate.source
    transaction.bestRecoveryProgressLevel = candidate.level
    transaction.bestRecoveryReceipt = candidate.receipt
    transaction.bestRecoveryCertifiedRegionCount = candidate.certifiedRegionCount
    transaction.bestRecoveryUnresolvedDebt = candidate.unresolvedDebt
    return true
  }

  function forkFromBestCertified(transaction: Transaction) {
    if (
      transaction.bestRecoverySource === undefined ||
      transaction.bestRecoveryRevision === undefined
    ) return false
    if (transaction.stagedSource === transaction.bestRecoverySource) {
      transaction.recoveryBase = "best_certified"
      return false
    }

    const previous = {
      source: transaction.stagedSource,
      revision: transaction.revision,
      recoveryBase: transaction.recoveryBase,
      preservedDraftRevision: transaction.preservedDraftRevision,
      preservedDraftHash: transaction.preservedDraftHash,
      updatedAt: transaction.updatedAt,
    }
    transaction.preservedDraftRevision = previous.revision
    transaction.preservedDraftHash = hash(previous.source)
    transaction.stagedSource = transaction.bestRecoverySource
    transaction.revision += 1
    transaction.recoveryBase = "best_certified"
    transaction.updatedAt = Date.now()
    try {
      assertAuthorized(transaction, transaction.stagedSource)
      Database.transaction(() => {
        appendRevision(transaction, transaction.stagedSource)
        updateJournal(transaction, "active")
      })
    } catch (error) {
      transaction.stagedSource = previous.source
      transaction.revision = previous.revision
      transaction.recoveryBase = previous.recoveryBase
      transaction.preservedDraftRevision = previous.preservedDraftRevision
      transaction.preservedDraftHash = previous.preservedDraftHash
      transaction.updatedAt = previous.updatedAt
      throw error
    }
    return true
  }

  function escapeRegExp(text: string) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  function maskCoqCommentsAndStrings(source: string) {
    const masked = source.split("")
    let commentDepth = 0
    let inString = false
    for (let index = 0; index < source.length; index++) {
      const pair = source.slice(index, index + 2)
      if (commentDepth > 0) {
        if (pair === "(*") {
          masked[index] = masked[index + 1] = " "
          commentDepth++
          index++
          continue
        }
        if (pair === "*)") {
          masked[index] = masked[index + 1] = " "
          commentDepth--
          index++
          continue
        }
        if (source[index] !== "\n" && source[index] !== "\r") masked[index] = " "
        continue
      }
      if (inString) {
        if (source[index] === '"' && source[index + 1] === '"') {
          masked[index] = masked[index + 1] = " "
          index++
          continue
        }
        if (source[index] === '"') inString = false
        if (source[index] !== "\n" && source[index] !== "\r") masked[index] = " "
        continue
      }
      if (pair === "(*") {
        masked[index] = masked[index + 1] = " "
        commentDepth = 1
        index++
        continue
      }
      if (source[index] === '"') {
        masked[index] = " "
        inString = true
      }
    }
    if (commentDepth !== 0 || inString) return undefined
    return masked.join("")
  }

  function theoremBoundary(source: string, theorem: string): TheoremBoundary {
    const masked = maskCoqCommentsAndStrings(source)
    if (!masked) {
      throw new Error("proof_transaction_structure_rejection: unterminated Coq comment or string")
    }
    const declaration = new RegExp(
      `\\b(?:Lemma|Theorem|Corollary|Proposition|Fact|Remark|Example)\\s+${escapeRegExp(theorem)}\\b`,
      "g",
    )
    const declarations = [...masked.matchAll(declaration)]
    if (declarations.length !== 1) {
      throw new Error(
        `proof_transaction_structure_rejection: expected one declaration for theorem ${theorem}, found ${declarations.length}`,
      )
    }
    const theoremStart = declarations[0].index
    const nextDeclaration = /\b(?:Lemma|Theorem|Corollary|Proposition|Fact|Remark|Example)\s+[A-Za-z0-9_']+\b/g
    nextDeclaration.lastIndex = theoremStart + declarations[0][0].length
    const next = nextDeclaration.exec(masked)?.index ?? source.length
    const theoremText = masked.slice(theoremStart, next)
    const proofs = [...theoremText.matchAll(/\bProof\s*\./g)]
    if (proofs.length !== 1) {
      throw new Error(
        `proof_transaction_structure_rejection: theorem ${theorem} must contain exactly one explicit Proof command`,
      )
    }
    const proofEnd = theoremStart + proofs[0].index + proofs[0][0].length
    const terminator = /\b(?:Qed|Defined|Admitted|Abort)\s*\./g.exec(masked.slice(proofEnd, next))
    if (!terminator) {
      throw new Error(
        `proof_transaction_structure_rejection: theorem ${theorem} must contain a proof terminator`,
      )
    }
    const terminatorEnd = proofEnd + terminator.index + terminator[0].length
    return {
      theoremPrefix: source.slice(0, theoremStart),
      prefix: source.slice(0, proofEnd),
      suffix: source.slice(terminatorEnd),
    }
  }

  function assertProofSegment(candidate: string, boundary: TheoremBoundary) {
    const suffixStart = protectedSuffixStart(candidate, boundary.suffix)
    if (!candidate.startsWith(boundary.prefix) || suffixStart === undefined) {
      throw new Error(
        "proof_transaction_scope_rejection: theorem-repair child edits require explicit spine-change authorization outside the theorem proof body",
      )
    }
    const proofSegment = candidate.slice(boundary.prefix.length, suffixStart)
    const maskedSegment = maskCoqCommentsAndStrings(proofSegment)
    if (!maskedSegment) {
      throw new Error("proof_transaction_structure_rejection: unterminated comment or string in theorem proof body")
    }
    if (/\bProof\s*\./.test(maskedSegment) || /\bEnd\s+[A-Za-z0-9_']+\s*\./.test(maskedSegment)) {
      throw new Error(
        "proof_transaction_structure_rejection: a theorem proof body cannot contain a copied Proof or End command",
      )
    }
    const terminators = [...maskedSegment.matchAll(/\b(?:Qed|Defined|Admitted|Abort)\s*\./g)]
    if (terminators.length !== 1) {
      throw new Error("proof_transaction_structure_rejection: staged theorem body must contain exactly one terminator")
    }
    const afterTerminator = maskedSegment.slice(terminators[0].index + terminators[0][0].length)
    if (afterTerminator.trim()) {
      throw new Error("proof_transaction_structure_rejection: tactic or command text appears after the proof terminator")
    }
  }

  function regionBoundary(source: string, scope: Extract<AuthorizedScope, { kind: "proof_region" }>): RegionBoundary {
    const starts = source.split(scope.beginMarker).length - 1
    if (starts !== 1) {
      throw new Error(
        `proof_transaction_scope_rejection: proof_region begin marker for ${scope.theorem} must occur exactly once`,
      )
    }
    const start = source.indexOf(scope.beginMarker)
    const endStart = source.indexOf(scope.endMarker, start + scope.beginMarker.length)
    if (endStart < 0) {
      throw new Error(
        `proof_transaction_scope_rejection: proof_region end marker for ${scope.theorem} was not found after its begin marker`,
      )
    }
    const end = endStart + scope.endMarker.length
    return {
      prefix: source.slice(0, start),
      suffix: source.slice(end),
    }
  }

  function assertAuthorized(transaction: Transaction, candidate: string) {
    // This also rejects duplicated Qed./End suffixes and post-terminator tactic
    // text even when an edit happens to preserve the file's outer prefix/suffix.
    const candidateBoundary = theoremBoundary(candidate, transaction.scope.theorem)

    if (transaction.scope.kind === "proof_region") {
      const boundary = transaction.regionBoundary!
      if (!candidate.startsWith(boundary.prefix) || !candidate.endsWith(boundary.suffix)) {
        throw new Error(
          "proof_transaction_scope_rejection: lemma child edits must remain inside the assigned proof_region",
        )
      }
      const region = candidate.slice(boundary.prefix.length, candidate.length - boundary.suffix.length)
      if (!region.startsWith(transaction.scope.beginMarker) || !region.endsWith(transaction.scope.endMarker)) {
        throw new Error(
          "proof_transaction_scope_rejection: assigned proof_region begin/end markers must be preserved",
        )
      }
      if (
        region.split(transaction.scope.beginMarker).length - 1 !== 1 ||
        region.split(transaction.scope.endMarker).length - 1 !== 1
      ) {
        throw new Error("proof_transaction_scope_rejection: assigned proof_region markers cannot be duplicated")
      }
      assertProofSegment(candidate, transaction.theoremBoundary!)
      return
    }

    const boundary = transaction.theoremBoundary!
    if (transaction.scope.kind === "theorem_spine") {
      if (
        !candidate.startsWith(boundary.theoremPrefix) ||
        !protectedSuffixMatches(candidateBoundary.suffix, boundary.suffix)
      ) {
        throw new Error(
          "proof_transaction_scope_rejection: explicit theorem-spine repair must preserve the surrounding module/file prefix and suffix",
        )
      }
      const theoremSegment = candidate.slice(
        boundary.theoremPrefix.length,
        candidate.length - boundary.suffix.length,
      )
      const maskedTheorem = maskCoqCommentsAndStrings(theoremSegment)
      if (!maskedTheorem || /\bEnd\s+[A-Za-z0-9_']+\s*\./.test(maskedTheorem)) {
        throw new Error("proof_transaction_structure_rejection: an End command was copied into the theorem repair")
      }
      return
    }
    assertProofSegment(candidate, boundary)
  }

  function reauthorize(transaction: Transaction, scope: AuthorizedScope) {
    if (scopeKey(scope) === scopeKey(transaction.scope)) return
    if (scope.theorem !== transaction.scope.theorem) {
      throw new Error(
        `proof_transaction_scope_rejection: cannot reauthorize theorem ${transaction.scope.theorem} as ${scope.theorem}`,
      )
    }
    const previousScope = transaction.scope
    const previousTheoremBoundary = transaction.theoremBoundary
    const previousRegionBoundary = transaction.regionBoundary
    transaction.scope = scope
    try {
      transaction.theoremBoundary = theoremBoundary(transaction.stagedSource, scope.theorem)
      transaction.regionBoundary =
        scope.kind === "proof_region" ? regionBoundary(transaction.stagedSource, scope) : undefined
      assertAuthorized(transaction, transaction.stagedSource)
    } catch (error) {
      transaction.scope = previousScope
      transaction.theoremBoundary = previousTheoremBoundary
      transaction.regionBoundary = previousRegionBoundary
      throw error
    }
  }

  function summary(transaction: Transaction): Summary {
    return {
      transaction_id: transaction.id,
      file: transaction.file,
      scope: transaction.scope.kind,
      staged: transaction.stagedSource !== transaction.baseSource,
      revision: transaction.revision,
      source_hash: hash(transaction.stagedSource),
      recovered: transaction.recovered,
      committable_snapshot: transaction.bestCommittableSource !== undefined,
      progress_level: transaction.bestRecoveryProgressLevel ?? transaction.bestProgressLevel,
      recovery_base: transaction.recoveryBase,
      certified_revision: transaction.bestRecoveryRevision,
      certified_region_count: transaction.bestRecoveryCertifiedRegionCount,
      certified_unresolved_debt: transaction.bestRecoveryUnresolvedDebt,
      preserved_draft_revision: transaction.preservedDraftRevision,
      preserved_draft_hash: transaction.preservedDraftHash,
      accepted_snapshot: transaction.bestRecoverySource !== undefined,
      handed_off: transaction.handedOff,
      validation_pending: validationPending(transaction),
    }
  }

  function restore(input: {
    sessionID: string
    parentSessionID: string
    file: string
    source: string
    scope: AuthorizedScope
    agent: string
    preferCertifiedBaseline?: boolean
  }) {
    const root = workspace()
    const key = scopeKey(input.scope)
    const rows = Database.use((db) =>
      db
        .select()
        .from(ProofEditTransactionTable)
        .where(
          and(
            eq(ProofEditTransactionTable.workspace, root),
            eq(ProofEditTransactionTable.file, input.file),
            eq(ProofEditTransactionTable.theorem, input.scope.theorem),
            eq(ProofEditTransactionTable.scope_key, key),
          ),
        )
        .all(),
    ).sort((left, right) => {
      const certified = recoveryCandidateCompare(
        bestRecoveryCandidate(left.id),
        bestRecoveryCandidate(right.id),
      )
      return certified !== 0 ? certified : right.time_updated - left.time_updated
    })
    const baseHash = hash(input.source)
    for (const row of rows) {
      if (row.status !== "active" && row.status !== "recoverable") continue
      if (row.base_hash !== baseHash) {
        Database.use((db) =>
          db
            .update(ProofEditTransactionTable)
            .set({ status: "superseded", time_updated: Date.now() })
            .where(eq(ProofEditTransactionTable.id, row.id))
            .run(),
        )
        continue
      }

      let persisted: PersistedPayload
      try {
        persisted = JSON.parse(row.payload) as PersistedPayload
      } catch {
        continue
      }
      if (persisted.version !== 1 || scopeKey(persisted.scope) !== key) continue
      const current = Database.use((db) =>
        db
          .select()
          .from(ProofEditTransactionRevisionTable)
          .where(
            and(
              eq(ProofEditTransactionRevisionTable.transaction_id, row.id),
              eq(ProofEditTransactionRevisionTable.revision, row.current_revision),
            ),
          )
          .get(),
      )
      const best = row.best_revision === null
        ? undefined
        : Database.use((db) =>
            db
              .select()
              .from(ProofEditTransactionRevisionTable)
              .where(
                and(
                  eq(ProofEditTransactionRevisionTable.transaction_id, row.id),
                  eq(ProofEditTransactionRevisionTable.revision, row.best_revision!),
                ),
              )
              .get(),
          )
      const recoveryBest = bestRecoveryCandidate(row.id) ?? (best && row.best_progress_level
        ? {
            revision: best.revision,
            source: best.source,
            level: row.best_progress_level as "hard" | "structural",
            ...recoveryEvidence(row.best_progress_level as "hard" | "structural", best.receipt),
          }
        : undefined)
      if (!current) continue
      const transaction: Transaction = {
        id: row.id,
        workspace: root,
        sessionID: input.sessionID,
        parentSessionID: input.parentSessionID,
        agent: input.agent,
        file: input.file,
        baseSource: input.source,
        baseHash,
        stagedSource: current.source,
        revision: row.current_revision,
        bestRevision: row.best_revision ?? undefined,
        bestCommittableSource: best?.source,
        bestProgressLevel:
          row.best_progress_level === "hard" || row.best_progress_level === "structural"
            ? row.best_progress_level
            : undefined,
        bestReceipt: best?.receipt ? JSON.parse(best.receipt) : undefined,
        bestRecoveryRevision: recoveryBest?.revision,
        bestRecoverySource: recoveryBest?.source,
        bestRecoveryProgressLevel: recoveryBest?.level,
        bestRecoveryReceipt: recoveryBest?.receipt,
        bestRecoveryCertifiedRegionCount: recoveryBest?.certifiedRegionCount,
        bestRecoveryUnresolvedDebt: recoveryBest?.unresolvedDebt,
        recoveryBase: "current_draft",
        scope: persisted.scope,
        theoremBoundary: theoremBoundary(input.source, input.scope.theorem),
        // A recovered region transaction may already contain certified edits
        // from sibling regions that were accumulated before the transaction
        // was handed to this child.  Rebuild the *current* region boundary
        // from the journaled draft, while theoremBoundary below continues to
        // protect the original file/theorem prefix and suffix.
        regionBoundary: input.scope.kind === "proof_region" ? regionBoundary(current.source, input.scope) : undefined,
        recovered: true,
        handedOff: false,
        synchronizedRevision: undefined,
        createdAt: row.time_created,
        updatedAt: Date.now(),
      }
      assertAuthorized(transaction, transaction.stagedSource)
      if (input.preferCertifiedBaseline !== false) forkFromBestCertified(transaction)
      for (const [owner, active] of state()) {
        if (active.id === transaction.id) state().delete(owner)
      }
      updateJournal(transaction, "active")
      return transaction
    }
  }

  export function recoverLatest(input: {
    sessionID: string
    parentSessionID: string
    file: string
    source: string
    theorem: string
    agent: string
    preferCertifiedBaseline?: boolean
    minimumScope?: AuthorizedScope
  }) {
    const file = normalize(input.file)
    const existing = state().get(input.sessionID)
    if (existing) {
      if (existing.file !== file || existing.scope.theorem !== input.theorem) return undefined
      return summary(existing)
    }

    const root = workspace()
    const rows = Database.use((db) =>
      db
        .select()
        .from(ProofEditTransactionTable)
        .where(
          and(
            eq(ProofEditTransactionTable.workspace, root),
            eq(ProofEditTransactionTable.file, file),
            eq(ProofEditTransactionTable.theorem, input.theorem),
          ),
        )
        .orderBy(desc(ProofEditTransactionTable.time_updated))
        .all(),
    )
    const baseHash = hash(input.source)
    const candidates = rows
      .filter((row) => (row.status === "active" || row.status === "recoverable") && row.base_hash === baseHash)
      .flatMap((row) => {
        try {
          const persisted = JSON.parse(row.payload) as PersistedPayload
          return persisted.version === 1 && persisted.scope.theorem === input.theorem
            ? [{ row, persisted, recoveryBest: bestRecoveryCandidate(row.id) }]
            : []
        } catch {
          return []
        }
      })
      .sort((left, right) => {
        // Recovery quality is determined by compiler evidence, not by which
        // draft happened to be written most recently. Prefer the transaction
        // whose best snapshot certifies the most proof regions, then use debt,
        // certificate strength, scope, and recency only as tie-breakers.
        const certified = recoveryCandidateCompare(left.recoveryBest, right.recoveryBest)
        if (certified !== 0) return certified
        const priority = (scope: AuthorizedScope) =>
          scope.kind === "theorem_spine" ? 3 : scope.kind === "theorem_body" ? 2 : 1
        const scope = priority(right.persisted.scope) - priority(left.persisted.scope)
        return scope !== 0 ? scope : right.row.time_updated - left.row.time_updated
      })

    for (const { row, persisted, recoveryBest: rankedRecoveryBest } of candidates) {

      // Do not steal an in-memory transaction from a busy session in the
      // same process. An idle owner has already yielded its proof turn, so a
      // fresh prover continuation must adopt that exact staged revision
      // instead of rebuilding from the older workspace file on disk.
      const liveOwner = [...state()].find(([, transaction]) => transaction.id === row.id)
      if (liveOwner && liveOwner[0] !== input.sessionID) {
        if (SessionStatus.get(liveOwner[0]).type !== "idle") continue
        state().delete(liveOwner[0])
      }

      const current = Database.use((db) =>
        db
          .select()
          .from(ProofEditTransactionRevisionTable)
          .where(
            and(
              eq(ProofEditTransactionRevisionTable.transaction_id, row.id),
              eq(ProofEditTransactionRevisionTable.revision, row.current_revision),
            ),
          )
          .get(),
      )
      if (!current) continue
      const best = row.best_revision === null
        ? undefined
        : Database.use((db) =>
            db
              .select()
              .from(ProofEditTransactionRevisionTable)
              .where(
                and(
                  eq(ProofEditTransactionRevisionTable.transaction_id, row.id),
                  eq(ProofEditTransactionRevisionTable.revision, row.best_revision!),
                ),
              )
              .get(),
          )
      const recoveryBest = rankedRecoveryBest ?? (best && row.best_progress_level
        ? {
            revision: best.revision,
            source: best.source,
            level: row.best_progress_level as "hard" | "structural",
            ...recoveryEvidence(row.best_progress_level as "hard" | "structural", best.receipt),
          }
        : undefined)
      const transaction: Transaction = {
        id: row.id,
        workspace: root,
        sessionID: input.sessionID,
        parentSessionID: input.parentSessionID,
        agent: input.agent,
        file,
        baseSource: input.source,
        baseHash,
        stagedSource: current.source,
        revision: row.current_revision,
        bestRevision: row.best_revision ?? undefined,
        bestCommittableSource: best?.source,
        bestProgressLevel:
          row.best_progress_level === "hard" || row.best_progress_level === "structural"
            ? row.best_progress_level
            : undefined,
        bestReceipt: best?.receipt ? JSON.parse(best.receipt) : undefined,
        bestRecoveryRevision: recoveryBest?.revision,
        bestRecoverySource: recoveryBest?.source,
        bestRecoveryProgressLevel: recoveryBest?.level,
        bestRecoveryReceipt: recoveryBest?.receipt,
        bestRecoveryCertifiedRegionCount: recoveryBest?.certifiedRegionCount,
        bestRecoveryUnresolvedDebt: recoveryBest?.unresolvedDebt,
        recoveryBase: "current_draft",
        scope: persisted.scope,
        theoremBoundary: theoremBoundary(input.source, input.theorem),
        // The workspace file is intentionally not updated for staged edits.
        // Consequently, input.source can be older than the journaled draft
        // outside the currently assigned region.  Anchoring the recovered
        // region to input.source would reject legitimate cumulative edits and
        // make every fresh session exit before the model can act.  Anchor to
        // the recovered revision instead; assertProofSegment still checks the
        // original theorem/file boundary via theoremBoundary(input.source).
        regionBoundary:
          persisted.scope.kind === "proof_region" ? regionBoundary(current.source, persisted.scope) : undefined,
        recovered: true,
        handedOff: false,
        synchronizedRevision: undefined,
        createdAt: row.time_created,
        updatedAt: Date.now(),
      }
      reauthorize(transaction, broaderScope(transaction.scope, input.minimumScope))
      assertAuthorized(transaction, transaction.stagedSource)
      if (input.preferCertifiedBaseline !== false) forkFromBestCertified(transaction)
      state().set(input.sessionID, transaction)
      updateJournal(transaction, "active")
      FileTime.read(input.sessionID, file)
      return summary(transaction)
    }
  }

  export function transfer(input: {
    fromSessionID: string
    toSessionID: string
    file: string
    theorem: string
    scope?: AuthorizedScope
    preferCertifiedBaseline?: boolean
  }) {
    const transaction = state().get(input.fromSessionID)
    if (!transaction) return undefined
    if (transaction.file !== normalize(input.file) || transaction.scope.theorem !== input.theorem) return undefined
    const existing = state().get(input.toSessionID)
    if (existing && existing.id !== transaction.id) {
      throw new Error(
        `proof_transaction_conflict: target session ${input.toSessionID} already owns another proof transaction`,
      )
    }

    if (input.preferCertifiedBaseline) forkFromBestCertified(transaction)

    if (input.scope) reauthorize(transaction, input.scope)

    state().delete(input.fromSessionID)
    transaction.sessionID = input.toSessionID
    transaction.parentSessionID = input.fromSessionID
    transaction.handedOff = true
    transaction.synchronizedRevision = undefined
    transaction.updatedAt = Date.now()
    state().set(input.toSessionID, transaction)
    updateJournal(transaction, "active")
    FileTime.read(input.toSessionID, transaction.file)
    return summary(transaction)
  }

  export async function begin(input: {
    sessionID: string
    parentSessionID: string
    agent: string
    file: string
    source: string
    scope: AuthorizedScope
    preferCertifiedBaseline?: boolean
  }) {
    const file = normalize(input.file)
    if (!file.endsWith(".v")) return undefined
    const recovered = restore({ ...input, file })
    if (recovered) {
      state().set(input.sessionID, recovered)
      return summary(recovered)
    }
    const now = Date.now()
    const transaction: Transaction = {
      id: `proof_tx_${randomUUID()}`,
      workspace: workspace(),
      sessionID: input.sessionID,
      parentSessionID: input.parentSessionID,
      agent: input.agent,
      file,
      baseSource: input.source,
      baseHash: hash(input.source),
      stagedSource: input.source,
      revision: 0,
      recoveryBase: "current_draft",
      scope: input.scope,
      theoremBoundary: theoremBoundary(input.source, input.scope.theorem),
      regionBoundary: input.scope.kind === "proof_region" ? regionBoundary(input.source, input.scope) : undefined,
      recovered: false,
      handedOff: false,
      synchronizedRevision: 0,
      createdAt: now,
      updatedAt: now,
    }
    assertAuthorized(transaction, input.source)
    Database.transaction((db) => {
      db
        .insert(ProofEditTransactionTable)
        .values({
          id: transaction.id,
          workspace: transaction.workspace,
          file: transaction.file,
          theorem: transaction.scope.theorem,
          scope_key: scopeKey(transaction.scope),
          status: "active",
          payload: JSON.stringify(payload(transaction)),
          owner_session_id: transaction.sessionID,
          parent_session_id: transaction.parentSessionID,
          base_hash: transaction.baseHash,
          current_revision: 0,
          time_created: now,
          time_updated: now,
        })
        .run()
      db
        .insert(ProofEditTransactionRevisionTable)
        .values({
          id: revisionID(transaction.id, 0),
          transaction_id: transaction.id,
          revision: 0,
          source_hash: transaction.baseHash,
          source: transaction.baseSource,
          time_created: now,
          time_updated: now,
        })
        .run()
    })
    state().set(input.sessionID, transaction)
    return summary(transaction)
  }

  export function active(sessionID: string) {
    const transaction = state().get(sessionID)
    return transaction ? summary(transaction) : undefined
  }

  export function isTarget(sessionID: string, file: string) {
    const transaction = state().get(sessionID)
    return Boolean(transaction && transaction.file === normalize(file))
  }

  export function source(sessionID: string, file: string) {
    const transaction = state().get(sessionID)
    if (!transaction || transaction.file !== normalize(file)) return undefined
    return transaction.stagedSource
  }

  export function requiresStagedRead(sessionID: string, file?: string) {
    const transaction = state().get(sessionID)
    if (!transaction) return false
    if (file && transaction.file !== normalize(file)) return false
    return (
      (transaction.recovered || transaction.handedOff) &&
      // A revision-0/unchanged handoff has no staged bytes that differ from
      // the transaction baseline. Requiring a read in that case turns a
      // sequence of diagnostic-only lemma children into a false desync and
      // blocks the next valid dispatch. Any real unpublished edit still
      // requires an explicit read before the owner may act on it.
      transaction.stagedSource !== transaction.baseSource &&
      transaction.synchronizedRevision !== transaction.revision
    )
  }

  export function requiresValidation(sessionID: string, file?: string) {
    const transaction = state().get(sessionID)
    if (!transaction) return false
    if (file && transaction.file !== normalize(file)) return false
    return validationPending(transaction)
  }

  export function acknowledgeStagedRead(sessionID: string, file: string) {
    const transaction = state().get(sessionID)
    if (!transaction || transaction.file !== normalize(file)) return undefined
    transaction.synchronizedRevision = transaction.revision
    return summary(transaction)
  }

  export function assertStagedReadSynchronized(sessionID: string, file: string, action: string) {
    const transaction = state().get(sessionID)
    if (!transaction || transaction.file !== normalize(file)) return
    if (!requiresStagedRead(sessionID, file)) return
    throw new Error(
      `proof_transaction_resync_required: recovered staged revision ${transaction.revision} must be read through the read tool before ${action}; the workspace file on disk may be stale`,
    )
  }

  export async function readSource(sessionID: string, file: string) {
    return source(sessionID, file) ?? Filesystem.readText(file)
  }

  export function assertPatchTargets(sessionID: string, files: string[]) {
    const transaction = state().get(sessionID)
    if (!transaction) return
    const normalized = [...new Set(files.map((file) => normalize(file)))]
    if (normalized.length !== 1 || normalized[0] !== transaction.file) {
      throw new Error(
        "proof_transaction_scope_rejection: a proof child patch must atomically target only its authorized Coq file",
      )
    }
  }

  export function stage(input: { sessionID: string; file: string; before: string; after: string }) {
    const transaction = state().get(input.sessionID)
    if (!transaction || transaction.file !== normalize(input.file)) return undefined
    if (input.before !== transaction.stagedSource) {
      throw new Error("proof_transaction_stale_view: edit was not computed from the current staged source")
    }
    assertAuthorized(transaction, input.after)
    const previousSource = transaction.stagedSource
    const previousRevision = transaction.revision
    const previousUpdatedAt = transaction.updatedAt
    transaction.stagedSource = input.after
    transaction.revision += 1
    transaction.synchronizedRevision = transaction.revision
    transaction.updatedAt = Date.now()
    try {
      Database.transaction(() => {
        appendRevision(transaction, input.after)
        updateJournal(transaction, "active")
      })
    } catch (error) {
      transaction.stagedSource = previousSource
      transaction.revision = previousRevision
      transaction.updatedAt = previousUpdatedAt
      throw error
    }
    return summary(transaction)
  }

  export function markAccepted(input: {
    sessionID: string
    file: string
    source: string
    level?: "hard" | "structural"
    receipt?: unknown
  }) {
    const transaction = state().get(input.sessionID)
    if (!transaction || transaction.file !== normalize(input.file)) return undefined
    if (transaction.stagedSource !== input.source) {
      throw new Error("proof_transaction_stale_view: compiler result does not match the current staged source")
    }
    const level = input.level ?? "hard"
    const previous = {
      source: transaction.bestCommittableSource,
      revision: transaction.bestRevision,
      level: transaction.bestProgressLevel,
      receipt: transaction.bestReceipt,
      recoveryRevision: transaction.bestRecoveryRevision,
      recoverySource: transaction.bestRecoverySource,
      recoveryLevel: transaction.bestRecoveryProgressLevel,
      recoveryReceipt: transaction.bestRecoveryReceipt,
      recoveryCount: transaction.bestRecoveryCertifiedRegionCount,
      recoveryUnresolved: transaction.bestRecoveryUnresolvedDebt,
      updatedAt: transaction.updatedAt,
    }
    transaction.bestCommittableSource = input.source
    transaction.bestRevision = transaction.revision
    transaction.bestProgressLevel = level
    transaction.bestReceipt = input.receipt
    considerRecoveryCandidate(transaction, { source: input.source, level, receipt: input.receipt })
    transaction.updatedAt = Date.now()
    try {
      Database.transaction(() => {
        recordRevisionValidation({ transaction, level, receipt: input.receipt })
        updateJournal(transaction, "active")
      })
    } catch (error) {
      transaction.bestCommittableSource = previous.source
      transaction.bestRevision = previous.revision
      transaction.bestProgressLevel = previous.level
      transaction.bestReceipt = previous.receipt
      transaction.bestRecoveryRevision = previous.recoveryRevision
      transaction.bestRecoverySource = previous.recoverySource
      transaction.bestRecoveryProgressLevel = previous.recoveryLevel
      transaction.bestRecoveryReceipt = previous.recoveryReceipt
      transaction.bestRecoveryCertifiedRegionCount = previous.recoveryCount
      transaction.bestRecoveryUnresolvedDebt = previous.recoveryUnresolved
      transaction.updatedAt = previous.updatedAt
      throw error
    }
    return summary(transaction)
  }

  export function markCertifiedRecovery(input: {
    sessionID: string
    file: string
    source: string
    level?: "hard" | "structural"
    receipt?: unknown
  }) {
    const transaction = state().get(input.sessionID)
    if (!transaction || transaction.file !== normalize(input.file)) return undefined
    if (transaction.stagedSource !== input.source) {
      throw new Error("proof_transaction_stale_view: compiler result does not match the current staged source")
    }
    const level = input.level ?? "hard"
    const previous = {
      revision: transaction.bestRecoveryRevision,
      source: transaction.bestRecoverySource,
      level: transaction.bestRecoveryProgressLevel,
      receipt: transaction.bestRecoveryReceipt,
      count: transaction.bestRecoveryCertifiedRegionCount,
      unresolved: transaction.bestRecoveryUnresolvedDebt,
      updatedAt: transaction.updatedAt,
    }
    const changed = considerRecoveryCandidate(transaction, { source: input.source, level, receipt: input.receipt })
    transaction.updatedAt = Date.now()
    try {
      Database.transaction(() => {
        recordRevisionValidation({ transaction, level, receipt: input.receipt })
        updateJournal(transaction, "active")
      })
    } catch (error) {
      transaction.bestRecoveryRevision = previous.revision
      transaction.bestRecoverySource = previous.source
      transaction.bestRecoveryProgressLevel = previous.level
      transaction.bestRecoveryReceipt = previous.receipt
      transaction.bestRecoveryCertifiedRegionCount = previous.count
      transaction.bestRecoveryUnresolvedDebt = previous.unresolved
      transaction.updatedAt = previous.updatedAt
      throw error
    }
    return { ...summary(transaction), recovery_snapshot_updated: changed }
  }

  export function markDebug(input: { sessionID: string; file: string; source: string; receipt?: unknown }) {
    const transaction = state().get(input.sessionID)
    if (!transaction || transaction.file !== normalize(input.file)) return undefined
    if (transaction.stagedSource !== input.source) {
      throw new Error("proof_transaction_stale_view: compiler result does not match the current staged source")
    }
    const previousUpdatedAt = transaction.updatedAt
    transaction.updatedAt = Date.now()
    try {
      Database.transaction(() => {
        recordRevisionValidation({ transaction, level: "debug", receipt: input.receipt })
        updateJournal(transaction, "active")
      })
    } catch (error) {
      transaction.updatedAt = previousUpdatedAt
      throw error
    }
    return summary(transaction)
  }

  export function yieldStalledRepair(input: {
    sessionID: string
    handoffToSessionID?: string
    handoffScope?: AuthorizedScope
    draftPolicy?: "preserve_current" | "prefer_certified"
  }): StalledRepairYield | undefined {
    const transaction = state().get(input.sessionID)
    if (!transaction) return undefined

    const yieldedFromRevision = transaction.revision
    const yieldedFromHash = hash(transaction.stagedSource)
    const diagnostic = revisionDiagnostic(transaction, yieldedFromRevision)
    const draftPolicy = input.draftPolicy ?? "prefer_certified"
    const preserveCurrentDraft = draftPolicy === "preserve_current"
    if (preserveCurrentDraft && transaction.stagedSource !== transaction.baseSource) {
      transaction.preservedDraftRevision = transaction.revision
      transaction.preservedDraftHash = yieldedFromHash
      transaction.recoveryBase = "current_draft"
      transaction.updatedAt = Date.now()
      updateJournal(transaction, "active")
    } else if (transaction.bestRecoverySource !== undefined) {
      forkFromBestCertified(transaction)
    } else if (transaction.stagedSource !== transaction.baseSource) {
      const previous = {
        source: transaction.stagedSource,
        revision: transaction.revision,
        recoveryBase: transaction.recoveryBase,
        preservedDraftRevision: transaction.preservedDraftRevision,
        preservedDraftHash: transaction.preservedDraftHash,
        updatedAt: transaction.updatedAt,
      }
      transaction.preservedDraftRevision = previous.revision
      transaction.preservedDraftHash = hash(previous.source)
      transaction.stagedSource = transaction.baseSource
      transaction.revision += 1
      transaction.recoveryBase = "current_draft"
      transaction.updatedAt = Date.now()
      try {
        assertAuthorized(transaction, transaction.stagedSource)
        Database.transaction(() => {
          appendRevision(transaction, transaction.stagedSource)
          updateJournal(transaction, "active")
        })
      } catch (error) {
        transaction.stagedSource = previous.source
        transaction.revision = previous.revision
        transaction.recoveryBase = previous.recoveryBase
        transaction.preservedDraftRevision = previous.preservedDraftRevision
        transaction.preservedDraftHash = previous.preservedDraftHash
        transaction.updatedAt = previous.updatedAt
        throw error
      }
    }

    if (input.handoffScope) reauthorize(transaction, input.handoffScope)
    const handoffSessionID = input.handoffToSessionID
    let status: StalledRepairYield["status"] = "recoverable"
    if (handoffSessionID && handoffSessionID !== input.sessionID) {
      const existing = state().get(handoffSessionID)
      if (existing && existing.id !== transaction.id) {
        throw new Error(
          `proof_transaction_conflict: target session ${handoffSessionID} already owns another proof transaction`,
        )
      }
      state().delete(input.sessionID)
      transaction.sessionID = handoffSessionID
      transaction.handedOff = true
      transaction.synchronizedRevision = undefined
      transaction.updatedAt = Date.now()
      state().set(handoffSessionID, transaction)
      updateJournal(transaction, "active")
      FileTime.read(handoffSessionID, transaction.file)
      status = "handed_off"
    } else {
      transaction.updatedAt = Date.now()
      updateJournal(transaction, "recoverable")
      state().delete(input.sessionID)
    }

    return {
      ...summary(transaction),
      status,
      handoff_session_id: status === "handed_off" ? handoffSessionID : undefined,
      yielded_from_revision: yieldedFromRevision,
      yielded_from_hash: yieldedFromHash,
      resume_revision: transaction.revision,
      resume_hash: hash(transaction.stagedSource),
      draft_policy: draftPolicy,
      draft_preserved: preserveCurrentDraft && yieldedFromHash === hash(transaction.stagedSource),
      diagnostic_revision: diagnostic?.revision,
      diagnostic_progress_level:
        diagnostic?.progressLevel === "hard" ||
        diagnostic?.progressLevel === "structural" ||
        diagnostic?.progressLevel === "debug"
          ? diagnostic.progressLevel
          : undefined,
      diagnostic_receipt: diagnostic?.receipt,
    }
  }

  export async function finalize(
    sessionID: string,
    options?: { handoffToSessionID?: string; handoffScope?: AuthorizedScope },
  ): Promise<FinalizeResult | undefined> {
    const transaction = state().get(sessionID)
    if (!transaction) return undefined
    const base = summary(transaction)
    if (transaction.bestCommittableSource === undefined) {
      const handoffSessionID = options?.handoffToSessionID
      if (handoffSessionID && handoffSessionID !== sessionID) {
        const existing = state().get(handoffSessionID)
        if (!existing || existing.id === transaction.id) {
          if (options.handoffScope) reauthorize(transaction, options.handoffScope)
          state().delete(sessionID)
          transaction.sessionID = handoffSessionID
          transaction.handedOff = true
          // Synchronization is session-owner specific. The child has read its
          // own staged revision, but the receiving parent has not. Force the
          // parent through the authoritative read tool before it can edit or
          // validate the handed-off draft instead of stale workspace bytes.
          transaction.synchronizedRevision = undefined
          transaction.updatedAt = Date.now()
          state().set(handoffSessionID, transaction)
          updateJournal(transaction, "active")
          FileTime.read(handoffSessionID, transaction.file)
          return {
            ...summary(transaction),
            status: "handed_off",
            handoff_session_id: handoffSessionID,
          }
        }
      }
      transaction.updatedAt = Date.now()
      updateJournal(transaction, "recoverable")
      state().delete(sessionID)
      return { ...base, status: "recoverable" }
    }
    if (transaction.bestCommittableSource === transaction.baseSource) {
      transaction.updatedAt = Date.now()
      updateJournal(transaction, "committed")
      state().delete(sessionID)
      return { ...base, status: "unchanged" }
    }

    try {
      await FileTime.withLock(transaction.file, async () => {
        const diskSource = await Filesystem.readText(transaction.file)
        if (hash(diskSource) !== transaction.baseHash) {
          throw new Error(
            `transaction_conflict: ${transaction.file} changed after proof transaction ${transaction.id} began`,
          )
        }
        await Filesystem.writeAtomic(transaction.file, transaction.bestCommittableSource!)
        SessionProofWorkflow.recordSourceMutation(transaction.file, transaction.bestCommittableSource!)
        FileTime.read(transaction.sessionID, transaction.file)
        FileTime.read(transaction.parentSessionID, transaction.file)
      })
    } catch (error) {
      transaction.updatedAt = Date.now()
      updateJournal(transaction, "conflicted")
      state().delete(sessionID)
      throw error
    }

    await Bus.publish(File.Event.Edited, { file: transaction.file })
    await Bus.publish(FileWatcher.Event.Updated, { file: transaction.file, event: "change" })
    transaction.updatedAt = Date.now()
    updateJournal(transaction, "committed")
    state().delete(sessionID)
    return { ...base, status: "committed", receipt: transaction.bestReceipt }
  }

  export async function finalizeHandedOffAccepted(sessionID: string) {
    const transaction = state().get(sessionID)
    if (!transaction?.handedOff || transaction.bestCommittableSource === undefined) return undefined
    return finalize(sessionID)
  }

  export function abort(sessionID: string) {
    const transaction = state().get(sessionID)
    if (!transaction) return undefined
    transaction.updatedAt = Date.now()
    updateJournal(transaction, "discarded")
    state().delete(sessionID)
    return { ...summary(transaction), status: "discarded" as const }
  }
}
