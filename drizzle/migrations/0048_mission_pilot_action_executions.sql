CREATE TABLE `mission_pilot_action_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`task_id` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`action_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`arguments_digest` text NOT NULL,
	`expected_task_revision` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`result_json` text,
	`failure_json` text,
	`source_resource_type` text,
	`source_resource_id` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `mission_pilot_sessions`(`id`) ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade,
	FOREIGN KEY (`tool_call_id`) REFERENCES `mission_pilot_tool_calls`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_pilot_action_executions_idempotency_uidx` ON `mission_pilot_action_executions` (`session_id`,`idempotency_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_pilot_action_executions_tool_call_uidx` ON `mission_pilot_action_executions` (`tool_call_id`);
--> statement-breakpoint
CREATE INDEX `mission_pilot_action_executions_status_idx` ON `mission_pilot_action_executions` (`session_id`,`status`);
--> statement-breakpoint
ALTER TABLE `implementation_queue_entries` ADD `mission_pilot_agent_json` text;
--> statement-breakpoint
ALTER TABLE `design_questionnaire_sessions` ADD `mission_pilot_action_key` text;
--> statement-breakpoint
ALTER TABLE `mission_pilot_questionnaire_drafts` ADD `last_action_idempotency_key` text;
