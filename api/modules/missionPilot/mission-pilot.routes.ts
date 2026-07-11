import { createRoute, z } from "@hono/zod-openapi";
import {
	createMissionPilotTaskRequestSchema,
	createMissionPilotTaskResponseSchema,
	missionPilotCommandRequestSchema,
	missionPilotCommandResponseSchema,
} from "../../../shared/schemas/mission-pilot.schema";
import { createOpenApiRouter } from "../../lib/openapi";
import { withOpenApiRouteError } from "../nightworkers/nightworkers.route-utils";
import * as service from "./mission-pilot.service";

const taskParams = z.object({ taskId: z.string().uuid() });
const createRouteDefinition = createRoute({
	method: "post",
	path: "/mission-pilot/tasks",
	request: {
		body: {
			content: {
				"application/json": { schema: createMissionPilotTaskRequestSchema },
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": { schema: createMissionPilotTaskResponseSchema },
			},
			description: "Mission Pilot task created",
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
export const missionPilotRouter = createOpenApiRouter()
	.openapi(
		createRouteDefinition,
		withOpenApiRouteError(createRouteDefinition, async (c) =>
			c.json(await service.createFromSourceRef(c.req.valid("json")), 201),
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
	);
