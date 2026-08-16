import { createRoute, z } from "@hono/zod-openapi";
import {
	PROMPT_IMAGE_MAX_COUNT,
	PROMPT_IMAGE_MEDIA_TYPES,
} from "../../../../shared/prompt-image";
import { apiErrorOpenApiResponse } from "../../../../shared/schemas/api-error.schema";
import {
	createTaskSchema,
	taskRunSchema,
	taskSchema,
	taskStatusSchema,
} from "../../../../shared/schemas/nightworkers.schema";
import { planModeRegenerationTargetSchema } from "../../../../shared/schemas/plan-mode-artifact.schema";
import { planModeArtifactFocusSchema } from "../../../../shared/schemas/plan-mode-artifact-correction.schema";
export const listTasksRoute = createRoute({
	method: "get",
	path: "/tasks",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.array(taskSchema),
				},
			},
			description: "List of all tasks",
		},
	},
});
export const createTaskRoute = createRoute({
	method: "post",
	path: "/tasks",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createTaskSchema,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: taskSchema,
				},
			},
			description: "Task created successfully",
		},
	},
});
export const getTaskRoute = createRoute({
	method: "get",
	path: "/tasks/:id",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "task-uuid" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: taskSchema,
				},
			},
			description: "Task detail",
		},
		404: apiErrorOpenApiResponse("Task not found"),
	},
});
export const deleteTaskRoute = createRoute({
	method: "delete",
	path: "/tasks/:id",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "task-uuid" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: taskSchema,
				},
			},
			description: "Task deleted successfully",
		},
		404: apiErrorOpenApiResponse("Task not found"),
	},
});
export const updateTaskRoute = createRoute({
	method: "patch",
	path: "/tasks/:id",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "task-uuid" }),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						title: z.string().optional(),
						description: z.string().optional(),
						objective: z.string().optional(),
						acceptanceCriteria: z.string().optional(),
						status: taskStatusSchema.optional(),
						priority: z.number().optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: taskSchema,
				},
			},
			description: "Task updated successfully",
		},
		404: apiErrorOpenApiResponse("Task not found"),
	},
});
export const startTaskRunRoute = createRoute({
	method: "post",
	path: "/tasks/:id/run",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "task-uuid" }),
		}),
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: taskRunSchema,
				},
			},
			description: "Task run started successfully",
		},
		404: apiErrorOpenApiResponse("Task not found"),
	},
});
export const appendTaskMessageRoute = createRoute({
	method: "post",
	path: "/tasks/:id/messages",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "task-uuid" }),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						prompt: z.string().min(1),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: taskSchema,
				},
			},
			description: "Task message appended",
		},
		404: apiErrorOpenApiResponse("Task not found"),
	},
});
const workbenchArtifactContextSchema = z.object({
	artifactId: z.string(),
	kind: z.string(),
	title: z.string(),
	summary: z.string().optional(),
	source: z.object({ type: z.string() }).passthrough(),
	metadata: z
		.object({
			intent: z.string().optional(),
			appBlueprintName: z.string().optional(),
			artifactType: z.string().optional(),
			screenNames: z.array(z.string()).optional(),
			sectionNames: z.array(z.string()).optional(),
			tableNames: z.array(z.string()).optional(),
			initialTab: z.string().optional(),
			blueprintCount: z.number().optional(),
			instructionMode: z.literal("regenerate_artifact").optional(),
			planModeTarget: planModeRegenerationTargetSchema.optional(),
			planModeFocus: planModeArtifactFocusSchema.optional(),
			correlationId: z.string().uuid().nullable().optional(),
			displayKind: z.string().optional(),
			questionnaireSessionId: z.string().uuid().nullable().optional(),
			featurePlanMessageId: z.string().uuid().nullable().optional(),
			sourceBlueprintMessageId: z.string().uuid().nullable().optional(),
			sourceDataModelMessageId: z.string().uuid().nullable().optional(),
		})
		.optional(),
});
export const appendWorkbenchMessageRoute = createRoute({
	method: "post",
	path: "/workbench/sessions/:id/messages",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "task-uuid" }),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						prompt: z.string().min(1),
						images: z
							.array(
								z.object({
									id: z.string().min(1).max(128),
									name: z.string().min(1).max(240),
									mediaType: z.enum(PROMPT_IMAGE_MEDIA_TYPES),
									size: z.number().int().positive(),
									dataUrl: z.string().min(1).max(5_100_000),
								}),
							)
							.max(PROMPT_IMAGE_MAX_COUNT)
							.optional(),
						waitForIntake: z.boolean().optional(),
						artifactContext: workbenchArtifactContextSchema
							.nullable()
							.optional(),
						providerEndpointId: z.string().optional(),
						model: z.string().optional(),
						thinkingDepth: z
							.enum(["low", "medium", "high", "very_high"])
							.optional(),
						intent: z
							.enum([
								"intake",
								"draft",
								"feature_plan",
								"create_task",
								"queue",
								"plan_task",
								"run_task",
								"adjust_running",
								"review_prompt",
								"review_followup",
								"learning_capture",
								"design_component",
								"design_blueprint_data",
							])
							.default("intake"),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: { "application/json": { schema: z.unknown() } },
			description: "Workbench message handled",
		},
		404: apiErrorOpenApiResponse("Task not found"),
	},
});
export const createWorkbenchSessionRoute = createRoute({
	method: "post",
	path: "/workbench/sessions",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						repositoryId: z.string().uuid(),
						title: z.string().optional(),
						description: z.string().optional(),
						objective: z.string().optional(),
						acceptanceCriteria: z.string().optional(),
						timeoutSeconds: z.number().optional(),
						priority: z.number().optional(),
						createdBy: z.string().optional(),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": { schema: taskSchema },
			},
			description: "Workbench session created",
		},
	},
});
