import { describe, expect, it } from "vitest";
import { readFeaturePlanMaterializationIntent } from "../api/modules/missionPilot/mission-pilot-queue-handoff.service";
import { featurePlanMarkdownDraftSchema } from "../api/modules/specification/feature-plan-content";

describe("Feature Plan repository materialization intent", () => {
	it("does not invent a starter when the structured selection is absent", () => {
		expect(
			featurePlanMarkdownDraftSchema.parse({ markdown: "# Feature Plan" }),
		).toMatchObject({ repositoryMaterializationIntent: null });
		expect(
			readFeaturePlanMaterializationIntent({ intent: "feature_plan" }),
		).toBeNull();
	});

	it("accepts every registered starter stack as structured evidence", () => {
		for (const stack of ["hono", "python", "java", "rust"] as const) {
			const intent = {
				kind: "starter_template" as const,
				source: "starter" as const,
				stack,
				initialize: true as const,
			};
			expect(
				readFeaturePlanMaterializationIntent({
					repositoryMaterializationIntent: intent,
				}),
			).toEqual(intent);
		}
	});

	it("rejects unstructured or unsupported starter selections", () => {
		expect(
			readFeaturePlanMaterializationIntent({
				repositoryMaterializationIntent: {
					kind: "starter_template",
					source: "starter",
					stack: "nextjs",
					initialize: true,
				},
			}),
		).toBeNull();
	});
});
