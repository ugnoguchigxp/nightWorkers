import { beforeAll, describe, expect, it } from "vitest";
import { createMissionPilotRuntimeBindings } from "../api/composition/mission-pilot/mission-pilot-runtime-bindings";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";

beforeAll(() => ensureNightWorkersSchema());

describe("Mission Pilot package-only persistence capability", () => {
	it("accepts a named semantic read through the injected package binding", async () => {
		const bindings = createMissionPilotRuntimeBindings();
		await expect(
			bindings.executeMissionPilotPersistence?.({
				operation: "getSessionByTaskId",
				args: ["00000000-0000-0000-0000-000000000000"],
			}),
		).resolves.toBeNull();
	});

	it("rejects arbitrary SQL and unknown operations", async () => {
		const bindings = createMissionPilotRuntimeBindings();
		await expect(
			bindings.executeMissionPilotPersistence?.({
				operation: "rawSql",
				args: ["DELETE FROM tasks"],
			}),
		).rejects.toThrow("Invalid Mission Pilot persistence operation.");
	});
});
