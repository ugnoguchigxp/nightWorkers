import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { nightWorkersHostRealtimeMessageSchema } from "../shared/schemas/nightworkers/realtime.schema";
import {
	createNightWorkersRealtimeProjector,
	parseNightWorkersRealtimeMessage,
} from "../src/modules/nightworkers/realtime/nightWorkersRealtimeProjector";

const taskId = "11111111-1111-4111-8111-111111111111";
const repositoryId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const messageId = "44444444-4444-4444-8444-444444444444";
const todoId = "55555555-5555-4555-8555-555555555555";
const timestamp = "2026-08-02T00:00:00.000Z";

const task = {
	id: taskId,
	repositoryId,
	title: "Realtime contract",
	status: "running",
	timeoutSeconds: 3600,
	priority: 1,
	createdAt: timestamp,
	updatedAt: timestamp,
};
const run = {
	id: runId,
	taskId,
	repositoryId,
	status: "running",
	workerKind: "native-api",
	timeoutSeconds: 3600,
	startedAt: timestamp,
	createdAt: timestamp,
	updatedAt: timestamp,
};
const todo = {
	id: todoId,
	runId,
	seq: 1,
	title: "Verify",
	nextAction: "Run tests",
	acceptanceCriteriaJson: ["Tests pass"],
	taskType: "verification",
	status: "running",
	attemptCount: 1,
	systemContextVersion: 1,
	createdBy: "agent",
	revision: 1,
	createdAt: timestamp,
	updatedAt: timestamp,
};
const taskEvent = {
	id: "66666666-6666-4666-8666-666666666666",
	taskRunId: runId,
	seq: 7,
	actor: "worker",
	type: "info",
	message: "updated",
	timestamp,
};

const hostMessages = [
	{
		type: "connected",
		timestamp,
		capabilities: ["coding_agent.command.v1"],
	},
	{ type: "subscribed", timestamp, taskId, runId, afterSeq: 6 },
	{ type: "error", timestamp, code: "INVALID", message: "Invalid" },
	{
		type: "activity_event_created",
		timestamp,
		taskId,
		payload: {
			event: {
				id: "77777777-7777-4777-8777-777777777777",
				taskId,
				runId,
				seq: 1,
				kind: "llm.usage",
				source: "worker",
				visibility: "chat",
				traceOwner: "coding_agent",
				traceChannel: "chat",
				createdAt: timestamp,
			},
		},
	},
	{
		type: "task_llm_delta",
		timestamp,
		taskId,
		seq: 9,
		payload: { text: "delta", event: { type: "model.response_delta" } },
	},
	{
		type: "task_event_created",
		timestamp,
		taskId,
		runId,
		seq: 99,
		event: taskEvent,
	},
	{
		type: "task_message_created",
		timestamp,
		taskId,
		runId,
		payload: {
			message: {
				id: messageId,
				taskId,
				runId,
				role: "assistant",
				content: "done",
				messageType: "text",
				traceOwner: "coding_agent",
				traceChannel: "chat",
				createdAt: timestamp,
			},
		},
	},
	{
		type: "task_run_updated",
		timestamp,
		taskId,
		runId,
		payload: { run, todo, todos: [todo], status: "running" },
	},
	{
		type: "task_status_updated",
		timestamp,
		taskId,
		payload: { status: "running", task },
	},
	{
		type: "questionnaire.state_changed",
		timestamp,
		taskId,
		payload: {
			taskId,
			questionnaireSessionId: "88888888-8888-4888-8888-888888888888",
			status: "review_ready",
			revision: 1,
			stateDigest: "a".repeat(64),
		},
	},
	{
		type: "plan_mode.routing_changed",
		timestamp,
		taskId,
		payload: { taskId, revision: 1, updatedBy: "user" },
	},
];

