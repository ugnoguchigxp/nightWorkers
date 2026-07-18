import { createRoute, z } from "@hono/zod-openapi";
import { taskOperatorProjectionV1Schema } from "../../../shared/modules/taskOperator";
import { createOpenApiRouter } from "../../lib/openapi";
import { withOpenApiRouteError } from "../nightworkers/nightworkers.route-utils";
import { readTaskOperatorProjection } from "./application/task-operator.query";
import { humanTaskOperatorQueryContext } from "./task-operator-http-context";

const getTaskOperatorProjectionRoute = createRoute({
	method: "get",
	path: "/tasks/:taskId/operator-view",
	request: { params: z.object({ taskId: z.string().uuid() }) },
	responses: {
		200: {
			content: {
				"application/json": { schema: taskOperatorProjectionV1Schema },
			},
			description:
				"Bounded Task Operator projection shared by UI and automation",
		},
	},
});

export const taskOperatorRouter = createOpenApiRouter().openapi(
	getTaskOperatorProjectionRoute,
	withOpenApiRouteError(getTaskOperatorProjectionRoute, async (c) =>
		c.json(
			await readTaskOperatorProjection(
				c.req.param("taskId"),
				humanTaskOperatorQueryContext(c.get("user")?.userId),
			),
			200,
		),
	),
);
