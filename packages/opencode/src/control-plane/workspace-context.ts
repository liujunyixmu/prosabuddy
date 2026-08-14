import { Context } from "@/util/context"

export namespace WorkspaceContext {
  const context = Context.create<{ workspaceID?: string }>("workspace")

  export function provide<T>(input: { workspaceID?: string; fn: () => T }): T {
    return context.provide({ workspaceID: input.workspaceID }, input.fn)
  }

  export function current() {
    try {
      return context.use()
    } catch {
      return {}
    }
  }
}
