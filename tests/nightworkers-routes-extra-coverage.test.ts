import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../api/lib/errors";

const mocks = vi.hoisted(() => {
	const handlers = new Map<string, (context: unknown) => Promise<Response>>();
	const externalHandler = vi.fn();
	return {
		handlers,
		externalHandler,
		startHumanImplementation: vi.fn(),
		logEvent: vi.fn(),
		loggerError: vi.fn(),
		listRepositories: vi.fn(),
		createRepository: vi.fn(),
		getRepository: vi.fn(),
		updateRepository: vi.fn(),
		listProjectFiles: vi.fn(),
		readProjectFile: vi.fn(),
		readRepositoryDiff: vi.fn(),
		deleteRepository: vi.fn(),
		listTasks: vi.fn(),
		createTask: vi.fn(),
		getTask: vi.fn(),
		deleteTask: vi.fn(),
		appendTaskMessage: vi.fn(),
		createWorkbenchSession: vi.fn(),
		appendWorkbenchMessage: vi.fn(),
		getTaskRun: vi.fn(),
		queueTask: vi.fn(),
		reopenTask: vi.fn(),
		listTaskMessages: vi.fn(),
		getTaskLlmUsageSummary: vi.fn(),
		listTaskActivityEvents: vi.fn(),
		browseLocalFolders: vi.fn(),
		createLocalFolder: vi.fn(),
		readProjection: vi.fn(),
		executeCommand: vi.fn(),
		humanQueryContext: vi.fn(),
		humanCommandContext: vi.fn(),
	};
});

vi.mock("../api/lib/openapi", () => ({
	createOpenApiRouter: () => {
		const router = {
			openapi(route: { method: string; path: string }, handler: never) {
				mocks.handlers.set(
					`${route.method.toUpperCase()} ${route.path}`,
					handler,
				);
				return router;
			},
		};
		return router;
	},
}));
vi.mock("../api/lib/logger", () => ({
	logEvent: mocks.logEvent,
	logger: { error: mocks.loggerError, warn: mocks.loggerError },
}));
vi.mock("../api/modules/ontology", () => ({
	getOntologyRunDebugReportRoute: {
		method: "get",
		path: "/runs/:id/ontology-debug",
	},
}));
vi.mock("../api/modules/taskOperator", () => ({
	executeTaskOperatorCommand: mocks.executeCommand,
	humanTaskOperatorCommandContext: mocks.humanCommandContext,
	humanTaskOperatorQueryContext: mocks.humanQueryContext,
	readTaskOperatorProjection: mocks.readProjection,
}));
vi.mock("../api/modules/nightworkers/nightworkers.service", () => ({
	listRepositories: mocks.listRepositories,
	createRepository: mocks.createRepository,
	getRepository: mocks.getRepository,
	updateRepository: mocks.updateRepository,
	listProjectFiles: mocks.listProjectFiles,
	readProjectFile: mocks.readProjectFile,
	readRepositoryDiff: mocks.readRepositoryDiff,
	deleteRepository: mocks.deleteRepository,
	listTasks: mocks.listTasks,
	createTask: mocks.createTask,
	getTask: mocks.getTask,
	deleteTask: mocks.deleteTask,
	appendTaskMessage: mocks.appendTaskMessage,
	createWorkbenchSession: mocks.createWorkbenchSession,
	appendWorkbenchMessage: mocks.appendWorkbenchMessage,
	getTaskRun: mocks.getTaskRun,
	queueTask: mocks.queueTask,
	reopenTask: mocks.reopenTask,
	listTaskMessages: mocks.listTaskMessages,
	getTaskLlmUsageSummary: mocks.getTaskLlmUsageSummary,
	listTaskActivityEvents: mocks.listTaskActivityEvents,
	browseLocalFolders: mocks.browseLocalFolders,
	createLocalFolder: mocks.createLocalFolder,
}));
vi.mock("../api/modules/nightworkers/nightworkers.route-handlers", () => ({
	commitRunGitCloseoutHandler: mocks.externalHandler,
	deferRunGitMergeHandler: mocks.externalHandler,
	executeRunGitMergeHandler: mocks.externalHandler,
	exportTaskRunJsonlHandler: mocks.externalHandler,
	getBackgroundProcessHandler: mocks.externalHandler,
	getLatestTaskReviewSessionHandler: mocks.externalHandler,
	getOntologyRunDebugReportHandler: mocks.externalHandler,
	getReviewSessionHandler: mocks.externalHandler,
	getRunGitCloseoutHandler: mocks.externalHandler,
	getTaskRunHandler: mocks.externalHandler,
	listBackgroundProcessesHandler: mocks.externalHandler,
	listTaskRunActivityEventsHandler: mocks.externalHandler,
	listTaskRunEventsHandler: mocks.externalHandler,
	listTaskRunsHandler: mocks.externalHandler,
	overrideRunGitMergeTargetHandler: mocks.externalHandler,
	previewRunGitMergeHandler: mocks.externalHandler,
	pushRunGitCloseoutHandler: mocks.externalHandler,
	resumeTaskRunTodoHandler: mocks.externalHandler,
	reworkRunGitMergeHandler: mocks.externalHandler,
	startBackgroundProcessHandler: mocks.externalHandler,
	startHumanTaskImplementation: mocks.startHumanImplementation,
	startTaskRunHandler: mocks.externalHandler,
	stopBackgroundProcessHandler: mocks.externalHandler,
	stopTaskRunHandler: mocks.externalHandler,
}));

