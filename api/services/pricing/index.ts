import { and, asc, desc, eq, like } from "drizzle-orm";
import { db } from "../../db/client";
import { llmModelPricing } from "../../db/schema";
import {
	currentVisiblePricingRows,
	type LlmPricingInput,
	mapLiteLlmPriceRow,
	PUBLIC_PRICING_COVERED_PROVIDERS,
	parseLiteLlmRows,
	pricingModelLookupKeys,
	pricingProviderCandidates,
	setsOverlap,
	startOfUtcDay,
} from "../../modules/settings";

export type { LlmPricingInput } from "../../modules/settings";

export type LlmPricingRow = typeof llmModelPricing.$inferSelect;

const CODEX_PRICING_SOURCE_URL =
	"https://developers.openai.com/codex/pricing#how-do-credits-work";
const LITELLM_MODEL_PRICES_URL =
	"https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

type PricingFetch = (url: string) => Promise<{
	ok: boolean;
	status: number;
	statusText: string;
	json: () => Promise<unknown>;
}>;

export type PublicPricingImportResult = {
	sourceUrl: string;
	fetchedAt: string;
	imported: number;
	skipped: number;
	providers: string[];
	rows: LlmPricingRow[];
};

const CODEX_PRICING_SEED: LlmPricingInput[] = [
	{
		provider: "codex",
		model: "gpt-5.5",
		currencyCode: "CREDITS",
		inputPer1m: 125,
		cachedInputPer1m: 12.5,
		outputPer1m: 750,
	},
	{
		provider: "codex",
		model: "gpt-5.4",
		currencyCode: "CREDITS",
		inputPer1m: 62.5,
		cachedInputPer1m: 6.25,
		outputPer1m: 375,
	},
	{
		provider: "codex",
		model: "gpt-5.4-mini",
		currencyCode: "CREDITS",
		inputPer1m: 18.75,
		cachedInputPer1m: 1.875,
		outputPer1m: 113,
	},
];

export async function listPricingRows() {
	const rows = await db
		.select()
		.from(llmModelPricing)
		.orderBy(llmModelPricing.provider, llmModelPricing.model);
	return currentVisiblePricingRows(rows);
}

export type PricingPageInput = {
	provider?: string;
	model?: string;
	limit?: number;
	offset?: number;
};

export type PricingPage = {
	rows: LlmPricingRow[];
	totalCount: number;
	nextCursor: string | null;
};

export async function listPricingRowsPage(
	input: PricingPageInput = {},
): Promise<PricingPage> {
	const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 100);
	const offset = Math.max(Math.trunc(input.offset ?? 0), 0);
	const provider = input.provider?.trim();
	const model = input.model?.trim().toLowerCase();
	const filters = [eq(llmModelPricing.enabled, true)];
	if (provider) filters.push(eq(llmModelPricing.provider, provider));
	if (model) filters.push(like(llmModelPricing.model, `%${model}%`));
	const where = and(...filters);

	const matchingRows = currentVisiblePricingRows(
		await db
			.select()
			.from(llmModelPricing)
			.where(where)
			.orderBy(
				asc(llmModelPricing.provider),
				asc(llmModelPricing.model),
				asc(llmModelPricing.id),
			),
	);
	const totalCount = matchingRows.length;
	const rows = matchingRows.slice(offset, offset + limit);
	const nextOffset = offset + rows.length;
	return {
		rows,
		totalCount,
		nextCursor: nextOffset < totalCount ? String(nextOffset) : null,
	};
}

export async function upsertPricingRow(input: LlmPricingInput) {
	const now = new Date();
	const effectiveFrom = input.effectiveFrom
		? new Date(input.effectiveFrom)
		: new Date(0);
	const values = {
		provider: input.provider.trim(),
		model: input.model.trim(),
		currencyCode: input.currencyCode || "USD",
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
				eq(llmModelPricing.effectiveFrom, values.effectiveFrom),
			),
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
			sourceLabel: "OpenAI Codex pricing",
			effectiveFrom: "1970-01-01T00:00:00.000Z",
			fetchedAt: new Date().toISOString(),
			manualOverride: false,
			enabled: true,
		});
		seeded.push(row);
	}
	return seeded;
}

