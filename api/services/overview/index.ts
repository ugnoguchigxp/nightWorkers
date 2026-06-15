import { and, eq, gte } from 'drizzle-orm';
import { db } from '../../db/client';
import { llmUsageRecords, repositories, tasks } from '../../db/schema';
import { calculateUsageCost, findPricingForUsage } from '../pricing';
import {
  convertCurrency,
  type NightWorkersCurrency,
  readFxRateCache,
  readGeneralSettings,
} from '../settings/general-settings';

export type OverviewRange = '24h' | '7d' | '30d' | 'all';

export type OverviewDashboard = Awaited<ReturnType<typeof buildOverviewDashboard>>;

type UsageAggregateRow = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
  reasoningOutputTokens?: number | null;
  systemPromptTokens?: number | null;
  userPromptTokens?: number | null;
  stateCardTokens?: number | null;
  totalTokens?: number | null;
  usageMode?: string | null;
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
  const range = input.range || '30d';
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
      const error = new Error('Repository not found');
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }
  }

  const conditions = [];
  if (cutoff) conditions.push(gte(llmUsageRecords.createdAt, cutoff));
  if (input.repositoryId) conditions.push(eq(tasks.repositoryId, input.repositoryId));

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
      createdAt: llmUsageRecords.createdAt,
      repositoryId: tasks.repositoryId,
      taskTitle: tasks.title,
    })
    .from(llmUsageRecords)
    .leftJoin(tasks, eq(llmUsageRecords.taskId, tasks.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(llmUsageRecords.createdAt);

  const usage = emptyUsageSummary();
  const buckets = new Map<string, ReturnType<typeof emptyBucket>>();
  const modelMap = new Map<string, ReturnType<typeof emptyModelUsage>>();
  const warningsMap = new Map<string, OverviewWarning>();
  const fxCache = readFxRateCache();
  const recentCalls = [];
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

  for (const row of rows) {
    addUsage(usage, row);
    const bucketKey = getBucketKey(row.createdAt, range, timezone);
    const bucket = buckets.get(bucketKey.key) || emptyBucket(bucketKey);
    addUsage(bucket, row);
    buckets.set(bucketKey.key, bucket);

    const modelKey = `${row.provider}:${row.model || 'unknown'}`;
    const modelUsage = modelMap.get(modelKey) || emptyModelUsage(row.provider, row.model);
    addUsage(modelUsage, row);
    modelMap.set(modelKey, modelUsage);

    const pricing = await findPricingForUsage({
      provider: row.provider,
      model: row.model,
      createdAt: row.createdAt,
    });
    if (!pricing) {
      unpricedCallCount += 1;
      modelUsage.pricingStatus = modelUsage.pricingStatus === 'priced' ? 'manual' : 'missing';
      warningsMap.set(`pricing:${modelKey}`, {
        code: 'pricing_missing',
        provider: row.provider,
        model: row.model,
        callCount: (warningsMap.get(`pricing:${modelKey}`)?.callCount || 0) + 1,
      });
      continue;
    }

    pricedCallCount += 1;
    modelUsage.pricingStatus = pricing.manualOverride ? 'manual' : 'priced';
    if (pricing.fetchedAt) {
      const fetched = pricing.fetchedAt.toISOString();
      pricingUpdatedAt = maxIso(pricingUpdatedAt, fetched);
    }
    const cost = calculateUsageCost({
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cachedInputTokens: row.cachedInputTokens,
      reasoningOutputTokens: row.reasoningOutputTokens,
      pricing,
    });
    for (const reason of cost.incompleteReasons) {
      warningsMap.set(`usage_token_anomaly:${reason}`, {
        code: 'usage_token_anomaly',
        field: reason,
        callCount: (warningsMap.get(`usage_token_anomaly:${reason}`)?.callCount || 0) + 1,
      });
    }
    let convertedAmount: number | null = null;
    if (pricing.currencyCode === 'CREDITS') {
      creditTotal += cost.totalCost;
      convertedAmount = cost.totalCost;
    } else {
      const converted = convertCurrency({
        amount: cost.totalCost,
        from: pricing.currencyCode as NightWorkersCurrency,
        to: currency,
        cache: fxCache,
      });
      if (converted.amount === null) {
        warningsMap.set(`fx:${pricing.currencyCode}:${currency}`, {
          code: 'fx_unavailable',
          currency,
          baseCurrency: pricing.currencyCode,
        });
      } else {
        convertedAmount = converted.amount;
        fxRate = converted.rate;
        fxBaseCurrency = pricing.currencyCode;
        estimatedTotal += converted.amount;
      }
    }
    if (convertedAmount !== null) modelUsage.estimatedCost += convertedAmount;
    inputCost += cost.inputCost ?? 0;
    cachedInputCost += cost.cachedInputCost ?? 0;
    outputCost += cost.outputCost ?? 0;
    reasoningOutputCost += cost.reasoningCost ?? 0;
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
      estimatedCost: convertedAmount,
      usageMode: row.usageMode,
      createdAt: row.createdAt.toISOString(),
    });
  }

  if (usage.estimatedCallCount > 0) {
    warningsMap.set('usage_estimated', {
      code: 'usage_estimated',
      estimatedCallCount: usage.estimatedCallCount,
    });
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
      incompleteReasons: Array.from(warningsMap.values()).map((warning) => warning.code),
    },
    dailyUsage: fillBuckets(Array.from(buckets.values()), range, timezone),
    modelBreakdown: Array.from(modelMap.values()).sort((a, b) => b.totalTokens - a.totalTokens),
    recentExpensiveCalls: recentCalls
      .sort(
        (a, b) => (b.estimatedCost ?? 0) - (a.estimatedCost ?? 0) || b.totalTokens - a.totalTokens
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
    pricingStatus: 'missing' as 'priced' | 'manual' | 'missing' | 'ambiguous',
    estimatedCost: 0,
    ...emptyUsageSummary(),
  };
}

