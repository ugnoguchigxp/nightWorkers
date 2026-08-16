import type { StructuredLlmProviderEndpoint } from "./settings";
import type { NormalizedSupervisorLlmRequest } from "./types";

export function buildOpenAICompatibleHeaders(
	apiKey: string,
): Record<string, string> {
	return {
		"Content-Type": "application/json",
		...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
	};
}

export function getResolvedProviderEndpoint(
	input: { options: { normalizedRequest?: NormalizedSupervisorLlmRequest } },
	settings: { providerEndpoints?: StructuredLlmProviderEndpoint[] },
): StructuredLlmProviderEndpoint | null {
	const endpointId = input.options.normalizedRequest?.providerEndpointId;
	if (!endpointId) return null;
	return (
		settings.providerEndpoints?.find(
			(endpoint) => endpoint.id === endpointId,
		) || null
	);
}

export function toCodexReasoningEffort(
	value: string | null | undefined,
): "minimal" | "low" | "medium" | "high" | "xhigh" {
	if (
		value === "minimal" ||
		value === "low" ||
		value === "medium" ||
		value === "high"
	) {
		return value;
	}
	if (value === "very_high" || value === "xhigh") return "xhigh";
	return "low";
}

export function toOpenAIReasoningEffort(
	value: string | null | undefined,
): "low" | "medium" | "high" | undefined {
	if (value === "low" || value === "medium" || value === "high") return value;
	if (value === "very_high") return "high";
	return undefined;
}

export function readProviderUsage(value: unknown): unknown {
	return value && typeof value === "object" && "usage" in value
		? (value as { usage?: unknown }).usage
		: null;
}
