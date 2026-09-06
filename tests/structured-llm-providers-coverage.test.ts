import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	settings: {} as Record<string, unknown>,
	callAzure: vi.fn(),
	callOpenAI: vi.fn(),
	callBedrock: vi.fn(),
	callCodex: vi.fn(),
	callMuse: vi.fn(),
	callMuseTool: vi.fn(),
	callFixture: vi.fn(),
	callBedrockTool: vi.fn(),
	callCodexTool: vi.fn(),
	callFixtureTool: vi.fn(),
	hasFixtureTurns: vi.fn(),
	authorize: vi.fn(),
	emit: vi.fn(),
}));

vi.mock("../api/services/structured-llm/settings", async () => {
	const actual = await vi.importActual(
		"../api/services/structured-llm/settings",
	);
	return {
		...actual,
		readStructuredLlmProviderSettings: () => mocks.settings,
		getStructuredLlmSetting: (
			settings: Record<string, unknown>,
			key: string,
			fallback = "",
		) => settings[key] ?? fallback,
		getStructuredLlmBoolSetting: (
			settings: Record<string, unknown>,
			key: string,
			fallback: boolean,
		) => (typeof settings[key] === "boolean" ? settings[key] : fallback),
	};
});
vi.mock("../api/services/structured-llm/azure-provider", () => ({
	callAzureProvider: mocks.callAzure,
}));
vi.mock("../api/services/structured-llm/openai-provider", () => ({
	callOpenAIProvider: mocks.callOpenAI,
}));
vi.mock("../api/services/structured-llm/bedrock-provider", () => ({
	callBedrockProvider: mocks.callBedrock,
	callBedrockProviderToolTurn: mocks.callBedrockTool,
}));
vi.mock("../api/services/structured-llm/codex-provider", () => ({
	callCodexProvider: mocks.callCodex,
	callCodexProviderToolTurn: mocks.callCodexTool,
}));
vi.mock("../api/services/structured-llm/muse-provider", () => ({
	callMuseProvider: mocks.callMuse,
	callMuseProviderToolTurn: mocks.callMuseTool,
}));
vi.mock("../api/services/structured-llm/fixture-provider", () => ({
	callFixtureProvider: mocks.callFixture,
}));
vi.mock("../api/services/structured-llm/fixture-tool-provider", () => ({
	callFixtureProviderToolTurn: mocks.callFixtureTool,
	hasFixtureProviderToolTurns: mocks.hasFixtureTurns,
}));
vi.mock("../api/services/structured-llm/provider-call-authorization", () => ({
	authorizeStructuredProviderCall: mocks.authorize,
}));
vi.mock("../api/services/structured-llm/events", () => ({
	emitSupervisorLlmDebugEvent: mocks.emit,
}));

import {
	buildOpenAICompatibleHeaders,
	callProvider,
	callProviderToolTurn,
	emitOpenAICompatibilityRetryEvents,
	getResolvedProviderEndpoint,
	readProviderUsage,
	retryOpenAITransientUnavailableOnce,
	toCodexReasoningEffort,
	toOpenAIReasoningEffort,
} from "../api/services/structured-llm/providers";

function normalized(overrides: Record<string, unknown> = {}) {
	return {
		providerId: "openai",
		providerEndpointId: null,
		endpoint: null,
		modelOrDeployment: "model",
		apiVersion: null,
		thinkingDepth: null,
		...overrides,
	};
}

function toolInput(overrides: Record<string, unknown> = {}) {
	return {
		provider: "openai",
		messages: [{ role: "user", content: "hello" }],
		tools: [
			{ name: "read", description: "Read", inputSchema: { type: "object" } },
		],
		systemPrompt: "system",
		userPrompt: "user",
		options: {
			normalizedRequest: normalized(),
			role: "default",
			taskId: "task-1",
			toolChoice: undefined,
		},
		signal: new AbortController().signal,
		setProviderDebug: vi.fn(),
		...overrides,
	} as never;
}

function rawInput(provider = "openai") {
	return {
		provider,
		systemPrompt: "system",
		userPrompt: "user",
		options: {
			label: "test",
			normalizedRequest: normalized({ providerId: provider }),
		},
		signal: new AbortController().signal,
		setProviderDebug: vi.fn(),
	} as never;
}

