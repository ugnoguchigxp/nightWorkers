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

export const PUBLIC_PRICING_COVERED_PROVIDERS = new Set([
	"openai",
	"anthropic",
	"google",
	"deepseek",
	"qwen",
]);

const LITELLM_PRICING_SOURCE_LABEL =
	"LiteLLM model_prices_and_context_window.json";
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

type LiteLlmPriceRow = {
	litellm_provider?: unknown;
	input_cost_per_token?: unknown;
	output_cost_per_token?: unknown;
	cache_read_input_token_cost?: unknown;
};

type VisiblePricingRow = {
	provider: string;
	model: string;
	currencyCode: string;
	manualOverride: boolean;
	effectiveFrom: Date;
	fetchedAt: Date | null;
};

function normalizePrice(value: number | null | undefined) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: null;
}

export function parseLiteLlmRows(
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

export function mapLiteLlmPriceRow(
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

function isVisiblePricingRow(row: VisiblePricingRow) {
	if (row.manualOverride) return true;
	const provider = row.provider === "codex" ? "openai" : row.provider;
	const canonicalModel = canonicalPublicPricingModel(provider, row.model);
	return canonicalModel === row.model;
}

export function currentVisiblePricingRows<T extends VisiblePricingRow>(
	rows: T[],
) {
	const currentRows = new Map<string, T>();
	for (const row of rows) {
		if (!isVisiblePricingRow(row)) continue;
		const key = `${row.provider}\u0000${row.model}\u0000${row.currencyCode}`;
		const existing = currentRows.get(key);
		if (!existing || isNewerPricingRow(row, existing))
			currentRows.set(key, row);
	}
	return [...currentRows.values()];
}

function isNewerPricingRow(
	candidate: VisiblePricingRow,
	existing: VisiblePricingRow,
) {
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

export function pricingProviderCandidates(provider: string, model: string) {
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

export function pricingModelLookupKeys(model: string) {
	return new Set(
		[...pricingModelAliases(model)]
			.map((alias) => normalizePricingModelKey(alias))
			.filter((alias) => alias.length > 0),
	);
}

function normalizePricingModelKey(model: string) {
	return model.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function setsOverlap(left: Set<string>, right: Set<string>) {
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

export function startOfUtcDay(value: string) {
	const date = new Date(value);
	return new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
	);
}
