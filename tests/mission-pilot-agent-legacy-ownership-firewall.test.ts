import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories, tasks } from "../api/db/schema";
import { resolveMissionPilotRuntimeOwnership } from "../api/modules/missionPilot/agent/mission-pilot-runtime-ownership.service";
import { createSession } from "../api/modules/missionPilot/mission-pilot.repository";

const repositoryIds: string[] = [];

beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const repositoryId of repositoryIds.splice(0))
		await db.delete(repositories).where(eq(repositories.id, repositoryId));
});

async function createFixture(runtimeKind?: "agent") {
	const repositoryId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	repositoryIds.push(repositoryId);
	const session = await db.transaction(async (tx) => {
		await tx.insert(repositories).values({
			id: repositoryId,
			name: "ownership fixture",
			localPath: "/tmp/ownership-fixture",
			branch: "main",
		});
		const [task] = await tx
			.insert(tasks)
			.values({
				id: taskId,
				repositoryId,
				title: "ownership fixture",
				objective: "ownership",
			})
			.returning();
		return createSession(
			{ task, sourceKind: "task", sourceId: task.id, runtimeKind },
			tx,
		);
	});
	return { taskId, sessionId: session.id };
}

describe("Mission Pilot runtime ownership", () => {
	it("uses the agent session row as the sole ownership source", async () => {
		const fixture = await createFixture("agent");
		expect(
			await resolveMissionPilotRuntimeOwnership({ taskId: fixture.taskId }),
		).toEqual({ kind: "agent", sessionId: fixture.sessionId });
	});

	it("creates every new session as an agent session", async () => {
		const fixture = await createFixture();
		expect(
			await resolveMissionPilotRuntimeOwnership({
				sessionId: fixture.sessionId,
			}),
		).toEqual({ kind: "agent", sessionId: fixture.sessionId });
	});

	it("does not infer ownership for an unknown session", async () => {
		expect(
			await resolveMissionPilotRuntimeOwnership({
				sessionId: crypto.randomUUID(),
			}),
		).toEqual({ kind: "none" });
	});
});
