import { createRoute, z } from "@hono/zod-openapi";
import {
	createReviewerEvaluationRequestSchema,
	createReviewerReplayEvaluationRequestSchema,
	reviewActionSchema,
	reviewEvidenceRefSchema,
	reviewerEvaluationSchema,
	reviewFindingDispositionRequestSchema,
	reviewFindingSchema,
	reviewPromptSuggestionUpdateRequestSchema,
	reviewPromptSuggestionUseRequestSchema,
	reviewRecommendationSchema,
	reviewResultSchema,
	reviewRunRequestSchema,
	reviewSessionDetailSchema,
} from "../../../../shared/schemas/nightworkers.schema";

export const createReviewerEvaluationRoute = createRoute({
	method: "post",
	path: "/runs/:id/reviewer-evaluations",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "run-uuid" }),
		}),
		body: {
			content: {
				"application/json": {
					schema: createReviewerEvaluationRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: reviewerEvaluationSchema,
				},
			},
			description: "Reviewer evaluation created successfully",
		},
		404: {
			description: "Run not found",
		},
	},
});

export const getReviewRecommendationRoute = createRoute({
	method: "get",
	path: "/runs/:id/review-recommendation",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "run-uuid" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: reviewRecommendationSchema,
				},
			},
			description: "Deterministic Review Mode recommendation for a run",
		},
		404: { description: "Run not found" },
	},
});

export const createReviewSessionRoute = createRoute({
	method: "post",
	path: "/runs/:id/review-sessions",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "run-uuid" }),
		}),
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: reviewSessionDetailSchema,
				},
			},
			description: "Review Mode session started",
		},
		404: { description: "Run not found" },
	},
});

export const getLatestTaskReviewSessionRoute = createRoute({
	method: "get",
	path: "/tasks/:id/review-session",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "task-uuid" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: reviewSessionDetailSchema.nullable(),
				},
			},
			description: "Latest Review Mode session for the task",
		},
	},
});

export const getReviewSessionRoute = createRoute({
	method: "get",
	path: "/review-sessions/:id",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "review-session-uuid" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: reviewSessionDetailSchema,
				},
			},
			description: "Review Mode session detail",
		},
		404: { description: "Review session not found" },
	},
});

export const startReviewRunRoute = createRoute({
	method: "post",
	path: "/review-sessions/:id/run",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "review-session-uuid" }),
		}),
		body: {
			content: {
				"application/json": {
					schema: reviewRunRequestSchema.optional(),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: reviewSessionDetailSchema,
				},
			},
			description: "Review Run started",
		},
		404: { description: "Review session not found" },
	},
});

export const updateReviewFindingDispositionRoute = createRoute({
	method: "post",
	path: "/review-sessions/:id/findings/:findingId/disposition",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "review-session-uuid" }),
			findingId: z.string().uuid().openapi({ example: "finding-uuid" }),
		}),
		body: {
			content: {
				"application/json": {
					schema: reviewFindingDispositionRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: reviewSessionDetailSchema,
				},
			},
			description: "Review finding disposition updated",
		},
	},
});

export const createReviewPromptSuggestionsRoute = createRoute({
	method: "post",
	path: "/review-sessions/:id/prompt-suggestions",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "review-session-uuid" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: reviewSessionDetailSchema,
				},
			},
			description: "Review prompt suggestions created",
		},
	},
});

export const updateReviewPromptSuggestionRoute = createRoute({
	method: "patch",
	path: "/review-sessions/:id/prompt-suggestions/:suggestionId",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "review-session-uuid" }),
			suggestionId: z
				.string()
				.uuid()
				.openapi({ example: "review-prompt-suggestion-uuid" }),
		}),
		body: {
			content: {
				"application/json": {
					schema: reviewPromptSuggestionUpdateRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: reviewSessionDetailSchema,
				},
			},
			description: "Review prompt suggestion updated",
		},
	},
});

export const useReviewPromptSuggestionRoute = createRoute({
	method: "post",
	path: "/review-sessions/:id/prompt-suggestions/:suggestionId/use",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "review-session-uuid" }),
			suggestionId: z
				.string()
				.uuid()
				.openapi({ example: "review-prompt-suggestion-uuid" }),
		}),
		body: {
			content: {
				"application/json": {
					schema: reviewPromptSuggestionUseRequestSchema.optional(),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: reviewSessionDetailSchema,
				},
			},
			description: "Review prompt suggestion marked used",
		},
	},
});

export const createRunReviewRoute = createRoute({
	method: "post",
	path: "/runs/:id/reviews",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "run-uuid" }),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						action: reviewActionSchema,
						note: z.string().optional(),
						evidenceRefs: z.array(reviewEvidenceRefSchema).optional(),
						findings: z.array(reviewFindingSchema).optional(),
						humanCallouts: z.array(reviewFindingSchema).optional(),
						agentFollowUps: z.array(z.string()).optional(),
						suggestedNextTasks: z.array(z.string()).optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						ok: z.boolean(),
						status: z.string(),
						outcome: z.unknown(),
						reviewResult: reviewResultSchema,
					}),
				},
			},
			description: "Human run review saved",
		},
		404: {
			description: "Run not found",
		},
	},
});

export const createReviewerReplayEvaluationRoute = createRoute({
	method: "post",
	path: "/runs/:id/reviewer-evaluations/replay",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "run-uuid" }),
		}),
		body: {
			content: {
				"application/json": {
					schema: createReviewerReplayEvaluationRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: reviewerEvaluationSchema,
				},
			},
			description: "Read-only replay reviewer evaluation completed",
		},
		400: {
			content: {
				"application/json": {
					schema: z.object({ error: z.string(), code: z.string().optional() }),
				},
			},
			description: "Invalid reviewer replay input",
		},
		500: {
			content: {
				"application/json": {
					schema: z.object({ error: z.string(), code: z.string().optional() }),
				},
			},
			description: "Reviewer replay evaluation failed",
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
