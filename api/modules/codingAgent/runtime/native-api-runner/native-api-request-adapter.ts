import {
	buildNormalizedSupervisorLlmRequestCandidates,
	providerAdapterKey,
} from "../../../../services/structured-llm/request";
import type { StructuredLlmModelTarget } from "../../../../services/structured-llm/settings";
import type {
	ProviderToolDefinition,
	ProviderToolMessage,
	RawToolTurnCallOptions,
} from "../../../../services/structured-llm/tool-calls";
import type { StructuredLlmRoutePolicy } from "../../../../services/structured-llm/types";
import type { SystemContextPromptAudit } from "../../../../systemContexts/catalog";
import { codingAgentProviderExecutionPolicy } from "../../adapters/coding-agent-provider.adapter";
import type { AgentRunContext } from "../types";
import { readNativeApiActiveRole } from "./native-api-route-context";
import {
	extractLatestNativeApiUserPrompt,
	extractNativeApiSystemContextAudit,
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
	systemContextAudit: readonly SystemContextPromptAudit[];
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
	const role = readNativeApiActiveRole(input.context);
	const systemPrompt = extractNativeApiSystemPrompt(input.history);
	const userPrompt = extractLatestNativeApiUserPrompt(input.history);
	const systemContextAudit = extractNativeApiSystemContextAudit(input.history);
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
		systemContextAudit,
		options: {
			label: "native_api_runner",
			role,
			routeOverride: input.routeOverride,
			routePolicy: input.routePolicy,
			timeoutMs: input.context.timeoutSeconds * 1000,
			taskId: input.context.taskId,
			runId: input.context.runId,
			workingDirectory: input.context.repoRoot,
			executionPolicy: codingAgentProviderExecutionPolicy,
			systemContextAudit,
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
