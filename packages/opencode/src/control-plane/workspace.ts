import z from "zod"
import { eq, and } from "drizzle-orm"
import { fn } from "@/util/fn"
import { Identifier } from "@/id/id"
import { Database } from "@/storage/db"
import type { Project } from "@/project/project"
import { WorkspaceTable } from "./workspace.sql"

export namespace Workspace {
  export const Config = z.record(z.string(), z.unknown())

  export const Info = z
    .object({
      id: Identifier.schema("workspace"),
      projectID: z.string(),
      branch: z.string().optional(),
      config: Config,
    })
    .meta({
      ref: "Workspace",
    })
  export type Info = z.output<typeof Info>

  function fromRow(row: typeof WorkspaceTable.$inferSelect): Info {
    return {
      id: row.id,
      projectID: row.project_id,
      branch: row.branch ?? undefined,
      config: row.config,
    }
  }

  export const create = fn(
    z.object({
      id: Identifier.schema("workspace").optional(),
      projectID: z.string(),
      branch: z.string().optional(),
      config: Config.default({}),
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .insert(WorkspaceTable)
          .values({
            id: Identifier.ascending("workspace", input.id),
            project_id: input.projectID,
            branch: input.branch,
            config: input.config,
          })
          .returning()
          .get()
        return fromRow(row)
      })
    },
  )

  export function list(project: Project.Info): Info[] {
    return Database.use((db) =>
      db
        .select()
        .from(WorkspaceTable)
        .where(eq(WorkspaceTable.project_id, project.id))
        .all()
        .map(fromRow),
    )
  }

  export async function remove(id: string): Promise<Info | undefined> {
    return Database.use((db) => {
      const row = db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, id)).returning().get()
      return row ? fromRow(row) : undefined
    })
  }

  export function get(projectID: string, id: string): Info | undefined {
    return Database.use((db) => {
      const row = db
        .select()
        .from(WorkspaceTable)
        .where(and(eq(WorkspaceTable.project_id, projectID), eq(WorkspaceTable.id, id)))
        .get()
      return row ? fromRow(row) : undefined
    })
  }
}
