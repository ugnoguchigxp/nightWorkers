import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
	buildNormalizedSupervisorLlmRequest,
	callProviderToolTurn,
	callStructuredJsonLLM,
} from "../../../api/services/structured-llm";
import "./setup";

function llmSettingsPath() {
	const settingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
	if (!settingsPath)
		throw new Error("NIGHTWORKERS_LLM_SETTINGS_PATH is required.");
	return settingsPath;
}

describe("Supervisor LLM schema-first parsing provider runtime", () => {
	it("uses runtime provider settings ahead of environment fallback", async () => {
		process.env.ACTIVE_LLM_PROVIDER = "openai";
		process.env.OPENAI_ENABLED = "false";
		fs.writeFileSync(
			llmSettingsPath(),
			JSON.stringify({
				ACTIVE_LLM_PROVIDER: "fixture",
				SUPERVISOR_FIXTURE_OUTPUT: "ignored",
			}),
		);
		process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({ ok: true });

		const rawOutput = await callStructuredJsonLLM("system", "user", {
			schemaName: "example_schema",
			schema: { type: "object" },
		});

		expect(JSON.parse(rawOutput)).toEqual({ ok: true });
	});

	it("allows local OpenAI-compatible endpoints without an API key", async () => {
		delete process.env.OPENAI_API_KEY;
		fs.writeFileSync(
			llmSettingsPath(),
			JSON.stringify({
				ACTIVE_LLM_PROVIDER: "azure",
				OPENAI_STREAMING_ENABLED: false,
				providerEndpoints: [
					{
						id: "local-qwen",
						name: "Local Qwen",
						kind: "local",
						enabled: true,
						baseUrl: "http://localhost:11434/v1",
						models: ["qwen3-coder"],
					},
				],
				roleRoutes: [
					{
						role: "implementation",
						primary: {
							providerEndpointId: "local-qwen",
							model: "qwen3-coder",
						},
						fallbacks: [],
					},
				],
			}),
		);
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			expect(url).toBe("http://localhost:11434/v1/chat/completions");
			expect(
				(init?.headers as Record<string, string>).Authorization,
			).toBeUndefined();
			return new Response(
				JSON.stringify({
					choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const rawOutput = await callStructuredJsonLLM("system", "user", {
			schemaName: "example_schema",
			schema: { type: "object" },
			role: "implementation",
		});

		expect(JSON.parse(rawOutput)).toEqual({ ok: true });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("omits temperature for Azure structured calls and uses the model default", async () => {
		fs.writeFileSync(
			llmSettingsPath(),
			JSON.stringify({
				ACTIVE_LLM_PROVIDER: "azure",
				providerEndpoints: [
					{
						id: "azure-implementation",
						name: "Azure Implementation",
						kind: "azure",
						enabled: true,
						apiKey: "test-azure-key",
						endpoint: "https://example.openai.azure.com/",
						apiVersion: "2025-04-01-preview",
						models: ["gpt-5-4-mini"],
					},
				],
				roleRoutes: [
					{
						role: "implementation",
						primary: {
							providerEndpointId: "azure-implementation",
							model: "gpt-5-4-mini",
							thinkingDepth: "low",
						},
						fallbacks: [],
					},
				],
			}),
		);
		const requestBodies: Array<Record<string, unknown>> = [];
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			expect(url).toBe(
				"https://example.openai.azure.com/openai/deployments/gpt-5-4-mini/chat/completions?api-version=2025-04-01-preview",
			);
			requestBodies.push(
				JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
			);
			return new Response(
				JSON.stringify({
					choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const rawOutput = await callStructuredJsonLLM("system", "user", {
			schemaName: "example_schema",
			schema: { type: "object" },
			role: "implementation",
		});

		expect(JSON.parse(rawOutput)).toEqual({ ok: true });
		expect(requestBodies[0]).not.toHaveProperty("temperature");
		expect(requestBodies[0]).toMatchObject({
			reasoning_effort: "low",
			response_format: { type: "json_schema" },
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("supports Azure provider-native tool turns on the native/API lane", async () => {
		const settings = {
			ACTIVE_LLM_PROVIDER: "azure",
			providerEndpoints: [
				{
					id: "azure-implementation",
					name: "Azure Implementation",
					kind: "azure",
					enabled: true,
					apiKey: "test-azure-key",
					endpoint: "https://example.openai.azure.com/",
					apiVersion: "2025-04-01-preview",
					models: ["gpt-5-4-mini"],
				},
			],
			roleRoutes: [
				{
					role: "implementation",
					primary: {
						providerEndpointId: "azure-implementation",
						model: "gpt-5-4-mini",
						thinkingDepth: "low",
					},
					fallbacks: [],
				},
			],
		};
		fs.writeFileSync(llmSettingsPath(), JSON.stringify(settings));
		const requestBodies: Array<Record<string, unknown>> = [];
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			expect(url).toBe(
				"https://example.openai.azure.com/openai/deployments/gpt-5-4-mini/chat/completions?api-version=2025-04-01-preview",
			);
			expect((init?.headers as Record<string, string>)["api-key"]).toBe(
				"test-azure-key",
			);
			requestBodies.push(
				JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
			);
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: "",
								tool_calls: [
									{
										id: "call-final",
										type: "function",
										function: {
											name: "finalize_answer",
											arguments: JSON.stringify({
												finalReport: "done through azure tools",
											}),
										},
									},
								],
							},
						},
					],
					usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const normalizedRequest = buildNormalizedSupervisorLlmRequest({
			systemPrompt: "system text",
			userPrompt: "user text",
			label: "supervisor",
			role: "implementation",
			settings,
		});
		const providerDebug: Array<Record<string, unknown>> = [];

		const result = await callProviderToolTurn({
			provider: "azure",
			systemPrompt: "system text",
			userPrompt: "user text",
			messages: [
				{ role: "system", content: "system text" },
				{ role: "user", content: "user text" },
			],
			tools: [
				{
					name: "finalize_answer",
					description: "Finish the run",
					inputSchema: {
						type: "object",
						properties: { finalReport: { type: "string" } },
						required: ["finalReport"],
					},
				},
			],
			options: {
				label: "supervisor",
				role: "implementation",
				normalizedRequest,
				toolChoice: "required",
			},
			signal: AbortSignal.timeout(1000),
			setProviderDebug: (value) => providerDebug.push(value),
		});

		expect(result).toMatchObject({
			type: "supported",
			model: "gpt-5-4-mini",
			toolCalls: [
				{
					id: "call-final",
					name: "finalize_answer",
					arguments: { finalReport: "done through azure tools" },
				},
			],
			usage: {
				inputTokens: 11,
				outputTokens: 7,
				totalTokens: 18,
				mode: "measured",
			},
		});
		expect(providerDebug[0]).toMatchObject({
			provider: "azure-openai",
			providerEndpointId: "azure-implementation",
			mode: "provider_native_tools",
			status: 200,
			toolCallCount: 1,
		});
		expect(requestBodies[0]).toMatchObject({
			messages: [
				{ role: "system", content: "system text" },
				{ role: "user", content: "user text" },
			],
			tool_choice: "required",
			reasoning_effort: "low",
		});
		expect(requestBodies[0]).not.toHaveProperty("temperature");
		expect(requestBodies[0].tools).toEqual([
			{
				type: "function",
				function: {
					name: "finalize_answer",
					description: "Finish the run",
					parameters: {
						type: "object",
						properties: { finalReport: { type: "string" } },
						required: ["finalReport"],
					},
				},
			},
		]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
