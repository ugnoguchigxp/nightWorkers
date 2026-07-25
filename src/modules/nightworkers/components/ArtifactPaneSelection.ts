import { useMemo } from "react";
import { toDeepRecord } from "../../../../shared/json-record";
import { measureArtifactPerf } from "../artifactPerformance";
import type {
	ActivityArtifact,
	TaskMessage,
	WorkbenchArtifactRef,
} from "../types";
import {
	asArtifactRecord as asRecord,
	isMockBlueprintCandidate,
	parseArtifactContentJson,
} from "./ArtifactPane.controller";
import { buildArtifactVersions } from "./ArtifactPaneVersions";

export function useArtifactPaneSelection(input: {
	selectedArtifact: WorkbenchArtifactRef | null;
	taskMessages: TaskMessage[];
	activityArtifacts: ActivityArtifact[];
	versionArtifactId: string | null;
}) {
	const {
		selectedArtifact,
		taskMessages,
		activityArtifacts,
		versionArtifactId,
	} = input;
	const artifactVersions = useMemo(
		() =>
			measureArtifactPerf(
				"artifactPane.buildArtifactVersions",
				() =>
					buildArtifactVersions(
						selectedArtifact,
						taskMessages,
						activityArtifacts,
					),
				{
					artifactId: selectedArtifact?.id || null,
					taskMessageCount: taskMessages.length,
					activityArtifactCount: activityArtifacts.length,
				},
			),
		[activityArtifacts, selectedArtifact, taskMessages],
	);
	const currentVersionIndex = Math.max(
		0,
		artifactVersions.findIndex(
			(artifact) => artifact.id === (versionArtifactId || selectedArtifact?.id),
		),
	);
	const displayArtifact =
		artifactVersions[currentVersionIndex] || selectedArtifact;
	const displayArtifactId = displayArtifact?.id || null;
	const showDiff = displayArtifact?.kind === "diff";
	const showBlueprintWorkspace =
		displayArtifact?.kind === "plan_mode_workspace";
	const showReviewStatus = displayArtifact?.kind === "review_status";
	const showEvidenceCheck = displayArtifact?.kind === "evidence_check";
	const showBlueprint = displayArtifact?.kind === "app_blueprint";
	const showComponentDesign =
		displayArtifact?.kind === "component_design" ||
		displayArtifact?.kind === "design_delta";
	const taskMessageId =
		displayArtifact?.source.type === "task_message"
			? displayArtifact.source.messageId
			: null;
	const selectedMessage = useMemo(
		() =>
			taskMessageId
				? taskMessages.find((message) => message.id === taskMessageId) || null
				: null,
		[taskMessageId, taskMessages],
	);
	const artifactRowId =
		displayArtifact?.source.type === "artifact_row"
			? displayArtifact.source.artifactId
			: null;
	const selectedActivityArtifact = useMemo(
		() =>
			artifactRowId
				? activityArtifacts.find((artifact) => artifact.id === artifactRowId) ||
					null
				: null,
		[activityArtifacts, artifactRowId],
	);
	const selectedActivityArtifactContent = useMemo(
		() =>
			measureArtifactPerf(
				"artifactPane.parseActivityArtifactContent",
				() => parseArtifactContentJson(selectedActivityArtifact?.contentText),
				{
					artifactRowId,
					contentLength: selectedActivityArtifact?.contentText?.length || 0,
				},
			),
		[artifactRowId, selectedActivityArtifact?.contentText],
	);
	const activityArtifactMetadata = useMemo(
		() =>
			measureArtifactPerf(
				"artifactPane.mergeArtifactMetadata",
				() => ({
					...asRecord(selectedActivityArtifactContent),
					...toDeepRecord(selectedActivityArtifact?.metadataJson),
					...asRecord(selectedArtifact?.metadata),
					...asRecord(displayArtifact?.metadata),
				}),
				{
					artifactId: displayArtifact?.id || selectedArtifact?.id || null,
					hasActivityArtifact: Boolean(selectedActivityArtifact),
				},
			),
		[
			displayArtifact?.id,
			displayArtifact?.metadata,
			selectedActivityArtifact,
			selectedActivityArtifactContent,
			selectedArtifact?.id,
			selectedArtifact?.metadata,
		],
	);
	return {
		artifactVersions,
		currentVersionIndex,
		displayArtifact,
		displayArtifactId,
		showDiff,
		showBlueprintWorkspace,
		showReviewStatus,
		showEvidenceCheck,
		showBlueprint,
		showComponentDesign,
		taskMessageId,
		selectedMessage,
		selectedActivityArtifact,
		selectedActivityArtifactContent,
		activityArtifactMetadata,
		artifactBlueprint:
			activityArtifactMetadata.appBlueprint ||
			(!isMockBlueprintCandidate(selectedActivityArtifactContent)
				? selectedActivityArtifactContent
				: null),
		artifactMockBlueprint:
			activityArtifactMetadata.mockBlueprint ||
			(String(activityArtifactMetadata.schemaName || "") === "mock_blueprint" ||
			isMockBlueprintCandidate(selectedActivityArtifactContent)
				? selectedActivityArtifactContent
				: null),
		artifactValidation: activityArtifactMetadata.validation,
		artifactGeneration:
			activityArtifactMetadata.generation ||
			displayArtifact?.metadata?.generation ||
			null,
	};
}
