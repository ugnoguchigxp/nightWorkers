import { callMissionPilotHost } from "../../backend/host-bindings";

export type ProviderToolDefinition = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
};

export type ProviderToolCall = {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
};

export type ProviderToolMessage =
	| { role: "system"; content: string }
	| { role: "user"; content: string }
	| { role: "assistant"; content: string; toolCalls?: ProviderToolCall[] }
	| { role: "tool"; toolCallId: string; content: string };

export type ProviderToolTurnResult =
	| {
			type: "supported";
			content: string;
			toolCalls: ProviderToolCall[];
			usage: Record<string, unknown>;
			model?: string | null;
			providerDebug?: Record<string, unknown>;
			requestId?: string;
			systemContextAudit?: readonly unknown[];
	  }
	| {
			type: "unsupported";
			reason: string;
			providerDebug?: Record<string, unknown>;
			requestId?: string;
			systemContextAudit?: readonly unknown[];
	  };

export type NormalizedSupervisorLlmRequest = {
	providerId: string;
	providerEndpointId?: string;
	model?: string;
	[key: string]: unknown;
};

export type StructuredProviderErrorLike = Error & {
	kind:
		| "transport"
		| "timeout"
		| "rate_limit"
		| "provider_capacity"
		| "authentication"
		| "permission"
		| "invalid_request"
		| "invalid_response"
		| "schema_invalid"
		| "schema_validation"
		| "revision_conflict"
		| "domain_precondition"
		| "outcome_unknown"
		| "resource_limit"
		| "provider_capability"
		| "cancelled"
		| "unknown";
	retryable: boolean;
	code?: string;
	httpStatus?: number | null;
	retryAfterMs?: number | null;
	attempt?: number;
	providerBody?: string | null;
	details?: Record<string, unknown>;
};

export const buildNormalizedSupervisorLlmRequestCandidates = (
	...args: unknown[]
): NormalizedSupervisorLlmRequest[] =>
	callMissionPilotHost(
		"buildNormalizedSupervisorLlmRequestCandidates",
		...args,
	);
export const callProviderToolTurn = (
	input: Record<string, unknown>,
): Promise<ProviderToolTurnResult> =>
	callMissionPilotHost("callProviderToolTurn", input);
export const normalizeStructuredProviderError = (
	error: unknown,
): StructuredProviderErrorLike =>
	callMissionPilotHost("normalizeStructuredProviderError", error);
export const providerAdapterKey = (providerId: string): string =>
	callMissionPilotHost("providerAdapterKey", providerId);
export const withStructuredProviderAttempt = (
	error: StructuredProviderErrorLike,
	attempt: number,
): StructuredProviderErrorLike =>
	callMissionPilotHost("withStructuredProviderAttempt", error, attempt);
