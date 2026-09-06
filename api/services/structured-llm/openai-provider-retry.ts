import { emitSupervisorLlmDebugEvent } from "./events";
import { readBoundedProviderResponseText } from "./provider-failure";
import type { OpenAIResponseFormat } from "./providers";
import type { CallSupervisorOptions } from "./types";

const OPENAI_TRANSIENT_RETRY_DELAY_MS =
	process.env.NODE_ENV === "test" ? 0 : 1500;

export async function retryOpenAITransientUnavailableOnce(input: {
	response: Response;
	input: { options: CallSupervisorOptions; signal: AbortSignal };
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

	input.input.signal.throwIfAborted();
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
	input.input.signal.throwIfAborted();
	return input.fetchCompletion({
		responseFormat: input.responseFormat,
		stream: input.stream,
		reason: "transient_unavailable_retry",
	});
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
		const abort = () => {
			clearTimeout(timeout);
			reject(signal.reason);
		};
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", abort);
			resolve();
		}, ms);
		signal.addEventListener("abort", abort, { once: true });
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
