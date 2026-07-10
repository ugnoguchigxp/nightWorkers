import { createRoute, z } from "@hono/zod-openapi";
import { projectCodeSizeSnapshotSchema } from "../../../shared/schemas/tech-stack.schema";
import { createOpenApiRouter } from "../../lib/openapi";
import { withOpenApiRouteError } from "../nightworkers/nightworkers.route-utils";
import { measureAndSaveProjectCodeSize } from "./tech-stack.service";

const measureCodeSizeRoute = createRoute({
	method: "post",
	path: "/repositories/:id/tech-stack/code-size/measure",
	request: { params: z.object({ id: z.string().uuid() }) },
	responses: {
		200: {
			content: {
				"application/json": { schema: projectCodeSizeSnapshotSchema },
			},
			description: "Measured and saved project code size",
		},
	},
});

export const techStackRouter = createOpenApiRouter().openapi(
	measureCodeSizeRoute,
	withOpenApiRouteError(measureCodeSizeRoute, async (c) =>
		c.json(await measureAndSaveProjectCodeSize(c.req.param("id")), 200),
	),
);
