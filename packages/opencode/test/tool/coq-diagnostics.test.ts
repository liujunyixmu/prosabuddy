import { describe, expect, test } from "bun:test"
import { parseCoqCompilerOutput } from "../../src/tool/coq-diagnostics"

describe("Coq compiler diagnostics", () => {
  test("selects the actual error after preceding warnings", () => {
    const stderr = [
      'File "/tmp/theorem.v", line 1, characters 0-38:',
      'Warning: Notations "[ pairs ( _ , _ ) <- _ | _ ]" have incompatible prefixes.',
      "[notation-incompatible-prefix,parsing,default]",
      'File "/tmp/theorem.v", line 42, characters 2-18:',
      "Error: Cannot apply lemma H_sum_pointwise.",
      "",
    ].join("\n")

    const parsed = parseCoqCompilerOutput("", stderr)
    expect(parsed.warnings).toHaveLength(1)
    expect(parsed.errors).toHaveLength(1)
    expect(parsed.firstError?.file).toBe("/tmp/theorem.v")
    expect(parsed.firstError?.line).toBe(42)
    expect(parsed.firstError?.message).toContain("Error: Cannot apply lemma H_sum_pointwise")
    expect(parsed.firstError?.message).not.toContain("Warning:")
  })

  test("finds an error emitted on stdout", () => {
    const parsed = parseCoqCompilerOutput(
      ['File "/tmp/theorem.v", line 9, characters 0-4:', "Error: Syntax error."].join("\n"),
      "",
    )
    expect(parsed.firstError?.line).toBe(9)
    expect(parsed.firstError?.message).toContain("Error: Syntax error")
  })

  test("does not promote warning-only output to an error", () => {
    const parsed = parseCoqCompilerOutput(
      "",
      ['File "/tmp/theorem.v", line 1, characters 0-4:', "Warning: Deprecated notation."].join("\n"),
    )
    expect(parsed.warnings).toHaveLength(1)
    expect(parsed.errors).toHaveLength(0)
    expect(parsed.firstError).toBeUndefined()
  })
})