export const LLM_ROLE_ORDER = [
	"plan",
	"evaluation",
	"implementation",
	"test",
	"review",
	"mission_pilot",
	"mission_task_generation",
] as const;

export type LlmRole = (typeof LLM_ROLE_ORDER)[number];

export const DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS = 300;
export const MIN_LLM_REQUEST_TIMEOUT_SECONDS = 30;
export const MAX_LLM_REQUEST_TIMEOUT_SECONDS = 1200;

const LLM_ROLE_SET = new Set<string>(LLM_ROLE_ORDER);

export function isLlmRole(value: unknown): value is LlmRole {
	return typeof value === "string" && LLM_ROLE_SET.has(value);
}

export const LEGACY_LLM_ROLE_ALIASES = {
	quality_gate: "test",
	completion: "review",
} as const satisfies Record<string, LlmRole>;

export type LegacyLlmRole = keyof typeof LEGACY_LLM_ROLE_ALIASES;

export function resolveLlmRole(value: unknown): LlmRole | null {
	if (isLlmRole(value)) return value;
	if (typeof value !== "string") return null;
	return LEGACY_LLM_ROLE_ALIASES[value as LegacyLlmRole] ?? null;
}
