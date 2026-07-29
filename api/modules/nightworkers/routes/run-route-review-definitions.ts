import { createRoute, z } from "@hono/zod-openapi";
import { reviewSessionDetailSchema } from "../../../../shared/schemas/nightworkers.schema";

// Legacy Review data remains readable, but this module intentionally exposes no
// route that can create a Review session or start a Review runtime.
// A human outcome decision is a Run command, not a legacy Review runtime.
export const submitRunReviewRoute = createRoute({
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
						action: z.enum(["complete", "cancel"]),
						note: z.string().optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: { "application/json": { schema: z.unknown() } },
			description: "Human Run outcome decision recorded",
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
