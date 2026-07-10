ALTER TABLE `missions` ADD `source` text DEFAULT 'user' NOT NULL;
--> statement-breakpoint
ALTER TABLE `missions` ADD `source_ref_id` text;
--> statement-breakpoint
ALTER TABLE `missions` ADD `source_evaluation_id` text;
--> statement-breakpoint
ALTER TABLE `missions` ADD `paused_at` integer;
--> statement-breakpoint
ALTER TABLE `missions` ADD `abandoned_at` integer;
--> statement-breakpoint
ALTER TABLE `missions` ADD `completed_at` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX `missions_repository_source_ref_uidx` ON `missions` (`repository_id`,`source`,`source_ref_id`);
--> statement-breakpoint
CREATE TABLE `pilot_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`mission_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`type` text NOT NULL,
	`status` text DEFAULT 'started' NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`reason` text NOT NULL,
	`actor_json` text NOT NULL,
	`evidence_refs_json` text DEFAULT '[]' NOT NULL,
	`result_ref_json` text,
	`next_if_succeeded` text,
	`next_if_failed` text,
	`requires_human_attention` integer DEFAULT false NOT NULL,
	`error_code` text,
	`error_message` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pilot_actions_mission_type_key_uidx` ON `pilot_actions` (`mission_id`,`type`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `pilot_actions_mission_status_created_idx` ON `pilot_actions` (`mission_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `pilot_actions_target_created_idx` ON `pilot_actions` (`target_type`,`target_id`,`created_at`);
