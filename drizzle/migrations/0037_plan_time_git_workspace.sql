ALTER TABLE `repositories` ADD `git_integration_policy_json` text;
--> statement-breakpoint
ALTER TABLE `repositories` ADD `git_integration_version` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `task_git_workspaces` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `task_id` text NOT NULL UNIQUE,
  `repository_id` text NOT NULL,
  `plan_review_id` text,
  `admission_key` text,
  `status` text DEFAULT 'planned' NOT NULL,
  `materialization_kind` text NOT NULL,
  `materialization_intent_json` text,
  `bootstrap_evidence_json` text,
  `integration_policy_snapshot_json` text NOT NULL,
  `source_branch` text NOT NULL,
  `target_branch` text NOT NULL,
  `target_base_sha` text,
  `worktree_path` text,
  `worktree_id` text,
  `allocation_version` integer DEFAULT 1 NOT NULL,
  `expected_head_sha` text,
  `provision_attempt` integer DEFAULT 0 NOT NULL,
  `lease_owner` text,
  `lease_expires_at` integer,
  `last_verified_head` text,
  `attention_resume_status` text,
  `last_error_code` text,
  `last_error_message` text,
  `provisioned_at` integer,
  `released_at` integer,
  `retired_at` integer,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_git_workspaces_active_branch_uidx` ON `task_git_workspaces` (`repository_id`,`source_branch`) WHERE `retired_at` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `task_git_workspaces_active_path_uidx` ON `task_git_workspaces` (`worktree_path`) WHERE `worktree_path` IS NOT NULL AND `retired_at` IS NULL;
--> statement-breakpoint
CREATE TABLE `repository_git_mutation_leases` (
  `repository_id` text PRIMARY KEY NOT NULL,
  `owner_id` text NOT NULL,
  `operation` text NOT NULL,
  `lease_version` integer DEFAULT 0 NOT NULL,
  `acquired_at` integer NOT NULL,
  `expires_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `implementation_queue_entries` ADD `workspace_id` text REFERENCES `task_git_workspaces`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `implementation_queue_entries` ADD `workspace_required` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE `task_run_merge_records` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `run_id` text NOT NULL UNIQUE,
  `task_id` text NOT NULL,
  `repository_id` text NOT NULL,
  `workspace_id` text NOT NULL,
  `source_branch` text NOT NULL,
  `source_commit_sha` text NOT NULL,
  `plan_target_branch` text NOT NULL,
  `plan_target_base_sha` text NOT NULL,
  `target_branch` text NOT NULL,
  `target_selected_sha` text NOT NULL,
  `observed_target_sha` text,
  `strategy` text NOT NULL,
  `decision` text DEFAULT 'undecided' NOT NULL,
  `status` text DEFAULT 'decision_required' NOT NULL,
  `record_version` integer DEFAULT 0 NOT NULL,
  `ci_status` text DEFAULT 'not_required' NOT NULL,
  `ci_evidence_json` text,
  `preview_evidence_json` text,
  `conflict_paths_json` text,
  `merge_origin` text,
  `merge_commit_sha` text,
  `target_head_after` text,
  `target_push_status` text,
  `target_pushed_at` integer,
  `decided_at` integer,
  `merged_at` integer,
  `last_error_code` text,
  `last_error_message` text,
  FOREIGN KEY (`run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`workspace_id`) REFERENCES `task_git_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_run_merge_records_repository_status_idx` ON `task_run_merge_records` (`repository_id`,`status`);
