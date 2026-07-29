ALTER TABLE `repositories` ADD `base_worktree_branch` text;
--> statement-breakpoint
ALTER TABLE `repositories` ADD `base_worktree_head_sha` text;
--> statement-breakpoint
ALTER TABLE `repositories` ADD `base_worktree_dirty` integer;
