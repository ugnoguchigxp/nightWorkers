CREATE TABLE `background_processes` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `repository_id` text NOT NULL,
  `task_id` text,
  `run_id` text,
  `command` text NOT NULL,
  `cwd` text NOT NULL,
  `status` text DEFAULT 'running' NOT NULL,
  `pid` integer,
  `exit_code` integer,
  `signal` text,
  `started_at` integer NOT NULL,
  `ended_at` integer,
  `stop_reason` text,
  `latest_output` text DEFAULT '' NOT NULL,
  `output_artifact_id` text,
  `metadata_json` text,
  FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`output_artifact_id`) REFERENCES `activity_artifacts`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX `background_processes_repository_status_idx` ON `background_processes` (`repository_id`, `status`);--> statement-breakpoint
CREATE INDEX `background_processes_task_status_idx` ON `background_processes` (`task_id`, `status`);--> statement-breakpoint
CREATE INDEX `background_processes_run_status_idx` ON `background_processes` (`run_id`, `status`);
