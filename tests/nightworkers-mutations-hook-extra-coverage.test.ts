import { beforeEach, describe, expect, it, vi } from "vitest";
import { repositoryQueryKeys } from "../src/modules/nightworkers/queries/repository-queries";

type MutationConfig = {
	mutationFn: (...args: unknown[]) => Promise<unknown>;
	onMutate?: (...args: unknown[]) => Promise<unknown> | unknown;
	onError?: (...args: unknown[]) => Promise<unknown> | unknown;
	onSuccess?: (...args: unknown[]) => Promise<unknown> | unknown;
	onSettled?: (...args: unknown[]) => Promise<unknown> | unknown;
};

let configs: MutationConfig[] = [];
let commandCallbacks: Record<string, (...args: unknown[]) => unknown> = {};
let cache = new Map<string, unknown>();
let activeSessionId: string | null = "task-1";

const queryClient = {
	cancelQueries: vi.fn(async () => undefined),
	getQueryData: vi.fn((key: unknown[]) => cache.get(JSON.stringify(key))),
	setQueryData: vi.fn((key: unknown[], value: unknown) => {
		const cacheKey = JSON.stringify(key);
		const previous = cache.get(cacheKey);
		const next =
			typeof value === "function"
				? (value as (current: unknown) => unknown)(previous)
				: value;
		cache.set(cacheKey, next);
		return next;
	}),
	invalidateQueries: vi.fn(),
	removeQueries: vi.fn(),
};
const setActiveSessionId = vi.fn(
	(value: string | null | ((current: string | null) => string | null)) => {
		activeSessionId =
			typeof value === "function" ? value(activeSessionId) : value;
	},
);

const api = {
	createProject: vi.fn(),
	deleteProject: vi.fn(),
	updateProject: vi.fn(),
	createSession: vi.fn(),
	deleteTask: vi.fn(),
	stopBackgroundProcess: vi.fn(),
	queueSession: vi.fn(),
	commitCloseout: vi.fn(),
	pushCloseout: vi.fn(),
	archiveSession: vi.fn(),
	restoreSession: vi.fn(),
};
const helpers = {
	mergeRealtimeRunDetails: vi.fn(),
	mergeRealtimeRunList: vi.fn(),
	syncGitCloseoutMutationCache: vi.fn(),
	buildPriorityUpdates: vi.fn(),
	invalidateCommandFailure: vi.fn(),
	patchTask: vi.fn(),
	refreshTaskNavigationQueries: vi.fn(async () => undefined),
	resolveNextActiveSessionId: vi.fn(() => "task-next"),
	syncTaskNavigationCaches: vi.fn(),
};

function response(value: unknown, ok = true, message = "request failed") {
	return {
		ok,
		status: ok ? 200 : 500,
		headers: { get: vi.fn(() => null) },
		json: vi.fn(async () =>
			ok ? value : { error: { code: "TEST_FAILURE", message } },
		),
		text: vi.fn(async () => message),
	};
}

function task(id: string, status = "draft", priority = 1) {
	return { id, repositoryId: "repo-1", title: id, status, priority };
}

function run(id: string, taskId = "task-1", status = "running") {
	return { id, taskId, status };
}

function config(index: number) {
	const value = configs[index];
	if (!value) throw new Error(`Missing mutation config ${index}`);
	return value;
}