await import("../api/modules/nightworkers/nightworkers.routes");

type ContextInput = {
	params?: Record<string, string>;
	query?: Record<string, string | undefined>;
	json?: unknown;
	queryValid?: unknown;
	rawJson?: unknown;
	rawJsonError?: unknown;
	headers?: Record<string, string>;
};

function context(input: ContextInput = {}) {
	const params = input.params ?? {};
	const query = input.query ?? {};
	const headers = input.headers ?? {};
	return {
		req: {
			param: (name: string) => params[name] ?? "",
			query: (name: string) => query[name],
			valid: (target: string) =>
				target === "json" ? input.json : (input.queryValid ?? query),
			json: async () => {
				if (input.rawJsonError) throw input.rawJsonError;
				return input.rawJson;
			},
			header: (name: string) => headers[name],
		},
		json: (body: unknown, status = 200) =>
			new Response(JSON.stringify(body), {
				status,
				headers: { "content-type": "application/json" },
			}),
	};
}

function handler(method: string, path: string) {
	const found = mocks.handlers.get(`${method} ${path}`);
	if (!found) throw new Error(`Missing route handler: ${method} ${path}`);
	return found as (context: ReturnType<typeof context>) => Promise<Response>;
}

async function call(method: string, path: string, input: ContextInput = {}) {
	const response = await handler(method, path)(context(input));
	return {
		status: response.status,
		body: await response.json(),
	};
}

const repositoryId = "00000000-0000-4000-8000-000000000001";
const taskId = "00000000-0000-4000-8000-000000000002";
const runId = "00000000-0000-4000-8000-000000000003";
const repository = { id: repositoryId, name: "Project" };
const task = { id: taskId, repositoryId, title: "Task", revision: 5 };

beforeEach(() => {
	for (const [name, mock] of Object.entries(mocks)) {
		if (name !== "handlers") mock.mockReset();
	}
	mocks.listRepositories.mockResolvedValue([repository]);
	mocks.createRepository.mockImplementation(async (data) => ({
		id: repositoryId,
		...data,
	}));
	mocks.getRepository.mockResolvedValue(repository);
	mocks.updateRepository.mockResolvedValue(repository);
	mocks.listProjectFiles.mockResolvedValue([
		{ path: "src", type: "directory" },
	]);
	mocks.readProjectFile.mockResolvedValue({
		path: "src/a.ts",
		content: "a",
		size: 1,
		truncated: false,
	});
	mocks.readRepositoryDiff.mockResolvedValue({
		diff: "",
		diffStat: "",
		hasChanges: false,
	});
	mocks.deleteRepository.mockResolvedValue(repository);
	mocks.listTasks.mockResolvedValue([task]);
	mocks.createTask.mockImplementation(async (data) => ({
		id: taskId,
		...data,
	}));
	mocks.getTask.mockResolvedValue(task);
	mocks.deleteTask.mockResolvedValue(task);
	mocks.appendTaskMessage.mockResolvedValue(task);
	mocks.createWorkbenchSession.mockResolvedValue(task);
	mocks.appendWorkbenchMessage.mockResolvedValue({ accepted: true });
	mocks.getTaskRun.mockResolvedValue({ id: runId, taskId });
	mocks.queueTask.mockResolvedValue(task);
	mocks.reopenTask.mockResolvedValue(task);
	mocks.listTaskMessages.mockResolvedValue([{ id: "message" }]);
	mocks.getTaskLlmUsageSummary.mockResolvedValue({ totalTokens: 10 });
	mocks.listTaskActivityEvents.mockResolvedValue({ events: [], nextSeq: null });
	mocks.browseLocalFolders.mockResolvedValue({
		currentPath: "/tmp",
		parentPath: "/",
		directories: [],
	});
	mocks.createLocalFolder.mockResolvedValue({
		name: "new",
		path: "/tmp/new",
	});
	mocks.readProjection.mockResolvedValue({ task: { revision: 5 } });
	mocks.executeCommand.mockResolvedValue({ data: task });
	mocks.humanQueryContext.mockReturnValue({ principal: "human" });
	mocks.humanCommandContext.mockImplementation((value) => ({
		principal: "human",
		...value,
	}));
	mocks.startHumanImplementation.mockResolvedValue({ id: runId, taskId });
});

