import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	bootstrapComposedMissionPilotStorage,
	createComposedMissionPilotRouter,
	createMissionPilotDependencies,
	getMissionPilotAvailability,
} from "../api/composition/mission-pilot";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { client, db } from "../api/db/client";
import { repositories } from "../api/db/schema";
import { createTask } from "../api/modules/nightworkers/nightworkers.basic.service";

const repositoryIds: string[] = [];
const logger = { info() {}, error() {} };

beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const repositoryId of repositoryIds.splice(0))
		await db.delete(repositories).where(eq(repositories.id, repositoryId));
	await bootstrapComposedMissionPilotStorage({ logger });
});

describe("Mission Pilot package failure isolation", () => {
	it("keeps core Task writes available and returns a typed 503 only from Mission Pilot routes", async () => {
		const failure = new Error("isolated package storage failure");
		const execute = vi.spyOn(client, "execute").mockRejectedValueOnce(failure);
		const bootstrap = await bootstrapComposedMissionPilotStorage({ logger });
		execute.mockRestore();
		expect(bootstrap).toMatchObject({
			status: "unavailable",
			stage: "storage",
			errorCode: "MISSION_PILOT_STORAGE_UNAVAILABLE",
			error: failure,
		});
		expect(getMissionPilotAvailability()).toMatchObject({
			status: "unavailable",
			stage: "storage",
		});

		const repositoryId = crypto.randomUUID();
		repositoryIds.push(repositoryId);
		await db.insert(repositories).values({
			id: repositoryId,
			name: "Mission Pilot failure isolation",
			localPath: "/tmp/mission-pilot-failure-isolation",
			branch: "main",
		});
		const task = await createTask({
			repositoryId,
			title: "Core remains available",
			objective: "Create a neutral Task while Mission Pilot is unavailable.",
		});
		expect(task.id).toBeTruthy();

		const router = createComposedMissionPilotRouter(
			createMissionPilotDependencies(),
		);
		const response = await router.request(`/mission-pilot/tasks/${task.id}`);
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({
			code: "MISSION_PILOT_UNAVAILABLE",
			details: {
				stage: "storage",
				reasonCode: "MISSION_PILOT_STORAGE_UNAVAILABLE",
			},
		});
	});
});
