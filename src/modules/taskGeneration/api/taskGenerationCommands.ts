import { apiFetch } from "../../../lib/api-base";
import { jsonRequest } from "../../../lib/api-request";

export function fetchMissionGoals(repositoryId: string) {
	return apiFetch(`/api/repositories/${repositoryId}/mission-goals`);
}

export function createMissionGoal(repositoryId: string, input: unknown) {
	return apiFetch(
		`/api/repositories/${repositoryId}/mission-goals`,
		jsonRequest("POST", input),
	);
}

export function updateMissionGoal(
	repositoryId: string,
	goalId: string,
	input: unknown,
) {
	return apiFetch(
		`/api/repositories/${repositoryId}/mission-goals/${goalId}`,
		jsonRequest("PATCH", input),
	);
}

export function deleteMissionGoal(repositoryId: string, goalId: string) {
	return apiFetch(`/api/repositories/${repositoryId}/mission-goals/${goalId}`, {
		method: "DELETE",
	});
}

export function fetchMissionTaskCandidates(
	repositoryId: string,
	status = "candidate",
) {
	const params = new URLSearchParams();
	if (status) params.set("status", status);
	const query = params.toString();
	return apiFetch(
		`/api/repositories/${repositoryId}/mission-task-candidates${query ? `?${query}` : ""}`,
	);
}

/** @deprecated Use generateTaskCandidates so scale estimation selects the generation path. */
export function generateMissionTaskCandidates(
	repositoryId: string,
	input: unknown = {},
) {
	return apiFetch(
		`/api/repositories/${repositoryId}/mission-task-candidates/generate`,
		jsonRequest("POST", input),
	);
}

export function generateTaskCandidates(
	repositoryId: string,
	input: unknown = {},
) {
	return apiFetch(
		`/api/repositories/${repositoryId}/task-candidates/generate`,
		jsonRequest("POST", input),
	);
}

export function generateSecurityScanTaskCandidates(
	repositoryId: string,
	input: unknown,
) {
	return apiFetch(
		`/api/repositories/${repositoryId}/task-candidates/generate-from-security-scan`,
		jsonRequest("POST", input),
	);
}

export function updateMissionTaskCandidate(
	candidateId: string,
	input: unknown,
) {
	return apiFetch(
		`/api/mission-task-candidates/${candidateId}`,
		jsonRequest("PATCH", input),
	);
}

export function createTasksFromMissionCandidates(
	repositoryId: string,
	input: unknown,
) {
	return apiFetch(
		`/api/repositories/${repositoryId}/mission-task-candidates/create-tasks`,
		jsonRequest("POST", input),
	);
}

export function fetchMissions(repositoryId: string) {
	return apiFetch(`/api/repositories/${repositoryId}/missions`);
}

export function createMission(repositoryId: string, input: unknown) {
	return apiFetch(
		`/api/repositories/${repositoryId}/missions`,
		jsonRequest("POST", input),
	);
}

/** @deprecated Use generateTaskCandidates so Mission generation is selected automatically. */
export function generateMissionCandidatesFromGoals(
	repositoryId: string,
	input: unknown = {},
) {
	return apiFetch(
		`/api/repositories/${repositoryId}/missions/generate-candidates`,
		jsonRequest("POST", input),
	);
}

export function fetchRepositoryMissionTaskProposals(
	repositoryId: string,
	status = "proposed",
) {
	const params = new URLSearchParams();
	if (status) params.set("status", status);
	const query = params.toString();
	return apiFetch(
		`/api/repositories/${repositoryId}/mission-task-proposals${query ? `?${query}` : ""}`,
	);
}

export function fetchMissionDetail(missionId: string) {
	return apiFetch(`/api/missions/${missionId}`);
}

export function deleteMission(missionId: string) {
	return apiFetch(`/api/missions/${missionId}`, { method: "DELETE" });
}

export function decomposeMission(missionId: string, input: unknown = {}) {
	return apiFetch(
		`/api/missions/${missionId}/decompose`,
		jsonRequest("POST", input),
	);
}

export function requestMissionPlanningRevision(
	resultId: string,
	input: { reason: string },
) {
	return apiFetch(
		`/api/mission-planning-results/${resultId}/request-revision`,
		jsonRequest("POST", input),
	);
}

export function dismissMissionTaskProposal(proposalId: string) {
	return apiFetch(
		`/api/mission-task-proposals/${proposalId}/dismiss`,
		jsonRequest("POST", {}),
	);
}

export function createTasksFromMissionTaskProposals(input: unknown) {
	return apiFetch(
		`/api/mission-task-proposals/create-tasks`,
		jsonRequest("POST", input),
	);
}
