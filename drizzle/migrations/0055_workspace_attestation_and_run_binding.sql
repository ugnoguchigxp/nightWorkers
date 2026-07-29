ALTER TABLE `task_git_workspaces` ADD `repository_identity_revision` integer;
--> statement-breakpoint
ALTER TABLE `task_git_workspaces` ADD `repository_identity_digest` text;
--> statement-breakpoint
ALTER TABLE `task_git_workspaces` ADD `base_worktree_id` text;
--> statement-breakpoint
ALTER TABLE `task_git_workspaces` ADD `base_worktree_path_canonical` text;
--> statement-breakpoint
ALTER TABLE `task_git_workspaces` ADD `task_worktree_path_canonical` text;
--> statement-breakpoint
ALTER TABLE `task_git_workspaces` ADD `git_common_dir_digest` text;
--> statement-breakpoint
ALTER TABLE `task_git_workspaces` ADD `source_ref` text;
--> statement-breakpoint
ALTER TABLE `task_git_workspaces` ADD `target_ref` text;
--> statement-breakpoint
ALTER TABLE `task_git_workspaces` ADD `attestation_revision` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `task_git_workspaces` ADD `last_attestation_id` text;
--> statement-breakpoint
ALTER TABLE `task_git_workspaces` ADD `last_attestation_digest` text;
--> statement-breakpoint
ALTER TABLE `task_runs` ADD `workspace_id` text;
--> statement-breakpoint
ALTER TABLE `task_runs` ADD `workspace_authority_kind` text;
--> statement-breakpoint
ALTER TABLE `task_runs` ADD `workspace_allocation_version` integer;
--> statement-breakpoint
ALTER TABLE `task_runs` ADD `repository_identity_revision` integer;
--> statement-breakpoint
ALTER TABLE `task_runs` ADD `admission_attestation_id` text;
--> statement-breakpoint
ALTER TABLE `task_runs` ADD `admission_attestation_digest` text;
--> statement-breakpoint
ALTER TABLE `task_runs` ADD `admitted_head_sha` text;
--> statement-breakpoint
CREATE TABLE `workspace_attestations` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`workspace_id` text NOT NULL,
	`task_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`revision` integer NOT NULL,
	`digest` text NOT NULL,
	`canonical_path` text NOT NULL,
	`git_common_dir_canonical` text NOT NULL,
	`branch_ref` text,
	`head_sha` text NOT NULL,
	`expected_head_sha` text,
	`dirty` integer NOT NULL,
	`conflicted` integer NOT NULL,
	`ahead` integer DEFAULT 0 NOT NULL,
	`behind` integer DEFAULT 0 NOT NULL,
	`comparison_ref` text,
	`comparison_sha` text,
	`observed_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `task_git_workspaces`(`id`) ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_attestations_workspace_revision_uidx` ON `workspace_attestations` (`workspace_id`,`revision`);
--> statement-breakpoint
CREATE INDEX `workspace_attestations_workspace_observed_idx` ON `workspace_attestations` (`workspace_id`,`observed_at`);
