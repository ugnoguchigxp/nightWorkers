import fs from "node:fs";
import type {
	Message as BedrockMessage,
	Tool as BedrockTool,
	ToolChoice as BedrockToolChoice,
} from "@aws-sdk/client-bedrock-runtime";
import { normalizeProviderUsage } from "../llm-usage";
import { StructuredProviderError } from "./provider-failure";
import type { RawLlmCallOptions } from "./providers";
import { getResolvedProviderEndpoint, readProviderUsage } from "./providers";
import {
	type getStructuredLlmBoolSetting,
	getStructuredLlmSetting,
	type readStructuredLlmProviderSettings,
} from "./settings";
import type { ProviderToolMessage, ProviderToolTurnResult } from "./tool-calls";
import type { ProviderCallResult } from "./types";

type BedrockProviderInput = {
	provider: string;
	systemPrompt: string;
	userPrompt: string;
	options: RawLlmCallOptions;
	signal: AbortSignal;
	setProviderDebug: (value: Record<string, unknown>) => void;
};

export async function callBedrockProvider(
	input: BedrockProviderInput,
	isEnabled: (
		key: Parameters<typeof getStructuredLlmBoolSetting>[1],
		fallback: boolean,
	) => boolean,
	settings: ReturnType<typeof readStructuredLlmProviderSettings>,
): Promise<ProviderCallResult> {
	const endpointConfig = getResolvedProviderEndpoint(input, settings);
	if (!endpointConfig?.enabled && !isEnabled("AWS_BEDROCK_ENABLED", false)) {
		throw new Error(
			"Bedrock provider is inactive. Enable AWS_BEDROCK_ENABLED first.",
		);
	}
	const { BedrockRuntimeClient, ConverseCommand } = await import(
		"@aws-sdk/client-bedrock-runtime"
	);
	const region =
		input.options.normalizedRequest?.region ||
		endpointConfig?.region ||
		getStructuredLlmSetting(settings, "AWS_REGION", "us-east-1");
	const modelId =
		input.options.normalizedRequest?.modelOrDeployment ||
		endpointConfig?.models[0] ||
		getStructuredLlmSetting(
			settings,
			"AWS_BEDROCK_MODEL",
			"anthropic.claude-3-5-sonnet-20241022-v2:0",
		);
	const client = new BedrockRuntimeClient({
		region,
		credentials: {
			accessKeyId: getStructuredLlmSetting(settings, "AWS_ACCESS_KEY_ID"),
			secretAccessKey: getStructuredLlmSetting(
				settings,
				"AWS_SECRET_ACCESS_KEY",
			),
		},
	});
	const res = await client.send(
		new ConverseCommand({
			modelId,
			messages: [{ role: "user", content: [{ text: input.userPrompt }] }],
			system: [{ text: input.systemPrompt }],
		}),
		{ abortSignal: input.signal },
	);
	const toolUse = res.output?.message?.content?.find((block) =>
		Boolean(block.toolUse),
	);
	if (toolUse && input.options.normalizedRequest) {
		const { rejectProviderActivity } = await import("./events");
		await rejectProviderActivity({
			options: input.options,
			request: input.options.normalizedRequest,
			activityType: "tool_use",
			toolName: toolUse.toolUse?.name ?? null,
			preview: JSON.stringify(toolUse),
		});
	}
	const content = res.output?.message?.content?.[0]?.text || "";
	const usage = readProviderUsage(res);
	const providerDebug = {
		provider: "bedrock",
		providerEndpointId: endpointConfig?.id ?? null,
		modelId,
		hasOutput: Boolean(res.output),
		hasUsage: Boolean(usage),
	};
	input.setProviderDebug(providerDebug);
	return {
		content,
		usage: normalizeProviderUsage({
			provider: "bedrock",
			rawUsage: usage,
			fallback: {
				systemPrompt: input.systemPrompt,
				userPrompt: input.userPrompt,
				responseText: content,
			},
		}),
		model: modelId,
		providerDebug,
	};
}

