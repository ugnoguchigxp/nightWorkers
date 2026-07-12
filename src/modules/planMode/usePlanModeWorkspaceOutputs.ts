import { useEffect, useMemo } from "react";
import type { ArtifactExportDescriptor } from "../nightworkers/artifactExport";
import type {
	PlanModeWorkspace,
	TaskMessage,
	WorkbenchArtifactContext,
} from "../nightworkers/types";
import type { PlanWorkspaceTab } from "../specification";
import type { PlanViewDecision } from "./PlanModeWorkspacePanels";
import {
	buildPlanModeArtifactContext,
	buildPlanModeExportDescriptor,
} from "./PlanModeWorkspaceViewer.model";

export function usePlanModeWorkspaceOutputs(input: {
	sessionId: string | null;
	activeTab: PlanWorkspaceTab;
	featurePlanMessage: TaskMessage | null;
	activeBlueprintMessage: TaskMessage | null;
	activeBlueprintSourceMessageId: string | null;
	activeDataModelMessage: TaskMessage | null;
	activeDedicatedMessage: TaskMessage | null;
	activeDedicatedArtifact:
		| PlanModeWorkspace["dedicatedViewArtifacts"][number]
		| null;
	readyQuestionnaireSessionId: string | null;
	workspace: PlanModeWorkspace | null;
	viewDecisions: PlanViewDecision[];
	activeQuestionnaireSession: unknown;
	onArtifactContextChange?: (context: WorkbenchArtifactContext | null) => void;
	onExportDescriptorChange?: (
		descriptor: ArtifactExportDescriptor | null,
	) => void;
}) {
	const activePlanModeArtifactContext =
		useMemo<WorkbenchArtifactContext | null>(
			() => buildPlanModeArtifactContext(input),
			[
				input.activeTab,
				input.activeBlueprintMessage,
				input.activeBlueprintSourceMessageId,
				input.activeDataModelMessage,
				input.activeDedicatedArtifact,
				input.activeDedicatedMessage,
				input.featurePlanMessage,
				input.readyQuestionnaireSessionId,
				input.sessionId,
				input,
			],
		);
	const activeExportDescriptor = useMemo<ArtifactExportDescriptor>(
		() =>
			buildPlanModeExportDescriptor({
				scopeId: input.sessionId,
				activeTab: input.activeTab,
				workspace: input.workspace,
				viewDecisions: input.viewDecisions,
				activeQuestionnaireSession: input.activeQuestionnaireSession as never,
				featurePlanMessage: input.featurePlanMessage,
				activeBlueprintMessage: input.activeBlueprintMessage,
				activeDataModelMessage: input.activeDataModelMessage,
				activeDedicatedMessage: input.activeDedicatedMessage,
			}),
		[
			input.activeBlueprintMessage,
			input.activeDataModelMessage,
			input.activeDedicatedMessage,
			input.activeQuestionnaireSession,
			input.activeTab,
			input.featurePlanMessage,
			input.sessionId,
			input.viewDecisions,
			input.workspace,
		],
	);
	useEffect(() => {
		input.onArtifactContextChange?.(activePlanModeArtifactContext);
		return () => input.onArtifactContextChange?.(null);
	}, [activePlanModeArtifactContext, input.onArtifactContextChange]);
	useEffect(() => {
		input.onExportDescriptorChange?.(activeExportDescriptor);
		return () => input.onExportDescriptorChange?.(null);
	}, [activeExportDescriptor, input.onExportDescriptorChange]);
	return { activePlanModeArtifactContext, activeExportDescriptor };
}
