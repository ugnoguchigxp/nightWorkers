import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	missionPilotTraceItems,
	PilotThoughtDock,
} from "../src/modules/missionPilot/components/PilotThoughtDock";

describe("PilotThoughtDock", () => {
	it("includes Mission Pilot coordinator events and every event from owned implementation/test runs", () => {
		const items = missionPilotTraceItems({
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
			runEvents: [
				{
					id: "implementation-tool-call",
					taskRunId: "implementation-run",
					seq: 4,
					actor: "tool",
					eventType: "tool.call",
					message: "実装ファイルを確認しています",
					payloadJson: { toolName: "exec_command" },
					missionPilotPhase: "implementation",
					missionPilotCycle: 1,
					missionPilotAttempt: 1,
					timestamp: new Date("2026-07-13T00:00:01Z"),
				},
				{
					id: "test-thought",
					taskRunId: "test-run",
					seq: 2,
					actor: "worker",
					eventType: "assistant.reasoning",
					message: "テスト証跡を評価しています",
					missionPilotPhase: "test",
					missionPilotCycle: 1,
					missionPilotAttempt: 1,
					timestamp: new Date("2026-07-13T00:00:02Z"),
				},
			],
		});

		expect(items.map((item) => item.event.message)).toEqual([
			"implementation.completed",
			"実装ファイルを確認しています",
			"テスト証跡を評価しています",
		]);
		expect(items[1]?.event.actor).toBe("tool");
		expect(items[1]?.event.payloadJson).toMatchObject({
			missionPilotPhase: "implementation",
			toolName: "exec_command",
		});
		expect(items[2]?.event.payloadJson).toMatchObject({
			missionPilotPhase: "test",
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
						desiredState: "playing",
						activityState: "running",
						phase: "running",
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
				activityEvents={[
					{
						id: "activity-1",
						taskId: "11111111-1111-4111-8111-111111111111",
						seq: 1,
						kind: "runtime.decision",
						source: "mission_pilot",
						text: "20秒間、ユーザーの変更を待ちます。",
						payloadJson: { decision: "wait_for_user_or_auto_submit" },
						visibility: "visible",
						createdAt: new Date("2026-07-11T10:00:00Z"),
					},
					{
						id: "activity-2",
						taskId: "11111111-1111-4111-8111-111111111111",
						seq: 2,
						kind: "llm.response_delta",
						source: "dedicated-view-generator",
						text: "User Flowを生成しています。",
						payloadJson: {},
						visibility: "visible",
						createdAt: new Date("2026-07-11T10:00:00Z"),
					},
				]}
				runEvents={[
					{
						id: "event-1",
						runId: "33333333-3333-4333-8333-333333333333",
						eventType: "tool.call",
						actor: "tool",
						message: "repositoryを確認しています",
						payloadJson: { toolName: "exec_command" },
						createdAt: new Date("2026-07-11T10:00:01Z"),
					},
					{
						id: "event-2",
						eventType: "runtime.decision",
						actor: "mission_pilot",
						message: "設計判断を確定しました。",
						payloadJson: { decision: "continue" },
						createdAt: new Date("2026-07-11T10:00:02Z"),
					},
				]}
				onClose={vi.fn()}
			/>,
		);

		expect(markup).toContain("nightworkers-chat-dock");
		expect(markup).not.toContain("nightworkers-message-bubble");
		expect(markup).toContain("w-full border-slate-700/80 border-b");
		expect(markup).toContain("nightworkers-debug-payload");
		expect(markup).toContain("<details");
		expect(markup).not.toContain("<details open");
		expect(markup).toContain("Pilot thought");
		expect(markup).toContain("20秒間、ユーザーの変更を待ちます。");
		expect(markup).toContain("設計判断を確定しました。");
		expect(markup).toContain(
			"Mission Pilotを停止しました。自動再開されません。",
		);
		expect(markup).toContain("MISSION_PILOT_PRE_QUEUE_UNEXPECTED_RUN");
		expect(markup).toContain("44444444-4444-4444-8444-444444444444");
		expect(markup).not.toContain("repositoryを確認しています");
		expect(markup).not.toContain("exec_command");
		expect(markup).not.toContain("User Flowを生成しています。");
	});
});
