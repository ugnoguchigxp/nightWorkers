import { describe, expect, it } from "vitest";
import { DEFAULT_GENERAL_SETTINGS } from "../api/services/settings/general-settings";
import {
	buildPlanModeBatchGenerationSteps,
	buildPlanModeExecutionSteps,
	executePlanModeBatchGenerationSteps,
	findMissingPlanModeUpstreamViews,
	resolveIncludedPlanModeViews,
} from "../shared/plan-mode-execution";

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

	it("regenerates an existing Feature Plan after any missing upstream Artifact", () => {
		const steps = [
			{
				view: "feature_plan" as const,
				autoGenerate: true,
				done: true,
				disabled: false,
			},
			{
				view: "api_io_contract" as const,
				autoGenerate: true,
				done: false,
				disabled: false,
			},
			{
				view: "data_model" as const,
				autoGenerate: true,
				done: false,
				disabled: false,
			},
		];

		expect(
			buildPlanModeBatchGenerationSteps(steps).map((step) => step.view),
		).toEqual(["data_model", "api_io_contract", "feature_plan"]);
	});

	it("does not regenerate Feature Plan when every upstream Artifact is current", () => {
		const steps = [
			{
				view: "feature_plan" as const,
				autoGenerate: true,
				done: true,
				disabled: false,
			},
			{
				view: "data_model" as const,
				autoGenerate: true,
				done: true,
				disabled: false,
			},
		];

		expect(buildPlanModeBatchGenerationSteps(steps)).toEqual([]);
	});

	it("stops the batch before Feature Plan when an upstream action fails", async () => {
		const calls: string[] = [];
		const completed = await executePlanModeBatchGenerationSteps([
			{
				onClick: async () => {
					calls.push("data_model");
					return true;
				},
			},
			{
				onClick: async () => {
					calls.push("api_io_contract");
					return false;
				},
			},
			{
				onClick: async () => {
					calls.push("feature_plan");
					return true;
				},
			},
		]);

		expect(completed).toBe(false);
		expect(calls).toEqual(["data_model", "api_io_contract"]);
	});

	it("reports routed upstream Artifacts that have not been generated", () => {
		expect(
			findMissingPlanModeUpstreamViews({
				includedViews: ["data_model", "api_io_contract", "feature_plan"],
				existingArtifactKinds: ["data_model"],
			}),
		).toEqual(["api_io_contract"]);
	});

	it("uses routing entries as the canonical included-view source", () => {
		expect(
			resolveIncludedPlanModeViews({
				routingEntries: [
					{
						view: "api_io_contract",
						decision: "include",
						capabilityEnabled: true,
					},
					{
						view: "zod_schema_design",
						decision: "include",
						capabilityEnabled: false,
					},
				],
				viewDecisions: [{ view: "data_model", decision: "include" }],
			}),
		).toEqual(new Set(["api_io_contract"]));
	});
});
