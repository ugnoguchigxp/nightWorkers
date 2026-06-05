import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { llmModelPricing } from '../../db/schema';

export type LlmPricingInput = {
  provider: string;
  model: string;
  currencyCode?: string;
  inputPer1m?: number | null;
  cachedInputPer1m?: number | null;
  outputPer1m?: number | null;
  reasoningOutputPer1m?: number | null;
  sourceUrl?: string | null;
  sourceLabel?: string | null;
  effectiveFrom?: string | null;
  fetchedAt?: string | null;
  manualOverride?: boolean;
  enabled?: boolean;
};

export type LlmPricingRow = typeof llmModelPricing.$inferSelect;

const CODEX_PRICING_SOURCE_URL = 'https://developers.openai.com/codex/pricing#how-do-credits-work';

const CODEX_PRICING_SEED: LlmPricingInput[] = [
  {
    provider: 'codex',
    model: 'gpt-5.5',
    currencyCode: 'CREDITS',
    inputPer1m: 125,
    cachedInputPer1m: 12.5,
    outputPer1m: 750,
  },
  {
    provider: 'codex',
    model: 'gpt-5.4',
    currencyCode: 'CREDITS',
    inputPer1m: 62.5,
    cachedInputPer1m: 6.25,
    outputPer1m: 375,
  },
  {
    provider: 'codex',
    model: 'gpt-5.4-mini',
    currencyCode: 'CREDITS',
    inputPer1m: 18.75,
    cachedInputPer1m: 1.875,
    outputPer1m: 113,
  },
  {
    provider: 'codex',
    model: 'gpt-5.3-codex',
    currencyCode: 'CREDITS',
    inputPer1m: 43.75,
    cachedInputPer1m: 4.375,
    outputPer1m: 350,
  },
];

export async function listPricingRows() {
  return db.select().from(llmModelPricing).orderBy(llmModelPricing.provider, llmModelPricing.model);
}

export async function upsertPricingRow(input: LlmPricingInput) {
  const now = new Date();
  const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date(0);
  const values = {
    provider: input.provider.trim(),
    model: input.model.trim(),
    currencyCode: input.currencyCode || 'USD',
    inputPer1m: normalizePrice(input.inputPer1m),
    cachedInputPer1m: normalizePrice(input.cachedInputPer1m),
    outputPer1m: normalizePrice(input.outputPer1m),
    reasoningOutputPer1m: normalizePrice(input.reasoningOutputPer1m),
    sourceUrl: input.sourceUrl || null,
    sourceLabel: input.sourceLabel || null,
    effectiveFrom,
    fetchedAt: input.fetchedAt ? new Date(input.fetchedAt) : now,
    manualOverride: input.manualOverride ?? true,
    enabled: input.enabled ?? true,
  };

  const [existing] = await db
    .select()
    .from(llmModelPricing)
    .where(
      and(
        eq(llmModelPricing.provider, values.provider),
        eq(llmModelPricing.model, values.model),
        eq(llmModelPricing.currencyCode, values.currencyCode),
        eq(llmModelPricing.effectiveFrom, values.effectiveFrom)
      )
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(llmModelPricing)
      .set({ ...values, updatedAt: now })
      .where(eq(llmModelPricing.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db.insert(llmModelPricing).values(values).returning();
  return created;
}

export async function seedCodexPricingRows() {
  const seeded = [];
  for (const input of CODEX_PRICING_SEED) {
    const row = await upsertPricingRow({
      ...input,
      sourceUrl: CODEX_PRICING_SOURCE_URL,
      sourceLabel: 'OpenAI Codex pricing',
      effectiveFrom: '1970-01-01T00:00:00.000Z',
      fetchedAt: new Date().toISOString(),
      manualOverride: false,
      enabled: true,
    });
    seeded.push(row);
  }
  return seeded;
}

export async function findPricingForUsage(input: {
  provider: string;
  model: string | null;
  createdAt: Date;
}) {
  if (!input.model) return null;
  const rows = await db
    .select()
    .from(llmModelPricing)
    .where(
      and(
        eq(llmModelPricing.enabled, true),
        eq(llmModelPricing.provider, input.provider),
        eq(llmModelPricing.model, input.model)
      )
    )
    .orderBy(desc(llmModelPricing.manualOverride), desc(llmModelPricing.effectiveFrom));

  return (
    rows.find((row) => row.effectiveFrom.getTime() <= input.createdAt.getTime()) || rows[0] || null
  );
}

export function calculateUsageCost(input: {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningOutputTokens: number | null;
  pricing: LlmPricingRow;
}) {
  const inputTokens = normalizeTokens(input.inputTokens);
  const outputTokens = normalizeTokens(input.outputTokens);
  const cachedInputTokens =
    input.cachedInputTokens === null || input.cachedInputTokens === undefined
      ? null
      : normalizeTokens(input.cachedInputTokens);
  const uncachedInputTokens =
    cachedInputTokens === null ? inputTokens : Math.max(inputTokens - cachedInputTokens, 0);
  const billableCachedInputTokens = cachedInputTokens ?? 0;

  const inputCost =
    input.pricing.inputPer1m === null
      ? null
      : (uncachedInputTokens / 1_000_000) * input.pricing.inputPer1m;
  const cachedInputCost =
    input.pricing.cachedInputPer1m === null
      ? null
      : (billableCachedInputTokens / 1_000_000) * input.pricing.cachedInputPer1m;
  const outputCost =
    input.pricing.outputPer1m === null
      ? null
      : (outputTokens / 1_000_000) * input.pricing.outputPer1m;
  const reasoningCost =
    input.pricing.reasoningOutputPer1m === null
      ? 0
      : (0 * normalizeTokens(input.reasoningOutputTokens)) / 1_000_000;

  const parts = [inputCost, cachedInputCost, outputCost, reasoningCost].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  );
  const incompleteReasons: string[] = [];
  if (input.pricing.inputPer1m === null && uncachedInputTokens > 0) {
    incompleteReasons.push('input_price_missing');
  }
  if (input.pricing.cachedInputPer1m === null && billableCachedInputTokens > 0) {
    incompleteReasons.push('cached_input_price_missing');
  }
  if (input.pricing.outputPer1m === null && outputTokens > 0) {
    incompleteReasons.push('output_price_missing');
  }
  if (cachedInputTokens !== null && cachedInputTokens > inputTokens) {
    incompleteReasons.push('cached_input_exceeds_input');
  }

  return {
    totalCost: parts.reduce((sum, value) => sum + value, 0),
    inputCost,
    cachedInputCost,
    outputCost,
    reasoningCost,
    incompleteReasons,
  };
}

function normalizeTokens(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizePrice(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
