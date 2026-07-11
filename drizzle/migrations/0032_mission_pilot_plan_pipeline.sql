ALTER TABLE `mission_pilot_sessions` ADD `lease_owner` text;
--> statement-breakpoint
ALTER TABLE `mission_pilot_sessions` ADD `lease_expires_at` integer;
--> statement-breakpoint
CREATE INDEX `mission_pilot_sessions_lease_idx` ON `mission_pilot_sessions` (`lease_expires_at`);
--> statement-breakpoint
CREATE TABLE `mission_pilot_steps` (`id` text PRIMARY KEY NOT NULL, `session_id` text NOT NULL, `step_key` text NOT NULL, `ordinal` integer NOT NULL, `status` text DEFAULT 'pending' NOT NULL, `attempt` integer DEFAULT 0 NOT NULL, `context_revision` integer NOT NULL, `context_digest` text NOT NULL, `artifact_message_id` text, `evidence_json` text NOT NULL, `last_error` text, `started_at` integer, `finished_at` integer, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, FOREIGN KEY (`session_id`) REFERENCES `mission_pilot_sessions`(`id`) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (`artifact_message_id`) REFERENCES `task_messages`(`id`) ON UPDATE no action ON DELETE set null);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_pilot_steps_step_uidx` ON `mission_pilot_steps` (`session_id`,`step_key`);
--> statement-breakpoint
CREATE INDEX `mission_pilot_steps_status_idx` ON `mission_pilot_steps` (`status`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `mission_pilot_plan_reviews` (`id` text PRIMARY KEY NOT NULL, `session_id` text NOT NULL, `context_revision` integer NOT NULL, `context_digest` text NOT NULL, `feature_plan_message_id` text NOT NULL, `attempt` integer NOT NULL, `verdict` text NOT NULL, `review_json` text NOT NULL, `created_at` integer NOT NULL, FOREIGN KEY (`session_id`) REFERENCES `mission_pilot_sessions`(`id`) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (`feature_plan_message_id`) REFERENCES `task_messages`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_pilot_plan_reviews_attempt_uidx` ON `mission_pilot_plan_reviews` (`session_id`,`attempt`);
--> statement-breakpoint
CREATE INDEX `mission_pilot_plan_reviews_context_idx` ON `mission_pilot_plan_reviews` (`session_id`,`context_revision`);
