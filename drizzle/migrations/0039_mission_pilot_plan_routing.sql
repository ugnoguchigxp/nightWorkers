ALTER TABLE `mission_pilot_sessions` ADD `plan_routing_revision` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `mission_pilot_plan_reviews` ADD `routing_revision` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `mission_pilot_plan_routing_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`revision` integer NOT NULL,
	`entries_json` text NOT NULL,
	`updated_by` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `mission_pilot_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_pilot_plan_routing_revisions_revision_uidx` ON `mission_pilot_plan_routing_revisions` (`session_id`,`revision`);
