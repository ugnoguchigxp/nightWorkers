import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../../api/app";
import { ensureNightWorkersSchema } from "../../api/db/bootstrap";
import { db } from "../../api/db/client";
import {
	missionPilotActionExecutions,
	missionPilotAgentSessions,
	missionPilotConversationItems,
	missionPilotTaskEventInbox,
	missionPilotToolCalls,
} from "../../api/db/mission-pilot-agent-schema";
import { missionPilotSessions } from "../../api/db/mission-pilot-schema";
import { repositories } from "../../api/db/schema";
import { createTask } from "../../api/modules/nightworkers/nightworkers.basic.service";
import { appendTaskMessage } from "../../api/modules/nightworkers/nightworkers.workbench-message.service";

const liveEnabled = process.env.NIGHTWORKERS_LIVE_MISSION_PILOT === "1";
const repositoryIds: string[] = [];

beforeAll(async () => {
	if (process.env.NIGHTWORKERS_LIVE_MISSION_PILOT_PROVIDER === "codex") {
		process.env.ACTIVE_LLM_PROVIDER = "codex";
		process.env.CODEX_ENABLED = "true";
		process.env.CODEX_MODEL =
			process.env.NIGHTWORKERS_LIVE_MISSION_PILOT_MODEL || "gpt-5.6-sol";
	}
	await ensureNightWorkersSchema();
});
afterAll(async () => {
	for (const repositoryId of repositoryIds)
		await db.delete(repositories).where(eq(repositories.id, repositoryId));
});

describe.skipIf(!liveEnabled)("Mission Pilot persistent agent live", () => {
	it("uses public Play, a real provider, Task Operator receipts, and re-evaluates a permission failure", async () => {
		const repositoryId = crypto.randomUUID();
		repositoryIds.push(repositoryId);
		await db.insert(repositories).values({
			id: repositoryId,
			name: "Mission Pilot live",
			localPath: `/tmp/nightworkers-mission-pilot-live-${repositoryId}`,
			branch: "main",
		});
		const task = await createTask({
			repositoryId,
			title: "Mission Pilot persistent runtime live verification",
			objective:
				"Task Operator viewを読み、task.message.sendで「persistent runtime live path confirmed」と一度だけ送信し、その結果を再評価してagent.wait_for_eventを選んでください。",
			acceptanceCriteria:
				"公開Play、実provider、generic tool、Task Operator receiptが一つのpersistent sessionで確認できる。",
		});
		const initialSession = await db.query.missionPilotSessions.findFirst({
			where: eq(missionPilotSessions.taskId, task.id),
		});
		if (!initialSession) throw new Error("Mission Pilot session is missing.");
		const initialItems = await db
			.select()
			.from(missionPilotConversationItems)
			.where(eq(missionPilotConversationItems.sessionId, initialSession.id));
		expect(initialItems).toHaveLength(0);
		const playResponse = await app.request(
			`/api/mission-pilot/tasks/${task.id}/play`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					expectedVersion: task.missionPilot.version,
				}),
			},
		);
		expect(playResponse.status, await playResponse.text()).toBe(200);
		const session = await waitFor(async () => {
			const row = await db.query.missionPilotSessions.findFirst({
				where: eq(missionPilotSessions.taskId, task.id),
			});
			return row?.desiredState === "playing" ? row : null;
		});
		const firstOutcome = await waitFor(async () => {
			const [rows, agent] = await Promise.all([
				db
					.select()
					.from(missionPilotActionExecutions)
					.where(eq(missionPilotActionExecutions.sessionId, session.id)),
				db.query.missionPilotAgentSessions.findFirst({
					where: eq(missionPilotAgentSessions.sessionId, session.id),
				}),
			]);
			const action = rows.find(
				(row) =>
					row.actionId === "task.message.send" && row.status === "succeeded",
			);
			if (action) return { action, failure: null };
			if (agent?.lastFailureJson)
				return { action: null, failure: agent.lastFailureJson };
			return null;
		});
		if (!firstOutcome.action)
			throw new Error(
				`Mission Pilot provider failed before the first action: ${JSON.stringify(firstOutcome.failure)}`,
			);
		const action = firstOutcome.action;
		expect(action.resultJson).toMatchObject({
			receipt: {
				actionId: "task.message.send",
				resourceRefs: [expect.objectContaining({ kind: "task_message" })],
			},
		});
		const firstToolCalls = await db
			.select()
			.from(missionPilotToolCalls)
			.where(eq(missionPilotToolCalls.sessionId, session.id));
		expect(firstToolCalls.map((call) => call.actionId)).toContain(
			"read_task_operator_view",
		);
		expect(firstToolCalls.map((call) => call.actionId)).toContain(
			"task.message.send",
		);

		const beforeItems = await db
			.select()
			.from(missionPilotConversationItems)
			.where(eq(missionPilotConversationItems.sessionId, session.id));
		await appendTaskMessage(
			task.id,
			"現在の権限でTask Operator viewを再取得し、失敗した場合は本文を保持して次の判断をしてください。",
		);
		await waitFor(async () => {
			const event = await db.query.missionPilotTaskEventInbox.findFirst({
				where: eq(missionPilotTaskEventInbox.sessionId, session.id),
				orderBy: (table, { desc }) => [desc(table.sequence)],
			});
			return event?.eventType === "task.user_message_added" ? event : null;
		});
		const current = await db.query.missionPilotSessions.findFirst({
			where: eq(missionPilotSessions.id, session.id),
		});
		if (current?.authorizationJson?.version !== 4)
			throw new Error("Delegated user authorization is missing.");
		await db
			.update(missionPilotSessions)
			.set({
				authorizationJson: {
					...current.authorizationJson,
					userAuthorizationRef: "revoked-live-user",
				},
			})
			.where(eq(missionPilotSessions.id, session.id));

		const failureResult = await waitFor(async () => {
			const items = await db
				.select()
				.from(missionPilotConversationItems)
				.where(eq(missionPilotConversationItems.sessionId, session.id));
			return (
				items
					.slice(beforeItems.length)
					.find(
						(item) =>
							item.kind === "tool_result" &&
							JSON.stringify(item.bodyJson).includes(
								"TASK_OPERATOR_PERMISSION_DENIED",
							),
					) ?? null
			);
		});
		expect(JSON.stringify(failureResult.bodyJson)).toContain(
			"TASK_OPERATOR_PERMISSION_DENIED",
		);
		await waitFor(async () => {
			const items = await db
				.select()
				.from(missionPilotConversationItems)
				.where(eq(missionPilotConversationItems.sessionId, session.id));
			return items
				.slice(beforeItems.length)
				.some(
					(item) =>
						item.kind === "assistant" || item.kind === "runtime_failure",
				)
				? true
				: null;
		});
	}, 180_000);
});

async function waitFor<T>(
	read: () => Promise<T | null>,
	timeoutMs = 90_000,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await read();
		if (value !== null) return value;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`Timed out after ${timeoutMs}ms.`);
}
