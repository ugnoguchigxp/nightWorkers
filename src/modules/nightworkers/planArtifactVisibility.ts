import type { WorkbenchRouteState } from "./routing/workbench-route-state";
import type { Task, TaskRun, WorkbenchSessionView } from "./types";

type PlanArtifactVisibilityInput = {
	activeSession: Pick<Task, "status"> | null;
	sessionView: Pick<WorkbenchSessionView, "emailState"> | null;
	latestRun?: Pick<TaskRun, "status"> | null;
	isChatSubmitting?: boolean;
	hasPlanArtifact?: boolean;
};

const PLAN_CREATION_STATUSES = new Set(["draft", "ready"]);

export function isActiveSessionWorkbenchRoute(
	routeState: WorkbenchRouteState,
	activeSessionId: string | null,
): boolean {
	return (
		routeState.kind === "session" &&
		Boolean(activeSessionId) &&
		routeState.sessionId === activeSessionId
	);
}

export function shouldAutoOpenPlanArtifact(
	input: PlanArtifactVisibilityInput,
): boolean {
	if (!input.activeSession) return false;
	const isPlanCreationStatus = PLAN_CREATION_STATUSES.has(
		input.activeSession.status,
	);
	if (input.isChatSubmitting) return isPlanCreationStatus;
	if (input.sessionView?.emailState === "plan_ready") return true;
	if (!input.hasPlanArtifact) return false;
	if (input.latestRun) return false;
	return isPlanCreationStatus;
}
