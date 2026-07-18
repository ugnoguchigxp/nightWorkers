import { normalizeInputTokenBreakdown } from "../../../shared/llm-usage-tokens";

export type OverviewRange = "24h" | "7d" | "30d" | "all";

export type UsageAggregateRow = {
	inputTokens?: number | null;
	outputTokens?: number | null;
	cachedInputTokens?: number | null;
	reasoningOutputTokens?: number | null;
	systemPromptTokens?: number | null;
	userPromptTokens?: number | null;
	stateCardTokens?: number | null;
	totalTokens?: number | null;
	durationMs?: number | null;
	usageMode?: string | null;
};

export type UsageSummaryAggregateRow = UsageAggregateRow & {
	totalDurationMs?: number | null;
	outputDurationMs?: number | null;
	measuredDurationCallCount?: number | null;
	callCount?: number | null;
	measuredCallCount?: number | null;
	estimatedCallCount?: number | null;
	mixedCallCount?: number | null;
	unavailableCallCount?: number | null;
};

export type OverviewWarning = Record<string, unknown> & {
	code: string;
	callCount?: number;
};

export type ModelPricingStatus = "priced" | "manual" | "missing" | "ambiguous";

export function emptyUsageSummary() {
	return {
		inputTokens: 0,
		promptInputTokens: 0,
		outputTokens: 0,
		cachedInputTokens: 0,
		reasoningOutputTokens: 0,
		stateCardTokens: 0,
		totalTokens: 0,
		totalDurationMs: 0,
		outputDurationMs: 0,
		measuredDurationCallCount: 0,
		outputTokensPerSecond: null as number | null,
		callCount: 0,
		measuredCallCount: 0,
		estimatedCallCount: 0,
		mixedCallCount: 0,
		unavailableCallCount: 0,
	};
}

export function emptyBucket(input: {
	key: string;
	startsAt: string;
	endsAt: string;
}) {
	return { ...input, ...emptyUsageSummary() };
}

export function emptyModelUsage(
	provider: string,
	model: string | null,
	pricingStatus: ModelPricingStatus,
) {
	return {
		provider,
		model,
		pricingStatus,
		estimatedCost: null as number | null,
		estimatedCredits: 0,
		...emptyUsageSummary(),
	};
}

export function mergePricingStatus(
	current: ModelPricingStatus,
	next: ModelPricingStatus,
): ModelPricingStatus {
	if (current === next) return current;
	if (current === "ambiguous" || next === "ambiguous") return "ambiguous";
	if (current === "missing" || next === "missing") return "missing";
	if (current === "manual" || next === "manual") return "manual";
	return "priced";
}

export function normalizePricingStatus(status: string): ModelPricingStatus {
	if (status === "priced" || status === "manual" || status === "ambiguous") {
		return status;
	}
	return "missing";
}

export function addAggregateUsage(
	target: ReturnType<typeof emptyUsageSummary>,
	row: UsageSummaryAggregateRow,
) {
	target.inputTokens += row.inputTokens ?? 0;
	target.promptInputTokens +=
		(row.systemPromptTokens ?? 0) +
		(row.userPromptTokens ?? 0) +
		(row.stateCardTokens ?? 0);
	target.outputTokens += row.outputTokens ?? 0;
	target.cachedInputTokens +=
		normalizeInputTokenBreakdown(row).cachedInputTokens;
	target.reasoningOutputTokens += row.reasoningOutputTokens ?? 0;
	target.stateCardTokens += row.stateCardTokens ?? 0;
	target.totalTokens += normalizeTotal(row);
	target.totalDurationMs += row.totalDurationMs ?? row.durationMs ?? 0;
	target.outputDurationMs += row.outputDurationMs ?? 0;
	target.measuredDurationCallCount += row.measuredDurationCallCount ?? 0;
	target.callCount += row.callCount ?? 0;
	target.measuredCallCount += row.measuredCallCount ?? 0;
	target.estimatedCallCount += row.estimatedCallCount ?? 0;
	target.mixedCallCount += row.mixedCallCount ?? 0;
	target.unavailableCallCount += row.unavailableCallCount ?? 0;
	target.outputTokensPerSecond =
		calculateAggregateOutputTokensPerSecond(target);
}

export function normalizeTotal(row: UsageAggregateRow) {
	return row.totalTokens ?? (row.inputTokens ?? 0) + (row.outputTokens ?? 0);
}

