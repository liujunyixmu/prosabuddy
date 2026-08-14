export const REWRITE_BANG_PATTERN = /\brewrite\b[^.]*[-+]?!\s*(?:[A-Za-z_/(\\]|(?=\.|$))/

export function hasRewriteBang(text: string) {
  return REWRITE_BANG_PATTERN.test(text)
}

export function assertNoRewriteBang(text: string, label = "Coq proof text") {
  if (!hasRewriteBang(text)) return
  throw new Error(
    `${label} uses the disabled ssreflect repeat-rewrite form \`rewrite !...\`. ` +
      "Write repeated rewrites explicitly one step at a time, or introduce a named bridge/normalization lemma instead.",
  )
}

export function assertNoRewriteBangInCoqFile(filePath: string, content: string) {
  if (!filePath.endsWith(".v")) return
  assertNoRewriteBang(content, `Coq file ${filePath}`)
}

export const INTUITION_PATTERN = /\bintuition\b/

export function hasIntuition(text: string) {
  return INTUITION_PATTERN.test(text)
}

export function assertNoIntuition(text: string, label = "Coq proof text") {
  if (!hasIntuition(text)) return
  throw new Error(
    `${label} uses the banned \`intuition\` tactic. ` +
      "Use explicit tactics (left, right, split, apply, exact, etc.) instead.",
  )
}

export function assertNoIntuitionInCoqFile(filePath: string, content: string) {
  if (!filePath.endsWith(".v")) return
  assertNoIntuition(content, `Coq file ${filePath}`)
}