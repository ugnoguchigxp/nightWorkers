ALTER TABLE `task_runs` ADD `todo_plan_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `task_run_todos` ADD `objective` text;--> statement-breakpoint
ALTER TABLE `task_run_todos` ADD `context` text;--> statement-breakpoint
ALTER TABLE `task_run_todos` ADD `next_action` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `task_run_todos` ADD `acceptance_criteria_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `task_run_todos` ADD `last_failure` text;--> statement-breakpoint
ALTER TABLE `task_run_todos` ADD `attempt_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `task_run_todos` ADD `system_context_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `task_run_todos` ADD `system_context_snapshot` text;--> statement-breakpoint
ALTER TABLE `task_run_todos` ADD `created_by` text DEFAULT 'migration' NOT NULL;--> statement-breakpoint
ALTER TABLE `task_run_todos` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `task_run_todos`
SET `status` = 'pending', `updated_at` = unixepoch() * 1000
WHERE `status` = 'running'
  AND EXISTS (
    SELECT 1
    FROM `task_run_todos` `earlier`
    WHERE `earlier`.`run_id` = `task_run_todos`.`run_id`
      AND `earlier`.`status` = 'running'
      AND `earlier`.`seq` < `task_run_todos`.`seq`
  );--> statement-breakpoint
CREATE UNIQUE INDEX `task_run_todos_single_running_uidx`
ON `task_run_todos` (`run_id`)
WHERE `status` = 'running';--> statement-breakpoint
DROP TABLE IF EXISTS `task_run_control_states`;
