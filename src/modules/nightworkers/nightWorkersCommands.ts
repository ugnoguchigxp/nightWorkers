import type { PromptImageInput } from "../../../shared/prompt-image";
import { apiFetch } from "../../lib/api-base";
import { jsonRequest } from "../../lib/api-request";

export { apiPath } from "../../lib/api-base";

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
	fetchStartupPreflight,
	refreshFxRates,
	runLlmSmokeTest,
	saveGeneralSettings,
	saveLlmSettings,
	testLlmProviderHealth,
} from "../settings";
export {
	fetchTodoWorkflowSettings,
	updateTodoWorkflowSettings,
} from "../todo/todoCommands";

export function fetchTaskMessages(sessionId: string) {
	return apiFetch(`/api/tasks/${sessionId}/messages?channel=chat`);
}

export function fetchTaskLlmUsage(sessionId: string) {
	return apiFetch(`/api/tasks/${sessionId}/llm-usage`);
}

export function fetchTaskActivityEvents(sessionId: string) {
	return apiFetch(`/api/tasks/${sessionId}/activity-events?channel=chat`);
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
		images?: PromptImageInput[];
	},
	init?: RequestInit,
) {
	return apiFetch(`/api/workbench/sessions/${sessionId}/messages`, {
		...jsonRequest("POST", input),
		...init,
	});
}

export function patchTask(sessionId: string, input: unknown) {
	return apiFetch(
		`/api/tasks/${sessionId}`,
		withIdempotency(jsonRequest("PATCH", input)),
	);
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
		headers: idempotencyHeaders(),
	});
}

export function stopRun(runId: string) {
	return apiFetch(`/api/runs/${runId}/stop`, {
		method: "POST",
		headers: idempotencyHeaders(),
	});
}

export function resumeTaskRunTodo(
	runId: string,
	todoId: string,
	input: { expectedTodoRevision: number; userContext: string },
) {
	return apiFetch(
		`/api/runs/${runId}/todos/${todoId}/resume`,
		withIdempotency(jsonRequest("POST", input)),
	);
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
		headers: idempotencyHeaders(),
	});
}

export function restoreWorkbenchSessionArchive(sessionId: string) {
	return apiFetch(`/api/workbench/sessions/${sessionId}/archive/restore`, {
		method: "POST",
		headers: idempotencyHeaders(),
	});
}

function idempotencyHeaders() {
	return { "Idempotency-Key": crypto.randomUUID() };
}

function withIdempotency(init: RequestInit): RequestInit {
	const headers = new Headers(init.headers);
	headers.set("Idempotency-Key", crypto.randomUUID());
	return { ...init, headers };
}

export function fetchReviewRecommendation(runId: string) {
	return apiFetch(`/api/runs/${runId}/review-recommendation`);
}

export function fetchLatestTaskReviewSession(sessionId: string) {
	return apiFetch(`/api/tasks/${sessionId}/review-session`);
}

export function fetchRunGitCloseout(runId: string) {
	return apiFetch(`/api/runs/${runId}/git/closeout`);
}

export function commitRunGitCloseout(runId: string) {
	return apiFetch(`/api/runs/${runId}/git/commit`, jsonRequest("POST", {}));
}

export function pushRunGitCloseout(runId: string) {
	return apiFetch(`/api/runs/${runId}/git/push`, jsonRequest("POST", {}));
}

export function previewRunGitMerge(runId: string, expectedVersion: number) {
	return apiFetch(
		`/api/runs/${runId}/git/merge/preview`,
		jsonRequest("POST", { expectedVersion }),
	);
}

export function deferRunGitMerge(runId: string, expectedVersion: number) {
	return apiFetch(
		`/api/runs/${runId}/git/merge/defer`,
		jsonRequest("POST", { expectedVersion }),
	);
}

export function reworkRunGitMerge(runId: string, expectedVersion: number) {
	return apiFetch(
		`/api/runs/${runId}/git/merge/rework`,
		jsonRequest("POST", { expectedVersion }),
	);
}

export function overrideRunGitMergeTarget(
	runId: string,
	targetBranch: string,
	expectedVersion: number,
) {
	return apiFetch(
		`/api/runs/${runId}/git/merge/target`,
		jsonRequest("PATCH", { targetBranch, expectedVersion }),
	);
}

export function executeRunGitMerge(runId: string, expectedVersion: number) {
	return apiFetch(
		`/api/runs/${runId}/git/merge`,
		jsonRequest("POST", { expectedVersion }),
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

export function createTask(input: unknown) {
	return apiFetch("/api/tasks", jsonRequest("POST", input));
}

export function fetchProjectDetailMetrics(repositoryId: string) {
	return apiFetch(`/api/repositories/${repositoryId}/project-detail/metrics`);
}

export {
	createMission,
	createMissionGoal,
	createTasksFromMissionCandidates,
	createTasksFromMissionTaskProposals,
	decomposeMission,
	deleteMission,
	deleteMissionGoal,
	dismissMissionTaskProposal,
	fetchMissionDetail,
	fetchMissionGoals,
	fetchMissions,
	fetchMissionTaskCandidates,
	fetchRepositoryMissionTaskProposals,
	generateMissionCandidatesFromGoals,
	generateMissionTaskCandidates,
	generateTaskCandidates,
	requestMissionPlanningRevision,
	updateMissionGoal,
	updateMissionTaskCandidate,
} from "../taskGeneration/api/taskGenerationCommands";
