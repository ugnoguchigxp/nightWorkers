import type { ConversationContextOptions } from "./types";

export const DEFAULT_CONVERSATION_CONTEXT_MAX_TOKENS = 1200;
export const DEFAULT_SMALL_FILE_CHAR_LIMIT = 6000;
export const USAGE_ESTIMATE_ALGORITHM_VERSION = "characters_div_4_v1";

/** A lightweight usage estimate; it is intentionally not a context admission gate. */
export function estimateUsageTokens(text: string) {
	return Math.ceil(text.length / 4);
}

// Retained for existing callers while each new consumer names its estimate purpose.
export const estimateTokens = estimateUsageTokens;

export function resolveConversationContextOptions(
	options?: ConversationContextOptions,
): Required<
	Pick<
		ConversationContextOptions,
		"maxTokens" | "includeSmallTargetFile" | "smallFileCharLimit"
	>
> {
	return {
		maxTokens: options?.maxTokens ?? DEFAULT_CONVERSATION_CONTEXT_MAX_TOKENS,
		includeSmallTargetFile: options?.includeSmallTargetFile ?? true,
		smallFileCharLimit:
			options?.smallFileCharLimit ?? DEFAULT_SMALL_FILE_CHAR_LIMIT,
	};
}
