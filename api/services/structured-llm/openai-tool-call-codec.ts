import { decodeProviderToolCalls } from "./tool-argument-codec";
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

export function toProviderToolCalls(input: {
	calls: readonly OpenAIChatCompletionToolCall[];
	tools: readonly ProviderToolDefinition[];
	provider: string;
	content?: string;
	responseBody?: string;
}): ProviderToolCall[] {
	return decodeProviderToolCalls({
		provider: input.provider,
		calls: input.calls.map((call, index) => ({
			id: call.id || `call_${index}`,
			name: call.function?.name || "<missing>",
			arguments: call.function?.arguments ?? "",
		})),
		tools: input.tools,
		content: input.content,
		responseBody: input.responseBody,
	});
}
