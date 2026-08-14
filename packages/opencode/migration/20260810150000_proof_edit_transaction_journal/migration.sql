CREATE TABLE `proof_edit_transaction` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace` text NOT NULL,
	`file` text NOT NULL,
	`theorem` text NOT NULL,
	`scope_key` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`owner_session_id` text NOT NULL,
	`parent_session_id` text NOT NULL,
	`base_hash` text NOT NULL,
	`current_revision` integer NOT NULL,
	`best_revision` integer,
	`best_progress_level` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `proof_edit_transaction_recovery_idx` ON `proof_edit_transaction` (`workspace`,`file`,`theorem`,`scope_key`,`status`);
--> statement-breakpoint
CREATE INDEX `proof_edit_transaction_owner_idx` ON `proof_edit_transaction` (`owner_session_id`,`status`);
--> statement-breakpoint
CREATE TABLE `proof_edit_transaction_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`revision` integer NOT NULL,
	`source_hash` text NOT NULL,
	`progress_level` text,
	`source` text NOT NULL,
	`receipt` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `proof_edit_transaction`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proof_edit_transaction_revision_idx` ON `proof_edit_transaction_revision` (`transaction_id`,`revision`);
--> statement-breakpoint
CREATE INDEX `proof_edit_transaction_revision_progress_idx` ON `proof_edit_transaction_revision` (`transaction_id`,`progress_level`);
