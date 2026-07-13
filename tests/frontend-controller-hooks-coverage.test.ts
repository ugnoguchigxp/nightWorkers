import { describe, expect, it, vi } from "vitest";
import {
	buildActivityArtifact,
	buildTask,
	buildTaskMessage,
	buildTaskRun,
} from "./helpers/nightworkers-fixtures";

let stateValues: unknown[] = [];
let effectMode: "skip" | "run" = "skip";

function mockReactHooks(values: unknown[] = [], mode: "skip" | "run" = "skip") {
	stateValues = [...values];
	effectMode = mode;
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useCallback: <T extends (...args: never[]) => unknown>(callback: T) =>
				callback,
			useEffect: (callback: () => undefined | (() => void)) => {
				if (effectMode === "run") callback();
			},
			useMemo: <T>(factory: () => T) => factory(),
			useRef: <T>(initial: T) => ({ current: initial }),
			useState: <T>(initial: T | (() => T)) => {
				const value =
					stateValues.length > 0
						? (stateValues.shift() as T)
						: typeof initial === "function"
							? (initial as () => T)()
							: initial;
				const setValue = vi.fn((next: T | ((previous: T) => T)) => {
					if (typeof next === "function") (next as (previous: T) => T)(value);
				});
				return [value, setValue] as const;
			},
		};
	});
}

function jsonResponse(body: unknown, init?: ResponseInit) {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
		...init,
	});
}

function createQueryClient() {
	return {
		invalidateQueries: vi.fn(),
		setQueryData: vi.fn(),
	};
}

function projectFixture() {
	return {
		id: "repo-1",
		name: "NightWorkers",
		localPath: "/Users/y.noguchi/Code/nightWorkers",
		branch: "main",
		allowed: true,
		queueEnabled: true,
		maxConcurrentSessions: 2,
		createdAt: "2026-07-08T00:00:00.000Z",
		updatedAt: "2026-07-08T00:00:00.000Z",
	};
}

function mutationFixture() {
	const mutation = {
		isPending: false,
		mutate: vi.fn(),
		mutateAsync: vi.fn(async (input?: unknown) => input ?? { ok: true }),
	};
	return {
		createProjectMutation: mutation,
		deleteProjectMutation: mutation,
		updateProjectMutation: mutation,
		createSessionMutation: mutation,
		deleteSessionMutation: mutation,
		startRunMutation: mutation,
		stopRunMutation: mutation,
		stopBackgroundProcessMutation: mutation,
		queueSessionMutation: mutation,
		submitRunReviewMutation: mutation,
		startReviewSessionMutation: mutation,
		startReviewRunMutation: mutation,
		commitRunGitCloseoutMutation: mutation,
		pushRunGitCloseoutMutation: mutation,
		updateSessionStatusMutation: mutation,
		reorderQueueSessionsMutation: mutation,
		moveWorkbenchSessionMutation: mutation,
	};
}

