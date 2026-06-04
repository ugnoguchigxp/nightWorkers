CREATE TABLE `activity_artifacts` (
  `id` text PRIMARY KEY NOT NULL,
  `task_id` text NOT NULL,
  `run_id` text,
  `kind` text NOT NULL,
  `path` text,
  `content_text` text,
  `metadata_json` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `activity_artifacts_task_id_idx` ON `activity_artifacts` (`task_id`);
--> statement-breakpoint
CREATE INDEX `activity_artifacts_run_id_idx` ON `activity_artifacts` (`run_id`);
--> statement-breakpoint
CREATE INDEX `activity_artifacts_kind_created_at_idx` ON `activity_artifacts` (`kind`,`created_at`);
--> statement-breakpoint
CREATE TABLE `activity_events` (
  `id` text PRIMARY KEY NOT NULL,
  `task_id` text NOT NULL,
  `run_id` text,
  `turn_id` text,
  `parent_event_id` text,
  `seq` integer NOT NULL,
  `run_seq` integer,
  `kind` text NOT NULL,
  `source` text NOT NULL,
  `status` text,
  `text` text,
  `payload_json` text,
  `artifact_id` text,
  `client_temp_id` text,
  `external_id` text,
  `dedupe_key` text,
  `ingest_error` text,
  `visibility` text DEFAULT 'visible' NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`artifact_id`) REFERENCES `activity_artifacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_events_task_seq_uidx` ON `activity_events` (`task_id`,`seq`);
--> statement-breakpoint
CREATE INDEX `activity_events_task_created_at_idx` ON `activity_events` (`task_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `activity_events_run_seq_idx` ON `activity_events` (`run_id`,`run_seq`);
--> statement-breakpoint
CREATE INDEX `activity_events_turn_seq_idx` ON `activity_events` (`turn_id`,`seq`);
--> statement-breakpoint
CREATE INDEX `activity_events_kind_created_at_idx` ON `activity_events` (`kind`,`created_at`);
--> statement-breakpoint
CREATE INDEX `activity_events_artifact_id_idx` ON `activity_events` (`artifact_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_events_dedupe_key_uidx` ON `activity_events` (`dedupe_key`);
