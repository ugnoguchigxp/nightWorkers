CREATE TABLE `mission_goals` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `repository_id` text NOT NULL,
  `title` text NOT NULL,
  `goal_text` text NOT NULL,
  `active` integer DEFAULT true NOT NULL,
  `source` text DEFAULT 'user' NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL,
  FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mission_goals_repository_active_idx` ON `mission_goals` (`repository_id`,`active`,`sort_order`);
--> statement-breakpoint
CREATE TABLE `mission_task_candidate_batches` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `repository_id` text NOT NULL,
  `status` text DEFAULT 'running' NOT NULL,
  `requested_goal_ids_json` text NOT NULL,
  `signal_snapshot_json` text NOT NULL,
  `selected_model_json` text,
  `raw_output_json` text,
  `error_message` text,
  `started_at` integer NOT NULL,
  `completed_at` integer,
  FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mission_batches_repository_created_idx` ON `mission_task_candidate_batches` (`repository_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `mission_task_candidates` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `batch_id` text NOT NULL,
  `repository_id` text NOT NULL,
  `goal_id` text,
  `title` text NOT NULL,
  `summary` text NOT NULL,
  `rationale` text NOT NULL,
  `evidence_json` text NOT NULL,
  `evaluation_contribution` integer,
  `importance_percent` integer NOT NULL,
  `confidence_percent` integer NOT NULL,
  `token_size` text NOT NULL,
  `complexity` text NOT NULL,
  `task_prompt` text NOT NULL,
  `acceptance_criteria` text NOT NULL,
  `verification_plan` text NOT NULL,
  `status` text DEFAULT 'candidate' NOT NULL,
  `task_id` text,
  FOREIGN KEY (`batch_id`) REFERENCES `mission_task_candidate_batches`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`goal_id`) REFERENCES `mission_goals`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `mission_candidates_repository_status_idx` ON `mission_task_candidates` (`repository_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `mission_candidates_batch_idx` ON `mission_task_candidates` (`batch_id`);
--> statement-breakpoint
CREATE INDEX `mission_candidates_task_idx` ON `mission_task_candidates` (`task_id`);
--> statement-breakpoint
CREATE TABLE `project_quality_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `repository_id` text NOT NULL,
  `run_type` text NOT NULL,
  `status` text DEFAULT 'running' NOT NULL,
  `command` text NOT NULL,
  `exit_code` integer,
  `started_at` integer NOT NULL,
  `completed_at` integer,
  `output_artifact_id` text,
  `latest_output` text,
  `coverage_summary_json` text,
  `coverage_gate_json` text,
  `e2e_summary_json` text,
  `error_message` text,
  FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_quality_runs_repository_status_idx` ON `project_quality_runs` (`repository_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `project_quality_runs_repository_type_created_idx` ON `project_quality_runs` (`repository_id`,`run_type`,`created_at`);