export async function callBedrockProviderToolTurn(
	input: {
		messages: ProviderToolMessage[];
		systemPrompt: string;
		userPrompt: string;
		tools: Array<{
			name: string;
			description: string;
			inputSchema: Record<string, unknown>;
		}>;
		options: {
			normalizedRequest: NonNullable<RawLlmCallOptions["normalizedRequest"]>;
			toolChoice?:
				| "auto"
				| "required"
				| {
						type: "function";
						function: { name: string };
				  };
		};
		signal: AbortSignal;
		setProviderDebug: (value: Record<string, unknown>) => void;
	},
	isEnabled: (
		key: Parameters<typeof getStructuredLlmBoolSetting>[1],
		fallback: boolean,
	) => boolean,
	settings: ReturnType<typeof readStructuredLlmProviderSettings>,
): Promise<ProviderToolTurnResult> {
	const endpointConfig = getResolvedProviderEndpoint(input, settings);
	if (!endpointConfig?.enabled && !isEnabled("AWS_BEDROCK_ENABLED", false)) {
		throw new StructuredProviderError({
			kind: "permission",
			retryable: false,
			message:
				"Bedrock provider is inactive. Enable AWS_BEDROCK_ENABLED first.",
		});
	}
	const { BedrockRuntimeClient, ConverseCommand } = await import(
		"@aws-sdk/client-bedrock-runtime"
	);
	const region =
		input.options.normalizedRequest.region ||
		endpointConfig?.region ||
		getStructuredLlmSetting(settings, "AWS_REGION", "us-east-1");
	const modelId =
		input.options.normalizedRequest.modelOrDeployment ||
		endpointConfig?.models[0] ||
		getStructuredLlmSetting(
			settings,
			"AWS_BEDROCK_MODEL",
			"anthropic.claude-3-5-sonnet-20241022-v2:0",
		);
	const client = new BedrockRuntimeClient({
		region,
		credentials: {
			accessKeyId: getStructuredLlmSetting(settings, "AWS_ACCESS_KEY_ID"),
			secretAccessKey: getStructuredLlmSetting(
				settings,
				"AWS_SECRET_ACCESS_KEY",
			),
		},
	});
	const tools = input.tools.map((tool) => ({
		toolSpec: {
			name: tool.name,
			description: tool.description,
			inputSchema: { json: tool.inputSchema },
		},
	})) as BedrockTool[];
	const res = await client.send(
		new ConverseCommand({
			modelId,
			messages: toBedrockToolMessages(input.messages),
			...(input.systemPrompt.trim()
				? { system: [{ text: input.systemPrompt }] }
				: {}),
			toolConfig: {
				tools,
				toolChoice: toBedrockToolChoice(
					input.options.toolChoice,
				) as BedrockToolChoice,
			},
		}),
		{ abortSignal: input.signal },
	);
	const blocks = res.output?.message?.content ?? [];
	const content = blocks
		.flatMap((block) => (typeof block.text === "string" ? [block.text] : []))
		.join("\n");
	const toolCalls = blocks.flatMap((block) => {
		const toolUse = block.toolUse;
		if (!toolUse?.toolUseId || !toolUse.name) return [];
		const rawInput = toolUse.input;
		return [
			{
				id: toolUse.toolUseId,
				name: toolUse.name,
				arguments:
					rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
						? (rawInput as Record<string, unknown>)
						: { _raw: rawInput },
			},
		];
	});
	const usage = readProviderUsage(res);
	const providerDebug = {
		provider: "bedrock",
		providerEndpointId: endpointConfig?.id ?? null,
		mode: "provider_native_tools",
		modelId,
		hasOutput: Boolean(res.output),
		hasUsage: Boolean(usage),
		toolCallCount: toolCalls.length,
	};
	input.setProviderDebug(providerDebug);
	return {
		type: "supported",
		content,
		toolCalls,
		usage: normalizeProviderUsage({
			provider: "bedrock",
			rawUsage: usage,
			fallback: {
				systemPrompt: input.systemPrompt,
				userPrompt: input.userPrompt,
				responseText: content,
			},
		}),
		model: modelId,
		providerDebug,
	};
}

function toBedrockToolMessages(
	messages: ProviderToolMessage[],
): BedrockMessage[] {
	return messages.flatMap<unknown>((message) => {
		if (message.role === "system") return [];
		if (message.role === "user") {
			const content =
				typeof message.content === "string"
					? [{ text: message.content }]
					: message.content.map((part) => {
							if (part.type === "text") return { text: part.text };
							return {
								image: {
									format: bedrockImageFormat(part.image.mediaType),
									source: { bytes: fs.readFileSync(part.image.path) },
								},
							};
						});
			return [{ role: "user" as const, content }];
		}
		if (message.role === "assistant") {
			return [
				{
					role: "assistant" as const,
					content: [
						...(message.content ? [{ text: message.content }] : []),
						...(message.toolCalls ?? []).map((toolCall) => ({
							toolUse: {
								toolUseId: toolCall.id,
								name: toolCall.name,
								input: toolCall.arguments,
							},
						})),
					],
				},
			];
		}
		return [
			{
				role: "user" as const,
				content: [
					{
						toolResult: {
							toolUseId: message.toolCallId,
							content: [{ text: message.content }],
						},
					},
				],
			},
		];
	}) as BedrockMessage[];
}

function toBedrockToolChoice(
	choice:
		| "auto"
		| "required"
		| { type: "function"; function: { name: string } }
		| undefined,
) {
	if (choice === "required") return { any: {} };
	if (choice && typeof choice === "object") {
		return { tool: { name: choice.function.name } };
	}
	return { auto: {} };
}

function bedrockImageFormat(mediaType: string) {
	if (mediaType === "image/jpeg") return "jpeg" as const;
	if (mediaType === "image/gif") return "gif" as const;
	if (mediaType === "image/webp") return "webp" as const;
	return "png" as const;
}
