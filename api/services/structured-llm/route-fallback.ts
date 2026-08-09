import {
	emitSupervisorLlmDebugEvent,
	ProviderActivityRejectedError,
} from "./events";
import { StructuredLlmTimeoutError } from "./json";
import { StructuredProviderError } from "./provider-failure";
import type {
	CallSupervisorOptions,
	NormalizedSupervisorLlmRequest,
} from "./types";

export function shouldTryStructuredLlmRouteFallback(error: unknown) {
	if (error instanceof ProviderActivityRejectedError) return false;
	if (error instanceof StructuredLlmTimeoutError) return true;
	if (error instanceof StructuredProviderError) return error.retryable;
	return false;
}

export async function emitStructuredLlmRouteFallbackStarted(
	options: CallSupervisorOptions,
	from: NormalizedSupervisorLlmRequest,
	to: NormalizedSupervisorLlmRequest,
	error: unknown,
) {
	const errorMessage = error instanceof Error ? error.message : String(error);
	const failure = summarizeFailureForEvent(error);
	await emitSupervisorLlmDebugEvent(options, {
		type: "model.route_fallback_scheduled",
		severity: "warning",
		message: `Structured LLM provider failed; retrying with role route fallback ${to.providerEndpointId ?? to.providerId}.`,
		data: {
			round: options.round ?? null,
			reason: failure.reason,
			errorMessage,
			failure,
			from: summarizeRouteForEvent(from),
			to: summarizeRouteForEvent(to),
		},
	});
	await emitSupervisorLlmDebugEvent(options, {
		type: "model.route_fallback_started",
		severity: "info",
		message: `Structured LLM role route fallback started. provider=${to.providerId} round=${options.round ?? "unknown"}`,
		data: {
			round: options.round ?? null,
			reason: failure.reason,
			failure,
			from: summarizeRouteForEvent(from),
			to: summarizeRouteForEvent(to),
		},
	});
}

export async function emitStructuredLlmRouteFallbackUnavailable(
	options: CallSupervisorOptions,
	request: NormalizedSupervisorLlmRequest,
	error: unknown,
) {
	if (!request.role) return;
	const failure = summarizeFailureForEvent(error);
	await emitSupervisorLlmDebugEvent(options, {
		type: "model.route_fallback_unavailable",
		severity: "warning",
		message:
			"Structured LLM provider failed and no role route fallback was available.",
		data: {
			round: options.round ?? null,
			code: "NO_PROVIDER_FALLBACK_CONFIGURED",
			reason: failure.reason,
			errorMessage: error instanceof Error ? error.message : String(error),
			failure,
			route: summarizeRouteForEvent(request),
		},
	});
}

function summarizeFailureForEvent(error: unknown) {
	if (error instanceof StructuredProviderError) {
		return {
			reason: `provider_${error.kind}`,
			kind: error.kind,
			code: error.code,
			httpStatus: error.httpStatus,
			retryable: error.retryable,
			retryAfterMs: error.retryAfterMs,
		};
	}
	if (error instanceof StructuredLlmTimeoutError) {
		return {
			reason: "provider_timeout",
			kind: "timeout",
			code: "STRUCTURED_LLM_TIMEOUT",
			httpStatus: null,
			retryable: true,
			retryAfterMs: null,
		};
	}
	return {
		reason: "provider_unknown",
		kind: "unknown",
		code: null,
		httpStatus: null,
		retryable: false,
		retryAfterMs: null,
	};
}

function summarizeRouteForEvent(request: NormalizedSupervisorLlmRequest) {
	return {
		providerId: request.providerId,
		providerEndpointId: request.providerEndpointId ?? null,
		routeSource: request.routeSource ?? null,
		role: request.role ?? null,
		model: request.modelOrDeployment ?? null,
		thinkingDepth: request.thinkingDepth ?? null,
	};
}
