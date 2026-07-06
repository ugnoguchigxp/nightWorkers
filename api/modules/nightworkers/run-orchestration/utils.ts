export function toErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

export function toRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeAgentRuntimeKind(value: unknown) {
	if (
		value === "native-local" ||
		value === "codex-agent" ||
		value === "external-process" ||
		value === "future-adapter"
	) {
		return value;
	}
	return "native-local";
}
