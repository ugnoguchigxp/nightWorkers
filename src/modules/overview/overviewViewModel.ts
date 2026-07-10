import type { OverviewDashboard } from "../../../shared/schemas/overview.schema";
import type { OverviewScope } from "./overviewTypes";

type TokenBreakdown = Pick<
	OverviewDashboard["usage"],
	"inputTokens" | "cachedInputTokens" | "outputTokens"
>;

export type OverviewTokenMetricKey =
	| "totalInput"
	| "input"
	| "cachedInput"
	| "output"
	| "reasoningOutput"
	| "stateCard"
	| "promptInput";

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
	return Math.max(0, usage.inputTokens - usage.cachedInputTokens);
}

export function getSeparatedTokenTotal(usage: TokenBreakdown) {
	return (
		getUncachedInputTokens(usage) + usage.cachedInputTokens + usage.outputTokens
	);
}

export function getCacheRate(usage: TokenBreakdown) {
	return usage.inputTokens > 0
		? (usage.cachedInputTokens / usage.inputTokens) * 100
		: null;
}

export function buildOverviewViewModel(
	dashboard: OverviewDashboard,
): OverviewViewModel {
	const dailyTotals = dashboard.dailyUsage.map(getSeparatedTokenTotal);
	return {
		tokenMetrics: [
			{ key: "totalInput", value: dashboard.usage.inputTokens },
			{ key: "input", value: getUncachedInputTokens(dashboard.usage) },
			{ key: "cachedInput", value: dashboard.usage.cachedInputTokens },
			{ key: "output", value: dashboard.usage.outputTokens },
			{
				key: "reasoningOutput",
				value: dashboard.usage.reasoningOutputTokens,
			},
			{ key: "stateCard", value: dashboard.usage.stateCardTokens },
			{ key: "promptInput", value: dashboard.usage.promptInputTokens },
		],
		cacheRate: getCacheRate(dashboard.usage),
		maxBucketTokens: Math.max(1, ...dailyTotals),
		hasDailyUsageData: dailyTotals.some((total) => total > 0),
	};
}
