CREATE TABLE IF NOT EXISTS `llm_usage_records` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `task_id` text NOT NULL,
  `run_id` text,
  `call_id` text NOT NULL,
  `provider` text NOT NULL,
  `model` text,
  `label` text NOT NULL,
  `round` integer,
  `usage_mode` text NOT NULL,
  `input_tokens` integer,
  `output_tokens` integer,
  `cached_input_tokens` integer,
  `reasoning_output_tokens` integer,
  `total_tokens` integer,
  `system_prompt_tokens` integer,
  `user_prompt_tokens` integer,
  `state_card_tokens` integer,
  `response_tokens_estimate` integer,
  `duration_ms` integer NOT NULL,
  `raw_usage_json` text,
  `metadata_json` text,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `llm_usage_records_task_created_idx` ON `llm_usage_records` (`task_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `llm_usage_records_run_created_idx` ON `llm_usage_records` (`run_id`, `created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `llm_usage_records_call_id_uidx` ON `llm_usage_records` (`call_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `llm_usage_records_provider_created_idx` ON `llm_usage_records` (`provider`, `created_at`);