describe("frontend controller hook coverage", () => {
	it("assembles NightWorkers workspace state and exposes mutation wrappers", async () => {
		const project = projectFixture();
		const task = buildTask({
			id: "task-1",
			repositoryId: project.id,
			status: "running",
			priority: 3,
		});
		const run = buildTaskRun({
			id: "run-1",
			taskId: task.id,
			repositoryId: project.id,
			status: "running",
		});
		const queryClient = createQueryClient();
		mockReactHooks([
			task.id,
			{ [project.id]: true },
			true,
			"connected",
			true,
			run.id,
			task.id,
			[
				{
					id: "event-1",
					runId: run.id,
					taskRunId: run.id,
					seq: 2,
					type: "checkpoint",
					actor: "system",
					eventType: "system.info",
					message: "Realtime event",
					payloadJson: {},
					timestamp: "2026-07-08T00:00:00.000Z",
					createdAt: "2026-07-08T00:00:00.000Z",
				},
			],
			{},
			{ [task.id]: "streaming response" },
		]);
		vi.doMock("@tanstack/react-query", () => ({
			queryOptions: <T>(options: T) => options,
			useQueryClient: () => queryClient,
			useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
				const key = queryKey[0];
				const dataByKey: Record<string, unknown> = {
					projects: [project],
					sessions: [task],
					implementationQueue: {
						queued: [],
						processors: [],
						completed: [],
						notQueued: [],
					},
					sessionRuns: [run],
					gitCloseout: { status: "ready", files: [] },
					taskMessages: [
						buildTaskMessage({
							id: "message-1",
							taskId: task.id,
							content: "# Plan",
							messageType: "markdown_document",
						}),
					],
					planModeWorkspace: {
						taskId: task.id,
						repositoryId: project.id,
						generatedAt: "2026-07-08T00:00:00.000Z",
						featurePlanArtifacts: [],
						blueprintArtifacts: [],
						dataModelArtifacts: [],
						dedicatedViewArtifacts: [],
						questionnaireSessions: [],
						decisionReviews: [],
						implementationReferences: [],
					},
					llmUsage: { totalRequests: 1, totalCost: 0.1 },
					activityReplay: {
						events: [],
						artifacts: [buildActivityArtifact({ taskId: task.id })],
					},
					reviewSession: {
						session: {
							id: "review-1",
							taskId: task.id,
							runId: run.id,
							updatedAt: "2026-07-08T00:00:00.000Z",
						},
						recommendation: { level: "approved" },
						statusArtifact: { sections: [] },
					},
					backgroundProcesses: [{ id: "process-1", taskId: task.id }],
					runDetails: {
						events: [],
						todos: [{ id: "todo-1", status: "pending" }],
						reviews: [],
					},
				};
				return {
					data: dataByKey[String(key)],
					isLoading: false,
					isFetching: false,
					refetch: vi.fn(async () => ({ data: dataByKey[String(key)] })),
				};
			},
		}));
		vi.doMock(
			"../src/modules/nightworkers/hooks/useNightWorkersMutations",
			() => ({ useNightWorkersMutations: () => mutationFixture() }),
		);
		vi.doMock(
			"../src/modules/nightworkers/hooks/useNightWorkersProjectFiles",
			() => ({
				useNightWorkersProjectFiles: () => ({
					projectFileEntries: [],
					projectFileEntriesByDirectory: {},
					expandedProjectDirectories: {},
					loadingProjectDirectories: {},
					selectedProjectFile: null,
					selectedProjectFilePath: null,
					isProjectFilesLoading: false,
					isProjectFileLoading: false,
					projectDiff: null,
					isProjectDiffLoading: false,
					currentBrowserPath: "",
					browserParentPath: null,
					browserDirectories: [],
					isBrowserLoading: false,
					setProjectFileEntriesByDirectory: vi.fn(),
					fetchDirectories: vi.fn(async () => undefined),
					createFolder: vi.fn(async () => undefined),
					refreshProjectFiles: vi.fn(async () => undefined),
					refreshProjectDiff: vi.fn(async () => undefined),
					toggleProjectDirectory: vi.fn(),
					openProjectFile: vi.fn(async () => undefined),
				}),
			}),
		);
		vi.doMock(
			"../src/modules/nightworkers/hooks/useNightWorkersRealtime",
			() => ({ useNightWorkersRealtime: vi.fn() }),
		);
		vi.doMock(
			"../src/modules/nightworkers/hooks/useNightWorkersSettings",
			() => ({
				useNightWorkersSettings: () => ({
					activeProvider: "openai",
					llmSettings: { ACTIVE_LLM_PROVIDER: "openai" },
					providerModelOptions: [{ value: "gpt-5", label: "GPT-5" }],
				}),
			}),
		);
		const { useNightWorkersWorkspace } = await import(
			"../src/modules/nightworkers/hooks/useNightWorkersWorkspace"
		);

		const workspace = useNightWorkersWorkspace();

		expect(workspace.activeSession?.id).toBe(task.id);
		expect(workspace.activeProject?.id).toBe(project.id);
		expect(workspace.activeStreamingResponse).toBe("streaming response");
		workspace.refreshWorkspace();
		await workspace.refreshProjectList();
		workspace.createProject({ name: "New", localPath: "/tmp/new" });
		await workspace.updateProject(project.id, { name: "Updated" });
		workspace.deleteProject(project.id);
		await workspace.createSession({
			repositoryId: project.id,
			title: "New",
			description: "",
			objective: "",
			acceptanceCriteria: "",
		});
		await workspace.startRun(task.id);
		await workspace.stopRun(run.id);
		await workspace.queueSession(task.id);
		await workspace.submitRunReview(run.id, { status: "approved" });
		await workspace.startReviewSession(run.id);
		await workspace.startReviewRun("review-1");
		await workspace.commitRunGitCloseout(run.id);
		await workspace.pushRunGitCloseout(run.id);
		await workspace.updateSessionStatus(task.id, "completed");
		await workspace.reorderQueueSessions([task.id]);
		await workspace.moveWorkbenchSession({ taskId: task.id, group: "archive" });
		expect(queryClient.invalidateQueries).toHaveBeenCalled();
	});

	it("runs project evaluation controller actions with stubbed responses", async () => {
		const queryClient = createQueryClient();
		const task = buildTask({ id: "created-task-1" });
		const detail = {
			evaluation: {
				id: "eval-1",
				repositoryId: "repo-1",
				status: "completed",
				createdAt: "2026-07-08T00:00:00.000Z",
				updatedAt: "2026-07-08T00:00:00.000Z",
			},
			scores: [],
			improvements: [{ id: "idea-1", title: "Improve tests" }],
			taskLinks: [],
			activityEvents: [
				{
					id: "activity-1",
					evaluationId: "eval-1",
					seq: 1,
					type: "info",
					message: "started",
					payloadJson: {},
					createdAt: "2026-07-08T00:00:00.000Z",
				},
			],
		};
		mockReactHooks([
			[{ id: "eval-1", status: "completed" }],
			detail,
			"eval-1",
			new Set(["maintainability"]),
			new Set(["idea-1"]),
			false,
			false,
			false,
			false,
			null,
		]);
		vi.doMock("@tanstack/react-query", () => ({
			useQueryClient: () => queryClient,
		}));
		vi.doMock(
			"../src/modules/project-evaluation/api/projectEvaluationCommands",
			() => ({
				fetchProjectEvaluationHistory: vi.fn(async () =>
					jsonResponse([{ id: "eval-1", status: "completed" }]),
				),
				fetchProjectEvaluationDetail: vi.fn(async () => jsonResponse(detail)),
				startProjectEvaluation: vi.fn(async () =>
					jsonResponse({ evaluationId: "eval-2", detail }),
				),
				fetchProjectEvaluationActivityEvents: vi.fn(async () =>
					jsonResponse({
						status: "completed",
						events: [
							{
								id: "activity-2",
								evaluationId: "eval-1",
								seq: 2,
								type: "info",
								message: "completed",
								payloadJson: {},
								createdAt: "2026-07-08T00:00:01.000Z",
							},
						],
					}),
				),
				generateProjectImprovements: vi.fn(async () =>
					jsonResponse({ ideas: [{ id: "idea-2", title: "Add tests" }] }),
				),
				createProjectEvaluationTasks: vi.fn(async () =>
					jsonResponse({
						tasks: [task],
						taskLinks: [{ id: "link-1", taskId: task.id, ideaId: "idea-1" }],
					}),
				),
			}),
		);
		const {
			useProjectEvaluationController,
			mergeCreatedProjectEvaluationTasks,
		} = await import(
			"../src/modules/project-evaluation/hooks/useProjectEvaluationController"
		);
		const onTasksCreated = vi.fn();

		// Test mergeCreatedProjectEvaluationTasks directly
		const currentTasks = [buildTask({ id: "task-1" })];
		const createdTasks = [buildTask({ id: "task-2" })];
		expect(mergeCreatedProjectEvaluationTasks(currentTasks, [])).toBe(
			currentTasks,
		);
		const merged = mergeCreatedProjectEvaluationTasks(
			currentTasks,
			createdTasks,
		);
		expect(merged.length).toBe(2);

		const controller = useProjectEvaluationController("repo-1", {
			onTasksCreated,
		});

		expect(controller.previousEvaluation).toBeNull();
		await controller.runEvaluation();
		await controller.selectEvaluation("eval-1");
		await controller.generateIdeas();
		await controller.createTasks();
		controller.toggleIdea("idea-1");
		// Toggle again to hit the delete branch
		controller.toggleIdea("idea-1");
		// Toggle new one to hit the add branch
		controller.toggleIdea("idea-2");

		// Execute queryClient.setQueryData mock callback to cover line 276
		expect(queryClient.setQueryData).toHaveBeenCalled();
		const setQueryDataCall = queryClient.setQueryData.mock.calls[0];
		const callback = setQueryDataCall[1];
		if (typeof callback === "function") {
			const updated = callback(currentTasks);
			expect(updated.length).toBe(2);
		}

		expect(onTasksCreated).toHaveBeenCalledWith([task]);

		// Cover error branch in createTasks
		const mockCommands = await import(
			"../src/modules/project-evaluation/api/projectEvaluationCommands"
		);
		vi.mocked(mockCommands.createProjectEvaluationTasks).mockRejectedValueOnce(
			new Error("Creation failed"),
		);
		await controller.createTasks();
		expect(mockCommands.createProjectEvaluationTasks).toHaveBeenCalledTimes(2);
	});
});
