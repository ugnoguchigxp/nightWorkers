import { emitSupervisorLlmDebugEvent } from "./events";
import { StructuredLlmTimeoutError } from "./json";
import { StructuredProviderError } from "./provider-failure";
import type { RawLlmCallOptions } from "./providers";
import type { NormalizedSupervisorLlmRequest } from "./types";

export function structuredLlmRequestPhase(
	role: NormalizedSupervisorLlmRequest["role"],
) {
	if (role === "evaluation") return "evaluation";
	if (role === "plan") return "plan_generation";
	if (role === "implementation") return "implementation";
	if (role === "review") return "review";
	return "general";
}

export async function emitStructuredLlmRequestFailed(input: {
	options: RawLlmCallOptions;
	request: NormalizedSupervisorLlmRequest;
	requestId: string;
	startedAt: number;
	error: unknown;
	failureKindOverride?: string;
}) {
	const structuredFailure =
		input.error instanceof StructuredProviderError ? input.error : null;
	await emitSupervisorLlmDebugEvent(input.options, {
		type: "model.request_failed",
		severity: "error",
		message: `Supervisor LLM request failed. provider=${input.request.providerId} role=${input.request.role ?? "unknown"}`,
		data: {
			requestId: input.requestId,
			phase: structuredLlmRequestPhase(input.request.role),
			provider: input.request.providerId,
			providerEndpointId: input.request.providerEndpointId ?? null,
			providerEndpointName:
				input.request.diagnostics.providerEndpointName ?? null,
			role: input.request.role ?? null,
			routeSource: input.request.routeSource ?? null,
			model: input.request.modelOrDeployment ?? null,
			targetDigest: input.request.targetDigest ?? null,
			thinkingDepth: input.request.thinkingDepth ?? null,
			label: input.options.label,
			durationMs: Date.now() - input.startedAt,
			failureKind:
				structuredFailure?.kind ??
				(input.error instanceof StructuredLlmTimeoutError
					? "timeout"
					: (input.failureKindOverride ?? "unknown")),
			retryable:
				structuredFailure?.retryable ??
				input.error instanceof StructuredLlmTimeoutError,
			code: structuredFailure?.code ?? null,
			httpStatus: structuredFailure?.httpStatus ?? null,
			errorMessage:
				input.error instanceof Error
					? input.error.message
					: String(input.error),
		},
	});
}
