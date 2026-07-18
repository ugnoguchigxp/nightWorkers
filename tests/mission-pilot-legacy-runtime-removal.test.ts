import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const productionEntrypoints = [
	"api/app.ts",
	"api/server.ts",
	"api/workers/queue-worker.ts",
	"api/workers/task-run-worker.ts",
	"api/modules/missionPilot/index.ts",
	"api/modules/missionPilot/mission-pilot.service.ts",
	"api/modules/missionPilot/mission-pilot-execution-query.service.ts",
];
const retiredRuntimeNames = [
	"mission-pilot-plan-coordinator",
	"mission-pilot-pre-queue-recovery",
	"mission-pilot-queue-handoff",
	"mission-pilot-post-queue-coordinator",
	"mission-pilot-runtime-continuation",
	"mission-pilot-recovery.service",
];

describe("Mission Pilot legacy runtime removal", () => {
	it("keeps retired coordinators out of every production activation entrypoint", () => {
		for (const relativePath of productionEntrypoints) {
			const source = fs.readFileSync(path.join(root, relativePath), "utf8");
			for (const retiredName of retiredRuntimeNames)
				expect(
					source,
					`${relativePath} must not activate ${retiredName}`,
				).not.toContain(retiredName);
		}
	});

	it("has no legacy ownership result in the canonical ownership resolver", () => {
		const source = fs.readFileSync(
			path.join(
				root,
				"api/modules/missionPilot/agent/mission-pilot-runtime-ownership.service.ts",
			),
			"utf8",
		);
		expect(source).not.toContain('kind: "legacy"');
		expect(source).not.toContain("isLegacyMissionPilotRuntime");
	});
});
