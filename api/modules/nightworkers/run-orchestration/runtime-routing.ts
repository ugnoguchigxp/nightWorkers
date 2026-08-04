import { LLM_ROLE_ORDER } from "../../../../shared/llm-role";
import { logger } from "../../../lib/logger";
import {
	getLatestConversationContextForTask,
	type RefreshConversationContextInput,
	refreshConversationContextSnapshot,
} from "../../../services/conversation-context";
import {
	isConversationContextBuildOnIdleEnabled,
	isConversationContextStateCardEnabled,
} from "../../../services/conversation-context/flags";
import { RuntimeSessionStateStore } from "../../../services/runtime-session-state";
import { providerAdapterKey } from "../../../services/structured-llm/request";
import {
	type ResolvedStructuredLlmRoute,
	resolveStructuredLlmRoleRouteCandidates,
	structuredLlmRouteKey,
} from "../../../services/structured-llm/role-routing";
import type {
	StructuredLlmModelTarget,
	StructuredLlmProviderSettings,
	StructuredLlmRole,
} from "../../../services/structured-llm/settings";
import { type JobType, jobTypes } from "../../../services/supervisor/prompt";
import type {
	AgentExecutionMode,
	RuntimeLaneResolution,
} from "../../codingAgent";
import { getOrCreateReviewRecommendation } from "../../review/review-recommendation.service";
import * as repo from "../nightworkers.repository";
import { toErrorMessage, toRecord } from "./utils";

export const IMPLEMENTATION_PHASE_PREAMBLE = [
	"実装フェーズに移行しました。",
	"plan mode はこの時点で終了です。",
	"ここからは計画相談ではなく、実装・検証・必要な修正・closeout まで最後までやり切ってください。",
	"Todo を作成・更新する場合も、この実装フェーズ前提で進めてください。",
].join("\n");

function injectImplementationPhaseContext(latestUserMessage: string) {
	return `${IMPLEMENTATION_PHASE_PREAMBLE}\n\n${latestUserMessage}`.trim();
}

export function resolveRuntimeLaneForRoleRoute(
	fallback: RuntimeLaneResolution,
	route: ResolvedStructuredLlmRoute | null,
): RuntimeLaneResolution {
	if (!route) return fallback;
	const lane = route.providerId === "codex" ? "codex-sdk" : "native-api-runner";
	const roleLabel =
		route.role === "implementation" ? "Implementation" : `${route.role}`;
	return {
		lane,
		workerKind: lane === "codex-sdk" ? "codex-agent" : "native-local",
		source: "role_route",
		diagnostics: [
			...fallback.diagnostics,
			{
				level: "info",
				message:
					route.role === "implementation"
						? `Implementation role route selected ${lane} for ${route.providerEndpointId}/${route.model} via ${route.source}.`
						: `${roleLabel} role route selected ${lane} for ${route.providerEndpointId}/${route.model} via ${route.source}.`,
			},
			...(route.providerId !== "codex" && fallback.lane === "codex-sdk"
				? [
						{
							level: "warning" as const,
							message:
								"IMPLEMENTATION_RUNTIME_LANE requested codex-sdk, but the implementation role route is an API provider. Native/API implementation uses native-api-runner for this run.",
						},
					]
				: []),
			...(route.providerId === "codex" && fallback.lane !== "codex-sdk"
				? [
						{
							level: "warning" as const,
							message:
								"Implementation role route points at a Codex provider endpoint. Use a non-Codex implementation route to stay on native/API lane.",
						},
					]
				: []),
		],
	};
}

function summarizeResolvedRoute(route: ResolvedStructuredLlmRoute) {
	return {
		role: route.role,
		providerEndpointId: route.providerEndpointId,
		providerId: route.providerId,
		providerAdapter: providerAdapterKey(route.providerId),
		endpointName: route.endpoint.name,
		endpointKind: route.endpoint.kind,
		model: route.model,
		thinkingDepth: route.thinkingDepth || null,
		source: route.source,
		routeKey: structuredLlmRouteKey(route),
		diagnostics: route.diagnostics,
	};
}

