CREATE TABLE `mission_approvals` (
	`id` text PRIMARY KEY NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL,
	`mission_id` text NOT NULL, `repository_id` text NOT NULL, `target_type` text NOT NULL,
	`target_id` text NOT NULL, `approval_type` text NOT NULL, `status` text DEFAULT 'requested' NOT NULL,
	`risk_level` text NOT NULL, `approval_required` integer NOT NULL, `requested_reason` text NOT NULL,
	`requested_by_actor_json` text NOT NULL, `decided_by_actor_json` text, `decision_reason` text,
	`snapshot_json` text NOT NULL, `snapshot_hash` text NOT NULL, `requested_at` integer NOT NULL,
	`decided_at` integer, `expires_at` integer,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mission_approvals_mission_status_created_idx` ON `mission_approvals` (`mission_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `mission_approvals_target_type_status_idx` ON `mission_approvals` (`target_type`,`target_id`,`approval_type`,`status`);
--> statement-breakpoint
CREATE INDEX `mission_approvals_hash_status_idx` ON `mission_approvals` (`snapshot_hash`,`status`);
--> statement-breakpoint
CREATE TABLE `mission_attention_items` (
	`id` text PRIMARY KEY NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL,
	`mission_id` text NOT NULL, `repository_id` text NOT NULL, `target_type` text NOT NULL,
	`target_id` text NOT NULL, `type` text NOT NULL, `status` text DEFAULT 'open' NOT NULL,
	`severity` text NOT NULL, `title` text NOT NULL, `summary` text NOT NULL,
	`action_schema_json` text NOT NULL, `evidence_refs_json` text DEFAULT '[]' NOT NULL,
	`source_event_id` text, `source_ref_json` text, `resolved_by_actor_json` text, `resolved_at` integer,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_event_id`) REFERENCES `mission_events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `mission_attention_mission_status_created_idx` ON `mission_attention_items` (`mission_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `mission_attention_target_status_idx` ON `mission_attention_items` (`target_type`,`target_id`,`status`);
