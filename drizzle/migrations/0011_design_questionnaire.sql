CREATE TABLE IF NOT EXISTS `design_questionnaire_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `task_id` text NOT NULL,
  `repository_id` text NOT NULL,
  `source_blueprint_message_id` text NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`source_blueprint_message_id`) REFERENCES `task_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `design_questionnaire_sessions_task_idx` ON `design_questionnaire_sessions` (`task_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `design_questionnaire_sessions_repository_idx` ON `design_questionnaire_sessions` (`repository_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `design_questionnaire_sessions_source_blueprint_idx` ON `design_questionnaire_sessions` (`source_blueprint_message_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `design_questionnaire_question_sets` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `session_id` text NOT NULL,
  `sequence` integer NOT NULL,
  `questionnaire_json` text,
  `raw_output` text,
  `validation_status` text DEFAULT 'valid' NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `design_questionnaire_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `design_questionnaire_question_sets_session_idx` ON `design_questionnaire_question_sets` (`session_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `design_questionnaire_question_sets_sequence_uidx` ON `design_questionnaire_question_sets` (`session_id`, `sequence`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `design_questionnaire_answers` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `session_id` text NOT NULL,
  `question_id` text NOT NULL,
  `answer_json` text NOT NULL,
  `answered_at` integer NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `design_questionnaire_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `design_questionnaire_answers_session_idx` ON `design_questionnaire_answers` (`session_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `design_questionnaire_answers_question_uidx` ON `design_questionnaire_answers` (`session_id`, `question_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `design_questionnaire_reviews` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `session_id` text NOT NULL,
  `review_json` text,
  `published_message_id` text,
  `status` text DEFAULT 'draft' NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `design_questionnaire_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`published_message_id`) REFERENCES `task_messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `design_questionnaire_reviews_session_idx` ON `design_questionnaire_reviews` (`session_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `design_questionnaire_reviews_published_message_idx` ON `design_questionnaire_reviews` (`published_message_id`);
