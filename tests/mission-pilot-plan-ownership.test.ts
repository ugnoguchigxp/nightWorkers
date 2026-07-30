import { describe, expect, it } from "vitest";
import { getMissionPilotActionUnavailableReason } from "../api/modules/missionPilot/agent/mission-pilot-task-action.registry";
import { TASK_OPERATOR_ACTION_DEFINITIONS } from "../api/modules/taskOperator";

describe("Mission Pilot Plan ownership contract", () => {
	it("uses the canonical Task Operator contract for Questionnaire, routing, and typed Artifact actions", () => {
		const ids = TASK_OPERATOR_ACTION_DEFINITIONS.map(
			(definition) => definition.actionId,
		);
		expect(ids).toEqual(
			expect.arrayContaining([
				"questionnaire.create",
				"questionnaire.submit",
				"questionnaire.follow_up.generate",
				"questionnaire.review.generate",
				"questionnaire.review.accept",
				"plan.routing.update",
				"plan.artifact.feature_plan.generate",
				"plan.artifact.blueprint.generate",
				"plan.artifact.data_model.generate",
				"plan.artifact.view.generate",
			]),
		);
		expect(ids).not.toContain("questionnaire.draft.save");
		expect(ids).not.toContain("plan.artifact.regenerate");
	});

	it("allows Mission Pilot to submit Questionnaire answers as the user", () => {
		expect(
			getMissionPilotActionUnavailableReason("questionnaire.submit"),
		).toBeNull();
	});
});
