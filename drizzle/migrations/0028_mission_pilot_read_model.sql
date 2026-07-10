CREATE TABLE `mission_objectives` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`mission_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`planning_result_id` text NOT NULL,
	`external_objective_id` text NOT NULL,
	`title` text NOT NULL,
	`completion_criteria_json` text NOT NULL,
	`verification_gate_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`evidence_refs_json` text DEFAULT '[]' NOT NULL,
	`status_reason` text,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`planning_result_id`) REFERENCES `mission_planning_results`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_objectives_planning_external_uidx` ON `mission_objectives` (`planning_result_id`,`external_objective_id`);
--> statement-breakpoint
CREATE INDEX `mission_objectives_mission_status_created_idx` ON `mission_objectives` (`mission_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `mission_objectives_repository_status_idx` ON `mission_objectives` (`repository_id`,`status`);
--> statement-breakpoint
CREATE TABLE `mission_events` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`mission_task_id` text,
	`event_type` text NOT NULL,
	`summary` text NOT NULL,
	`actor_json` text NOT NULL,
	`payload_json` text,
	`evidence_refs_json` text DEFAULT '[]' NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`source_version` text DEFAULT '1' NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_events_source_uidx` ON `mission_events` (`mission_id`,`event_type`,`source_kind`,`source_id`,`source_version`);
--> statement-breakpoint
CREATE INDEX `mission_events_mission_occurred_idx` ON `mission_events` (`mission_id`,`occurred_at`,`created_at`);
--> statement-breakpoint
CREATE INDEX `mission_events_mission_task_occurred_idx` ON `mission_events` (`mission_task_id`,`occurred_at`);
