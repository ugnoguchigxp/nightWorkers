import {
	emitSupervisorLlmDebugEvent,
	ProviderActivityRejectedError,
} from "./events";
import { StructuredLlmTimeoutError } from "./json";
import type {
	CallSupervisorOptions,
	NormalizedSupervisorLlmRequest,
} from "./types";

export function shouldTryStructuredLlmRouteFallback(error: unknown) {
	if (error instanceof ProviderActivityRejectedError) return false;
	if (error instanceof StructuredLlmTimeoutError) return true;
	if (!(error instanceof Error)) return false;
	if (error.name === "AbortError") return true;
	const message = error.message.toLowerCase();
	return (
		message.includes("operation was aborted") ||
		message.includes("fetch failed") ||
		message.includes("network") ||
		message.includes("econnreset") ||
		message.includes("etimedout") ||
		message.includes("econnrefused") ||
		message.includes("socket hang up") ||
		/status\s+(429|500|502|503|504)/i.test(error.message)
	);
}

export async function emitStructuredLlmRouteFallbackStarted(
	options: CallSupervisorOptions,
	from: NormalizedSupervisorLlmRequest,
	to: NormalizedSupervisorLlmRequest,
	error: unknown,
) {
	const errorMessage = error instanceof Error ? error.message : String(error);
	await emitSupervisorLlmDebugEvent(options, {
		type: "model.route_fallback_scheduled",
		severity: "warning",
		message: `Structured LLM provider failed; retrying with role route fallback ${to.providerEndpointId ?? to.providerId}.`,
		data: {
			round: options.round ?? null,
			reason: "provider_transport_error",
			errorMessage,
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
			reason: "provider_transport_error",
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
	await emitSupervisorLlmDebugEvent(options, {
		type: "model.route_fallback_unavailable",
		severity: "warning",
		message:
			"Structured LLM provider failed and no role route fallback was available.",
		data: {
			round: options.round ?? null,
			code: "NO_PROVIDER_FALLBACK_CONFIGURED",
			reason: "provider_transport_error",
			errorMessage: error instanceof Error ? error.message : String(error),
			route: summarizeRouteForEvent(request),
		},
	});
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
