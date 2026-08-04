import type {
	ProjectExplorationCatalogPilotSettings,
	ProjectExplorationCatalogRunPin,
} from "../../../../shared/schemas/project-exploration-catalog.schema";
import { getCurrentSettings } from "../../../routes/settings";
import type { StateCardProjection } from "../../../services/conversation-context/state-card-projection";
import type { ConversationContextSnapshotRecord } from "../../../services/conversation-context/types";
import {
	buildPlanModeSettingsSnapshot,
	readGeneralSettings,
} from "../../../services/settings/general-settings";
import {
	resolveStructuredLlmRoleRoute,
	resolveStructuredLlmRoleRouteCandidates,
} from "../../../services/structured-llm/role-routing";
import {
	readStructuredLlmProviderSettings,
	type StructuredLlmModelTarget,
	type StructuredLlmProviderSettings,
} from "../../../services/structured-llm/settings";
import type { RuntimePromptSnapshot } from "../../../services/todo-context";
import {
	readRuntimeLaneConfigFromEnv,
	resolveCodingAgentRuntimeRole,
	resolveRuntimeLane,
	resolveRuntimeLaneDefinition,
} from "../../codingAgent";
import { resolveProjectExplorationCatalogPin } from "../../ontology/exploration/project-exploration-source.service";
import { resolveBlueprintPlanningReadiness } from "../nightworkers.planning-helpers.service";
import {
	buildEffectiveLlmRoutingSnapshot,
	resolveRuntimeLaneForRoleRoute,
} from "./runtime-routing";
import type { StartTaskRunOptions } from "./start-task-run-types";

export function buildRuntimeConversationContextSnapshot(input: {
	snapshot: ConversationContextSnapshotRecord | null;
	stateCardText: string;
	projection: StateCardProjection;
	usage: NonNullable<
		NonNullable<RuntimePromptSnapshot["conversationContext"]>["usage"]
	>;
}): NonNullable<RuntimePromptSnapshot["conversationContext"]> {
	const common = {
		stateCardIncluded: Boolean(input.stateCardText),
		...(input.stateCardText ? { stateCardText: input.stateCardText } : {}),
		projection: input.projection,
		usage: input.usage,
	};
	return input.snapshot
		? {
				...common,
				snapshotId: input.snapshot.id,
				version: input.snapshot.version,
				tokenEstimate: input.snapshot.tokenEstimate,
				snapshotJson: input.snapshot.snapshotJson,
			}
		: common;
}

export async function prepareTaskRunRuntimeContext(input: {
	taskId: string;
	executionMode: NonNullable<StartTaskRunOptions["executionMode"]>;
	llmRouteOverride: Exclude<StartTaskRunOptions["routeOverride"], undefined>;
	planModeRequested: boolean;
}) {
	const runtimeRole =
		input.executionMode === "review"
			? ("review" as const)
			: resolveCodingAgentRuntimeRole(input.planModeRequested);
	const blueprintPlanningSnapshot =
		input.executionMode === "review"
			? {}
			: {
					blueprintPlanning: await resolveBlueprintPlanningReadiness(
						input.taskId,
					),
				};
	const runtimeRoleLabel =
		runtimeRole === "review"
			? "Review"
			: input.planModeRequested
				? "Plan"
				: "Implementation";
	const settings = getCurrentSettings();
	const generalSettings = readGeneralSettings();
	const planModeSettingsSnapshot =
		buildPlanModeSettingsSnapshot(generalSettings);
	const llmUsageSettingsSnapshot = generalSettings.llmUsage ?? {
		promptPartObservabilityEnabled: true,
	};
	const baseRuntimeLaneResolution = resolveRuntimeLane({
		settingsRuntimeLane: settings.IMPLEMENTATION_RUNTIME_LANE,
		activeLlmProvider: settings.ACTIVE_LLM_PROVIDER,
		codexEnabled: settings.CODEX_ENABLED,
		...readRuntimeLaneConfigFromEnv(),
	});
	const structuredLlmSettings = readStructuredLlmProviderSettings();
	const runtimeLlmRoute =
		input.executionMode === "review"
			? resolveReviewCodexRoleRoute({
					settings: structuredLlmSettings,
					override: input.llmRouteOverride,
				})
			: resolveStructuredLlmRoleRoute({
					role: runtimeRole,
					settings: structuredLlmSettings,
					override: input.llmRouteOverride,
				});
	const runtimeLaneResolution =
		input.executionMode === "review"
			? {
					lane: "codex-sdk" as const,
					workerKind: "codex-agent" as const,
					source: "role_route" as const,
					diagnostics: [
						...baseRuntimeLaneResolution.diagnostics,
						{
							level: "info" as const,
							message: runtimeLlmRoute
								? `Review role uses Codex SDK route ${runtimeLlmRoute.providerEndpointId}/${runtimeLlmRoute.model}.`
								: "Review role uses the default Codex SDK configuration.",
						},
					],
				}
			: resolveRuntimeLaneForRoleRoute(
					baseRuntimeLaneResolution,
					runtimeLlmRoute,
				);
	const runtimeLaneDefinition = resolveRuntimeLaneDefinition(
		runtimeLaneResolution.lane,
	);
	const effectiveLlmRouting = buildEffectiveLlmRoutingSnapshot({
		activeRole: runtimeRole,
		executionMode: input.executionMode,
		settings: structuredLlmSettings,
		activeRoute: runtimeLlmRoute,
		override: input.llmRouteOverride ?? null,
	});
	return {
		runtimeRole,
		blueprintPlanningSnapshot,
		runtimeRoleLabel,
		planModeSettingsSnapshot,
		llmUsageSettingsSnapshot,
		runtimeLlmRoute,
		runtimeLaneResolution,
		runtimeLaneDefinition,
		effectiveLlmRouting,
	};
}

export function resolveReviewCodexRoleRoute(input: {
	settings: StructuredLlmProviderSettings;
	override?: StructuredLlmModelTarget | null;
}) {
	const candidates = resolveStructuredLlmRoleRouteCandidates({
		role: "review",
		settings: input.settings,
		override: input.override,
	});
	const codexCandidate = candidates.find(
		(candidate) => candidate.providerId === "codex",
	);
	if (codexCandidate || !input.override) return codexCandidate ?? null;
	return (
		resolveStructuredLlmRoleRouteCandidates({
			role: "review",
			settings: input.settings,
		}).find((candidate) => candidate.providerId === "codex") ?? null
	);
}

export async function resolveRunProjectExplorationCatalogPin(input: {
	registeredRepoRoot: string;
	executionRoot: string;
	expectedHead: string | null;
	preExistingDirtyPaths: string[];
	settings: ProjectExplorationCatalogPilotSettings;
	runtimeLane: string;
	resolvePin?: typeof resolveProjectExplorationCatalogPin;
}): Promise<ProjectExplorationCatalogRunPin> {
	try {
		return await (input.resolvePin ?? resolveProjectExplorationCatalogPin)({
			registeredRepoRoot: input.registeredRepoRoot,
			executionRoot: input.executionRoot,
			expectedHead: input.expectedHead,
			preExistingDirtyPaths: input.preExistingDirtyPaths,
			settings: input.settings,
			runtimeLane: input.runtimeLane,
		});
	} catch {
		return {
			version: 2,
			available: false,
			reason: "mcp_failed",
			retryable: true,
		};
	}
}
