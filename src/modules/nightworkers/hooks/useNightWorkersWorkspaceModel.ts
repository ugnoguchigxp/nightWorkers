import { isCodingAgentChatTrace } from "../../codingAgent";
import type {
	ActivityEvent,
	ActivityReplay,
	PlanModeWorkspace,
	Task,
} from "../types";

export const emptyActivityReplay: ActivityReplay = {
	events: [],
	artifacts: [],
};

export function resolveNextActiveSessionId(
	currentId: string | null,
	sessions: Pick<Task, "id">[],
) {
	if (currentId && sessions.some((session) => session.id === currentId))
		return currentId;
	return sessions[0]?.id ?? null;
}

export type {
	NightWorkersWorkspaceState,
	ProjectSessionGroups,
} from "./nightWorkersWorkspaceState";

function _hasPlanModeWorkspaceEvidence(workspace: PlanModeWorkspace) {
	return Boolean(
		workspace.featurePlanArtifacts.length ||
			workspace.blueprintArtifacts.length ||
			workspace.dataModelArtifacts.length ||
			workspace.dedicatedViewArtifacts.length ||
			workspace.questionnaireSessions.length ||
			workspace.decisionReviews.length ||
			workspace.implementationReferences.length,
	);
}

function _summarizePlanModeWorkspace(workspace: PlanModeWorkspace) {
	return [
		`${workspace.featurePlanArtifacts.length} spec`,
		`${workspace.blueprintArtifacts.length} Blueprint`,
		`${workspace.dataModelArtifacts.length} Data Model`,
		`${workspace.dedicatedViewArtifacts.length} Plan Views`,
		`${workspace.questionnaireSessions.length} Questionnaire`,
		`${workspace.decisionReviews.length} Decision Review`,
		`${workspace.implementationReferences.length} Implementation`,
	].join(" · ");
}

export function isActiveRunStatus(status: string | undefined): boolean {
	return (
		status === "running" ||
		status === "context_compiling" ||
		status === "compiling_context" ||
		status === "finalizing"
	);
}

function _isTerminalRunStatus(status: string | undefined): boolean {
	return (
		status === "completed" ||
		status === "needs_review" ||
		status === "needs_human" ||
		status === "failed" ||
		status === "blocked" ||
		status === "timed_out" ||
		status === "cancelled"
	);
}

export function normalizeActivityReplay(data: unknown): ActivityReplay {
	if (Array.isArray(data))
		return { events: data as ActivityEvent[], artifacts: [] };
	if (!data || typeof data !== "object") return emptyActivityReplay;
	const replay = data as Partial<ActivityReplay>;
	return {
		events: Array.isArray(replay.events)
			? replay.events.filter(isCodingAgentChatTrace)
			: [],
		artifacts: Array.isArray(replay.artifacts) ? replay.artifacts : [],
	};
}

function _buildPriorityUpdates(sessionIds: string[], sessions: Task[]) {
	const currentPriorityById = new Map(
		sessions.map((session) => [session.id, session.priority]),
	);
	return sessionIds
		.map((sessionId, index) => ({
			sessionId,
			priority: sessionIds.length - index,
		}))
		.filter(
			({ sessionId, priority }) =>
				currentPriorityById.get(sessionId) !== priority,
		);
}

export function isActiveTaskStatus(status: string | undefined): boolean {
	return (
		status === "running" ||
		status === "context_compiling" ||
		status === "compiling_context" ||
		status === "finalizing"
	);
}
