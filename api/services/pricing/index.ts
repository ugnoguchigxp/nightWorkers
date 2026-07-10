import { and, asc, desc, eq, like } from "drizzle-orm";
import { db } from "../../db/client";
import { llmModelPricing } from "../../db/schema";

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

const CODEX_PRICING_SOURCE_URL =
	"https://developers.openai.com/codex/pricing#how-do-credits-work";
const LITELLM_MODEL_PRICES_URL =
	"https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const LITELLM_PRICING_SOURCE_LABEL =
	"LiteLLM model_prices_and_context_window.json";
const PUBLIC_PRICING_COVERED_PROVIDERS = new Set([
	"openai",
	"anthropic",
	"google",
	"deepseek",
	"qwen",
]);
const QWEN_CODING_MODELS = new Set([
	"qwen3-coder-next",
	"qwen3.6-plus",
	"qwen3.5-plus",
]);
const DEEPSEEK_CODING_MODELS = new Set([
	"deepseek-v4-pro",
	"deepseek-v4-flash",
	"deepseek-v3.2",
]);

type PricingFetch = (url: string) => Promise<{
	ok: boolean;
	status: number;
	statusText: string;
	json: () => Promise<unknown>;
}>;

type LiteLlmPriceRow = {
	litellm_provider?: unknown;
	input_cost_per_token?: unknown;
	output_cost_per_token?: unknown;
	cache_read_input_token_cost?: unknown;
};

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

function parseLiteLlmRows(
	payload: unknown,
): Array<{ model: string; row: LiteLlmPriceRow }> {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new Error("LiteLLM pricing payload was not a model price object");
	}
	return Object.entries(payload as Record<string, unknown>).map(
		([model, row]) => ({
			model,
			row: row && typeof row === "object" ? (row as LiteLlmPriceRow) : {},
		}),
	);
}

function mapLiteLlmPriceRow(
	input: { model: string; row: LiteLlmPriceRow },
	context: { sourceUrl: string; fetchedAt: string; effectiveFrom: string },
): LlmPricingInput[] {
	const model = input.model.trim();
	if (!model) return [];

	const sourceProvider =
		typeof input.row.litellm_provider === "string"
			? input.row.litellm_provider.trim()
			: "";
	const provider = normalizeLiteLlmProvider(sourceProvider, model);
	if (!provider) return [];

	const inputPer1m = perMillionPrice(input.row.input_cost_per_token);
	const outputPer1m = perMillionPrice(input.row.output_cost_per_token);
	const cachedInputPer1m = perMillionPrice(
		input.row.cache_read_input_token_cost,
	);
	if (inputPer1m === null && outputPer1m === null && cachedInputPer1m === null)
		return [];

	const sourceLabel = sourceProvider
		? `${LITELLM_PRICING_SOURCE_LABEL} (${sourceProvider})`
		: LITELLM_PRICING_SOURCE_LABEL;
	const canonicalModel = canonicalPublicPricingModel(provider, model);
	if (!canonicalModel) return [];

	return [
		{
			provider,
			model: canonicalModel,
			currencyCode: "USD",
			inputPer1m,
			cachedInputPer1m,
			outputPer1m,
			reasoningOutputPer1m: null,
			sourceUrl: context.sourceUrl,
			sourceLabel,
			effectiveFrom: context.effectiveFrom,
			fetchedAt: context.fetchedAt,
			manualOverride: false,
			enabled: true,
		},
	];
}

function isVisiblePricingRow(row: LlmPricingRow) {
	if (row.manualOverride) return true;
	const provider = row.provider === "codex" ? "openai" : row.provider;
	const canonicalModel = canonicalPublicPricingModel(provider, row.model);
	return canonicalModel === row.model;
}

function currentVisiblePricingRows(rows: LlmPricingRow[]) {
	const currentRows = new Map<string, LlmPricingRow>();
	for (const row of rows) {
		if (!isVisiblePricingRow(row)) continue;
		const key = `${row.provider}\u0000${row.model}\u0000${row.currencyCode}`;
		const existing = currentRows.get(key);
		if (!existing || isNewerPricingRow(row, existing))
			currentRows.set(key, row);
	}
	return [...currentRows.values()];
}

