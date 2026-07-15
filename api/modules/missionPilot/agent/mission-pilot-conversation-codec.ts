import type { ProviderToolCall } from "../../../services/structured-llm/public";

export function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export function stringValue(value: unknown) {
	return typeof value === "string" ? value : "";
}

export function readToolCalls(value: unknown): ProviderToolCall[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const calls = value.filter(
		(call): call is ProviderToolCall =>
			Boolean(call) &&
			typeof call === "object" &&
			typeof (call as ProviderToolCall).id === "string" &&
			typeof (call as ProviderToolCall).name === "string" &&
			typeof (call as ProviderToolCall).arguments === "object",
	);
	return calls.length ? calls : undefined;
}

export function readExpectedRevision(args: Record<string, unknown>) {
	const value = args.expectedRevision ?? args.expectedTaskRevision;
	return typeof value === "number" && Number.isInteger(value) ? value : null;
}
