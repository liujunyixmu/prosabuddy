import type { MiddlewareHandler } from "hono"

export const WorkspaceRouterMiddleware: MiddlewareHandler = async (_c, next) => {
  await next()
}
