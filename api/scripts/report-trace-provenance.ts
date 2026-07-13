import { ensureNightWorkersSchema } from "../db/bootstrap";
import { PLAN_MODE_USAGE_LABELS_SQL } from "../db/bootstrap-trace-provenance";
import { client } from "../db/client";

async function count(sql: string) {
	const result = await client.execute(sql);
	return Number(result.rows[0]?.count ?? 0);
}

async function distribution(table: string) {
	const result = await client.execute(
		`SELECT trace_owner AS owner, trace_channel AS channel, count(*) AS count FROM ${table} GROUP BY trace_owner, trace_channel ORDER BY trace_owner, trace_channel`,
	);
	return result.rows.map((row) => ({
		owner: String(row.owner),
		channel: String(row.channel),
		count: Number(row.count),
	}));
}

async function main() {
	await ensureNightWorkersSchema();
	const forbidden = {
		missionPilotActivityOutsideThought: await count(
			"SELECT count(*) AS count FROM activity_events WHERE trace_owner = 'mission_pilot' AND trace_channel <> 'pilot_thought'",
		),
		nonPilotInPilotThought: await count(
			"SELECT count(*) AS count FROM activity_events WHERE trace_channel = 'pilot_thought' AND trace_owner <> 'mission_pilot'",
		),
		runEventsOutsideCodingChat: await count(
			"SELECT count(*) AS count FROM activity_events WHERE run_id IS NOT NULL AND (trace_owner <> 'coding_agent' OR trace_channel <> 'chat')",
		),
		missionPilotMessagesOutsideThought: await count(
			"SELECT count(*) AS count FROM task_messages WHERE trace_owner = 'mission_pilot' AND trace_channel <> 'pilot_thought'",
		),
		nonPilotMessagesInPilotThought: await count(
			"SELECT count(*) AS count FROM task_messages WHERE trace_channel = 'pilot_thought' AND trace_owner <> 'mission_pilot'",
		),
		planModeUsageOutsideChat: await count(
			`SELECT count(*) AS count FROM llm_usage_records WHERE (json_valid(metadata_json) = 0 OR json_extract(metadata_json, '$.role') IS NULL OR json_extract(metadata_json, '$.role') <> 'mission_pilot' OR label IN (${PLAN_MODE_USAGE_LABELS_SQL})) AND (trace_owner <> 'coding_agent' OR trace_channel <> 'chat')`,
		),
		missionPilotUsageOutsideThought: await count(
			`SELECT count(*) AS count FROM llm_usage_records WHERE json_valid(metadata_json) = 1 AND json_extract(metadata_json, '$.role') = 'mission_pilot' AND label NOT IN (${PLAN_MODE_USAGE_LABELS_SQL}) AND (trace_owner <> 'mission_pilot' OR trace_channel <> 'pilot_thought')`,
		),
		planArtifactMessagesOutsideChat: await count(
			"SELECT count(*) AS count FROM task_messages WHERE id IN (SELECT artifact_message_id FROM mission_pilot_steps WHERE artifact_message_id IS NOT NULL UNION SELECT feature_plan_message_id FROM mission_pilot_plan_reviews UNION SELECT source_message_id FROM mission_pilot_artifact_correction_runs UNION SELECT result_message_id FROM mission_pilot_artifact_correction_runs WHERE result_message_id IS NOT NULL) AND (trace_owner <> 'coding_agent' OR trace_channel <> 'chat')",
		),
		initialPromptOutsideChat: await count(
			"SELECT count(*) AS count FROM task_messages WHERE message_type = 'mission_pilot_initial_prompt' AND (trace_owner <> 'user' OR trace_channel <> 'chat')",
		),
		activityPayloadTraceMismatch: await count(
			"SELECT count(*) AS count FROM activity_events WHERE json_valid(payload_json) = 1 AND json_extract(payload_json, '$.traceProvenance.owner') IS NOT NULL AND (json_extract(payload_json, '$.traceProvenance.owner') <> trace_owner OR json_extract(payload_json, '$.traceProvenance.channel') <> trace_channel)",
		),
		messagePayloadTraceMismatch: await count(
			"SELECT count(*) AS count FROM task_messages WHERE json_valid(metadata_json) = 1 AND json_extract(metadata_json, '$.traceProvenance.owner') IS NOT NULL AND (json_extract(metadata_json, '$.traceProvenance.owner') <> trace_owner OR json_extract(metadata_json, '$.traceProvenance.channel') <> trace_channel)",
		),
		usagePayloadTraceMismatch: await count(
			"SELECT count(*) AS count FROM llm_usage_records WHERE json_valid(metadata_json) = 1 AND json_extract(metadata_json, '$.traceProvenance.owner') IS NOT NULL AND (json_extract(metadata_json, '$.traceProvenance.owner') <> trace_owner OR json_extract(metadata_json, '$.traceProvenance.channel') <> trace_channel)",
		),
	};
	const report = {
		ok: Object.values(forbidden).every((value) => value === 0),
		forbidden,
		distribution: {
			activityEvents: await distribution("activity_events"),
			taskMessages: await distribution("task_messages"),
			llmUsageRecords: await distribution("llm_usage_records"),
		},
	};
	console.log(JSON.stringify(report, null, 2));
	if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
