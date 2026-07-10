CREATE TABLE `mission_evaluations` (
	`id` text PRIMARY KEY NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL,
	`mission_id` text NOT NULL, `repository_id` text NOT NULL, `scope_type` text NOT NULL, `scope_id` text NOT NULL,
	`mission_task_id` text, `run_id` text, `result` text NOT NULL, `summary` text NOT NULL,
	`objective_updates_json` text NOT NULL, `evidence_refs_json` text NOT NULL, `input_digest` text NOT NULL,
	`next_recommended_action` text NOT NULL, `created_by_actor_json` text NOT NULL,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mission_task_id`) REFERENCES `mission_tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_evaluations_scope_digest_uidx` ON `mission_evaluations` (`mission_id`,`scope_type`,`scope_id`,`input_digest`);
--> statement-breakpoint
CREATE INDEX `mission_evaluations_mission_created_idx` ON `mission_evaluations` (`mission_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `mission_evaluations_run_idx` ON `mission_evaluations` (`run_id`);
