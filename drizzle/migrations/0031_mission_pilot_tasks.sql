CREATE TABLE `mission_tasks` (
	`id` text PRIMARY KEY NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL,
	`mission_id` text NOT NULL, `repository_id` text NOT NULL, `planning_result_id` text NOT NULL,
	`task_candidate_id` text NOT NULL, `objective_ids_json` text NOT NULL, `nightworkers_task_id` text,
	`queue_entry_id` text, `active_run_id` text, `approval_id` text NOT NULL, `approval_snapshot_hash` text NOT NULL,
	`title` text NOT NULL, `purpose` text NOT NULL, `status` text DEFAULT 'approved' NOT NULL,
	`risk_level` text NOT NULL, `approval_required` integer NOT NULL, `dependencies_json` text NOT NULL,
	`verification_gate_json` text NOT NULL, `scheduling_json` text NOT NULL, `last_synced_at` integer,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`planning_result_id`) REFERENCES `mission_planning_results`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`task_candidate_id`) REFERENCES `mission_task_proposals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`nightworkers_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`queue_entry_id`) REFERENCES `implementation_queue_entries`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`active_run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`approval_id`) REFERENCES `mission_approvals`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_tasks_candidate_uidx` ON `mission_tasks` (`task_candidate_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_tasks_nightworkers_task_uidx` ON `mission_tasks` (`nightworkers_task_id`);
--> statement-breakpoint
CREATE INDEX `mission_tasks_mission_status_created_idx` ON `mission_tasks` (`mission_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `mission_tasks_queue_entry_idx` ON `mission_tasks` (`queue_entry_id`);
--> statement-breakpoint
CREATE INDEX `mission_tasks_active_run_idx` ON `mission_tasks` (`active_run_id`);
