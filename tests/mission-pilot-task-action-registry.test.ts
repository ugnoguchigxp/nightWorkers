import { describe, expect, it } from "vitest";
import {
	getMissionPilotActionByToolName,
	getMissionPilotActionDefinition,
	MISSION_PILOT_ACTION_DEFINITIONS,
	validateMissionPilotActionArguments,
} from "../api/modules/missionPilot/agent/mission-pilot-task-action.registry";

const expectedActionIds = [
	"task.update",
	"task.message.send",
	"task.delete",
	"task.archive",
	"task.archive.restore",
	"questionnaire.create",
	"questionnaire.draft.update",
	"questionnaire.submit",
	"questionnaire.follow_up.generate",
	"questionnaire.additional.generate",
	"questionnaire.review.generate",
	"questionnaire.review.accept",
	"questionnaire.review.leave_unadopted",
	"plan.routing.update",
	"plan.artifact.generate",
	"plan.artifact.regenerate",
	"task.queue.enqueue",
	"task.queue.update",
	"task.queue.cancel",
	"task.queue.requeue",
	"task.queue.recover",
	"task.queue.archive",
	"run.implementation.start",
	"run.test.start",
	"run.stop",
	"background_process.stop",
	"review.session.start",
	"review.run.start",
	"run.review.submit",
	"git.commit",
	"git.push",
	"git.merge.preview",
	"git.merge.defer",
	"git.merge.rework",
	"git.merge.target.update",
	"git.merge.execute",
];

describe("Mission Pilot Task Action Registry", () => {
	it("contains the complete UI-equivalent catalog with one source of truth", () => {
		expect(
			MISSION_PILOT_ACTION_DEFINITIONS.map((entry) => entry.actionId).sort(),
		).toEqual([...expectedActionIds].sort());
		expect(
			new Set(MISSION_PILOT_ACTION_DEFINITIONS.map((entry) => entry.toolName))
				.size,
		).toBe(MISSION_PILOT_ACTION_DEFINITIONS.length);
		for (const entry of MISSION_PILOT_ACTION_DEFINITIONS) {
			expect(entry.description).not.toBe("");
			expect(getMissionPilotActionByToolName(entry.toolName)?.actionId).toBe(
				entry.actionId,
			);
		}
	});

	it("does not encode phase or Todo based tool allowlists", () => {
		const source = JSON.stringify(MISSION_PILOT_ACTION_DEFINITIONS);
		expect(source).not.toContain("todoTitle");
		expect(source).not.toContain("currentPhase");
	});

	it("validates arguments with the same JSON schema exposed to the provider", () => {
		const definition = getMissionPilotActionDefinition("run.stop");
		if (!definition) throw new Error("run.stop definition is missing");
		expect(
			validateMissionPilotActionArguments(definition, { runId: "not-a-uuid" }),
		).toMatchObject({ success: false });
		expect(
			validateMissionPilotActionArguments(definition, {
				runId: "00000000-0000-4000-8000-000000000001",
				extra: true,
			}),
		).toMatchObject({ success: false });
		expect(
			validateMissionPilotActionArguments(definition, {
				runId: "00000000-0000-4000-8000-000000000001",
			}),
		).toEqual({
			success: true,
			data: { runId: "00000000-0000-4000-8000-000000000001" },
		});
	});
});
