import { describe, expect, it } from "vitest";
import { missionPilotActionToolDefinitions } from "../api/modules/missionPilot/agent/mission-pilot-task-action.registry";

describe("Mission Pilot Plan ownership contract", () => {
	it("publishes Questionnaire, routing, and typed Artifact actions", () => {
		const names = missionPilotActionToolDefinitions().map((tool) => tool.name);
		expect(names).toEqual(
			expect.arrayContaining([
				"questionnaire_create",
				"questionnaire_follow_up_generate",
				"questionnaire_review_generate",
				"questionnaire_review_accept",
				"plan_routing_update",
				"plan_artifact_feature_plan_generate",
				"plan_artifact_blueprint_generate",
				"plan_artifact_data_model_generate",
				"plan_artifact_view_generate",
				"plan_artifact_regenerate",
			]),
		);
	});

	it("keeps final Questionnaire submission as a user operation", () => {
		const names = missionPilotActionToolDefinitions().map((tool) => tool.name);
		expect(names).not.toContain("questionnaire_submit");
	});
});
