import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SQLITE_BUFFER_SIZE = 128 * 1024 * 1024;

export function parseRunControlComparisonArgs(argv) {
	const options = { baseline: "", current: "sqlite.db", limit: 20, json: false };
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === "--baseline") options.baseline = argv[++index] || "";
		else if (value === "--current") options.current = argv[++index] || "";
		else if (value === "--limit") options.limit = Number(argv[++index] || "20");
		else if (value === "--json") options.json = true;
		else throw new Error(`Unknown argument: ${value}`);
	}
	if (!options.baseline) throw new Error("--baseline <sqlite path> is required.");
	if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 500)
		throw new Error("--limit must be an integer between 1 and 500.");
	return options;
}

export function readRunControlDatabaseMetrics(databasePath, options = {}) {
	const resolvedPath = path.resolve(databasePath);
	if (!fs.existsSync(resolvedPath))
		throw new Error(`SQLite database not found: ${resolvedPath}`);
	const limit = options.limit ?? 20;
	const base = queryOne(
		resolvedPath,
		`WITH selected_runs AS (
       SELECT id, started_at, finished_at, ended_at
       FROM task_runs
       ORDER BY started_at DESC
       LIMIT ${Number(limit)}
     )
     SELECT
       count(*) AS runCount,
       coalesce(sum(coalesce(finished_at, ended_at, started_at) - started_at), 0) * 1000 AS runDurationMs,
       coalesce((SELECT count(*) FROM llm_usage_records l JOIN selected_runs r ON r.id = l.run_id), 0) AS modelSteps,
       coalesce((SELECT sum(coalesce(input_tokens, 0)) FROM llm_usage_records l JOIN selected_runs r ON r.id = l.run_id), 0) AS inputTokens,
       coalesce((SELECT sum(coalesce(output_tokens, 0)) FROM llm_usage_records l JOIN selected_runs r ON r.id = l.run_id), 0) AS outputTokens,
       coalesce((SELECT sum(length(coalesce(message, '')) + length(coalesce(payload_json, ''))) FROM task_events e JOIN selected_runs r ON r.id = e.task_run_id), 0) AS eventChars
     FROM selected_runs`,
	);
	const hasRunControl = hasTable(resolvedPath, "task_run_action_records");
	const control = hasRunControl
		? queryOne(
				resolvedPath,
				`WITH selected_runs AS (
           SELECT id FROM task_runs ORDER BY started_at DESC LIMIT ${Number(limit)}
         )
         SELECT
           count(*) AS actionCount,
           coalesce(sum(repeat_count), 0) AS reusedActionCount,
           coalesce(sum(case when domain_outcome = 'failed' then 1 else 0 end), 0) AS domainFailureCount,
           coalesce(sum(case when transport_status = 'failed' then 1 else 0 end), 0) AS transportFailureCount,
           coalesce(sum(length(coalesce(model_view_json, ''))), 0) AS modelVisibleChars
         FROM task_run_action_records a
         JOIN selected_runs r ON r.id = a.run_id`,
			)
		: {
				actionCount: 0,
				reusedActionCount: 0,
				domainFailureCount: 0,
				transportFailureCount: 0,
				modelVisibleChars: 0,
			};
	const metrics = normalizeMetrics({
		databasePath: resolvedPath,
		hasRunControl,
		...base,
		...control,
	});
	const runCount = Number(metrics.runCount || 0);
	return {
		...metrics,
		modelStepsPerRun: perRun(metrics.modelSteps, runCount),
		inputTokensPerRun: perRun(metrics.inputTokens, runCount),
		outputTokensPerRun: perRun(metrics.outputTokens, runCount),
		eventCharsPerRun: perRun(metrics.eventChars, runCount),
		runDurationMsPerRun: perRun(metrics.runDurationMs, runCount),
	};
}

export function compareRunControlMetrics(baseline, current) {
	const metricKeys = [
		"runCount",
		"runDurationMs",
		"runDurationMsPerRun",
		"modelSteps",
		"modelStepsPerRun",
		"inputTokens",
		"inputTokensPerRun",
		"outputTokens",
		"outputTokensPerRun",
		"eventChars",
		"eventCharsPerRun",
		"actionCount",
		"reusedActionCount",
		"domainFailureCount",
		"transportFailureCount",
		"modelVisibleChars",
	];
	return Object.fromEntries(
		metricKeys.map((key) => {
			const before = Number(baseline[key] || 0);
			const after = Number(current[key] || 0);
			return [
				key,
				{
					baseline: before,
					current: after,
					delta: after - before,
					deltaPercent:
						before === 0 ? null : Math.round(((after - before) / before) * 10_000) / 100,
				},
			];
		}),
	);
}

function perRun(value, runCount) {
	return runCount > 0 ? Math.round((Number(value || 0) / runCount) * 100) / 100 : 0;
}

function queryOne(databasePath, sql) {
	const output = execFileSync("sqlite3", ["-json", databasePath, sql], {
		encoding: "utf8",
		maxBuffer: SQLITE_BUFFER_SIZE,
	});
	return JSON.parse(output || "[]")[0] ?? {};
}

function hasTable(databasePath, tableName) {
	const row = queryOne(
		databasePath,
		`SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name='${tableName.replaceAll("'", "''")}'`,
	);
	return Number(row.count || 0) > 0;
}

function normalizeMetrics(metrics) {
	return Object.fromEntries(
		Object.entries(metrics).map(([key, value]) => [
			key,
			key === "databasePath" || key === "hasRunControl" ? value : Number(value || 0),
		]),
	);
}

function formatComparison(result) {
	const rows = Object.entries(result.comparison).map(([metric, value]) => ({
		metric,
		baseline: value.baseline,
		current: value.current,
		delta: value.delta,
		deltaPercent:
			value.deltaPercent === null ? "n/a" : `${value.deltaPercent.toFixed(2)}%`,
	}));
	console.log(`baseline: ${result.baseline.databasePath}`);
	console.log(`current:  ${result.current.databasePath}`);
	console.table(rows);
}

function main() {
	const options = parseRunControlComparisonArgs(process.argv.slice(2));
	const baseline = readRunControlDatabaseMetrics(options.baseline, options);
	const current = readRunControlDatabaseMetrics(options.current, options);
	const result = {
		generatedAt: new Date().toISOString(),
		limit: options.limit,
		baseline,
		current,
		comparison: compareRunControlMetrics(baseline, current),
	};
	if (options.json) console.log(JSON.stringify(result, null, 2));
	else formatComparison(result);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
	main();
