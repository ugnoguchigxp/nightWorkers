import { describe, expect, it } from "vitest";
import { overviewDashboardSchema } from "../shared/schemas/overview.schema";
import {
	buildOverviewScope,
	buildOverviewViewModel,
	getCachedInputTokens,
	getCacheRate,
	getUncachedInputTokens,
	getUsageTokenTotal,
} from "../src/modules/overview/overviewViewModel";
import { isOverviewDashboardForScope } from "../src/modules/overview/useOverviewDashboard";

describe("Overview view model", () => {
	it("rejects stale dashboard data after scope or range navigation", () => {
		const dashboard = {
			scope: {
				repositoryId: "2f1ab384-7352-4392-9a60-c7dad4d7a821",
				range: "7d" as const,
				timezone: "Asia/Tokyo",
				currency: "JPY" as const,
			},
		};
		expect(
			isOverviewDashboardForScope(dashboard, {
				projectFilterId: dashboard.scope.repositoryId,
				range: "7d",
			}),
		).toBe(true);
		expect(
			isOverviewDashboardForScope(dashboard, {
				projectFilterId: null,
				range: "7d",
			}),
		).toBe(false);
		expect(
			isOverviewDashboardForScope(dashboard, {
				projectFilterId: dashboard.scope.repositoryId,
				range: "30d",
			}),
		).toBe(false);
	});

	it("builds all and project scopes", () => {
		expect(buildOverviewScope(null)).toEqual({ kind: "all" });
		expect(buildOverviewScope("project-1")).toEqual({
			kind: "project",
			projectId: "project-1",
		});
	});

	it("separates billable token categories without excluding cached reads", () => {
		const usage = {
			inputTokens: 1_200,
			cachedInputTokens: 300,
			outputTokens: 45,
		};
		expect(getUncachedInputTokens(usage)).toBe(900);
		expect(getCachedInputTokens(usage)).toBe(300);
		expect(getUsageTokenTotal(usage)).toBe(1_245);
		expect(getCacheRate(usage)).toBe(25);
	});

	it("never produces negative uncached input or an invalid cache rate", () => {
		expect(
			getUncachedInputTokens({
				inputTokens: 10,
				cachedInputTokens: 20,
				outputTokens: 0,
			}),
		).toBe(0);
		expect(
			getCacheRate({
				inputTokens: 0,
				cachedInputTokens: 0,
				outputTokens: 0,
			}),
		).toBeNull();
		expect(
			getCachedInputTokens({
				inputTokens: 10,
				cachedInputTokens: 20,
				outputTokens: 0,
			}),
		).toBe(10);
		expect(
			getCacheRate({
				inputTokens: 10,
				cachedInputTokens: 20,
				outputTokens: 0,
			}),
		).toBe(100);
		expect(
			getUsageTokenTotal({
				inputTokens: 10,
				cachedInputTokens: 20,
				outputTokens: 3,
			}),
		).toBe(13);
	});

	it("builds common token and daily chart values from one dashboard model", () => {
		const dashboard = overviewDashboardSchema.parse({
			generatedAt: "2026-07-10T00:00:00.000Z",
			scope: {
				repositoryId: null,
				range: "30d",
				timezone: "Asia/Tokyo",
				currency: "JPY",
			},
			settings: {
				language: "ja",
				timezone: "Asia/Tokyo",
				currency: "JPY",
				activeProvider: null,
				activeModel: null,
			},
			runs: { total: 1, completed: 1, failed: 0, active: 0 },
			usage: usage({
				inputTokens: 1_200,
				cachedInputTokens: 300,
				outputTokens: 45,
				reasoningOutputTokens: 12,
				stateCardTokens: 5,
				promptInputTokens: 100,
			}),
			cost: {
				currency: "JPY",
				estimatedTotal: null,
				inputCost: null,
				cachedInputCost: null,
				outputCost: null,
				reasoningOutputCost: null,
				creditTotal: null,
				pricedCallCount: 0,
				unpricedCallCount: 0,
				fxRate: null,
				fxBaseCurrency: null,
				fxUpdatedAt: null,
				pricingUpdatedAt: null,
				incompleteReasons: [],
			},
			dailyUsage: [
				{
					...usage({
						inputTokens: 1_200,
						cachedInputTokens: 300,
						outputTokens: 45,
					}),
					key: "2026-07-10",
					startsAt: "2026-07-10T00:00:00.000Z",
					endsAt: "2026-07-11T00:00:00.000Z",
				},
			],
			modelBreakdown: [],
			recentExpensiveCalls: [],
			projectContext: null,
			warnings: [],
		});

		expect(buildOverviewViewModel(dashboard)).toEqual({
			tokenMetrics: [
				{ key: "input", value: 900 },
				{ key: "cachedInput", value: 300 },
				{ key: "output", value: 45 },
			],
			cacheRate: 25,
			maxBucketTokens: 1_245,
			hasDailyUsageData: true,
		});
	});
});

function usage(overrides: Partial<ReturnType<typeof baseUsage>> = {}) {
	return { ...baseUsage(), ...overrides };
}

function baseUsage() {
	return {
		promptInputTokens: 0,
		inputTokens: 0,
		outputTokens: 0,
		cachedInputTokens: 0,
		reasoningOutputTokens: 0,
		stateCardTokens: 0,
		totalTokens: 0,
		totalDurationMs: 0,
		outputDurationMs: 0,
		measuredDurationCallCount: 0,
		outputTokensPerSecond: null,
		callCount: 0,
		measuredCallCount: 0,
		estimatedCallCount: 0,
		mixedCallCount: 0,
		unavailableCallCount: 0,
	};
}
