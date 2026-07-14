import { asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { llmUsageRecords, tasks } from "../db/schema";
import { rebuildLlmUsageSummary } from "../services/llm-usage/summary";

const args = new Set(process.argv.slice(2));
const taskId = readOption("--task-id");
const apply = args.has("--apply");
const dryRun = args.has("--dry-run") || !apply;

if (!taskId) {
	console.error("--task-id is required");
	process.exit(1);
}
if (apply && !args.has("--task-id")) {
	console.error("--apply requires --task-id");
	process.exit(1);
}

const [task] = await db
	.select({ repositoryId: tasks.repositoryId })
	.from(tasks)
	.where(eq(tasks.id, taskId))
	.limit(1);
if (!task) {
	console.error(JSON.stringify({ ok: false, error: "task_not_found", taskId }));
	process.exit(1);
}

const rows = await db
	.select()
	.from(llmUsageRecords)
	.where(eq(llmUsageRecords.taskId, taskId))
	.orderBy(asc(llmUsageRecords.createdAt));
const report = buildReport(rows);
if (dryRun) {
	console.log(
		JSON.stringify({ ok: true, dryRun: true, taskId, ...report }, null, 2),
	);
	process.exit(0);
}

if (report.ambiguousRows.length > 0 || report.chains.length === 0) {
	console.error(
		JSON.stringify(
			{
				ok: false,
				taskId,
				error: "no_provable_cumulative_chain",
				...report,
			},
			null,
			2,
		),
	);
	process.exit(1);
}

await db.transaction(async (tx) => {
	for (const chain of report.chains) {
		for (const row of chain.rows) {
			await tx
				.update(llmUsageRecords)
				.set({
					inputTokens: row.delta.inputTokens,
					cachedInputTokens: row.delta.cachedInputTokens,
					outputTokens: row.delta.outputTokens,
					reasoningOutputTokens: row.delta.reasoningOutputTokens,
					totalTokens: row.delta.totalTokens,
					usageCounterScope: "provider_session_cumulative",
					usageNormalizationStatus: row.status,
					metadataJson: {
						...(row.metadataJson ?? {}),
						usageNormalization: {
							status: row.status,
							providerSessionKey: chain.providerSessionKey,
							previousRaw: row.previousRaw,
							currentRaw: row.currentRaw,
							delta: row.delta,
						},
					},
					updatedAt: new Date(),
				})
				.where(eq(llmUsageRecords.id, row.id));
		}
	}
});
if (task.repositoryId) {
	await rebuildLlmUsageSummary({
		repositoryId: task.repositoryId,
		reset: true,
	});
}
console.log(
	JSON.stringify({ ok: true, dryRun: false, taskId, ...report }, null, 2),
);

function readOption(name: string) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

type UsageRow = typeof llmUsageRecords.$inferSelect;
type Counters = {
	inputTokens: number | null;
	cachedInputTokens: number | null;
	outputTokens: number | null;
	reasoningOutputTokens: number | null;
};

function buildReport(rows: UsageRow[]) {
	const chains = new Map<
		string,
		{ provider: string; providerSessionKey: string; rows: UsageRow[] }
	>();
	const ambiguousRows: string[] = [];
	for (const row of rows) {
		const metadata = asRecord(row.metadataJson);
		const normalization = asRecord(metadata?.usageNormalization);
		const candidate =
			row.provider === "codex" &&
			(row.label === "codex-runtime" ||
				row.usageCounterScope === "provider_session_cumulative" ||
				typeof metadata?.providerThreadId === "string");
		if (!candidate) continue;
		const providerSessionKey =
			(row.usageCounterScope === "provider_session_cumulative" &&
			typeof normalization?.providerSessionKey === "string"
				? normalization.providerSessionKey
				: null) ??
			(typeof metadata?.providerThreadId === "string"
				? metadata.providerThreadId
				: null);
		if (!providerSessionKey) {
			ambiguousRows.push(row.id);
			continue;
		}
		const key = JSON.stringify([row.provider, providerSessionKey]);
		const chain = chains.get(key) ?? {
			provider: row.provider,
			providerSessionKey,
			rows: [],
		};
		chain.rows.push(row);
		chains.set(key, chain);
	}
	const reports = [...chains.values()].map((chain) => ({
		...chain,
		...buildChain(chain.rows),
	}));
	ambiguousRows.push(...reports.flatMap((report) => report.invalidRows));
	return {
		chains: reports.filter(
			(chain) => chain.rows.length > 1 && chain.invalidRows.length === 0,
		),
		ambiguousRows: [...new Set(ambiguousRows)],
	};
}

function buildChain(rows: UsageRow[]) {
	let previous: Counters | null = null;
	const invalidRows: string[] = [];
	const normalizedRows = rows.map((row) => {
		const current = readCurrentRawCounters(row);
		const reset = previous ? hasDecrease(previous, current) : false;
		const explicitReset =
			asRecord(asRecord(row.metadataJson)?.usageNormalization)?.status ===
				"counter_reset" || row.usageNormalizationStatus === "counter_reset";
		if (reset && !explicitReset) invalidRows.push(row.id);
		const delta = previous && !reset ? subtract(current, previous) : current;
		const invalidCachedDelta =
			delta.inputTokens !== null &&
			delta.cachedInputTokens !== null &&
			delta.cachedInputTokens > delta.inputTokens;
		const storedDelta = {
			...delta,
			cachedInputTokens: invalidCachedDelta ? null : delta.cachedInputTokens,
		};
		const status = invalidCachedDelta
			? "invalid_cached_delta"
			: reset
				? "counter_reset"
				: previous
					? "delta"
					: "first_snapshot";
		const result = {
			id: row.id,
			previousRaw: previous,
			currentRaw: current,
			delta: {
				...storedDelta,
				totalTokens:
					storedDelta.inputTokens !== null || storedDelta.outputTokens !== null
						? (storedDelta.inputTokens ?? 0) + (storedDelta.outputTokens ?? 0)
						: null,
			},
			status,
			metadataJson: asRecord(row.metadataJson),
		};
		previous = current;
		return result;
	});
	return { rows: normalizedRows, invalidRows };
}

function readCurrentRawCounters(row: UsageRow): Counters {
	const currentRaw = asRecord(
		asRecord(asRecord(row.metadataJson)?.usageNormalization)?.currentRaw,
	);
	return {
		inputTokens: readCounter(currentRaw?.inputTokens, row.inputTokens),
		cachedInputTokens: readCounter(
			currentRaw?.cachedInputTokens,
			row.cachedInputTokens,
		),
		outputTokens: readCounter(currentRaw?.outputTokens, row.outputTokens),
		reasoningOutputTokens: readCounter(
			currentRaw?.reasoningOutputTokens,
			row.reasoningOutputTokens,
		),
	};
}

function readCounter(value: unknown, fallback: number | null) {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(0, Math.floor(value))
		: fallback;
}

function hasDecrease(previous: Counters, current: Counters) {
	return (Object.keys(previous) as Array<keyof Counters>).some(
		(key) =>
			previous[key] !== null &&
			current[key] !== null &&
			(current[key] as number) < (previous[key] as number),
	);
}

function subtract(current: Counters, previous: Counters): Counters {
	return {
		inputTokens: subtractOne(current.inputTokens, previous.inputTokens),
		cachedInputTokens: subtractOne(
			current.cachedInputTokens,
			previous.cachedInputTokens,
		),
		outputTokens: subtractOne(current.outputTokens, previous.outputTokens),
		reasoningOutputTokens: subtractOne(
			current.reasoningOutputTokens,
			previous.reasoningOutputTokens,
		),
	};
}

function subtractOne(current: number | null, previous: number | null) {
	return current === null ? null : Math.max(0, current - (previous ?? 0));
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