export function calculateOutputTokensPerSecond(row: UsageAggregateRow) {
	const outputTokens = row.outputTokens ?? 0;
	const durationMs = row.durationMs ?? 0;
	if (outputTokens <= 0 || durationMs <= 0) return null;
	return roundTokensPerSecond(outputTokens / (durationMs / 1000));
}

export function getRangeCutoff(range: OverviewRange) {
	const now = Date.now();
	if (range === "24h") return new Date(now - 24 * 60 * 60 * 1000);
	if (range === "7d") return new Date(now - 7 * 24 * 60 * 60 * 1000);
	if (range === "30d") return new Date(now - 30 * 24 * 60 * 60 * 1000);
	return null;
}

export function toUtcHour(date: Date) {
	return new Date(Math.floor(date.getTime() / 3_600_000) * 3_600_000);
}

export function getBucketKey(
	date: Date,
	range: OverviewRange,
	timezone: string,
) {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-CA", {
			timeZone: timezone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: range === "24h" ? "2-digit" : undefined,
			hourCycle: "h23",
		})
			.formatToParts(date)
			.map((part) => [part.type, part.value]),
	);
	const day = `${parts.year}-${parts.month}-${parts.day}`;
	if (range === "24h") {
		const key = `${day}T${parts.hour || "00"}`;
		return { key, startsAt: `${key}:00:00`, endsAt: `${key}:59:59` };
	}
	if (range === "all") {
		const key = `${parts.year}-${parts.month}`;
		const lastDay = new Date(
			Date.UTC(Number(parts.year), Number(parts.month), 0),
		)
			.getUTCDate()
			.toString()
			.padStart(2, "0");
		return {
			key,
			startsAt: `${key}-01T00:00:00`,
			endsAt: `${key}-${lastDay}T23:59:59`,
		};
	}
	return { key: day, startsAt: `${day}T00:00:00`, endsAt: `${day}T23:59:59` };
}

export function fillBuckets(
	buckets: Array<ReturnType<typeof emptyBucket>>,
	range: OverviewRange,
	timezone: string,
	now = new Date(Date.now()),
) {
	if (range === "all") return fillAllRangeBuckets(buckets, timezone, now);
	const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
	const nowMs = now.getTime();
	const count = range === "24h" ? 24 : range === "7d" ? 7 : 30;
	const step = range === "24h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
	const generated = Array.from({ length: count }, (_, index) => {
		const descriptor = getBucketKey(
			new Date(nowMs - (count - 1 - index) * step),
			range,
			timezone,
		);
		return byKey.get(descriptor.key) ?? emptyBucket(descriptor);
	});
	const generatedKeys = new Set(generated.map((bucket) => bucket.key));
	return [
		...buckets.filter((bucket) => !generatedKeys.has(bucket.key)),
		...generated,
	].sort((left, right) => left.key.localeCompare(right.key));
}

function fillAllRangeBuckets(
	buckets: Array<ReturnType<typeof emptyBucket>>,
	timezone: string,
	now: Date,
) {
	if (buckets.length === 0) return [];
	const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
	const firstKey = [...byKey.keys()].sort()[0];
	const currentKey = getBucketKey(now, "all", timezone).key;
	const [firstYear, firstMonth] = firstKey.split("-").map(Number);
	const [currentYear, currentMonth] = currentKey.split("-").map(Number);
	const output = [];
	let cursor = new Date(Date.UTC(firstYear, firstMonth - 1, 15));
	const end = new Date(Date.UTC(currentYear, currentMonth - 1, 15));
	while (cursor <= end && output.length < 600) {
		const descriptor = getBucketKey(cursor, "all", timezone);
		output.push(byKey.get(descriptor.key) ?? emptyBucket(descriptor));
		cursor = new Date(
			Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 15),
		);
	}
	return output;
}

export function maxIso(current: string | null, next: string) {
	if (current === null) return next;
	return next > current ? next : current;
}

function calculateAggregateOutputTokensPerSecond(input: {
	outputTokens: number;
	outputDurationMs: number;
}) {
	if (input.outputTokens <= 0 || input.outputDurationMs <= 0) return null;
	return roundTokensPerSecond(
		input.outputTokens / (input.outputDurationMs / 1000),
	);
}

function roundTokensPerSecond(value: number) {
	return Math.round(value * 100) / 100;
}
