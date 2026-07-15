import { createRoute, z } from "@hono/zod-openapi";
import { reviewSessionDetailSchema } from "../../../../shared/schemas/nightworkers.schema";

// Legacy Review data remains readable, but this module intentionally exposes no
// route that can create a Review session or start a Review runtime.
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
			description: "Latest legacy Review session for the task",
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
			description: "Legacy Review session detail",
		},
		404: { description: "Review session not found" },
	},
});
