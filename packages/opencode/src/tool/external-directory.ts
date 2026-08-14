import path from "path"
import type { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"

type Kind = "file" | "directory"

type Options = {
  bypass?: boolean
  kind?: Kind
}

function strictWorkspaceBoundaryEnabled() {
  return /^(?:1|true|yes)$/i.test(process.env.OPENCODE_STRICT_WORKSPACE_BOUNDARY ?? "")
}

export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  if (!target) return

  if (options?.bypass) return

  if (strictWorkspaceBoundaryEnabled() && !Filesystem.contains(Instance.directory, target)) {
    throw new Error(`Path must stay within workspace: ${Instance.directory}`)
  }

  if (Instance.containsPath(target)) return

  const kind = options?.kind ?? "file"
  const parentDir = kind === "directory" ? target : path.dirname(target)
  const glob = path.join(parentDir, "*").replaceAll("\\", "/")

  await ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [glob],
    metadata: {
      filepath: target,
      parentDir,
    },
  })
}
