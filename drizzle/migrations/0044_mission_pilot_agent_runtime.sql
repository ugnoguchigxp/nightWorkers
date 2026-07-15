-- Additive persistent Mission Pilot agent runtime storage.
ALTER TABLE `mission_pilot_sessions` ADD `runtime_kind` text DEFAULT 'legacy' NOT NULL;
ALTER TABLE `mission_pilot_sessions` ADD `runtime_state` text DEFAULT 'stopped' NOT NULL;
ALTER TABLE `mission_pilot_sessions` ADD `conversation_revision` integer DEFAULT 0 NOT NULL;
ALTER TABLE `mission_pilot_sessions` ADD `next_conversation_sequence` integer DEFAULT 1 NOT NULL;
ALTER TABLE `mission_pilot_sessions` ADD `next_event_sequence` integer DEFAULT 1 NOT NULL;
ALTER TABLE `mission_pilot_sessions` ADD `next_turn_index` integer DEFAULT 1 NOT NULL;
ALTER TABLE `mission_pilot_sessions` ADD `system_context_version` integer DEFAULT 1 NOT NULL;
ALTER TABLE `mission_pilot_sessions` ADD `compaction_revision` integer DEFAULT 0 NOT NULL;
ALTER TABLE `mission_pilot_sessions` ADD `last_consumed_event_sequence` integer DEFAULT 0 NOT NULL;
ALTER TABLE `mission_pilot_sessions` ADD `provider_conversation_ref` text;

CREATE TABLE `mission_pilot_agent_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`turn_index` integer NOT NULL,
	`trigger_event_from` integer,
	`trigger_event_to` integer,
	`status` text DEFAULT 'running' NOT NULL,
	`provider` text,
	`model` text,
	`provider_conversation_ref` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`error_json` text,
	FOREIGN KEY (`session_id`) REFERENCES `mission_pilot_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `mission_pilot_agent_turns_turn_uidx` ON `mission_pilot_agent_turns` (`session_id`,`turn_index`);
CREATE INDEX `mission_pilot_agent_turns_status_idx` ON `mission_pilot_agent_turns` (`session_id`,`status`);

CREATE TABLE `mission_pilot_tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`provider_call_id` text NOT NULL,
	`action_id` text NOT NULL,
	`arguments_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`idempotency_key` text NOT NULL,
	`expected_task_revision` integer,
	`result_json` text,
	`failure_json` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `mission_pilot_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`turn_id`) REFERENCES `mission_pilot_agent_turns`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `mission_pilot_tool_calls_provider_call_uidx` ON `mission_pilot_tool_calls` (`session_id`,`provider_call_id`);
CREATE UNIQUE INDEX `mission_pilot_tool_calls_idempotency_uidx` ON `mission_pilot_tool_calls` (`session_id`,`idempotency_key`);
CREATE INDEX `mission_pilot_tool_calls_status_idx` ON `mission_pilot_tool_calls` (`session_id`,`status`);

CREATE TABLE `mission_pilot_conversation_items` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`turn_id` text,
	`tool_call_id` text,
	`body_json` text NOT NULL,
	`source_kind` text,
	`source_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `mission_pilot_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`turn_id`) REFERENCES `mission_pilot_agent_turns`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`tool_call_id`) REFERENCES `mission_pilot_tool_calls`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `mission_pilot_conversation_items_sequence_uidx` ON `mission_pilot_conversation_items` (`session_id`,`sequence`);
CREATE INDEX `mission_pilot_conversation_items_kind_idx` ON `mission_pilot_conversation_items` (`session_id`,`kind`,`sequence`);

CREATE TABLE `mission_pilot_task_event_inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`task_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`event_type` text NOT NULL,
	`source_event_id` text NOT NULL,
	`task_revision` integer NOT NULL,
	`payload_json` text NOT NULL,
	`available_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `mission_pilot_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `mission_pilot_task_event_inbox_sequence_uidx` ON `mission_pilot_task_event_inbox` (`session_id`,`sequence`);
CREATE UNIQUE INDEX `mission_pilot_task_event_inbox_source_uidx` ON `mission_pilot_task_event_inbox` (`session_id`,`source_event_id`);
CREATE INDEX `mission_pilot_task_event_inbox_available_idx` ON `mission_pilot_task_event_inbox` (`session_id`,`consumed_at`,`available_at`);
