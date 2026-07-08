import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	ActivityReplay,
	BackgroundProcess,
	RunDetails,
	Task,
	TaskEvent,
	TaskMessage,
	TaskRun,
	TaskRunTodo,
} from "../src/modules/nightworkers/types";

const now = "2026-07-08T00:00:00.000Z";
let latestCleanup: (() => void) | undefined;

vi.mock("react", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react")>();
	return {
		...actual,
		useEffect: (effect: () => (() => void) | undefined) => {
			latestCleanup = effect();
		},
	};
});

type Listener = (event: { data?: string }) => void;

class FakeWebSocket {
	static OPEN = 1;
	readyState = FakeWebSocket.OPEN;
	sent: string[] = [];
	listeners = new Map<string, Listener[]>();

	constructor(public url: string) {
		FakeWebSocket.instances.push(this);
	}

	static instances: FakeWebSocket[] = [];

	addEventListener(type: string, listener: Listener) {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	send(data: string) {
		this.sent.push(data);
	}

	close() {
		this.readyState = 3;
		this.emit("close");
	}

	emit(type: string, data?: unknown) {
		for (const listener of this.listeners.get(type) ?? []) {
			listener({
				data: data === undefined ? undefined : JSON.stringify(data),
			});
		}
	}
}

function task(id: string, status = "draft"): Task {
	return {
		id,
		repositoryId: "repo-1",
		title: id,
		status,
		timeoutSeconds: 3600,
		priority: 1,
		createdAt: now,
		updatedAt: now,
	};
}

function run(id: string, status = "running"): TaskRun {
	return {
		id,
		taskId: "task-1",
		repositoryId: "repo-1",
		status,
		workerKind: "codex",
		timeoutSeconds: 3600,
		startedAt: now,
		createdAt: now,
		updatedAt: now,
		events: [],
		todos: [],
		reviews: [],
	};
}

function todo(id: string, status: TaskRunTodo["status"]): TaskRunTodo {
	return {
		id,
		taskId: "task-1",
		runId: "run-1",
		seq: 1,
		title: "Todo",
		status,
		createdAt: now,
		updatedAt: now,
	};
}

describe("useNightWorkersRealtime effect", () => {
	afterEach(() => {
		latestCleanup?.();
		latestCleanup = undefined;
		FakeWebSocket.instances = [];
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("applies realtime websocket messages to query cache and local state", async () => {
		vi.useFakeTimers();
		vi.stubGlobal("window", {
			location: {
				protocol: "http:",
				host: "localhost:39174",
				hostname: "localhost",
			},
		});
		vi.stubGlobal("WebSocket", FakeWebSocket);

		const { useNightWorkersRealtime } = await import(
			"../src/modules/nightworkers/hooks/useNightWorkersRealtime"
		);
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		const wsRef = { current: null as WebSocket | null };
		const latestRunSubscriptionRef = {
			current: { runId: "run-1", afterSeq: 3 },
		};
		const pendingChatQueueRef = {
			current: [{ taskId: "task-1", prompt: "queued prompt" }],
		};
		const processedRealtimeMessageKeysRef = { current: new Set<string>() };
		const pendingChatRunIdRef = { current: "run-1" as string | null };
		const pendingAssistantTaskIdRef = { current: "task-1" as string | null };
		const chatSubmitStartedAtRef = { current: Date.now() as number | null };
		let realtimeConnected = false;
		let realtimeStatus = "initializing";
		let bufferedEventsByRun: Record<string, TaskEvent[]> = {};
		let streamingTextByTask: Record<string, string> = {};
		let isChatSubmitting = true;
		let pendingChatRunId: string | null = "run-1";
		let pendingAssistantTaskId: string | null = "task-1";
		let projectFileEntriesByDirectory = { src: [] as never[] };

		queryClient.setQueryData<TaskMessage[]>(
			["taskMessages", "task-1"],
			[
				{
					id: "optimistic-user-1",
					taskId: "task-1",
					role: "user",
					content: "hello",
					messageType: "text",
					createdAt: now,
				},
			],
		);
		queryClient.setQueryData<TaskRun[]>(
			["sessionRuns", "task-1"],
			[run("run-1", "running")],
		);
		queryClient.setQueryData<RunDetails | null>(["runDetails", "run-1"], {
			...run("run-1", "running"),
			events: [],
			todos: [todo("todo-1", "running")],
			reviews: [],
		} as RunDetails);
		queryClient.setQueryData<Task[]>(["sessions"], [task("task-1")]);
		queryClient.setQueryData<ActivityReplay>(["activityReplay", "task-1"], {
			events: [],
			artifacts: [],
		});
		queryClient.setQueryData<BackgroundProcess[]>(
			["backgroundProcesses", "task-1"],
			[],
		);

		useNightWorkersRealtime({
			activeSessionId: "task-1",
			queryClient,
			wsRef,
			latestRunSubscriptionRef,
			pendingChatQueueRef,
			processedRealtimeMessageKeysRef,
			pendingChatRunIdRef,
			pendingAssistantTaskIdRef,
			chatSubmitStartedAtRef,
			setIsRealtimeConnected: (value) => {
				realtimeConnected =
					typeof value === "function" ? value(realtimeConnected) : value;
			},
			setRealtimeStatus: (value) => {
				realtimeStatus =
					typeof value === "function" ? value(realtimeStatus as never) : value;
			},
			setBufferedEventsByRun: (value) => {
				bufferedEventsByRun =
					typeof value === "function" ? value(bufferedEventsByRun) : value;
			},
			setStreamingTextByTask: (value) => {
				streamingTextByTask =
					typeof value === "function" ? value(streamingTextByTask) : value;
			},
			setIsChatSubmitting: (value) => {
				isChatSubmitting =
					typeof value === "function" ? value(isChatSubmitting) : value;
			},
			setPendingChatRunId: (value) => {
				pendingChatRunId =
					typeof value === "function" ? value(pendingChatRunId) : value;
			},
			setPendingAssistantTaskId: (value) => {
				pendingAssistantTaskId =
					typeof value === "function" ? value(pendingAssistantTaskId) : value;
			},
			setProjectFileEntriesByDirectory: (value) => {
				projectFileEntriesByDirectory =
					typeof value === "function"
						? value(projectFileEntriesByDirectory)
						: value;
			},
		});

		vi.runOnlyPendingTimers();
		const socket = FakeWebSocket.instances[0];
		socket.emit("open");
		socket.emit("message", {
			type: "activity_event_created",
			payload: {
				event: {
					id: "activity-1",
					taskId: "task-1",
					kind: "llm.usage",
					message: "usage",
					createdAt: now,
				},
			},
		});
		socket.emit("message", {
			type: "task_llm_delta",
			taskId: "task-1",
			seq: 1,
			timestamp: now,
			payload: { text: "partial " },
		});
		socket.emit("message", {
			type: "task_event_created",
			runId: "run-1",
			seq: 4,
			event: {
				id: "event-1",
				type: "git.closeout.ready",
				message: "ready",
				timestamp: now,
			},
		});
		socket.emit("message", {
			type: "task_message_created",
			payload: {
				message: {
					id: "message-user",
					taskId: "task-1",
					runId: "run-1",
					role: "user",
					content: "hello",
					messageType: "text",
					createdAt: now,
				},
			},
		});
		socket.emit("message", {
			type: "task_message_created",
			payload: {
				message: {
					id: "message-assistant",
					taskId: "task-1",
					runId: "run-1",
					role: "assistant",
					content: "done",
					messageType: "text",
					createdAt: now,
				},
			},
		});
		socket.emit("message", {
			type: "chat_submit_enqueued",
			runId: "run-2",
		});
		socket.emit("message", {
			type: "task_run_updated",
			payload: {
				run: {
					...run("run-1", "completed"),
					updatedAt: "2026-07-08T00:01:00.000Z",
				},
			},
		});
		socket.emit("message", {
			type: "task_run_updated",
			payload: { todo: todo("todo-1", "passed") },
		});
		socket.emit("message", {
			type: "task_status_updated",
			payload: { task: task("task-1", "ready") },
		});
		socket.emit("message", {
			type: "error",
			message: "socket failed",
		});
		socket.emit("close");

		expect(realtimeConnected).toBe(false);
		expect(realtimeStatus).toBe("disconnected");
		expect(socket.sent.map((item) => JSON.parse(item))).toEqual([
			{
				type: "subscribe_task",
				taskId: "task-1",
				runId: "run-1",
				afterSeq: 3,
			},
			{ type: "chat_submit", taskId: "task-1", prompt: "queued prompt" },
		]);
		expect(
			queryClient.getQueryData<ActivityReplay>(["activityReplay", "task-1"])
				?.events,
		).toHaveLength(1);
		expect(streamingTextByTask).toEqual({});
		expect(bufferedEventsByRun["run-1"]).toEqual([
			expect.objectContaining({ id: "event-1", seq: 4 }),
		]);
		expect(
			queryClient.getQueryData<TaskMessage[]>(["taskMessages", "task-1"]),
		).toEqual([
			expect.objectContaining({ id: "message-user" }),
			expect.objectContaining({ id: "message-assistant" }),
			expect.objectContaining({ content: "socket failed" }),
		]);
		expect(
			queryClient.getQueryData<TaskRun[]>(["sessionRuns", "task-1"])?.[0],
		).toMatchObject({ id: "run-1", status: "completed" });
		expect(
			queryClient.getQueryData<RunDetails | null>(["runDetails", "run-1"])
				?.todos[0],
		).toMatchObject({ id: "todo-1", status: "passed" });
		expect(queryClient.getQueryData<Task[]>(["sessions"])?.[0]).toMatchObject({
			id: "task-1",
			status: "ready",
		});
		expect(projectFileEntriesByDirectory).toEqual({});
		expect(isChatSubmitting).toBe(false);
		expect(pendingChatRunId).toBeNull();
		expect(pendingAssistantTaskId).toBeNull();
		queryClient.clear();
	});
});
