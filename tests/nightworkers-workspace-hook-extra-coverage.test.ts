import { beforeEach, describe, expect, it, vi } from "vitest";

type Effect = () => undefined | (() => void);

let stateSlots: unknown[] = [];
let refSlots: Array<{ current: unknown }> = [];
let stateCursor = 0;
let refCursor = 0;
let effects: Effect[] = [];
let queryData: Record<string, unknown> = {};
let queryOptions: Record<string, Record<string, unknown>> = {};
let queryClient: ReturnType<typeof createQueryClient>;
let mutations: ReturnType<typeof createMutations>;
let projectFiles: ReturnType<typeof createProjectFiles>;
let resolveNextActiveSessionId = vi.fn();
let mergeRunEvents = vi.fn();
let codingAgentInstances: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];

const api = {
	getProjects: vi.fn(),
	getSessions: vi.fn(),
	getRuns: vi.fn(),
	getRunDetails: vi.fn(),
	fetchImplementationQueue: vi.fn(),
	fetchRunGitCloseout: vi.fn(),
	fetchTaskMessages: vi.fn(),
	fetchTaskLlmUsage: vi.fn(),
	fetchTaskActivityEvents: vi.fn(),
	fetchLatestTaskReviewSession: vi.fn(),
	fetchBackgroundProcessesForTask: vi.fn(),
};

function response(value: unknown, ok = true) {
	return {
		ok,
		json: vi.fn(async () => value),
	};
}

function createQueryClient() {
	return {
		invalidateQueries: vi.fn(),
		fetchQuery: vi.fn(async () => null as unknown),
	};
}

function mutation() {
	return {
		isPending: false,
		mutate: vi.fn(),
		mutateAsync: vi.fn(async (input?: unknown) => input ?? { ok: true }),
	};
}

function createMutations() {
	return {
		createProjectMutation: mutation(),
		deleteProjectMutation: mutation(),
		updateProjectMutation: mutation(),
		createSessionMutation: mutation(),
		deleteSessionMutation: mutation(),
		startRunMutation: mutation(),
		stopRunMutation: mutation(),
		resumeTodoMutation: mutation(),
		stopBackgroundProcessMutation: mutation(),
		queueSessionMutation: mutation(),
		commitRunGitCloseoutMutation: mutation(),
		pushRunGitCloseoutMutation: mutation(),
		updateSessionStatusMutation: mutation(),
		archiveCompletedSessionMutation: mutation(),
		restoreArchivedSessionMutation: mutation(),
		reorderQueueSessionsMutation: mutation(),
		moveWorkbenchSessionMutation: mutation(),
	};
}

function createProjectFiles() {
	return {
		projectFileEntries: [{ path: "src", type: "directory" }],
		projectFileEntriesByDirectory: { "": [] },
		expandedProjectDirectories: { src: true },
		loadingProjectDirectories: {},
		selectedProjectFile: null,
		selectedProjectFilePath: null,
		isProjectFilesLoading: false,
		isProjectFileLoading: false,
		projectDiff: null,
		isProjectDiffLoading: false,
		currentBrowserPath: "/repo",
		browserParentPath: "/",
		browserDirectories: [],
		isBrowserLoading: false,
		setProjectFileEntriesByDirectory: vi.fn(),
		fetchDirectories: vi.fn(async () => undefined),
		createFolder: vi.fn(async () => undefined),
		refreshProjectFiles: vi.fn(async () => undefined),
		refreshProjectDiff: vi.fn(async () => undefined),
		toggleProjectDirectory: vi.fn(async () => undefined),
		openProjectFile: vi.fn(async () => undefined),
	};
}

