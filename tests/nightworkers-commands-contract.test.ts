import { afterEach, describe, expect, it, vi } from "vitest";
import {
	appendWorkbenchMessage,
	archiveWorkbenchSession,
	browseFolders,
	commitRunGitCloseout,
	createFolder,
	createMission,
	createMissionGoal,
	createTasksFromMissionCandidates,
	createTasksFromMissionTaskProposals,
	createWorkbenchSession,
	decomposeMission,
	deleteMission,
	deleteMissionGoal,
	deleteTask,
	dismissMissionTaskProposal,
	fetchBackgroundProcessesForTask,
	fetchLatestTaskReviewSession,
	fetchMissionDetail,
	fetchMissionGoals,
	fetchMissions,
	fetchMissionTaskCandidates,
	fetchProjectDetailMetrics,
	fetchRepositoryDiff,
	fetchRepositoryFile,
	fetchRepositoryFiles,
	fetchRepositoryMissionTaskProposals,
	fetchReviewRecommendation,
	fetchRunGitCloseout,
	fetchTaskActivityEvents,
	fetchTaskLlmUsage,
	fetchTaskMessages,
	generateMissionCandidatesFromGoals,
	generateMissionTaskCandidates,
	generateTaskCandidates,
	patchTask,
	pushRunGitCloseout,
	queueWorkbenchSession,
	requestMissionPlanningRevision,
	startReviewRun,
	startReviewSession,
	startTestModeRun,
	startWorkbenchRun,
	stopBackgroundProcess,
	stopRun,
	submitRunReview,
	updateMissionGoal,
	updateMissionTaskCandidate,
} from "../src/modules/nightworkers/nightWorkersCommands";
import { fetchOverview } from "../src/modules/overview/overviewCommands";

function stubFetch() {
	const fetchMock = vi.fn<typeof fetch>(() =>
		Promise.resolve(new Response("{}")),
	);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

describe("nightWorkersCommands", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("routes workbench and run commands to stable endpoints", async () => {
		const fetchMock = stubFetch();
		const abortInit = { signal: AbortSignal.timeout(1000) };

		await fetchOverview("projectId=repo-1");
		await fetchTaskMessages("task-1");
		await fetchTaskLlmUsage("task-1");
		await fetchTaskActivityEvents("task-1");
		await fetchBackgroundProcessesForTask("task-1");
		await appendWorkbenchMessage(
			"task-1",
			{ content: "hello", waitForIntake: true },
			abortInit,
		);
		await patchTask("task-1", { title: "Updated" });
		await createWorkbenchSession({ repositoryId: "repo-1" });
		await deleteTask("task-1");
		await startWorkbenchRun("task-1");
		await startTestModeRun("task-1", {
			projectId: "repo-1",
			specArtifactId: "spec-1",
			mode: "test",
			action: "run_unit_tests",
		});
		await stopRun("run-1");
		await stopBackgroundProcess("process-1");
		await queueWorkbenchSession("task-1");
		await archiveWorkbenchSession("task-1");
		await submitRunReview("run-1", { action: "complete", note: "done" });
		await fetchReviewRecommendation("run-1");
		await startReviewSession("run-1");
		await fetchLatestTaskReviewSession("task-1");
		await startReviewRun("review-1", { options: { codeReview: true } });
		await fetchRunGitCloseout("run-1");
		await commitRunGitCloseout("run-1");
		await pushRunGitCloseout("run-1");

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"/api/overview?projectId=repo-1",
			undefined,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			6,
			"/api/workbench/sessions/task-1/messages",
			expect.objectContaining({
				method: "POST",
				signal: abortInit.signal,
				body: JSON.stringify({ content: "hello", waitForIntake: true }),
			}),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			11,
			"/api/tasks/task-1/test-mode-run",
			expect.objectContaining({ method: "POST" }),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			13,
			"/api/background-processes/process-1/stop",
			{
				method: "POST",
			},
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			15,
			"/api/workbench/sessions/task-1/archive",
			{
				method: "PATCH",
			},
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			20,
			"/api/review-sessions/review-1/run",
			expect.objectContaining({ method: "POST" }),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			22,
			"/api/runs/run-1/git/commit",
			expect.objectContaining({ method: "POST" }),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			23,
			"/api/runs/run-1/git/push",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("routes repository file and mission commands with encoded query params", async () => {
		const fetchMock = stubFetch();

		await browseFolders();
		await browseFolders("/tmp/project root");
		await createFolder({ parentPath: "/tmp", name: "new-folder" });
		await fetchRepositoryFiles("repo-1");
		await fetchRepositoryFiles("repo-1", "src/app file.ts");
		await fetchRepositoryFile("repo-1", "src/app file.ts");
		await fetchRepositoryDiff("repo-1");
		await fetchProjectDetailMetrics("repo-1");
		await fetchMissionGoals("repo-1");
		await createMissionGoal("repo-1", { title: "Goal" });
		await updateMissionGoal("repo-1", "goal-1", { title: "Updated" });
		await deleteMissionGoal("repo-1", "goal-1");
		await fetchMissionTaskCandidates("repo-1");
		await fetchMissionTaskCandidates("repo-1", "");
		await generateMissionTaskCandidates("repo-1");
		await updateMissionTaskCandidate("candidate-1", { status: "accepted" });
		await createTasksFromMissionCandidates("repo-1", {
			candidateIds: ["candidate-1"],
		});

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"/api/utils/browse-folders",
			undefined,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"/api/utils/browse-folders?path=%2Ftmp%2Fproject%20root",
			undefined,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			5,
			"/api/repositories/repo-1/files?path=src%2Fapp+file.ts",
			undefined,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			6,
			"/api/repositories/repo-1/file?path=src%2Fapp+file.ts",
			undefined,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			13,
			"/api/repositories/repo-1/mission-task-candidates?status=candidate",
			undefined,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			14,
			"/api/repositories/repo-1/mission-task-candidates",
			undefined,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			17,
			"/api/repositories/repo-1/mission-task-candidates/create-tasks",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("routes mission planning and proposal commands", async () => {
		const fetchMock = stubFetch();

		await fetchMissions("repo-1");
		await createMission("repo-1", { title: "Mission" });
		await generateMissionCandidatesFromGoals("repo-1");
		await fetchRepositoryMissionTaskProposals("repo-1");
		await fetchRepositoryMissionTaskProposals("repo-1", "");
		await fetchMissionDetail("mission-1");
		await deleteMission("mission-1");
		await decomposeMission("mission-1");
		await requestMissionPlanningRevision("result-1", { reason: "too broad" });
		await dismissMissionTaskProposal("proposal-1");
		await createTasksFromMissionTaskProposals({ proposalIds: ["proposal-1"] });

		expect(fetchMock).toHaveBeenNthCalledWith(
			3,
			"/api/repositories/repo-1/missions/generate-candidates",
			expect.objectContaining({ method: "POST" }),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			4,
			"/api/repositories/repo-1/mission-task-proposals?status=proposed",
			undefined,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			5,
			"/api/repositories/repo-1/mission-task-proposals",
			undefined,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(7, "/api/missions/mission-1", {
			method: "DELETE",
		});
		expect(fetchMock).toHaveBeenNthCalledWith(
			9,
			"/api/mission-planning-results/result-1/request-revision",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("routes unified task candidate generation", async () => {
		const fetchMock = stubFetch();

		await generateTaskCandidates("repo-1", { goalIds: ["goal-1"] });

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/repositories/repo-1/task-candidates/generate",
			expect.objectContaining({ method: "POST" }),
		);
	});
});
