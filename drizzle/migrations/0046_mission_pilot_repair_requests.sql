CREATE TABLE `mission_pilot_repair_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`source_run_id` text,
	`request_json` text NOT NULL,
	`source_revision` integer NOT NULL,
	`source_digest` text NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `mission_pilot_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `mission_pilot_repair_requests_session_idx` ON `mission_pilot_repair_requests` (`session_id`,`created_at`);
