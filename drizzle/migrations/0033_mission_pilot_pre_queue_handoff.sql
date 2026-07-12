ALTER TABLE `implementation_queue_entries` ADD `mission_pilot_admission_key` text;
--> statement-breakpoint
ALTER TABLE `implementation_queue_entries` ADD `claim_ready` integer DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `implementation_queue_entries_mission_pilot_admission_uidx` ON `implementation_queue_entries` (`mission_pilot_admission_key`);
--> statement-breakpoint
ALTER TABLE `mission_pilot_sessions` ADD `queue_handoff_json` text;
--> statement-breakpoint
ALTER TABLE `mission_pilot_sessions` ADD `pre_queue_diagnostic_json` text;
