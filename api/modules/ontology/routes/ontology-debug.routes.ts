import { createRoute, z } from "@hono/zod-openapi";
import { ontologyRunDebugReportSchema } from "../../../../shared/schemas/nightworkers.schema";

export const getOntologyRunDebugReportRoute = createRoute({
	method: "get",
	path: "/runs/:id/ontology-debug",
	request: {
		params: z.object({
			id: z.string().uuid().openapi({ example: "run-uuid" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: ontologyRunDebugReportSchema,
				},
			},
			description:
				"Read-only ontology runtime snapshot and boundary audit debug report",
		},
		404: { description: "Run not found" },
	},
});
