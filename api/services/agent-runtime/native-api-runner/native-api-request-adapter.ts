import {
	buildNormalizedSupervisorLlmRequestCandidates,
	providerAdapterKey,
} from "../../structured-llm/request";
import type { StructuredLlmModelTarget } from "../../structured-llm/settings";
import type {
	ProviderToolDefinition,
	ProviderToolMessage,
	RawToolTurnCallOptions,
} from "../../structured-llm/tool-calls";
import type { StructuredLlmRoutePolicy } from "../../structured-llm/types";
import type { AgentRunContext } from "../types";
import {
	extractLatestNativeApiUserPrompt,
	extractNativeApiSystemPrompt,
	type NativeApiHistoryItem,
	projectNativeApiHistoryToProviderMessages,
} from "./native-api-tool-history";

export type NativeApiProviderRequest = {
	provider: string;
	messages: ProviderToolMessage[];
	tools: ProviderToolDefinition[];
	systemPrompt: string;
	userPrompt: string;
	options: RawToolTurnCallOptions;
};

export function buildNativeApiProviderRequest(input: {
	context: AgentRunContext;
	history: readonly NativeApiHistoryItem[];
	tools?: readonly ProviderToolDefinition[];
	routeOverride?: StructuredLlmModelTarget | null;
	routePolicy?: StructuredLlmRoutePolicy;
}): NativeApiProviderRequest {
	return buildNativeApiProviderRequests(input)[0];
}

export function buildNativeApiProviderRequests(input: {
	context: AgentRunContext;
	history: readonly NativeApiHistoryItem[];
	tools?: readonly ProviderToolDefinition[];
	routeOverride?: StructuredLlmModelTarget | null;
	routePolicy?: StructuredLlmRoutePolicy;
}): NativeApiProviderRequest[] {
	const role = "implementation" as const;
	const systemPrompt = extractNativeApiSystemPrompt(input.history);
	const userPrompt = extractLatestNativeApiUserPrompt(input.history);
	const normalizedRequests = buildNormalizedSupervisorLlmRequestCandidates({
		systemPrompt,
		userPrompt,
		label: "native_api_runner",
		role,
		routeOverride: input.routeOverride,
		routePolicy: input.routePolicy,
	});

	return normalizedRequests.map((normalizedRequest) => ({
		provider: providerAdapterKey(normalizedRequest.providerId),
		messages: projectNativeApiHistoryToProviderMessages(input.history),
		tools: [...(input.tools ?? [])],
		systemPrompt,
		userPrompt,
		options: {
			label: "native_api_runner",
			role,
			routeOverride: input.routeOverride,
			routePolicy: input.routePolicy,
			timeoutMs: input.context.timeoutSeconds * 1000,
			taskId: input.context.taskId,
			runId: input.context.runId,
			workingDirectory: input.context.repoRoot,
			normalizedRequest,
			toolChoice: "auto",
			attemptTimeoutMs: nativeApiAttemptTimeoutMs({
				timeoutMs: input.context.timeoutSeconds * 1000,
				providerEndpointId: normalizedRequest.providerEndpointId,
				providerId: normalizedRequest.providerId,
				routeSource: normalizedRequest.routeSource,
			}),
		},
	}));
}

function nativeApiAttemptTimeoutMs(input: {
	timeoutMs: number;
	providerEndpointId?: string | null;
	providerId: string;
	routeSource?: string | null;
}) {
	const routeDefault =
		input.providerId === "azure-openai" ? 120_000 : 1_800_000;
	const timeoutMs =
		Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
			? input.timeoutMs
			: routeDefault;
	return Math.max(1_000, Math.min(timeoutMs, routeDefault));
}
