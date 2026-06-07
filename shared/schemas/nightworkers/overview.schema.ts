import { z } from '@hono/zod-openapi';

const overviewUsageSummarySchema = z.object({
  promptInputTokens: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  reasoningOutputTokens: z.number().int().nonnegative(),
  stateCardTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  callCount: z.number().int().nonnegative(),
  measuredCallCount: z.number().int().nonnegative(),
  estimatedCallCount: z.number().int().nonnegative(),
  mixedCallCount: z.number().int().nonnegative(),
  unavailableCallCount: z.number().int().nonnegative(),
});

export const overviewDashboardSchema = z
  .object({
    generatedAt: z.string(),
    scope: z.object({
      repositoryId: z.string().uuid().nullable(),
      range: z.enum(['24h', '7d', '30d', 'all']),
      timezone: z.string(),
      currency: z.string(),
    }),
    settings: z.object({
      language: z.enum(['ja', 'en']),
      timezone: z.string(),
      currency: z.string(),
      activeProvider: z.string().nullable(),
      activeModel: z.string().nullable(),
    }),
    usage: overviewUsageSummarySchema,
    cost: z.object({
      currency: z.string(),
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
      })
    ),
    modelBreakdown: z.array(
      overviewUsageSummarySchema.extend({
        provider: z.string(),
        model: z.string().nullable(),
        pricingStatus: z.enum(['priced', 'manual', 'missing', 'ambiguous']),
        estimatedCost: z.number(),
      })
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
        outputTokens: z.number().int().nonnegative(),
        stateCardTokens: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative(),
        estimatedCost: z.number().nullable(),
        usageMode: z.string(),
        createdAt: z.string(),
      })
    ),
    warnings: z.array(z.any()),
  })
  .openapi('OverviewDashboard');
