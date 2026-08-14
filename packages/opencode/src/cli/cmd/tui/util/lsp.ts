import type { LspStatus } from "@opencode-ai/sdk/v2"
import path from "path"

type Range = {
  start: {
    line: number
    character: number
  }
  end: {
    line: number
    character: number
  }
}

export type RocqStatus = {
  state?: "Busy" | "Idle" | "Stopped"
  modname?: string
  progress: {
    path: string
    count: number
  }[]
  execution: {
    path: string
    range?: Range
  }[]
  current?: {
    path: string
    goal?: string
    hyps: string[]
    error?: string
  }
}

export type RichLspStatus = LspStatus & {
  rocq?: RocqStatus
}

export function pickLsp(list: RichLspStatus[], dir: string) {
  const rocq = list.filter((item) => item.rocq)
  if (rocq.length <= 1) return list

  const here = path.resolve(dir)
  const pick = rocq
    .map((item) => ({
      item,
      root: path.resolve(here, item.root || "."),
      depth: item.root.split("/").filter(Boolean).length,
    }))
    .toSorted((a, b) => {
      const ax = a.root === here ? 1 : 0
      const bx = b.root === here ? 1 : 0
      if (ax !== bx) return bx - ax
      if (a.depth !== b.depth) return a.depth - b.depth
      return a.item.root.localeCompare(b.item.root)
    })[0]?.item

  if (!pick) return list
  return list.filter((item) => !item.rocq || item === pick)
}

function join(list: string[], total: number) {
  const text = list.join(", ")
  const extra = total - list.length
  if (extra <= 0) return text
  return `${text}, +${extra} more`
}

function loc(range?: Range) {
  if (!range) return ""
  const start = range.start.line + 1
  const end = range.end.line + 1
  if (start === end) return `:${start}`
  return `:${start}-${end}`
}

export function rocqProgress(input: RocqStatus) {
  if (input.progress.length === 0) return
  return `Processing ${join(
    input.progress.slice(0, 2).map((item) => `${item.path} (${item.count})`),
    input.progress.length,
  )}`
}

export function rocqExecution(input: RocqStatus) {
  if (input.execution.length === 0) return
  return `Cursor ${join(
    input.execution.slice(0, 2).map((item) => `${item.path}${loc(item.range)}`),
    input.execution.length,
  )}`
}

export function rocqEnv(input: RocqStatus) {
  if (!input.current) return ["No context"]
  if (input.current.hyps.length === 0) {
    if (input.current.error) return [input.current.error]
    return ["No hypotheses"]
  }
  if (input.current.hyps.length <= 3) return input.current.hyps
  return [...input.current.hyps.slice(0, 3), `+${input.current.hyps.length - 3} more`]
}

export function rocqGoal(input: RocqStatus) {
  if (!input.current) return "No goal"
  if (input.current.goal) return input.current.goal
  if (input.current.error) return input.current.error
  return "No goal"
}