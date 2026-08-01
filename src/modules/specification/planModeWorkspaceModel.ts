import { toDeepRecord } from "../../../shared/json-record";
import {
	findMissingPlanModeUpstreamViews,
	isPlanModeArtifactCurrentForRouting,
	PLAN_MODE_EXECUTION_VIEW_ORDER,
	resolveIncludedPlanModeViews,
} from "../../../shared/plan-mode-execution";
import type {
	ActivityArtifact,
	DesignQuestionnaireSession,
	GeneralSettings,
	PlanModeViewDecision,
	PlanModeWorkspace,
	TaskMessage,
} from "../nightworkers/types";
import {
	isDataModelMessage,
	isNormalBlueprintMessage,
	mergeWorkspaceTaskMessages,
} from "../nightworkers/workbenchSelectors";
import { toMs } from "../nightworkers/workbenchSelectorUtils";

export type PlanWorkspaceTab =
	| "feature-plan"
	| "blueprint"
	| "data-model"
	| "user-flow"
	| "api-io-contract"
	| "activity-flow"
	| "sequence-flow"
	| "zod-schema-design"
	| "questionnaire"
	| "status";

const artifactKindToPlanWorkspaceTab: Partial<
	Record<
		PlanModeWorkspace["dedicatedViewArtifacts"][number]["kind"],
		PlanWorkspaceTab
	>
> = {
	feature_plan: "feature-plan",
	blueprint: "blueprint",
	data_model: "data-model",
	user_flow: "user-flow",
	api_io_contract: "api-io-contract",
	activity_flow: "activity-flow",
	sequence_flow: "sequence-flow",
	zod_schema_design: "zod-schema-design",
};

export function selectPlanModeWorkspaceMessages(input: {
	taskMessages: TaskMessage[];
	activityArtifacts: ActivityArtifact[];
	generatedMessages: TaskMessage[];
	workspace: PlanModeWorkspace | null;
}) {
	const combinedTaskMessages = mergeWorkspaceTaskMessages({
		taskMessages: input.taskMessages,
		activityArtifacts: input.activityArtifacts,
		generatedMessages: input.generatedMessages,
	});
	const blueprintMessages = combinedTaskMessages.filter(
		isNormalBlueprintMessage,
	);
	const dataModelMessages = combinedTaskMessages.filter(isDataModelMessage);
	const designDocMessages = combinedTaskMessages.filter((message) => {
		const intent = String(toDeepRecord(message.metadataJson).intent);
		return (
			message.messageType === "markdown_document" && intent === "feature_plan"
		);
	});
	const activeFeaturePlanMessage = latestMessageByCreatedAt(designDocMessages);
	const activeBlueprintMessage = latestMessageByCreatedAt(blueprintMessages);
	const activeDataModelMessage = latestMessageByCreatedAt(dataModelMessages);
	const latestWorkspaceBlueprintMessageId =
		input.workspace?.blueprintArtifacts.at(-1)?.sourceMessageId || null;
	const activeBlueprintSourceMessageId = activeBlueprintMessage?.id?.startsWith(
		"artifact-",
	)
		? latestWorkspaceBlueprintMessageId
		: activeBlueprintMessage?.id || latestWorkspaceBlueprintMessageId;

	return {
		combinedTaskMessages,
		blueprintMessages,
		dataModelMessages,
		designDocMessages,
		activeFeaturePlanMessage,
		activeBlueprintMessage,
		activeDataModelMessage,
		activeBlueprintSourceMessageId,
	};
}

export function resolveLatestPlanWorkspaceTab(
	workspace: PlanModeWorkspace | null,
): PlanWorkspaceTab | null {
	const artifact = resolveLatestPlanWorkspaceArtifact(workspace);
	return artifact
		? artifactKindToPlanWorkspaceTab[artifact.kind] || null
		: null;
}

export function resolveLatestPlanWorkspaceArtifact(
	workspace: PlanModeWorkspace | null,
) {
	if (!workspace) return null;
	const artifacts = [
		...workspace.featurePlanArtifacts,
		...workspace.blueprintArtifacts,
		...workspace.dataModelArtifacts,
		...workspace.dedicatedViewArtifacts,
	].filter((artifact) => artifactKindToPlanWorkspaceTab[artifact.kind]);
	let latest: (typeof artifacts)[number] | null = null;
	let latestMs = Number.NEGATIVE_INFINITY;
	for (const artifact of artifacts) {
		const ms = toMs(artifact.createdAt);
		if (ms > latestMs) {
			latest = artifact;
			latestMs = ms;
		}
	}
	return latest;
}

