import { normalizeProviderUsage } from "../llm-usage";
import { callAzureProvider } from "./azure-provider";
import { callAzureProviderToolTurn } from "./azure-provider-tool-turn";
import {
	callBedrockProvider,
	callBedrockProviderToolTurn,
} from "./bedrock-provider";
import { callCodexProvider, callCodexProviderToolTurn } from "./codex-provider";
import { emitSupervisorLlmDebugEvent } from "./events";
import { callFixtureProvider } from "./fixture-provider";
import {
	callFixtureProviderToolTurn,
	hasFixtureProviderToolTurns,
} from "./fixture-tool-provider";
import { callOpenAIProvider } from "./openai-provider";
import {
	type OpenAIChatCompletionResponse,
	toOpenAIToolDefinition,
	toProviderToolCalls,
} from "./openai-tool-call-codec";

export type { OpenAIChatCompletionResponse } from "./openai-tool-call-codec";

import {
	buildOpenAICompatibleHeaders,
	getResolvedProviderEndpoint,
	toOpenAIReasoningEffort,
} from "./openai-compatible-provider-support";
import { toOpenAIToolMessages } from "./openai-tool-messages";
import { authorizeStructuredProviderCall } from "./provider-call-authorization";
import { dispatchStructuredLlmProvider } from "./provider-dispatch";
import {
	normalizeStructuredProviderError,
	providerHttpError,
	providerInvalidResponseError,
	readBoundedProviderResponseText,
	StructuredProviderError,
} from "./provider-failure";
import { providerAdapterKey } from "./request";
import {
	getStructuredLlmBoolSetting,
	getStructuredLlmSetting,
	readStructuredLlmProviderSettings,
} from "./settings";
import type {
	ProviderToolDefinition,
	ProviderToolMessage,
	ProviderToolTurnResult,
	RawToolTurnCallOptions,
} from "./tool-calls";
import type {
	CallSupervisorOptions,
	NormalizedSupervisorLlmRequest,
	ProviderCallResult,
} from "./types";

export {
	buildOpenAICompatibleHeaders,
	getResolvedProviderEndpoint,
	readProviderUsage,
	toCodexReasoningEffort,
	toOpenAIReasoningEffort,
} from "./openai-compatible-provider-support";

export type OpenAIResponseFormat = "json_schema" | "json_object";

const OPENAI_TRANSIENT_RETRY_DELAY_MS =
	process.env.NODE_ENV === "test" ? 0 : 1500;

export type RawLlmCallOptions = CallSupervisorOptions & {
	jsonSchema?: { name: string; schema: unknown };
	label: string;
	normalizedRequest?: NormalizedSupervisorLlmRequest;
};

export async function callProvider(input: {
	provider: string;
	systemPrompt: string;
	userPrompt: string;
	options: RawLlmCallOptions;
	signal: AbortSignal;
	setProviderDebug: (value: Record<string, unknown>) => void;
}): Promise<ProviderCallResult> {
	const settings = readStructuredLlmProviderSettings();
	const isEnabled = (
		key: Parameters<typeof getStructuredLlmBoolSetting>[1],
		fallback: boolean,
	) => getStructuredLlmBoolSetting(settings, key, fallback);
	const provider = providerAdapterKey(
		input.options.normalizedRequest?.providerId ?? input.provider,
	);

	try {
		return await dispatchStructuredLlmProvider({
			provider,
			adapters: {
				azure: () => callAzureProvider(input, isEnabled, settings),
				openai: () => callOpenAIProvider(input, isEnabled, settings),
				bedrock: () => callBedrockProvider(input, isEnabled, settings),
				codex: () => callCodexProvider(input, isEnabled, settings),
				fixture: async () => callFixtureProvider(input),
			},
			onUnsupported: () => {
				throw new StructuredProviderError({
					kind: "invalid_request",
					retryable: false,
					message: `Unsupported LLM provider: ${input.provider}`,
				});
			},
		});
	} catch (error) {
		if (
			error instanceof Error &&
			error.name === "ProviderActivityRejectedError"
		) {
			throw error;
		}
		throw normalizeStructuredProviderError(error);
	}
}

