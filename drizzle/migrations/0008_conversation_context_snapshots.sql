CREATE TABLE IF NOT EXISTS `conversation_context_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `task_id` text NOT NULL,
  `run_id` text,
  `version` integer NOT NULL,
  `source_message_id` text,
  `source_run_id` text,
  `source_event_cursor` text,
  `job_type` text,
  `latest_user_message_id` text,
  `previous_run_id` text,
  `terminal_state` text,
  `token_estimate` integer DEFAULT 0 NOT NULL,
  `snapshot_json` text NOT NULL,
  `state_card_text` text NOT NULL,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `conversation_context_snapshots_task_id_idx` ON `conversation_context_snapshots` (`task_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `conversation_context_snapshots_run_id_idx` ON `conversation_context_snapshots` (`run_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `conversation_context_snapshots_task_updated_idx` ON `conversation_context_snapshots` (`task_id`, `updated_at`);
