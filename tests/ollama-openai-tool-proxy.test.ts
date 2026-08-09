import { describe, expect, it } from "vitest";
import {
	toOllamaToolMessages,
	toOpenAIToolCompletion,
} from "../scripts/ollama-openai-tool-proxy.mjs";

describe("Ollama OpenAI tool proxy", () => {
	it("maps OpenAI assistant calls and tool results to Ollama messages", () => {
		expect(
			toOllamaToolMessages([
				{
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "call-1",
							function: {
								name: "read_file",
								arguments: '{"path":"src/a.ts"}',
							},
						},
					],
				},
				{ role: "tool", tool_call_id: "call-1", content: "contents" },
			]),
		).toEqual([
			{
				role: "assistant",
				content: "",
				tool_calls: [
					{
						function: {
							name: "read_file",
							arguments: { path: "src/a.ts" },
						},
					},
				],
			},
			{ role: "tool", tool_name: "read_file", content: "contents" },
		]);
	});

	it("maps Ollama tool calls and token counts to OpenAI completion JSON", () => {
		const result = toOpenAIToolCompletion(
			{
				model: "qwen3:8b",
				message: {
					content: "",
					tool_calls: [
						{
							id: "call-2",
							function: { name: "ping", arguments: { value: "ok" } },
						},
					],
				},
				prompt_eval_count: 12,
				eval_count: 3,
			},
			"fallback-model",
		);

		expect(result).toMatchObject({
			model: "qwen3:8b",
			choices: [
				{
					finish_reason: "tool_calls",
					message: {
						tool_calls: [
							{
								id: "call-2",
								function: {
									name: "ping",
									arguments: '{"value":"ok"}',
								},
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
		});
	});
});