function isNewerPricingRow(candidate: LlmPricingRow, existing: LlmPricingRow) {
	if (candidate.manualOverride !== existing.manualOverride) {
		return candidate.manualOverride;
	}
	if (candidate.effectiveFrom.getTime() !== existing.effectiveFrom.getTime()) {
		return candidate.effectiveFrom.getTime() > existing.effectiveFrom.getTime();
	}
	return (
		(candidate.fetchedAt?.getTime() ?? 0) > (existing.fetchedAt?.getTime() ?? 0)
	);
}

function canonicalPublicPricingModel(provider: string, model: string) {
	const candidates = [...pricingModelAliases(model)]
		.flatMap(publicPricingModelCandidates)
		.map((candidate) => candidate.toLowerCase());
	for (const candidate of candidates) {
		if (provider === "openai") {
			const match = candidate.match(
				/^(gpt-(\d+)\.(\d+)(?:-(?:pro|mini|nano|sol|terra|luna))?)(?:-\d{4}-\d{2}-\d{2})?$/,
			);
			if (
				match &&
				(Number(match[2]) > 5 ||
					(Number(match[2]) === 5 && Number(match[3]) >= 4))
			) {
				return match[1];
			}
		}
		if (provider === "anthropic") {
			const match = candidate.match(
				/^(claude-(?:fable|sonnet|opus|haiku)-(\d+)(?:-(\d{1,2}))?)(?:-\d{8})?(?:-v\d(?::\d)?)?$/,
			);
			if (
				match &&
				(Number(match[2]) > 4 ||
					(Number(match[2]) === 4 && Number(match[3] ?? 0) >= 5))
			) {
				return match[1];
			}
		}
		if (provider === "google") {
			const match = candidate.match(
				/^(gemini-(\d+)\.(\d+)-(?:pro|flash-lite|flash))(?:-(preview|latest))?$/,
			);
			if (
				match &&
				(Number(match[2]) > 3 ||
					(Number(match[2]) === 3 && Number(match[3]) >= 1))
			) {
				if (match[4] === "preview" && match[1].endsWith("-pro")) {
					return `${match[1]}-preview`;
				}
				if (!match[4]) return match[1];
			}
		}
		if (provider === "qwen" && QWEN_CODING_MODELS.has(candidate)) {
			return candidate;
		}
		if (provider === "deepseek" && DEEPSEEK_CODING_MODELS.has(candidate)) {
			return candidate;
		}
	}
	return null;
}

function publicPricingModelCandidates(model: string) {
	const normalized = model.trim().toLowerCase();
	const candidates = new Set([normalized]);
	for (const marker of ["claude-", "gemini-", "gpt-", "deepseek-", "qwen"]) {
		const markerIndex = normalized.lastIndexOf(marker);
		if (markerIndex >= 0) candidates.add(normalized.slice(markerIndex));
	}
	if (normalized.startsWith("deepseek.")) {
		candidates.add(`deepseek-${normalized.slice("deepseek.".length)}`);
	}
	if (normalized.startsWith("qwen.")) {
		candidates.add(normalized.slice("qwen.".length));
	}
	return [...candidates];
}

function normalizeLiteLlmProvider(provider: string, model: string) {
	const normalizedProvider = provider.trim().toLowerCase();
	const normalizedModel = model.trim().toLowerCase();

	if (isQwenModel(normalizedModel)) return "qwen";
	if (isZaiModel(normalizedModel)) return "z-ai";
	if (normalizedModel.includes("grok") || normalizedProvider === "xai")
		return "xai";
	if (normalizedModel.includes("deepseek") || normalizedProvider === "deepseek")
		return "deepseek";
	if (normalizedModel.includes("claude") || normalizedProvider === "anthropic")
		return "anthropic";
	if (
		normalizedModel.includes("gemini") ||
		normalizedProvider === "gemini" ||
		normalizedProvider === "vertex_ai" ||
		normalizedProvider === "vertex_ai-language-models"
	) {
		return "google";
	}
	if (
		normalizedModel.includes("gpt-") ||
		normalizedModel.includes("o1") ||
		normalizedModel.includes("o3") ||
		normalizedModel.includes("o4") ||
		normalizedProvider === "openai" ||
		normalizedProvider === "azure" ||
		normalizedProvider === "azure_ai"
	) {
		return "openai";
	}

	return null;
}

