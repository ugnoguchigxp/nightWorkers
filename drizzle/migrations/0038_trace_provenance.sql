ALTER TABLE `task_messages` ADD `trace_owner` text DEFAULT 'system' NOT NULL;
--> statement-breakpoint
ALTER TABLE `task_messages` ADD `trace_channel` text DEFAULT 'internal' NOT NULL;
--> statement-breakpoint
ALTER TABLE `activity_events` ADD `trace_owner` text DEFAULT 'system' NOT NULL;
--> statement-breakpoint
ALTER TABLE `activity_events` ADD `trace_channel` text DEFAULT 'internal' NOT NULL;
--> statement-breakpoint
ALTER TABLE `llm_usage_records` ADD `trace_owner` text DEFAULT 'system' NOT NULL;
--> statement-breakpoint
ALTER TABLE `llm_usage_records` ADD `trace_channel` text DEFAULT 'internal' NOT NULL;
--> statement-breakpoint

UPDATE `llm_usage_records`
SET `trace_owner` = 'mission_pilot', `trace_channel` = 'pilot_thought'
WHERE json_valid(`metadata_json`) = 1
  AND json_extract(`metadata_json`, '$.role') = 'mission_pilot';
--> statement-breakpoint
UPDATE `llm_usage_records`
SET `trace_owner` = 'coding_agent', `trace_channel` = 'chat'
WHERE `trace_channel` = 'internal'
  AND (
    `run_id` IS NOT NULL OR (
      json_valid(`metadata_json`) = 1
      AND json_extract(`metadata_json`, '$.role') IN ('implementation', 'test', 'review')
    )
  );
--> statement-breakpoint

UPDATE `task_messages`
SET `trace_owner` = 'mission_pilot', `trace_channel` = 'artifact'
WHERE `id` IN (
  SELECT `artifact_message_id` FROM `mission_pilot_steps` WHERE `artifact_message_id` IS NOT NULL
  UNION SELECT `feature_plan_message_id` FROM `mission_pilot_plan_reviews`
);
--> statement-breakpoint
UPDATE `task_messages`
SET `trace_owner` = 'mission_pilot', `trace_channel` = 'pilot_thought'
WHERE `id` IN (
  SELECT `initial_prompt_message_id` FROM `mission_pilot_sessions` WHERE `initial_prompt_message_id` IS NOT NULL
)
OR (
  json_valid(`metadata_json`) = 1
  AND json_extract(`metadata_json`, '$.source') = 'mission_pilot'
  AND `trace_channel` = 'internal'
);
--> statement-breakpoint
UPDATE `task_messages`
SET `trace_owner` = 'coding_agent', `trace_channel` = 'chat'
WHERE `trace_channel` = 'internal'
  AND (`run_id` IS NOT NULL OR `role` IN ('assistant', 'tool'));
--> statement-breakpoint
UPDATE `task_messages`
SET `trace_owner` = 'user', `trace_channel` = 'chat'
WHERE `trace_channel` = 'internal' AND `role` = 'user';
--> statement-breakpoint

UPDATE `activity_events`
SET `trace_owner` = 'coding_agent', `trace_channel` = 'chat'
WHERE `run_id` IS NOT NULL;
--> statement-breakpoint
UPDATE `activity_events`
SET `trace_owner` = 'mission_pilot', `trace_channel` = 'pilot_thought'
WHERE `run_id` IS NULL AND `source` = 'mission_pilot';
--> statement-breakpoint
UPDATE `activity_events`
SET (`trace_owner`, `trace_channel`) = (
  SELECT `trace_owner`, `trace_channel`
  FROM `task_messages`
  WHERE `task_messages`.`id` = `activity_events`.`external_id`
)
WHERE `external_id` IN (SELECT `id` FROM `task_messages`);
--> statement-breakpoint
UPDATE `activity_events`
SET (`trace_owner`, `trace_channel`) = (
  SELECT `trace_owner`, `trace_channel`
  FROM `llm_usage_records`
  WHERE `llm_usage_records`.`id` = `activity_events`.`external_id`
)
WHERE `external_id` IN (SELECT `id` FROM `llm_usage_records`);
--> statement-breakpoint
UPDATE `activity_events`
SET `trace_owner` = 'user', `trace_channel` = 'chat'
WHERE `trace_channel` = 'internal' AND `source` = 'user';
--> statement-breakpoint
UPDATE `activity_events`
SET `trace_owner` = 'coding_agent', `trace_channel` = 'chat'
WHERE `trace_channel` = 'internal'
  AND `source` IN ('assistant', 'worker', 'tool', 'supervisor');
--> statement-breakpoint

CREATE INDEX `activity_events_task_channel_seq_idx` ON `activity_events` (`task_id`,`trace_channel`,`seq`);
--> statement-breakpoint
CREATE INDEX `activity_events_task_owner_channel_created_idx` ON `activity_events` (`task_id`,`trace_owner`,`trace_channel`,`created_at`);
--> statement-breakpoint
CREATE INDEX `task_messages_task_channel_created_idx` ON `task_messages` (`task_id`,`trace_channel`,`created_at`);
--> statement-breakpoint
CREATE INDEX `llm_usage_records_task_owner_created_idx` ON `llm_usage_records` (`task_id`,`trace_owner`,`created_at`);
