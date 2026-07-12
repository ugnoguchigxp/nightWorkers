import type { PromptImageInput } from "../../../shared/prompt-image";
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

export function startTestModeRun(
	sessionId: string,
	input: {
		projectId: string;
		specArtifactId: string;
		verificationDocumentId?: string | null;
		mode: "test";
		action?: "discover_tests" | "plan_and_implement_tests" | "run_unit_tests";
		rerun?: boolean;
	},
) {
	return apiFetch(
		`/api/tasks/${sessionId}/test-mode-run`,
		jsonRequest("POST", input),
	);
}

export function stopRun(runId: string) {
	return apiFetch(`/api/runs/${runId}/stop`, { method: "POST" });
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

export function restoreWorkbenchSessionArchive(sessionId: string) {
	return apiFetch(`/api/workbench/sessions/${sessionId}/archive/restore`, {
		method: "POST",
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

export function startReviewRun(
	reviewSessionId: string,
	input: {
		options?: {
			codeReview?: boolean;
			securityReview?: boolean;
			applyFixes?: boolean;
			commitChanges?: boolean;
		};
	} = {},
) {
	return apiFetch(
		`/api/review-sessions/${reviewSessionId}/run`,
		jsonRequest("POST", input),
	);
}

export function fetchRunGitCloseout(runId: string) {
	return apiFetch(`/api/runs/${runId}/git/closeout`);
}

export function commitRunGitCloseout(runId: string) {
	return apiFetch(`/api/runs/${runId}/git/commit`, jsonRequest("POST", {}));
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
