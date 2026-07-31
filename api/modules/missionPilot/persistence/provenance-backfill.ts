import type { MissionPilotSqlClient } from "./bootstrap";

export async function backfillMissionPilotTraceProvenance(
	client: MissionPilotSqlClient,
) {
	await client.execute(`
    UPDATE llm_usage_records
    SET trace_owner = 'coding_agent', trace_channel = 'chat'
	    WHERE json_valid(metadata_json) = 0
	       OR json_extract(metadata_json, '$.role') IS NULL
	       OR json_extract(metadata_json, '$.role') <> 'mission_pilot'
	  `);
	await client.execute(`
    UPDATE llm_usage_records
    SET trace_owner = 'mission_pilot', trace_channel = 'pilot_thought'
	    WHERE json_valid(metadata_json) = 1
	      AND json_extract(metadata_json, '$.role') = 'mission_pilot'
  `);
	await client.execute(`
    UPDATE llm_usage_records
    SET trace_owner = 'coding_agent', trace_channel = 'chat'
    WHERE run_id IS NOT NULL
  `);
	await client.execute(`
    UPDATE task_messages
	    SET trace_owner = 'mission_pilot', trace_channel = 'pilot_thought'
	    WHERE trace_channel = 'internal' AND (
        json_valid(metadata_json) = 1
        AND json_extract(metadata_json, '$.source') = 'mission_pilot'
    )
  `);
	await client.execute(`
    UPDATE task_messages
    SET trace_owner = 'user', trace_channel = 'chat'
    WHERE message_type = 'mission_pilot_initial_prompt'
      OR id IN (
        SELECT initial_prompt_message_id FROM mission_pilot_sessions
        WHERE initial_prompt_message_id IS NOT NULL
      )
  `);
	await client.execute(`
    UPDATE task_messages
    SET trace_owner = 'coding_agent', trace_channel = 'chat'
    WHERE run_id IS NOT NULL
      OR (trace_channel = 'internal' AND role IN ('assistant', 'tool'))
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
	await client.execute(`
    UPDATE activity_events
	    SET trace_owner = 'coding_agent', trace_channel = 'chat'
	    WHERE kind = 'llm.usage'
	      AND (
	        json_valid(payload_json) = 0
	        OR json_extract(payload_json, '$.role') IS NULL
	        OR json_extract(payload_json, '$.role') <> 'mission_pilot'
	      )
	  `);
	await client.execute(`
    UPDATE activity_events
    SET trace_owner = 'mission_pilot', trace_channel = 'pilot_thought'
	    WHERE kind = 'llm.usage'
	      AND json_valid(payload_json) = 1
	      AND json_extract(payload_json, '$.role') = 'mission_pilot'
  `);
	await client.execute(`
    UPDATE activity_events
    SET trace_owner = 'coding_agent', trace_channel = 'chat'
    WHERE run_id IS NOT NULL
  `);
	for (const [table, jsonColumn] of [
		["activity_events", "payload_json"],
		["task_messages", "metadata_json"],
		["llm_usage_records", "metadata_json"],
	] as const) {
		await client.execute(`
      UPDATE ${table}
      SET ${jsonColumn} = json_set(
        ${jsonColumn},
        '$.traceProvenance.owner', trace_owner,
        '$.traceProvenance.channel', trace_channel
      )
      WHERE json_valid(${jsonColumn}) = 1
        AND json_extract(${jsonColumn}, '$.traceProvenance.owner') IS NOT NULL
    `);
	}
}
