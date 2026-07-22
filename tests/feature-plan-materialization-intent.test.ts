import { describe, expect, it } from "vitest";
import { readFeaturePlanMaterializationIntent } from "../api/modules/agentsShare";
import {
	createFeaturePlanMarkdownDraftSchema,
	featurePlanMarkdownDraftSchema,
} from "../api/modules/specification/feature-plan-content";

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
		expect(
			readFeaturePlanMaterializationIntent({
				repositoryMaterializationIntent: {
					kind: "starter_template",
					source: "starter",
					stack: "hono",
					variant: "hono-react-vite-sqlite",
					initialize: true,
				},
			}),
		).toBeNull();
		expect(
			readFeaturePlanMaterializationIntent({
				repositoryMaterializationIntent: {
					kind: "starter_template",
					source: "starter",
					stack: "hono",
					variant: "java25-sqlite",
					initialize: true,
				},
			}),
		).toBeNull();
	});

	it("requires a non-existing-git materialization intent for a Project without Git HEAD", () => {
		const schema = createFeaturePlanMarkdownDraftSchema({
			requiresRepositoryMaterialization: true,
		});
		expect(() => schema.parse({ markdown: "# Feature Plan" })).toThrow();
		expect(() =>
			schema.parse({
				markdown: "# Feature Plan",
				repositoryMaterializationIntent: { kind: "existing_git" },
			}),
		).toThrow();
		expect(
			schema.parse({
				markdown: "# Feature Plan",
				repositoryMaterializationIntent: {
					kind: "starter_template",
					source: "starter",
					stack: "hono",
					initialize: true,
				},
			}),
		).toMatchObject({
			repositoryMaterializationIntent: { stack: "hono" },
		});
	});
});
