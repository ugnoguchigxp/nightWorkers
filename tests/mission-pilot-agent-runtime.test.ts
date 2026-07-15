import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories, tasks } from "../api/db/schema";
import type {
	MissionPilotProviderPort,
	MissionPilotTaskActionPort,
	MissionPilotTaskReadPort,
} from "../api/modules/missionPilot/agent/mission-pilot-agent.ports";
import {
	runMissionPilotAgentWake,
	stopMissionPilotAgentRuntime,
} from "../api/modules/missionPilot/agent/mission-pilot-agent-runtime";
import {
	claimAgentPlay,
	claimAgentStop,
} from "../api/modules/missionPilot/agent/mission-pilot-agent-session.repository";
import {
	listMissionPilotConversation,
	seedMissionPilotConversation,
} from "../api/modules/missionPilot/agent/mission-pilot-conversation.repository";
import { appendMissionPilotTaskEvent } from "../api/modules/missionPilot/agent/mission-pilot-task-event.repository";
import {
	createSession,
	getSessionByTaskId,
} from "../api/modules/missionPilot/mission-pilot.repository";

const repositoryIds: string[] = [];
beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const id of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, id));
	}
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
				title: "persistent agent",
				objective: "同じsessionで判断を継続する",
			})
			.returning();
		return createSession(
			{
				task,
				sourceKind: "task",
				sourceId: task.id,
				runtimeKind: "agent",
			},
			tx,
		);
	});
	const claimed = await claimAgentPlay(taskId, session.version);
	if (!claimed) throw new Error("agent play claim failed");
	await seedMissionPilotConversation({
		sessionId: session.id,
		systemContext: "Mission Pilot system context",
		initialPrompt: "同じsessionで判断を継続する",
	});
	await appendMissionPilotTaskEvent({
		taskId,
		eventType: "mission_pilot.resume_requested",
		sourceEventId: `play:${session.id}`,
		taskRevision: 1,
		payload: { reason: "test" },
	});
	return { taskId, sessionId: session.id };
}

