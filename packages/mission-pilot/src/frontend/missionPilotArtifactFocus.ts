import type { MissionPilotControlSummary } from "../contracts";
import type {
	MissionPilotPlanModeWorkspace,
	MissionPilotTask,
	MissionPilotTaskRun,
	MissionPilotWorkbenchArtifactRef,
	MissionPilotWorkbenchRouteState,
} from "./host";

export type MissionPilotArtifactFocusTarget =
	| {
			key: string;
			kind: "plan_mode_workspace";
			tab:
				| "feature-plan"
				| "blueprint"
				| "data-model"
				| "user-flow"
				| "api-io-contract"
				| "activity-flow"
				| "sequence-flow"
				| "zod-schema-design"
				| "questionnaire";
	  }
	| { key: string; kind: "todo" }
	| { key: string; kind: "review_status" };

const IMPLEMENTATION_PHASES = new Set([
	"implementation_starting",
	"implementing",
	"implementation_evaluating",
	"implementation_rework",
]);
const REVIEW_PHASES = new Set([
	"review_preparing",
	"reviewing",
	"review_evaluating",
	"review_rework",
]);
const ACTIVE_RUN_STATUSES = new Set([
	"running",
	"context_compiling",
	"compiling_context",
	"finalizing",
]);

function activeRunExecutionMode(
	run: MissionPilotTaskRun | undefined,
	taskId: string,
) {
	if (!run || run.taskId !== taskId || !ACTIVE_RUN_STATUSES.has(run.status))
		return null;
	const mode = (run.contextSnapshot as Record<string, unknown> | null)
		?.executionMode;
	return mode === "implementation" || mode === "review" ? mode : null;
}

function planModeWorkspaceFromArtifact(
	artifact: MissionPilotWorkbenchArtifactRef | undefined,
): MissionPilotPlanModeWorkspace | null {
	const workspace = artifact?.metadata?.planModeWorkspace;
	if (!workspace || typeof workspace !== "object" || Array.isArray(workspace))
		return null;
	return workspace as MissionPilotPlanModeWorkspace;
}

function latestQuestionnaireNeedsAttention(
	workspace: MissionPilotPlanModeWorkspace,
) {
	const latest = workspace.questionnaireSessions.at(-1);
	return latest &&
		latest.status !== "review_ready" &&
		latest.status !== "accepted"
		? latest
		: null;
}

export function resolveMissionPilotArtifactFocus(input: {
	activeSession: MissionPilotTask | null;
	missionPilot: MissionPilotControlSummary | null;
	activeArtifactRefs: MissionPilotWorkbenchArtifactRef[];
	latestRun?: MissionPilotTaskRun;
	routeState: MissionPilotWorkbenchRouteState;
}): MissionPilotArtifactFocusTarget | null {
	const task = input.activeSession;
	const missionPilot = input.missionPilot;
	if (!task || missionPilot?.desiredState !== "playing") return null;
	if (
		input.routeState.kind !== "session" ||
		input.routeState.sessionId !== task.id
	)
		return null;
	const executionMode = activeRunExecutionMode(input.latestRun, task.id);
	if (executionMode === "implementation") {
		return { key: `${task.id}:implementation`, kind: "todo" };
	}
	if (executionMode === "review") {
		return { key: `${task.id}:review`, kind: "review_status" };
	}

	if (IMPLEMENTATION_PHASES.has(missionPilot.phase)) {
		return { key: `${task.id}:implementation`, kind: "todo" };
	}
	if (REVIEW_PHASES.has(missionPilot.phase)) {
		return { key: `${task.id}:review`, kind: "review_status" };
	}

	const planArtifact = input.activeArtifactRefs.find(
		(artifact) => artifact.kind === "plan_mode_workspace",
	);
	const workspace = planModeWorkspaceFromArtifact(planArtifact);
	if (!planArtifact || !workspace) return null;

	const questionnaire = latestQuestionnaireNeedsAttention(workspace);
	if (questionnaire) {
		return {
			key: `${task.id}:questionnaire:${questionnaire.id}`,
			kind: "plan_mode_workspace",
			tab: "questionnaire",
		};
	}

	const latestArtifact = resolveLatestPlanWorkspaceArtifact(workspace);
	const latestTab = resolveLatestPlanWorkspaceTab(workspace);
	if (!latestArtifact || !latestTab) return null;
	return {
		key: `${task.id}:plan-artifact:${latestArtifact.id}`,
		kind: "plan_mode_workspace",
		tab: latestTab,
	};
}

const artifactKindToTab = {
	feature_plan: "feature-plan",
	blueprint: "blueprint",
	data_model: "data-model",
	user_flow: "user-flow",
	api_io_contract: "api-io-contract",
	activity_flow: "activity-flow",
	sequence_flow: "sequence-flow",
	zod_schema_design: "zod-schema-design",
} as const;

function resolveLatestPlanWorkspaceArtifact(
	workspace: MissionPilotPlanModeWorkspace,
) {
	const artifacts = [
		...workspace.featurePlanArtifacts,
		...workspace.blueprintArtifacts,
		...workspace.dataModelArtifacts,
		...workspace.dedicatedViewArtifacts,
	].filter((artifact) => artifact.kind in artifactKindToTab);
	return artifacts.reduce<(typeof artifacts)[number] | null>(
		(latest, artifact) =>
			!latest ||
			new Date(artifact.createdAt as string | number | Date).getTime() >
				new Date(latest.createdAt as string | number | Date).getTime()
				? artifact
				: latest,
		null,
	);
}

function resolveLatestPlanWorkspaceTab(
	workspace: MissionPilotPlanModeWorkspace,
) {
	const artifact = resolveLatestPlanWorkspaceArtifact(workspace);
	return artifact
		? (artifactKindToTab[artifact.kind as keyof typeof artifactKindToTab] ??
				null)
		: null;
}