async function createHarness(
	initialState: unknown[] = [],
	data: Record<string, unknown> = {},
) {
	stateSlots = [...initialState];
	refSlots = [];
	stateCursor = 0;
	refCursor = 0;
	effects = [];
	queryData = data;
	queryOptions = {};
	queryClient = createQueryClient();
	mutations = createMutations();
	projectFiles = createProjectFiles();
	resolveNextActiveSessionId = vi.fn((current: string | null) => current);
	mergeRunEvents = vi.fn(({ restEvents }) => restEvents);
	codingAgentInstances = [];
	for (const mock of Object.values(api)) mock.mockReset();
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useEffect: (effect: Effect) => effects.push(effect),
			useMemo: <T>(factory: () => T) => factory(),
			useRef: <T>(initial: T) => {
				const index = refCursor++;
				refSlots[index] ??= { current: initial };
				return refSlots[index] as { current: T };
			},
			useState: <T>(initial: T) => {
				const index = stateCursor++;
				if (stateSlots.length <= index) stateSlots[index] = initial;
				const setter = vi.fn((next: T | ((current: T) => T)) => {
					stateSlots[index] =
						typeof next === "function"
							? (next as (current: T) => T)(stateSlots[index] as T)
							: next;
				});
				return [stateSlots[index] as T, setter] as const;
			},
		};
	});
	vi.doMock("@tanstack/react-query", () => ({
		useQueryClient: () => queryClient,
		useQuery: (options: { queryKey: unknown[] }) => {
			const key = String(options.queryKey[0]);
			queryOptions[key] = options as Record<string, unknown>;
			return {
				data: queryData[key],
				isLoading: key === "projects",
				isFetching: key === "sessions",
				refetch: vi.fn(async () => ({ data: queryData[key] })),
			};
		},
	}));
	vi.doMock("../src/lib/api", () => ({
		client: {
			repositories: { $get: api.getProjects },
			tasks: Object.assign(api.getSessions, {
				$get: api.getSessions,
				":id": { runs: { $get: api.getRuns } },
			}),
			runs: { ":id": { $get: api.getRunDetails } },
		},
	}));
	vi.doMock("../src/modules/codingAgent", () => ({
		CodingAgentCommandClient: class {
			dispose = vi.fn();

			constructor(input: { getConnection: () => unknown }) {
				input.getConnection();
				codingAgentInstances.push(this);
			}
		},
	}));
	vi.doMock("../src/modules/specification", () => ({
		planModeWorkspaceQueryOptions: (id: string | null) => ({
			queryKey: ["planModeWorkspace", id],
		}),
	}));
	vi.doMock("../src/modules/taskOperator", () => ({
		taskOperatorProjectionQueryOptions: (id: string | null) => ({
			queryKey: ["taskOperatorView", id],
		}),
	}));
	vi.doMock("../src/modules/nightworkers/nightWorkersCommands", () => ({
		fetchBackgroundProcessesForTask: api.fetchBackgroundProcessesForTask,
		fetchImplementationQueue: api.fetchImplementationQueue,
		fetchLatestTaskReviewSession: api.fetchLatestTaskReviewSession,
		fetchRunGitCloseout: api.fetchRunGitCloseout,
		fetchTaskActivityEvents: api.fetchTaskActivityEvents,
		fetchTaskLlmUsage: api.fetchTaskLlmUsage,
		fetchTaskMessages: api.fetchTaskMessages,
	}));
	vi.doMock("../src/modules/nightworkers/realtimeEvents", () => ({
		mergeRunEvents: (...args: unknown[]) => mergeRunEvents(...args),
	}));
	vi.doMock(
		"../src/modules/nightworkers/hooks/nightWorkersChatActions",
		() => ({
			createNightWorkersChatActions: () => ({
				submitInitialPrompt: vi.fn(),
				submitWorkbenchMessage: vi.fn(),
			}),
		}),
	);
	vi.doMock(
		"../src/modules/nightworkers/hooks/taskOperatorSessionProjection",
		() => ({
			overlayTaskOperatorSession: (session: unknown) => session,
		}),
	);
	vi.doMock(
		"../src/modules/nightworkers/hooks/useLatestRunSubscription",
		() => ({ useLatestRunSubscription: vi.fn() }),
	);
	vi.doMock(
		"../src/modules/nightworkers/hooks/useNightWorkersMutations",
		() => ({ useNightWorkersMutations: () => mutations }),
	);
	vi.doMock(
		"../src/modules/nightworkers/hooks/useNightWorkersProjectFiles",
		() => ({ useNightWorkersProjectFiles: () => projectFiles }),
	);
	vi.doMock(
		"../src/modules/nightworkers/hooks/useNightWorkersRealtime",
		() => ({ useNightWorkersRealtime: vi.fn() }),
	);
	vi.doMock(
		"../src/modules/nightworkers/hooks/useNightWorkersSessionPresentation",
		() => ({
			useNightWorkersSessionPresentation: () => ({
				activeArtifactRefs: [{ id: "artifact" }],
				activeSessionViewWithQueuePosition: { id: "session-view" },
				groupedSessionViews: { active: [] },
				sessionViews: [{ id: "session-view" }],
			}),
		}),
	);
	vi.doMock(
		"../src/modules/nightworkers/hooks/useNightWorkersSettings",
		() => ({
			useNightWorkersSettings: () => ({
				activeProvider: "openai",
				llmSettings: { OPENAI_MODEL: "gpt-5.3" },
				providerModelOptions: [],
			}),
		}),
	);
	vi.doMock(
		"../src/modules/nightworkers/hooks/useNightWorkersWorkspaceModel",
		() => ({
			emptyActivityReplay: { events: [], artifacts: [] },
			isActiveRunStatus: (status: string | undefined) => status === "running",
			isActiveTaskStatus: (status: string | undefined) => status === "running",
			normalizeActivityReplay: (value: unknown) => value,
			resolveNextActiveSessionId: (...args: unknown[]) =>
				resolveNextActiveSessionId(...args),
		}),
	);

	const { useNightWorkersWorkspace } = await import(
		"../src/modules/nightworkers/hooks/useNightWorkersWorkspace"
	);
	return {
		useWorkspace() {
			stateCursor = 0;
			refCursor = 0;
			effects = [];
			return useNightWorkersWorkspace();
		},
	};
}

