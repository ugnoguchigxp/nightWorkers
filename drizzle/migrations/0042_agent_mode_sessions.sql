CREATE TABLE IF NOT EXISTS `agent_mode_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `task_id` text NOT NULL,
  `repository_id` text NOT NULL,
  `epoch` integer NOT NULL,
  `predecessor_session_id` text,
  `execution_mode` text NOT NULL,
  `llm_role` text NOT NULL,
  `runtime_lane` text NOT NULL,
  `provider` text,
  `provider_endpoint_id` text,
  `model` text,
  `thinking_depth` text,
  `route_fingerprint` text NOT NULL,
  `status` text NOT NULL,
  `close_reason` text,
  `opened_at` integer NOT NULL,
  `closed_at` integer,
  FOREIGN KEY (`predecessor_session_id`) REFERENCES `agent_mode_sessions`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `agent_mode_sessions_task_epoch_uidx` ON `agent_mode_sessions` (`task_id`,`epoch`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `agent_mode_sessions_active_task_uidx` ON `agent_mode_sessions` (`task_id`) WHERE status = 'active';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `agent_mode_sessions_task_status_updated_idx` ON `agent_mode_sessions` (`task_id`,`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `agent_mode_sessions_predecessor_idx` ON `agent_mode_sessions` (`predecessor_session_id`);
--> statement-breakpoint
ALTER TABLE `task_runs` ADD `agent_mode_session_id` text REFERENCES `agent_mode_sessions`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `task_runs_agent_mode_session_started_idx` ON `task_runs` (`agent_mode_session_id`,`started_at`);
--> statement-breakpoint
ALTER TABLE `llm_usage_records` ADD `agent_mode_session_id` text REFERENCES `agent_mode_sessions`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `llm_usage_records` ADD `usage_counter_scope` text;
--> statement-breakpoint
ALTER TABLE `llm_usage_records` ADD `usage_normalization_status` text;
--> statement-breakpoint
ALTER TABLE `llm_usage_records` ADD `source_sequence` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `llm_usage_records_agent_mode_session_created_idx` ON `llm_usage_records` (`agent_mode_session_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `llm_usage_counter_checkpoints` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `agent_mode_session_id` text NOT NULL,
  `provider_session_key` text NOT NULL,
  `provider` text NOT NULL,
  `model` text,
  `counter_scope` text NOT NULL,
  `raw_input_tokens` integer,
  `raw_cached_input_tokens` integer,
  `raw_output_tokens` integer,
  `raw_reasoning_output_tokens` integer,
  `source_run_id` text,
  `source_sequence` integer,
  `state_version` integer DEFAULT 0 NOT NULL,
  FOREIGN KEY (`agent_mode_session_id`) REFERENCES `agent_mode_sessions`(`id`) ON DELETE cascade,
  FOREIGN KEY (`source_run_id`) REFERENCES `task_runs`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `llm_usage_counter_checkpoints_session_provider_uidx` ON `llm_usage_counter_checkpoints` (`agent_mode_session_id`,`provider_session_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `llm_usage_counter_checkpoints_session_updated_idx` ON `llm_usage_counter_checkpoints` (`agent_mode_session_id`,`updated_at`);
