import { describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"

const ROLLOVER = 1_786_706_395_136

function legacyAscending(timestamp: number) {
  const encoded = (BigInt(timestamp) * 0x1000n + 1n) & ((1n << 48n) - 1n)
  return `msg_${encoded.toString(16).padStart(12, "0")}${"A".repeat(14)}`
}

describe("identifier timestamp encoding", () => {
  test("keeps ascending IDs ordered across the legacy 48-bit rollover boundary", () => {
    const before = Identifier.create("message", false, ROLLOVER - 1)
    const after = Identifier.create("message", false, ROLLOVER)

    expect(before < after).toBe(true)
    expect(Identifier.timestamp(before)).toBe(ROLLOVER - 1)
    expect(Identifier.timestamp(after)).toBe(ROLLOVER)
    expect(before).toHaveLength(30)
    expect(after).toHaveLength(30)
  })

  test("puts new ascending IDs after stored legacy IDs during migration", () => {
    const legacy = legacyAscending(ROLLOVER - 1)
    const current = Identifier.create("message", false, ROLLOVER)

    expect(legacy < current).toBe(true)
  })

  test("keeps descending IDs ordered across the boundary", () => {
    const before = Identifier.create("session", true, ROLLOVER - 1)
    const after = Identifier.create("session", true, ROLLOVER)

    expect(after < before).toBe(true)
    expect(after).toHaveLength(30)
  })

  test("continues to decode legacy 12-hex timestamp fields", () => {
    expect(Identifier.timestamp(legacyAscending(12_345))).toBe(12_345)
  })
})