describe("repository route coverage", () => {
	it("lists, gets, updates, and deletes repositories", async () => {
		await expect(call("GET", "/repositories")).resolves.toEqual({
			status: 200,
			body: [repository],
		});
		await expect(
			call("GET", "/repositories/:id", { params: { id: repositoryId } }),
		).resolves.toEqual({ status: 200, body: repository });
		await expect(
			call("PATCH", "/repositories/:id", {
				params: { id: repositoryId },
				json: { queueEnabled: true },
			}),
		).resolves.toEqual({ status: 200, body: repository });
		expect(mocks.updateRepository).toHaveBeenCalledWith(repositoryId, {
			queueEnabled: true,
		});
		await expect(
			call("DELETE", "/repositories/:id", {
				params: { id: repositoryId },
			}),
		).resolves.toEqual({ status: 200, body: repository });
	});

	it("returns not-found for missing repository reads and deletes", async () => {
		mocks.getRepository.mockResolvedValueOnce(null);
		expect(
			await call("GET", "/repositories/:id", {
				params: { id: repositoryId },
			}),
		).toEqual({
			status: 404,
			body: {
				error: { code: "NOT_FOUND", message: "Repository not found" },
			},
		});
		mocks.deleteRepository.mockResolvedValueOnce(null);
		expect(
			await call("DELETE", "/repositories/:id", {
				params: { id: repositoryId },
			}),
		).toEqual({
			status: 404,
			body: {
				error: { code: "NOT_FOUND", message: "Repository not found" },
			},
		});
	});

	it("creates a validated repository without legacy normalization", async () => {
		const data = {
			name: "Project",
			localPath: "/tmp/project",
			allowed: true,
			queueEnabled: false,
			maxConcurrentSessions: 1,
		};
		const response = await call("POST", "/repositories", { json: data });
		expect(response.status).toBe(201);
		expect(mocks.createRepository).toHaveBeenCalledWith(data);
	});

	it("normalizes legacy and default repository fields", async () => {
		const response = await call("POST", "/repositories", {
			json: {},
			rawJson: {
				name: "Legacy",
				local_path: "/tmp/legacy",
				branch: "develop",
				allowed: false,
				queueEnabled: true,
				maxConcurrentSessions: 3,
				safetyPolicy: { maxCommandSeconds: 30 },
			},
		});
		expect(response.status).toBe(201);
		expect(mocks.createRepository).toHaveBeenCalledWith({
			name: "Legacy",
			localPath: "/tmp/legacy",
			branch: "develop",
			allowed: false,
			queueEnabled: true,
			maxConcurrentSessions: 3,
			safetyPolicy: { maxCommandSeconds: 30 },
		});

		await call("POST", "/repositories", {
			json: { name: "", localPath: "" },
			rawJson: { name: "Defaults", localPath: "/tmp/defaults" },
		});
		expect(mocks.createRepository).toHaveBeenLastCalledWith(
			expect.objectContaining({
				allowed: true,
				queueEnabled: false,
				maxConcurrentSessions: 1,
			}),
		);
	});

	it("rejects missing repository fields even when raw JSON cannot be read", async () => {
		await expect(
			handler(
				"POST",
				"/repositories",
			)(context({ json: {}, rawJsonError: new Error("invalid JSON") })),
		).rejects.toMatchObject({
			statusCode: 400,
			message: "Name and local path are required",
		});
		await expect(
			handler("POST", "/repositories")(context({ json: {}, rawJson: null })),
		).rejects.toMatchObject({ statusCode: 400 });
	});

	it("forwards project file and diff query parameters", async () => {
		await call("GET", "/repositories/:id/files", {
			params: { id: repositoryId },
			query: { path: "src", runId },
		});
		expect(mocks.listProjectFiles).toHaveBeenCalledWith(
			repositoryId,
			"src",
			runId,
		);
		await call("GET", "/repositories/:id/file", {
			params: { id: repositoryId },
			query: { path: "src/a.ts", runId },
		});
		expect(mocks.readProjectFile).toHaveBeenCalledWith(
			repositoryId,
			"src/a.ts",
			runId,
		);
		await call("GET", "/repositories/:id/diff", {
			params: { id: repositoryId },
			query: { runId },
		});
		expect(mocks.readRepositoryDiff).toHaveBeenCalledWith(repositoryId, runId);
	});

	it("returns validation, conflict, and generic route errors", async () => {
		expect(
			await call("GET", "/repositories/:id/file", {
				params: { id: repositoryId },
			}),
		).toEqual({
			status: 400,
			body: {
				error: { code: "VALIDATION_ERROR", message: "path is required" },
			},
		});
		mocks.updateRepository.mockRejectedValueOnce(
			new AppError(409, "REPOSITORY_CONFLICT", "conflict", {
				revision: 2,
			}),
		);
		expect(
			await call("PATCH", "/repositories/:id", {
				params: { id: repositoryId },
				json: {},
			}),
		).toEqual({
			status: 409,
			body: {
				error: {
					code: "REPOSITORY_CONFLICT",
					message: "conflict",
					details: { revision: 2 },
				},
			},
		});
		mocks.listProjectFiles.mockRejectedValueOnce(new Error("filesystem down"));
		expect(
			await call("GET", "/repositories/:id/files", {
				params: { id: repositoryId },
			}),
		).toEqual({
			status: 500,
			body: {
				error: {
					code: "INTERNAL_SERVER_ERROR",
					message: "An unexpected error occurred",
				},
			},
		});
	});
});

