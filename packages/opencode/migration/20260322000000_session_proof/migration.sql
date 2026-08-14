CREATE TABLE `session_proof` (
  `session_id` text PRIMARY KEY NOT NULL REFERENCES `session`(`id`) ON DELETE CASCADE,
  `file` text NOT NULL,
  `uri` text NOT NULL,
  `line` integer NOT NULL,
  `character` integer NOT NULL,
  `source` text NOT NULL,
  `locked` integer NOT NULL DEFAULT false,
  `stale` integer NOT NULL DEFAULT false,
  `doc_version` integer,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `session_proof_file_idx` ON `session_proof` (`file`);
