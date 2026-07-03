ALTER TABLE `implementation_queue_entries` ADD `lease_owner_id` text;
--> statement-breakpoint
ALTER TABLE `implementation_queue_entries` ADD `lease_acquired_at` integer;
--> statement-breakpoint
ALTER TABLE `implementation_queue_entries` ADD `lease_expires_at` integer;
--> statement-breakpoint
ALTER TABLE `implementation_queue_entries` ADD `lease_version` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `implementation_queue_entries` ADD `attempt_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `implementation_queue_entries` ADD `recovered_at` integer;
--> statement-breakpoint
ALTER TABLE `implementation_queue_entries` ADD `recovery_reason` text;
--> statement-breakpoint
ALTER TABLE `implementation_queue_entries` ADD `last_failure_kind` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `implementation_queue_entries_lease_expiry_idx` ON `implementation_queue_entries` (`status`, `lease_expires_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `implementation_queue_entries_active_run_idx` ON `implementation_queue_entries` (`active_run_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `implementation_queue_entries_lease_owner_idx` ON `implementation_queue_entries` (`lease_owner_id`, `lease_expires_at`);