describe("task and workbench route coverage", () => {
	it("lists, gets, and deletes tasks with not-found responses", async () => {
		expect(await call("GET", "/tasks")).toEqual({
			status: 200,
			body: [task],
		});
		expect(await call("GET", "/tasks/:id", { params: { id: taskId } })).toEqual(
			{ status: 200, body: task },
		);
		expect(
			await call("DELETE", "/tasks/:id", { params: { id: taskId } }),
		).toEqual({ status: 200, body: task });
		mocks.getTask.mockResolvedValueOnce(null);
		mocks.deleteTask.mockResolvedValueOnce(null);
		expect(await call("GET", "/tasks/:id", { params: { id: taskId } })).toEqual(
			{
				status: 404,
				body: { error: { code: "NOT_FOUND", message: "Task not found" } },
			},
		);
		expect(
			await call("DELETE", "/tasks/:id", { params: { id: taskId } }),
		).toEqual({
			status: 404,
			body: {
				error: { code: "NOT_FOUND", message: "Task not found" },
			},
		});
	});

	it("creates canonical and normalized legacy tasks", async () => {
		const canonical = {
			repositoryId,
			title: "Canonical",
			timeoutSeconds: 60,
			priority: 1,
		};
		expect((await call("POST", "/tasks", { json: canonical })).status).toBe(
			201,
		);
		expect(mocks.createTask).toHaveBeenCalledWith(canonical);

		await call("POST", "/tasks", {
			json: {},
			rawJson: {
				repository_id: repositoryId,
				title: "Legacy",
				description: "description",
				objective: "objective",
				acceptance_criteria: "criteria",
				timeout_seconds: 120,
				priority: 2,
				created_by: "tester",
				worktree_id: "worktree",
			},
		});
		expect(mocks.createTask).toHaveBeenLastCalledWith({
			repositoryId,
			title: "Legacy",
			description: "description",
			objective: "objective",
			acceptanceCriteria: "criteria",
			timeoutSeconds: 120,
			priority: 2,
			createdBy: "tester",
			worktreeId: "worktree",
		});
	});

	it("defaults absent optional legacy task fields and validates required fields", async () => {
		await call("POST", "/tasks", {
			json: {},
			rawJson: { repositoryId, title: "Defaults" },
		});
		expect(mocks.createTask).toHaveBeenLastCalledWith(
			expect.objectContaining({
				description: "",
				objective: "",
				acceptanceCriteria: "",
				timeoutSeconds: 3600,
				priority: 0,
				createdBy: undefined,
				worktreeId: undefined,
			}),
		);
		await expect(
			handler(
				"POST",
				"/tasks",
			)(context({ json: {}, rawJsonError: new Error("bad json") })),
		).rejects.toMatchObject({
			statusCode: 400,
			message: "Repository ID and title are required",
		});
		await expect(
			handler("POST", "/tasks")(context({ json: {}, rawJson: null })),
		).rejects.toMatchObject({ statusCode: 400 });
	});

	it("updates tasks through Task Operator and handles vanished data", async () => {
		const response = await call("PATCH", "/tasks/:id", {
			params: { id: taskId },
			json: { status: "ready", priority: 0 },
			headers: { "Idempotency-Key": "update-key" },
		});
		expect(response).toEqual({ status: 200, body: task });
		expect(mocks.logEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				meta: {
					taskId,
					requestedStatus: "ready",
					hasPriority: true,
				},
			}),
		);
		expect(mocks.executeCommand).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId,
				actionId: "task.update",
				expectedTaskRevision: 5,
				arguments: { fields: { status: "ready", priority: 0 } },
			}),
		);

		mocks.executeCommand.mockResolvedValueOnce({ data: null });
		expect(
			await call("PATCH", "/tasks/:id", {
				params: { id: taskId },
				json: {},
			}),
		).toEqual({
			status: 404,
			body: {
				error: { code: "NOT_FOUND", message: "Task not found" },
			},
		});
		expect(mocks.logEvent).toHaveBeenLastCalledWith(
			expect.objectContaining({
				meta: expect.objectContaining({ hasPriority: false }),
			}),
		);
	});

	it("appends task and workbench messages and creates sessions", async () => {
		expect(
			await call("POST", "/tasks/:id/messages", {
				params: { id: taskId },
				json: { prompt: "continue" },
			}),
		).toEqual({ status: 200, body: task });
		expect(mocks.appendTaskMessage).toHaveBeenCalledWith(taskId, "continue");

		expect(
			await call("POST", "/workbench/sessions", {
				json: { repositoryId, title: "Session" },
			}),
		).toEqual({ status: 201, body: task });
		expect(
			await call("POST", "/workbench/sessions/:id/messages", {
				params: { id: taskId },
				json: { prompt: "design", intent: "draft" },
			}),
		).toEqual({ status: 200, body: { accepted: true } });
	});

	it("queues, runs, archives, restores, and reopens sessions", async () => {
		expect(
			await call("POST", "/workbench/sessions/:id/queue", {
				params: { id: taskId },
			}),
		).toEqual({ status: 200, body: task });
		expect(
			await call("POST", "/workbench/sessions/:id/run", {
				params: { id: taskId },
				headers: { "Idempotency-Key": "run-key" },
			}),
		).toEqual({ status: 201, body: { id: runId, taskId } });
		expect(mocks.startHumanImplementation).toHaveBeenCalledWith(
			taskId,
			"run-key",
		);

		await call("PATCH", "/workbench/sessions/:id/archive", {
			params: { id: taskId },
			queryValid: { discardPendingCloseouts: "true" },
			headers: { "Idempotency-Key": "archive-key" },
		});
		expect(mocks.executeCommand).toHaveBeenLastCalledWith(
			expect.objectContaining({
				actionId: "task.archive",
				arguments: { discardPendingCloseouts: true },
			}),
		);
		await call("PATCH", "/workbench/sessions/:id/archive", {
			params: { id: taskId },
			queryValid: {},
		});
		expect(mocks.executeCommand).toHaveBeenLastCalledWith(
			expect.objectContaining({
				arguments: { discardPendingCloseouts: false },
			}),
		);
		expect(
			await call("POST", "/workbench/sessions/:id/archive/restore", {
				params: { id: taskId },
			}),
		).toEqual({ status: 200, body: task });
		expect(mocks.executeCommand).toHaveBeenLastCalledWith(
			expect.objectContaining({ actionId: "task.archive.restore" }),
		);
		expect(
			await call("POST", "/workbench/sessions/:id/reopen", {
				params: { id: taskId },
			}),
		).toEqual({ status: 200, body: task });
	});
});

