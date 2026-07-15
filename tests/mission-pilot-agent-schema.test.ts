import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { client, db } from "../api/db/client";
import { missionPilotSessions } from "../api/db/mission-pilot-schema";
import { repositories, tasks } from "../api/db/schema";
import { createSession } from "../api/modules/missionPilot/mission-pilot.repository";
import { missionPilotActionFailureSchema } from "../shared/schemas/mission-pilot-agent.schema";

const repositoryIds: string[] = [];

beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const id of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, id));
	}
});

describe("Mission Pilot agent schema", () => {
	it("creates additive agent runtime tables and fixes runtime kind per session", async () => {
		const repositoryId = crypto.randomUUID();
		const taskId = crypto.randomUUID();
		repositoryIds.push(repositoryId);
		const session = await db.transaction(async (tx) => {
			await tx.insert(repositories).values({
				id: repositoryId,
				name: "agent schema",
				localPath: "/tmp/agent-schema",
				branch: "main",
			});
			const [task] = await tx
				.insert(tasks)
				.values({
					id: taskId,
					repositoryId,
					title: "agent schema",
					objective: "永続化を確認する",
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
		expect(session).toMatchObject({
			runtimeKind: "agent",
			runtimeState: "stopped",
			conversationRevision: 0,
			nextConversationSequence: 1,
		});
		const tables = await client.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'mission_pilot_%'",
		);
		const names = new Set(tables.rows.map((row) => row.name));
		for (const table of [
			"mission_pilot_agent_turns",
			"mission_pilot_conversation_items",
			"mission_pilot_tool_calls",
			"mission_pilot_task_event_inbox",
		]) {
			expect(names.has(table)).toBe(true);
		}
		expect(
			await db
				.select()
				.from(missionPilotSessions)
				.where(eq(missionPilotSessions.id, session.id)),
		).toHaveLength(1);
	});

	it("keeps typed provider and action failures separate from model text", () => {
		expect(
			missionPilotActionFailureSchema.parse({
				kind: "provider_capacity",
				retryable: true,
				providerCode: "capacity",
				httpStatus: 503,
				message: "provider returned its original message",
				retryAfterMs: 1000,
				attempt: 1,
				actionId: "plan.artifact.generate",
				idempotencyKey: "same-key",
			}),
		).toMatchObject({
			retryable: true,
			message: "provider returned its original message",
		});
	});
});
