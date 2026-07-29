ALTER TABLE `repositories` ADD `repository_kind` text DEFAULT 'non_git' NOT NULL;
--> statement-breakpoint
ALTER TABLE `repositories` ADD `repository_identity_status` text DEFAULT 'materialization_pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE `repositories` ADD `registered_root_canonical` text;
--> statement-breakpoint
ALTER TABLE `repositories` ADD `git_common_dir_canonical` text;
--> statement-breakpoint
ALTER TABLE `repositories` ADD `base_worktree_path_canonical` text;
--> statement-breakpoint
ALTER TABLE `repositories` ADD `base_worktree_id` text;
--> statement-breakpoint
ALTER TABLE `repositories` ADD `repository_identity_digest` text;
--> statement-breakpoint
ALTER TABLE `repositories` ADD `repository_identity_revision` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `repositories` ADD `repository_identity_verified_at` integer;
