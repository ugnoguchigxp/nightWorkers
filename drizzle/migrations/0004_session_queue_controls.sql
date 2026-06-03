ALTER TABLE `repositories` ADD `queue_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `repositories` ADD `max_concurrent_sessions` integer DEFAULT 1 NOT NULL;