async function useMutationHarness(sessionId: string | null = "task-1") {
	configs = [];
	commandCallbacks = {};
	cache = new Map();
	activeSessionId = sessionId;
	setActiveSessionId.mockClear();
	for (const mock of Object.values(api)) mock.mockReset();
	for (const mock of Object.values(helpers)) mock.mockReset();
	helpers.mergeRealtimeRunList.mockImplementation(
		(previous: unknown[], value: unknown) => [...previous, value],
	);
	helpers.mergeRealtimeRunDetails.mockImplementation(
		(previous: unknown, value: unknown) => ({ previous, value }),
	);
	helpers.buildPriorityUpdates.mockImplementation((ids: string[]) =>
		ids.map((id, index) => ({ sessionId: id, priority: ids.length - index })),
	);
	helpers.patchTask.mockImplementation(
		async (id: string, patch: Record<string, unknown>) => ({
			...task(id),
			...patch,
		}),
	);
	helpers.resolveNextActiveSessionId.mockReturnValue("task-next");
	helpers.refreshTaskNavigationQueries.mockResolvedValue(undefined);
	queryClient.cancelQueries.mockClear();
	queryClient.getQueryData.mockClear();
	queryClient.setQueryData.mockClear();
	queryClient.invalidateQueries.mockClear();
	queryClient.removeQueries.mockClear();
	vi.resetModules();
	vi.doMock("@tanstack/react-query", () => ({
		useMutation: (input: MutationConfig) => {
			configs.push(input);
			return input;
		},
	}));
	vi.doMock("../src/lib/api", () => ({
		client: {
			repositories: {
				$post: api.createProject,
				":id": {
					$delete: api.deleteProject,
					$patch: api.updateProject,
				},
			},
		},
	}));
	vi.doMock("../src/modules/codingAgent", () => ({
		useCodingAgentCommandMutations: (input: Record<string, unknown>) => {
			commandCallbacks = input as typeof commandCallbacks;
			return {
				startRunMutation: { name: "start" },
				stopRunMutation: { name: "stop" },
				resumeTodoMutation: { name: "resume" },
			};
		},
	}));
	vi.doMock("../src/modules/nightworkers/nightWorkersCommands", () => ({
		archiveWorkbenchSession: api.archiveSession,
		commitRunGitCloseout: api.commitCloseout,
		createWorkbenchSession: api.createSession,
		deleteTask: api.deleteTask,
		pushRunGitCloseout: api.pushCloseout,
		queueWorkbenchSession: api.queueSession,
		restoreWorkbenchSessionArchive: api.restoreSession,
		stopBackgroundProcess: api.stopBackgroundProcess,
	}));
	vi.doMock("../src/modules/nightworkers/realtimeEvents", () => ({
		mergeRealtimeRunDetails: helpers.mergeRealtimeRunDetails,
		mergeRealtimeRunList: helpers.mergeRealtimeRunList,
	}));
	vi.doMock(
		"../src/modules/nightworkers/hooks/gitCloseoutMutationCache",
		() => ({
			syncGitCloseoutMutationCache: helpers.syncGitCloseoutMutationCache,
		}),
	);
	vi.doMock(
		"../src/modules/nightworkers/hooks/nightWorkersMutationHelpers",
		() => ({
			buildPriorityUpdates: helpers.buildPriorityUpdates,
			invalidateCommandFailure: helpers.invalidateCommandFailure,
			patchTask: helpers.patchTask,
			refreshTaskNavigationQueries: helpers.refreshTaskNavigationQueries,
			resolveNextActiveSessionId: helpers.resolveNextActiveSessionId,
			syncTaskNavigationCaches: helpers.syncTaskNavigationCaches,
		}),
	);

	const { useNightWorkersMutations } = await import(
		"../src/modules/nightworkers/hooks/useNightWorkersMutations"
	);
	return useNightWorkersMutations({
		activeSessionId: sessionId,
		queryClient: queryClient as never,
		setActiveSessionId,
		codingAgentCommandClient: {} as never,
	});
}

