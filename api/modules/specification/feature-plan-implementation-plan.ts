import { createHash } from "node:crypto";
import {
	FEATURE_PLAN_ACCEPTANCE_CRITERIA_PLACEHOLDER,
	FEATURE_PLAN_IMPLEMENTATION_PLACEHOLDER,
	type FeaturePlanImplementationPlan,
	type FeaturePlanImplementationPlanMetadata,
	featurePlanImplementationPlanMetadataSchema,
	featurePlanImplementationPlanSchema,
} from "../../../shared/schemas/feature-plan-implementation-plan.schema";
import type { SpecificationAcceptanceCriterion } from "../../../shared/schemas/verification-checklist.schema";
import type { ImplementationTodoInput } from "../../services/todo-runtime";

export function digestFeaturePlanImplementationPlan(
	plan: FeaturePlanImplementationPlan,
) {
	const canonical = {
		version: plan.version,
		requiresDataMigration: plan.requiresDataMigration,
		steps: plan.steps.map((step) => ({
			key: step.key,
			title: step.title,
			description: step.description,
			taskType: step.taskType,
			dependsOnKeys: step.dependsOnKeys,
		})),
	};
	return `sha256:${createHash("sha256")
		.update(JSON.stringify(canonical), "utf8")
		.digest("hex")}`;
}

export function buildFeaturePlanImplementationPlanMetadata(
	value: unknown,
): FeaturePlanImplementationPlanMetadata {
	const plan = featurePlanImplementationPlanSchema.parse(value);
	return {
		...plan,
		digest: digestFeaturePlanImplementationPlan(plan),
	};
}

export function readFeaturePlanImplementationPlanMetadata(
	value: unknown,
): FeaturePlanImplementationPlanMetadata | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const parsed = featurePlanImplementationPlanMetadataSchema.safeParse(
		record.implementationPlan,
	);
	if (!parsed.success) return null;
	if (digestFeaturePlanImplementationPlan(parsed.data) !== parsed.data.digest)
		return null;
	return parsed.data;
}

export function renderFeaturePlanImplementationSection(
	plan: FeaturePlanImplementationPlan,
) {
	return [
		"## 実装計画",
		"",
		`- マイグレーション: ${plan.requiresDataMigration ? "必要" : "不要"}`,
		"",
		...plan.steps.flatMap((step, index) => [
			`${index + 1}. **${step.title}**`,
			`   ${step.description}`,
			...(step.dependsOnKeys.length > 0
				? [`   依存: ${step.dependsOnKeys.join(", ")}`]
				: []),
		]),
	].join("\n");
}

export function hasFeaturePlanImplementationHeading(contentTemplate: string) {
	return contentTemplate
		.split(/\r?\n/)
		.some((line) => /^##[ \t]+実装計画(?:[ \t]+#+)?[ \t]*$/.test(line.trim()));
}

export function renderFeaturePlanContent(input: {
	contentTemplate: string;
	implementationPlan: FeaturePlanImplementationPlan;
	acceptanceCriteria?: SpecificationAcceptanceCriterion[];
}) {
	if (hasFeaturePlanImplementationHeading(input.contentTemplate)) {
		throw new Error(
			"Feature Plan contentTemplate must not contain the implementation plan heading because the rendered implementation section owns it.",
		);
	}
	const placeholderCount =
		input.contentTemplate.split(FEATURE_PLAN_IMPLEMENTATION_PLACEHOLDER)
			.length - 1;
	if (placeholderCount !== 1) {
		throw new Error(
			`Feature Plan contentTemplate must contain ${FEATURE_PLAN_IMPLEMENTATION_PLACEHOLDER} exactly once.`,
		);
	}
	const content = input.contentTemplate.replace(
		FEATURE_PLAN_IMPLEMENTATION_PLACEHOLDER,
		renderFeaturePlanImplementationSection(input.implementationPlan),
	);
	if (!input.acceptanceCriteria) return content;
	const acceptanceCriteriaPlaceholderCount =
		content.split(FEATURE_PLAN_ACCEPTANCE_CRITERIA_PLACEHOLDER).length - 1;
	if (acceptanceCriteriaPlaceholderCount !== 1) {
		throw new Error(
			`Feature Plan contentTemplate must contain ${FEATURE_PLAN_ACCEPTANCE_CRITERIA_PLACEHOLDER} exactly once.`,
		);
	}
	return content.replace(
		FEATURE_PLAN_ACCEPTANCE_CRITERIA_PLACEHOLDER,
		renderFeaturePlanAcceptanceCriteria(input.acceptanceCriteria),
	);
}

export function renderFeaturePlanAcceptanceCriteria(
	criteria: SpecificationAcceptanceCriterion[],
) {
	return criteria
		.map(
			(criterion, index) =>
				`- [AC-${String(index + 1).padStart(3, "0")}] ${criterion.title}`,
		)
		.join("\n");
}

export function projectFeaturePlanImplementationTodos(
	plan: FeaturePlanImplementationPlan,
): ImplementationTodoInput[] {
	const seqByKey = new Map(
		plan.steps.map((step, index) => [step.key, index + 1]),
	);
	return plan.steps.map((step, index) => ({
		seq: index + 1,
		title: step.title,
		description: step.description,
		taskType: step.taskType,
		dependsOn: step.dependsOnKeys.map((key) => seqByKey.get(key) as number),
	}));
}