export async function importPublicPricingRows(
	input: { fetchImpl?: PricingFetch; sourceUrl?: string } = {},
): Promise<PublicPricingImportResult> {
	const sourceUrl = input.sourceUrl || LITELLM_MODEL_PRICES_URL;
	const fetchImpl = input.fetchImpl || globalThis.fetch;
	if (!fetchImpl) throw new Error("fetch is not available in this runtime");

	const response = await fetchImpl(sourceUrl);
	if (!response.ok) {
		throw new Error(
			`LLM pricing fetch failed: ${response.status} ${response.statusText}`,
		);
	}

	const payload = await response.json();
	const rawRows = parseLiteLlmRows(payload);
	const fetchedAt = new Date().toISOString();
	const effectiveFrom = startOfUtcDay(fetchedAt).toISOString();
	const providers = new Set<string>();
	const prepared = new Map<string, LlmPricingInput>();
	let skipped = 0;

	for (const rawRow of rawRows) {
		const mappedRows = mapLiteLlmPriceRow(rawRow, {
			sourceUrl,
			fetchedAt,
			effectiveFrom,
		});
		if (!mappedRows.length) {
			skipped += 1;
			continue;
		}
		for (const mappedRow of mappedRows) {
			if (!PUBLIC_PRICING_COVERED_PROVIDERS.has(mappedRow.provider)) {
				skipped += 1;
				continue;
			}
			providers.add(mappedRow.provider);
			prepared.set(`${mappedRow.provider}\u0000${mappedRow.model}`, mappedRow);
		}
	}

	const rows: LlmPricingRow[] = [];
	for (const row of prepared.values()) {
		rows.push(await upsertPricingRow(row));
	}

	return {
		sourceUrl,
		fetchedAt,
		imported: rows.length,
		skipped,
		providers: [...providers].sort(),
		rows,
	};
}

export async function findPricingForUsage(input: {
	provider: string;
	model: string | null;
	createdAt: Date;
}) {
	if (!input.model) return null;
	for (const provider of pricingProviderCandidates(
		input.provider,
		input.model,
	)) {
		const exactRow = await findBestPricingRow({
			provider,
			model: input.model,
			createdAt: input.createdAt,
		});
		if (exactRow) return exactRow;
	}

	const modelLookupKeys = pricingModelLookupKeys(input.model);
	for (const provider of pricingProviderCandidates(
		input.provider,
		input.model,
	)) {
		const providerRows = await db
			.select()
			.from(llmModelPricing)
			.where(
				and(
					eq(llmModelPricing.enabled, true),
					eq(llmModelPricing.provider, provider),
				),
			)
			.orderBy(
				desc(llmModelPricing.manualOverride),
				desc(llmModelPricing.effectiveFrom),
			);
		const fuzzyRows = providerRows.filter((row) =>
			setsOverlap(pricingModelLookupKeys(row.model), modelLookupKeys),
		);
		const fuzzyRow = chooseBestPricingRow(fuzzyRows, input.createdAt);
		if (fuzzyRow) return fuzzyRow;
	}

	return null;
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
		cachedInputTokens === null
			? inputTokens
			: Math.max(inputTokens - cachedInputTokens, 0);
	const billableCachedInputTokens = cachedInputTokens ?? 0;

	const inputCost =
		input.pricing.inputPer1m === null
			? null
			: (uncachedInputTokens / 1_000_000) * input.pricing.inputPer1m;
	const cachedInputCost =
		input.pricing.cachedInputPer1m === null
			? null
			: (billableCachedInputTokens / 1_000_000) *
				input.pricing.cachedInputPer1m;
	const outputCost =
		input.pricing.outputPer1m === null
			? null
			: (outputTokens / 1_000_000) * input.pricing.outputPer1m;
	const reasoningCost =
		input.pricing.reasoningOutputPer1m === null
			? 0
			: (normalizeTokens(input.reasoningOutputTokens) / 1_000_000) *
				input.pricing.reasoningOutputPer1m;

	const parts = [inputCost, cachedInputCost, outputCost, reasoningCost].filter(
		(value): value is number =>
			typeof value === "number" && Number.isFinite(value),
	);
	const incompleteReasons: string[] = [];
	if (input.pricing.inputPer1m === null && uncachedInputTokens > 0) {
		incompleteReasons.push("input_price_missing");
	}
	if (
		input.pricing.cachedInputPer1m === null &&
		billableCachedInputTokens > 0
	) {
		incompleteReasons.push("cached_input_price_missing");
	}
	if (input.pricing.outputPer1m === null && outputTokens > 0) {
		incompleteReasons.push("output_price_missing");
	}
	if (cachedInputTokens !== null && cachedInputTokens > inputTokens) {
		incompleteReasons.push("cached_input_exceeds_input");
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
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(0, Math.floor(value))
		: 0;
}

function normalizePrice(value: number | null | undefined) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: null;
}

async function findBestPricingRow(input: {
	provider: string;
	model: string;
	createdAt: Date;
}) {
	const rows = await db
		.select()
		.from(llmModelPricing)
		.where(
			and(
				eq(llmModelPricing.enabled, true),
				eq(llmModelPricing.provider, input.provider),
				eq(llmModelPricing.model, input.model),
			),
		)
		.orderBy(
			desc(llmModelPricing.manualOverride),
			desc(llmModelPricing.effectiveFrom),
		);

	return chooseBestPricingRow(rows, input.createdAt);
}

function chooseBestPricingRow(rows: LlmPricingRow[], createdAt: Date) {
	return (
		rows.find(
			(candidate) => candidate.effectiveFrom.getTime() <= createdAt.getTime(),
		) ||
		rows[0] ||
		null
	);
}
