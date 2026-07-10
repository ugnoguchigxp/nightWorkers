CREATE TABLE `mission_plan_revisions` (
	`id` text PRIMARY KEY NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL,
	`mission_id` text NOT NULL, `repository_id` text NOT NULL, `base_revision_id` text,
	`planning_result_id` text NOT NULL, `revision_number` integer NOT NULL, `summary` text NOT NULL,
	`task_graph_json` text NOT NULL, `applied_diff_json` text, `created_by_actor_json` text NOT NULL,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_revision_id`) REFERENCES `mission_plan_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`planning_result_id`) REFERENCES `mission_planning_results`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_plan_revisions_mission_revision_uidx` ON `mission_plan_revisions` (`mission_id`,`revision_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_plan_revisions_mission_planning_uidx` ON `mission_plan_revisions` (`mission_id`,`planning_result_id`);
--> statement-breakpoint
CREATE TABLE `mission_replan_suggestions` (
	`id` text PRIMARY KEY NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL,
	`mission_id` text NOT NULL, `repository_id` text NOT NULL, `base_revision_id` text NOT NULL,
	`source_evaluation_id` text NOT NULL, `status` text DEFAULT 'draft' NOT NULL, `reason` text NOT NULL,
	`task_graph_diff_json` text NOT NULL, `diff_hash` text NOT NULL, `approval_id` text,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_revision_id`) REFERENCES `mission_plan_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_evaluation_id`) REFERENCES `mission_evaluations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`approval_id`) REFERENCES `mission_approvals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_replan_suggestions_evaluation_diff_uidx` ON `mission_replan_suggestions` (`mission_id`,`source_evaluation_id`,`diff_hash`);
--> statement-breakpoint
CREATE INDEX `mission_replan_suggestions_mission_status_created_idx` ON `mission_replan_suggestions` (`mission_id`,`status`,`created_at`);
