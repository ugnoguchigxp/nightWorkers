import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories, tasks } from "../api/db/schema";
import { claimAgentPlay } from "../api/modules/missionPilot/agent/mission-pilot-agent-session.repository";
import {
	createSession,
	getSessionByTaskId,
} from "../api/modules/missionPilot/mission-pilot.repository";
import { createTaskWithMissionPilot } from "../api/modules/nightworkers/nightworkers.task-creation.service";

const repositoryIds: string[] = [];
beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const id of repositoryIds.splice(0))
		await db.delete(repositories).where(eq(repositories.id, id));
});

describe("Mission Pilot legacy and agent coexistence", () => {
	it("keeps existing legacy rows fixed while agent rows use the new lifecycle", async () => {
		const repositoryId = crypto.randomUUID();
		repositoryIds.push(repositoryId);
		const result = await db.transaction(async (tx) => {
			await tx.insert(repositories).values({
				id: repositoryId,
				name: "coexistence",
				localPath: "/tmp/coexistence",
				branch: "main",
			});
			const [legacyTask, agentTask] = await tx
				.insert(tasks)
				.values([
					{
						id: crypto.randomUUID(),
						repositoryId,
						title: "legacy",
						objective: "legacyで完了する",
					},
					{
						id: crypto.randomUUID(),
						repositoryId,
						title: "agent",
						objective: "agentで継続する",
					},
				])
				.returning();
			const legacy = await createSession(
				{
					task: legacyTask,
					sourceKind: "task",
					sourceId: legacyTask.id,
					runtimeKind: "legacy",
				},
				tx,
			);
			const agent = await createSession(
				{
					task: agentTask,
					sourceKind: "task",
					sourceId: agentTask.id,
					runtimeKind: "agent",
				},
				tx,
			);
			return { legacyTask, agentTask, legacy, agent };
		});
		expect(await claimAgentPlay(result.legacyTask.id, 0)).toBeNull();
		const claimed = await claimAgentPlay(result.agentTask.id, 0);
		expect(claimed).toMatchObject({
			id: result.agent.id,
			runtimeKind: "agent",
			runtimeState: "idle",
		});
		expect(await getSessionByTaskId(result.legacyTask.id)).toMatchObject({
			id: result.legacy.id,
			runtimeKind: "legacy",
			desiredState: "stopped",
		});
	});

	it("uses agent as the default only for newly created sessions", async () => {
		const repositoryId = crypto.randomUUID();
		repositoryIds.push(repositoryId);
		await db.insert(repositories).values({
			id: repositoryId,
			name: "new session default",
			localPath: "/tmp/new-session-default",
			branch: "main",
		});
		const task = await createTaskWithMissionPilot({
			repositoryId,
			title: "new agent task",
			objective: "新規sessionだけagentにする",
		});
		expect(task.missionPilot).toMatchObject({
			runtimeKind: "agent",
			runtimeState: "stopped",
		});
	});
});
