import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "./session.sql"
import { Timestamps } from "@/storage/schema.sql"

/**
 * Persistent proof binding per session.
 * Single source of truth for "which proof point this session is tracking".
 */
export const SessionProofTable = sqliteTable(
  "session_proof",
  {
    session_id: text()
      .primaryKey()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    file: text().notNull(),
    uri: text().notNull(),
    line: integer().notNull(),
    character: integer().notNull(),
    source: text().notNull().$type<"auto" | "tool" | "ide" | "parent" | "manual">(),
    locked: integer({ mode: "boolean" }).notNull().default(false),
    stale: integer({ mode: "boolean" }).notNull().default(false),
    doc_version: integer(),
    canonical_source: text(),
    ...Timestamps,
  },
  (table) => [index("session_proof_file_idx").on(table.file)],
)
