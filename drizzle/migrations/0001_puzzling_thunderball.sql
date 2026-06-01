CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`metadata_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `artifacts_run_id_idx` ON `artifacts` (`run_id`);--> statement-breakpoint
ALTER TABLE `repositories` ADD `allowed` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `task_events` ADD `seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `task_events` ADD `actor` text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE `task_events` ADD `event_type` text;--> statement-breakpoint
ALTER TABLE `task_events` ADD `payload_json` text;--> statement-breakpoint
ALTER TABLE `task_runs` ADD `repository_id` text REFERENCES repositories(id);--> statement-breakpoint
ALTER TABLE `task_runs` ADD `worker_kind` text DEFAULT 'native-local-worker' NOT NULL;--> statement-breakpoint
ALTER TABLE `task_runs` ADD `base_ref` text;--> statement-breakpoint
ALTER TABLE `task_runs` ADD `worktree_path` text;--> statement-breakpoint
ALTER TABLE `task_runs` ADD `timeout_seconds` integer DEFAULT 3600 NOT NULL;--> statement-breakpoint
ALTER TABLE `task_runs` ADD `context_snapshot` text;--> statement-breakpoint
ALTER TABLE `task_runs` ADD `summary` text;--> statement-breakpoint
ALTER TABLE `task_runs` ADD `final_report` text;--> statement-breakpoint
ALTER TABLE `task_runs` ADD `finished_at` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `objective` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `acceptance_criteria` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `priority` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `created_by` text;