describe("useNightWorkersMutations extra coverage", () => {
	beforeEach(() => vi.restoreAllMocks());

	it("runs project mutation success, failure, optimistic, and rollback branches", async () => {
		await useMutationHarness();
		const existing = [
			{ id: "repo-1", name: "one", branch: "main" },
			{ id: "repo-2", name: "two", branch: "dev" },
		];
		cache.set(JSON.stringify(repositoryQueryKeys.all), existing);

		api.createProject.mockResolvedValueOnce(response({ id: "created" }));
		expect(
			await config(0).mutationFn({
				name: "created",
				localPath: "/tmp",
				branch: "",
			}),
		).toEqual({ id: "created" });
		expect(api.createProject).toHaveBeenCalledWith({
			json: { name: "created", localPath: "/tmp", branch: "main" },
		});
		api.createProject.mockResolvedValueOnce(
			response({}, false, "create failed"),
		);
		await expect(
			config(0).mutationFn({ name: "bad", localPath: "/tmp", branch: "dev" }),
		).rejects.toThrow("create failed");
		await config(0).onSuccess?.();

		api.deleteProject.mockResolvedValueOnce(response({ ok: true }));
		await expect(config(1).mutationFn("repo-2")).resolves.toEqual({ ok: true });
		api.deleteProject.mockResolvedValueOnce(response({}, false));
		await expect(config(1).mutationFn("repo-2")).rejects.toThrow(
			"request failed",
		);
		await config(1).onSuccess?.();
		expect(activeSessionId).toBeNull();

		api.updateProject.mockResolvedValueOnce(
			response({ id: "repo-1", name: "server" }),
		);
		await expect(
			config(2).mutationFn({ id: "repo-1", data: { name: "local" } }),
		).resolves.toEqual({ id: "repo-1", name: "server" });
		api.updateProject.mockResolvedValueOnce(
			response({}, false, "update failed"),
		);
		await expect(
			config(2).mutationFn({ id: "repo-1", data: { name: "bad" } }),
		).rejects.toThrow("update failed");

		const context = await config(2).onMutate?.({
			id: "repo-1",
			data: { name: "optimistic" },
		});
		expect(cache.get(JSON.stringify(repositoryQueryKeys.all))).toEqual([
			expect.objectContaining({ id: "repo-1", name: "optimistic" }),
			expect.objectContaining({ id: "repo-2", name: "two" }),
		]);
		await config(2).onError?.(new Error("x"), {}, context);
		expect(cache.get(JSON.stringify(repositoryQueryKeys.all))).toBe(existing);
		await config(2).onError?.(new Error("x"), {}, undefined);
		await config(2).onSuccess?.({ id: "repo-1", name: "server" });
		await config(2).onSuccess?.({ id: "repo-new", name: "new" });
		await config(2).onSettled?.();
		expect(queryClient.cancelQueries).toHaveBeenCalledWith({
			queryKey: repositoryQueryKeys.all,
		});
		expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
			queryKey: repositoryQueryKeys.all,
		});
	});

	it("handles create/delete/queue session cache insertion and replacement", async () => {
		await useMutationHarness("task-created");
		cache.set(JSON.stringify(["sessions"]), [
			task("task-1"),
			task("task-created"),
		]);
		api.createSession.mockResolvedValueOnce(response(task("task-created")));
		await expect(config(3).mutationFn({ title: "created" })).resolves.toEqual(
			task("task-created"),
		);
		api.createSession.mockResolvedValueOnce(response({}, false));
		await expect(config(3).mutationFn({ title: "bad" })).rejects.toThrow(
			"request failed",
		);
		await config(3).onSuccess?.(task("task-created", "ready"));
		await config(3).onSuccess?.(task("task-new"));
		expect(activeSessionId).toBe("task-new");

		api.deleteTask.mockResolvedValueOnce(response({ ok: true }));
		await expect(config(4).mutationFn("task-created")).resolves.toEqual({
			ok: true,
		});
		api.deleteTask.mockResolvedValueOnce(response({}, false));
		await expect(config(4).mutationFn("task-created")).rejects.toThrow(
			"request failed",
		);
		await config(4).onSuccess?.({}, "task-created");
		expect(helpers.resolveNextActiveSessionId).toHaveBeenCalled();
		expect(queryClient.removeQueries).toHaveBeenCalledTimes(2);

		api.queueSession.mockResolvedValueOnce(response(task("task-1", "queued")));
		await expect(config(6).mutationFn("task-1")).resolves.toMatchObject({
			status: "queued",
		});
		api.queueSession.mockResolvedValueOnce(response({}, false, "queue failed"));
		await expect(config(6).mutationFn("task-1")).rejects.toThrow(
			"queue failed",
		);
		await config(6).onSuccess?.(task("task-1", "queued"));
		await config(6).onSuccess?.(task("task-insert", "queued"));
	});

	it("synchronizes command mutation success and failure callbacks", async () => {
		await useMutationHarness();
		cache.set(JSON.stringify(["sessions"]), [task("task-1"), task("other")]);
		cache.set(JSON.stringify(["sessionRuns", "task-1"]), [run("old")]);
		cache.set(JSON.stringify(["runDetails", "run-1"]), { events: [] });
		await commandCallbacks.onFailure("task-1", new Error("command"));
		expect(helpers.invalidateCommandFailure).toHaveBeenCalled();

		await commandCallbacks.onStartSuccess(run("run-1"));
		expect(helpers.mergeRealtimeRunList).toHaveBeenCalled();
		expect(helpers.mergeRealtimeRunDetails).toHaveBeenCalled();
		helpers.mergeRealtimeRunDetails.mockReturnValueOnce(null);
		await commandCallbacks.onStartSuccess(run("run-2"));

		await commandCallbacks.onStopSuccess(run("run-1", "task-1", "cancelled"));
		await commandCallbacks.onStopSuccess(run("run-new", "task-1", "cancelled"));
		await commandCallbacks.onResumeSuccess(run("run-1"));
		expect(cache.get(JSON.stringify(["sessions"]))).toEqual([
			expect.objectContaining({ id: "task-1", status: "running" }),
			expect.objectContaining({ id: "other" }),
		]);
	});

	it("handles background, git closeout, and status mutation branches", async () => {
		await useMutationHarness();
		cache.set(JSON.stringify(["backgroundProcesses", "task-1"]), [
			{ id: "process-1", taskId: "task-1", status: "running" },
		]);
		api.stopBackgroundProcess.mockResolvedValueOnce(
			response({ id: "process-1", taskId: "task-1", status: "stopped" }),
		);
		await config(5).mutationFn("process-1");
		api.stopBackgroundProcess.mockResolvedValueOnce(
			response({}, false, "stop failed"),
		);
		await expect(config(5).mutationFn("process-1")).rejects.toThrow(
			"stop failed",
		);
		await config(5).onSuccess?.({
			id: "process-1",
			taskId: "task-1",
			status: "stopped",
		});
		await config(5).onSuccess?.({
			id: "missing",
			taskId: null,
			status: "stopped",
		});

		api.commitCloseout.mockResolvedValueOnce(response({ runId: "run-1" }));
		api.pushCloseout.mockResolvedValueOnce(response({ runId: "run-1" }));
		await config(7).mutationFn("run-1");
		await config(8).mutationFn("run-1");
		for (const index of [7, 8]) {
			const command = index === 7 ? api.commitCloseout : api.pushCloseout;
			command.mockResolvedValueOnce(response({}, false, "git failed"));
			await expect(config(index).mutationFn("run-1")).rejects.toThrow(
				"git failed",
			);
			await config(index).onSuccess?.({ runId: "run-1" });
		}
		expect(helpers.syncGitCloseoutMutationCache).toHaveBeenNthCalledWith(
			1,
			queryClient,
			{ runId: "run-1" },
			"task-1",
		);

		cache.set(JSON.stringify(["sessions"]), [task("task-1"), task("other")]);
		await config(9).mutationFn({ sessionId: "task-1", status: "ready" });
		const context = await config(9).onMutate?.({
			sessionId: "task-1",
			status: "ready",
		});
		await config(9).onError?.(new Error("x"), {}, context);
		await config(9).onError?.(new Error("x"), {}, undefined);
		await config(9).onSuccess?.(task("task-1", "ready"));
		await config(9).onSuccess?.(task("inserted", "ready"));
	});

	it("refreshes archive/restore caches on success and error", async () => {
		await useMutationHarness();
		api.archiveSession.mockResolvedValueOnce(
			response(task("task-1", "archived")),
		);
		await expect(
			config(10).mutationFn({
				sessionId: "task-1",
				discardPendingCloseouts: true,
			}),
		).resolves.toMatchObject({ status: "archived" });
		api.archiveSession.mockResolvedValueOnce(
			response({}, false, "archive failed"),
		);
		await expect(
			config(10).mutationFn({ sessionId: "task-1" }),
		).rejects.toThrow("archive failed");
		await config(10).onSuccess?.(task("task-1", "archived"));
		await config(10).onError?.(new Error("x"), { sessionId: "task-error" });

		api.restoreSession.mockResolvedValueOnce(response(task("task-1", "ready")));
		await expect(config(11).mutationFn("task-1")).resolves.toMatchObject({
			status: "ready",
		});
		api.restoreSession.mockResolvedValueOnce(
			response({}, false, "restore failed"),
		);
		await expect(config(11).mutationFn("task-1")).rejects.toThrow(
			"restore failed",
		);
		await config(11).onSuccess?.(task("task-1", "ready"));
		await config(11).onError?.(new Error("x"), "task-error");
		expect(helpers.syncTaskNavigationCaches).toHaveBeenCalledTimes(2);
		expect(helpers.refreshTaskNavigationQueries).toHaveBeenCalledTimes(4);
	});

	it("covers reorder optimistic updates, reconciliation, rollback, and empty cache", async () => {
		await useMutationHarness();
		cache.set(JSON.stringify(["sessions"]), [
			task("a", "queued", 1),
			task("b", "queued", 2),
			task("c", "draft", 3),
		]);
		await config(12).mutationFn(["b", "a"]);
		expect(helpers.patchTask).toHaveBeenCalledTimes(2);
		cache.delete(JSON.stringify(["sessions"]));
		await config(12).mutationFn([]);

		cache.set(JSON.stringify(["sessions"]), [
			task("a", "queued", 1),
			task("b", "queued", 2),
			task("c", "draft", 3),
		]);
		const context = await config(12).onMutate?.(["b", "a"]);
		expect(cache.get(JSON.stringify(["sessions"]))).toEqual([
			expect.objectContaining({ id: "a", priority: 1 }),
			expect.objectContaining({ id: "b", priority: 2 }),
			expect.objectContaining({ id: "c", priority: 3 }),
		]);
		await config(12).onError?.(new Error("x"), [], context);
		await config(12).onError?.(new Error("x"), [], undefined);
		await config(12).onSuccess?.([task("a", "queued", 9)]);
		await config(12).onSettled?.();
	});

	it("moves sessions between every group and applies optimistic statuses", async () => {
		await useMutationHarness();
		cache.set(JSON.stringify(["sessions"]), [
			task("a", "queued", 1),
			task("b", "draft", 2),
			task("c", "draft", 3),
		]);
		const base = {
			sessionId: "a",
			processingIds: ["b"],
			queueIds: ["a"],
			archiveIds: ["c"],
		};
		await config(13).mutationFn({
			...base,
			sourceGroup: "queue",
			targetGroup: "processing",
		});
		api.queueSession.mockResolvedValueOnce(response(task("a", "queued")));
		await config(13).mutationFn({
			...base,
			sourceGroup: "processing",
			targetGroup: "queue",
		});
		api.queueSession.mockResolvedValueOnce(
			response({}, false, "move queue failed"),
		);
		await expect(
			config(13).mutationFn({
				...base,
				sourceGroup: "processing",
				targetGroup: "queue",
			}),
		).rejects.toThrow("move queue failed");
		api.archiveSession.mockResolvedValueOnce(response(task("a", "cancelled")));
		await config(13).mutationFn({
			...base,
			sourceGroup: "processing",
			targetGroup: "archive",
		});
		api.archiveSession.mockResolvedValueOnce(
			response({}, false, "move archive failed"),
		);
		await expect(
			config(13).mutationFn({
				...base,
				sourceGroup: "processing",
				targetGroup: "archive",
			}),
		).rejects.toThrow("move archive failed");
		await config(13).mutationFn({
			...base,
			sourceGroup: "archive",
			targetGroup: "processing",
		});

		for (const targetGroup of ["queue", "processing", "archive"] as const) {
			const context = await config(13).onMutate?.({
				...base,
				sourceGroup: "processing",
				targetGroup,
			});
			expect(context).toBeDefined();
		}
		await config(13).onMutate?.({
			...base,
			sessionId: "missing",
			sourceGroup: "archive",
			targetGroup: "processing",
		});
		const context = { previous: [task("restore")] };
		await config(13).onError?.(new Error("x"), {}, context);
		await config(13).onError?.(new Error("x"), {}, undefined);
		await config(13).onSettled?.();
		expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["runDetails"],
		});
	});
});
