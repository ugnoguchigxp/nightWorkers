import { z } from "@hono/zod-openapi";
import { projectMetaSchema } from "./project-detail.schema";
import { projectStackProfileSchema } from "./tech-stack.schema";

const overviewCurrencySchema = z.enum(["JPY", "USD", "EUR"]);

const overviewUsageSummarySchema = z.object({
	promptInputTokens: z.number().int().nonnegative(),
	inputTokens: z.number().int().nonnegative(),
	outputTokens: z.number().int().nonnegative(),
	cachedInputTokens: z.number().int().nonnegative(),
	reasoningOutputTokens: z.number().int().nonnegative(),
	stateCardTokens: z.number().int().nonnegative(),
	totalTokens: z.number().int().nonnegative(),
	totalDurationMs: z.number().int().nonnegative(),
	outputDurationMs: z.number().int().nonnegative(),
	measuredDurationCallCount: z.number().int().nonnegative(),
	outputTokensPerSecond: z.number().nonnegative().nullable(),
	callCount: z.number().int().nonnegative(),
	measuredCallCount: z.number().int().nonnegative(),
	estimatedCallCount: z.number().int().nonnegative(),
	mixedCallCount: z.number().int().nonnegative(),
	unavailableCallCount: z.number().int().nonnegative(),
});

const overviewWarningSchema = z
	.object({
		code: z.string(),
		message: z.string().optional(),
		severity: z.enum(["info", "warning", "error"]).optional(),
	})
	.passthrough();

export const overviewDashboardSchema = z
	.object({
		generatedAt: z.string(),
		scope: z.object({
			repositoryId: z.string().uuid().nullable(),
			range: z.enum(["24h", "7d", "30d", "all"]),
			timezone: z.string(),
			currency: overviewCurrencySchema,
		}),
		settings: z.object({
			language: z.enum(["ja", "en"]),
			timezone: z.string(),
			currency: overviewCurrencySchema,
			activeProvider: z.string().nullable(),
			activeModel: z.string().nullable(),
		}),
		runs: z.object({
			total: z.number().int().nonnegative(),
			completed: z.number().int().nonnegative(),
			failed: z.number().int().nonnegative(),
			active: z.number().int().nonnegative(),
		}),
		usage: overviewUsageSummarySchema,
		cost: z.object({
			currency: overviewCurrencySchema,
			estimatedTotal: z.number().nullable(),
			inputCost: z.number().nullable(),
			cachedInputCost: z.number().nullable(),
			outputCost: z.number().nullable(),
			reasoningOutputCost: z.number().nullable(),
			creditTotal: z.number().nullable(),
			pricedCallCount: z.number().int().nonnegative(),
			unpricedCallCount: z.number().int().nonnegative(),
			fxRate: z.number().nullable(),
			fxBaseCurrency: z.string().nullable(),
			fxUpdatedAt: z.string().nullable(),
			pricingUpdatedAt: z.string().nullable(),
			incompleteReasons: z.array(z.string()),
		}),
		dailyUsage: z.array(
			overviewUsageSummarySchema.extend({
				key: z.string(),
				startsAt: z.string(),
				endsAt: z.string(),
			}),
		),
		modelBreakdown: z.array(
			overviewUsageSummarySchema.extend({
				provider: z.string(),
				model: z.string().nullable(),
				pricingStatus: z.enum(["priced", "manual", "missing", "ambiguous"]),
				estimatedCost: z.number().nullable(),
				estimatedCredits: z.number().nonnegative(),
			}),
		),
		recentExpensiveCalls: z.array(
			z.object({
				id: z.string(),
				taskId: z.string(),
				runId: z.string().nullable(),
				repositoryId: z.string().nullable(),
				taskTitle: z.string().nullable(),
				provider: z.string(),
				model: z.string().nullable(),
				label: z.string(),
				inputTokens: z.number().int().nonnegative(),
				cachedInputTokens: z.number().int().nonnegative(),
				outputTokens: z.number().int().nonnegative(),
				stateCardTokens: z.number().int().nonnegative(),
				totalTokens: z.number().int().nonnegative(),
				outputTokensPerSecond: z.number().nonnegative().nullable(),
				estimatedCost: z.number().nullable(),
				estimatedCredits: z.number().nonnegative().nullable(),
				usageMode: z.string(),
				createdAt: z.string(),
			}),
		),
		projectContext: z
			.object({
				repository: z.object({
					id: z.string().uuid(),
					name: z.string(),
					branch: z.string(),
				}),
				projectMeta: projectMetaSchema.nullable(),
				stackProfile: projectStackProfileSchema,
				latestSnapshot: z.object({
					evaluationScore: z.number().nullable(),
					evaluationAt: z.string().nullable(),
					coverageRunId: z.string().uuid().nullable(),
					coverageAt: z.string().nullable(),
					coverageAxes: z.array(
						z.object({
							key: z.enum(["statements", "branches", "functions", "lines"]),
							actualPercent: z.number().min(0).max(100),
						}),
					),
				}),
			})
			.nullable(),
		warnings: z.array(overviewWarningSchema),
	})
	.openapi("OverviewDashboard");

export type OverviewDashboard = z.infer<typeof overviewDashboardSchema>;
