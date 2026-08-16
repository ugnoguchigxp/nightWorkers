import { normalizeProviderUsage } from "../llm-usage";
import {
	getResolvedProviderEndpoint,
	readProviderUsage,
	toOpenAIReasoningEffort,
} from "./openai-compatible-provider-support";
import type { OpenAIChatCompletionResponse } from "./openai-tool-call-codec";
import {
	toOpenAIToolDefinition,
	toProviderToolCalls,
} from "./openai-tool-call-codec";
import { toOpenAIToolMessages } from "./openai-tool-messages";
import {
	providerHttpError,
	providerInvalidResponseError,
	readBoundedProviderResponseText,
	StructuredProviderError,
} from "./provider-failure";
import {
	type getStructuredLlmBoolSetting,
	getStructuredLlmSetting,
	type readStructuredLlmProviderSettings,
} from "./settings";
import type {
	ProviderToolDefinition,
	ProviderToolMessage,
	ProviderToolTurnResult,
	RawToolTurnCallOptions,
} from "./tool-calls";

type AzureProviderToolTurnInput = {
	messages: ProviderToolMessage[];
	tools: ProviderToolDefinition[];
	systemPrompt: string;
	userPrompt: string;
	options: RawToolTurnCallOptions;
	signal: AbortSignal;
	setProviderDebug: (value: Record<string, unknown>) => void;
};

export async function callAzureProviderToolTurn(
	input: AzureProviderToolTurnInput,
	isEnabled: (
		key: Parameters<typeof getStructuredLlmBoolSetting>[1],
		fallback: boolean,
	) => boolean,
	settings: ReturnType<typeof readStructuredLlmProviderSettings>,
): Promise<ProviderToolTurnResult> {
	const endpointConfig = getResolvedProviderEndpoint(input, settings);
	if (!endpointConfig?.enabled && !isEnabled("AZURE_OPENAI_ENABLED", false)) {
		throw new StructuredProviderError({
			kind: "permission",
			retryable: false,
			message: "Azure provider is inactive. Enable AZURE_OPENAI_ENABLED first.",
		});
	}
	const apiKey =
		endpointConfig?.apiKey ||
		getStructuredLlmSetting(settings, "AZURE_OPENAI_API_KEY");
	const endpoint =
		input.options.normalizedRequest.endpoint ||
		endpointConfig?.endpoint ||
		getStructuredLlmSetting(settings, "AZURE_OPENAI_ENDPOINT");
	const deploymentName =
		input.options.normalizedRequest.modelOrDeployment ||
		endpointConfig?.models[0] ||
		getStructuredLlmSetting(
			settings,
			"AZURE_OPENAI_DEPLOYMENT_NAME",
			"gpt-5-mini",
		);
	const apiVersion =
		input.options.normalizedRequest.apiVersion ||
		endpointConfig?.apiVersion ||
		getStructuredLlmSetting(
			settings,
			"AZURE_OPENAI_API_VERSION",
			"2024-05-01-preview",
		);
	if (!apiKey || !endpoint) {
		throw new StructuredProviderError({
			kind: "authentication",
			retryable: false,
			message:
				"Azure OpenAI credentials are not configured in environment variables.",
		});
	}
	const reasoningEffort = toOpenAIReasoningEffort(
		input.options.normalizedRequest.thinkingDepth,
	);
	const cleanEndpoint = endpoint.replace(/\/+$/, "");
	const url = `${cleanEndpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
	const response = await fetch(url, {
		method: "POST",
		signal: input.signal,
		headers: { "Content-Type": "application/json", "api-key": apiKey },
		body: JSON.stringify({
			messages: toOpenAIToolMessages(input.messages),
			tools: input.tools.map(toOpenAIToolDefinition),
			tool_choice: input.options.toolChoice ?? "auto",
			...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
		}),
	});

	if (!response.ok) {
		const errorText = await readBoundedProviderResponseText(response);
		throw providerHttpError({
			provider: "Azure OpenAI",
			status: response.status,
			body: errorText,
			retryAfter: response.headers.get("retry-after"),
		});
	}

	const responseData = await readAzureProviderToolTurnJson(response);
	const message = responseData.choices?.[0]?.message;
	const content = typeof message?.content === "string" ? message.content : "";
	const toolCalls = toProviderToolCalls({
		calls: message?.tool_calls ?? [],
		tools: input.tools,
		provider: "Azure OpenAI",
		content,
		responseBody: JSON.stringify(responseData),
	});
	const providerDebug = {
		provider: "azure-openai",
		providerEndpointId: endpointConfig?.id ?? null,
		mode: "provider_native_tools",
		status: response.status,
		deploymentName,
		apiVersion,
		reasoningEffort,
		hasChoices: Boolean(responseData.choices),
		hasUsage: Boolean(responseData.usage),
		toolCallCount: toolCalls.length,
	};
	input.setProviderDebug(providerDebug);

	return {
		type: "supported",
		content,
		toolCalls,
		usage: normalizeProviderUsage({
			provider: "azure-openai",
			rawUsage: readProviderUsage(responseData),
			fallback: {
				systemPrompt: input.systemPrompt,
				userPrompt: input.userPrompt,
				responseText: content,
			},
		}),
		model: deploymentName,
		providerDebug,
	};
}

async function readAzureProviderToolTurnJson(
	response: Response,
): Promise<OpenAIChatCompletionResponse> {
	const body = await readBoundedProviderResponseText(response);
	try {
		return JSON.parse(body) as OpenAIChatCompletionResponse;
	} catch (error) {
		throw providerInvalidResponseError({
			provider: "Azure OpenAI",
			body,
			cause: error,
		});
	}
}
