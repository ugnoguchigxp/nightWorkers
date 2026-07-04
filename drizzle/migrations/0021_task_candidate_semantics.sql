ALTER TABLE `mission_goals` ADD COLUMN `interpretation_scope` text DEFAULT 'unknown' NOT NULL;
--> statement-breakpoint
ALTER TABLE `mission_goals` ADD COLUMN `interpretation_intent` text DEFAULT 'unknown' NOT NULL;
--> statement-breakpoint
ALTER TABLE `mission_goals` ADD COLUMN `interpretation_source` text DEFAULT 'unknown' NOT NULL;
--> statement-breakpoint
ALTER TABLE `mission_goals` ADD COLUMN `interpretation_confidence_percent` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `mission_goals` ADD COLUMN `interpretation_reason` text;
--> statement-breakpoint
UPDATE `mission_goals`
SET
  `interpretation_scope` = 'project_wide',
  `interpretation_intent` = 'maintain_threshold',
  `interpretation_source` = 'preset',
  `interpretation_confidence_percent` = 100,
  `interpretation_reason` = COALESCE(`interpretation_reason`, 'Preset Goal はプロジェクト横断制約として扱う')
WHERE `source` = 'preset'
  AND `interpretation_scope` = 'unknown';
--> statement-breakpoint
ALTER TABLE `mission_task_candidates` ADD COLUMN `candidate_kind` text DEFAULT 'feature_followup' NOT NULL;
--> statement-breakpoint
ALTER TABLE `mission_task_candidates` ADD COLUMN `primary_module` text;
--> statement-breakpoint
ALTER TABLE `mission_task_candidates` ADD COLUMN `secondary_modules_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `mission_task_candidates` ADD COLUMN `routing_confidence_percent` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `mission_task_candidates` ADD COLUMN `routing_reason` text;
--> statement-breakpoint
ALTER TABLE `mission_task_candidates` ADD COLUMN `constraint_goal_ids_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `mission_task_candidates` ADD COLUMN `plan_mode_open_questions_json` text DEFAULT '[]' NOT NULL;