function addUsage(target: ReturnType<typeof emptyUsageSummary>, row: UsageAggregateRow) {
  target.inputTokens += row.inputTokens ?? 0;
  target.promptInputTokens +=
    (row.systemPromptTokens ?? 0) + (row.userPromptTokens ?? 0) + (row.stateCardTokens ?? 0);
  target.outputTokens += row.outputTokens ?? 0;
  target.cachedInputTokens += row.cachedInputTokens ?? 0;
  target.reasoningOutputTokens += row.reasoningOutputTokens ?? 0;
  target.stateCardTokens += row.stateCardTokens ?? 0;
  target.totalTokens += normalizeTotal(row);
  target.callCount += 1;
  if (row.usageMode === 'measured') target.measuredCallCount += 1;
  else if (row.usageMode === 'estimated') target.estimatedCallCount += 1;
  else if (row.usageMode === 'mixed') target.mixedCallCount += 1;
  else target.unavailableCallCount += 1;
}

function normalizeTotal(row: UsageAggregateRow) {
  return row.totalTokens ?? (row.inputTokens ?? 0) + (row.outputTokens ?? 0);
}

function getRangeCutoff(range: OverviewRange) {
  const now = Date.now();
  if (range === '24h') return new Date(now - 24 * 60 * 60 * 1000);
  if (range === '7d') return new Date(now - 7 * 24 * 60 * 60 * 1000);
  if (range === '30d') return new Date(now - 30 * 24 * 60 * 60 * 1000);
  return null;
}

function getBucketKey(date: Date, range: OverviewRange, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: range === '24h' ? '2-digit' : undefined,
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  if (range === '24h') {
    const key = `${day}T${parts.hour || '00'}`;
    return { key, startsAt: `${key}:00:00`, endsAt: `${key}:59:59` };
  }
  if (range === 'all') {
    const key = `${parts.year}-${parts.month}`;
    return { key, startsAt: `${key}-01T00:00:00`, endsAt: `${key}-31T23:59:59` };
  }
  return { key: day, startsAt: `${day}T00:00:00`, endsAt: `${day}T23:59:59` };
}

function fillBuckets(
  buckets: Array<ReturnType<typeof emptyBucket>>,
  range: OverviewRange,
  timezone: string
) {
  if (buckets.length > 0 || range === 'all') return buckets;
  const now = Date.now();
  const count = range === '24h' ? 24 : range === '7d' ? 7 : 30;
  const step = range === '24h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return Array.from({ length: count }, (_, index) =>
    emptyBucket(getBucketKey(new Date(now - (count - 1 - index) * step), range, timezone))
  );
}

function maxIso(current: string | null, next: string) {
  if (current === null) return next;
  return next > current ? next : current;
}
