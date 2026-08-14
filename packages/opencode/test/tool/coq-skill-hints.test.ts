import { describe, expect, test } from "bun:test"
import { coqSkillHintsFor, formatCoqSkillHints } from "../../src/tool/coq-skill-hints"

function names(message: string) {
  return coqSkillHintsFor(message).map((hint) => hint.name)
}

describe("coq skill hints", () => {
  test("maps focus drift errors to goal focus guidance", () => {
    const formatted = formatCoqSkillHints("Error: Expected a single focused goal but 2 goals are focused.")

    expect(names("Error: Expected a single focused goal but 2 goals are focused.")).toContain("goal-focus-discipline")
    expect(formatted).toContain("direct_focus_fix")
    expect(formatted).toContain("`{ ... }`")
    expect(formatted).toContain("skip skill lookup and edit now")
  })

  test("maps rewrite shape mismatches to failure signature and proof-state guidance", () => {
    const result = names("The LHS of mul1n does not match any subterm of the goal.")

    expect(result).toContain("coq-failure-signatures")
    expect(result).toContain("coq-proof-state-discipline")
  })

  test("maps compact by failures to by expansion guidance", () => {
    expect(names("Error: No applicable tactic.")).toContain("by-expansion-diagnostics")
  })

  test("maps early-bound application errors to goal-driven apply guidance", () => {
    expect(names("Error: Not enough uninstantiated existential variables.")).toContain("coq-goal-driven-apply")
  })

  test("maps service inversion goals to the dedicated service inversion pattern", () => {
    expect(names("Unable to apply service_inversion_is_bounded to service_inversion_is_bounded_by goal.")).toContain(
      "service-inversion-pattern",
    )
  })

  test("formats optional skill tool calls", () => {
    const formatted = formatCoqSkillHints("Syntax error: illegal tactic.")

    expect(formatted).toContain("<coq_skill_hints>")
    expect(formatted).toContain("optional targeted skill lookups")
    expect(formatted).toContain("skip skill lookup and edit now")
    expect(formatted).toContain("rocq-proof-methodology")
    expect(formatted).toContain('skill({ name: "rocq-proof-methodology" })')
  })
})