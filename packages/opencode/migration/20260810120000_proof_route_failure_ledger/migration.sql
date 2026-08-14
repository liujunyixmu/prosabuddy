CREATE TABLE `proof_route_failure` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace` text NOT NULL,
  `file` text NOT NULL,
  `theorem` text NOT NULL,
  `theorem_context_fingerprint` text NOT NULL,
  `semantic_fingerprint` text NOT NULL,
  `confidence` text NOT NULL,
  `status` text NOT NULL,
  `payload` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `proof_route_failure_scope_semantic_idx` ON `proof_route_failure` (`workspace`,`file`,`theorem`,`theorem_context_fingerprint`,`semantic_fingerprint`);--> statement-breakpoint
CREATE INDEX `proof_route_failure_scope_status_idx` ON `proof_route_failure` (`workspace`,`file`,`theorem`,`status`);
