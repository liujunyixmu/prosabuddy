export type CoqSkillHint = {
  name: string
  reason: string
}

function has(text: string, pattern: RegExp) {
  return pattern.test(text)
}

export function coqSkillHintsFor(message: string): CoqSkillHint[] {
  const text = message.toLowerCase()
  const hints: CoqSkillHint[] = []
  const seen = new Set<string>()

  const add = (name: string, reason: string) => {
    if (seen.has(name)) return
    seen.add(name)
    hints.push({ name, reason })
  }

  if (
    has(
      text,
      /expected a single focused goal|focused goal|no such goal|wrong bullet|current bullet|focus|shelved goal|unshelve|already used|variable .* was not found|no product even after head-reduction/,
    )
  ) {
    add(
      "goal-focus-discipline",
      "proof-state drift, branch focus, bullets, braces, or have-generated subgoals may be the real blocker; direct common repair: use `{ ... }` around the current branch/subproof so only one goal is focused before continuing",
    )
  }

  if (has(text, /no applicable tactic|\bby\b|;\s*by|have .* by|suff .* by|case .*;.*by/)) {
    add(
      "by-expansion-diagnostics",
      "a compressed by-script may be hiding the first useful remaining goal, branch split, rewrite mismatch, or apply mismatch",
    )
  }

  if (
    has(
      text,
      /big_mkcond|sum1_count|big_filter|count_exceeding|nat\.min|minn|if .* then 1 else 0/,
    ) ||
    (has(text, /\bcount\b|\bfilter\b/) && has(text, /does not match any subterm|lhs of|unable to unify|cannot rewrite|rewrite|bigop|\\sum_|\bsum_/))
  ) {
    add(
      "ssreflect-count-bridging",
      "indicator sums, filtered big operators, counts, and min-bounds may be drifting across incompatible shapes; stabilize the branch with big_mkcond and sum1_count style bridges before the final arithmetic step",
    )
  }

  if (
    has(
      text,
      /does not match any subterm|lhs of|unable to unify|cannot rewrite|rewrite|big_const_ord|big_ord_recr|big_distrr|iter_addn|mul1n|mul0n|mulnc|muln|bigop|\\sum_|\bsum_/,
    )
  ) {
    add(
      "coq-failure-signatures",
      "the error text looks like a known rewrite or ssreflect shape mismatch with a message-to-action mapping",
    )
    add(
      "coq-proof-state-discipline",
      "the next rewrite should be chosen from the exact current goal syntax, with bridge lemmas for bigop/iter/multiplication mismatches",
    )
  }

  if (
    has(
      text,
      /not enough uninstantiated existential|uninstantiated existential|does not build instances|type class|typeclass|unable to find an instance|cannot infer|cannot apply|cannot refine|evar|existential variable|expected .* while .* is expected|apply:|eapply/,
    )
  ) {
    add(
      "coq-goal-driven-apply",
      "the theorem application may be blocked before ordinary subgoals appear by an early-bound parameter, section argument, policy, or typeclass instance",
    )
  }

  if (
    has(
      text,
      /service_inversion|service inversion|service_inversion_is_bounded|service_inversion_is_bounded_by|blocking_bound|max_lp_nonpreemptive_segment|nonpreemptive_segment/,
    )
  ) {
    add(
      "service-inversion-pattern",
      "the goal or failed theorem application matches the service_inversion_is_bounded_by proof pattern",
    )
  }

  if (
    has(
      text,
      /syntax error|parse error|illegal|ill-typed|universe inconsistency|anomaly|unknown notation|unknown interpretation|lexer|vernacular|attempt to save an incomplete proof|unsolved goals|the term .* has type|expected .* type|cannot guess decreasing argument/,
    )
  ) {
    add(
      "rocq-proof-methodology",
      "the failure is syntax, typing, incomplete-proof, tactic-selection, or general Rocq workflow related",
    )
  }

  if (hints.length === 0) {
    add(
      "rocq-proof-methodology",
      "general Coq/Rocq error recovery should start from disciplined goal inspection and one-step validation",
    )
  }

  return hints
}

export function formatCoqSkillHints(message: string) {
  const hints = coqSkillHintsFor(message)
  const focusHint = hints.find((hint) => hint.name === "goal-focus-discipline")
  return [
    "",
    "<coq_skill_hints>",
    focusHint ? "direct_focus_fix: wrap the current branch or subproof in `{ ... }` so exactly one goal is focused, then continue editing the proof." : undefined,
    "Coq/Rocq error detected. These are optional targeted skill lookups, not a blocker before editing.",
    "Use at most one skill lookup only if it directly explains the current failing goal; then make the next proof-producing edit in the current block. If the next repair is already clear, especially for a focus error fixed by `{ ... }`, skip skill lookup and edit now.",
    "Suggested optional skills:",
    ...hints.map((hint) => `- ${hint.name}: ${hint.reason}`),
    `Optional call order: ${hints.map((hint) => `skill({ name: "${hint.name}" })`).join(" -> ")}`,
    "</coq_skill_hints>",
  ].filter((line): line is string => Boolean(line)).join("\n")
}