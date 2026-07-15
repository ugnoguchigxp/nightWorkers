import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNightWorkersMutations } from "../src/modules/nightworkers/hooks/useNightWorkersMutations";
import type {
	BackgroundProcess,
	GitCloseoutState,
	Repository,
	Task,
	TaskRun,
} from "../src/modules/nightworkers/types";

const now = "2026-07-08T00:00:00.000Z";

function repository(id: string, name = id): Repository {
	return {
		id,
		name,
		localPath: `/tmp/${id}`,
		branch: "main",
		allowed: true,
		queueEnabled: true,
		maxConcurrentSessions: 1,
		createdAt: now,
		updatedAt: now,
	};
}

function task(id: string, status = "draft", priority = 1): Task {
	return {
		id,
		repositoryId: "repo-1",
		title: id,
		description: `${id} description`,
		objective: `${id} objective`,
		acceptanceCriteria: `${id} acceptance`,
		status,
		timeoutSeconds: 3600,
		priority,
		createdAt: now,
		updatedAt: now,
	};
}

function run(id: string, taskId = "task-1", status = "running"): TaskRun {
	return {
		id,
		taskId,
		repositoryId: "repo-1",
		status,
		workerKind: "codex",
		timeoutSeconds: 3600,
		startedAt: now,
		createdAt: now,
		updatedAt: now,
		events: [],
		reviews: [],
		todos: [],
	};
}

function jsonResponse(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.toString();
	if (typeof Request !== "undefined" && input instanceof Request)
		return input.url;
	return String(input);
}

function requestBody(init?: RequestInit): Record<string, unknown> {
	if (!init?.body || typeof init.body !== "string") return {};
	return JSON.parse(init.body) as Record<string, unknown>;
}

