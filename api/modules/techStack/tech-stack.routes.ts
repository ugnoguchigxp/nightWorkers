import { createRoute, z } from "@hono/zod-openapi";
import {
	projectCodeSizeSnapshotSchema,
	projectDependencyAuditResultSchema,
} from "../../../shared/schemas/tech-stack.schema";
import { createOpenApiRouter } from "../../lib/openapi";
import { withOpenApiRouteError } from "../nightworkers/nightworkers.route-utils";
import {
	measureAndSaveProjectCodeSize,
	runRepositoryDependencyAudit,
} from "./tech-stack.service";

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

const runDependencyAuditRoute = createRoute({
	method: "post",
	path: "/repositories/:id/tech-stack/dependency-audit",
	request: { params: z.object({ id: z.string().uuid() }) },
	responses: {
		200: {
			content: {
				"application/json": { schema: projectDependencyAuditResultSchema },
			},
			description: "Latest dependency vulnerability audit result",
		},
	},
});

export const techStackRouter = createOpenApiRouter()
	.openapi(
		measureCodeSizeRoute,
		withOpenApiRouteError(measureCodeSizeRoute, async (c) =>
			c.json(await measureAndSaveProjectCodeSize(c.req.param("id")), 200),
		),
	)
	.openapi(
		runDependencyAuditRoute,
		withOpenApiRouteError(runDependencyAuditRoute, async (c) =>
			c.json(await runRepositoryDependencyAudit(c.req.param("id")), 200),
		),
	);