const STRUCTURED_LLM_ROLES: StructuredLlmRole[] = [...LLM_ROLE_ORDER];

export function buildEffectiveLlmRoutingSnapshot(input: {
	activeRole: StructuredLlmRole;
	executionMode: AgentExecutionMode;
	settings: StructuredLlmProviderSettings;
	activeRoute: ResolvedStructuredLlmRoute | null;
	override: StructuredLlmModelTarget | null;
}) {
	const roles = Object.fromEntries(
		STRUCTURED_LLM_ROLES.map((role) => {
			const candidates = resolveStructuredLlmRoleRouteCandidates({
				role,
				settings: input.settings,
				override: role === input.activeRole ? input.override : null,
			}).map(summarizeResolvedRoute);
			return [
				role,
				{
					primary:
						candidates.find((candidate) => candidate.source === "primary") ??
						null,
					fallbacks: candidates.filter(
						(candidate) => candidate.source === "fallback",
					),
					override:
						candidates.find((candidate) => candidate.source === "override") ??
						null,
					candidates,
				},
			];
		}),
	);
	return {
		activeRole: input.activeRole,
		executionMode: input.executionMode,
		settingsRevision: input.settings.settingsRevision ?? null,
		endpointIdSchemaVersion: input.settings.endpointIdSchemaVersion ?? null,
		routePolicyDigest: "native-api:no-codex:explicit-only",
		active: input.activeRoute
			? summarizeResolvedRoute(input.activeRoute)
			: null,
		implementation:
			input.activeRoute?.role === "implementation"
				? summarizeResolvedRoute(input.activeRoute)
				: null,
		plan:
			input.activeRoute?.role === "plan"
				? summarizeResolvedRoute(input.activeRoute)
				: null,
		review:
			input.activeRoute?.role === "review"
				? summarizeResolvedRoute(input.activeRoute)
				: null,
		roles,
		override: input.override,
	};
}

export async function safelyRefreshConversationContext(
	input: RefreshConversationContextInput,
) {
	if (!isConversationContextBuildOnIdleEnabled()) return;
	try {
		await refreshConversationContextSnapshot(input);
	} catch (error) {
		logger.warn(
			{
				error: toErrorMessage(error),
				taskId: input.taskId,
				runId: input.runId,
			},
			"conversation context refresh failed",
		);
	}
}

export async function safelyCreateReviewRecommendation(input: {
	taskId: string;
	runId: string;
}) {
	try {
		const recommendation = await getOrCreateReviewRecommendation(input.runId);
		if (!recommendation || recommendation.level === "none") return;
		await repo.createRunEvent({
			version: 1,
			runId: input.runId,
			taskId: input.taskId,
			timestamp: new Date().toISOString(),
			type: "review.recommendation_created",
			severity: recommendation.level === "required" ? "warning" : "info",
			actor: "system",
			message: `Review recommendation created: ${recommendation.level}`,
			data: {
				recommendationId: recommendation.id,
				level: recommendation.level,
				defaultAction: recommendation.defaultAction,
				reasons: recommendation.reasons.map((reason) => ({
					code: reason.code,
					severity: reason.severity,
					label: reason.label,
				})),
			},
		});
	} catch (error) {
		logger.warn(
			{
				error: toErrorMessage(error),
				taskId: input.taskId,
				runId: input.runId,
			},
			"review recommendation creation failed",
		);
		await repo.createRunEvent({
			version: 1,
			runId: input.runId,
			taskId: input.taskId,
			timestamp: new Date().toISOString(),
			type: "review.recommendation_failed",
			severity: "warning",
			actor: "system",
			message: "Review recommendation could not be created.",
			data: { error: toErrorMessage(error) },
		});
	}
}