describe("persistent Mission Pilot runtime", () => {
	it("continues a provider/tool loop in one stable session and preserves assistant text", async () => {
		const { taskId, sessionId } = await fixture();
		const providerResults = [
			{
				type: "supported" as const,
				content: "まずTask workspaceを確認します。",
				toolCalls: [
					{
						id: "call-read-workspace",
						name: "read_task_workspace",
						arguments: {},
					},
				],
				usage: usage(),
			},
			{
				type: "supported" as const,
				content: "Factを確認しました。次のtyped eventまで待機します。",
				toolCalls: [],
				usage: usage(),
			},
		];
		const provider: MissionPilotProviderPort = {
			nextTurn: vi.fn(async () => {
				const result = providerResults.shift();
				if (!result) throw new Error("unexpected provider call");
				return result;
			}),
		};
		const readPort = {
			readTaskWorkspace: vi.fn(async () => ({ taskId, status: "draft" })),
			readCurrentSpecification: vi.fn(),
			readQuestionnaireDecisions: vi.fn(),
			readPlanArtifact: vi.fn(),
			readRunOutcome: vi.fn(),
			listAvailableTaskActions: vi.fn(),
		} as unknown as MissionPilotTaskReadPort;
		const actionPort = {
			execute: vi.fn(),
		} as unknown as MissionPilotTaskActionPort;

		const result = await runMissionPilotAgentWake(
			{ sessionId },
			{ provider, readPort, actionPort },
		);
		expect(result).toMatchObject({ kind: "waiting" });
		expect(provider.nextTurn).toHaveBeenCalledTimes(2);
		expect(readPort.readTaskWorkspace).toHaveBeenCalledWith({
			taskId,
			sessionId,
		});
		expect((await getSessionByTaskId(taskId))?.id).toBe(sessionId);
		expect((await getSessionByTaskId(taskId))?.runtimeState).toBe("waiting");
		const items = await listMissionPilotConversation(sessionId);
		expect(items.map((item) => item.kind)).toEqual(
			expect.arrayContaining([
				"system_context",
				"task_event",
				"assistant",
				"tool_call",
				"tool_result",
			]),
		);
		expect(
			items.some(
				(item) =>
					item.kind === "assistant" &&
					(item.bodyJson as { content?: string }).content ===
						"まずTask workspaceを確認します。",
			),
		).toBe(true);
	});

	it("accepts a text-only turn as a normal waiting state", async () => {
		const { sessionId } = await fixture();
		const result = await runMissionPilotAgentWake(
			{ sessionId },
			{
				provider: {
					nextTurn: async () => ({
						type: "supported",
						content: "ユーザー入力を待ちます。",
						toolCalls: [],
						usage: usage(),
					}),
				},
			},
		);
		expect(result).toEqual({
			kind: "waiting",
			content: "ユーザー入力を待ちます。",
		});
	});

	it("persists a typed provider capability failure for a later resume", async () => {
		const { sessionId } = await fixture();
		const result = await runMissionPilotAgentWake(
			{ sessionId },
			{
				provider: {
					nextTurn: async () => ({
						type: "unsupported",
						reason: "tool calling is unavailable",
					}),
				},
			},
		);
		expect(result).toMatchObject({
			kind: "attention",
			failure: { kind: "provider_capability", retryable: false },
		});
		const items = await listMissionPilotConversation(sessionId);
		const failureItem = items.findLast(
			(item) => item.sourceKind === "runtime_failure",
		);
		expect(JSON.stringify(failureItem?.bodyJson)).toContain(
			"provider_capability",
		);
	});

	it("compacts by token budget and continues in the same session", async () => {
		const { sessionId } = await fixture();
		const responses = [
			{
				type: "supported" as const,
				content: "採用済み判断と未解決事項の要約",
				toolCalls: [],
				usage: usage(),
			},
			{
				type: "supported" as const,
				content: "要約から判断を再開し、次のeventを待ちます。",
				toolCalls: [],
				usage: usage(),
			},
		];
		const provider: MissionPilotProviderPort = {
			nextTurn: vi.fn(async () => {
				const response = responses.shift();
				if (!response) throw new Error("unexpected provider call");
				return response;
			}),
		};
		const result = await runMissionPilotAgentWake(
			{ sessionId },
			{ provider, compactionTokenBudget: 1 },
		);
		expect(result).toMatchObject({ kind: "waiting" });
		expect(provider.nextTurn).toHaveBeenCalledTimes(2);
		const items = await listMissionPilotConversation(sessionId);
		expect(
			items.some(
				(item) =>
					item.kind === "compaction_summary" &&
					JSON.stringify(item.bodyJson).includes("採用済み判断"),
			),
		).toBe(true);
	});

	it("does not persist or execute a provider response received after stop", async () => {
		const { taskId, sessionId } = await fixture();
		type ProviderResponse = Awaited<
			ReturnType<MissionPilotProviderPort["nextTurn"]>
		>;
		let resolveProvider!: (value: ProviderResponse) => void;
		const response = new Promise<ProviderResponse>((resolve) => {
			resolveProvider = resolve;
		});
		const actionPort = {
			execute: vi.fn(),
		} as unknown as MissionPilotTaskActionPort;
		const provider: MissionPilotProviderPort = {
			nextTurn: vi.fn(() => response),
		};
		const wake = runMissionPilotAgentWake(
			{ sessionId },
			{ provider, actionPort },
		);
		await vi.waitFor(() => expect(provider.nextTurn).toHaveBeenCalledOnce());
		const active = await getSessionByTaskId(taskId);
		if (!active) throw new Error("active session is missing");
		expect(await claimAgentStop(taskId, active.version)).not.toBeNull();
		expect(stopMissionPilotAgentRuntime(sessionId)).toBe(true);
		resolveProvider({
			type: "supported",
			content: "停止後に到着した応答",
			toolCalls: [
				{
					id: "late-action",
					name: "task_archive",
					arguments: {},
				},
			],
			usage: usage(),
		});

		await expect(wake).resolves.toMatchObject({ kind: "stopped" });
		expect(actionPort.execute).not.toHaveBeenCalled();
		expect(
			(await listMissionPilotConversation(sessionId)).some(
				(item) => item.kind === "tool_call",
			),
		).toBe(false);
		expect(await getSessionByTaskId(taskId)).toMatchObject({
			desiredState: "stopped",
			runtimeState: "stopped",
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