export function resolvePlanWorkspaceViewDecisions(
	workspace: PlanModeWorkspace | null,
	messageViewDecisions: PlanModeViewDecision[],
) {
	const decisions =
		workspace?.viewDecisions?.length && workspace.viewDecisions.length > 0
			? workspace.viewDecisions
			: messageViewDecisions;
	return decisions;
}

export function resolveLatestPlanArtifactSourceMessageIds(
	workspace: PlanModeWorkspace | null,
) {
	if (!workspace) {
		return {
			featurePlanMessageId: null,
			blueprintMessageId: null,
			dataModelMessageId: null,
			dedicatedViewMessageIds: [] as string[],
		};
	}
	const includedViews = includedPlanModeViews(workspace);
	const currentRoutingRevision = workspace.routing?.revision;
	const includeWhenRouted = (view: string) =>
		includedViews.size === 0 || includedViews.has(view);
	const latestFeaturePlan = latestArtifactByCreatedAt(
		currentArtifactsForRouting(
			workspace.featurePlanArtifacts ?? [],
			currentRoutingRevision,
		),
	);
	const latestBlueprint = includeWhenRouted("blueprint")
		? latestArtifactByCreatedAt(
				currentArtifactsForRouting(
					workspace.blueprintArtifacts ?? [],
					currentRoutingRevision,
				),
			)
		: null;
	const latestDataModel = includeWhenRouted("data_model")
		? latestArtifactByCreatedAt(
				currentArtifactsForRouting(
					workspace.dataModelArtifacts ?? [],
					currentRoutingRevision,
				),
			)
		: null;
	const latestDedicatedByKind = new Map<
		string,
		PlanModeWorkspace["dedicatedViewArtifacts"][number]
	>();
	for (const artifact of workspace.dedicatedViewArtifacts ?? []) {
		if (
			!isPlanModeArtifactCurrentForRouting(artifact, currentRoutingRevision) ||
			artifact.kind === "feature_plan" ||
			artifact.kind === "questionnaire" ||
			artifact.kind === "blueprint" ||
			artifact.kind === "data_model" ||
			!includeWhenRouted(artifact.kind)
		)
			continue;
		const current = latestDedicatedByKind.get(artifact.kind);
		if (!current || toMs(artifact.createdAt) >= toMs(current.createdAt)) {
			latestDedicatedByKind.set(artifact.kind, artifact);
		}
	}
	return {
		featurePlanMessageId: latestFeaturePlan?.sourceMessageId ?? null,
		blueprintMessageId: latestBlueprint?.sourceMessageId ?? null,
		dataModelMessageId: latestDataModel?.sourceMessageId ?? null,
		dedicatedViewMessageIds: PLAN_MODE_EXECUTION_VIEW_ORDER.flatMap((view) => {
			const artifact = latestDedicatedByKind.get(view);
			return artifact ? [artifact.sourceMessageId] : [];
		}),
	};
}

export function resolveCurrentPlanModeArtifactKinds(
	workspace: PlanModeWorkspace | null,
) {
	const result = new Set<string>();
	if (!workspace) return result;
	const currentRoutingRevision = workspace.routing?.revision;
	if (
		currentArtifactsForRouting(
			workspace.featurePlanArtifacts ?? [],
			currentRoutingRevision,
		).length > 0
	)
		result.add("feature_plan");
	if (
		currentArtifactsForRouting(
			workspace.blueprintArtifacts ?? [],
			currentRoutingRevision,
		).length > 0
	)
		result.add("blueprint");
	if (
		currentArtifactsForRouting(
			workspace.dataModelArtifacts ?? [],
			currentRoutingRevision,
		).length > 0
	)
		result.add("data_model");
	for (const artifact of currentArtifactsForRouting(
		workspace.dedicatedViewArtifacts ?? [],
		currentRoutingRevision,
	)) {
		result.add(artifact.kind);
	}
	return result;
}

