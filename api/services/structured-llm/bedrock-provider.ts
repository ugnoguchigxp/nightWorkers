import { normalizeProviderUsage } from "../llm-usage";
import type { RawLlmCallOptions } from "./providers";
import { getResolvedProviderEndpoint, readProviderUsage } from "./providers";
import {
	type getStructuredLlmBoolSetting,
	getStructuredLlmSetting,
	type readStructuredLlmProviderSettings,
} from "./settings";
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
