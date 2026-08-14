import { createHash } from "crypto"
import type z from "zod"
import { ProofRouteLedger } from "@/session/proof-route-ledger"
import * as CoqProject from "./coq-project"
import { CandidateLemmaAudit, ProofPlanCandidateLemma, ProofPlanStep } from "./proof-schema"

type PlanStep = z.infer<typeof ProofPlanStep>
type Candidate = z.infer<typeof ProofPlanCandidateLemma>

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index]!, index)
    }
  })
  await Promise.all(workers)
  return results
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function maskCommentsAndStrings(source: string) {
  const masked = [...source]
  let commentDepth = 0
  let inString = false
  for (let index = 0; index < source.length; index++) {
    const pair = source.slice(index, index + 2)
    if (commentDepth > 0) {
      if (pair === "(*") {
        masked[index] = masked[index + 1] = " "
        commentDepth += 1
        index += 1
      } else if (pair === "*)") {
        masked[index] = masked[index + 1] = " "
        commentDepth -= 1
        index += 1
      } else if (source[index] !== "\n") masked[index] = " "
      continue
    }
    if (inString) {
      if (source[index] === '"' && source[index + 1] === '"') {
        masked[index] = masked[index + 1] = " "
        index += 1
      } else {
        if (source[index] === '"') inString = false
        if (source[index] !== "\n") masked[index] = " "
      }
      continue
    }
    if (pair === "(*") {
      masked[index] = masked[index + 1] = " "
      commentDepth = 1
      index += 1
    } else if (source[index] === '"') {
      masked[index] = " "
      inString = true
    }
  }
  return commentDepth === 0 && !inString ? masked.join("") : undefined
}

function theoremProbeContext(source: string, theorem: string) {
  const masked = maskCommentsAndStrings(source)
  if (!masked) return undefined
  const escaped = theorem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const declaration = new RegExp(
    `\\b(?:Lemma|Theorem|Corollary|Proposition|Fact|Remark|Example)\\s+${escaped}\\b`,
  ).exec(masked)
  if (!declaration || declaration.index === undefined) return undefined
  const tail = masked.slice(declaration.index)
  const proof = /\bProof\s*\./.exec(tail)
  if (!proof || proof.index === undefined) return undefined
  const proofStart = declaration.index + proof.index
  const declarationText = source.slice(declaration.index, proofStart).trim()
  const renamed = declarationText.replace(
    new RegExp(`^(\\s*(?:Lemma|Theorem|Corollary|Proposition|Fact|Remark|Example)\\s+)${escaped}\\b`),
    "$1__opencode_premise_audit",
  )
  return {
    prefix: source.slice(0, declaration.index),
    declaration: renamed,
  }
}

function residualGoals(output: string, marker: string) {
  const beforeDone = output.split(`${marker}_DONE`)[0] ?? output
  return beforeDone
    .split(`${marker}_RESIDUAL`)
    .slice(1)
    .map(normalize)
    .filter(Boolean)
}

function exactType(output: string, marker: string) {
  const before = output.split(marker)[0] ?? ""
  return normalize(before.split(/\n\d+\s+goals?\b/i)[0] ?? before)
}

