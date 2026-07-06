import {
	DEFAULT_CONVERSATION_CONTEXT_MAX_TOKENS,
	DEFAULT_SMALL_FILE_CHAR_LIMIT,
} from "./token-budget";

function isEnabled(key: string, fallback = false) {
	const raw = process.env[key];
	if (raw === undefined) return fallback;
	return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function readNumber(key: string, fallback: number) {
	const parsed = Number(process.env[key]);
	return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function isConversationContextEnabled() {
	return isEnabled("CONVERSATION_CONTEXT_ENABLED", true);
}

export function isConversationContextStateCardEnabled() {
	return (
		isConversationContextEnabled() &&
		isEnabled("CONVERSATION_CONTEXT_STATE_CARD_ENABLED", true)
	);
}

export function isConversationContextBuildOnIdleEnabled() {
	return (
		isConversationContextEnabled() &&
		isEnabled("CONVERSATION_CONTEXT_BUILD_ON_IDLE", true)
	);
}

export function getConversationContextRuntimeOptions() {
	return {
		maxTokens: readNumber(
			"CONVERSATION_CONTEXT_MAX_TOKENS",
			DEFAULT_CONVERSATION_CONTEXT_MAX_TOKENS,
		),
		includeSmallTargetFile: isEnabled(
			"CONVERSATION_CONTEXT_INCLUDE_SMALL_TARGET_FILE",
			true,
		),
		smallFileCharLimit: readNumber(
			"CONVERSATION_CONTEXT_SMALL_FILE_CHAR_LIMIT",
			DEFAULT_SMALL_FILE_CHAR_LIMIT,
		),
	};
}
