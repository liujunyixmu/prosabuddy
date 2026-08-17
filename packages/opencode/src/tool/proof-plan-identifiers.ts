import type { ProofPlanStep as ProofPlanStepValue } from "./proof-schema"

const MACHINE_PLAN_NODE_ID = /^[A-Za-z][A-Za-z0-9_-]*$/

function planNodeSlug(value: string, index: number) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
  const withFallback = slug || `node_${index + 1}`
  return /^[A-Za-z]/.test(withFallback) ? withFallback : `node_${withFallback}`
}

export function machineProofPlanNodeID(node: ProofPlanStepValue, index = 0) {
  const explicit = node.node_id?.trim()
  return explicit && MACHINE_PLAN_NODE_ID.test(explicit)
    ? explicit
    : planNodeSlug(explicit || node.paper_step_id, index)
}

/**
 * Give every structured proof-plan node a stable machine-safe identifier
 * before review, persistence, or materialization. paper_step_id remains the
 * human-facing label; marker equality and DAG references use node_id only.
 */
export function normalizeProofPlanIdentifiers(
  inputNodes: ProofPlanStepValue[],
  inputEdges?: { from: string; to: string }[],
) {
  const used = new Set<string>()
  const aliases = new Map<string, string | undefined>()

  function registerAlias(alias: string | undefined, id: string) {
    const key = alias?.trim()
    if (!key) return
    if (!aliases.has(key)) {
      aliases.set(key, id)
      return
    }
    if (aliases.get(key) !== id) aliases.set(key, undefined)
  }

  const identities = inputNodes.map((node, index) => {
    const base = machineProofPlanNodeID(node, index)
    let id = base
    let suffix = 2
    while (used.has(id)) id = `${base}_${suffix++}`
    used.add(id)
    registerAlias(node.node_id, id)
    registerAlias(node.paper_step_id, id)
    registerAlias(id, id)
    return id
  })

  const resolve = (value: string) => aliases.get(value.trim()) ?? value
  const nodes = inputNodes.map((node, index) => ({
    ...node,
    node_id: identities[index]!,
    depends_on: (node.depends_on ?? []).map(resolve),
    consumers: (node.consumers ?? []).map(resolve),
    dependency_uses: (node.dependency_uses ?? []).map((entry) => ({
      ...entry,
      producer_node: resolve(entry.producer_node),
    })),
    prosa_candidate_lemmas: (node.prosa_candidate_lemmas ?? []).map((candidate) => ({
      ...candidate,
      premise_sources: (candidate.premise_sources ?? []).map((source) => ({
        ...source,
        dependency_node: source.dependency_node ? resolve(source.dependency_node) : undefined,
      })),
    })),
    mathcomp_candidate_lemmas: (node.mathcomp_candidate_lemmas ?? []).map((candidate) => ({
      ...candidate,
      premise_sources: (candidate.premise_sources ?? []).map((source) => ({
        ...source,
        dependency_node: source.dependency_node ? resolve(source.dependency_node) : undefined,
      })),
    })),
  }))
  const edges = inputEdges?.map((edge) => ({ from: resolve(edge.from), to: resolve(edge.to) }))
  return { nodes, edges }
}