export async function auditCandidateLemma(input: {
  file: string
  source: string
  theorem: string
  formalGoal: string
  candidate: Candidate
  signal?: AbortSignal
}): Promise<z.infer<typeof CandidateLemmaAudit>> {
  const auditedAt = Date.now()
  const targetFingerprint = ProofRouteLedger.targetContractFingerprint(input.formalGoal)
  const context = theoremProbeContext(input.source, input.theorem)
  if (!context) {
    return CandidateLemmaAudit.parse({
      lemma: input.candidate.name,
      target_contract_fingerprint: targetFingerprint,
      conclusion_compatible: false,
      verdict: "audit_error",
      diagnostic: `Could not isolate theorem ${input.theorem} for a premise audit.`,
      audited_at: auditedAt,
    })
  }

  const marker = `OPENCODE_PREMISE_AUDIT_${hash(`${input.candidate.name}\n${input.formalGoal}`).slice(0, 12)}`
  const role = input.candidate.role ?? "direct_apply"
  const directApplication = role === "direct_apply"
  const script = [
    context.prefix,
    "Set Printing Implicit.",
    `Check ${input.candidate.name}.`,
    "Goal True.",
    `  idtac "${marker}".`,
    "  exact I.",
    "Qed.",
    directApplication ? context.declaration : undefined,
    directApplication ? "Proof." : undefined,
    directApplication ? "  intros." : undefined,
    directApplication ? `  assert (${input.formalGoal}) as __opencode_candidate_goal.` : undefined,
    // A proof-plan node may quantify its own variables and assumptions even
    // after the enclosing theorem context has been introduced.  Applying the
    // candidate before opening those binders makes Coq try to unify the
    // candidate conclusion with the binder's carrier (for example
    // `Equality.sort Job`) instead of the node conclusion.
    directApplication ? "  { intros." : undefined,
    directApplication ? `    eapply ${input.candidate.name}.` : undefined,
    directApplication ? "    all: try assumption." : undefined,
    directApplication ? "    all: try reflexivity." : undefined,
    directApplication
      ? `    all: match goal with | [ |- ?G ] => idtac "${marker}_RESIDUAL" G end.`
      : undefined,
    directApplication ? "    all: admit. }" : undefined,
    directApplication ? `  idtac "${marker}_DONE".` : undefined,
    directApplication ? "Abort." : undefined,
  ].filter((line): line is string => Boolean(line)).join("\n")

  try {
    const result = await CoqProject.run(script, input.file, [], { signal: input.signal })
    const combined = CoqProject.cleanOutput([result.stdout, result.stderr].filter(Boolean).join("\n"))
    const typeText = exactType(combined, marker)
    const compilerOutputHash = hash(combined)
    if (result.exit !== 0 || !combined.includes(marker)) {
      return CandidateLemmaAudit.parse({
        lemma: input.candidate.name,
        exact_type: typeText || undefined,
        lemma_type_fingerprint: typeText ? hash(typeText) : undefined,
        target_contract_fingerprint: targetFingerprint,
        conclusion_compatible: false,
        verdict: "interface_mismatch",
        diagnostic: combined.slice(-4000) || `Coq rejected ${input.candidate.name} for the candidate target.`,
        compiler_output_hash: compilerOutputHash,
        audited_at: auditedAt,
      })
    }

    if (!directApplication) {
      return CandidateLemmaAudit.parse({
        lemma: input.candidate.name,
        exact_type: typeText || undefined,
        lemma_type_fingerprint: typeText ? hash(typeText) : undefined,
        target_contract_fingerprint: targetFingerprint,
        instantiation_fingerprint: hash(
          [role, typeText, normalize(input.formalGoal)].join("\n"),
        ),
        conclusion_compatible: false,
        residual_premises: [],
        residual_premise_fingerprints: [],
        verdict: "available",
        diagnostic:
          `Coq resolved ${input.candidate.name} with role ${role}. ` +
          "This role is type-checked for availability but is not required to close the complete plan-node target; its concrete rewrite, transport, local-fact, or automation use will be checked during proof materialization.",
        compiler_output_hash: compilerOutputHash,
        audited_at: auditedAt,
      })
    }

    const afterMarker = combined.split(marker).slice(1).join(marker)
    const premises = residualGoals(afterMarker, marker)
    const premiseFingerprints = premises.map(ProofRouteLedger.premiseFingerprint)
    return CandidateLemmaAudit.parse({
      lemma: input.candidate.name,
      exact_type: typeText || undefined,
      lemma_type_fingerprint: typeText ? hash(typeText) : undefined,
      target_contract_fingerprint: targetFingerprint,
      instantiation_fingerprint: hash(
        [typeText, normalize(input.formalGoal), ...premiseFingerprints].join("\n"),
      ),
      conclusion_compatible: true,
      residual_premises: premises,
      residual_premise_fingerprints: premiseFingerprints,
      verdict: premises.length === 0 ? "usable" : "bridge_required",
      diagnostic:
        premises.length === 0
          ? "Coq applied the candidate and discharged every residual premise with the live local context."
          : `Coq application left ${premises.length} residual premise(s); each must be mapped to a dependency or current compiler certificate before materialization.`,
      compiler_output_hash: compilerOutputHash,
      audited_at: auditedAt,
    })
  } catch (error) {
    if (input.signal?.aborted) throw error
    return CandidateLemmaAudit.parse({
      lemma: input.candidate.name,
      target_contract_fingerprint: targetFingerprint,
      conclusion_compatible: false,
      verdict: "audit_error",
      diagnostic: error instanceof Error ? error.message : String(error),
      audited_at: auditedAt,
    })
  }
}

export async function auditPlanLibraryCandidates(input: {
  file: string
  source: string
  theorem: string
  nodes: PlanStep[]
  signal?: AbortSignal
}) {
  // Each audit starts a compiler subprocess. Bound concurrency per proof_plan
  // so two experiment workers cannot multiply a large candidate list into an
  // unbounded coqc burst and create resource-driven false timeouts.
  return mapLimit(input.nodes, 1, async (node) => {
    const candidates = [
      ...node.prosa_candidate_lemmas.map((candidate) => ({ kind: "prosa" as const, candidate })),
      ...node.mathcomp_candidate_lemmas.map((candidate) => ({ kind: "mathcomp" as const, candidate })),
    ]
    const audited = await mapLimit(candidates, 2, async ({ kind, candidate }) => ({
      kind,
      ...candidate,
      audit: await auditCandidateLemma({
        file: input.file,
        source: input.source,
        theorem: input.theorem,
        formalGoal: node.formal_goal,
        candidate,
        signal: input.signal,
      }),
    }))
    return {
      ...node,
      prosa_candidate_lemmas: audited
        .filter((entry) => entry.kind === "prosa")
        .map(({ kind: _, ...candidate }) => candidate),
      mathcomp_candidate_lemmas: audited
        .filter((entry) => entry.kind === "mathcomp")
        .map(({ kind: _, ...candidate }) => candidate),
    }
  })
}