export function isPlanModeFeaturePlanCurrent(
	workspace: PlanModeWorkspace | null,
) {
	if (!workspace) return false;
	const currentRoutingRevision = workspace.routing?.revision;
	const featurePlan = latestArtifactByCreatedAt(
		currentArtifactsForRouting(
			workspace.featurePlanArtifacts ?? [],
			currentRoutingRevision,
		),
	);
	if (!featurePlan) return false;
	const currentBlueprintArtifacts = currentArtifactsForRouting(
		workspace.blueprintArtifacts ?? [],
		currentRoutingRevision,
	);
	const currentDataModelArtifacts = currentArtifactsForRouting(
		workspace.dataModelArtifacts ?? [],
		currentRoutingRevision,
	);
	const currentDedicatedViewArtifacts = currentArtifactsForRouting(
		workspace.dedicatedViewArtifacts ?? [],
		currentRoutingRevision,
	);
	const missingUpstreamViews = findMissingPlanModeUpstreamViews({
		includedViews: includedPlanModeViews(workspace),
		existingArtifactKinds: [
			...(currentBlueprintArtifacts.length > 0 ? ["blueprint"] : []),
			...(currentDataModelArtifacts.length > 0 ? ["data_model"] : []),
			...currentDedicatedViewArtifacts.map((artifact) => artifact.kind),
		],
	});
	if (missingUpstreamViews.length > 0) return false;
	const sources = resolveLatestPlanArtifactSourceMessageIds(workspace);
	const sourceMessageIds = new Set(
		[
			sources.blueprintMessageId,
			sources.dataModelMessageId,
			...sources.dedicatedViewMessageIds,
		].filter((id): id is string => Boolean(id)),
	);
	const sourceByMessageId = new Map(
		[
			...currentBlueprintArtifacts,
			...currentDataModelArtifacts,
			...currentDedicatedViewArtifacts,
		].map((artifact) => [artifact.sourceMessageId, artifact]),
	);
	const featurePlanCreatedAt = toMs(featurePlan.createdAt);
	return [...sourceMessageIds].every((sourceMessageId) => {
		const source = sourceByMessageId.get(sourceMessageId);
		return Boolean(source && toMs(source.createdAt) <= featurePlanCreatedAt);
	});
}

function currentArtifactsForRouting<
	T extends { routingRevision?: number | null },
>(artifacts: readonly T[], currentRoutingRevision: number | null | undefined) {
	return artifacts.filter((artifact) =>
		isPlanModeArtifactCurrentForRouting(artifact, currentRoutingRevision),
	);
}

function includedPlanModeViews(workspace: PlanModeWorkspace) {
	return resolveIncludedPlanModeViews({
		routingEntries: workspace.routing?.entries,
		viewDecisions: workspace.viewDecisions,
	});
}

function latestArtifactByCreatedAt<T extends { createdAt: unknown }>(
	artifacts: readonly T[],
): T | null {
	let latest: T | null = null;
	let latestMs = Number.NEGATIVE_INFINITY;
	for (const artifact of artifacts) {
		const ms = toMs(artifact.createdAt);
		if (ms >= latestMs) {
			latest = artifact;
			latestMs = ms;
		}
	}
	return latest;
}

function latestMessageByCreatedAt(messages: TaskMessage[]) {
	let latest: TaskMessage | null = null;
	let latestMs = Number.NEGATIVE_INFINITY;
	for (const message of messages) {
		const ms = toMs(message.createdAt);
		if (ms > latestMs) {
			latest = message;
			latestMs = ms;
		}
	}
	return latest;
}

export function isDesignAssemblyReady(
	session: DesignQuestionnaireSession | null,
	assemblyReadySessionIds: Set<string>,
) {
	return Boolean(
		session &&
			(session.status === "review_ready" ||
				session.status === "accepted" ||
				assemblyReadySessionIds.has(session.id)),
	);
}

export function getPlanModeCapabilities(settings: GeneralSettings | null) {
	return (
		settings?.planMode.capabilities ?? {
			questionnaire: true,
			feature_plan: true,
			user_flow: true,
			blueprint: true,
			data_model: true,
			api_io_contract: true,
			activity_flow: true,
			sequence_flow: true,
			zod_schema_design: true,
		}
	);
}