export async function maybeLoadConversationStateCard(
	taskId: string,
	latestUserMessageId?: string | null,
) {
	if (!isConversationContextStateCardEnabled()) return null;
	try {
		const snapshot = await getLatestConversationContextForTask(taskId);
		if (
			snapshot?.latestUserMessageId &&
			snapshot.latestUserMessageId === latestUserMessageId
		) {
			return null;
		}
		return snapshot;
	} catch (error) {
		logger.warn(
			{
				error: toErrorMessage(error),
				taskId,
			},
			"conversation context load failed",
		);
		return null;
	}
}

export function resolveLatestJobTypeFromMessages(
	messages: Awaited<ReturnType<typeof repo.listTaskMessages>>,
): JobType | null {
	for (const message of [...messages].reverse()) {
		const metadata = toRecord(message.metadataJson);
		const selection =
			toRecord(metadata?.intakeJobSelection) ??
			toRecord(metadata?.jobSelection);
		const jobType =
			typeof selection?.jobType === "string" ? selection.jobType : null;
		if (isJobType(jobType)) return jobType;
	}
	return null;
}

function isJobType(value: unknown): value is JobType {
	return (
		typeof value === "string" && (jobTypes as readonly string[]).includes(value)
	);
}

function isImplementationHandoffMessage(
	message: Awaited<ReturnType<typeof repo.listTaskMessages>>[number],
	metadata: Record<string, unknown> | null,
) {
	if (message.messageType !== "markdown_document") return false;
	const intent = String(metadata?.intent || "").toLowerCase();
	return intent === "implementation_plan" || intent === "feature_plan";
}

export function findLatestImplementationHandoffMessage(
	messages: Awaited<ReturnType<typeof repo.listTaskMessages>>,
) {
	return [...messages].reverse().find((message) => {
		const metadata = toRecord(message.metadataJson);
		return isImplementationHandoffMessage(message, metadata);
	});
}

const IMPLEMENTATION_DESIGN_ARTIFACT_KINDS = [
	"blueprint",
	"data_model",
	"api_io_contract",
	"activity_flow",
	"sequence_flow",
	"user_flow",
	"zod_schema_design",
	"component_design",
] as const;

const IMPLEMENTATION_DESIGN_ARTIFACT_KIND_SET = new Set<string>(
	IMPLEMENTATION_DESIGN_ARTIFACT_KINDS,
);

export function findLatestImplementationDesignArtifacts(
	messages: Awaited<ReturnType<typeof repo.listTaskMessages>>,
	handoffMessage?: Awaited<ReturnType<typeof repo.listTaskMessages>>[number],
) {
	const sourceMessageIds = readImplementationHandoffSourceMessageIds(
		handoffMessage?.metadataJson,
	);
	const sourceMessageIdSet = sourceMessageIds.length
		? new Set(sourceMessageIds)
		: null;
	const latestByKind = new Map<
		string,
		Awaited<ReturnType<typeof repo.listTaskMessages>>[number]
	>();
	for (const message of messages) {
		if (sourceMessageIdSet && !sourceMessageIdSet.has(message.id)) continue;
		if (message.messageType !== "markdown_document") continue;
		const metadata = toRecord(message.metadataJson);
		const intent =
			typeof metadata?.intent === "string" ? metadata.intent : null;
		const view = typeof metadata?.view === "string" ? metadata.view : null;
		const kind = IMPLEMENTATION_DESIGN_ARTIFACT_KIND_SET.has(intent ?? "")
			? intent
			: metadata?.artifactKind === "plan_mode_dedicated_view" &&
					IMPLEMENTATION_DESIGN_ARTIFACT_KIND_SET.has(view ?? "")
				? view
				: intent === "app_blueprint" || intent === "mock_blueprint"
					? "blueprint"
					: null;
		if (kind) latestByKind.set(kind, message);
	}
	return IMPLEMENTATION_DESIGN_ARTIFACT_KINDS.flatMap((kind) => {
		const message = latestByKind.get(kind);
		return message ? [{ kind, message }] : [];
	});
}

