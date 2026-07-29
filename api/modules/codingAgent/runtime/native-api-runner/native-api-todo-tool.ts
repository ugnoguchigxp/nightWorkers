import { IMPLEMENTATION_PLAN_SINGLE_LINE_PATTERN_SOURCE } from "../../../../../shared/modules/agentsShare";
import { TODO_MUTATION_LIMITS } from "../../todo";
import { objectSchema } from "./native-api-tool-schema";

const todoStepSchema = objectSchema(
	{
		title: {
			type: "string",
			minLength: 1,
			maxLength: TODO_MUTATION_LIMITS.maxTitleLength,
			pattern: IMPLEMENTATION_PLAN_SINGLE_LINE_PATTERN_SOURCE,
			description: "UIへ表示する短い工程名。",
		},
		systemContext: {
			type: "string",
			minLength: 1,
			maxLength: TODO_MUTATION_LIMITS.maxTodoSystemContextLength,
			pattern: IMPLEMENTATION_PLAN_SINGLE_LINE_PATTERN_SOURCE,
			description: "この工程で最優先する1〜3文の局所指示。",
		},
	},
	["title", "systemContext"],
);

const stepsSchema = {
	type: "array",
	minItems: 1,
	maxItems: TODO_MUTATION_LIMITS.maxTodos,
	items: todoStepSchema,
};

export const todoCommandJsonSchema = {
	oneOf: [
		objectSchema({ op: { const: "list" } }, ["op"]),
		objectSchema(
			{
				op: { const: "plan" },
				steps: stepsSchema,
			},
			["op", "steps"],
		),
		objectSchema(
			{
				op: { const: "complete_current" },
				note: {
					type: "string",
					minLength: 1,
					maxLength: TODO_MUTATION_LIMITS.maxReasonLength,
				},
			},
			["op"],
		),
		objectSchema(
			{
				op: { const: "block_current" },
				reason: {
					type: "string",
					minLength: 1,
					maxLength: TODO_MUTATION_LIMITS.maxReasonLength,
				},
			},
			["op", "reason"],
		),
		objectSchema(
			{
				op: { const: "replace_remaining" },
				steps: stepsSchema,
			},
			["op", "steps"],
		),
	],
};