function pricingProviderCandidates(provider: string, model: string) {
	const candidates = new Set([provider]);
	const normalizedProvider = provider.toLowerCase();
	const normalizedModel = model.toLowerCase();

	if (isQwenModel(normalizedModel)) candidates.add("qwen");
	if (isZaiModel(normalizedModel)) candidates.add("z-ai");
	if (normalizedModel.includes("grok")) candidates.add("xai");
	if (normalizedModel.includes("deepseek")) candidates.add("deepseek");
	if (normalizedModel.includes("claude")) candidates.add("anthropic");
	if (normalizedModel.includes("gemini")) candidates.add("google");
	if (
		isOpenAiModel(normalizedModel) ||
		isOpenAiProviderAlias(normalizedProvider)
	) {
		candidates.add("openai");
	}

	return [...candidates].filter(Boolean);
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

function pricingModelLookupKeys(model: string) {
	return new Set(
		[...pricingModelAliases(model)]
			.map((alias) => normalizePricingModelKey(alias))
			.filter((alias) => alias.length > 0),
	);
}

function normalizePricingModelKey(model: string) {
	return model.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function setsOverlap(left: Set<string>, right: Set<string>) {
	for (const value of left) {
		if (right.has(value)) return true;
	}
	return false;
}

function isQwenModel(model: string) {
	return (
		model === "qwen" ||
		model.startsWith("qwen") ||
		model.startsWith("qwen/") ||
		model.includes("/qwen")
	);
}

function isZaiModel(model: string) {
	return (
		model.startsWith("z-ai/") ||
		model.startsWith("zai-") ||
		model.startsWith("glm-") ||
		model.includes("/z-ai/") ||
		model.includes("/zai-") ||
		model.includes("/glm-")
	);
}

function isOpenAiModel(model: string) {
	return (
		model.includes("gpt") ||
		model.includes("codex") ||
		model.startsWith("o1") ||
		model.startsWith("o3") ||
		model.startsWith("o4")
	);
}

function isOpenAiProviderAlias(provider: string) {
	return (
		provider === "azure" ||
		provider === "azure-openai" ||
		provider === "azure_ai" ||
		provider === "openai-compatible" ||
		provider === "local"
	);
}

function perMillionPrice(value: unknown) {
	const perToken =
		typeof value === "number"
			? value
			: typeof value === "string" && value.trim()
				? Number(value)
				: null;
	return normalizePrice(perToken === null ? null : perToken * 1_000_000);
}

function pricingModelAliases(model: string) {
	const aliases = new Set([model]);
	const slashIndex = model.lastIndexOf("/");
	if (slashIndex > 0) {
		const aliasModel = model.slice(slashIndex + 1).trim();
		if (aliasModel) aliases.add(aliasModel);
	}

	if (model.startsWith("anthropic.")) {
		aliases.add(model.slice("anthropic.".length));
	}
	if (model.startsWith("xai/")) {
		aliases.add(model.slice("xai/".length));
	}
	if (model.startsWith("gemini/")) {
		aliases.add(model.slice("gemini/".length));
	}
	if (model.startsWith("deepseek/")) {
		aliases.add(model.slice("deepseek/".length));
	}
	for (const alias of [...aliases]) {
		const qwenPrefixIndex = alias.lastIndexOf("qwen.");
		if (qwenPrefixIndex >= 0)
			aliases.add(alias.slice(qwenPrefixIndex + "qwen.".length));
	}
	return aliases;
}

function startOfUtcDay(value: string) {
	const date = new Date(value);
	return new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
	);
}
