import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../../db/client";
import {
	llmUsageRecords,
	llmUsageSummaryBuckets,
	llmUsageSummaryWarnings,
	repositories,
	tasks,
} from "../../db/schema";
import { calculateUsageCost, findPricingForUsage } from "../pricing";
import {
	convertCurrency,
	type NightWorkersCurrency,
	readFxRateCache,
	readGeneralSettings,
} from "../settings/general-settings";

export type OverviewRange = "24h" | "7d" | "30d" | "all";

export type OverviewDashboard = Awaited<
	ReturnType<typeof buildOverviewDashboard>
>;

type UsageAggregateRow = {
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

type UsageSummaryAggregateRow = UsageAggregateRow & {
	totalDurationMs?: number | null;
	outputDurationMs?: number | null;
	measuredDurationCallCount?: number | null;
	callCount?: number | null;
	measuredCallCount?: number | null;
	estimatedCallCount?: number | null;
	mixedCallCount?: number | null;
	unavailableCallCount?: number | null;
};

type OverviewWarning = Record<string, unknown> & {
	code: string;
	callCount?: number;
};

export async function buildOverviewDashboard(input: {
	range?: OverviewRange;
	repositoryId?: string | null;
	timezone?: string | null;
	currency?: NightWorkersCurrency | null;
	activeProvider?: string | null;
	activeModel?: string | null;
}) {
	const general = readGeneralSettings();
	const range = input.range || "30d";
	const timezone = input.timezone || general.timezone;
	const currency = input.currency || general.currency;
	const cutoff = getRangeCutoff(range);

	if (input.repositoryId) {
		const [repo] = await db
			.select({ id: repositories.id })
			.from(repositories)
			.where(eq(repositories.id, input.repositoryId))
			.limit(1);
		if (!repo) {
			const error = new Error("Repository not found");
			(error as Error & { statusCode?: number }).statusCode = 404;
			throw error;
		}
	}

	const summaryConditions = [];
	if (cutoff)
		summaryConditions.push(
			gte(llmUsageSummaryBuckets.bucketHourUtc, toUtcHour(cutoff)),
		);
	if (input.repositoryId)
		summaryConditions.push(
			eq(llmUsageSummaryBuckets.repositoryKey, input.repositoryId),
		);
	const warningConditions = [];
	if (cutoff)
		warningConditions.push(
			gte(llmUsageSummaryWarnings.bucketHourUtc, toUtcHour(cutoff)),
		);
	if (input.repositoryId)
		warningConditions.push(
			eq(llmUsageSummaryWarnings.repositoryKey, input.repositoryId),
		);

	const summaryRows = await db
		.select()
		.from(llmUsageSummaryBuckets)
		.where(summaryConditions.length ? and(...summaryConditions) : undefined)
		.orderBy(llmUsageSummaryBuckets.bucketHourUtc);

	const summaryWarningRows = await db
		.select()
		.from(llmUsageSummaryWarnings)
		.where(warningConditions.length ? and(...warningConditions) : undefined);

	const usage = emptyUsageSummary();
	const buckets = new Map<string, ReturnType<typeof emptyBucket>>();
	const modelMap = new Map<string, ReturnType<typeof emptyModelUsage>>();
	const warningsMap = new Map<string, OverviewWarning>();
	const fxCache = readFxRateCache();
	let estimatedTotal = 0;
	let inputCost = 0;
	let cachedInputCost = 0;
	let outputCost = 0;
	let reasoningOutputCost = 0;
	let creditTotal = 0;
	let pricedCallCount = 0;
	let unpricedCallCount = 0;
	let pricingUpdatedAt: string | null = null;
	let fxRate: number | null = null;
	let fxBaseCurrency: string | null = null;

	for (const row of summaryRows) {
		addAggregateUsage(usage, row);
		const bucketKey = getBucketKey(row.bucketHourUtc, range, timezone);
		const bucket = buckets.get(bucketKey.key) || emptyBucket(bucketKey);
		addAggregateUsage(bucket, row);
		buckets.set(bucketKey.key, bucket);

		const modelKey = `${row.provider}:${row.model || "unknown"}`;
		const modelUsage =
			modelMap.get(modelKey) || emptyModelUsage(row.provider, row.model);
		addAggregateUsage(modelUsage, row);
		modelMap.set(modelKey, modelUsage);
		if (row.pricingStatus === "manual") modelUsage.pricingStatus = "manual";
		else if (
			row.pricingStatus === "priced" &&
			modelUsage.pricingStatus === "missing"
		) {
			modelUsage.pricingStatus = "priced";
		}

		pricedCallCount += row.pricedCallCount;
		unpricedCallCount += row.unpricedCallCount;
		if (row.pricingUpdatedAt) {
			pricingUpdatedAt = maxIso(
				pricingUpdatedAt,
				row.pricingUpdatedAt.toISOString(),
			);
		}
		if (row.pricingStatus === "missing") {
			continue;
		}
		if (!row.pricingCurrencyCode) {
			continue;
		}

		if (row.pricingCurrencyCode === "CREDITS") {
			creditTotal += row.estimatedCost;
			modelUsage.estimatedCost += row.estimatedCost;
			inputCost += row.inputCost;
			cachedInputCost += row.cachedInputCost;
			outputCost += row.outputCost;
			reasoningOutputCost += row.reasoningOutputCost;
		} else {
			const converted = convertCurrency({
				amount: row.estimatedCost,
				from: row.pricingCurrencyCode as NightWorkersCurrency,
				to: currency,
				cache: fxCache,
			});
			if (converted.amount === null) {
				warningsMap.set(`fx:${row.pricingCurrencyCode}:${currency}`, {
					code: "fx_unavailable",
					currency,
					baseCurrency: row.pricingCurrencyCode,
				});
			} else {
				fxRate = converted.rate;
				fxBaseCurrency = row.pricingCurrencyCode;
				estimatedTotal += converted.amount;
				modelUsage.estimatedCost += converted.amount;
				inputCost += convertCostPart(row.inputCost, {
					from: row.pricingCurrencyCode,
					to: currency,
					cache: fxCache,
				});
				cachedInputCost += convertCostPart(row.cachedInputCost, {
					from: row.pricingCurrencyCode,
					to: currency,
					cache: fxCache,
				});
				outputCost += convertCostPart(row.outputCost, {
					from: row.pricingCurrencyCode,
					to: currency,
					cache: fxCache,
				});
				reasoningOutputCost += convertCostPart(row.reasoningOutputCost, {
					from: row.pricingCurrencyCode,
					to: currency,
					cache: fxCache,
				});
			}
		}
	}

	for (const warning of summaryWarningRows) {
		if (warning.code === "usage_estimated") continue;
		const key = `${warning.code}:${warning.provider}:${warning.modelKey}:${warning.detailKey}`;
		const current = warningsMap.get(key);
		const detail =
			warning.detailJson && typeof warning.detailJson === "object"
				? warning.detailJson
				: {};
		warningsMap.set(key, {
			...detail,
			code: warning.code,
			provider: warning.provider,
			model: warning.model,
			callCount: (current?.callCount || 0) + warning.callCount,
		});
	}

	if (usage.estimatedCallCount > 0) {
		warningsMap.set("usage_estimated", {
			code: "usage_estimated",
			estimatedCallCount: usage.estimatedCallCount,
		});
	}

	const rawUsageRowCount =
		summaryRows.length === 0
			? await countRawUsageRows({ cutoff, repositoryId: input.repositoryId })
			: 0;
	if (rawUsageRowCount > 0) {
		warningsMap.set("summary_backfill_required", {
			code: "summary_backfill_required",
			callCount: rawUsageRowCount,
		});
	}

	const recentCalls = await buildRecentExpensiveCalls({
		cutoff,
		repositoryId: input.repositoryId,
		currency,
		fxCache,
	});

	return {
		generatedAt: new Date().toISOString(),
		scope: {
			repositoryId: input.repositoryId || null,
			range,
			timezone,
			currency,
		},
		settings: {
			language: general.language,
			timezone: general.timezone,
			currency: general.currency,
			activeProvider: input.activeProvider || null,
			activeModel: input.activeModel || null,
		},
		usage,
		cost: {
			currency,
			estimatedTotal: pricedCallCount > 0 ? estimatedTotal : null,
			inputCost: pricedCallCount > 0 ? inputCost : null,
			cachedInputCost: pricedCallCount > 0 ? cachedInputCost : null,
			outputCost: pricedCallCount > 0 ? outputCost : null,
			reasoningOutputCost: pricedCallCount > 0 ? reasoningOutputCost : null,
			creditTotal: creditTotal > 0 ? creditTotal : null,
			pricedCallCount,
			unpricedCallCount,
			fxRate,
			fxBaseCurrency,
			fxUpdatedAt: fxCache?.fetchedAt ?? null,
			pricingUpdatedAt,
			incompleteReasons: Array.from(warningsMap.values()).map(
				(warning) => warning.code,
			),
		},
		dailyUsage: fillBuckets(Array.from(buckets.values()), range, timezone),
		modelBreakdown: Array.from(modelMap.values()).sort(
			(a, b) => b.totalTokens - a.totalTokens,
		),
		recentExpensiveCalls: recentCalls
			.sort(
				(a, b) =>
					(b.estimatedCost ?? 0) - (a.estimatedCost ?? 0) ||
					b.totalTokens - a.totalTokens,
			)
			.slice(0, 12),
		warnings: Array.from(warningsMap.values()),
	};
}

function emptyUsageSummary() {
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

function emptyBucket(input: { key: string; startsAt: string; endsAt: string }) {
	return { ...input, ...emptyUsageSummary() };
}

function emptyModelUsage(provider: string, model: string | null) {
	return {
		provider,
		model,
		pricingStatus: "missing" as "priced" | "manual" | "missing" | "ambiguous",
		estimatedCost: 0,
		...emptyUsageSummary(),
	};
}

function addAggregateUsage(
	target: ReturnType<typeof emptyUsageSummary>,
	row: UsageSummaryAggregateRow,
) {
	target.inputTokens += row.inputTokens ?? 0;
	target.promptInputTokens +=
		(row.systemPromptTokens ?? 0) +
		(row.userPromptTokens ?? 0) +
		(row.stateCardTokens ?? 0);
	target.outputTokens += row.outputTokens ?? 0;
	target.cachedInputTokens += row.cachedInputTokens ?? 0;
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

function normalizeTotal(row: UsageAggregateRow) {
	return row.totalTokens ?? (row.inputTokens ?? 0) + (row.outputTokens ?? 0);
}

function calculateOutputTokensPerSecond(row: UsageAggregateRow) {
	const outputTokens = row.outputTokens ?? 0;
	const durationMs = row.durationMs ?? 0;
	if (outputTokens <= 0 || durationMs <= 0) return null;
	return roundTokensPerSecond(outputTokens / (durationMs / 1000));
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

async function buildRecentExpensiveCalls(input: {
	cutoff: Date | null;
	repositoryId?: string | null;
	currency: NightWorkersCurrency;
	fxCache: ReturnType<typeof readFxRateCache>;
}) {
	const conditions = [];
	if (input.cutoff)
		conditions.push(gte(llmUsageRecords.createdAt, input.cutoff));
	if (input.repositoryId)
		conditions.push(eq(tasks.repositoryId, input.repositoryId));
	const rows = await db
		.select({
			id: llmUsageRecords.id,
			taskId: llmUsageRecords.taskId,
			runId: llmUsageRecords.runId,
			provider: llmUsageRecords.provider,
			model: llmUsageRecords.model,
			label: llmUsageRecords.label,
			usageMode: llmUsageRecords.usageMode,
			inputTokens: llmUsageRecords.inputTokens,
			outputTokens: llmUsageRecords.outputTokens,
			cachedInputTokens: llmUsageRecords.cachedInputTokens,
			reasoningOutputTokens: llmUsageRecords.reasoningOutputTokens,
			systemPromptTokens: llmUsageRecords.systemPromptTokens,
			userPromptTokens: llmUsageRecords.userPromptTokens,
			stateCardTokens: llmUsageRecords.stateCardTokens,
			totalTokens: llmUsageRecords.totalTokens,
			durationMs: llmUsageRecords.durationMs,
			createdAt: llmUsageRecords.createdAt,
			repositoryId: tasks.repositoryId,
			taskTitle: tasks.title,
		})
		.from(llmUsageRecords)
		.leftJoin(tasks, eq(llmUsageRecords.taskId, tasks.id))
		.where(conditions.length ? and(...conditions) : undefined)
		.orderBy(desc(llmUsageRecords.createdAt))
		.limit(100);

	const recentCalls = [];
	for (const row of rows) {
		const pricing = await findPricingForUsage({
			provider: row.provider,
			model: row.model,
			createdAt: row.createdAt,
		});
		if (!pricing) continue;
		const cost = calculateUsageCost({
			inputTokens: row.inputTokens,
			outputTokens: row.outputTokens,
			cachedInputTokens: row.cachedInputTokens,
			reasoningOutputTokens: row.reasoningOutputTokens,
			pricing,
		});
		const estimatedCost =
			pricing.currencyCode === "CREDITS"
				? cost.totalCost
				: convertCurrency({
						amount: cost.totalCost,
						from: pricing.currencyCode as NightWorkersCurrency,
						to: input.currency,
						cache: input.fxCache,
					}).amount;
		recentCalls.push({
			id: row.id,
			taskId: row.taskId,
			runId: row.runId,
			repositoryId: row.repositoryId,
			taskTitle: row.taskTitle,
			provider: row.provider,
			model: row.model,
			label: row.label,
			inputTokens: row.inputTokens ?? 0,
			outputTokens: row.outputTokens ?? 0,
			stateCardTokens: row.stateCardTokens ?? 0,
			totalTokens: normalizeTotal(row),
			outputTokensPerSecond: calculateOutputTokensPerSecond(row),
			estimatedCost,
			usageMode: row.usageMode,
			createdAt: row.createdAt.toISOString(),
		});
	}
	return recentCalls
		.sort(
			(a, b) =>
				(b.estimatedCost ?? 0) - (a.estimatedCost ?? 0) ||
				b.totalTokens - a.totalTokens,
		)
		.slice(0, 12);
}

async function countRawUsageRows(input: {
	cutoff: Date | null;
	repositoryId?: string | null;
}) {
	const conditions = [];
	if (input.cutoff)
		conditions.push(gte(llmUsageRecords.createdAt, input.cutoff));
	if (input.repositoryId)
		conditions.push(eq(tasks.repositoryId, input.repositoryId));
	const [row] = await db
		.select({ count: sql<number>`count(*)` })
		.from(llmUsageRecords)
		.leftJoin(tasks, eq(llmUsageRecords.taskId, tasks.id))
		.where(conditions.length ? and(...conditions) : undefined);
	return Number(row?.count ?? 0);
}

function convertCostPart(
	amount: number,
	input: {
		from: string | null;
		to: NightWorkersCurrency;
		cache: ReturnType<typeof readFxRateCache>;
	},
) {
	if (!input.from) return 0;
	if (input.from === "CREDITS") return amount;
	const converted = convertCurrency({
		amount,
		from: input.from as NightWorkersCurrency,
		to: input.to,
		cache: input.cache,
	});
	return converted.amount ?? 0;
}

function getRangeCutoff(range: OverviewRange) {
	const now = Date.now();
	if (range === "24h") return new Date(now - 24 * 60 * 60 * 1000);
	if (range === "7d") return new Date(now - 7 * 24 * 60 * 60 * 1000);
	if (range === "30d") return new Date(now - 30 * 24 * 60 * 60 * 1000);
	return null;
}

function toUtcHour(date: Date) {
	return new Date(Math.floor(date.getTime() / 3_600_000) * 3_600_000);
}

function getBucketKey(date: Date, range: OverviewRange, timezone: string) {
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
		return {
			key,
			startsAt: `${key}-01T00:00:00`,
			endsAt: `${key}-31T23:59:59`,
		};
	}
	return { key: day, startsAt: `${day}T00:00:00`, endsAt: `${day}T23:59:59` };
}

function fillBuckets(
	buckets: Array<ReturnType<typeof emptyBucket>>,
	range: OverviewRange,
	timezone: string,
) {
	if (buckets.length > 0 || range === "all") return buckets;
	const now = Date.now();
	const count = range === "24h" ? 24 : range === "7d" ? 7 : 30;
	const step = range === "24h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
	return Array.from({ length: count }, (_, index) =>
		emptyBucket(
			getBucketKey(new Date(now - (count - 1 - index) * step), range, timezone),
		),
	);
}

function maxIso(current: string | null, next: string) {
	if (current === null) return next;
	return next > current ? next : current;
}
