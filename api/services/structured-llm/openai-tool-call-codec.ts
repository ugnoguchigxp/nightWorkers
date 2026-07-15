import type { ProviderToolCall, ProviderToolDefinition } from "./tool-calls";

export type OpenAIChatCompletionResponse = {
	choices?: Array<{
		message?: {
			content?: string;
			tool_calls?: Array<OpenAIChatCompletionToolCall>;
		};
	}>;
	usage?: unknown;
};

type OpenAIChatCompletionToolCall = {
	id?: string;
	type?: string;
	function?: { name?: string | null; arguments?: string | null };
};

export function toOpenAIToolDefinition(tool: ProviderToolDefinition) {
	return {
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.inputSchema,
		},
	};
}

export function toProviderToolCall(
	call: OpenAIChatCompletionToolCall,
): ProviderToolCall[] {
	const name = call.function?.name;
	if (!name) return [];
	return [
		{
			id: call.id || `call_${Date.now()}`,
			name,
			arguments: parseToolArguments(call.function?.arguments ?? ""),
		},
	];
}

function parseToolArguments(raw: string): Record<string, unknown> {
	if (!raw.trim()) return {};
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: { value: parsed };
	} catch {
		return { _raw: raw };
	}
}
