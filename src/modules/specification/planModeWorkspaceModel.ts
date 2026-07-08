import { toDeepRecord } from "../../../shared/json-record";
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
	if (!workspace) return decisions;
	const decisionsByView = new Map(
		decisions.map((decision) => [decision.view, decision]),
	);
	for (const view of listGeneratedWorkspaceViews(workspace)) {
		const current = decisionsByView.get(view);
		if (current?.decision === "include") continue;
		decisionsByView.set(view, {
			view,
			decision: "include",
			reason: "生成済みのView artifactがあります。",
		});
	}
	return [...decisionsByView.values()];
}

function listGeneratedWorkspaceViews(
	workspace: PlanModeWorkspace,
): PlanModeViewDecision["view"][] {
	const views = new Set<PlanModeViewDecision["view"]>();
	if (workspace.questionnaireSessions?.length > 0) views.add("questionnaire");
	if (workspace.blueprintArtifacts?.length > 0) views.add("blueprint");
	if (workspace.dataModelArtifacts?.length > 0) views.add("data_model");
	for (const artifact of workspace.dedicatedViewArtifacts || []) {
		if (artifact.kind === "feature_plan") continue;
		views.add(artifact.kind);
	}
	return [...views];
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
