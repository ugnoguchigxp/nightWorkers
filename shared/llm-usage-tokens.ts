export type InputTokenBreakdownSource = {
	inputTokens?: number | null;
	cachedInputTokens?: number | null;
};

export function normalizeInputTokenBreakdown(usage: InputTokenBreakdownSource) {
	const inputTokens = normalizeTokenCount(usage.inputTokens);
	const reportedCachedInputTokens = normalizeTokenCount(
		usage.cachedInputTokens,
	);
	const cachedInputTokens = Math.min(reportedCachedInputTokens, inputTokens);
	return {
		inputTokens,
		cachedInputTokens,
		uncachedInputTokens: inputTokens - cachedInputTokens,
		cachedInputExceedsInput: reportedCachedInputTokens > inputTokens,
	};
}

export function normalizeTokenCount(value: number | null | undefined) {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(0, Math.floor(value))
		: 0;
}
