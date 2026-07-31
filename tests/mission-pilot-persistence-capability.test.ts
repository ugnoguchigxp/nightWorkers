import { MISSION_PILOT_PERSISTENCE_OPERATIONS } from "@nightworkers/mission-pilot/contracts";
import { beforeAll, describe, expect, it } from "vitest";
import { createMissionPilotRuntimeBindings } from "../api/composition/mission-pilot/mission-pilot-runtime-bindings";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";

beforeAll(() => ensureNightWorkersSchema());

describe("Mission Pilot package-only persistence capability", () => {
	it("accepts a named semantic read through the injected package binding", async () => {
		const bindings = createMissionPilotRuntimeBindings();
		await expect(
			bindings.executeMissionPilotPersistence({
				operation: "getSessionByTaskId",
				args: ["00000000-0000-0000-0000-000000000000"],
			}),
		).resolves.toBeNull();
	});

	it("owns one frozen semantic operation contract without SQL primitives", () => {
		expect(Object.isFrozen(MISSION_PILOT_PERSISTENCE_OPERATIONS)).toBe(true);
		expect(new Set(MISSION_PILOT_PERSISTENCE_OPERATIONS).size).toBe(
			MISSION_PILOT_PERSISTENCE_OPERATIONS.length,
		);
		expect(MISSION_PILOT_PERSISTENCE_OPERATIONS).not.toContain("rawSql");
		expect(MISSION_PILOT_PERSISTENCE_OPERATIONS).not.toContain("executeSql");
	});

	it("rejects arbitrary SQL, unknown operations, and malformed arguments", async () => {
		const bindings = createMissionPilotRuntimeBindings();
		await expect(
			bindings.executeMissionPilotPersistence({
				operation: "rawSql",
				args: ["DELETE FROM tasks"],
			} as never),
		).rejects.toThrow("Invalid Mission Pilot persistence operation.");
		await expect(
			bindings.executeMissionPilotPersistence({
				operation: "getSessionByTaskId",
				args: "not-an-array",
			} as never),
		).rejects.toThrow("Invalid Mission Pilot persistence operation.");
	});
});
