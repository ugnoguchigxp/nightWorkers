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
		query: z.object({
			channel: z
				.enum(["chat", "pilot_thought", "artifact", "internal"])
				.optional(),
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
			channel: z
				.enum(["chat", "pilot_thought", "artifact", "internal"])
				.optional(),
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

export const exportTaskRunJsonlRoute = createRoute({
	method: "get",
	path: "/runs/:id/export.jsonl",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "run-uuid" }),
		}),
	},
	responses: {
		200: {
			description: "Run JSONL export",
			content: {
				"application/x-ndjson": {
					schema: z.string(),
				},
			},
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

export const resumeTaskRunTodoRoute = createRoute({
	method: "post",
	path: "/runs/:id/todos/:todoId/resume",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "run-uuid" }),
			todoId: z.string().uuid().openapi({ example: "todo-uuid" }),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						expectedTodoRevision: z.number().int().nonnegative(),
						userContext: z.string().trim().min(1).max(20_000),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: { "application/json": { schema: taskRunSchema } },
			description: "Paused Todo and existing task run resumed successfully",
		},
		404: { description: "Run or Todo not found" },
		409: { description: "Run or Todo cannot be resumed" },
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

const mergeRecordResponseSchema = z.object({
	id: z.string().uuid(),
	runId: z.string().uuid(),
	status: z.string(),
	decision: z.string(),
	recordVersion: z.number().int(),
});
const mergeRecordRequestSchema = z.object({
	expectedVersion: z.number().int().nonnegative(),
});

export const previewRunGitMergeRoute = createRoute({
	method: "post",
	path: "/runs/:id/git/merge/preview",
	request: {
		params: z.object({ id: z.string().uuid() }),
		body: {
			content: { "application/json": { schema: mergeRecordRequestSchema } },
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: mergeRecordResponseSchema.nullable() },
			},
			description: "Merge preview result",
		},
	},
});

export const deferRunGitMergeRoute = createRoute({
	method: "post",
	path: "/runs/:id/git/merge/defer",
	request: {
		params: z.object({ id: z.string().uuid() }),
		body: {
			content: { "application/json": { schema: mergeRecordRequestSchema } },
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: mergeRecordResponseSchema.nullable() },
			},
			description: "Merge deferred",
		},
	},
});

export const reworkRunGitMergeRoute = createRoute({
	method: "post",
	path: "/runs/:id/git/merge/rework",
	request: {
		params: z.object({ id: z.string().uuid() }),
		body: {
			content: { "application/json": { schema: mergeRecordRequestSchema } },
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: mergeRecordResponseSchema.nullable() },
			},
			description: "Rework requested",
		},
	},
});

export const overrideRunGitMergeTargetRoute = createRoute({
	method: "patch",
	path: "/runs/:id/git/merge/target",
	request: {
		params: z.object({ id: z.string().uuid() }),
		body: {
			content: {
				"application/json": {
					schema: mergeRecordRequestSchema.extend({
						targetBranch: z.string().min(1),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: { "application/json": { schema: mergeRecordResponseSchema } },
			description: "Merge target overridden",
		},
	},
});

export const executeRunGitMergeRoute = createRoute({
	method: "post",
	path: "/runs/:id/git/merge",
	request: {
		params: z.object({ id: z.string().uuid() }),
		body: {
			content: { "application/json": { schema: mergeRecordRequestSchema } },
		},
	},
	responses: {
		200: {
			content: { "application/json": { schema: mergeRecordResponseSchema } },
			description: "Merge executed",
		},
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
