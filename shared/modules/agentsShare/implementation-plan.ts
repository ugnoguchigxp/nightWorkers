import { z } from "zod";

export const IMPLEMENTATION_PLAN_LIMITS = {
	maxSteps: 12,
	maxTitleLength: 80,
	maxSystemContextLength: 600,
} as const;

export const IMPLEMENTATION_PLAN_SINGLE_LINE_PATTERN_SOURCE = "^[^\\r\\n]+$";
const implementationPlanSingleLinePattern = new RegExp(
	IMPLEMENTATION_PLAN_SINGLE_LINE_PATTERN_SOURCE,
);

export const implementationPlanStepSchema = z
	.object({
		title: z
			.string()
			.trim()
			.min(1)
			.max(IMPLEMENTATION_PLAN_LIMITS.maxTitleLength)
			.regex(implementationPlanSingleLinePattern)
			.describe("UIへ表示する短い工程名。"),
		systemContext: z
			.string()
			.trim()
			.min(1)
			.max(IMPLEMENTATION_PLAN_LIMITS.maxSystemContextLength)
			.regex(implementationPlanSingleLinePattern)
			.describe("この工程で最優先する1〜3文の局所指示。"),
	})
	.strict();

export const implementationPlanSchema = z
	.object({
		steps: z
			.array(implementationPlanStepSchema)
			.min(1)
			.max(IMPLEMENTATION_PLAN_LIMITS.maxSteps),
	})
	.strict();

export type ImplementationPlanStep = z.infer<
	typeof implementationPlanStepSchema
>;
export type ImplementationPlan = z.infer<typeof implementationPlanSchema>;
