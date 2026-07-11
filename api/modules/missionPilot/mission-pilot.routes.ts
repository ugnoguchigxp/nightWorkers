import { createRoute, z } from "@hono/zod-openapi";
import {
	createMissionPilotTaskRequestSchema,
	createMissionPilotTaskResponseSchema,
	missionPilotCommandRequestSchema,
	missionPilotCommandResponseSchema,
	missionPilotQuestionnaireDraftSchema,
	submitMissionPilotQuestionnaireDraftSchema,
	updateMissionPilotQuestionnaireDraftSchema,
} from "../../../shared/schemas/mission-pilot.schema";
import { missionPilotPlanProgressSchema } from "../../../shared/schemas/mission-pilot-plan-progress.schema";
import { createOpenApiRouter } from "../../lib/openapi";
import { withOpenApiRouteError } from "../nightworkers/nightworkers.route-utils";
import * as service from "./mission-pilot.service";
import * as planProgressService from "./mission-pilot-plan-progress.service";
import * as questionnaireService from "./mission-pilot-questionnaire.service";

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
const getQuestionnaireDraftRoute = createRoute({
	method: "get",
	path: "/mission-pilot/tasks/:taskId/questionnaire-draft",
	request: { params: taskParams },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: missionPilotQuestionnaireDraftSchema.nullable(),
				},
			},
			description: "Current Mission Pilot questionnaire draft",
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
const updateQuestionnaireDraftRoute = createRoute({
	method: "patch",
	path: "/mission-pilot/tasks/:taskId/questionnaire-draft",
	request: {
		params: taskParams,
		body: {
			content: {
				"application/json": {
					schema: updateMissionPilotQuestionnaireDraftSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: missionPilotQuestionnaireDraftSchema },
			},
			description: "Mission Pilot questionnaire draft updated",
		},
	},
});
const submitQuestionnaireDraftRoute = createRoute({
	method: "post",
	path: "/mission-pilot/tasks/:taskId/questionnaire-draft/submit",
	request: {
		params: taskParams,
		body: {
			content: {
				"application/json": {
					schema: submitMissionPilotQuestionnaireDraftSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						draft: missionPilotQuestionnaireDraftSchema.nullable(),
						questionnaire: z.unknown(),
					}),
				},
			},
			description: "Mission Pilot questionnaire draft submitted",
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
	)
	.openapi(
		getQuestionnaireDraftRoute,
		withOpenApiRouteError(getQuestionnaireDraftRoute, async (c) =>
			c.json(
				await questionnaireService.getQuestionnaireDraft(c.req.param("taskId")),
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
	)
	.openapi(
		updateQuestionnaireDraftRoute,
		withOpenApiRouteError(updateQuestionnaireDraftRoute, async (c) => {
			const input = c.req.valid("json");
			return c.json(
				await questionnaireService.updateQuestionnaireDraft(
					c.req.param("taskId"),
					input.expectedVersion,
					input.answers,
				),
				200,
			);
		}),
	)
	.openapi(
		submitQuestionnaireDraftRoute,
		withOpenApiRouteError(submitQuestionnaireDraftRoute, async (c) => {
			const input = c.req.valid("json");
			return c.json(
				await questionnaireService.submitQuestionnaireDraft(
					c.req.param("taskId"),
					input.expectedVersion,
					input.answers,
				),
				200,
			);
		}),
	);