function response(
	body: unknown,
	status = 200,
	headers?: Record<string, string>,
) {
	return new Response(typeof body === "string" ? body : JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

describe("structured LLM providers coverage", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		mocks.settings = {};
		mocks.hasFixtureTurns.mockReturnValue(false);
		mocks.authorize.mockResolvedValue(undefined);
		for (const fn of [
			mocks.callAzure,
			mocks.callOpenAI,
			mocks.callBedrock,
			mocks.callCodex,
			mocks.callMuse,
			mocks.callFixture,
		])
			fn.mockResolvedValue({ ok: true });
		mocks.callBedrockTool.mockResolvedValue({
			type: "supported",
			content: "bedrock",
			toolCalls: [],
		});
		mocks.callCodexTool.mockResolvedValue({
			type: "supported",
			content: "codex",
			toolCalls: [],
		});
		mocks.callMuseTool.mockResolvedValue({
			type: "supported",
			content: "muse",
			toolCalls: [],
		});
		mocks.callFixtureTool.mockResolvedValue({
			type: "supported",
			content: "fixture",
			toolCalls: [],
		});
		mocks.emit.mockResolvedValue(undefined);
	});

	it("dispatches raw calls to all provider adapters and rejects unsupported providers", async () => {
		for (const [provider, fn] of [
			["azure", mocks.callAzure],
			["openai", mocks.callOpenAI],
			["bedrock", mocks.callBedrock],
			["codex", mocks.callCodex],
			["muse", mocks.callMuse],
			["fixture", mocks.callFixture],
		] as const) {
			await expect(callProvider(rawInput(provider))).resolves.toEqual({
				ok: true,
			});
			expect(fn).toHaveBeenCalled();
		}
		await expect(callProvider(rawInput("unknown"))).rejects.toThrow(
			"Unsupported LLM provider: unknown",
		);
	});

	it("uses scoped fixture tool turns before reading provider settings", async () => {
		mocks.hasFixtureTurns.mockReturnValue(true);
		let input = toolInput({
			options: {
				normalizedRequest: normalized(),
				role: "implementation",
				taskId: "task-1",
			},
		});
		await expect(callProviderToolTurn(input)).resolves.toMatchObject({
			content: "fixture",
		});
		expect(mocks.hasFixtureTurns).toHaveBeenCalledWith(
			"task-1",
			"implementation",
		);
		expect(mocks.callFixtureTool).toHaveBeenCalledWith(
			expect.objectContaining({ scope: "implementation" }),
		);
		input = toolInput({
			options: {
				normalizedRequest: normalized(),
				role: "default",
				taskId: "task-2",
			},
		});
		await callProviderToolTurn(input);
		expect(mocks.hasFixtureTurns).toHaveBeenCalledWith("task-2", "default");
	});

	it("dispatches Bedrock, Codex, Muse, fixture, and unsupported tool turns", async () => {
		for (const [provider, expected] of [
			["bedrock", "bedrock"],
			["codex", "codex"],
			["muse", "muse"],
			["fixture", "fixture"],
		] as const) {
			const input = toolInput({
				provider,
				options: {
					normalizedRequest: normalized({ providerId: provider }),
					taskId: null,
				},
			});
			await expect(callProviderToolTurn(input)).resolves.toMatchObject({
				content: expected,
			});
		}
		const input = toolInput({
			provider: "unknown",
			options: {
				normalizedRequest: normalized({
					providerId: "unknown",
					providerEndpointId: "endpoint",
				}),
			},
		});
		await expect(callProviderToolTurn(input)).resolves.toMatchObject({
			type: "unsupported",
			providerDebug: {
				provider: "unknown",
				providerEndpointId: "endpoint",
				supported: false,
			},
		});
		expect(input.setProviderDebug).toHaveBeenCalled();
	});

	it("calls an OpenAI-compatible endpoint without an API key", async () => {
		mocks.settings = {
			providerEndpoints: [
				{
					id: "local",
					kind: "openai-compatible",
					enabled: true,
					apiKey: "",
					baseUrl: "http://localhost:1234/",
					models: ["local-model"],
				},
			],
		};
		const fetchMock = vi.fn(async () =>
			response({
				choices: [
					{
						message: {
							content: "answer",
							tool_calls: [
								{
									id: "call-1",
									type: "function",
									function: { name: "read", arguments: "{}" },
								},
							],
						},
					},
				],
				usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const input = toolInput({
			options: {
				normalizedRequest: normalized({
					providerEndpointId: "local",
					modelOrDeployment: null,
					thinkingDepth: "very_high",
				}),
				taskId: null,
			},
		});
		const result = await callProviderToolTurn(input);
		expect(result).toMatchObject({
			type: "supported",
			content: "answer",
			model: "local-model",
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:1234/chat/completions",
			expect.objectContaining({
				headers: { "Content-Type": "application/json" },
				timeout: false,
			}),
		);
		expect(input.setProviderDebug).toHaveBeenCalledWith(
			expect.objectContaining({
				reasoningEffort: "high",
				hasChoices: true,
				hasUsage: true,
				toolCallCount: 1,
			}),
		);
	});

	it("enforces OpenAI enablement and credentials and normalizes HTTP failures", async () => {
		mocks.settings = { OPENAI_ENABLED: false, OPENAI_API_KEY: "key" };
		await expect(callProviderToolTurn(toolInput())).rejects.toMatchObject({
			kind: "permission",
			retryable: false,
		});
		mocks.settings = { OPENAI_ENABLED: true, OPENAI_API_KEY: "" };
		await expect(callProviderToolTurn(toolInput())).rejects.toMatchObject({
			kind: "authentication",
		});
		mocks.settings = {
			OPENAI_ENABLED: true,
			OPENAI_API_KEY: "key",
			OPENAI_BASE_URL: "https://api.test/v1/",
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response("rate limited", 429, { "retry-after": "1" })),
		);
		await expect(callProviderToolTurn(toolInput())).rejects.toMatchObject({
			kind: "rate_limit",
			httpStatus: 429,
			retryable: true,
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response("provider raw body")),
		);
		await expect(callProviderToolTurn(toolInput())).rejects.toMatchObject({
			kind: "invalid_response",
			retryable: false,
			providerBody: "provider raw body",
		});
	});

	it("handles sparse OpenAI responses and endpoint override precedence", async () => {
		mocks.settings = {
			OPENAI_ENABLED: true,
			OPENAI_API_KEY: "global",
			OPENAI_MODEL: "global-model",
			providerEndpoints: [
				{
					id: "openai-1",
					kind: "openai",
					enabled: true,
					apiKey: "endpoint-key",
					baseUrl: "https://endpoint/v1",
					models: ["endpoint-model"],
				},
			],
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response({})),
		);
		const input = toolInput({
			options: {
				normalizedRequest: normalized({
					providerEndpointId: "openai-1",
					endpoint: "https://override/v1/",
					modelOrDeployment: "override-model",
				}),
			},
		});
		const result = await callProviderToolTurn(input);
		expect(result).toMatchObject({
			content: "",
			toolCalls: [],
			model: "override-model",
		});
		expect(fetch).toHaveBeenCalledWith(
			"https://override/v1/chat/completions",
			expect.any(Object),
		);
	});

	it("calls Azure with endpoint configuration and reports configuration failures", async () => {
		mocks.settings = { AZURE_OPENAI_ENABLED: false };
		let input = toolInput({
			provider: "azure",
			options: { normalizedRequest: normalized({ providerId: "azure" }) },
		});
		await expect(callProviderToolTurn(input)).rejects.toMatchObject({
			kind: "permission",
		});
		mocks.settings = { AZURE_OPENAI_ENABLED: true };
		await expect(callProviderToolTurn(input)).rejects.toMatchObject({
			kind: "authentication",
		});

		mocks.settings = {
			providerEndpoints: [
				{
					id: "azure-1",
					kind: "azure",
					enabled: true,
					apiKey: "key",
					endpoint: "https://azure.test/",
					models: ["deployment"],
					apiVersion: "2025-01-01",
				},
			],
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				response({ choices: [{ message: { content: null } }] }),
			),
		);
		input = toolInput({
			provider: "azure",
			options: {
				normalizedRequest: normalized({
					providerId: "azure",
					providerEndpointId: "azure-1",
					modelOrDeployment: null,
					thinkingDepth: "low",
				}),
			},
		});
		const result = await callProviderToolTurn(input);
		expect(result).toMatchObject({
			type: "supported",
			content: "",
			model: "deployment",
		});
		expect(fetch).toHaveBeenCalledWith(
			"https://azure.test/openai/deployments/deployment/chat/completions?api-version=2025-01-01",
			expect.any(Object),
		);
	});

	it("normalizes Azure HTTP errors", async () => {
		mocks.settings = {
			AZURE_OPENAI_ENABLED: true,
			AZURE_OPENAI_API_KEY: "key",
			AZURE_OPENAI_ENDPOINT: "https://azure",
			AZURE_OPENAI_DEPLOYMENT_NAME: "dep",
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response("forbidden", 403)),
		);
		await expect(
			callProviderToolTurn(
				toolInput({
					provider: "azure",
					options: { normalizedRequest: normalized({ providerId: "azure" }) },
				}),
			),
		).rejects.toMatchObject({ kind: "permission", httpStatus: 403 });
	});

	it("retries only transient OpenAI unavailable responses", async () => {
		const fetchCompletion = vi.fn(async () => response({ ok: true }));
		const input = rawInput();
		let result = await retryOpenAITransientUnavailableOnce({
			response: response("bad request", 400),
			input,
			fetchCompletion,
			responseFormat: "json_schema",
			stream: true,
		});
		expect(result.status).toBe(400);
		expect(await result.text()).toBe("bad request");
		expect(fetchCompletion).not.toHaveBeenCalled();

		result = await retryOpenAITransientUnavailableOnce({
			response: response("model unavailable_error while loading model", 503),
			input,
			fetchCompletion,
			responseFormat: "json_object",
			stream: false,
		});
		expect(result.status).toBe(200);
		expect(fetchCompletion).toHaveBeenCalledWith({
			responseFormat: "json_object",
			stream: false,
			reason: "transient_unavailable_retry",
		});
		expect(mocks.emit).toHaveBeenCalledTimes(2);
	});

	it("emits a compatibility retry event pair", async () => {
		await emitOpenAICompatibilityRetryEvents({} as never, {
			reason: "stream_read_error",
			errorMessage: "socket",
			fromResponseFormat: "json_schema",
			fromStream: true,
		});
		expect(mocks.emit).toHaveBeenCalledTimes(2);
		expect(mocks.emit).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ type: "model.retry_scheduled" }),
		);
	});

	it("covers endpoint, headers, reasoning, and usage helpers", () => {
		expect(buildOpenAICompatibleHeaders("key")).toEqual({
			"Content-Type": "application/json",
			Authorization: "Bearer key",
		});
		expect(buildOpenAICompatibleHeaders("")).toEqual({
			"Content-Type": "application/json",
		});
		const settings = {
			providerEndpoints: [{ id: "one" }, { id: "two" }],
		} as never;
		expect(
			getResolvedProviderEndpoint(
				{
					options: {
						normalizedRequest: normalized({ providerEndpointId: "two" }),
					},
				},
				settings,
			),
		).toEqual({ id: "two" });
		expect(
			getResolvedProviderEndpoint(
				{
					options: {
						normalizedRequest: normalized({ providerEndpointId: "missing" }),
					},
				},
				settings,
			),
		).toBeNull();
		expect(getResolvedProviderEndpoint({ options: {} }, settings)).toBeNull();
		expect(
			["minimal", "low", "medium", "high", "very_high", "xhigh", "bad"].map(
				toCodexReasoningEffort,
			),
		).toEqual(["minimal", "low", "medium", "high", "xhigh", "xhigh", "low"]);
		expect(
			["low", "medium", "high", "very_high", "bad"].map(
				toOpenAIReasoningEffort,
			),
		).toEqual(["low", "medium", "high", "high", undefined]);
		expect(readProviderUsage({ usage: { total: 1 } })).toEqual({ total: 1 });
		expect(readProviderUsage(null)).toBeNull();
		expect(readProviderUsage([])).toBeNull();
	});
});
