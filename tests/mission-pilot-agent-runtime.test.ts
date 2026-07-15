import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	missionPilotAgentSessions,
	missionPilotToolCalls,
} from "../api/db/mission-pilot-agent-schema";
import { missionPilotSessions } from "../api/db/mission-pilot-schema";
import { repositories, tasks } from "../api/db/schema";
import type { MissionPilotTaskReadPort } from "../api/modules/missionPilot/agent/mission-pilot-agent.ports";
import { runMissionPilotAgentWake } from "../api/modules/missionPilot/agent/mission-pilot-agent-runtime";
import { claimAgentPlay } from "../api/modules/missionPilot/agent/mission-pilot-agent-session.repository";
import {
	appendMissionPilotUserMessage,
	claimMissionPilotAgentTurn,
	claimMissionPilotToolCall,
	listMissionPilotConversation,
	persistMissionPilotProviderTurn,
	reconcileInterruptedMissionPilotAgentSessions,
	seedMissionPilotConversation,
} from "../api/modules/missionPilot/agent/mission-pilot-conversation.repository";
import { appendMissionPilotTaskEvent } from "../api/modules/missionPilot/agent/mission-pilot-task-event.repository";
import { createSession } from "../api/modules/missionPilot/mission-pilot.repository";

const repositoryIds: string[] = [];
beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const id of repositoryIds.splice(0))
		await db.delete(repositories).where(eq(repositories.id, id));
});

async function fixture() {
	const repositoryId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	repositoryIds.push(repositoryId);
	const session = await db.transaction(async (tx) => {
		await tx.insert(repositories).values({
			id: repositoryId,
			name: "agent runtime",
			localPath: "/tmp/agent-runtime",
			branch: "main",
		});
		const [task] = await tx
			.insert(tasks)
			.values({
				id: taskId,
				repositoryId,
				title: "agent runtime",
				objective: "永続sessionを検証する",
			})
			.returning();
		return createSession(
			{ task, sourceKind: "task", sourceId: task.id, runtimeKind: "agent" },
			tx,
		);
	});
	const claimed = await claimAgentPlay(taskId, session.version);
	if (!claimed) throw new Error("agent session was not claimed");
	await seedMissionPilotConversation({
		sessionId: claimed.id,
		systemContext: "System Context",
		initialPrompt: claimed.initialPromptSnapshot,
	});
	await appendMissionPilotTaskEvent({
		taskId,
		eventType: "mission_pilot.resume_requested",
		sourceEventId: "runtime-test",
		taskRevision: 1,
		payload: { reason: "test" },
	});
	return { taskId, sessionId: claimed.id, publicVersion: claimed.version };
}

const readPort: MissionPilotTaskReadPort = {
	readTaskWorkspace: async () => ({
		task: {
			id: "task",
			title: "title",
			description: null,
			objective: "goal",
			acceptanceCriteria: null,
			status: "ready",
			revision: 1,
		},
		project: { id: "project", name: "project", repositoryState: "registered" },
		currentView: null,
		questionnaire: null,
		planArtifacts: [],
		queue: null,
		activeRun: null,
		terminalRuns: [],
		availableActions: [],
	}),
	readCurrentSpecification: async () => null,
	readQuestionnaireDecisions: async () => null,
	readPlanArtifact: async () => null,
	readRunOutcome: async () => null,
	readRunChangeSummary: async () => null,
	readRunVerification: async () => null,
	listAvailableTaskActions: async () => [],
};

