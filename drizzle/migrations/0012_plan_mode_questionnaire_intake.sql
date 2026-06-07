PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `design_questionnaire_sessions_next` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `task_id` text NOT NULL,
  `repository_id` text NOT NULL,
  `source_blueprint_message_id` text,
  `status` text DEFAULT 'draft' NOT NULL,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`source_blueprint_message_id`) REFERENCES `task_messages`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `design_questionnaire_sessions_next` (
  `id`,
  `created_at`,
  `updated_at`,
  `task_id`,
  `repository_id`,
  `source_blueprint_message_id`,
  `status`
)
SELECT
  `id`,
  `created_at`,
  `updated_at`,
  `task_id`,
  `repository_id`,
  `source_blueprint_message_id`,
  `status`
FROM `design_questionnaire_sessions`;--> statement-breakpoint
DROP TABLE `design_questionnaire_sessions`;--> statement-breakpoint
ALTER TABLE `design_questionnaire_sessions_next` RENAME TO `design_questionnaire_sessions`;--> statement-breakpoint
CREATE INDEX `design_questionnaire_sessions_task_idx` ON `design_questionnaire_sessions` (`task_id`);--> statement-breakpoint
CREATE INDEX `design_questionnaire_sessions_repository_idx` ON `design_questionnaire_sessions` (`repository_id`);--> statement-breakpoint
CREATE INDEX `design_questionnaire_sessions_source_blueprint_idx` ON `design_questionnaire_sessions` (`source_blueprint_message_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
