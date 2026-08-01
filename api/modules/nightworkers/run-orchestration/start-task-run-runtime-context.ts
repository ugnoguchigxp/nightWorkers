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
import { resolveStructuredLlmRoleRoute } from "../../../services/structured-llm/role-routing";
import { readStructuredLlmProviderSettings } from "../../../services/structured-llm/settings";
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
	const runtimeRole = resolveCodingAgentRuntimeRole(input.planModeRequested);
	const blueprintPlanningSnapshot = {
		blueprintPlanning: await resolveBlueprintPlanningReadiness(input.taskId),
	};
	const runtimeRoleLabel = input.planModeRequested ? "Plan" : "Implementation";
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
	const runtimeLlmRoute = resolveStructuredLlmRoleRoute({
		role: runtimeRole,
		settings: structuredLlmSettings,
		override: input.llmRouteOverride,
	});
	const runtimeLaneResolution = resolveRuntimeLaneForRoleRoute(
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
