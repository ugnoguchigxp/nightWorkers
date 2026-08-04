import type { ProjectMeta } from "../../../../shared/schemas/project-detail.schema";
import { digestText } from "../../../services/text-digest";
import type { RuntimePromptSnapshot } from "../../../services/todo-context";

type SecurityIntelligenceSnapshot = {
	securityOracle: {
		effectiveEnabled: boolean;
		configured: boolean;
		reason: string;
	};
	eligibility: {
		measuredSourceLoc: number | null;
		thresholdSourceLoc: number;
	};
	ontology: {
		toolProfile: string;
		reason: string;
	};
};

export function buildStandardTaskRunPromptSnapshot(input: {
	compiledPrompt: string;
	executionMode: NonNullable<RuntimePromptSnapshot["executionMode"]>;
	executionModeSource: RuntimePromptSnapshot["executionModeSource"];
	projectExplorationCatalog: unknown;
	planModeRequested: boolean;
	planModeSettingsSnapshot: RuntimePromptSnapshot["planModeSettingsSnapshot"];
	systemContextBinding: RuntimePromptSnapshot["systemContextBinding"];
	blueprintPlanningSnapshot: Record<string, unknown>;
	runtimeLane: NonNullable<RuntimePromptSnapshot["runtimeLane"]>;
	runtimeLaneResolution: NonNullable<
		RuntimePromptSnapshot["runtimeLaneResolution"]
	>;
	effectiveLlmRouting: unknown;
	reviewRun: unknown;
	reviewCorrection: unknown;
	projectMeta: Pick<ProjectMeta, "fileScale"> | null;
	securityIntelligence: SecurityIntelligenceSnapshot;
	ontologyMcpEnabled: boolean;
	registeredRepositoryPath: string;
	repositoryPath: string;
	taskTitle: string;
	taskDescription: string;
	implementationHandoffSnapshot: RuntimePromptSnapshot["implementationHandoff"];
	implementationPlanProvenance: RuntimePromptSnapshot["implementationPlanProvenance"];
	repositoryMaterialization: unknown;
	workspaceRuntimeEnvironmentKeys: string[];
}): RuntimePromptSnapshot {
	return {
		compiledPrompt: input.compiledPrompt,
		source: "task_prompt",
		degraded: false,
		executionMode: input.executionMode,
		executionPhase: input.executionMode,
		executionModeSource: input.executionModeSource,
		projectExplorationCatalog: input.projectExplorationCatalog,
		planModeRequested: input.planModeRequested,
		planModeClosed: !input.planModeRequested,
		planModeSettingsSnapshot: input.planModeSettingsSnapshot,
		systemContextBinding: input.systemContextBinding,
		...input.blueprintPlanningSnapshot,
		runtimeLane: input.runtimeLane,
		runtimeLaneResolution: input.runtimeLaneResolution,
		effectiveLlmRouting: input.effectiveLlmRouting,
		...(input.reviewRun ? { reviewRun: input.reviewRun } : {}),
		reviewCorrection: input.reviewCorrection,
		projectMeta: input.projectMeta,
		securityOracle: {
			enabled: input.securityIntelligence.securityOracle.effectiveEnabled,
			configured: input.securityIntelligence.securityOracle.configured,
			reason: input.securityIntelligence.securityOracle.reason,
			measuredSourceLoc:
				input.securityIntelligence.eligibility.measuredSourceLoc,
			thresholdSourceLoc:
				input.securityIntelligence.eligibility.thresholdSourceLoc,
		},
		ontologyMcp: {
			enabled: input.ontologyMcpEnabled,
			source: "project_code_size_tool_profile",
			fileScale: input.projectMeta?.fileScale.value ?? null,
			toolProfile: input.securityIntelligence.ontology.toolProfile,
			measuredSourceLoc:
				input.securityIntelligence.eligibility.measuredSourceLoc,
			thresholdSourceLoc:
				input.securityIntelligence.eligibility.thresholdSourceLoc,
			reason: input.securityIntelligence.ontology.reason,
		},
		request: {
			registeredRepositoryPath: input.registeredRepositoryPath,
			repositoryPath: input.repositoryPath,
			taskTitle: input.taskTitle,
			taskDescriptionDigest: digestText(input.taskDescription),
		},
		...(input.implementationHandoffSnapshot
			? { implementationHandoff: input.implementationHandoffSnapshot }
			: {}),
		...(input.implementationPlanProvenance
			? { implementationPlanProvenance: input.implementationPlanProvenance }
			: {}),
		repositoryMaterialization: input.repositoryMaterialization,
		workspaceRuntimeEnvironment: input.workspaceRuntimeEnvironmentKeys,
		result: {
			digest: digestText(input.compiledPrompt),
			charCount: input.compiledPrompt.length,
		},
	};
}
