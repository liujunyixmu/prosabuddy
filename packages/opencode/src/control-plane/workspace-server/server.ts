import { Server } from "@/server/server"
import type { ResolvedNetworkOptions } from "@/cli/network"

export namespace WorkspaceServer {
  export function Listen(opts: ResolvedNetworkOptions) {
    return Server.listen(opts)
  }
}
