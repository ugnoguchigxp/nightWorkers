import { z } from "zod";

export const FEATURE_PLAN_IMPLEMENTATION_PLACEHOLDER =
	"{{IMPLEMENTATION_PLAN}}";
export const FEATURE_PLAN_ACCEPTANCE_CRITERIA_PLACEHOLDER =
	"{{ACCEPTANCE_CRITERIA}}";

const RESERVED_TODO_TITLES = new Set([
	"コーディング準備を行う",
	"DB migration を実行する",
	"品質ゲート verify コマンドを通す",
	"完了報告を行う",
]);

export const featurePlanImplementationTodoStepSchema = z.object({
	key: z.string().trim().min(1).max(120),
	title: z.string().trim().min(1).max(200),
	description: z.string().trim().min(1).max(4_000),
	taskType: z.enum(["scaffold", "implementation"]),
	dependsOnKeys: z.array(z.string().trim().min(1).max(120)).default([]),
});

export const featurePlanImplementationPlanSchema = z
	.object({
		version: z.literal(1),
		requiresDataMigration: z.boolean(),
		steps: z.array(featurePlanImplementationTodoStepSchema).min(1).max(20),
	})
	.superRefine((plan, context) => {
		const keys = new Set<string>();
		for (const [index, step] of plan.steps.entries()) {
			if (keys.has(step.key)) {
				context.addIssue({
					code: "custom",
					path: ["steps", index, "key"],
					message: `Duplicate implementation step key: ${step.key}`,
				});
			}
			keys.add(step.key);
			if (RESERVED_TODO_TITLES.has(step.title)) {
				context.addIssue({
					code: "custom",
					path: ["steps", index, "title"],
					message:
						"Fixed Todo gates cannot be returned as implementation steps.",
				});
			}
		}

		const stepIndexByKey = new Map(
			plan.steps.map((step, index) => [step.key, index]),
		);
		const graph = new Map(
			plan.steps.map((step) => [step.key, step.dependsOnKeys]),
		);
		for (const [index, step] of plan.steps.entries()) {
			for (const dependency of step.dependsOnKeys) {
				if (!keys.has(dependency)) {
					context.addIssue({
						code: "custom",
						path: ["steps", index, "dependsOnKeys"],
						message: `Unknown implementation step dependency: ${dependency}`,
					});
				} else if ((stepIndexByKey.get(dependency) ?? index) >= index) {
					context.addIssue({
						code: "custom",
						path: ["steps", index, "dependsOnKeys"],
						message: `Implementation step dependency must reference an earlier step: ${dependency}`,
					});
				}
			}
		}

		const visiting = new Set<string>();
		const visited = new Set<string>();
		const hasCycle = (key: string): boolean => {
			if (visiting.has(key)) return true;
			if (visited.has(key)) return false;
			visiting.add(key);
			for (const dependency of graph.get(key) ?? []) {
				if (graph.has(dependency) && hasCycle(dependency)) return true;
			}
			visiting.delete(key);
			visited.add(key);
			return false;
		};
		if (plan.steps.some((step) => hasCycle(step.key))) {
			context.addIssue({
				code: "custom",
				path: ["steps"],
				message: "Implementation step dependencies must not contain a cycle.",
			});
		}
	});

export const featurePlanImplementationPlanMetadataSchema =
	featurePlanImplementationPlanSchema.and(
		z.object({ digest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }),
	);

export type FeaturePlanImplementationTodoStep = z.infer<
	typeof featurePlanImplementationTodoStepSchema
>;
export type FeaturePlanImplementationPlan = z.infer<
	typeof featurePlanImplementationPlanSchema
>;
export type FeaturePlanImplementationPlanMetadata = z.infer<
	typeof featurePlanImplementationPlanMetadataSchema
>;
