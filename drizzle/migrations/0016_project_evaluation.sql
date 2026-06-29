CREATE TABLE `project_evaluation_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `repository_id` text NOT NULL,
  `bundle_json` text NOT NULL,
  `raw_output_json` text,
  `summary` text NOT NULL,
  `overall_score` real NOT NULL,
  `overall_confidence` real NOT NULL,
  `evidence_level` text DEFAULT 'repo-structure' NOT NULL,
  `selected_model_json` text,
  `previous_evaluation_id` text,
  `strengths_json` text,
  `weaknesses_json` text,
  `next_evidence_to_collect_json` text,
  FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_eval_runs_repository_created_idx` ON `project_evaluation_runs` (`repository_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `project_evaluation_dimensions` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `evaluation_id` text NOT NULL,
  `dimension_key` text NOT NULL,
  `label` text NOT NULL,
  `score` real NOT NULL,
  `confidence` real NOT NULL,
  `rationale` text NOT NULL,
  `evidence_json` text,
  `concerns_json` text,
  FOREIGN KEY (`evaluation_id`) REFERENCES `project_evaluation_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_eval_dimensions_evaluation_idx` ON `project_evaluation_dimensions` (`evaluation_id`);
--> statement-breakpoint
CREATE TABLE `project_evaluation_activity_events` (
  `id` text PRIMARY KEY NOT NULL,
  `evaluation_id` text NOT NULL,
  `seq` integer NOT NULL,
  `phase` text NOT NULL,
  `level` text NOT NULL,
  `source` text NOT NULL,
  `message` text NOT NULL,
  `status` text,
  `payload_json` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`evaluation_id`) REFERENCES `project_evaluation_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_eval_activity_evaluation_seq_idx` ON `project_evaluation_activity_events` (`evaluation_id`,`seq`);
--> statement-breakpoint
CREATE TABLE `project_improvement_ideas` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `evaluation_id` text NOT NULL,
  `title` text NOT NULL,
  `summary` text NOT NULL,
  `agent_prompt` text NOT NULL,
  `expected_outcome` text NOT NULL,
  `implementation_focus_json` text NOT NULL,
  `target_dimensions_json` text NOT NULL,
  FOREIGN KEY (`evaluation_id`) REFERENCES `project_evaluation_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_improvement_ideas_evaluation_idx` ON `project_improvement_ideas` (`evaluation_id`);
--> statement-breakpoint
CREATE TABLE `project_improvement_idea_score_impacts` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `idea_id` text NOT NULL,
  `dimension_key` text NOT NULL,
  `current_score` integer NOT NULL,
  `expected_score_gain` integer NOT NULL,
  `expected_score_after` integer NOT NULL,
  `rationale` text NOT NULL,
  FOREIGN KEY (`idea_id`) REFERENCES `project_improvement_ideas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_improvement_score_impacts_idea_idx` ON `project_improvement_idea_score_impacts` (`idea_id`);
--> statement-breakpoint
CREATE TABLE `project_evaluation_task_links` (
  `id` text PRIMARY KEY NOT NULL,
  `evaluation_id` text NOT NULL,
  `idea_id` text NOT NULL,
  `task_id` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`evaluation_id`) REFERENCES `project_evaluation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`idea_id`) REFERENCES `project_improvement_ideas`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_eval_task_links_evaluation_idx` ON `project_evaluation_task_links` (`evaluation_id`);
--> statement-breakpoint
CREATE INDEX `project_eval_task_links_idea_idx` ON `project_evaluation_task_links` (`idea_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_eval_task_links_evaluation_idea_uidx` ON `project_evaluation_task_links` (`evaluation_id`,`idea_id`);
