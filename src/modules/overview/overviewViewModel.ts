import {
	normalizeInputTokenBreakdown,
	normalizeTokenCount,
} from "../../../shared/llm-usage-tokens";
import type { OverviewDashboard } from "../../../shared/schemas/overview.schema";
import type { OverviewScope } from "./overviewTypes";

type TokenBreakdown = Pick<
	OverviewDashboard["usage"],
	"inputTokens" | "cachedInputTokens" | "outputTokens"
>;

export type OverviewTokenMetricKey = "input" | "cachedInput" | "output";

export type OverviewViewModel = {
	tokenMetrics: Array<{ key: OverviewTokenMetricKey; value: number }>;
	cacheRate: number | null;
	maxBucketTokens: number;
	hasDailyUsageData: boolean;
};

export function buildOverviewScope(projectId: string | null): OverviewScope {
	return projectId ? { kind: "project", projectId } : { kind: "all" };
}

export function getUncachedInputTokens(usage: TokenBreakdown) {
	return normalizeInputTokenBreakdown(usage).uncachedInputTokens;
}

export function getCachedInputTokens(usage: TokenBreakdown) {
	return normalizeInputTokenBreakdown(usage).cachedInputTokens;
}

export function getUsageTokenTotal(usage: TokenBreakdown) {
	return (
		normalizeInputTokenBreakdown(usage).inputTokens +
		normalizeTokenCount(usage.outputTokens)
	);
}

export function getCacheRate(usage: TokenBreakdown) {
	const tokenBreakdown = normalizeInputTokenBreakdown(usage);
	return tokenBreakdown.inputTokens > 0
		? (tokenBreakdown.cachedInputTokens / tokenBreakdown.inputTokens) * 100
		: null;
}

export function buildOverviewViewModel(
	dashboard: OverviewDashboard,
): OverviewViewModel {
	const dailyTotals = dashboard.dailyUsage.map(getUsageTokenTotal);
	return {
		tokenMetrics: [
			{ key: "input", value: getUncachedInputTokens(dashboard.usage) },
			{
				key: "cachedInput",
				value: getCachedInputTokens(dashboard.usage),
			},
			{
				key: "output",
				value: normalizeTokenCount(dashboard.usage.outputTokens),
			},
		],
		cacheRate: getCacheRate(dashboard.usage),
		maxBucketTokens: Math.max(1, ...dailyTotals),
		hasDailyUsageData: dailyTotals.some((total) => total > 0),
	};
}