function stubMutationFetch() {
	const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
		const url = requestUrl(input);
		const method = (init?.method ?? "GET").toUpperCase();
		const body = requestBody(init);

		if (url.endsWith("/api/repositories") && method === "POST") {
			return jsonResponse(repository("repo-created", String(body.name)));
		}
		if (url.endsWith("/api/repositories/repo-1") && method === "PATCH") {
			return jsonResponse({
				...repository("repo-1", "Server renamed repo"),
				...body,
			});
		}
		if (url.endsWith("/api/repositories/repo-2") && method === "DELETE") {
			return jsonResponse({ ok: true });
		}
		if (url.endsWith("/api/workbench/sessions") && method === "POST") {
			return jsonResponse(task("task-created", "draft", 3));
		}
		if (url.endsWith("/api/tasks/task-created") && method === "DELETE") {
			return jsonResponse({ ok: true });
		}
		if (url.endsWith("/api/workbench/sessions/task-1/run")) {
			return jsonResponse(run("run-started", "task-1", "running"));
		}
		if (url.endsWith("/api/runs/run-started/stop")) {
			return jsonResponse(run("run-started", "task-1", "cancelled"));
		}
		if (url.endsWith("/api/runs/run-started/todos/todo-1/resume")) {
			return jsonResponse(run("run-started", "task-1", "running"));
		}
		if (url.endsWith("/api/background-processes/process-1/stop")) {
			return jsonResponse({
				id: "process-1",
				taskId: "task-1",
				status: "stopped",
				createdAt: now,
				updatedAt: now,
			});
		}
		if (url.endsWith("/api/workbench/sessions/task-1/queue")) {
			return jsonResponse(task("task-1", "queued", 5));
		}
		if (url.endsWith("/api/runs/run-started/git/commit")) {
			return jsonResponse({
				runId: "run-started",
				repositoryId: "repo-1",
				canCommit: false,
				canPush: true,
				state: "committed",
				blockingCode: null,
				commitRecord: null,
				requiredReview: {},
			});
		}
		if (url.endsWith("/api/runs/run-started/git/push")) {
			return jsonResponse({
				runId: "run-started",
				repositoryId: "repo-1",
				canCommit: false,
				canPush: false,
				state: "pushed",
				blockingCode: null,
				commitRecord: { status: "committed", pushStatus: "pushed" },
				requiredReview: {},
			});
		}
		if (url.endsWith("/api/workbench/sessions/task-2/archive")) {
			return jsonResponse(task("task-2", "cancelled", 1));
		}
		if (url.includes("/api/tasks/") && method === "PATCH") {
			const id = url.split("/api/tasks/")[1] ?? "task-unknown";
			return jsonResponse({ ...task(id), ...body });
		}

		throw new Error(`Unexpected request: ${method} ${url}`);
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

function renderMutations(activeSessionId = "task-1") {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
	let active = activeSessionId;
	const setActiveSessionId = vi.fn(
		(update: string | null | ((current: string | null) => string | null)) => {
			active = typeof update === "function" ? update(active) : update;
		},
	);
	let mutations!: ReturnType<typeof useNightWorkersMutations>;

	function CaptureMutations() {
		mutations = useNightWorkersMutations({
			activeSessionId: active,
			queryClient,
			setActiveSessionId,
		});
		return null;
	}

	renderToStaticMarkup(
		<QueryClientProvider client={queryClient}>
			<CaptureMutations />
		</QueryClientProvider>,
	);

	return {
		queryClient,
		mutations,
		setActiveSessionId,
		getActiveSessionId: () => active,
	};
}

describe("useNightWorkersMutations", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("updates project and session cache after successful mutations", async () => {
		const fetchMock = stubMutationFetch();
		const { getActiveSessionId, mutations, queryClient } = renderMutations();

		queryClient.setQueryData<Repository[]>(
			["projects"],
			[repository("repo-1", "Original"), repository("repo-2", "To delete")],
		);
		queryClient.setQueryData<Task[]>(
			["sessions"],
			[task("task-1", "draft", 1), task("task-2", "ready", 2)],
		);

		await mutations.createProjectMutation.mutateAsync({
			name: "Created repo",
			localPath: "/tmp/created",
			branch: "",
		});
		await mutations.updateProjectMutation.mutateAsync({
			id: "repo-1",
			data: { name: "Renamed locally" },
		});
		await mutations.deleteProjectMutation.mutateAsync("repo-2");
		await mutations.createSessionMutation.mutateAsync({
			repositoryId: "repo-1",
			title: "Created task",
			description: "",
			objective: "",
			acceptanceCriteria: "",
		});
		await mutations.deleteSessionMutation.mutateAsync("task-created");
		await mutations.queueSessionMutation.mutateAsync("task-1");

		const projects = queryClient.getQueryData<Repository[]>(["projects"]) ?? [];
		const sessions = queryClient.getQueryData<Task[]>(["sessions"]) ?? [];
		expect(projects.find((project) => project.id === "repo-1")?.name).toBe(
			"Renamed locally",
		);
		expect(sessions.find((session) => session.id === "task-1")?.status).toBe(
			"queued",
		);
		expect(getActiveSessionId()).toBe("task-1");
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/repositories",
			expect.objectContaining({
				method: "POST",
				body: expect.stringContaining('"branch":"main"'),
			}),
		);
	});

	it("keeps run, background-process, and git closeout caches in sync", async () => {
		stubMutationFetch();
		const { mutations, queryClient } = renderMutations();
		const processRecord = {
			id: "process-1",
			taskId: "task-1",
			status: "running",
			createdAt: now,
			updatedAt: now,
		} as BackgroundProcess;

		queryClient.setQueryData<Task[]>(["sessions"], [task("task-1")]);
		queryClient.setQueryData<TaskRun[]>(["sessionRuns", "task-1"], []);
		queryClient.setQueryData<BackgroundProcess[]>(
			["backgroundProcesses", "task-1"],
			[processRecord],
		);

		await mutations.startRunMutation.mutateAsync("task-1");
		await mutations.resumeTodoMutation.mutateAsync({
			runId: "run-started",
			todoId: "todo-1",
			expectedTodoRevision: 2,
			userContext: "staging環境を使用する",
		});
		await mutations.stopRunMutation.mutateAsync("run-started");
		await mutations.stopBackgroundProcessMutation.mutateAsync("process-1");
		await mutations.commitRunGitCloseoutMutation.mutateAsync("run-started");
		await mutations.pushRunGitCloseoutMutation.mutateAsync("run-started");

		expect(
			queryClient.getQueryData<TaskRun[]>(["sessionRuns", "task-1"]),
		).toEqual([
			expect.objectContaining({ id: "run-started", status: "cancelled" }),
		]);
		expect(
			queryClient.getQueryData<BackgroundProcess[]>([
				"backgroundProcesses",
				"task-1",
			]),
		).toEqual([
			expect.objectContaining({ id: "process-1", status: "stopped" }),
		]);
		expect(
			queryClient.getQueryData<GitCloseoutState | null>([
				"gitCloseout",
				"run-started",
			]),
		).toEqual(expect.objectContaining({ state: "pushed" }));
	});

	it("optimistically patches status, reorders priority, and moves sessions", async () => {
		stubMutationFetch();
		const { mutations, queryClient } = renderMutations();
		queryClient.setQueryData<Task[]>(
			["sessions"],
			[
				task("task-1", "draft", 1),
				task("task-2", "queued", 2),
				task("task-3", "draft", 3),
			],
		);

		await mutations.updateSessionStatusMutation.mutateAsync({
			sessionId: "task-1",
			status: "ready",
		});
		await mutations.reorderQueueSessionsMutation.mutateAsync([
			"task-3",
			"task-1",
			"task-2",
		]);
		await mutations.moveWorkbenchSessionMutation.mutateAsync({
			sessionId: "task-2",
			sourceGroup: "queue",
			targetGroup: "archive",
			processingIds: ["task-1"],
			queueIds: ["task-3"],
			archiveIds: ["task-2"],
		});

		const sessions = queryClient.getQueryData<Task[]>(["sessions"]) ?? [];
		expect(sessions.find((session) => session.id === "task-1")).toMatchObject({
			status: "ready",
			priority: 2,
		});
		expect(sessions.find((session) => session.id === "task-2")).toMatchObject({
			status: "cancelled",
		});
		expect(sessions.find((session) => session.id === "task-3")).toMatchObject({
			priority: 1,
		});
	});
});
