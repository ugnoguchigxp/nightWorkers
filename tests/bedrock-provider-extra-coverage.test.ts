import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	commands: [] as unknown[],
	clientInputs: [] as unknown[],
	responses: [] as unknown[],
	rejectedActivities: [] as unknown[],
	endpoint: null as null | Record<string, unknown>,
	usage: null as null | Record<string, unknown>,
	reset() {
		this.commands.length = 0;
		this.clientInputs.length = 0;
		this.responses.length = 0;
		this.rejectedActivities.length = 0;
		this.endpoint = null;
		this.usage = null;
	},
}));

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
	ConverseCommand: class {
		constructor(input: unknown) {
			mocks.commands.push(input);
		}
	},
	BedrockRuntimeClient: class {
		constructor(input: unknown) {
			mocks.clientInputs.push(input);
		}

		async send() {
			return mocks.responses.shift();
		}
	},
}));
vi.mock(
	"../api/services/structured-llm/openai-compatible-provider-support",
	() => ({
		getResolvedProviderEndpoint: () => mocks.endpoint,
		readProviderUsage: () => mocks.usage,
	}),
);
vi.mock("../api/services/structured-llm/events", () => ({
	rejectProviderActivity: async (input: unknown) => {
		mocks.rejectedActivities.push(input);
	},
}));

import {
	callBedrockProvider,
	callBedrockProviderToolTurn,
} from "../api/services/structured-llm/bedrock-provider";

const cleanupDirectories: string[] = [];

beforeEach(() => {
	mocks.reset();
});

