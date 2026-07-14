import { describe, expect, it } from "vitest";
import {
	buildFeaturePlanImplementationPlanMetadata,
	projectFeaturePlanImplementationTodos,
	renderFeaturePlanContent,
} from "../api/modules/specification/feature-plan-implementation-plan";
import { featurePlanImplementationPlanSchema } from "../shared/schemas/feature-plan-implementation-plan.schema";

const validPlan = {
	version: 1 as const,
	requiresDataMigration: true,
	steps: [
		{
			key: "db",
			title: "Todo schemaを実装する",
			description: "Todoを所有者単位で保存するschemaを追加する。",
			taskType: "implementation" as const,
			dependsOnKeys: [],
		},
		{
			key: "api",
			title: "Todo APIを実装する",
			description: "認証済み所有者のCRUD APIを追加する。",
			taskType: "implementation" as const,
			dependsOnKeys: ["db"],
		},
	],
};

describe("Feature Plan implementation plan", () => {
	it("renders the Markdown implementation section and Todo projection from one plan", () => {
		const plan = featurePlanImplementationPlanSchema.parse(validPlan);
		const content = renderFeaturePlanContent({
			contentTemplate:
				"## 目的\nTodoを実装する。\n\n{{IMPLEMENTATION_PLAN}}\n\n## 検証計画\n- verify",
			implementationPlan: plan,
		});
		const todos = projectFeaturePlanImplementationTodos(plan);

		expect(content).toContain("## 実装計画");
		expect(content).toContain("1. **Todo schemaを実装する**");
		expect(content).toContain("2. **Todo APIを実装する**");
		expect(content).not.toContain("{{IMPLEMENTATION_PLAN}}");
		expect(todos).toEqual([
			expect.objectContaining({
				seq: 1,
				title: "Todo schemaを実装する",
				dependsOn: [],
			}),
			expect.objectContaining({
				seq: 2,
				title: "Todo APIを実装する",
				dependsOn: [1],
			}),
		]);
	});

	it("rejects duplicate keys, unknown dependencies, cycles, and fixed gates", () => {
		const duplicate = structuredClone(validPlan);
		duplicate.steps[1].key = "db";
		expect(() => featurePlanImplementationPlanSchema.parse(duplicate)).toThrow(
			/Duplicate implementation step key/,
		);

		const unknown = structuredClone(validPlan);
		unknown.steps[1].dependsOnKeys = ["missing"];
		expect(() => featurePlanImplementationPlanSchema.parse(unknown)).toThrow(
			/Unknown implementation step dependency/,
		);

		const cycle = structuredClone(validPlan);
		cycle.steps[0].dependsOnKeys = ["api"];
		expect(() => featurePlanImplementationPlanSchema.parse(cycle)).toThrow(
			/must not contain a cycle/,
		);

		const fixedGate = structuredClone(validPlan);
		fixedGate.steps[0].title = "完了報告を行う";
		expect(() => featurePlanImplementationPlanSchema.parse(fixedGate)).toThrow(
			/Fixed Todo gates/,
		);
	});

	it("rejects a dependency on a later implementation step", () => {
		const forwardDependency = structuredClone(validPlan);
		forwardDependency.steps[0].dependsOnKeys = ["api"];
		forwardDependency.steps[1].dependsOnKeys = [];
		expect(() =>
			featurePlanImplementationPlanSchema.parse(forwardDependency),
		).toThrow(/must reference an earlier step/);
	});

	it("requires the implementation placeholder exactly once", () => {
		const plan = featurePlanImplementationPlanSchema.parse(validPlan);
		expect(() =>
			renderFeaturePlanContent({
				contentTemplate: "## 目的\nplaceholderなし",
				implementationPlan: plan,
			}),
		).toThrow(/exactly once/);
		expect(() =>
			renderFeaturePlanContent({
				contentTemplate: "{{IMPLEMENTATION_PLAN}}\n{{IMPLEMENTATION_PLAN}}",
				implementationPlan: plan,
			}),
		).toThrow(/exactly once/);
	});

	it("produces a stable backend digest", () => {
		const first = buildFeaturePlanImplementationPlanMetadata(validPlan);
		const second = buildFeaturePlanImplementationPlanMetadata(
			structuredClone(validPlan),
		);
		expect(first.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(second.digest).toBe(first.digest);
	});
});
