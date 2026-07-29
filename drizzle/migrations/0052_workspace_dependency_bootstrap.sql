ALTER TABLE `task_git_workspaces` ADD `initialization_attempt` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `task_git_workspaces` ADD `initialized_at` integer;