afterEach(() => {
	for (const directory of cleanupDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

describe("bedrock provider extra coverage", () => {
	it("rejects inactive structured and tool providers", async () => {
		mocks.endpoint = { enabled: false, models: [] };
		await expect(
			callBedrockProvider(baseInput(), () => false, {}),
		).rejects.toThrow("Bedrock provider is inactive");
		await expect(
			callBedrockProviderToolTurn(toolInput(), () => false, {}),
		).rejects.toMatchObject({ kind: "permission", retryable: false });
	});

	it("uses setting fallbacks and tolerates an empty response", async () => {
		mocks.responses.push({});
		const setProviderDebug = vi.fn();
		const result = await callBedrockProvider(
			baseInput({ setProviderDebug }),
			() => true,
			{
				AWS_REGION: "eu-west-1",
				AWS_BEDROCK_MODEL: "settings-model",
				AWS_ACCESS_KEY_ID: "key",
				AWS_SECRET_ACCESS_KEY: "secret",
			},
		);

		expect(mocks.clientInputs[0]).toEqual({
			region: "eu-west-1",
			credentials: { accessKeyId: "key", secretAccessKey: "secret" },
		});
		expect(mocks.commands[0]).toMatchObject({ modelId: "settings-model" });
		expect(result).toMatchObject({
			content: "",
			model: "settings-model",
			providerDebug: {
				providerEndpointId: null,
				hasOutput: false,
				hasUsage: false,
			},
		});
		expect(setProviderDebug).toHaveBeenCalledOnce();
		expect(mocks.rejectedActivities).toHaveLength(0);
	});

	it("prefers request routing and rejects provider-side tool use", async () => {
		mocks.endpoint = {
			id: "endpoint",
			enabled: true,
			region: "endpoint-region",
			models: ["endpoint-model"],
		};
		mocks.usage = { inputTokens: 4, outputTokens: 2 };
		mocks.responses.push({
			output: {
				message: {
					content: [
						{ text: "answer" },
						{ toolUse: { toolUseId: "tool-1", name: "search" } },
					],
				},
			},
		});
		const result = await callBedrockProvider(
			baseInput({
				options: {
					label: "bedrock",
					normalizedRequest: {
						region: "request-region",
						modelOrDeployment: "request-model",
					},
				},
			}),
			() => false,
			{},
		);

		expect(result.content).toBe("answer");
		expect(result.model).toBe("request-model");
		expect(mocks.clientInputs[0]).toMatchObject({ region: "request-region" });
		expect(mocks.rejectedActivities[0]).toMatchObject({
			activityType: "tool_use",
			toolName: "search",
		});
	});

	it("rejects malformed Bedrock tool arguments before returning any tool call", async () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-extra-"));
		cleanupDirectories.push(directory);
		const imagePath = path.join(directory, "image.bin");
		fs.writeFileSync(imagePath, "image");
		mocks.endpoint = {
			id: "endpoint",
			enabled: true,
			region: "endpoint-region",
			models: ["endpoint-model"],
		};
		mocks.usage = { inputTokens: 3, outputTokens: 2 };
		mocks.responses.push({
			output: {
				message: {
					content: [
						{ text: "first" },
						{ text: "second" },
						{
							toolUse: {
								toolUseId: "valid",
								name: "read",
								input: { path: "a" },
							},
						},
						{
							toolUse: {
								toolUseId: "raw",
								name: "raw-tool",
								input: ["not", "object"],
							},
						},
						{ toolUse: { toolUseId: "missing-name", input: 3 } },
						{ toolUse: { name: "missing-id", input: 3 } },
					],
				},
			},
		});

		const error = await callBedrockProviderToolTurn(
			toolInput({
				systemPrompt: " system ",
				messages: [
					{ role: "system", content: "ignored" },
					{ role: "user", content: "plain user" },
					{
						role: "user",
						content: [
							{ type: "text", text: "part" },
							{
								type: "image",
								image: { path: imagePath, mediaType: "image/jpeg" },
							},
							{
								type: "image",
								image: { path: imagePath, mediaType: "image/gif" },
							},
							{
								type: "image",
								image: { path: imagePath, mediaType: "image/webp" },
							},
							{
								type: "image",
								image: { path: imagePath, mediaType: "image/png" },
							},
						],
					},
					{
						role: "assistant",
						content: "assistant",
						toolCalls: [{ id: "call", name: "read", arguments: { path: "a" } }],
					},
					{ role: "assistant", content: "", toolCalls: [] },
					{ role: "tool", toolCallId: "call", content: "result" },
				],
				options: {
					normalizedRequest: {
						providerEndpointId: "endpoint",
						region: "",
						modelOrDeployment: "",
					},
					toolChoice: "required",
				},
			}),
			() => false,
			{},
		).catch((caught) => caught);

		expect(error).toMatchObject({
			name: "StructuredProviderError",
			kind: "invalid_response",
			code: "INVALID_TOOL_ARGUMENTS",
			retryable: false,
		});
		const providerBody = JSON.parse(
			(error as { providerBody?: string }).providerBody ?? "{}",
		);
		expect(providerBody.toolName).toBe("raw-tool");
		expect(providerBody.rawArguments).toBe('["not","object"]');
		const command = mocks.commands[0] as {
			messages: Array<{ role: string; content: unknown[] }>;
			system: unknown;
			toolConfig: { toolChoice: unknown };
		};
		expect(command.messages).toHaveLength(5);
		expect(command.system).toEqual([{ text: " system " }]);
		expect(command.toolConfig.toolChoice).toEqual({ any: {} });
		expect(JSON.stringify(command.messages)).toContain('"format":"jpeg"');
		expect(JSON.stringify(command.messages)).toContain('"format":"gif"');
		expect(JSON.stringify(command.messages)).toContain('"format":"webp"');
		expect(JSON.stringify(command.messages)).toContain('"format":"png"');
	});

	it("maps named and automatic tool choices without a system prompt", async () => {
		mocks.endpoint = { enabled: true, models: [] };
		for (const toolChoice of [
			{ type: "function", function: { name: "chosen" } },
			"auto",
			undefined,
		] as const) {
			mocks.responses.push({ output: { message: { content: [] } } });
			await callBedrockProviderToolTurn(
				toolInput({
					systemPrompt: "   ",
					options: {
						normalizedRequest: { providerEndpointId: "endpoint" },
						toolChoice,
					},
				}),
				() => false,
				{},
			);
		}

		expect(mocks.commands).toEqual([
			expect.objectContaining({
				toolConfig: {
					tools: expect.any(Array),
					toolChoice: { tool: { name: "chosen" } },
				},
			}),
			expect.objectContaining({
				toolConfig: { tools: expect.any(Array), toolChoice: { auto: {} } },
			}),
			expect.objectContaining({
				toolConfig: { tools: expect.any(Array), toolChoice: { auto: {} } },
			}),
		]);
		for (const command of mocks.commands as Array<Record<string, unknown>>) {
			expect(command).not.toHaveProperty("system");
		}
	});
});

function baseInput(overrides: Record<string, unknown> = {}) {
	return {
		provider: "bedrock",
		systemPrompt: "system",
		userPrompt: "user",
		options: { label: "bedrock" },
		signal: new AbortController().signal,
		setProviderDebug: vi.fn(),
		...overrides,
	} as never;
}

function toolInput(overrides: Record<string, unknown> = {}) {
	const overrideOptions =
		(overrides.options as Record<string, unknown> | undefined) ?? {};
	return {
		messages: [],
		systemPrompt: "system",
		userPrompt: "user",
		tools: [
			{ name: "read", description: "Read", inputSchema: { type: "object" } },
		],
		signal: new AbortController().signal,
		setProviderDebug: vi.fn(),
		...overrides,
		options: {
			normalizedRequest: { providerEndpointId: "endpoint" },
			...overrideOptions,
		},
	} as never;
}
