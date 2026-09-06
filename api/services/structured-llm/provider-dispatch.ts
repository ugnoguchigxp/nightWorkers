export type StructuredLlmProviderAdapter =
	| "azure"
	| "openai"
	| "bedrock"
	| "codex"
	| "muse"
	| "fixture";

export function normalizeStructuredLlmProviderAdapter(provider: string) {
	return provider === "test" ? "fixture" : provider;
}

export function dispatchStructuredLlmProvider<T>(input: {
	provider: string;
	adapters: Partial<Record<StructuredLlmProviderAdapter, () => T>>;
	onUnsupported: (provider: string) => T;
}): T {
	const provider = normalizeStructuredLlmProviderAdapter(input.provider);
	const adapter = input.adapters[provider as StructuredLlmProviderAdapter];
	return adapter ? adapter() : input.onUnsupported(provider);
}
