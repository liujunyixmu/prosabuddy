CREATE TABLE `session_proof_workflow` (
  `session_id` text PRIMARY KEY NOT NULL REFERENCES `session`(`id`) ON DELETE CASCADE,
  `file` text NOT NULL,
  `payload` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `session_proof_workflow_file_idx` ON `session_proof_workflow` (`file`);
