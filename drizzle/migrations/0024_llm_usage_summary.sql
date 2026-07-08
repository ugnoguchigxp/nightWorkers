CREATE TABLE `llm_usage_summary_buckets` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`bucket_hour_utc` integer NOT NULL,
	`repository_id` text,
	`repository_key` text NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`model_key` text NOT NULL,
	`pricing_currency_code` text,
	`pricing_currency_key` text NOT NULL,
	`pricing_status` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cached_input_tokens` integer DEFAULT 0 NOT NULL,
	`reasoning_output_tokens` integer DEFAULT 0 NOT NULL,
	`system_prompt_tokens` integer DEFAULT 0 NOT NULL,
	`user_prompt_tokens` integer DEFAULT 0 NOT NULL,
	`state_card_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`total_duration_ms` integer DEFAULT 0 NOT NULL,
	`output_duration_ms` integer DEFAULT 0 NOT NULL,
	`measured_duration_call_count` integer DEFAULT 0 NOT NULL,
	`call_count` integer DEFAULT 0 NOT NULL,
	`measured_call_count` integer DEFAULT 0 NOT NULL,
	`estimated_call_count` integer DEFAULT 0 NOT NULL,
	`mixed_call_count` integer DEFAULT 0 NOT NULL,
	`unavailable_call_count` integer DEFAULT 0 NOT NULL,
	`priced_call_count` integer DEFAULT 0 NOT NULL,
	`unpriced_call_count` integer DEFAULT 0 NOT NULL,
	`manual_priced_call_count` integer DEFAULT 0 NOT NULL,
	`estimated_cost` real DEFAULT 0 NOT NULL,
	`input_cost` real DEFAULT 0 NOT NULL,
	`cached_input_cost` real DEFAULT 0 NOT NULL,
	`output_cost` real DEFAULT 0 NOT NULL,
	`reasoning_output_cost` real DEFAULT 0 NOT NULL,
	`pricing_updated_at` integer,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `llm_usage_summary_buckets_uidx` ON `llm_usage_summary_buckets` (`bucket_hour_utc`,`repository_key`,`provider`,`model_key`,`pricing_currency_key`,`pricing_status`);
--> statement-breakpoint
CREATE INDEX `llm_usage_summary_buckets_hour_idx` ON `llm_usage_summary_buckets` (`bucket_hour_utc`);
--> statement-breakpoint
CREATE INDEX `llm_usage_summary_buckets_repository_hour_idx` ON `llm_usage_summary_buckets` (`repository_key`,`bucket_hour_utc`);
--> statement-breakpoint
CREATE INDEX `llm_usage_summary_buckets_model_hour_idx` ON `llm_usage_summary_buckets` (`provider`,`model_key`,`bucket_hour_utc`);
--> statement-breakpoint
CREATE TABLE `llm_usage_summary_warnings` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`bucket_hour_utc` integer NOT NULL,
	`repository_id` text,
	`repository_key` text NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`model_key` text NOT NULL,
	`code` text NOT NULL,
	`detail_key` text NOT NULL,
	`detail_json` text,
	`call_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `llm_usage_summary_warnings_uidx` ON `llm_usage_summary_warnings` (`bucket_hour_utc`,`repository_key`,`provider`,`model_key`,`code`,`detail_key`);
--> statement-breakpoint
CREATE INDEX `llm_usage_summary_warnings_repository_hour_idx` ON `llm_usage_summary_warnings` (`repository_key`,`bucket_hour_utc`);
--> statement-breakpoint
CREATE INDEX `llm_usage_summary_warnings_code_idx` ON `llm_usage_summary_warnings` (`code`);
