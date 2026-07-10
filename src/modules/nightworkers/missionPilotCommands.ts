import type {
	DecideMissionApproval,
	RequestMissionApproval,
} from "../../../shared/schemas/mission-pilot.schema";
import { apiFetch } from "../../lib/api-base";
import { jsonRequest } from "../../lib/api-request";

export function fetchMissionPilotDetail(missionId: string) {
	return apiFetch(`/api/missions/${missionId}/pilot-detail`);
}

export function requestMissionApproval(
	missionId: string,
	input: RequestMissionApproval,
) {
	return apiFetch(
		`/api/missions/${missionId}/approvals`,
		jsonRequest("POST", input),
	);
}

export function decideMissionApproval(
	missionId: string,
	approvalId: string,
	decision: "approve" | "reject",
	input: DecideMissionApproval,
) {
	return apiFetch(
		`/api/missions/${missionId}/approvals/${approvalId}/${decision}`,
		jsonRequest("POST", input),
	);
}

export function materializeMissionTask(
	missionId: string,
	taskCandidateId: string,
	input: {
		approvalId: string;
		mode: "draft" | "ready";
		idempotencyKey: string;
	},
) {
	return apiFetch(
		`/api/missions/${missionId}/task-candidates/${taskCandidateId}/materialize`,
		jsonRequest("POST", input),
	);
}

export function enqueueMissionTask(
	missionId: string,
	missionTaskId: string,
	input: { idempotencyKey: string },
) {
	return apiFetch(
		`/api/missions/${missionId}/tasks/${missionTaskId}/enqueue`,
		jsonRequest("POST", input),
	);
}

export function syncMissionExecution(
	missionId: string,
	input: { idempotencyKey: string; missionTaskId?: string },
) {
	return apiFetch(
		`/api/missions/${missionId}/sync-execution`,
		jsonRequest("POST", input),
	);
}

export function evaluateMission(
	missionId: string,
	input: { idempotencyKey: string; missionTaskId?: string },
) {
	return apiFetch(
		`/api/missions/${missionId}/evaluate`,
		jsonRequest("POST", input),
	);
}

export function createMissionReplanSuggestion(
	missionId: string,
	input: { idempotencyKey: string; evaluationId?: string },
) {
	return apiFetch(
		`/api/missions/${missionId}/replan-suggestions`,
		jsonRequest("POST", input),
	);
}

export function applyMissionReplan(
	missionId: string,
	suggestionId: string,
	input: { approvalId: string; idempotencyKey: string },
) {
	return apiFetch(
		`/api/missions/${missionId}/replan-suggestions/${suggestionId}/apply`,
		jsonRequest("POST", input),
	);
}

export function startMissionAutopilot(
	missionId: string,
	input: {
		autonomyLevel: 1;
		allowedActions: Array<
			| "sync_execution"
			| "enqueue_approved_task"
			| "evaluate_completed_run"
			| "create_replan_suggestion"
			| "pause_mission"
		>;
		expiresAt?: string;
		approvalId: string;
		idempotencyKey: string;
	},
) {
	return apiFetch(
		`/api/missions/${missionId}/autopilot/start`,
		jsonRequest("POST", input),
	);
}

export function commandMissionAutopilot(
	missionId: string,
	command: "pause" | "resume" | "revoke" | "tick",
	idempotencyKey: string,
) {
	return apiFetch(
		`/api/missions/${missionId}/autopilot/${command}`,
		jsonRequest("POST", { idempotencyKey }),
	);
}
