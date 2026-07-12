ALTER TABLE `tasks` ADD `completed_at` integer;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `archived_at` integer;
--> statement-breakpoint
ALTER TABLE `mission_pilot_sessions` ADD `active_phase_run_id` text;
--> statement-breakpoint
ALTER TABLE `mission_pilot_sessions` ADD `active_test_snapshot_id` text;
--> statement-breakpoint
ALTER TABLE `mission_pilot_sessions` ADD `active_review_decision_id` text;
--> statement-breakpoint
ALTER TABLE `mission_pilot_sessions` ADD `active_closeout_id` text;
--> statement-breakpoint
ALTER TABLE `mission_pilot_sessions` ADD `implementation_cycle` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `mission_pilot_sessions` ADD `test_cycle` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `mission_pilot_sessions` ADD `review_cycle` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `mission_pilot_sessions` ADD `total_correction_cycle` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `mission_pilot_phase_runs` (
	`id` text PRIMARY KEY NOT NULL, `session_id` text NOT NULL, `task_id` text NOT NULL,
	`phase` text NOT NULL, `cycle` integer NOT NULL, `attempt` integer NOT NULL, `run_id` text NOT NULL,
	`parent_phase_run_id` text, `input_context_revision` integer NOT NULL, `input_context_digest` text NOT NULL,
	`output_context_revision` integer, `status` text DEFAULT 'starting' NOT NULL, `verdict` text,
	`evidence_json` text NOT NULL, `started_at` integer NOT NULL, `finished_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `mission_pilot_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_pilot_phase_runs_run_uidx` ON `mission_pilot_phase_runs` (`run_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_pilot_phase_runs_attempt_uidx` ON `mission_pilot_phase_runs` (`session_id`,`phase`,`cycle`,`attempt`);
--> statement-breakpoint
CREATE TABLE `mission_pilot_test_snapshots` (
	`id` text PRIMARY KEY NOT NULL, `session_id` text NOT NULL, `phase_run_id` text NOT NULL,
	`verification_document_id` text NOT NULL, `context_revision` integer NOT NULL, `context_digest` text NOT NULL,
	`checklist_digest` text NOT NULL, `required_total` integer NOT NULL, `required_complete` integer NOT NULL,
	`failed_required` integer NOT NULL, `unknown_required` integer NOT NULL, `evidence_run_ids_json` text NOT NULL,
	`completion_check_event_id` text NOT NULL, `test_changed_paths_json` text NOT NULL, `verdict` text NOT NULL,
	`snapshot_json` text NOT NULL, `created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `mission_pilot_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`phase_run_id`) REFERENCES `mission_pilot_phase_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_pilot_test_snapshots_phase_run_uidx` ON `mission_pilot_test_snapshots` (`phase_run_id`);
--> statement-breakpoint
CREATE TABLE `mission_pilot_review_decisions` (
	`id` text PRIMARY KEY NOT NULL, `session_id` text NOT NULL, `review_session_id` text NOT NULL,
	`review_phase_run_id` text NOT NULL, `context_revision` integer NOT NULL, `context_digest` text NOT NULL,
	`test_snapshot_id` text NOT NULL, `target_manifest_digest` text NOT NULL, `verdict` text NOT NULL,
	`blocking_count` integer NOT NULL, `warning_count` integer NOT NULL, `info_count` integer NOT NULL,
	`finding_ids_json` text NOT NULL, `decision_json` text NOT NULL, `created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `mission_pilot_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`review_phase_run_id`) REFERENCES `mission_pilot_phase_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`test_snapshot_id`) REFERENCES `mission_pilot_test_snapshots`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_pilot_review_decisions_phase_run_uidx` ON `mission_pilot_review_decisions` (`review_phase_run_id`);
--> statement-breakpoint
CREATE TABLE `mission_pilot_closeouts` (
	`id` text PRIMARY KEY NOT NULL, `session_id` text NOT NULL, `attempt` integer NOT NULL, `repository_id` text NOT NULL,
	`baseline_head` text NOT NULL, `review_decision_id` text NOT NULL, `reviewed_context_digest` text NOT NULL,
	`owned_phase_run_ids_json` text NOT NULL, `stageable_owned_paths_json` text NOT NULL, `excluded_paths_json` text NOT NULL,
	`status` text NOT NULL, `commit_sha` text, `commit_message` text, `push_policy` text NOT NULL,
	`push_status` text NOT NULL, `push_remote` text, `push_branch` text, `status_reason` text,
	`created_at` integer NOT NULL, `updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `mission_pilot_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`review_decision_id`) REFERENCES `mission_pilot_review_decisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_pilot_closeouts_attempt_uidx` ON `mission_pilot_closeouts` (`session_id`,`attempt`);
--> statement-breakpoint
CREATE TABLE `mission_pilot_events` (
	`id` text PRIMARY KEY NOT NULL, `session_id` text NOT NULL, `task_id` text NOT NULL, `event_type` text NOT NULL,
	`phase` text NOT NULL, `cycle` integer, `context_revision` integer NOT NULL, `context_digest` text NOT NULL,
	`dedupe_key` text NOT NULL, `source_kind` text NOT NULL, `source_id` text, `payload_json` text NOT NULL,
	`process_status` text DEFAULT 'pending' NOT NULL, `attempt_count` integer DEFAULT 0 NOT NULL,
	`available_at` integer NOT NULL, `processed_at` integer, `last_error` text, `created_at` integer NOT NULL, `updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `mission_pilot_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_pilot_events_dedupe_uidx` ON `mission_pilot_events` (`session_id`,`dedupe_key`);
--> statement-breakpoint
CREATE INDEX `mission_pilot_events_pending_idx` ON `mission_pilot_events` (`process_status`,`available_at`);
--> statement-breakpoint
CREATE TABLE `task_archive_records` (
	`id` text PRIMARY KEY NOT NULL, `task_id` text NOT NULL, `mission_pilot_session_id` text, `source_run_id` text,
	`previous_status` text NOT NULL, `reason` text NOT NULL, `evidence_json` text NOT NULL, `archived_at` integer NOT NULL,
	`restored_at` integer, `restored_to_status` text, `restored_by` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mission_pilot_session_id`) REFERENCES `mission_pilot_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `task_archive_records_task_idx` ON `task_archive_records` (`task_id`,`archived_at`);
