import {
	TODO_DRAFT_FIELD_GUIDANCE_JA,
	TODO_MUTATION_LIMITS,
} from "../../../../services/todo-mutation";
import { objectSchema } from "./native-api-tool-schema";

const todoRevisionFields = {
	todoId: {
		type: "string",
		minLength: 1,
		maxLength: TODO_MUTATION_LIMITS.maxTodoIdLength,
	},
	expectedTodoRevision: { type: "integer", minimum: 0 },
};

export const todoCommandJsonSchema = {
	oneOf: [
		objectSchema({ op: { const: "list" } }, ["op"]),
		objectSchema(
			{
				op: { const: "replace_plan" },
				expectedPlanRevision: { type: "integer", minimum: 0 },
				todos: {
					type: "array",
					minItems: 1,
					maxItems: TODO_MUTATION_LIMITS.maxTodos,
					items: objectSchema(
						{
							id: {
								type: "string",
								minLength: 1,
								maxLength: TODO_MUTATION_LIMITS.maxTodoIdLength,
							},
							title: {
								type: "string",
								minLength: 1,
								maxLength: TODO_MUTATION_LIMITS.maxTitleLength,
							},
							objective: {
								type: ["string", "null"],
								maxLength: TODO_MUTATION_LIMITS.maxObjectiveLength,
								description: TODO_DRAFT_FIELD_GUIDANCE_JA.objective,
							},
							context: {
								type: ["string", "null"],
								maxLength: TODO_MUTATION_LIMITS.maxContextLength,
								description: TODO_DRAFT_FIELD_GUIDANCE_JA.context,
							},
							nextAction: {
								type: "string",
								minLength: 1,
								maxLength: TODO_MUTATION_LIMITS.maxNextActionLength,
								description: TODO_DRAFT_FIELD_GUIDANCE_JA.nextAction,
							},
							acceptanceCriteria: {
								type: "array",
								maxItems: TODO_MUTATION_LIMITS.maxAcceptanceCriteria,
								description: TODO_DRAFT_FIELD_GUIDANCE_JA.acceptanceCriteria,
								items: {
									type: "string",
									minLength: 1,
									maxLength: TODO_MUTATION_LIMITS.maxAcceptanceCriterionLength,
								},
							},
							dependsOn: {
								type: "array",
								maxItems: TODO_MUTATION_LIMITS.maxDependencies,
								items: {
									type: "string",
									minLength: 1,
									maxLength: TODO_MUTATION_LIMITS.maxTodoIdLength,
								},
							},
						},
						["title", "nextAction"],
					),
				},
			},
			["op", "expectedPlanRevision", "todos"],
		),
		...(["start"] as const).map((op) =>
			objectSchema({ op: { const: op }, ...todoRevisionFields }, [
				"op",
				"todoId",
				"expectedTodoRevision",
			]),
		),
		objectSchema(
			{
				op: { const: "resume" },
				...todoRevisionFields,
				userContext: {
					type: "string",
					minLength: 1,
					maxLength: TODO_MUTATION_LIMITS.maxContextLength,
				},
			},
			["op", "todoId", "expectedTodoRevision", "userContext"],
		),
		objectSchema(
			{
				op: { const: "transition" },
				...todoRevisionFields,
				status: { enum: ["passed", "needs_human", "skipped"] },
				reason: {
					type: "string",
					minLength: 1,
					maxLength: TODO_MUTATION_LIMITS.maxReasonLength,
				},
				nextTodoId: {
					type: "string",
					minLength: 1,
					maxLength: TODO_MUTATION_LIMITS.maxTodoIdLength,
				},
			},
			["op", "todoId", "expectedTodoRevision", "status", "reason"],
		),
		objectSchema(
			{
				op: { const: "record_failure" },
				...todoRevisionFields,
				failureSummary: {
					type: "string",
					minLength: 1,
					maxLength: TODO_MUTATION_LIMITS.maxReasonLength,
				},
				nextAction: {
					type: "string",
					minLength: 1,
					maxLength: TODO_MUTATION_LIMITS.maxNextActionLength,
				},
			},
			["op", "todoId", "expectedTodoRevision", "failureSummary", "nextAction"],
		),
		objectSchema(
			{
				op: { const: "update_context" },
				...todoRevisionFields,
				context: {
					type: "string",
					maxLength: TODO_MUTATION_LIMITS.maxContextLength,
					description: TODO_DRAFT_FIELD_GUIDANCE_JA.updateContext,
				},
				nextAction: {
					type: "string",
					minLength: 1,
					maxLength: TODO_MUTATION_LIMITS.maxNextActionLength,
					description: TODO_DRAFT_FIELD_GUIDANCE_JA.nextAction,
				},
			},
			["op", "todoId", "expectedTodoRevision", "context", "nextAction"],
		),
	],
};
