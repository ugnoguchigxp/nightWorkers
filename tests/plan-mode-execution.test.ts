import { describe, expect, it } from "vitest";
import { DEFAULT_GENERAL_SETTINGS } from "../api/services/settings/general-settings";
import { buildPlanModeExecutionSteps } from "../shared/plan-mode-execution";

describe("buildPlanModeExecutionSteps", () => {
	it("keeps Status order and skips omitted or disabled views", () => {
		const capabilities = {
			...DEFAULT_GENERAL_SETTINGS.planMode.capabilities,
			data_model: false,
		};
		const steps = buildPlanModeExecutionSteps({
			capabilities,
			viewDecisions: [
				{ view: "blueprint", decision: "omit", reason: "No UI" },
				{ view: "data_model", decision: "include", reason: "DB change" },
				{
					view: "api_io_contract",
					decision: "include",
					reason: "API boundary",
				},
				{
					view: "api_io_contract",
					decision: "include",
					reason: "Duplicate routing evidence",
				},
			],
			questionnaireExists: true,
			questionnaireComplete: true,
			existingArtifactKinds: [],
		});

		expect(steps.map((step) => step.key)).toEqual([
			"questionnaire",
			"data_model",
			"view:api_io_contract",
			"feature_plan",
		]);
		expect(steps.find((step) => step.key === "data_model")?.status).toBe(
			"skipped",
		);
		expect(steps.at(-1)).toMatchObject({
			key: "feature_plan",
			status: "pending",
		});
	});

	it("marks existing artifacts completed without inventing unrouted views", () => {
		const steps = buildPlanModeExecutionSteps({
			capabilities: DEFAULT_GENERAL_SETTINGS.planMode.capabilities,
			viewDecisions: [],
			questionnaireExists: true,
			questionnaireComplete: true,
			existingArtifactKinds: ["feature_plan"],
		});

		expect(steps.map((step) => step.key)).toEqual([
			"questionnaire",
			"feature_plan",
		]);
		expect(steps.every((step) => step.status === "completed")).toBe(true);
	});
});
