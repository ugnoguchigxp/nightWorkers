CREATE TABLE `mission_pilot_questionnaire_drafts` (`id` text PRIMARY KEY NOT NULL, `session_id` text NOT NULL, `questionnaire_session_id` text NOT NULL, `answers_json` text NOT NULL, `answer_evidence_json` text NOT NULL, `state` text DEFAULT 'waiting_user' NOT NULL, `deadline_at` integer NOT NULL, `version` integer DEFAULT 0 NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, FOREIGN KEY (`session_id`) REFERENCES `mission_pilot_sessions`(`id`) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (`questionnaire_session_id`) REFERENCES `design_questionnaire_sessions`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_pilot_questionnaire_drafts_questionnaire_uidx` ON `mission_pilot_questionnaire_drafts` (`questionnaire_session_id`);
--> statement-breakpoint
CREATE INDEX `mission_pilot_questionnaire_drafts_deadline_idx` ON `mission_pilot_questionnaire_drafts` (`state`,`deadline_at`);
