import { and, eq, gte } from "drizzle-orm";
import { db } from "../../db/client";
import {
	llmUsageSummaryBuckets,
	llmUsageSummaryWarnings,
} from "../../db/schema";
import { NotFoundError } from "../../lib/errors";
import { getCurrentSettings } from "../../routes/settings";
import {
	convertCurrency,
	type NightWorkersCurrency,
	readFxRateCache,
	readGeneralSettings,
} from "../../services/settings/general-settings";
import {
	countRawOverviewUsageRows,
	getOverviewRunSummary,
	overviewRepositoryExists,
} from "./overview.repository";
import { buildProjectOverviewContext } from "./overview-project-context.service";
import { buildRecentExpensiveCalls } from "./overview-recent-calls.service";
import {
	addAggregateUsage,
	emptyBucket,
	emptyModelUsage,
	emptyUsageSummary,
	fillBuckets,
	getBucketKey,
	getRangeCutoff,
	type ModelPricingStatus,
	maxIso,
	mergePricingStatus,
	normalizePricingStatus,
	type OverviewRange,
	type OverviewWarning,
	toUtcHour,
} from "./overview-usage-aggregation";

export async function getOverviewDashboard(input: {
	range?: OverviewRange;
	repositoryId?: string | null;
	timezone?: string | null;
	currency?: NightWorkersCurrency | null;
}) {
	const settings = getCurrentSettings();
	const activeProvider = settings.ACTIVE_LLM_PROVIDER || null;
	const activeModel =
		activeProvider === "openai"
			? settings.OPENAI_MODEL
			: activeProvider === "azure"
				? settings.AZURE_OPENAI_DEPLOYMENT_NAME
				: activeProvider === "bedrock"
					? settings.AWS_BEDROCK_MODEL
					: activeProvider === "codex"
						? settings.CODEX_MODEL
						: null;
	return buildOverviewDashboard({
		...input,
		activeProvider,
		activeModel: activeModel || null,
	});
}

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
		if (!(await overviewRepositoryExists(input.repositoryId))) {
			throw new NotFoundError("Repository not found");
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

	const [summaryRows, summaryWarningRows] = await Promise.all([
		db
			.select()
			.from(llmUsageSummaryBuckets)
			.where(summaryConditions.length ? and(...summaryConditions) : undefined)
			.orderBy(llmUsageSummaryBuckets.bucketHourUtc),
		db
			.select()
			.from(llmUsageSummaryWarnings)
			.where(warningConditions.length ? and(...warningConditions) : undefined),
	]);

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
	let currencyCostCallCount = 0;
	let unpricedCallCount = 0;
	let pricingUpdatedAt: string | null = null;
	const fxRatesByBaseCurrency = new Map<string, number | null>();

	for (const row of summaryRows) {
		addAggregateUsage(usage, row);
		const bucketKey = getBucketKey(row.bucketHourUtc, range, timezone);
		const bucket = buckets.get(bucketKey.key) || emptyBucket(bucketKey);
		addAggregateUsage(bucket, row);
		buckets.set(bucketKey.key, bucket);

		const modelKey = JSON.stringify([row.provider, row.model]);
		const rowPricingStatus: ModelPricingStatus = normalizePricingStatus(
			row.pricingStatus,
		);
		const modelUsage =
			modelMap.get(modelKey) ||
			emptyModelUsage(row.provider, row.model, rowPricingStatus);
		addAggregateUsage(modelUsage, row);
		modelMap.set(modelKey, modelUsage);
		modelUsage.pricingStatus = mergePricingStatus(
			modelUsage.pricingStatus,
			rowPricingStatus,
		);

		pricedCallCount += row.pricedCallCount;
		unpricedCallCount += row.unpricedCallCount;
		if (row.pricingUpdatedAt) {
			pricingUpdatedAt = maxIso(
				pricingUpdatedAt,
				row.pricingUpdatedAt.toISOString(),
			);
		}
		if (rowPricingStatus === "missing" || rowPricingStatus === "ambiguous") {
			continue;
		}
		if (!row.pricingCurrencyCode) {
			continue;
		}

		if (row.pricingCurrencyCode === "CREDITS") {
			creditTotal += row.estimatedCost;
			modelUsage.estimatedCredits += row.estimatedCost;
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
				currencyCostCallCount += row.pricedCallCount;
				fxRatesByBaseCurrency.set(row.pricingCurrencyCode, converted.rate);
				estimatedTotal += converted.amount;
				modelUsage.estimatedCost =
					(modelUsage.estimatedCost ?? 0) + converted.amount;
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
	const singleFxEntry =
		fxRatesByBaseCurrency.size === 1
			? Array.from(fxRatesByBaseCurrency.entries())[0]
			: null;
	if (fxRatesByBaseCurrency.size > 1) {
		warningsMap.set("fx_mixed_base_currencies", {
			code: "fx_mixed_base_currencies",
			baseCurrencies: Array.from(fxRatesByBaseCurrency.keys()).sort(),
		});
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
			? await countRawOverviewUsageRows({
					cutoff,
					repositoryId: input.repositoryId,
				})
			: 0;
	if (rawUsageRowCount > 0) {
		warningsMap.set("summary_backfill_required", {
			code: "summary_backfill_required",
			callCount: rawUsageRowCount,
		});
	}

	const [recentCalls, runs, projectContext] = await Promise.all([
		buildRecentExpensiveCalls({
			cutoff,
			repositoryId: input.repositoryId,
			currency,
			fxCache,
		}),
		getOverviewRunSummary({
			cutoff,
			repositoryId: input.repositoryId,
		}),
		input.repositoryId
			? buildProjectOverviewContext(input.repositoryId)
			: Promise.resolve(null),
	]);
	if (input.repositoryId && !projectContext) {
		throw new NotFoundError("Repository not found");
	}

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
		runs,
		usage,
		cost: {
			currency,
			estimatedTotal: currencyCostCallCount > 0 ? estimatedTotal : null,
			inputCost: currencyCostCallCount > 0 ? inputCost : null,
			cachedInputCost: currencyCostCallCount > 0 ? cachedInputCost : null,
			outputCost: currencyCostCallCount > 0 ? outputCost : null,
			reasoningOutputCost:
				currencyCostCallCount > 0 ? reasoningOutputCost : null,
			creditTotal: creditTotal > 0 ? creditTotal : null,
			pricedCallCount,
			unpricedCallCount,
			fxRate: singleFxEntry?.[1] ?? null,
			fxBaseCurrency: singleFxEntry?.[0] ?? null,
			fxUpdatedAt: fxCache?.fetchedAt ?? null,
			pricingUpdatedAt,
			incompleteReasons: Array.from(
				new Set(
					Array.from(warningsMap.values()).map((warning) => warning.code),
				),
			),
		},
		dailyUsage: fillBuckets(Array.from(buckets.values()), range, timezone),
		modelBreakdown: Array.from(modelMap.values()).sort(
			(a, b) => b.totalTokens - a.totalTokens,
		),
		recentExpensiveCalls: recentCalls,
		projectContext,
		warnings: Array.from(warningsMap.values()),
	};
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
