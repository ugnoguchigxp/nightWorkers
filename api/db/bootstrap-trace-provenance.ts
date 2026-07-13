import { client } from "./client";

export async function backfillTraceProvenance() {
	await client.execute(`
    UPDATE llm_usage_records
    SET trace_owner = 'mission_pilot', trace_channel = 'pilot_thought'
    WHERE trace_channel = 'internal'
      AND json_valid(metadata_json) = 1
      AND json_extract(metadata_json, '$.role') = 'mission_pilot'
  `);
	await client.execute(`
    UPDATE llm_usage_records
    SET trace_owner = 'coding_agent', trace_channel = 'chat'
    WHERE trace_channel = 'internal' AND run_id IS NOT NULL
  `);
	await client.execute(`
    UPDATE task_messages
    SET trace_owner = 'mission_pilot', trace_channel = 'artifact'
    WHERE trace_channel = 'internal' AND id IN (
      SELECT artifact_message_id FROM mission_pilot_steps WHERE artifact_message_id IS NOT NULL
      UNION SELECT feature_plan_message_id FROM mission_pilot_plan_reviews
      UNION SELECT source_message_id FROM mission_pilot_artifact_correction_runs
      UNION SELECT result_message_id FROM mission_pilot_artifact_correction_runs WHERE result_message_id IS NOT NULL
    )
  `);
	await client.execute(`
    UPDATE task_messages
    SET trace_owner = 'mission_pilot', trace_channel = 'pilot_thought'
    WHERE trace_channel = 'internal' AND (
      id IN (
        SELECT initial_prompt_message_id FROM mission_pilot_sessions
        WHERE initial_prompt_message_id IS NOT NULL
      )
      OR (
        json_valid(metadata_json) = 1
        AND json_extract(metadata_json, '$.source') = 'mission_pilot'
      )
    )
  `);
	await client.execute(`
    UPDATE task_messages
    SET trace_owner = 'coding_agent', trace_channel = 'chat'
    WHERE trace_channel = 'internal'
      AND (run_id IS NOT NULL OR role IN ('assistant', 'tool'))
  `);
	await client.execute(`
    UPDATE task_messages
    SET trace_owner = 'user', trace_channel = 'chat'
    WHERE trace_channel = 'internal' AND role = 'user'
  `);
	await client.execute(`
    UPDATE activity_events
    SET trace_owner = 'coding_agent', trace_channel = 'chat'
    WHERE trace_channel = 'internal' AND run_id IS NOT NULL
  `);
	await client.execute(`
    UPDATE activity_events
    SET trace_owner = 'mission_pilot', trace_channel = 'pilot_thought'
    WHERE trace_channel = 'internal' AND run_id IS NULL AND source = 'mission_pilot'
  `);
	await client.execute(`
    UPDATE activity_events
    SET (trace_owner, trace_channel) = (
      SELECT trace_owner, trace_channel FROM task_messages
      WHERE task_messages.id = activity_events.external_id
    )
    WHERE external_id IN (SELECT id FROM task_messages)
  `);
	await client.execute(`
    UPDATE activity_events
    SET (trace_owner, trace_channel) = (
      SELECT trace_owner, trace_channel FROM llm_usage_records
      WHERE llm_usage_records.id = activity_events.external_id
    )
    WHERE external_id IN (SELECT id FROM llm_usage_records)
  `);
}
