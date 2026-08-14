import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

export const ProofEditTransactionTable = sqliteTable(
  "proof_edit_transaction",
  {
    id: text().primaryKey(),
    workspace: text().notNull(),
    file: text().notNull(),
    theorem: text().notNull(),
    scope_key: text().notNull(),
    status: text().notNull(),
    payload: text().notNull(),
    owner_session_id: text().notNull(),
    parent_session_id: text().notNull(),
    base_hash: text().notNull(),
    current_revision: integer().notNull(),
    best_revision: integer(),
    best_progress_level: text(),
    ...Timestamps,
  },
  (table) => [
    index("proof_edit_transaction_recovery_idx").on(
      table.workspace,
      table.file,
      table.theorem,
      table.scope_key,
      table.status,
    ),
    index("proof_edit_transaction_owner_idx").on(table.owner_session_id, table.status),
  ],
)

export const ProofEditTransactionRevisionTable = sqliteTable(
  "proof_edit_transaction_revision",
  {
    id: text().primaryKey(),
    transaction_id: text()
      .notNull()
      .references(() => ProofEditTransactionTable.id, { onDelete: "cascade" }),
    revision: integer().notNull(),
    source_hash: text().notNull(),
    progress_level: text(),
    source: text().notNull(),
    receipt: text(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("proof_edit_transaction_revision_idx").on(table.transaction_id, table.revision),
    index("proof_edit_transaction_revision_progress_idx").on(table.transaction_id, table.progress_level),
  ],
)
