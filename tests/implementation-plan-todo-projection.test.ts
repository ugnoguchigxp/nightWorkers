import { describe, expect, it } from "vitest";
import { resolveImplementationPlanTodoProjection } from "../api/modules/nightworkers/run-orchestration/implementation-plan-todo-projection";
import { buildFeaturePlanImplementationPlanMetadata } from "../api/modules/specification/feature-plan-implementation-plan";
import { buildStandardImplementationTodoList } from "../api/services/todo-runtime";

describe("implementation mode Feature Plan TODO projection", () => {
	it("projects the reviewed plan in the implementation-mode boundary", () => {
		const implementationPlan = buildFeaturePlanImplementationPlanMetadata({
			version: 1,
			requiresDataMigration: true,
			steps: [
				{
					key: "db",
					title: "DB schemaを実装する",
					description: "設計書のDB手順を実行する。",
					taskType: "implementation",
					dependsOnKeys: [],
				},
				{
					key: "api",
					title: "APIを実装する",
					description: "設計書のAPI手順を実行する。",
					taskType: "implementation",
					dependsOnKeys: ["db"],
				},
			],
		});

		const projection = resolveImplementationPlanTodoProjection({
			id: "feature-plan-message",
			metadataJson: { intent: "feature_plan", implementationPlan },
		});

		expect(projection).toMatchObject({
			initialTodos: [
				{ seq: 1, title: "DB schemaを実装する", dependsOn: [] },
				{ seq: 2, title: "APIを実装する", dependsOn: [1] },
			],
			requireDataMigrationGates: true,
			implementationPlanProvenance: {
				sourceMessageId: "feature-plan-message",
				digest: implementationPlan.digest,
			},
		});
		if (!projection) throw new Error("Expected implementation plan projection");
		const todos = buildStandardImplementationTodoList({
			todos: projection.initialTodos,
			requireDataMigrationGates: projection.requireDataMigrationGates,
		});
		expect(
			todos.filter(
				(todo) => todo.procedureId === "data_migration.apply_migration",
			),
		).toHaveLength(1);
		expect(
			todos.filter((todo) => todo.procedureId === "quality_gate_verify"),
		).toHaveLength(1);
	});

	it("fails closed for an invalid Feature Plan instead of using generic TODOs", () => {
		expect(() =>
			resolveImplementationPlanTodoProjection({
				id: "feature-plan-message",
				metadataJson: { intent: "feature_plan" },
			}),
		).toThrow(
			"Feature Plan implementation plan metadata is missing or invalid.",
		);
	});

	it("rejects a reviewed source digest mismatch", () => {
		const implementationPlan = buildFeaturePlanImplementationPlanMetadata({
			version: 1,
			requiresDataMigration: false,
			steps: [
				{
					key: "implementation",
					title: "機能を実装する",
					description: "Review済みの手順を実装する。",
					taskType: "implementation",
					dependsOnKeys: [],
				},
			],
		});

		expect(() =>
			resolveImplementationPlanTodoProjection(
				{
					id: "reviewed-feature-plan",
					metadataJson: { intent: "feature_plan", implementationPlan },
				},
				{
					sourceMessageId: "reviewed-feature-plan",
					digest: `sha256:${"0".repeat(64)}`,
				},
			),
		).toThrow(
			"Implementation Plan digest does not match the reviewed Feature Plan.",
		);
	});

	it("rejects a missing reviewed source instead of selecting a newer plan", () => {
		expect(() =>
			resolveImplementationPlanTodoProjection(undefined, {
				sourceMessageId: "reviewed-feature-plan",
				digest: `sha256:${"0".repeat(64)}`,
			}),
		).toThrow("Reviewed Feature Plan message is missing.");
	});

	it("does not project review correction TODOs as the design plan", () => {
		expect(
			resolveImplementationPlanTodoProjection({
				id: "review-message",
				metadataJson: { intent: "review" },
			}),
		).toBeNull();
	});
});
