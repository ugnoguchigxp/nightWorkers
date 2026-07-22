import type { LlmRole as StructuredLlmRole } from "../../../shared/llm-role";
import type { TraceProvenance } from "../../../shared/schemas/trace-provenance.schema";
import type { StructuredProviderExecutionPolicy } from "../../modules/agentsShare";
import type {
	LlmPromptPartTokenEstimates,
	NormalizedLlmUsage,
} from "../llm-usage/types";
import type { RuntimeSessionStateStore } from "../runtime-session-state";
import type { StructuredLlmModelTarget } from "./settings";

export type StructuredLlmRouteSource = "override" | "primary" | "fallback";

export type StructuredLlmRoutePolicy = {
	disallowedProviderIds?: SupervisorProviderId[];
	skipUnreachableEndpoints?: boolean;
	endpointReadiness?: Record<
		string,
		StructuredLlmEndpointReadiness | undefined
	>;
};

export type StructuredLlmEndpointReadiness = {
	reachable: boolean | null;
	ok?: boolean | null;
	checkedAt?: string | null;
	message?: string | null;
};

export type CallSupervisorOptions = {
	tolerateSchemaFailure?: boolean;
	round?: 1 | 2;
	schemaFirst?: boolean;
	role?: StructuredLlmRole;
	routeOverride?: StructuredLlmModelTarget | null;
	routePolicy?: StructuredLlmRoutePolicy;
	emitEvent?: (event: SupervisorLlmDebugEvent) => Promise<void> | void;
	timeoutMs?: number;
	signal?: AbortSignal;
	workingDirectory?: string;
	taskId?: string;
	runId?: string | null;
	usageTrace?: TraceProvenance;
	promptPartTokenEstimates?: LlmPromptPartTokenEstimates;
	promptBudgetMetadata?: StructuredLlmPromptBudgetMetadata;
	runtimeSessionStore?: RuntimeSessionStateStore;
	executionPolicy?: StructuredProviderExecutionPolicy;
};

/** @deprecated Use StructuredLlmResultOptions with callStructuredLlmResult. */
export type StructuredJsonLlmOptions = Omit<
	CallSupervisorOptions,
	"schemaFirst" | "round"
> & {
	schemaName: string;
	schema: unknown;
};

export type StructuredLlmPromptBudgetMetadata = {
	modelContextWindowTokens: number;
	safePromptBudgetTokens: number;
	reservedOutputTokens: number;
	estimatedPromptTokensBefore: number;
	estimatedPromptTokensAfter: number;
	systemPromptLengthBefore: number;
	systemPromptLengthAfter: number;
	userPromptLengthBefore: number;
	userPromptLengthAfter: number;
	compressedSections: string[];
	droppedFields: string[];
	compressionProfile: string;
	budgetExceeded: boolean;
	criticalEvidencePreserved?: number;
	criticalEvidenceDropped?: number;
	recoveryDirectiveCount?: number;
	artifactProjection?: {
		version: number;
		target: string;
		digest: string;
		sectionBytes: Record<string, number>;
		sourceMessageIds: string[];
		sourceDigests: string[];
		sourceCount: number;
		deduplicatedSourceCount: number;
		questionnaireDecisionCount: number;
		initialPromptOccurrences: number;
		staleSourceRejectedCount: number;
	};
};

export type { StructuredLlmRole };

export type SupervisorProviderId =
	| "openai"
	| "azure-openai"
	| "azure"
	| "bedrock"
	| "codex"
	| "fixture"
	| "test";

export type SupervisorProviderClass =
	| "chat_completion"
	| "converse_message"
	| "fixture";

export type ProviderCapabilityPolicy = {
	allowProviderToolCalls: boolean;
	allowProviderFileWrites: boolean;
	allowProviderCommandExecution: boolean;
	allowProviderNetwork: boolean;
	requireStructuredOutput: boolean;
	rejectUnobservedProviderActivity: boolean;
};

export type NormalizedSupervisorLlmRequest = {
	callKind: "supervisor_decision" | "structured_artifact" | "fixture";
	providerId: SupervisorProviderId;
	providerClass: SupervisorProviderClass;
	providerEndpointId?: string | null;
	role?: StructuredLlmRole | null;
	routeSource?: StructuredLlmRouteSource | null;
	modelOrDeployment: string | null;
	thinkingDepth?: "low" | "medium" | "high" | "very_high" | null;
	endpoint: string | null;
	region: string | null;
	apiVersion: string | null;
	systemPrompt: string;
	userPrompt: string;
	jsonSchema?: { name: string; schema: unknown };
	capabilityPolicy: ProviderCapabilityPolicy;
	diagnostics: {
		label: string;
		round: 1 | 2 | null;
		artifactSchemaName?: string | null;
		sourceArtifactRef?: string | null;
		systemPromptLength: number;
		userPromptLength: number;
		role?: StructuredLlmRole | null;
		providerEndpointId?: string | null;
		routeSource?: StructuredLlmRouteSource | null;
		modelOrDeployment?: string | null;
		thinkingDepth?: "low" | "medium" | "high" | "very_high" | null;
		routeDiagnostics?: string[];
	};
};

export type ProviderCallResult = {
	content: string;
	usage: NormalizedLlmUsage;
	model?: string | null;
	providerDebug?: Record<string, unknown>;
};

export type SupervisorLlmDebugEvent = {
	type:
		| "model.request_started"
		| "model.provider_activity_detected"
		| "model.provider_tool_call_detected"
		| "model.provider_activity_rejected"
		| "model.retry_scheduled"
		| "model.retry_started"
		| "model.route_fallback_scheduled"
		| "model.route_fallback_started"
		| "model.route_fallback_unavailable"
		| "model.response_delta"
		| "model.response_finished"
		| "model.response_parse_failed"
		| "model.response_repaired";
	severity: "debug" | "info" | "warning" | "error";
	message: string;
	data?: Record<string, unknown>;
};

export type StructuredLlmCallUsage = {
	provider: string | null;
	model: string | null;
	inputTokens: number | null;
	cachedInputTokens: number | null;
	outputTokens: number | null;
	reasoningOutputTokens: number | null;
	totalTokens: number | null;
	usageMode: "measured" | "estimated" | null;
	durationMs: number | null;
};
