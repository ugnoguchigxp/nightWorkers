import { describe, expect, it } from "vitest";
import {
	digestImplementationPlan,
	readFeaturePlanImplementationPlan,
	readFeaturePlanMaterializationIntent,
} from "../api/modules/agentsShare";
import {
	createFeaturePlanMarkdownDraftSchema,
	featurePlanMarkdownDraftSchema,
} from "../api/modules/specification/feature-plan-content";

describe("Feature Plan repository materialization intent", () => {
	const implementationPlan = {
		steps: [{ title: "実装する", systemContext: "対象機能を実装する。" }],
	};
	const acceptanceCriteria = [
		{ title: "対象機能を利用できる", category: "workflow" as const },
	];
	const markdown =
		"# Feature Plan\n\n## 完了条件\n\n- [AC-001][workflow] 対象機能を利用できる";

	it("does not invent a starter when the structured selection is absent", () => {
		expect(
			featurePlanMarkdownDraftSchema.parse({
				markdown,
				acceptanceCriteria,
				implementationPlan,
			}),
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
		expect(() =>
			schema.parse({
				markdown,
				acceptanceCriteria,
				implementationPlan,
			}),
		).toThrow();
		expect(() =>
			schema.parse({
				markdown,
				acceptanceCriteria,
				implementationPlan,
				repositoryMaterializationIntent: { kind: "existing_git" },
			}),
		).toThrow();
		expect(
			schema.parse({
				markdown,
				acceptanceCriteria,
				implementationPlan,
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

	it("accepts only a plan whose stored provenance digest matches", () => {
		const metadata = {
			implementationPlan,
			implementationPlanProvenance: {
				version: 1,
				digest: digestImplementationPlan(implementationPlan),
			},
		};
		expect(readFeaturePlanImplementationPlan(metadata)).toEqual(
			implementationPlan,
		);
		expect(
			readFeaturePlanImplementationPlan({
				...metadata,
				implementationPlan: {
					steps: [{ title: "改ざん", systemContext: "別の工程。" }],
				},
			}),
		).toBeNull();
		expect(
			readFeaturePlanImplementationPlan({ implementationPlan }),
		).toBeNull();
	});
});
