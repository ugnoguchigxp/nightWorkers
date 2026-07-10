import { createRoute, z } from "@hono/zod-openapi";
import {
	createCoverageImprovementTaskRequestSchema,
	createCoverageImprovementTaskResponseSchema,
	createProjectQualityRunRequestSchema,
	projectQualityOverviewSchema,
	projectQualityRunSchema,
} from "../../../shared/schemas/quality.schema";
import { createOpenApiRouter } from "../../lib/openapi";
import { withOpenApiRouteError } from "../nightworkers/nightworkers.route-utils";
import * as service from "./quality.service";

const repositoryParams = z.object({ id: z.string().uuid() });
const runParams = z.object({ id: z.string().uuid(), runId: z.string().uuid() });

const getProjectQualityRoute = createRoute({
	method: "get",
	path: "/repositories/:id/quality",
	request: { params: repositoryParams },
	responses: {
		200: {
			content: { "application/json": { schema: projectQualityOverviewSchema } },
			description: "Project quality overview",
		},
	},
});

const listProjectQualityRunsRoute = createRoute({
	method: "get",
	path: "/repositories/:id/quality/runs",
	request: { params: repositoryParams },
	responses: {
		200: {
			content: {
				"application/json": { schema: z.array(projectQualityRunSchema) },
			},
			description: "Project quality runs",
		},
	},
});

const createProjectQualityRunRoute = createRoute({
	method: "post",
	path: "/repositories/:id/quality/runs",
	request: {
		params: repositoryParams,
		body: {
			content: {
				"application/json": { schema: createProjectQualityRunRequestSchema },
			},
		},
	},
	responses: {
		201: {
			content: { "application/json": { schema: projectQualityRunSchema } },
			description: "Project quality run created",
		},
	},
});

const getProjectQualityRunRoute = createRoute({
	method: "get",
	path: "/repositories/:id/quality/runs/:runId",
	request: { params: runParams },
	responses: {
		200: {
			content: { "application/json": { schema: projectQualityRunSchema } },
			description: "Project quality run detail",
		},
	},
});

const cancelProjectQualityRunRoute = createRoute({
	method: "post",
	path: "/repositories/:id/quality/runs/:runId/cancel",
	request: { params: runParams },
	responses: {
		200: {
			content: { "application/json": { schema: projectQualityRunSchema } },
			description: "Project quality run cancelled",
		},
	},
});

const createCoverageImprovementTaskRoute = createRoute({
	method: "post",
	path: "/repositories/:id/quality/runs/:runId/coverage-task",
	request: {
		params: runParams,
		body: {
			content: {
				"application/json": {
					schema: createCoverageImprovementTaskRequestSchema,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: createCoverageImprovementTaskResponseSchema,
				},
			},
			description: "Coverage improvement task created",
		},
	},
});

export const qualityRouter = createOpenApiRouter()
	.openapi(
		getProjectQualityRoute,
		withOpenApiRouteError(getProjectQualityRoute, async (c) =>
			c.json(await service.getProjectQuality(c.req.param("id")), 200),
		),
	)
	.openapi(
		listProjectQualityRunsRoute,
		withOpenApiRouteError(listProjectQualityRunsRoute, async (c) =>
			c.json(await service.listProjectQualityRuns(c.req.param("id")), 200),
		),
	)
	.openapi(
		createProjectQualityRunRoute,
		withOpenApiRouteError(createProjectQualityRunRoute, async (c) =>
			c.json(
				await service.createProjectQualityRun({
					repositoryId: c.req.param("id"),
					runType: c.req.valid("json").runType,
				}),
				201,
			),
		),
	)
	.openapi(
		getProjectQualityRunRoute,
		withOpenApiRouteError(getProjectQualityRunRoute, async (c) =>
			c.json(
				await service.getProjectQualityRun(
					c.req.param("id"),
					c.req.param("runId"),
				),
				200,
			),
		),
	)
	.openapi(
		cancelProjectQualityRunRoute,
		withOpenApiRouteError(cancelProjectQualityRunRoute, async (c) =>
			c.json(
				await service.cancelProjectQualityRun(
					c.req.param("id"),
					c.req.param("runId"),
				),
				200,
			),
		),
	)
	.openapi(
		createCoverageImprovementTaskRoute,
		withOpenApiRouteError(createCoverageImprovementTaskRoute, async (c) =>
			c.json(
				await service.createCoverageImprovementTask({
					repositoryId: c.req.param("id"),
					runId: c.req.param("runId"),
					request: c.req.valid("json"),
				}),
				201,
			),
		),
	);