function readImplementationHandoffSourceMessageIds(metadataJson: unknown) {
	const metadata = toRecord(metadataJson);
	const generation = toRecord(metadata?.generation);
	const context = toRecord(generation?.context);
	const inputProjection = toRecord(context?.inputProjection);
	return Array.isArray(inputProjection?.sourceMessageIds)
		? inputProjection.sourceMessageIds.filter(
				(value): value is string =>
					typeof value === "string" && value.length > 0,
			)
		: [];
}

export function buildCompiledPromptText(input: {
	task: NonNullable<Awaited<ReturnType<typeof repo.getTask>>>;
	lastUserMessage?: Awaited<ReturnType<typeof repo.listTaskMessages>>[number];
	implementationHandoffMessage?: Awaited<
		ReturnType<typeof repo.listTaskMessages>
	>[number];
}) {
	const userRequest =
		input.lastUserMessage?.content ||
		input.task.description ||
		input.task.objective ||
		"";
	const handoff = input.implementationHandoffMessage?.content?.trim();
	if (!handoff) return userRequest;
	if (!userRequest.trim()) return handoff;
	return [
		"<USER_REQUEST>",
		userRequest.trim(),
		"</USER_REQUEST>",
		"",
		"<IMPLEMENTATION_HANDOFF>",
		handoff,
		"</IMPLEMENTATION_HANDOFF>",
	].join("\n");
}

export function buildLatestRuntimeUserMessage(input: {
	fallback: string;
	lastUserMessage?: Awaited<ReturnType<typeof repo.listTaskMessages>>[number];
	implementationHandoffMessage?: Awaited<
		ReturnType<typeof repo.listTaskMessages>
	>[number];
}) {
	const latestUserText =
		input.lastUserMessage?.content?.trim() || input.fallback.trim();
	const handoff = input.implementationHandoffMessage?.content?.trim();
	if (!handoff) {
		return injectImplementationPhaseContext(latestUserText);
	}
	const hasDistinctUserRequest =
		Boolean(input.lastUserMessage?.content?.trim()) ||
		latestUserText !== handoff;
	const userRequestSection = hasDistinctUserRequest
		? ["<USER_REQUEST>", latestUserText, "</USER_REQUEST>", ""]
		: [];
	return injectImplementationPhaseContext(
		[
			...userRequestSection,
			"<IMPLEMENTATION_HANDOFF>",
			"直近の Implementation Plan / Draft Spec を主な作業入力として扱ってください。",
			"計画に不足や矛盾がある場合は、必要な確認・調査 tool を使ってから実装してください。",
			"",
			handoff,
			"</IMPLEMENTATION_HANDOFF>",
		].join("\n"),
	);
}

export async function loadCodexRuntimeResumeState(input: {
	taskId: string;
	repositoryId: string;
	executionMode: AgentExecutionMode;
	agentModeSessionId?: string | null;
}) {
	if (!input.agentModeSessionId) {
		return {
			kind: "codex_thread",
			status: "unavailable",
			executionMode: input.executionMode,
			reason: "agent_mode_session_unavailable",
		};
	}
	const store = new RuntimeSessionStateStore();
	const state = await store.getLatestRuntimeSessionStateForTask({
		taskId: input.taskId,
		agentModeSessionId: input.agentModeSessionId,
		repositoryId: input.repositoryId,
		runtimeLane: "codex-sdk",
		provider: "codex",
		executionMode: input.executionMode,
	});
	if (!state?.providerSessionId) {
		return {
			kind: "codex_thread",
			status: "unavailable",
			executionMode: input.executionMode,
		};
	}
	return {
		kind: "codex_thread",
		status: "available",
		stateId: state.id,
		sourceRunId: state.runId,
		providerThreadId: state.providerSessionId,
		executionMode: input.executionMode,
		model: state.model,
	};
}