describe("Mission Pilot persistent agent runtime", () => {
	it("keeps an assistant-only turn as waiting and preserves the same logical session", async () => {
		const fixtureState = await fixture();
		const result = await runMissionPilotAgentWake(
			{ sessionId: fixtureState.sessionId },
			{
				readPort,
				provider: {
					nextTurn: async () => ({
						type: "supported",
						content: "現在のFactを確認しました。",
						toolCalls: [],
						usage: usage(),
					}),
				},
			},
		);
		expect(result).toMatchObject({
			kind: "waiting",
			content: "現在のFactを確認しました。",
		});
		const items = await import(
			"../api/modules/missionPilot/agent/mission-pilot-conversation.repository"
		).then((module) =>
			module.listMissionPilotConversation(fixtureState.sessionId),
		);
		expect(items.map((item) => item.kind)).toEqual(
			expect.arrayContaining([
				"system_context",
				"user",
				"task_event",
				"assistant",
			]),
		);
		const [session] = await db
			.select({
				version: missionPilotSessions.version,
				phase: missionPilotSessions.phase,
			})
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, fixtureState.sessionId));
		expect(session?.version).toBe(fixtureState.publicVersion);
		expect(session?.phase).toBe("paused");
	});

	it("records tool results without importing worker transcript into the conversation", async () => {
		const fixtureState = await fixture();
		const result = await runMissionPilotAgentWake(
			{ sessionId: fixtureState.sessionId },
			{
				readPort,
				provider: {
					nextTurn: async ({ messages }) =>
						messages.some((message) => message.role === "tool")
							? {
									type: "supported",
									content: "Factを受け取りました。",
									toolCalls: [],
									usage: usage(),
								}
							: {
									type: "supported",
									content: "Task Factを取得します。",
									toolCalls: [
										{
											id: "read-1",
											name: "read_task_workspace",
											arguments: {},
										},
									],
									usage: usage(),
								},
				},
			},
		);
		expect(result).toMatchObject({ kind: "waiting" });
		const items = await import(
			"../api/modules/missionPilot/agent/mission-pilot-conversation.repository"
		).then((module) =>
			module.listMissionPilotConversation(fixtureState.sessionId),
		);
		const serialized = JSON.stringify(items);
		expect(serialized).not.toContain("nativeApiTurns");
		expect(items.some((item) => item.kind === "tool_result")).toBe(true);
	});

	it("executes a claimed Task action once and never reclaims its terminal call", async () => {
		const fixtureState = await fixture();
		let providerCalls = 0;
		const [before] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.id, fixtureState.taskId));
		if (!before) throw new Error("task fixture is missing");
		const result = await runMissionPilotAgentWake(
			{ sessionId: fixtureState.sessionId },
			{
				readPort,
				provider: {
					nextTurn: async () => {
						providerCalls += 1;
						return providerCalls > 2
							? {
									type: "supported",
									content: "Task更新を確認しました。",
									toolCalls: [],
									usage: usage(),
								}
							: {
									type: "supported",
									content: "Task名を更新します。",
									toolCalls: [
										{
											id: "task-update-1",
											name: "task_update",
											arguments: {
												expectedTaskRevision: before.updatedAt.getTime(),
												fields: { title: "updated by persistent agent" },
											},
										},
									],
									usage: usage(),
								};
					},
				},
			},
		);
		expect(result).toMatchObject({ kind: "waiting" });
		const [updated] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.id, fixtureState.taskId));
		expect(updated?.title).toBe("updated by persistent agent");
		const toolCalls = await db
			.select()
			.from(missionPilotToolCalls)
			.where(eq(missionPilotToolCalls.sessionId, fixtureState.sessionId));
		expect(toolCalls).toHaveLength(1);
		const [toolCall] = toolCalls;
		expect(toolCall?.status).toBe("succeeded");
		const items = await listMissionPilotConversation(fixtureState.sessionId);
		expect(
			items.filter(
				(item) =>
					item.kind === "tool_result" && item.toolCallId === toolCall?.id,
			),
		).toHaveLength(2);
		expect(
			await claimMissionPilotToolCall({
				id: toolCall?.id ?? "missing",
				leaseOwner: "replay-attempt",
			}),
		).toBeNull();
	});

	it("closes pending tool calls with a persisted result when an expired turn is reconciled", async () => {
		const fixtureState = await fixture();
		const leaseOwner = "expired-runtime";
		const turn = await claimMissionPilotAgentTurn({
			sessionId: fixtureState.sessionId,
			leaseOwner,
		});
		if (!turn) throw new Error("agent turn was not claimed");
		const [task] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.id, fixtureState.taskId));
		if (!task) throw new Error("task fixture is missing");
		await persistMissionPilotProviderTurn({
			sessionId: fixtureState.sessionId,
			turnId: turn.turnId,
			leaseOwner,
			content: "Task名を更新します。",
			toolCalls: [
				{
					id: "pending-before-crash",
					name: "task_update",
					arguments: {
						expectedTaskRevision: task.updatedAt.getTime(),
						fields: { title: "must not be applied" },
					},
				},
			],
		});
		await db
			.update(missionPilotAgentSessions)
			.set({ leaseExpiresAt: new Date(0) })
			.where(eq(missionPilotAgentSessions.sessionId, fixtureState.sessionId));

		await reconcileInterruptedMissionPilotAgentSessions(new Date());

		const [toolCall] = await db
			.select()
			.from(missionPilotToolCalls)
			.where(eq(missionPilotToolCalls.sessionId, fixtureState.sessionId));
		expect(toolCall).toMatchObject({
			status: "failed",
			failureJson: { kind: "domain_precondition" },
		});
		const items = await listMissionPilotConversation(fixtureState.sessionId);
		expect(
			items.some(
				(item) =>
					item.kind === "tool_result" && item.toolCallId === toolCall?.id,
			),
		).toBe(true);
		const [unchanged] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.id, fixtureState.taskId));
		expect(unchanged?.title).toBe("agent runtime");
	});

	it("projects the latest compaction summary without deleting canonical conversation", async () => {
		const fixtureState = await fixture();
		const canonicalContent = `永続conversation:${"x".repeat(160_000)}`;
		await appendMissionPilotUserMessage({
			sessionId: fixtureState.sessionId,
			content: canonicalContent,
		});
		let compactionCalls = 0;
		let regularCalls = 0;
		const result = await runMissionPilotAgentWake(
			{ sessionId: fixtureState.sessionId },
			{
				readPort,
				compactionTokenBudget: 40_000,
				maxProviderCallsPerWake: 4,
				provider: {
					nextTurn: async ({ tools }) => {
						if (tools.length === 0) {
							compactionCalls += 1;
							return {
								type: "supported",
								content:
									"ユーザー依頼と未解決事項を保持したcompaction summary。",
								toolCalls: [],
								usage: usage(),
							};
						}
						regularCalls += 1;
						return {
							type: "supported",
							content: "summaryから判断を継続しました。",
							toolCalls: [],
							usage: usage(),
						};
					},
				},
			},
		);
		expect(result).toMatchObject({ kind: "waiting" });
		expect({ compactionCalls, regularCalls }).toEqual({
			compactionCalls: 1,
			regularCalls: 1,
		});
		const canonical = await listMissionPilotConversation(
			fixtureState.sessionId,
		);
		expect(
			canonical.some(
				(item) =>
					item.kind === "user" &&
					JSON.stringify(item.bodyJson).includes(
						canonicalContent.slice(0, 100),
					),
			),
		).toBe(true);
		expect(canonical.some((item) => item.kind === "compaction_summary")).toBe(
			true,
		);
	});

	it("stops a hung provider call at the wake elapsed-time budget", async () => {
		const fixtureState = await fixture();
		const result = await runMissionPilotAgentWake(
			{ sessionId: fixtureState.sessionId },
			{
				readPort,
				maxElapsedMsPerWake: 10,
				provider: {
					nextTurn: ({ signal }) =>
						new Promise<never>((_, reject) => {
							signal.addEventListener("abort", () => reject(signal.reason), {
								once: true,
							});
						}),
				},
			},
		);
		expect(result).toMatchObject({
			kind: "attention",
			failure: { kind: "resource_limit" },
		});
	});
});

function usage() {
	return {
		inputTokens: 1,
		outputTokens: 1,
		cachedInputTokens: 0,
		reasoningOutputTokens: 0,
		totalTokens: 2,
		mode: "provider_reported" as const,
	};
}
