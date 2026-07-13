UPDATE `task_messages`
SET `trace_owner` = 'coding_agent', `trace_channel` = 'chat'
WHERE `trace_owner` = 'mission_pilot' AND `trace_channel` = 'artifact';
--> statement-breakpoint
UPDATE `task_messages`
SET `trace_owner` = 'user', `trace_channel` = 'chat'
WHERE `message_type` = 'mission_pilot_initial_prompt'
   OR `id` IN (
     SELECT `initial_prompt_message_id`
     FROM `mission_pilot_sessions`
     WHERE `initial_prompt_message_id` IS NOT NULL
   );
--> statement-breakpoint
UPDATE `llm_usage_records`
SET `trace_owner` = 'coding_agent', `trace_channel` = 'chat'
WHERE json_valid(`metadata_json`) = 0
   OR json_extract(`metadata_json`, '$.role') IS NULL
   OR json_extract(`metadata_json`, '$.role') <> 'mission_pilot'
   OR `label` IN (
     'workbench_plan_mode_gate',
     'design_questionnaire',
     'design_questionnaire_additional',
     'mock_blueprint',
     'plan_mode_data_model',
     'plan_mode_dedicated_view',
     'plan_mode_api_contract',
     'plan_mode_zod_schema',
     'specification_document'
   );
--> statement-breakpoint
UPDATE `llm_usage_records`
SET `trace_owner` = 'mission_pilot', `trace_channel` = 'pilot_thought'
WHERE json_valid(`metadata_json`) = 1
  AND json_extract(`metadata_json`, '$.role') = 'mission_pilot'
  AND `label` NOT IN (
    'workbench_plan_mode_gate',
    'design_questionnaire',
    'design_questionnaire_additional',
    'mock_blueprint',
    'plan_mode_data_model',
    'plan_mode_dedicated_view',
    'plan_mode_api_contract',
    'plan_mode_zod_schema',
    'specification_document'
  );
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
SET `trace_owner` = 'coding_agent', `trace_channel` = 'chat'
WHERE (`trace_owner` = 'mission_pilot' AND `trace_channel` = 'artifact')
   OR (
     `kind` = 'llm.usage'
     AND (
       json_valid(`payload_json`) = 0
       OR json_extract(`payload_json`, '$.role') IS NULL
       OR json_extract(`payload_json`, '$.role') <> 'mission_pilot'
       OR json_extract(`payload_json`, '$.label') IN (
         'workbench_plan_mode_gate',
         'design_questionnaire',
         'design_questionnaire_additional',
         'mock_blueprint',
         'plan_mode_data_model',
         'plan_mode_dedicated_view',
         'plan_mode_api_contract',
         'plan_mode_zod_schema',
         'specification_document'
       )
     )
   );
--> statement-breakpoint
UPDATE `activity_events`
SET `trace_owner` = 'mission_pilot', `trace_channel` = 'pilot_thought'
WHERE `kind` = 'llm.usage'
  AND json_valid(`payload_json`) = 1
  AND json_extract(`payload_json`, '$.role') = 'mission_pilot'
  AND json_extract(`payload_json`, '$.label') NOT IN (
    'workbench_plan_mode_gate',
    'design_questionnaire',
    'design_questionnaire_additional',
    'mock_blueprint',
    'plan_mode_data_model',
    'plan_mode_dedicated_view',
    'plan_mode_api_contract',
    'plan_mode_zod_schema',
    'specification_document'
  );
--> statement-breakpoint

UPDATE `task_messages`
SET `metadata_json` = json_set(
  `metadata_json`,
  '$.traceProvenance.owner', `trace_owner`,
  '$.traceProvenance.channel', `trace_channel`
)
WHERE json_valid(`metadata_json`) = 1
  AND json_extract(`metadata_json`, '$.traceProvenance.owner') IS NOT NULL;
--> statement-breakpoint
UPDATE `activity_events`
SET `payload_json` = json_set(
  `payload_json`,
  '$.traceProvenance.owner', `trace_owner`,
  '$.traceProvenance.channel', `trace_channel`
)
WHERE json_valid(`payload_json`) = 1
  AND json_extract(`payload_json`, '$.traceProvenance.owner') IS NOT NULL;
--> statement-breakpoint
UPDATE `llm_usage_records`
SET `metadata_json` = json_set(
  `metadata_json`,
  '$.traceProvenance.owner', `trace_owner`,
  '$.traceProvenance.channel', `trace_channel`
)
WHERE json_valid(`metadata_json`) = 1
  AND json_extract(`metadata_json`, '$.traceProvenance.owner') IS NOT NULL;