export async function callProviderToolTurn(input: {
	provider: string;
	messages: ProviderToolMessage[];
	tools: ProviderToolDefinition[];
	systemPrompt: string;
	userPrompt: string;
	options: RawToolTurnCallOptions;
	signal: AbortSignal;
	setProviderDebug: (value: Record<string, unknown>) => void;
}): Promise<ProviderToolTurnResult> {
	await authorizeStructuredProviderCall(input.options);
	if (
		input.options.taskId &&
		hasFixtureProviderToolTurns(
			input.options.taskId,
			input.options.role === "implementation" ? "implementation" : "default",
		)
	) {
		return callFixtureProviderToolTurn({
			taskId: input.options.taskId,
			systemPrompt: input.systemPrompt,
			userPrompt: input.userPrompt,
			messages: input.messages,
			setProviderDebug: input.setProviderDebug,
			scope:
				input.options.role === "implementation" ? "implementation" : "default",
		});
	}
	const settings = readStructuredLlmProviderSettings();
	const isEnabled = (
		key: Parameters<typeof getStructuredLlmBoolSetting>[1],
		fallback: boolean,
	) => getStructuredLlmBoolSetting(settings, key, fallback);
	const provider = providerAdapterKey(
		input.options.normalizedRequest.providerId ?? input.provider,
	);

	try {
		return await dispatchStructuredLlmProvider({
			provider,
			adapters: {
				openai: () => callOpenAIProviderToolTurn(input, isEnabled, settings),
				azure: () => callAzureProviderToolTurn(input, isEnabled, settings),
				bedrock: () => callBedrockProviderToolTurn(input, isEnabled, settings),
				codex: () => callCodexProviderToolTurn(input, isEnabled, settings),
				fixture: async () =>
					callFixtureProviderToolTurn({
						taskId: input.options.taskId ?? "",
						systemPrompt: input.systemPrompt,
						userPrompt: input.userPrompt,
						messages: input.messages,
						setProviderDebug: input.setProviderDebug,
					}),
			},
			onUnsupported: async (unsupportedProvider) => {
				const providerDebug = {
					provider: unsupportedProvider,
					providerEndpointId:
						input.options.normalizedRequest.providerEndpointId ?? null,
					mode: "provider_native_tools",
					supported: false,
				};
				input.setProviderDebug(providerDebug);
				return {
					type: "unsupported",
					reason: `Provider does not support native tool turn runtime yet: ${unsupportedProvider}`,
					providerDebug,
				};
			},
		});
	} catch (error) {
		throw normalizeStructuredProviderError(error);
	}
}

