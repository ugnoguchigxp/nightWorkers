import type {
	ProjectExplorationCatalogPilotSettings,
	ProjectExplorationCatalogRunPin,
} from "../../../../shared/schemas/project-exploration-catalog.schema";
import { getCurrentSettings } from "../../../routes/settings";
import {
	buildPlanModeSettingsSnapshot,
	readGeneralSettings,
} from "../../../services/settings/general-settings";
import { resolveStructuredLlmRoleRoute } from "../../../services/structured-llm/role-routing";
import { readStructuredLlmProviderSettings } from "../../../services/structured-llm/settings";
import {
	readRuntimeLaneConfigFromEnv,
	resolveRuntimeLane,
	resolveRuntimeLaneDefinition,
} from "../../codingAgent";
import { resolveProjectExplorationCatalogPin } from "../../ontology/exploration/project-exploration-source.service";
import { resolveBlueprintPlanningReadiness } from "../nightworkers.basic.service";
import {
	buildEffectiveLlmRoutingSnapshot,
	resolveRuntimeLaneForRoleRoute,
} from "./runtime-routing";
import type { StartTaskRunOptions } from "./start-task-run-types";

export async function prepareTaskRunRuntimeContext(input: {
	taskId: string;
	executionMode: NonNullable<StartTaskRunOptions["executionMode"]>;
	llmRouteOverride: Exclude<StartTaskRunOptions["routeOverride"], undefined>;
}) {
	const runtimeRole = "implementation" as const;
	const blueprintPlanningSnapshot = {
		blueprintPlanning: await resolveBlueprintPlanningReadiness(input.taskId),
	};
	const runtimeRoleLabel = "Implementation";
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
