import path from "path"
import { createHash } from "crypto"
import { Instance } from "../project/instance"

type Conflict = {
  count: number
  sourceHash: string
  blocked: boolean
}

const MAX_CONSECUTIVE_CONFLICTS = 3
const state = Instance.state(() => new Map<string, Conflict>())

function normalize(file: string) {
  return path.normalize(path.isAbsolute(file) ? file : path.resolve(Instance.directory, file))
}

function key(sessionID: string, file: string) {
  return `${sessionID}\0${normalize(file)}`
}

function hash(source: string) {
  return createHash("sha256").update(source).digest("hex")
}

function proofExcerpt(source: string) {
  const lines = source.split(/\r?\n/)
  let start = -1
  for (let index = lines.length - 1; index >= 0; index--) {
    if (lines[index]?.trim() === "Proof.") {
      start = index
      break
    }
  }
  if (start < 0) start = Math.max(0, lines.length - 80)
  const selected = lines.slice(start, Math.min(lines.length, start + 100))
  const excerpt = selected.map((line, index) => `${start + index + 1}: ${line}`).join("\n")
  return excerpt.length <= 6000 ? excerpt : `${excerpt.slice(0, 6000)}\n... [current excerpt truncated]`
}

export namespace EditConflictGuard {
  export function assertAllowed(input: { sessionID: string; file: string; source: string }) {
    const current = state().get(key(input.sessionID, input.file))
    if (!current?.blocked || current.sourceHash !== hash(input.source)) return
    throw new Error(
      [
        "stale_edit_livelock: repeated stale edit conflicts are blocked until the current file is read again",
        `current_source_hash: ${current.sourceHash}`,
        `consecutive_conflicts: ${current.count}`,
        "required_next_action: read the target file/region, then compute the next edit from that returned source",
        "current_proof_excerpt:",
        proofExcerpt(input.source),
      ].join("\n"),
    )
  }

  export function recordFailure(input: { sessionID: string; file: string; source: string; reason: string }) {
    const sourceHash = hash(input.source)
    const id = key(input.sessionID, input.file)
    const previous = state().get(id)
    const count = previous?.sourceHash === sourceHash ? previous.count + 1 : 1
    const blocked = count >= MAX_CONSECUTIVE_CONFLICTS
    state().set(id, { count, sourceHash, blocked })
    return [
      blocked
        ? "stale_edit_livelock: this is the third consecutive edit conflict on the same source; further edits are blocked until read"
        : "stale_edit_conflict: the proposed edit was computed from stale or mismatched source",
      `current_source_hash: ${sourceHash}`,
      `consecutive_conflicts: ${count}`,
      `cause: ${input.reason}`,
      "required_next_action: use read on this file and copy the exact current region before editing again",
      "current_proof_excerpt:",
      proofExcerpt(input.source),
    ].join("\n")
  }

  export function recordSuccess(sessionID: string, file: string) {
    state().delete(key(sessionID, file))
  }

  export function recordRead(sessionID: string, file: string) {
    state().delete(key(sessionID, file))
  }
}
