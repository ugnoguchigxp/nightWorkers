import { ensureNightWorkersSchema } from "../db/bootstrap";
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
		missionPilotInChat: await count(
			"SELECT count(*) AS count FROM activity_events WHERE trace_owner = 'mission_pilot' AND trace_channel = 'chat'",
		),
		nonPilotInPilotThought: await count(
			"SELECT count(*) AS count FROM activity_events WHERE trace_channel = 'pilot_thought' AND trace_owner <> 'mission_pilot'",
		),
		runEventsOutsideCodingChat: await count(
			"SELECT count(*) AS count FROM activity_events WHERE run_id IS NOT NULL AND (trace_owner <> 'coding_agent' OR trace_channel <> 'chat')",
		),
		pilotMessagesInChat: await count(
			"SELECT count(*) AS count FROM task_messages WHERE trace_owner = 'mission_pilot' AND trace_channel = 'chat'",
		),
		nonPilotMessagesInPilotThought: await count(
			"SELECT count(*) AS count FROM task_messages WHERE trace_channel = 'pilot_thought' AND trace_owner <> 'mission_pilot'",
		),
		pilotUsageOutsideThought: await count(
			"SELECT count(*) AS count FROM llm_usage_records WHERE (trace_owner = 'mission_pilot' AND trace_channel <> 'pilot_thought') OR (json_valid(metadata_json) = 1 AND json_extract(metadata_json, '$.role') = 'mission_pilot' AND (trace_owner <> 'mission_pilot' OR trace_channel <> 'pilot_thought'))",
		),
		nonPilotUsageInPilotThought: await count(
			"SELECT count(*) AS count FROM llm_usage_records WHERE trace_channel = 'pilot_thought' AND trace_owner <> 'mission_pilot'",
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
