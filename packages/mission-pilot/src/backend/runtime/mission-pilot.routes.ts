import { createRoute, z } from "@hono/zod-openapi";
import {
	missionPilotCommandRequestSchema,
	missionPilotCommandResponseSchema,
	missionPilotControlSummarySchema,
	missionPilotPlanProgressSchema,
} from "../../contracts";
import { createOpenApiRouter } from "../../lib/openapi";
import { withOpenApiRouteError } from "../nightworkers/nightworkers.route-utils";
import * as service from "./mission-pilot.service";
import * as executionQueryService from "./mission-pilot-execution-query.service";
import * as planProgressService from "./mission-pilot-plan-progress.service";

const taskParams = z.object({ taskId: z.string().uuid() });
const getTaskExecutionRoute = createRoute({
	method: "get",
	path: "/mission-pilot/tasks/:taskId/execution",
	request: { params: taskParams },
	responses: {
		200: {
			content: { "application/json": { schema: z.unknown() } },
			description: "Mission Pilot execution trace for a task",
		},
	},
});
const playRoute = createRoute({
	method: "post",
	path: "/mission-pilot/tasks/:taskId/play",
	request: {
		params: taskParams,
		body: {
			content: {
				"application/json": { schema: missionPilotCommandRequestSchema },
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: missionPilotCommandResponseSchema },
			},
			description: "Mission Pilot playing",
		},
	},
});
const stopRoute = createRoute({
	method: "post",
	path: "/mission-pilot/tasks/:taskId/stop",
	request: {
		params: taskParams,
		body: {
			content: {
				"application/json": { schema: missionPilotCommandRequestSchema },
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: missionPilotCommandResponseSchema },
			},
			description: "Mission Pilot stopped",
		},
	},
});
const getControlRoute = createRoute({
	method: "get",
	path: "/mission-pilot/tasks/:taskId",
	request: { params: taskParams },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: missionPilotControlSummarySchema.nullable(),
				},
			},
			description: "Mission Pilot control state for a task",
		},
	},
});
const getPlanProgressRoute = createRoute({
	method: "get",
	path: "/mission-pilot/tasks/:taskId/plan-progress",
	request: { params: taskParams },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: missionPilotPlanProgressSchema.nullable(),
				},
			},
			description: "Current Mission Pilot Plan Mode progress",
		},
	},
});
export const missionPilotRouter = createOpenApiRouter()
	.openapi(
		getControlRoute,
		withOpenApiRouteError(getControlRoute, async (c) =>
			c.json(await service.getControl(c.req.param("taskId")), 200),
		),
	)
	.openapi(
		getTaskExecutionRoute,
		withOpenApiRouteError(getTaskExecutionRoute, async (c) =>
			c.json(
				await executionQueryService.getMissionPilotExecutionForTask(
					c.req.param("taskId"),
				),
				200,
			),
		),
	)
	.openapi(
		playRoute,
		withOpenApiRouteError(playRoute, async (c) =>
			c.json(
				await service.play(
					c.req.param("taskId"),
					c.req.valid("json").expectedVersion,
				),
				200,
			),
		),
	)
	.openapi(
		stopRoute,
		withOpenApiRouteError(stopRoute, async (c) =>
			c.json(
				await service.stop(
					c.req.param("taskId"),
					c.req.valid("json").expectedVersion,
				),
				200,
			),
		),
	)
	.openapi(
		getPlanProgressRoute,
		withOpenApiRouteError(getPlanProgressRoute, async (c) =>
			c.json(
				await planProgressService.getMissionPilotPlanProgress(
					c.req.param("taskId"),
				),
				200,
			),
		),
	);
