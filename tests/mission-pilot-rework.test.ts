import { describe, expect, it } from "vitest";
import {
	buildMissionPilotReworkTodos,
	parseMissionPilotReworkPacket,
} from "../api/modules/missionPilot/mission-pilot-rework";
import { readMissionPilotRunAssociationPayload } from "../api/modules/missionPilot/mission-pilot-run-association.service";

describe("Mission Pilot rework handoff", () => {
	it("preserves a structured rework packet in the runtime envelope", () => {
		const packet = {
			summary: "migration defaults are missing",
			findings: [],
			affectedPaths: ["api/db/migration.ts"],
		};

		expect(
			readMissionPilotRunAssociationPayload({
				phase: "implementation",
				missionPilot: {
					sessionId: "session-1",
					cycle: 2,
					contextRevision: 9,
					contextDigest: "ctx-9",
					reworkPacket: packet,
				},
			}),
		).toMatchObject({
			phase: "implementation",
			missionPilot: { sessionId: "session-1", reworkPacket: packet },
		});
		expect(
			readMissionPilotRunAssociationPayload({
				phase: "implementation",
				missionPilot: {
					sessionId: "session-1",
					cycle: 2,
					contextRevision: 9,
					contextDigest: "ctx-9",
					reworkPacket: {
						reason: "commit_hook_mutation",
						mutationPaths: ["src/app.ts"],
					},
				},
			})?.missionPilot.reworkPacket,
		).toMatchObject({ reason: "commit_hook_mutation" });
	});

	it("creates one correction Todo per finding and a focused verification Todo", () => {
		const todos = buildMissionPilotReworkTodos({
			summary: "two blocking findings",
			findings: [
				{
					severity: "blocking",
					category: "data_migration",
					file: "api/db/migration.ts",
					line: 12,
					evidence: "default is missing",
					recommendedAction: "add CURRENT_TIMESTAMP",
					blockingReason: "created_at can be null",
				},
				{
					severity: "blocking",
					category: "test",
					file: "tests/migration.test.ts",
					line: 20,
					evidence: "SQLite behavior is not covered",
					recommendedAction: "add a real SQLite test",
					blockingReason: "migration behavior is unverified",
				},
			],
		});

		expect(todos.map((todo) => todo.procedureId)).toEqual([
			"mission_pilot.rework_finding",
			"mission_pilot.rework_finding",
			"mission_pilot.rework_verify",
		]);
		expect(todos[0]?.description).toContain("CURRENT_TIMESTAMP");
	});

	it("rejects an empty packet instead of falling back to broad implementation", () => {
		expect(parseMissionPilotReworkPacket({})).toBeNull();
		expect(buildMissionPilotReworkTodos({})).toEqual([]);
		expect(
			readMissionPilotRunAssociationPayload({
				phase: "implementation",
				missionPilot: {
					sessionId: "session-1",
					cycle: 2,
					contextRevision: 9,
					contextDigest: "ctx-9",
					reworkPacket: {},
				},
			}),
		).toBeNull();
	});
});
