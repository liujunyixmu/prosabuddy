import { describe, expect, test } from "bun:test"
import { assertNoRewriteBang, hasRewriteBang } from "../../src/tool/coq-style-guard"

describe("coq-style-guard", () => {
  test("allows ordinary rewrite tactics", () => {
    expect(hasRewriteBang("rewrite H.")).toBe(false)
    expect(hasRewriteBang("rewrite /= H.")).toBe(false)
    expect(() => assertNoRewriteBang("rewrite /foo H.")).not.toThrow()
  })

  test("rejects repeat rewrite with bang", () => {
    expect(hasRewriteBang("rewrite !addnA.")).toBe(true)
    expect(hasRewriteBang("rewrite !.")).toBe(true)
    expect(() => assertNoRewriteBang("rewrite !addnA.")).toThrow("rewrite !...")
  })

  test("rejects reverse repeat rewrite", () => {
    expect(hasRewriteBang("rewrite -!addnA.")).toBe(true)
    expect(() => assertNoRewriteBang("rewrite -!addnA.")).toThrow("rewrite !...")
  })

  test("rejects repeat rewrite after simplification and line breaks", () => {
    expect(hasRewriteBang("rewrite /=\n  !foo.")).toBe(true)
    expect(() => assertNoRewriteBang("rewrite /=\n  !foo.")).toThrow("rewrite !...")
  })
})