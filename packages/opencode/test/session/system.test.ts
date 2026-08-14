import { describe, expect, test } from "bun:test"
import { SystemPrompt } from "../../src/session/system"

describe("session.system shared proof workflow", () => {
  test("instructions include the shared proof workflow policy", () => {
    const instructions = SystemPrompt.instructions()

    expect(instructions).toContain("# Shared Proof Workflow Policy")
    expect(instructions).toContain("Phase 1 comes first: build a theorem-level skeleton")
    expect(instructions).toContain("`proof_region begin/end` is the sole delegation boundary")
    expect(instructions).toContain("After all lemma-owned regions are solved, return to Layer 1 for final merge and final validation")
    expect(instructions).toContain("do not redispatch the same stale `admit_id`")
  })
})