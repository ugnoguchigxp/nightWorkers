import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories, tasks } from "../api/db/schema";
import {
	appendMissionPilotTaskEvent,
	listPendingMissionPilotTaskEvents,
} from "../api/modules/missionPilot/agent/mission-pilot-task-event.repository";
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
			name: "event inbox",
			localPath: "/tmp/event-inbox",
			branch: "main",
		});
		const [task] = await tx
			.insert(tasks)
			.values({
				id: taskId,
				repositoryId,
				title: "event inbox",
				objective: "typed event ordering",
			})
			.returning();
		return createSession(
			{ task, sourceKind: "task", sourceId: task.id, runtimeKind: "agent" },
			tx,
		);
	});
	return { taskId, sessionId: session.id };
}

describe("Mission Pilot task event inbox", () => {
	it("deduplicates source event IDs and assigns monotonic sequence", async () => {
		const testFixture = await fixture();
		const first = await appendMissionPilotTaskEvent({
			taskId: testFixture.taskId,
			eventType: "task.state_changed",
			sourceEventId: "event-1",
			taskRevision: 1,
			payload: { status: "ready" },
		});
		const duplicate = await appendMissionPilotTaskEvent({
			taskId: testFixture.taskId,
			eventType: "task.state_changed",
			sourceEventId: "event-1",
			taskRevision: 1,
			payload: { status: "ready" },
		});
		const second = await appendMissionPilotTaskEvent({
			taskId: testFixture.taskId,
			eventType: "task.user_message_added",
			sourceEventId: "event-2",
			taskRevision: 2,
			payload: { messageId: "message-2" },
		});
		expect(duplicate?.id).toBe(first?.id);
		expect([first?.sequence, second?.sequence]).toEqual([1, 2]);
		expect(
			(await listPendingMissionPilotTaskEvents(testFixture.sessionId)).map(
				(event) => event.sourceEventId,
			),
		).toEqual(["event-1", "event-2"]);
	});
});
