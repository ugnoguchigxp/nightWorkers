import { createRoute, z } from "@hono/zod-openapi";
import { projectDetailMetricsSchema } from "../../../shared/schemas/project-detail.schema";
import { createOpenApiRouter } from "../../lib/openapi";
import { withOpenApiRouteError } from "../nightworkers/nightworkers.route-utils";
import * as service from "./project-detail.service";

const repositoryParams = z.object({ id: z.string().uuid() });

const getMetricsRoute = createRoute({
	method: "get",
	path: "/repositories/:id/project-detail/metrics",
	request: { params: repositoryParams },
	responses: {
		200: {
			content: { "application/json": { schema: projectDetailMetricsSchema } },
			description: "Project detail metrics",
		},
	},
});

export const projectDetailRouter = createOpenApiRouter().openapi(
	getMetricsRoute,
	withOpenApiRouteError(getMetricsRoute, async (c) =>
		c.json(await service.getProjectDetailMetrics(c.req.param("id")), 200),
	),
);
