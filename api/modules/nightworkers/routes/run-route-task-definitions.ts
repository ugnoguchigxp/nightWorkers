import { createRoute, z } from "@hono/zod-openapi";
import {
	activityReplaySchema,
	backgroundProcessSchema,
	commitRunCloseoutRequestSchema,
	gitCloseoutStateSchema,
	startBackgroundProcessRequestSchema,
	taskEventSchema,
	taskLlmUsageSummarySchema,
	taskMessageSchema,
	taskRunDetailSchema,
	taskRunSchema,
} from "../../../../shared/schemas/nightworkers.schema";

export const listTaskMessagesRoute = createRoute({
	method: "get",
	path: "/tasks/:id/messages",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "task-uuid" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.array(taskMessageSchema),
				},
			},
			description: "Task message list",
		},
		404: {
			description: "Task not found",
		},
	},
});

export const getTaskLlmUsageRoute = createRoute({
	method: "get",
	path: "/tasks/:id/llm-usage",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "task-uuid" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: taskLlmUsageSummarySchema,
				},
			},
			description: "Task LLM token usage summary",
		},
		404: {
			description: "Task not found",
		},
	},
});

export const listTaskActivityEventsRoute = createRoute({
	method: "get",
	path: "/tasks/:id/activity-events",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "task-uuid" }),
		}),
		query: z.object({
			afterSeq: z.coerce.number().int().min(0).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: activityReplaySchema,
				},
			},
			description:
				"Task activity events after an optional task sequence cursor",
		},
		404: {
			description: "Task not found",
		},
	},
});

export const getTaskRunRoute = createRoute({
	method: "get",
	path: "/runs/:id",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "run-uuid" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: taskRunDetailSchema,
				},
			},
			description: "Task run details and log events",
		},
		404: {
			description: "Run not found",
		},
	},
});

export const stopTaskRunRoute = createRoute({
	method: "post",
	path: "/runs/:id/stop",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "run-uuid" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: taskRunSchema,
				},
			},
			description: "Task run stop requested successfully",
		},
		404: {
			description: "Run not found",
		},
	},
});

export const getRunGitCloseoutRoute = createRoute({
	method: "get",
	path: "/runs/:id/git/closeout",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "run-uuid" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: gitCloseoutStateSchema,
				},
			},
			description: "Git closeout state for the run",
		},
		404: { description: "Run not found" },
	},
});

export const commitRunGitCloseoutRoute = createRoute({
	method: "post",
	path: "/runs/:id/git/commit",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "run-uuid" }),
		}),
		body: {
			content: {
				"application/json": {
					schema: commitRunCloseoutRequestSchema.optional(),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: gitCloseoutStateSchema,
				},
			},
			description: "Commit runtime-owned paths for the run",
		},
		404: { description: "Run not found" },
	},
});

export const pushRunGitCloseoutRoute = createRoute({
	method: "post",
	path: "/runs/:id/git/push",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "run-uuid" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: gitCloseoutStateSchema,
				},
			},
			description: "Push the committed run closeout",
		},
		404: { description: "Run not found" },
	},
});

export const listTaskRunEventsRoute = createRoute({
	method: "get",
	path: "/runs/:id/events",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "run-uuid" }),
		}),
		query: z.object({
			afterSeq: z.coerce.number().int().min(0).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.array(taskEventSchema),
				},
			},
			description: "Task run events after an optional sequence cursor",
		},
		404: {
			description: "Run not found",
		},
	},
});

export const listTaskRunActivityEventsRoute = createRoute({
	method: "get",
	path: "/runs/:id/activity-events",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "run-uuid" }),
		}),
		query: z.object({
			afterSeq: z.coerce.number().int().min(0).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: activityReplaySchema,
				},
			},
			description: "Run activity events after an optional task sequence cursor",
		},
		404: {
			description: "Run not found",
		},
	},
});

export const startBackgroundProcessRoute = createRoute({
	method: "post",
	path: "/background-processes",
	request: {
		body: {
			content: {
				"application/json": {
					schema: startBackgroundProcessRequestSchema,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: backgroundProcessSchema,
				},
			},
			description: "Background process started",
		},
	},
});

export const listBackgroundProcessesRoute = createRoute({
	method: "get",
	path: "/background-processes",
	request: {
		query: z.object({
			repositoryId: z.string().uuid().optional(),
			taskId: z.string().uuid().optional(),
			runId: z.string().uuid().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.array(backgroundProcessSchema),
				},
			},
			description: "Background process list",
		},
	},
});

export const getBackgroundProcessRoute = createRoute({
	method: "get",
	path: "/background-processes/:id",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "background-process-uuid" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: backgroundProcessSchema,
				},
			},
			description: "Background process detail",
		},
		404: { description: "Background process not found" },
	},
});

export const stopBackgroundProcessRoute = createRoute({
	method: "post",
	path: "/background-processes/:id/stop",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "background-process-uuid" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: backgroundProcessSchema,
				},
			},
			description: "Background process stopped",
		},
		404: { description: "Background process not found" },
	},
});

export const listTaskRunsRoute = createRoute({
	method: "get",
	path: "/tasks/:id/runs",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "task-uuid" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.array(taskRunSchema),
				},
			},
			description: "List of runs for the task",
		},
		404: {
			description: "Task not found",
		},
	},
});

export const listReviewRubricsRoute = createRoute({
	method: "get",
	path: "/review-rubrics",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.array(
						z.object({
							id: z.string(),
							title: z.string(),
							description: z.string().optional(),
							source: z.enum(["builtin", "repository", "inline"]),
							digest: z.string(),
							criteriaCount: z.number().int().nonnegative(),
							llm: z
								.object({
									enabledByDefault: z.boolean(),
									promptHints: z.array(z.string()).optional(),
									maxEvidenceChars: z.number().int().positive(),
								})
								.optional(),
						}),
					),
				},
			},
			description: "List available review rubrics",
		},
	},
});
