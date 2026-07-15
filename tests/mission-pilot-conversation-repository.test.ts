import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories, tasks } from "../api/db/schema";
import { reconcileInterruptedMissionPilotAgentSessions } from "../api/modules/missionPilot/agent/mission-pilot-agent-lifecycle.repository";
import { claimAgentPlay } from "../api/modules/missionPilot/agent/mission-pilot-agent-session.repository";
import {
	claimMissionPilotAgentTurn,
	claimMissionPilotToolCall,
	listMissionPilotConversation,
	persistMissionPilotProviderTurn,
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
			name: "conversation repository",
			localPath: "/tmp/conversation-repository",
			branch: "main",
		});
		const [task] = await tx
			.insert(tasks)
			.values({
				id: taskId,
				repositoryId,
				title: "conversation repository",
				objective: "restart reconcile",
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
	await claimAgentPlay(taskId, session.version);
	await seedMissionPilotConversation({
		sessionId: session.id,
		systemContext: "system",
		initialPrompt: "restart reconcile",
	});
	await appendMissionPilotTaskEvent({
		taskId,
		eventType: "mission_pilot.resume_requested",
		sourceEventId: "resume-once",
		taskRevision: 1,
		payload: {},
	});
	return { taskId, sessionId: session.id };
}

describe("Mission Pilot conversation repository", () => {
	it("keeps sequence monotonic and reconciles an ambiguous running mutation without replay", async () => {
		const { sessionId } = await fixture();
		const turn = await claimMissionPilotAgentTurn({
			sessionId,
			leaseOwner: "test-lease",
		});
		if (!turn) throw new Error("turn was not claimed");
		const calls = await persistMissionPilotProviderTurn({
			sessionId,
			turnId: turn.turnId,
			leaseOwner: "test-lease",
			content: "Task更新を試します。",
			toolCalls: [
				{
					id: "provider-call-once",
					name: "task_update",
					arguments: { expectedRevision: 1, fields: { title: "updated" } },
				},
			],
			provider: "fixture",
			model: "fixture-model",
		});
		if (!calls?.[0]) throw new Error("tool call was not persisted");
		const running = await claimMissionPilotToolCall({
			id: calls[0].id,
			leaseOwner: "test-lease",
		});
		expect(running?.status).toBe("running");

		expect(await reconcileInterruptedMissionPilotAgentSessions()).toHaveLength(
			0,
		);
		await reconcileInterruptedMissionPilotAgentSessions(
			new Date(Date.now() + 10 * 60_000),
		);
		const items = await listMissionPilotConversation(sessionId);
		expect(items.map((item) => item.sequence)).toEqual(
			items.map((item) => item.sequence).toSorted((a, b) => a - b),
		);
		expect(new Set(items.map((item) => item.sequence)).size).toBe(items.length);
		const toolResult = items.findLast((item) => item.kind === "tool_result");
		expect(toolResult?.bodyJson).toMatchObject({
			providerCallId: "provider-call-once",
		});
		expect(JSON.stringify(toolResult?.bodyJson)).toContain("outcome_unknown");
	});
});
