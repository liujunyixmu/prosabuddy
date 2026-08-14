import { sqliteTable, text, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "./session.sql"
import { Timestamps } from "@/storage/schema.sql"

export const SessionProofWorkflowTable = sqliteTable(
  "session_proof_workflow",
  {
    session_id: text()
      .primaryKey()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    file: text().notNull(),
    payload: text().notNull(),
    ...Timestamps,
  },
  (table) => [index("session_proof_workflow_file_idx").on(table.file)],
)