describe("NightWorkers realtime contracts", () => {
	it("parses every host-owned realtime message", () => {
		for (const message of hostMessages) {
			expect(
				nightWorkersHostRealtimeMessageSchema.safeParse(message).success,
				JSON.stringify(message),
			).toBe(true);
			expect(parseNightWorkersRealtimeMessage(message)?.owner).toBe("host");
		}
	});

	it("composes host, Coding Agent, and Mission Pilot contracts", () => {
		expect(
			parseNightWorkersRealtimeMessage({ type: "connected", timestamp })?.owner,
		).toBe("host");
		expect(
			parseNightWorkersRealtimeMessage({
				version: 1,
				type: "coding_agent.command.result",
				requestId: "99999999-9999-4999-8999-999999999999",
				result: {
					ok: false,
					error: {
						kind: "revision_conflict",
						code: "TASK_REVISION_CONFLICT",
						message: "changed",
						retryable: false,
						currentRevision: 2,
					},
				},
			})?.owner,
		).toBe("coding_agent");
		expect(
			parseNightWorkersRealtimeMessage({
				type: "mission_pilot.updated",
				taskId,
				payload: {
					taskId,
					desiredState: "playing",
					activityState: "running",
					phase: "waiting_for_questionnaire",
					authorizationVersion: 4,
					initialPromptState: "sent",
					initialPromptMessageId: null,
					activeRunId: null,
					nextWakeAt: timestamp,
					version: 1,
					lastError: null,
					updatedAt: timestamp,
				},
			})?.owner,
		).toBe("mission_pilot");
		expect(parseNightWorkersRealtimeMessage({ type: "unknown" })).toBeNull();
	});

	it("advances the persisted cursor only from task_event_created.event.seq", () => {
		const latestRunSubscriptionRef = {
			current: { runId, afterSeq: 3 as number | undefined },
		};
		const projector = createNightWorkersRealtimeProjector({
			activeSessionId: taskId,
			queryClient: new QueryClient(),
			latestRunSubscriptionRef,
			processedRealtimeMessageKeysRef: { current: new Set() },
			pendingChatRunIdRef: { current: null },
			pendingAssistantTaskIdRef: { current: null },
			chatSubmitStartedAtRef: { current: null },
			setBufferedEventsByRun: vi.fn(),
			setStreamingTextByTask: vi.fn(),
			setIsChatSubmitting: vi.fn(),
			setPendingChatRunId: vi.fn(),
			setPendingAssistantTaskId: vi.fn(),
			setProjectFileEntriesByDirectory: vi.fn(),
		});
		projector(hostMessages[4] as never, 100);
		expect(latestRunSubscriptionRef.current.afterSeq).toBe(3);
		projector(hostMessages[5] as never, 100);
		expect(latestRunSubscriptionRef.current.afterSeq).toBe(7);
	});

	it("projects every Todo from the host batch update shape", () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(["runDetails", runId], { ...run, todos: [] });
		const projector = createNightWorkersRealtimeProjector({
			activeSessionId: taskId,
			queryClient,
			latestRunSubscriptionRef: { current: { runId } },
			processedRealtimeMessageKeysRef: { current: new Set() },
			pendingChatRunIdRef: { current: null },
			pendingAssistantTaskIdRef: { current: null },
			chatSubmitStartedAtRef: { current: null },
			setBufferedEventsByRun: vi.fn(),
			setStreamingTextByTask: vi.fn(),
			setIsChatSubmitting: vi.fn(),
			setPendingChatRunId: vi.fn(),
			setPendingAssistantTaskId: vi.fn(),
			setProjectFileEntriesByDirectory: vi.fn(),
		});

		projector(
			{
				type: "task_run_updated",
				timestamp,
				taskId,
				runId,
				payload: {
					todos: [{ ...todo, status: "needs_human", revision: 2 }],
				},
			},
			100,
		);

		expect(
			queryClient.getQueryData<{ todos: (typeof todo)[] }>([
				"runDetails",
				runId,
			])?.todos,
		).toEqual([
			expect.objectContaining({
				id: todoId,
				status: "needs_human",
				revision: 2,
			}),
		]);
	});
});
