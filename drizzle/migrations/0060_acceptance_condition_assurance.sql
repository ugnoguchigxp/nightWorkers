ALTER TABLE `verification_evidence_runs` ADD `evidence_kinds_json` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `verification_evidence_cases` ADD `case_key` text;
--> statement-breakpoint
ALTER TABLE `verification_evidence_cases` ADD `runner` text;
--> statement-breakpoint
ALTER TABLE `verification_evidence_cases` ADD `evidence_kind` text;
--> statement-breakpoint
CREATE TABLE `coding_agent_condition_confirmations` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`task_id` text NOT NULL,
	`run_id` text NOT NULL,
	`verification_document_id` text NOT NULL,
	`condition_id` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`source_state_hash` text NOT NULL,
	`evidence_ref` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `task_runs`(`id`) ON DELETE cascade,
	FOREIGN KEY (`verification_document_id`) REFERENCES `verification_documents`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coding_agent_condition_confirmation_uidx` ON `coding_agent_condition_confirmations` (`verification_document_id`,`run_id`,`condition_id`,`source_state_hash`,`evidence_ref`);
--> statement-breakpoint
CREATE INDEX `coding_agent_condition_confirmation_run_idx` ON `coding_agent_condition_confirmations` (`task_id`,`run_id`);
