CREATE TABLE `mission_autopilot_grants` (
	`id` text PRIMARY KEY NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL,
	`mission_id` text NOT NULL, `repository_id` text NOT NULL, `autonomy_level` integer NOT NULL,
	`allowed_actions_json` text NOT NULL, `status` text DEFAULT 'active' NOT NULL,
	`granted_by_actor_json` text NOT NULL, `expires_at` integer, `paused_at` integer, `revoked_at` integer,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mission_autopilot_grants_mission_status_idx` ON `mission_autopilot_grants` (`mission_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_autopilot_grants_active_mission_uidx` ON `mission_autopilot_grants` (`mission_id`) WHERE `status` = 'active';
