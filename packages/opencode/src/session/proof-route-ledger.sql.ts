import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

export const ProofRouteFailureTable = sqliteTable(
  "proof_route_failure",
  {
    id: text().primaryKey(),
    workspace: text().notNull(),
    file: text().notNull(),
    theorem: text().notNull(),
    theorem_context_fingerprint: text().notNull(),
    semantic_fingerprint: text().notNull(),
    confidence: text().notNull(),
    status: text().notNull(),
    payload: text().notNull(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("proof_route_failure_scope_semantic_idx").on(
      table.workspace,
      table.file,
      table.theorem,
      table.theorem_context_fingerprint,
      table.semantic_fingerprint,
    ),
    index("proof_route_failure_scope_status_idx").on(
      table.workspace,
      table.file,
      table.theorem,
      table.status,
    ),
  ],
)
