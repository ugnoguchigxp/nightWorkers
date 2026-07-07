import { apiFetch } from "../../lib/api-base";
import { jsonRequest } from "../../lib/api-request";

export {
	createAgentHook,
	deleteAgentHook,
	fetchAgentHooks,
	testAgentHook,
	updateAgentHook,
} from "../hooks/hooksCommands";
export {
	createMcpServer,
	deleteMcpServer,
	fetchMcpServers,
	importMcpServers,
	testMcpServer,
	updateMcpServer,
} from "../mcp/mcpCommands";
export {
	archiveImplementationQueueEntry,
	cancelImplementationQueueEntry,
	createImplementationQueueEntry,
	fetchImplementationQueue,
	requeueImplementationQueueEntry,
	updateImplementationQueueEntry,
	updateImplementationQueueSettings,
} from "../queue/queueCommands";

export {
	fetchCodexSdkStatus,
	fetchGeneralSettings,
	fetchLlmModelOptions,
	fetchLlmSettings,
	fetchTestQualitySettings,
	refreshFxRates,
	runLlmSmokeTest,
	saveGeneralSettings,
	saveLlmSettings,
	saveTestQualitySettings,
	testLlmProviderHealth,
} from "../settings/settingsCommands";
export {
	fetchTodoWorkflowSettings,
	updateTodoWorkflowSettings,
} from "../todo/todoCommands";

export function fetchOverview(query: string) {
	return apiFetch(`/api/overview?${query}`);
}

export function fetchTaskMessages(sessionId: string) {
	return apiFetch(`/api/tasks/${sessionId}/messages`);
}

export function fetchTaskLlmUsage(sessionId: string) {
	return apiFetch(`/api/tasks/${sessionId}/llm-usage`);
}

export function fetchTaskActivityEvents(sessionId: string) {
	return apiFetch(`/api/tasks/${sessionId}/activity-events`);
}

export function fetchBackgroundProcessesForTask(sessionId: string) {
	return apiFetch(`/api/background-processes?taskId=${sessionId}`);
}

export function appendWorkbenchMessage(
	sessionId: string,
	input: {
		content?: string;
		prompt?: string;
		intent?: string;
		artifactContext?: unknown;
		model?: string;
		providerEndpointId?: string;
		thinkingDepth?: string;
		waitForIntake?: boolean;
	},
	init?: RequestInit,
) {
	return apiFetch(`/api/workbench/sessions/${sessionId}/messages`, {
		...jsonRequest("POST", input),
		...init,
	});
}

export function patchTask(sessionId: string, input: unknown) {
	return apiFetch(`/api/tasks/${sessionId}`, jsonRequest("PATCH", input));
}

export function createWorkbenchSession(input: unknown) {
	return apiFetch("/api/workbench/sessions", jsonRequest("POST", input));
}

export function deleteTask(sessionId: string) {
	return apiFetch(`/api/tasks/${sessionId}`, { method: "DELETE" });
}

export function startWorkbenchRun(sessionId: string) {
	return apiFetch(`/api/workbench/sessions/${sessionId}/run`, {
		method: "POST",
	});
}

export function stopRun(runId: string) {
	return apiFetch(`/api/runs/${runId}/stop`, { method: "POST" });
}

export function fetchRunGitCloseout(runId: string) {
	return apiFetch(`/api/runs/${runId}/git/closeout`);
}

export function commitRunGitCloseout(
	runId: string,
	input: { message?: string } = {},
) {
	return apiFetch(`/api/runs/${runId}/git/commit`, jsonRequest("POST", input));
}

export function pushRunGitCloseout(runId: string) {
	return apiFetch(`/api/runs/${runId}/git/push`, { method: "POST" });
}

export function stopBackgroundProcess(processId: string) {
	return apiFetch(`/api/background-processes/${processId}/stop`, {
		method: "POST",
	});
}

export function queueWorkbenchSession(sessionId: string) {
	return apiFetch(`/api/workbench/sessions/${sessionId}/queue`, {
		method: "POST",
	});
}

export function archiveWorkbenchSession(sessionId: string) {
	return apiFetch(`/api/workbench/sessions/${sessionId}/archive`, {
		method: "PATCH",
	});
}