describe("run, activity, and utility route coverage", () => {
	it("returns not-found and success for review submission", async () => {
		mocks.getTaskRun.mockResolvedValueOnce(null);
		expect(
			await call("POST", "/runs/:id/reviews", {
				params: { id: runId },
				json: { action: "complete" },
			}),
		).toEqual({
			status: 404,
			body: {
				error: { code: "NOT_FOUND", message: "Run not found" },
			},
		});

		mocks.executeCommand.mockResolvedValueOnce({ data: { reviewed: true } });
		expect(
			await call("POST", "/runs/:id/reviews", {
				params: { id: runId },
				json: { action: "cancel", note: "not ready" },
				headers: { "Idempotency-Key": "review-key" },
			}),
		).toEqual({ status: 200, body: { reviewed: true } });
		expect(mocks.executeCommand).toHaveBeenLastCalledWith(
			expect.objectContaining({
				actionId: "run.review.submit",
				arguments: { runId, action: "cancel", note: "not ready" },
			}),
		);

		mocks.executeCommand.mockResolvedValueOnce({ data: { reviewed: true } });
		await call("POST", "/runs/:id/reviews", {
			params: { id: runId },
			json: { action: "complete" },
		});
		expect(mocks.executeCommand).toHaveBeenLastCalledWith(
			expect.objectContaining({
				arguments: { runId, action: "complete" },
			}),
		);
	});

	it("lists messages, usage, and activity with validated queries", async () => {
		await call("GET", "/tasks/:id/messages", {
			params: { id: taskId },
			queryValid: { channel: "chat" },
		});
		expect(mocks.listTaskMessages).toHaveBeenCalledWith(taskId, {
			channel: "chat",
		});
		await call("GET", "/tasks/:id/llm-usage", { params: { id: taskId } });
		expect(mocks.getTaskLlmUsageSummary).toHaveBeenCalledWith(taskId);
		await call("GET", "/tasks/:id/activity-events", {
			params: { id: taskId },
			queryValid: { afterSeq: 3, channel: "internal" },
		});
		expect(mocks.listTaskActivityEvents).toHaveBeenCalledWith(taskId, {
			afterSeq: 3,
			channel: "internal",
		});
	});

	it("browses and creates local folders", async () => {
		expect(
			await call("GET", "/utils/browse-folders", {
				query: { path: "/tmp" },
			}),
		).toEqual({
			status: 200,
			body: { currentPath: "/tmp", parentPath: "/", directories: [] },
		});
		expect(mocks.browseLocalFolders).toHaveBeenCalledWith("/tmp");
		expect(
			await call("POST", "/utils/create-folder", {
				json: { parentPath: "/tmp", name: "new" },
			}),
		).toEqual({
			status: 201,
			body: { name: "new", path: "/tmp/new" },
		});
	});

	it("maps wrapped service conflicts and unknown thrown values", async () => {
		mocks.appendTaskMessage.mockRejectedValueOnce(
			new AppError(404, "TASK_NOT_FOUND", "Task not found"),
		);
		expect(
			await call("POST", "/tasks/:id/messages", {
				params: { id: taskId },
				json: { prompt: "continue" },
			}),
		).toEqual({
			status: 404,
			body: {
				error: { code: "TASK_NOT_FOUND", message: "Task not found" },
			},
		});
		mocks.createLocalFolder.mockRejectedValueOnce("folder unavailable");
		expect(
			await call("POST", "/utils/create-folder", {
				json: { name: "new" },
			}),
		).toEqual({
			status: 500,
			body: {
				error: {
					code: "INTERNAL_SERVER_ERROR",
					message: "An unexpected error occurred",
				},
			},
		});
	});
});