async function callOpenAIProviderToolTurn(
	input: Parameters<typeof callProviderToolTurn>[0],
	isEnabled: (
		key: Parameters<typeof getStructuredLlmBoolSetting>[1],
		fallback: boolean,
	) => boolean,
	settings: ReturnType<typeof readStructuredLlmProviderSettings>,
): Promise<ProviderToolTurnResult> {
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
		input.options.normalizedRequest.endpoint ||
		endpointConfig?.baseUrl ||
		getStructuredLlmSetting(
			settings,
			"OPENAI_BASE_URL",
			"https://api.openai.com/v1",
		);
	const model =
		input.options.normalizedRequest.modelOrDeployment ||
		endpointConfig?.models[0] ||
		getStructuredLlmSetting(settings, "OPENAI_MODEL", "gpt-4o-mini");
	const reasoningEffort = toOpenAIReasoningEffort(
		input.options.normalizedRequest.thinkingDepth,
	);
	const apiKeyRequired = !endpointConfig || endpointConfig.kind === "openai";
	if (apiKeyRequired && !apiKey) {
		throw new StructuredProviderError({
			kind: "authentication",
			retryable: false,
			message: "OpenAI API key is not configured in environment variables.",
		});
	}

	const url = `${baseURL.replace(/\/+$/, "")}/chat/completions`;
	const requestInit: RequestInit & { timeout: false } = {
		method: "POST",
		signal: input.signal,
		timeout: false,
		headers: buildOpenAICompatibleHeaders(apiKey),
		body: JSON.stringify({
			model,
			messages: toOpenAIToolMessages(input.messages),
			tools: input.tools.map(toOpenAIToolDefinition),
			tool_choice: input.options.toolChoice ?? "auto",
			...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
		}),
	};
	const response = await fetch(url, requestInit);

	if (!response.ok) {
		const errorText = await readBoundedProviderResponseText(response);
		throw providerHttpError({
			provider: "OpenAI",
			status: response.status,
			body: errorText,
			retryAfter: response.headers.get("retry-after"),
		});
	}

	const responseData = await readOpenAIToolTurnResponseJson(response, "OpenAI");
	const message = responseData.choices?.[0]?.message;
	const content = typeof message?.content === "string" ? message.content : "";
	const toolCalls = toProviderToolCalls({
		calls: message?.tool_calls ?? [],
		tools: input.tools,
		provider: "OpenAI",
		content,
		responseBody: JSON.stringify(responseData),
	});
	const providerDebug = {
		provider: "openai",
		providerEndpointId: endpointConfig?.id ?? null,
		mode: "provider_native_tools",
		status: response.status,
		model,
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
			provider: "openai",
			rawUsage: responseData.usage,
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

export async function retryOpenAITransientUnavailableOnce(input: {
	response: Response;
	input: Parameters<typeof callProvider>[0];
	fetchCompletion: (override: {
		responseFormat: OpenAIResponseFormat;
		stream: boolean;
		reason: string;
	}) => Promise<Response>;
	responseFormat: OpenAIResponseFormat;
	stream: boolean;
}): Promise<Response> {
	const errorText = await readBoundedProviderResponseText(input.response);
	if (!isOpenAITransientUnavailable(input.response.status)) {
		return new Response(errorText, {
			status: input.response.status,
			statusText: input.response.statusText,
			headers: input.response.headers,
		});
	}

	await emitOpenAITransientRetryEvents(input.input.options, {
		status: input.response.status,
		errorText,
		responseFormat: input.responseFormat,
		stream: input.stream,
		retryDelayMs: OPENAI_TRANSIENT_RETRY_DELAY_MS,
	});
	if (OPENAI_TRANSIENT_RETRY_DELAY_MS > 0) {
		await sleep(OPENAI_TRANSIENT_RETRY_DELAY_MS, input.input.signal);
	}
	return input.fetchCompletion({
		responseFormat: input.responseFormat,
		stream: input.stream,
		reason: "transient_unavailable_retry",
	});
}

async function readOpenAIToolTurnResponseJson(
	response: Response,
	provider: string,
): Promise<OpenAIChatCompletionResponse> {
	const body = await readBoundedProviderResponseText(response);
	try {
		return JSON.parse(body) as OpenAIChatCompletionResponse;
	} catch (error) {
		throw providerInvalidResponseError({ provider, body, cause: error });
	}
}

function isOpenAITransientUnavailable(status: number) {
	return status === 503;
}

function truncateProviderErrorText(value: string) {
	return value.length > 500 ? `${value.slice(0, 500)}...` : value;
}

async function sleep(ms: number, signal: AbortSignal) {
	await new Promise<void>((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		const timeout = setTimeout(resolve, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timeout);
				reject(signal.reason);
			},
			{ once: true },
		);
	});
}

async function emitOpenAITransientRetryEvents(
	options: CallSupervisorOptions,
	input: {
		status: number;
		errorText: string;
		responseFormat: OpenAIResponseFormat;
		stream: boolean;
		retryDelayMs: number;
	},
) {
	await emitSupervisorLlmDebugEvent(options, {
		type: "model.retry_scheduled",
		severity: "warning",
		message: `OpenAI provider returned transient ${input.status}; retrying the same request.`,
		data: {
			round: options.round ?? null,
			status: input.status,
			reason: "transient_unavailable",
			errorText: truncateProviderErrorText(input.errorText),
			responseFormat: input.responseFormat,
			stream: input.stream,
			retryDelayMs: input.retryDelayMs,
		},
	});
	await emitSupervisorLlmDebugEvent(options, {
		type: "model.retry_started",
		severity: "info",
		message: "OpenAI transient unavailable retry started.",
		data: { round: options.round ?? null, reason: "transient_unavailable" },
	});
}

export async function emitOpenAICompatibilityRetryEvents(
	options: CallSupervisorOptions,
	input: {
		reason: "transport_error" | "stream_read_error";
		errorMessage: string;
		fromResponseFormat: OpenAIResponseFormat;
		fromStream: boolean;
	},
) {
	await emitSupervisorLlmDebugEvent(options, {
		type: "model.retry_scheduled",
		severity: "warning",
		message:
			"OpenAI-compatible local endpoint failed during structured chat completion; retrying with non-stream json_object.",
		data: {
			round: options.round ?? null,
			reason: input.reason,
			errorMessage: input.errorMessage,
			fromResponseFormat: input.fromResponseFormat,
			fromStream: input.fromStream,
			retryResponseFormat: "json_object",
			retryStream: false,
		},
	});
	await emitSupervisorLlmDebugEvent(options, {
		type: "model.retry_started",
		severity: "info",
		message: "OpenAI-compatible local json_object non-stream retry started.",
		data: { round: options.round ?? null, reason: input.reason },
	});
}
