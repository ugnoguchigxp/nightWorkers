CREATE TABLE `mission_pilot_action_confirmations` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`task_id` text NOT NULL,
	`requested_tool_call_id` text NOT NULL,
	`consumed_by_tool_call_id` text,
	`action_id` text NOT NULL,
	`arguments_json` text NOT NULL,
	`arguments_digest` text NOT NULL,
	`task_revision` integer NOT NULL,
	`active_key` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`consumed_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `mission_pilot_sessions`(`id`) ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade,
	FOREIGN KEY (`requested_tool_call_id`) REFERENCES `mission_pilot_tool_calls`(`id`) ON DELETE cascade,
	FOREIGN KEY (`consumed_by_tool_call_id`) REFERENCES `mission_pilot_tool_calls`(`id`) ON DELETE set null
);
CREATE UNIQUE INDEX `mission_pilot_action_confirmations_active_uidx` ON `mission_pilot_action_confirmations` (`session_id`,`active_key`);
CREATE INDEX `mission_pilot_action_confirmations_pending_idx` ON `mission_pilot_action_confirmations` (`task_id`,`status`,`created_at`);
