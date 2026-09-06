import { normalizeProviderUsage } from "../llm-usage/normalize";
import { rejectProviderActivity } from "./events";
import {
	buildOpenAIChatCompletionBody,
	readOpenAIChatCompletionStream,
} from "./openai";
import {
	buildOpenAICompatibleHeaders,
	getResolvedProviderEndpoint,
	toOpenAIReasoningEffort,
} from "./openai-compatible-provider-support";
import {
	emitOpenAICompatibilityRetryEvents,
	retryOpenAITransientUnavailableOnce,
} from "./openai-provider-retry";
import {
	normalizeStructuredProviderError,
	providerHttpError,
	providerInvalidResponseError,
	readBoundedProviderResponseText,
	StructuredProviderError,
} from "./provider-failure";
import type {
	OpenAIChatCompletionResponse,
	OpenAIResponseFormat,
	RawLlmCallOptions,
} from "./providers";
import {
	type getStructuredLlmBoolSetting,
	getStructuredLlmSetting,
	type readStructuredLlmProviderSettings,
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
		throw new StructuredProviderError({
			kind: "permission",
			retryable: false,
			message: "OpenAI provider is inactive. Enable OPENAI_ENABLED first.",
		});
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
	const streamResponses = localCompatibleEndpoint
		? false
		: typeof settings.OPENAI_STREAMING_ENABLED === "boolean"
			? settings.OPENAI_STREAMING_ENABLED
			: isEnabled("OPENAI_STREAMING_ENABLED", true);
	const reasoningEffort = toOpenAIReasoningEffort(
		input.options.normalizedRequest?.thinkingDepth,
	);
	const apiKeyRequired = !endpointConfig || endpointConfig.kind === "openai";
	if (apiKeyRequired && !apiKey) {
		throw new StructuredProviderError({
			kind: "authentication",
			retryable: false,
			message: "OpenAI API key is not configured in environment variables.",
		});
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

	let responseFormat: OpenAIResponseFormat = localCompatibleEndpoint
		? "json_object"
		: "json_schema";
	let activeStreamResponses = streamResponses;
	let response: Response;
	try {
		response = await fetchCompletion({
			responseFormat,
			stream: activeStreamResponses,
			reason: "initial",
		});
	} catch (error) {
		const failure = normalizeStructuredProviderError(error);
		if (!localCompatibleEndpoint || !failure.retryable) throw failure;
		await emitOpenAICompatibilityRetryEvents(input.options, {
			reason: "transport_error",
			errorMessage: failure.message,
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
		const errorText = await readBoundedProviderResponseText(response);
		throw providerHttpError({
			provider: "OpenAI",
			status: response.status,
			body: errorText,
			retryAfter: response.headers.get("retry-after"),
		});
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
			const failure = normalizeStructuredProviderError(error);
			if (!localCompatibleEndpoint || !failure.retryable) throw failure;
			await emitOpenAICompatibilityRetryEvents(input.options, {
				reason: "stream_read_error",
				errorMessage: failure.message,
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
				const errorText = await readBoundedProviderResponseText(response);
				throw providerHttpError({
					provider: "OpenAI",
					status: response.status,
					body: errorText,
					retryAfter: response.headers.get("retry-after"),
				});
			}
			responseData = await readOpenAIProviderJson(response);
		}
	} else {
		responseData = await readOpenAIProviderJson(response);
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

async function readOpenAIProviderJson(
	response: Response,
): Promise<OpenAIChatCompletionResponse> {
	const body = await readBoundedProviderResponseText(response);
	try {
		return JSON.parse(body) as OpenAIChatCompletionResponse;
	} catch (error) {
		throw providerInvalidResponseError({
			provider: "OpenAI",
			body,
			cause: error,
		});
	}
}