function project(id = "repo-1") {
	return { id, name: id, localPath: `/tmp/${id}` };
}

function task(id = "task-1", repositoryId = "repo-1", status = "running") {
	return { id, repositoryId, status, title: id };
}

function run(id = "run-1", taskId = "task-1", status = "running") {
	return { id, taskId, status };
}

function operatorView(
	id = "task-1",
	availableIds = ["run.implementation.start", "run.stop", "run.todo.resume"],
) {
	return {
		task: { id, revision: 7 },
		commandCatalog: { availableIds },
	};
}

describe("useNightWorkersWorkspace extra coverage", () => {
	beforeEach(() => vi.restoreAllMocks());

	it("assembles defaults, selects the next session, and exposes empty derived data", async () => {
		const harness = await createHarness();
		resolveNextActiveSessionId.mockReturnValue("task-next");
		let workspace = harness.useWorkspace();
		expect(workspace.projects).toEqual([]);
		expect(workspace.sessions).toEqual([]);
		expect(workspace.activeSession).toBeNull();
		expect(workspace.activeProject).toBeNull();
		expect(workspace.latestRunEvents).toEqual([]);
		expect(workspace.latestRunTodos).toEqual([]);
		expect(workspace.latestRunReviews).toEqual([]);
		expect(workspace.activeStreamingResponse).toBe("");
		expect(workspace.isProjectListRefreshing).toBe(true);
		expect(workspace.isAgentWorking).toBe(false);

		await expect(queryOptions.sessionRuns.queryFn()).resolves.toEqual([]);
		await expect(queryOptions.gitCloseout.queryFn()).resolves.toBeNull();
		await expect(queryOptions.taskMessages.queryFn()).resolves.toEqual([]);
		await expect(queryOptions.llmUsage.queryFn()).resolves.toBeNull();
		await expect(queryOptions.activityReplay.queryFn()).resolves.toEqual({
			events: [],
			artifacts: [],
		});
		await expect(queryOptions.reviewSession.queryFn()).resolves.toBeNull();
		await expect(queryOptions.backgroundProcesses.queryFn()).resolves.toEqual(
			[],
		);
		await expect(queryOptions.runDetails.queryFn()).resolves.toBeNull();

		effects[0]();
		expect(stateSlots[0]).toBe("task-next");
		workspace = harness.useWorkspace();
		expect(codingAgentInstances).toHaveLength(1);
	});

	it("derives active state, realtime data, and delegates every mutation wrapper", async () => {
		const activeProject = project();
		const activeTask = task();
		const latestRun = run();
		const view = operatorView();
		const realtimeEvent = { id: "realtime", runId: "run-1", seq: 2 };
		const initialState = [
			"task-1",
			{ "repo-1": true },
			true,
			"connected",
			true,
			"run-1",
			"task-1",
			[realtimeEvent],
			{},
			{ "task-1": "streaming" },
		];
		const harness = await createHarness(initialState, {
			projects: [activeProject],
			sessions: [activeTask],
			implementationQueue: { queued: [] },
			sessionRuns: [latestRun],
			gitCloseout: { status: "ready" },
			taskMessages: [{ id: "message" }],
			taskOperatorView: view,
			planModeWorkspace: { taskId: "task-1" },
			llmUsage: { totalRequests: 1 },
			activityReplay: { events: [{ id: "activity" }], artifacts: [] },
			reviewSession: { id: "review" },
			backgroundProcesses: [{ id: "process" }],
			runDetails: {
				events: [{ id: "rest" }],
				todos: [{ id: "todo" }],
				reviews: [{ id: "review-item" }],
			},
		});
		const workspace = harness.useWorkspace();
		expect(workspace.activeSession).toBe(activeTask);
		expect(workspace.activeProject).toBe(activeProject);
		expect(workspace.latestRunEvents).toEqual([realtimeEvent]);
		expect(workspace.latestRunTodos).toEqual([{ id: "todo" }]);
		expect(workspace.activeStreamingResponse).toBe("streaming");
		expect(workspace.isAgentWorking).toBe(true);
		expect(workspace.isAgentThinking).toBe(true);

		workspace.createProject({ name: "new" } as never);
		workspace.deleteProject("repo-1");
		workspace.deleteSession("task-1");
		await workspace.updateProject("repo-1", { name: "updated" });
		await workspace.createSession({ repositoryId: "repo-1" } as never);
		await workspace.startRun("task-1");
		await workspace.stopRun("run-1");
		await workspace.resumeTodo({ runId: "run-1", todoId: "todo-1" } as never);
		await workspace.stopBackgroundProcess("process");
		await workspace.queueSession("task-1");
		await workspace.commitRunGitCloseout("run-1");
		await workspace.pushRunGitCloseout("run-1");
		await workspace.updateSessionStatus("task-1", "completed");
		await workspace.archiveCompletedSession("task-1", {
			discardPendingCloseouts: true,
		});
		await workspace.archiveCompletedSession("task-1");
		await workspace.restoreArchivedSession("task-1");
		await workspace.reorderQueueSessions(["task-1"]);
		await workspace.moveWorkbenchSession({ taskId: "task-1" } as never);
		expect(mutations.startRunMutation.mutateAsync).toHaveBeenCalledWith({
			taskId: "task-1",
			expectedTaskRevision: 7,
		});
		expect(mutations.stopRunMutation.mutateAsync).toHaveBeenCalledWith({
			taskId: "task-1",
			runId: "run-1",
			expectedTaskRevision: 7,
		});
		expect(
			mutations.archiveCompletedSessionMutation.mutateAsync,
		).toHaveBeenLastCalledWith({
			sessionId: "task-1",
			discardPendingCloseouts: undefined,
		});

		workspace.refreshWorkspace();
		expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(7);
		await workspace.refreshProjectList();
		expect(projectFiles.toggleProjectDirectory).toBe(
			workspace.toggleProjectDirectory,
		);
	});

	it("fetches command revisions remotely and rejects unavailable actions", async () => {
		const harness = await createHarness(["task-1"], {
			projects: [project()],
			sessions: [task()],
			sessionRuns: [run()],
			taskOperatorView: operatorView("other"),
		});
		queryClient.fetchQuery.mockResolvedValueOnce(operatorView("task-2"));
		let workspace = harness.useWorkspace();
		await workspace.startRun("task-2");
		expect(queryClient.fetchQuery).toHaveBeenCalled();

		queryClient.fetchQuery.mockResolvedValueOnce(operatorView("task-3", []));
		await expect(workspace.startRun("task-3")).rejects.toThrow(
			"Task Operator view is not ready",
		);
		queryClient.fetchQuery.mockResolvedValueOnce(null);
		await expect(workspace.startRun("task-4")).rejects.toThrow(
			"Task Operator view is not ready",
		);

		const noSessionHarness = await createHarness();
		workspace = noSessionHarness.useWorkspace();
		await expect(workspace.stopRun("run")).rejects.toThrow(
			"No active Task is available",
		);
		await expect(
			workspace.resumeTodo({ runId: "run", todoId: "todo" } as never),
		).rejects.toThrow("No active Task is available");
	});

	it("runs realtime merge and cleanup effects for missing and active runs", async () => {
		const emptyHarness = await createHarness([], {
			runDetails: { events: [{ id: "orphan" }] },
		});
		emptyHarness.useWorkspace();
		effects[2]();
		expect(mergeRunEvents).toHaveBeenCalledWith({
			latestRunId: null,
			restEvents: [{ id: "orphan" }],
			bufferedEventsByRun: {},
		});
		const cleanup = effects[1]();
		cleanup?.();
		expect(codingAgentInstances[0].dispose).toHaveBeenCalledOnce();

		const activeHarness = await createHarness(["task-1"], {
			projects: [project()],
			sessions: [task()],
			sessionRuns: [run()],
			runDetails: { events: [{ id: "rest" }] },
		});
		activeHarness.useWorkspace();
		effects[2]();
		expect(mergeRunEvents).toHaveBeenCalledWith({
			latestRunId: "run-1",
			restEvents: [{ id: "rest" }],
			bufferedEventsByRun: {},
		});
	});

	it("executes every query function through success and HTTP failure branches", async () => {
		const harness = await createHarness(["task-1"], {
			projects: [project()],
			sessions: [task()],
			sessionRuns: [run()],
		});
		harness.useWorkspace();
		const cases: Array<[string, ReturnType<typeof vi.fn>, unknown, string]> = [
			["projects", api.getProjects, [project()], "Failed to fetch projects"],
			["sessions", api.getSessions, [task()], "Failed to fetch sessions"],
			[
				"implementationQueue",
				api.fetchImplementationQueue,
				{ queued: [] },
				"Failed to fetch implementation queue",
			],
			["sessionRuns", api.getRuns, [run()], "Failed to fetch session runs"],
			[
				"gitCloseout",
				api.fetchRunGitCloseout,
				{ status: "ready" },
				"Failed to fetch Git closeout state",
			],
			[
				"taskMessages",
				api.fetchTaskMessages,
				[{ id: "message" }],
				"Failed to fetch task messages",
			],
			[
				"llmUsage",
				api.fetchTaskLlmUsage,
				{ totalRequests: 1 },
				"Failed to fetch LLM usage summary",
			],
			[
				"activityReplay",
				api.fetchTaskActivityEvents,
				{ events: [], artifacts: [] },
				"Failed to fetch activity events",
			],
			[
				"reviewSession",
				api.fetchLatestTaskReviewSession,
				{ id: "review" },
				"Failed to fetch Review Mode session",
			],
			[
				"backgroundProcesses",
				api.fetchBackgroundProcessesForTask,
				[{ id: "process" }],
				"Failed to fetch background processes",
			],
			[
				"runDetails",
				api.getRunDetails,
				{ events: [], todos: [], reviews: [] },
				"Failed to fetch run details",
			],
		];
		for (const [key, command, value, message] of cases) {
			command.mockResolvedValueOnce(response(value));
			await expect(queryOptions[key].queryFn()).resolves.toEqual(value);
			command.mockResolvedValueOnce(response({}, false));
			await expect(queryOptions[key].queryFn()).rejects.toThrow(message);
		}
	});

	it("falls back to REST events, the first project, and inactive status flags", async () => {
		const harness = await createHarness(
			[null, {}, false, "disconnected", false, null, null, [], {}, {}],
			{
				projects: [project("repo-first")],
				sessions: [],
				runDetails: {
					events: [{ id: "rest" }],
					todos: undefined,
					reviews: undefined,
				},
			},
		);
		const workspace = harness.useWorkspace();
		expect(workspace.activeProject?.id).toBe("repo-first");
		expect(workspace.latestRunEvents).toEqual([{ id: "rest" }]);
		expect(workspace.latestRunTodos).toEqual([]);
		expect(workspace.latestRunReviews).toEqual([]);
		expect(workspace.isAgentThinking).toBe(false);
		expect(workspace.realtimeStatus).toBe("disconnected");
	});
});
