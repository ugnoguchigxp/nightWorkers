import { createRoute, z } from "@hono/zod-openapi";
import {
	missionPilotCommandRequestSchema,
	missionPilotCommandResponseSchema,
	missionPilotControlSummarySchema,
	missionPilotPlanProgressSchema,
	missionPilotQuestionnaireDraftSchema,
	submitMissionPilotQuestionnaireDraftSchema,
	updateMissionPilotQuestionnaireDraftSchema,
} from "../../contracts";
import { createOpenApiRouter } from "../../lib/openapi";
import { withOpenApiRouteError } from "../nightworkers/nightworkers.route-utils";
import * as service from "./mission-pilot.service";
import * as executionQueryService from "./mission-pilot-execution-query.service";
import * as planProgressService from "./mission-pilot-plan-progress.service";
import * as questionnaireService from "./mission-pilot-questionnaire.service";

const taskParams = z.object({ taskId: z.string().uuid() });
const sessionParams = z.object({ id: z.string().uuid() });
const retiredLegacyExecutionResponseSchema = z.object({
	error: z.string(),
	code: z.literal("MISSION_PILOT_LEGACY_ENDPOINT_RETIRED"),
	replacement: z.object({
		execution: z.literal("task_operator_v1"),
		resourceKind: z.string(),
	}),
});
const getExecutionRoute = createRoute({
	method: "get",
	path: "/mission-pilot/sessions/:id/execution",
	request: { params: sessionParams },
	responses: {
		200: {
			content: { "application/json": { schema: z.unknown() } },
			description: "Mission Pilot post-Queue execution state",
		},
	},
});
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
const getVerificationSnapshotRoute = createRoute({
	method: "get",
	path: "/mission-pilot/sessions/:id/verification-snapshot",
	request: { params: sessionParams },
	responses: {
		410: {
			content: {
				"application/json": { schema: retiredLegacyExecutionResponseSchema },
			},
			description:
				"Legacy verification snapshot retired; use Task Operator run_outcome",
		},
	},
});
const getReviewDecisionRoute = createRoute({
	method: "get",
	path: "/mission-pilot/sessions/:id/review-decision",
	request: { params: sessionParams },
	responses: {
		410: {
			content: {
				"application/json": { schema: retiredLegacyExecutionResponseSchema },
			},
			description:
				"Legacy Review decision retired; use Task Operator run_outcome",
		},
	},
});
const getCloseoutRoute = createRoute({
	method: "get",
	path: "/mission-pilot/sessions/:id/closeout",
	request: { params: sessionParams },
	responses: {
		410: {
			content: {
				"application/json": { schema: retiredLegacyExecutionResponseSchema },
			},
			description: "Legacy closeout retired; use Task Operator run_outcome",
		},
	},
});
const reconcileExecutionRoute = createRoute({
	method: "post",
	path: "/mission-pilot/sessions/:id/reconcile",
	request: { params: sessionParams },
	responses: {
		200: {
			content: { "application/json": { schema: z.unknown() } },
			description: "Reconciled Mission Pilot execution state",
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
		getExecutionRoute,
		withOpenApiRouteError(getExecutionRoute, async (c) =>
			c.json(
				await executionQueryService.getMissionPilotExecution(c.req.param("id")),
				200,
			),
		),
	)
	.openapi(
		getVerificationSnapshotRoute,
		withOpenApiRouteError(getVerificationSnapshotRoute, async (c) => {
			await executionQueryService.getLatestMissionPilotVerificationSnapshot(
				c.req.param("id"),
			);
			throw new Error("Retired Mission Pilot endpoint returned unexpectedly");
		}),
	)
	.openapi(
		getReviewDecisionRoute,
		withOpenApiRouteError(getReviewDecisionRoute, async (c) => {
			await executionQueryService.getLatestMissionPilotReviewDecision(
				c.req.param("id"),
			);
			throw new Error("Retired Mission Pilot endpoint returned unexpectedly");
		}),
	)
	.openapi(
		getCloseoutRoute,
		withOpenApiRouteError(getCloseoutRoute, async (c) => {
			await executionQueryService.getLatestMissionPilotCloseout(
				c.req.param("id"),
			);
			throw new Error("Retired Mission Pilot endpoint returned unexpectedly");
		}),
	)
	.openapi(
		reconcileExecutionRoute,
		withOpenApiRouteError(reconcileExecutionRoute, async (c) =>
			c.json(
				await executionQueryService.reconcileMissionPilotExecution(
					c.req.param("id"),
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
