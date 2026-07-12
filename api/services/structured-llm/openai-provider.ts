import { normalizeProviderUsage } from "../llm-usage";
import { rejectProviderActivity } from "./events";
import {
	buildOpenAIChatCompletionBody,
	readOpenAIChatCompletionStream,
} from "./openai";
import type {
	OpenAIChatCompletionResponse,
	OpenAIResponseFormat,
	RawLlmCallOptions,
} from "./providers";
import {
	buildOpenAICompatibleHeaders,
	emitOpenAICompatibilityRetryEvents,
	emitSchemaRetryEvents,
	getResolvedProviderEndpoint,
	retryOpenAITransientUnavailableOnce,
	toOpenAIReasoningEffort,
} from "./providers";
import {
	getStructuredLlmBoolSetting,
	getStructuredLlmSetting,
	readStructuredLlmProviderSettings,
} from "./settings";
import type { ProviderCallResult } from "./types";
export type OpenAIProviderInput = {
	provider: string;
	systemPrompt: string;
	userPrompt: string;
	options: RawLlmCallOptions;
	signal: AbortSignal;
	setProviderDebug: (value: Record<string, unknown>) => void;
};

export async function callOpenAIProvider(
	input: OpenAIProviderInput,
	isEnabled: (
		key: Parameters<typeof getStructuredLlmBoolSetting>[1],
		fallback: boolean,
	) => boolean,
	settings: ReturnType<typeof readStructuredLlmProviderSettings>,
): Promise<ProviderCallResult> {
	const endpointConfig = getResolvedProviderEndpoint(input, settings);
	if (!endpointConfig?.enabled && !isEnabled("OPENAI_ENABLED", true)) {
		throw new Error(
			"OpenAI provider is inactive. Enable OPENAI_ENABLED first.",
		);
	}
	const apiKey =
		endpointConfig?.apiKey ||
		getStructuredLlmSetting(settings, "OPENAI_API_KEY");
	const baseURL =
		input.options.normalizedRequest?.endpoint ||
		endpointConfig?.baseUrl ||
		getStructuredLlmSetting(
			settings,
			"OPENAI_BASE_URL",
			"https://api.openai.com/v1",
		);
	const model =
		input.options.normalizedRequest?.modelOrDeployment ||
		endpointConfig?.models[0] ||
		getStructuredLlmSetting(settings, "OPENAI_MODEL", "gpt-4o-mini");
	const localCompatibleEndpoint =
		endpointConfig?.kind === "local" ||
		endpointConfig?.kind === "openai-compatible";
	const streamResponses =
		typeof settings.OPENAI_STREAMING_ENABLED === "boolean"
			? settings.OPENAI_STREAMING_ENABLED
			: !localCompatibleEndpoint && isEnabled("OPENAI_STREAMING_ENABLED", true);
	const reasoningEffort = toOpenAIReasoningEffort(
		input.options.normalizedRequest?.thinkingDepth,
	);
	const apiKeyRequired = !endpointConfig || endpointConfig.kind === "openai";
	if (apiKeyRequired && !apiKey) {
		throw new Error(
			"OpenAI API key is not configured in environment variables.",
		);
	}
	const headers = buildOpenAICompatibleHeaders(apiKey);
	const url = `${baseURL.replace(/\/+$/, "")}/chat/completions`;
	const attempts: Array<{
		responseFormat: OpenAIResponseFormat;
		stream: boolean;
		reason: string;
	}> = [];
	const fetchCompletion = async (inputOverride: {
		responseFormat: OpenAIResponseFormat;
		stream: boolean;
		reason: string;
	}) => {
		attempts.push(inputOverride);
		return fetch(url, {
			method: "POST",
			signal: input.signal,
			headers,
			body: JSON.stringify(
				buildOpenAIChatCompletionBody({
					model,
					systemPrompt: input.systemPrompt,
					userPrompt: input.userPrompt,
					round: input.options.round,
					schemaFirst: input.options.schemaFirst,
					jsonSchema: input.options.jsonSchema,
					responseFormat: inputOverride.responseFormat,
					stream: inputOverride.stream,
					reasoningEffort,
				}),
			),
		});
	};

	let responseFormat: OpenAIResponseFormat = "json_schema";
	let activeStreamResponses = streamResponses;
	let response: Response;
	try {
		response = await fetchCompletion({
			responseFormat,
			stream: activeStreamResponses,
			reason: "initial",
		});
	} catch (error) {
		if (!localCompatibleEndpoint) throw error;
		await emitOpenAICompatibilityRetryEvents(input.options, {
			reason: "transport_error",
			errorMessage: error instanceof Error ? error.message : String(error),
			fromResponseFormat: responseFormat,
			fromStream: activeStreamResponses,
		});
		responseFormat = "json_object";
		activeStreamResponses = false;
		response = await fetchCompletion({
			responseFormat,
			stream: activeStreamResponses,
			reason: "local_transport_compatibility_retry",
		});
	}

	if (!response.ok && response.status === 400) {
		await emitSchemaRetryEvents(input.options, "OpenAI", response.status);
		responseFormat = "json_object";
		if (localCompatibleEndpoint) activeStreamResponses = false;
		response = await fetchCompletion({
			responseFormat,
			stream: activeStreamResponses,
			reason: "schema_400_retry",
		});
	}

	if (!response.ok) {
		response = await retryOpenAITransientUnavailableOnce({
			response,
			input,
			fetchCompletion,
			responseFormat,
			stream: activeStreamResponses,
		});
	}

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`OpenAI call failed with status ${response.status}: ${errorText}`,
		);
	}
	let streamResult: { content: string; usage: unknown | null } | null = null;
	let responseData: OpenAIChatCompletionResponse | null = null;
	if (activeStreamResponses) {
		try {
			streamResult = await readOpenAIChatCompletionStream({
				response,
				options: input.options,
				normalizedRequest: input.options.normalizedRequest,
				provider: "openai",
				round: input.options.round,
			});
		} catch (error) {
			if (!localCompatibleEndpoint) throw error;
			await emitOpenAICompatibilityRetryEvents(input.options, {
				reason: "stream_read_error",
				errorMessage: error instanceof Error ? error.message : String(error),
				fromResponseFormat: responseFormat,
				fromStream: activeStreamResponses,
			});
			responseFormat = "json_object";
			activeStreamResponses = false;
			response = await fetchCompletion({
				responseFormat,
				stream: activeStreamResponses,
				reason: "local_stream_compatibility_retry",
			});
			if (!response.ok) {
				response = await retryOpenAITransientUnavailableOnce({
					response,
					input,
					fetchCompletion,
					responseFormat,
					stream: activeStreamResponses,
				});
			}
			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(
					`OpenAI call failed with status ${response.status}: ${errorText}`,
				);
			}
			responseData = await response.json();
		}
	} else {
		responseData = await response.json();
	}
	const message = responseData?.choices?.[0]?.message;
	if (message?.tool_calls && input.options.normalizedRequest) {
		await rejectProviderActivity({
			options: input.options,
			request: input.options.normalizedRequest,
			activityType: "tool_call",
			toolName: message.tool_calls?.[0]?.function?.name ?? null,
			preview: JSON.stringify(message.tool_calls),
		});
	}
	const content = activeStreamResponses
		? streamResult?.content || ""
		: responseData?.choices?.[0]?.message?.content || "";
	const rawUsage = activeStreamResponses
		? streamResult?.usage
		: responseData?.usage;
	const providerDebug = {
		provider: "openai",
		providerEndpointId: endpointConfig?.id ?? null,
		status: response.status,
		model,
		streamed: activeStreamResponses,
		responseFormat,
		reasoningEffort,
		hasChoices: Boolean(responseData?.choices || streamResult),
		hasUsage: Boolean(rawUsage),
		attempts,
	};
	input.setProviderDebug(providerDebug);
	return {
		content,
		usage: normalizeProviderUsage({
			provider: "openai",
			rawUsage,
			fallback: {
				systemPrompt: input.systemPrompt,
				userPrompt: input.userPrompt,
				responseText: content,
			},
		}),
		model,
		providerDebug,
	};
}
