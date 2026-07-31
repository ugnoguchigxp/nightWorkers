import crypto from "node:crypto";
import "./helpers/mission-pilot-runtime";
import { executeMissionPilotAgentControlTool } from "@nightworkers/mission-pilot/testing";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories, tasks } from "../api/db/schema";
import {
	createSession,
	missionPilotAgentSessions,
	missionPilotSessions,
} from "../api/modules/missionPilot/persistence";

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
			name: "completion fixture",
			localPath: "/tmp/completion-fixture",
			branch: "main",
		});
		const [task] = await tx
			.insert(tasks)
			.values({
				id: taskId,
				repositoryId,
				title: "completion fixture",
				objective: "completion",
			})
			.returning();
		return createSession({ task, sourceKind: "task", sourceId: task.id }, tx);
	});
	const turnId = crypto.randomUUID();
	const leaseOwner = `completion-fixture:${crypto.randomUUID()}`;
	await db
		.update(missionPilotSessions)
		.set({ desiredState: "playing" })
		.where(eq(missionPilotSessions.id, session.id));
	await db
		.update(missionPilotAgentSessions)
		.set({ runtimeState: "running", currentTurnId: turnId, leaseOwner })
		.where(eq(missionPilotAgentSessions.sessionId, session.id));
	return { taskId, sessionId: session.id, turnId, leaseOwner };
}

describe("Mission Pilot explicit completion", () => {
	it("lets the LLM finish without a host-owned Task status rule", async () => {
		const fixtureState = await fixture();
		const result = await executeMissionPilotAgentControlTool({
			call: {
				id: crypto.randomUUID(),
				name: "agent.finish",
				arguments: { summary: "done" },
			},
			toolCallId: crypto.randomUUID(),
			turnId: fixtureState.turnId,
			leaseOwner: fixtureState.leaseOwner,
			taskId: fixtureState.taskId,
			sessionId: fixtureState.sessionId,
		});
		expect(result).toMatchObject({ ok: true, data: { kind: "finish" } });
	});

	it("rejects finish when the current turn lease is invalid", async () => {
		const fixtureState = await fixture();
		const result = await executeMissionPilotAgentControlTool({
			call: {
				id: crypto.randomUUID(),
				name: "agent.finish",
				arguments: { summary: "done" },
			},
			toolCallId: crypto.randomUUID(),
			turnId: fixtureState.turnId,
			leaseOwner: "invalid-lease",
			taskId: fixtureState.taskId,
			sessionId: fixtureState.sessionId,
		});
		expect(result).toMatchObject({
			ok: false,
			failure: { kind: "domain_precondition" },
		});
	});
});
