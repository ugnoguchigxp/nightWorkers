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

const humanBlockerSchema = objectSchema(
	{
		question: {
			type: "string",
			minLength: 1,
			maxLength: TODO_MUTATION_LIMITS.maxReasonLength,
			description: "ユーザーが回答・実施すべき具体的な問い。",
		},
		requiredInput: {
			type: "string",
			enum: [
				"information",
				"decision",
				"credential",
				"permission",
				"external_change",
			],
		},
		basis: {
			oneOf: [
				objectSchema({ kind: { const: "task_context" } }, ["kind"]),
				objectSchema(
					{
						kind: { const: "tool_failure" },
						toolName: { type: "string", minLength: 1, maxLength: 128 },
						failureCode: { type: "string", minLength: 1, maxLength: 128 },
						recoveryDisposition: { const: "human_input" },
					},
					["kind", "toolName", "failureCode", "recoveryDisposition"],
				),
			],
		},
	},
	["question", "requiredInput", "basis"],
);

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
				humanBlocker: humanBlockerSchema,
			},
			["op", "humanBlocker"],
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

// Native model-facing schema for local/OpenAI-compatible routes. Keep a single
// flat object because some compatible parsers cannot compile oneOf branches or
// nested objects into their tool-call grammar. The dispatcher restores and the
// Todo service validates the canonical command contract.
export const todoToolInputJsonSchema = objectSchema(
	{
		op: {
			type: "string",
			enum: [
				"list",
				"plan",
				"complete_current",
				"block_current",
				"replace_remaining",
			],
		},
		title: todoStepSchema.properties.title,
		systemContext: todoStepSchema.properties.systemContext,
		note: {
			type: "string",
			minLength: 1,
			maxLength: TODO_MUTATION_LIMITS.maxReasonLength,
		},
		question: {
			type: "string",
			minLength: 1,
			maxLength: TODO_MUTATION_LIMITS.maxReasonLength,
		},
		requiredInput: {
			type: "string",
			enum: [
				"information",
				"decision",
				"credential",
				"permission",
				"external_change",
			],
		},
		basisKind: {
			type: "string",
			enum: ["task_context", "tool_failure"],
		},
		toolName: { type: "string", minLength: 1, maxLength: 128 },
		failureCode: { type: "string", minLength: 1, maxLength: 128 },
	},
	["op"],
);
