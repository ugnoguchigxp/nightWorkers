ALTER TABLE `implementation_queue_entries` ADD `execution_type` text DEFAULT 'normal' NOT NULL;
--> statement-breakpoint
ALTER TABLE `implementation_queue_entries` ADD `execution_lock_key` text;
--> statement-breakpoint
ALTER TABLE `implementation_queue_entries` ADD `sequence_group_id` text;
--> statement-breakpoint
ALTER TABLE `implementation_queue_entries` ADD `sequence_order` integer;
--> statement-breakpoint
ALTER TABLE `implementation_queue_entries` ADD `sequence_depends_on_entry_id` text;
--> statement-breakpoint
ALTER TABLE `implementation_queue_entries` ADD `scheduling_reason` text;
--> statement-breakpoint
UPDATE `implementation_queue_entries`
SET `execution_lock_key` = 'repository:' || `repository_id`
WHERE `execution_lock_key` IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `implementation_queue_entries_scheduling_idx` ON `implementation_queue_entries` (`repository_id`, `execution_lock_key`, `execution_type`, `status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `implementation_queue_entries_sequence_idx` ON `implementation_queue_entries` (`sequence_group_id`, `sequence_order`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `task_run_commit_records` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `run_id` text NOT NULL UNIQUE,
  `repository_id` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `baseline_head` text,
  `baseline_status_json` text,
  `pre_existing_dirty_paths_json` text,
  `owned_candidate_paths_json` text,
  `stageable_owned_paths_json` text,
  `excluded_paths_json` text,
  `verification_status` text DEFAULT 'not_run' NOT NULL,
  `verification_evidence_json` text,
  `commit_sha` text,
  `commit_message` text,
  `status_reason` text,
  FOREIGN KEY (`run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `task_run_commit_records_run_id_uidx` ON `task_run_commit_records` (`run_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `task_run_commit_records_repository_status_idx` ON `task_run_commit_records` (`repository_id`, `status`);
