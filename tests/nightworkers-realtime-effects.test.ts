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
		taskId: "11111111-1111-4111-8111-111111111111",
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
		taskId: "11111111-1111-4111-8111-111111111111",
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

	it("completes pending chat only for Coding Agent output or structural Workbench terminal messages", async () => {
		const { isWorkbenchIntakeTerminalMessage, shouldCompletePendingChat } =
			await import("../src/modules/nightworkers/realtimeChatCompletion");
		const intakeFailure: TaskMessage = {
			id: "failed",
			taskId: "11111111-1111-4111-8111-111111111111",
			role: "system",
			content: "failed",
			metadataJson: { source: "workbench", intent: "intake_failed" },
			createdAt: now,
		};
		expect(isWorkbenchIntakeTerminalMessage(intakeFailure)).toBe(true);
		expect(
			isWorkbenchIntakeTerminalMessage({
				...intakeFailure,
				id: "questionnaire-ready",
				metadataJson: {
					source: "workbench",
					intent: "design_questionnaire_ready",
				},
			}),
		).toBe(true);
		expect(
			shouldCompletePendingChat({
				message: intakeFailure,
				pendingTaskId: "11111111-1111-4111-8111-111111111111",
				pendingRunId: "not-started",
			}),
		).toBe(true);
		expect(
			shouldCompletePendingChat({
				message: {
					...intakeFailure,
					id: "pilot",
					metadataJson: {
						source: "mission_pilot",
						intent: "intake_failed",
					},
				},
				pendingTaskId: "11111111-1111-4111-8111-111111111111",
				pendingRunId: null,
			}),
		).toBe(false);
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
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
		const wsRef = { current: null as WebSocket | null };
		const latestRunSubscriptionRef = {
			current: { runId: "run-1", afterSeq: 3 },
		};
		const pendingChatQueueRef = {
			current: [
				{
					taskId: "11111111-1111-4111-8111-111111111111",
					prompt: "queued prompt",
				},
			],
		};
		const processedRealtimeMessageKeysRef = { current: new Set<string>() };
		const pendingChatRunIdRef = { current: "run-1" as string | null };
		const pendingAssistantTaskIdRef = {
			current: "11111111-1111-4111-8111-111111111111" as string | null,
		};
		const chatSubmitStartedAtRef = { current: Date.now() as number | null };
		let realtimeConnected = false;
		let realtimeStatus = "initializing";
		let bufferedEventsByRun: Record<string, TaskEvent[]> = {};
		let streamingTextByTask: Record<string, string> = {};
		let isChatSubmitting = true;
		let pendingChatRunId: string | null = "run-1";
		let pendingAssistantTaskId: string | null =
			"11111111-1111-4111-8111-111111111111";
		let projectFileEntriesByDirectory = { src: [] as never[] };

		queryClient.setQueryData<TaskMessage[]>(
			["taskMessages", "11111111-1111-4111-8111-111111111111"],
			[
				{
					id: "optimistic-user-1",
					taskId: "11111111-1111-4111-8111-111111111111",
					role: "user",
					content: "hello",
					messageType: "text",
					createdAt: now,
				},
			],
		);
		queryClient.setQueryData<TaskRun[]>(
			["sessionRuns", "11111111-1111-4111-8111-111111111111"],
			[run("run-1", "running")],
		);
		queryClient.setQueryData<RunDetails | null>(["runDetails", "run-1"], {
			...run("run-1", "running"),
			events: [],
			todos: [todo("todo-1", "running")],
			reviews: [],
		} as RunDetails);
		queryClient.setQueryData<Task[]>(
			["sessions"],
			[task("11111111-1111-4111-8111-111111111111")],
		);
		queryClient.setQueryData<ActivityReplay>(
			["activityReplay", "11111111-1111-4111-8111-111111111111"],
			{
				events: [],
				artifacts: [],
			},
		);
		queryClient.setQueryData<BackgroundProcess[]>(
			["backgroundProcesses", "11111111-1111-4111-8111-111111111111"],
			[],
		);
		queryClient.setQueryData(
			["planModeWorkspace", "11111111-1111-4111-8111-111111111111"],
			{
				taskId: "11111111-1111-4111-8111-111111111111",
			},
		);

		useNightWorkersRealtime({
			activeSessionId: "11111111-1111-4111-8111-111111111111",
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
		const invalidationCountBeforeRouting = invalidateSpy.mock.calls.length;
		socket.emit("message", {
			type: "plan_mode.routing_changed",
			taskId: "11111111-1111-4111-8111-111111111111",
			payload: {
				taskId: "11111111-1111-4111-8111-111111111111",
				revision: 1,
				updatedBy: "questionnaire_recommender",
			},
		});
		expect(
			invalidateSpy.mock.calls.slice(invalidationCountBeforeRouting),
		).toContainEqual([
			{
				queryKey: ["planModeWorkspace", "11111111-1111-4111-8111-111111111111"],
			},
		]);
		socket.emit("message", {
			type: "activity_event_created",
			payload: {
				event: {
					id: "activity-1",
					taskId: "11111111-1111-4111-8111-111111111111",
					kind: "llm.usage",
					traceOwner: "coding_agent",
					traceChannel: "chat",
					message: "usage",
					createdAt: now,
				},
			},
		});
		socket.emit("message", {
			type: "task_llm_delta",
			taskId: "11111111-1111-4111-8111-111111111111",
			seq: 1,
			timestamp: now,
			payload: { text: "partial " },
		});
		socket.emit("message", {
			type: "activity_event_created",
			payload: {
				event: {
					id: "pilot-activity",
					taskId: "11111111-1111-4111-8111-111111111111",
					kind: "llm.usage",
					traceOwner: "mission_pilot",
					traceChannel: "chat",
					message: "pilot usage",
					createdAt: now,
				},
			},
		});
		socket.emit("message", {
			type: "task_message_created",
			payload: {
				message: {
					id: "pilot-message",
					taskId: "11111111-1111-4111-8111-111111111111",
					runId: null,
					role: "assistant",
					content: "pilot should not finish coding chat",
					messageType: "text",
					traceOwner: "mission_pilot",
					traceChannel: "artifact",
					createdAt: now,
				},
			},
		});
		expect(streamingTextByTask).toEqual({
			"11111111-1111-4111-8111-111111111111": "partial ",
		});
		expect(isChatSubmitting).toBe(true);
		expect(
			queryClient.getQueryData<ActivityReplay>([
				"activityReplay",
				"11111111-1111-4111-8111-111111111111",
			])?.events,
		).toHaveLength(1);
		expect(
			queryClient.getQueryData<TaskMessage[]>([
				"taskMessages",
				"11111111-1111-4111-8111-111111111111",
			]),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "pilot-message" }),
			]),
		);
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
					taskId: "11111111-1111-4111-8111-111111111111",
					runId: "run-1",
					role: "user",
					content: "hello",
					messageType: "text",
					traceOwner: "user",
					traceChannel: "chat",
					createdAt: now,
				},
			},
		});
		socket.emit("message", {
			type: "mission_pilot.plan_progress_updated",
			taskId: "11111111-1111-4111-8111-111111111111",
			payload: {
				taskId: "11111111-1111-4111-8111-111111111111",
				progress: {
					taskId: "11111111-1111-4111-8111-111111111111",
					sessionId: "22222222-2222-4222-8222-222222222222",
					phase: "generating_artifacts",
					desiredState: "playing",
					version: 1,
					contextRevision: 1,
					currentStepKey: "view:user_flow",
					steps: [],
					lastError: null,
					updatedAt: now,
				},
			},
		});
		socket.emit("message", {
			type: "task_message_created",
			payload: {
				message: {
					id: "message-assistant",
					taskId: "11111111-1111-4111-8111-111111111111",
					runId: "run-1",
					role: "assistant",
					content: "done",
					messageType: "markdown_document",
					metadataJson: {
						artifactKind: "plan_mode_dedicated_view",
						view: "user_flow",
					},
					traceOwner: "coding_agent",
					traceChannel: "chat",
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
					contextSnapshot: {
						reviewRun: {
							reviewSessionId: "review-22222222-2222-4222-8222-222222222222",
							reviewedRunId: "reviewed-run-1",
						},
					},
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
			payload: { task: task("11111111-1111-4111-8111-111111111111", "ready") },
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
				taskId: "11111111-1111-4111-8111-111111111111",
				runId: "run-1",
				afterSeq: 3,
			},
			{
				type: "chat_submit",
				taskId: "11111111-1111-4111-8111-111111111111",
				prompt: "queued prompt",
			},
		]);
		expect(
			queryClient.getQueryData<ActivityReplay>([
				"activityReplay",
				"11111111-1111-4111-8111-111111111111",
			])?.events,
		).toHaveLength(1);
		expect(streamingTextByTask).toEqual({});
		expect(bufferedEventsByRun["run-1"]).toEqual([
			expect.objectContaining({ id: "event-1", seq: 4 }),
		]);
		expect(
			queryClient.getQueryData<TaskMessage[]>([
				"taskMessages",
				"11111111-1111-4111-8111-111111111111",
			]),
		).toEqual([
			expect.objectContaining({ id: "pilot-message" }),
			expect.objectContaining({ id: "message-user" }),
			expect.objectContaining({ id: "message-assistant" }),
			expect.objectContaining({ content: "socket failed" }),
		]);
		expect(
			queryClient.getQueryData<TaskRun[]>([
				"sessionRuns",
				"11111111-1111-4111-8111-111111111111",
			])?.[0],
		).toMatchObject({ id: "run-1", status: "completed" });
		expect(
			queryClient.getQueryData<RunDetails | null>(["runDetails", "run-1"])
				?.todos[0],
		).toMatchObject({ id: "todo-1", status: "passed" });
		expect(queryClient.getQueryData<Task[]>(["sessions"])?.[0]).toMatchObject({
			id: "11111111-1111-4111-8111-111111111111",
			status: "ready",
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: ["reviewSession", "11111111-1111-4111-8111-111111111111"],
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: ["gitCloseout", "reviewed-run-1"],
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: ["planModeWorkspace", "11111111-1111-4111-8111-111111111111"],
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: [
				"designQuestionnaireSessions",
				"11111111-1111-4111-8111-111111111111",
			],
		});
		expect(
			queryClient.getQueryData([
				"missionPilotPlanProgress",
				"11111111-1111-4111-8111-111111111111",
			]),
		).toMatchObject({ currentStepKey: "view:user_flow" });
		expect(projectFileEntriesByDirectory).toEqual({});
		expect(isChatSubmitting).toBe(false);
		expect(pendingChatRunId).toBeNull();
		expect(pendingAssistantTaskId).toBeNull();
		queryClient.clear();
	});
});