export function submitRunReview(
	runId: string,
	input: { action: "complete" | "cancel"; note?: string },
) {
	return apiFetch(`/api/runs/${runId}/reviews`, jsonRequest("POST", input));
}

export function fetchReviewRecommendation(runId: string) {
	return apiFetch(`/api/runs/${runId}/review-recommendation`);
}

export function startReviewSession(runId: string) {
	return apiFetch(`/api/runs/${runId}/review-sessions`, { method: "POST" });
}

export function fetchLatestTaskReviewSession(sessionId: string) {
	return apiFetch(`/api/tasks/${sessionId}/review-session`);
}

export function runReviewSection(reviewSessionId: string, section: string) {
	return apiFetch(
		`/api/review-sessions/${reviewSessionId}/sections/${section}/run`,
		jsonRequest("POST", {}),
	);
}

export function updateReviewFindingDisposition(
	reviewSessionId: string,
	findingId: string,
	input: {
		disposition:
			| "human_callout"
			| "agent_followup"
			| "prompt_suggestion"
			| "security_plugin_handoff"
			| "accepted_risk"
			| "ignored";
		note?: string;
		evidenceRefs?: unknown[];
	},
) {
	return apiFetch(
		`/api/review-sessions/${reviewSessionId}/findings/${findingId}/disposition`,
		jsonRequest("POST", input),
	);
}

export function createReviewPromptSuggestions(reviewSessionId: string) {
	return apiFetch(
		`/api/review-sessions/${reviewSessionId}/prompt-suggestions`,
		{
			method: "POST",
		},
	);
}

export function updateReviewPromptSuggestion(
	reviewSessionId: string,
	suggestionId: string,
	input: { status: "dismissed" },
) {
	return apiFetch(
		`/api/review-sessions/${reviewSessionId}/prompt-suggestions/${suggestionId}`,
		jsonRequest("PATCH", input),
	);
}

export function markReviewPromptSuggestionUsed(
	reviewSessionId: string,
	suggestionId: string,
	input: { createdMessageId?: string } = {},
) {
	return apiFetch(
		`/api/review-sessions/${reviewSessionId}/prompt-suggestions/${suggestionId}/use`,
		jsonRequest("POST", input),
	);
}

export function applyReviewFinalAction(
	reviewSessionId: string,
	input: {
		action: "approve" | "request_changes" | "needs_human" | "exit_review";
		note?: string;
	},
) {
	return apiFetch(
		`/api/review-sessions/${reviewSessionId}/final-action`,
		jsonRequest("POST", input),
	);
}

export function browseFolders(targetPath?: string) {
	const path = targetPath ? `?path=${encodeURIComponent(targetPath)}` : "";
	return apiFetch(`/api/utils/browse-folders${path}`);
}

export function createFolder(input: { parentPath?: string; name: string }) {
	return apiFetch("/api/utils/create-folder", jsonRequest("POST", input));
}

export function fetchRepositoryFiles(repositoryId: string, path?: string) {
	const params = new URLSearchParams();
	if (path) params.set("path", path);
	const query = params.toString();
	return apiFetch(
		`/api/repositories/${repositoryId}/files${query ? `?${query}` : ""}`,
	);
}

export function fetchRepositoryFile(repositoryId: string, path: string) {
	const params = new URLSearchParams({ path });
	return apiFetch(
		`/api/repositories/${repositoryId}/file?${params.toString()}`,
	);
}

export function fetchRepositoryDiff(repositoryId: string) {
	return apiFetch(`/api/repositories/${repositoryId}/diff`);
}

export function fetchProjectDetailMetrics(repositoryId: string) {
	return apiFetch(`/api/repositories/${repositoryId}/project-detail/metrics`);
}

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

export function generateMissionTaskCandidates(
	repositoryId: string,
	input: unknown = {},
) {
	return apiFetch(
		`/api/repositories/${repositoryId}/mission-task-candidates/generate`,
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

export function fetchProjectQuality(repositoryId: string) {
	return apiFetch(`/api/repositories/${repositoryId}/quality`);
}

export function createProjectQualityRun(
	repositoryId: string,
	input: { runType: "unit" | "e2e" | "all" },
) {
	return apiFetch(
		`/api/repositories/${repositoryId}/quality/runs`,
		jsonRequest("POST", input),
	);
}
