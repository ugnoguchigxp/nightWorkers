import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	missionPilotStopThoughtItem,
	missionPilotTraceItems,
	PilotThoughtDock,
} from "../src/modules/missionPilot/components/PilotThoughtDock";
import { AgentDebugEventCard } from "../src/modules/nightworkers/components/ThreadTimelineAgentCards";

describe("PilotThoughtDock", () => {
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

	it("includes only Mission Pilot coordinator and pilot_thought activity events", () => {
		const items = missionPilotTraceItems({
			messages: [],
			events: [
				{
					id: "pilot-event-1",
					eventType: "implementation.completed",
					phase: "test_preparing",
					cycle: 1,
					contextRevision: 3,
					sourceKind: "task_run",
					sourceId: "implementation-run",
					payloadJson: { nextPhase: "test" },
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
			"implementation.completed",
			"次のphaseへ進みます",
		]);
		expect(items[1]?.event.actor).toBe("mission_pilot");
		expect(items[1]?.event.payloadJson).toMatchObject({
			toolName: "exec_command",
		});
	});

	it("renders Pilot decisions without task execution or screen generation logs", () => {
		const markup = renderToStaticMarkup(
			<PilotThoughtDock
				session={{
					id: "11111111-1111-4111-8111-111111111111",
					repositoryId: "22222222-2222-4222-8222-222222222222",
					title: "Mission Pilot task",
					status: "running",
					timeoutSeconds: 3600,
					priority: 0,
					createdAt: new Date(),
					updatedAt: new Date(),
					missionPilot: {
						taskId: "11111111-1111-4111-8111-111111111111",
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
					},
				}}
				onClose={vi.fn()}
			/>,
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
		expect(markup).toContain("Mission Pilotの判断要約、状態遷移、LLM証跡");
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
