import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	mergeMissionPilotExecutionTrace,
	missionPilotStopThoughtItem,
	missionPilotTraceItems,
	PilotThoughtDock,
} from "../src/composition/mission-pilot";
import { AgentDebugEventCard } from "../src/modules/nightworkers/components/ThreadTimelineAgentCards";

describe("PilotThoughtDock", () => {
	it("renders the server-projected Mission Pilot timeline without dropping agent items", () => {
		const items = missionPilotTraceItems({
			events: [],
			activityEvents: [],
			messages: [],
			entries: [
				{
					id: "conversation-item:assistant-1",
					sessionId: "pilot-session",
					sequence: 1,
					occurredAt: new Date("2026-07-16T00:00:00Z"),
					kind: "thought",
					summary: "Taskの状態を確認し、更新を実行します。",
					sourceRef: {
						kind: "mission_pilot_conversation_item",
						id: "assistant-1",
					},
				},
				{
					id: "tool-call:tool-1:finished",
					sessionId: "pilot-session",
					sequence: 2,
					occurredAt: new Date("2026-07-16T00:00:01Z"),
					kind: "action_completed",
					status: "succeeded",
					summary: "Taskを更新が完了しました。",
					sourceRef: {
						kind: "mission_pilot_tool_call",
						id: "tool-1",
					},
				},
			],
		});

		expect(items.map((item) => item.event.message)).toEqual([
			"Taskの状態を確認し、更新を実行します。",
			"Taskを更新が完了しました。",
		]);
		expect(items.map((item) => item.source)).toEqual([
			"unified_entry",
			"unified_entry",
		]);
	});

	it("shows the Plan Mode correction instruction outside debug details", () => {
		const markup = renderToStaticMarkup(
			<AgentDebugEventCard
				variant="dock"
				event={{
					id: "correction-request",
					eventType: "runtime.state",
					actor: "mission_pilot",
					message:
						"feature_planへフォーカスした修正をPlan Mode agentへ依頼しました。",
					payloadJson: {
						correctionRunId: "correction-run-1",
						correctionRequest: {
							target: "feature_plan",
							focus: { kind: "artifact" },
							instruction:
								"API契約を正本として扱うよう、実装手順を修正してください。",
							preserveUnfocusedContent: true,
						},
					},
					createdAt: new Date("2026-07-13T00:00:00Z"),
				}}
			/>,
		);

		expect(markup).toContain("Plan Mode agentへの依頼内容");
		expect(markup).toContain("依頼内容");
		expect(markup).toContain(
			"API契約を正本として扱うよう、実装手順を修正してください。",
		);
		expect(markup).not.toContain("review_result");
	});

	it("includes Pilot-owned events without re-projecting Coding Agent run events", () => {
		const items = missionPilotTraceItems({
			messages: [
				{
					id: "pilot-message",
					taskId: "task-1",
					role: "assistant",
					content: "Mission Pilot message",
					traceOwner: "mission_pilot",
					traceChannel: "pilot_thought",
					createdAt: new Date("2026-07-13T00:00:03Z"),
				},
				{
					id: "coding-message",
					taskId: "task-1",
					role: "assistant",
					content: "Coding Agent message",
					traceOwner: "coding_agent",
					traceChannel: "pilot_thought",
					createdAt: new Date("2026-07-13T00:00:04Z"),
				},
			],
			events: [
				{
					id: "pilot-event-1",
					eventType: "implementation.completed",
					phase: "review_preparing",
					cycle: 1,
					contextRevision: 3,
					sourceKind: "task_run",
					sourceId: "implementation-run",
					payloadJson: { nextPhase: "review" },
					processStatus: "processed",
					attemptCount: 0,
					createdAt: new Date("2026-07-13T00:00:00Z"),
				},
			],
			activityEvents: [
				{
					id: "pilot-decision",
					taskId: "task-1",
					seq: 4,
					kind: "runtime.decision",
					source: "mission_pilot",
					text: "次のphaseへ進みます",
					payloadJson: { toolName: "exec_command" },
					visibility: "visible",
					traceOwner: "mission_pilot",
					traceChannel: "pilot_thought",
					createdAt: new Date("2026-07-13T00:00:01Z"),
				},
				{
					id: "implementation-tool-call",
					taskId: "task-1",
					runId: "implementation-run",
					seq: 2,
					kind: "tool.call",
					source: "tool",
					text: "実装ファイルを確認しています",
					visibility: "visible",
					traceOwner: "coding_agent",
					traceChannel: "chat",
					createdAt: new Date("2026-07-13T00:00:02Z"),
				},
			],
		});

		expect(items.map((item) => item.event.message)).toEqual([
			"次のphaseへ進みます",
			"Mission Pilot message",
		]);
		expect(items[0]?.event.actor).toBe("mission_pilot");
		expect(items[0]?.event.payloadJson).toMatchObject({
			toolName: "exec_command",
		});
	});

	it("deduplicates persisted rows and keeps same-second activity order stable", () => {
		const duplicateEvent = {
			id: "pilot-event-1",
			eventType: "questionnaire.completed",
			phase: "plan_mode",
			cycle: 1,
			contextRevision: 3,
			sourceKind: "questionnaire",
			sourceId: "questionnaire-1",
			payloadJson: {},
			processStatus: "processed",
			attemptCount: 0,
			createdAt: new Date("2026-07-13T00:00:00Z"),
		};
		const activity = (
			id: string,
			seq: number,
			text: string,
			createdAt: Date,
		) => ({
			id,
			taskId: "task-1",
			seq,
			kind: "runtime.state",
			source: "mission_pilot",
			text,
			visibility: "visible",
			traceOwner: "mission_pilot" as const,
			traceChannel: "pilot_thought" as const,
			createdAt,
		});

		const items = missionPilotTraceItems({
			messages: [],
			events: [duplicateEvent, duplicateEvent],
			activityEvents: [
				activity(
					"activity-7",
					7,
					"確定しました",
					new Date("2026-07-13T00:00:00Z"),
				),
				activity(
					"activity-6",
					6,
					"確定しています",
					new Date("2026-07-13T00:00:00Z"),
				),
			],
		});

		expect(items.map((item) => item.event.message)).toEqual([
			"questionnaire.completed",
			"確定しています",
			"確定しました",
		]);
	});

	it("merges live snapshots by persisted id without dropping newer history", () => {
		const current = {
			events: [],
			activityEvents: [
				{
					id: "activity-1",
					taskId: "task-1",
					seq: 1,
					kind: "runtime.state",
					source: "mission_pilot",
					status: "running",
					text: "処理中",
					visibility: "visible",
					traceOwner: "mission_pilot" as const,
					traceChannel: "pilot_thought" as const,
					createdAt: new Date("2026-07-13T00:00:00Z"),
				},
			],
			messages: [],
		};
		const incoming = {
			events: [],
			activityEvents: [
				{
					...current.activityEvents[0],
					status: "completed",
					text: "完了",
				},
				{
					...current.activityEvents[0],
					id: "activity-2",
					seq: 2,
					text: "次の履歴",
				},
			],
			messages: [],
		};

		const merged = mergeMissionPilotExecutionTrace(current, incoming);
		const staleResponse = mergeMissionPilotExecutionTrace(merged, current);

		expect(staleResponse.activityEvents).toHaveLength(2);
		expect(
			staleResponse.activityEvents.find((event) => event.id === "activity-2"),
		).toBeDefined();
	});

	it("merges repeated v2 snapshots without retired legacy row fields", () => {
		const v2Trace = {
			activityEvents: [],
			entries: [],
		};

		const firstSnapshot = mergeMissionPilotExecutionTrace(null, v2Trace);
		const merged = mergeMissionPilotExecutionTrace(firstSnapshot, v2Trace);

		expect(merged).toMatchObject({
			events: [],
			activityEvents: [],
			messages: [],
			entries: [],
		});
	});

	it("renders Pilot decisions without task execution or screen generation logs", () => {
		const taskId = "11111111-1111-4111-8111-111111111111";
		const queryClient = new QueryClient();
		queryClient.setQueryData(["missionPilotControl", taskId], {
			taskId,
			desiredState: "stopped",
			activityState: "attention",
			phase: "attention",
			authorizationVersion: 2,
			initialPromptState: "sent",
			initialPromptMessageId: null,
			activeRunId: "33333333-3333-4333-8333-333333333333",
			nextWakeAt: null,
			version: 1,
			lastError: null,
			preQueueDiagnostic: {
				code: "MISSION_PILOT_PRE_QUEUE_UNEXPECTED_RUN",
				detectedAt: new Date("2026-07-11T10:00:03Z"),
				taskStatus: "queued",
				sessionPhase: "queueing",
				queueEntryIds: [],
				runIds: ["44444444-4444-4444-8444-444444444444"],
				runSourceRefs: [],
				commitRecordIds: [],
				diffEventIds: [],
				contextRevision: 1,
				contextDigest: "context-digest",
				reviewedContextRevision: null,
				reviewedContextDigest: null,
			},
			updatedAt: new Date(),
		});
		const markup = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<PilotThoughtDock
					session={{
						id: taskId,
						repositoryId: "22222222-2222-4222-8222-222222222222",
						title: "Mission Pilot task",
						status: "running",
						timeoutSeconds: 3600,
						priority: 0,
						createdAt: new Date(),
						updatedAt: new Date(),
					}}
					onClose={vi.fn()}
				/>
			</QueryClientProvider>,
		);

		expect(markup).toContain("nightworkers-chat-dock");
		expect(markup).not.toContain("nightworkers-message-bubble");
		expect(markup).toContain(
			"nightworkers-pilot-thought-event w-full border-b",
		);
		expect(markup).toContain("nightworkers-debug-payload");
		expect(markup).toContain("<details");
		expect(markup).not.toContain("<details open");
		expect(markup).toContain("Pilot thought");
		expect(markup).toContain(
			"Mission Pilotを停止しました。自動再開されません。",
		);
		expect(markup).toContain("MISSION_PILOT_PRE_QUEUE_UNEXPECTED_RUN");
		expect(markup).toContain("44444444-4444-4444-8444-444444444444");
		expect(markup).not.toContain("repositoryを確認しています");
		expect(markup).not.toContain("exec_command");
		expect(markup).not.toContain("User Flowを生成しています。");
		expect(markup).toContain("現在のSQLite状態（履歴外）");
		expect(markup).toContain(
			"SQLiteに保存されたMission Pilotの判断、状態遷移、LLM証跡だけを表示します。",
		);
	});

	it("shows the persisted stop reason even without a pre-Queue diagnostic", () => {
		const item = missionPilotStopThoughtItem({
			taskId: "11111111-1111-4111-8111-111111111111",
			desiredState: "stopped",
			activityState: "attention",
			phase: "attention",
			authorizationVersion: 3,
			initialPromptState: "sent",
			initialPromptMessageId: null,
			activeRunId: null,
			nextWakeAt: null,
			version: 8,
			lastErrorCode: "MISSION_PILOT_PLAN_PIPELINE_FAILED",
			lastError:
				"Mission Pilot automatic Artifact regeneration limit reached: feature_plan",
			stoppedAt: null,
			queueHandoff: null,
			preQueueDiagnostic: null,
			updatedAt: new Date("2026-07-13T10:23:49Z"),
		});

		expect(item?.event.message).toContain(
			"Mission Pilot automatic Artifact regeneration limit reached: feature_plan",
		);
		expect(item?.event.payloadJson).toMatchObject({
			stopReasonCode: "MISSION_PILOT_PLAN_PIPELINE_FAILED",
			phase: "attention",
		});
	});

	it("labels a normal paused state as a user-requested stop", () => {
		const item = missionPilotStopThoughtItem({
			taskId: "11111111-1111-4111-8111-111111111111",
			desiredState: "stopped",
			activityState: "idle",
			phase: "paused",
			authorizationVersion: 3,
			initialPromptState: "sent",
			initialPromptMessageId: null,
			activeRunId: null,
			nextWakeAt: null,
			version: 9,
			lastErrorCode: null,
			lastError: null,
			stoppedAt: new Date("2026-07-13T10:24:00Z"),
			queueHandoff: null,
			preQueueDiagnostic: null,
			updatedAt: new Date("2026-07-13T10:24:00Z"),
		});

		expect(item?.event.message).toContain("ユーザーの停止操作");
		expect(item?.event.payloadJson).toMatchObject({
			stopReasonCode: "MISSION_PILOT_USER_STOPPED",
		});
	});
});
