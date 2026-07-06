import { createRoute, z } from "@hono/zod-openapi";
import {
	createMissionRequestSchema,
	createTasksFromMissionTaskProposalsRequestSchema,
	createTasksFromMissionTaskProposalsResponseSchema,
	decomposeMissionRequestSchema,
	generateMissionCandidatesRequestSchema,
	generateMissionCandidatesResponseSchema,
	missionDetailSchema,
	missionPlanningResultSchema,
	missionSchema,
	missionTaskProposalSchema,
	requestMissionPlanningRevisionRequestSchema,
} from "../../../shared/schemas/mission-planner.schema";
import { createOpenApiRouter } from "../../lib/openapi";
import { withOpenApiRouteError } from "../nightworkers/nightworkers.route-utils";
import * as service from "./mission-planner.service";

const repositoryParams = z.object({ repositoryId: z.string().uuid() });
const missionParams = z.object({ missionId: z.string().uuid() });
const resultParams = z.object({ resultId: z.string().uuid() });
const proposalParams = z.object({ proposalId: z.string().uuid() });

const createMissionRoute = createRoute({
	method: "post",
	path: "/repositories/:repositoryId/missions",
	request: {
		params: repositoryParams,
		body: {
			content: { "application/json": { schema: createMissionRequestSchema } },
		},
	},
	responses: {
		201: {
			content: { "application/json": { schema: missionSchema } },
			description: "Mission created",
		},
	},
});

const listMissionsRoute = createRoute({
	method: "get",
	path: "/repositories/:repositoryId/missions",
	request: { params: repositoryParams },
	responses: {
		200: {
			content: { "application/json": { schema: z.array(missionSchema) } },
			description: "Repository Missions",
		},
	},
});

const generateMissionCandidatesRoute = createRoute({
	method: "post",
	path: "/repositories/:repositoryId/missions/generate-candidates",
	request: {
		params: repositoryParams,
		body: {
			content: {
				"application/json": { schema: generateMissionCandidatesRequestSchema },
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": { schema: generateMissionCandidatesResponseSchema },
			},
			description: "Mission candidates generated from configured Goals",
		},
	},
});

const getMissionRoute = createRoute({
	method: "get",
	path: "/missions/:missionId",
	request: { params: missionParams },
	responses: {
		200: {
			content: { "application/json": { schema: missionDetailSchema } },
			description: "Mission detail",
		},
	},
});

const deleteMissionRoute = createRoute({
	method: "delete",
	path: "/missions/:missionId",
	request: { params: missionParams },
	responses: {
		200: {
			content: { "application/json": { schema: missionSchema } },
			description: "Draft Mission deleted",
		},
	},
});

const decomposeMissionRoute = createRoute({
	method: "post",
	path: "/missions/:missionId/decompose",
	request: {
		params: missionParams,
		body: {
			content: {
				"application/json": { schema: decomposeMissionRequestSchema },
			},
		},
	},
	responses: {
		200: {
			content: { "application/json": { schema: missionDetailSchema } },
			description: "Mission decomposed and evaluated",
		},
	},
});

const listPlanningResultsRoute = createRoute({
	method: "get",
	path: "/missions/:missionId/planning-results",
	request: { params: missionParams },
	responses: {
		200: {
			content: {
				"application/json": { schema: z.array(missionPlanningResultSchema) },
			},
			description: "Mission planning results",
		},
	},
});

const evaluatePlanningResultRoute = createRoute({
	method: "post",
	path: "/mission-planning-results/:resultId/evaluate",
	request: { params: resultParams },
	responses: {
		200: {
			content: { "application/json": { schema: missionPlanningResultSchema } },
			description: "Mission planning result evaluated",
		},
	},
});

const requestPlanningRevisionRoute = createRoute({
	method: "post",
	path: "/mission-planning-results/:resultId/request-revision",
	request: {
		params: resultParams,
		body: {
			content: {
				"application/json": {
					schema: requestMissionPlanningRevisionRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: { "application/json": { schema: missionPlanningResultSchema } },
			description: "Mission planning result revision requested",
		},
	},
});

const listTaskProposalsRoute = createRoute({
	method: "get",
	path: "/mission-planning-results/:resultId/task-proposals",
	request: { params: resultParams },
	responses: {
		200: {
			content: {
				"application/json": { schema: z.array(missionTaskProposalSchema) },
			},
			description: "Mission task proposals",
		},
	},
});

const listRepositoryTaskProposalsRoute = createRoute({
	method: "get",
	path: "/repositories/:repositoryId/mission-task-proposals",
	request: {
		params: repositoryParams,
		query: z.object({ status: z.string().optional() }),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.array(missionTaskProposalSchema) },
			},
			description: "Repository Mission task proposals",
		},
	},
});

const dismissTaskProposalRoute = createRoute({
	method: "post",
	path: "/mission-task-proposals/:proposalId/dismiss",
	request: { params: proposalParams },
	responses: {
		200: {
			content: { "application/json": { schema: missionTaskProposalSchema } },
			description: "Mission task proposal dismissed",
		},
	},
});

const createTasksFromMissionTaskProposalsRoute = createRoute({
	method: "post",
	path: "/mission-task-proposals/create-tasks",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createTasksFromMissionTaskProposalsRequestSchema,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: createTasksFromMissionTaskProposalsResponseSchema,
				},
			},
			description: "Tasks created from selected Mission task proposals",
		},
	},
});

export const missionPlannerRouter = createOpenApiRouter()
	.openapi(
		createMissionRoute,
		withOpenApiRouteError(createMissionRoute, async (c) => {
			const body = c.req.valid("json");
			return c.json(
				await service.createMission({
					repositoryId: c.req.param("repositoryId"),
					title: body.title,
					goalText: body.goalText,
					nonGoals: body.nonGoals,
					sourceGoalIds: body.sourceGoalIds,
				}),
				201,
			);
		}),
	)
	.openapi(
		listMissionsRoute,
		withOpenApiRouteError(listMissionsRoute, async (c) =>
			c.json(await service.listMissions(c.req.param("repositoryId")), 200),
		),
	)
	.openapi(
		generateMissionCandidatesRoute,
		withOpenApiRouteError(generateMissionCandidatesRoute, async (c) => {
			const body = c.req.valid("json");
			return c.json(
				await service.generateMissionCandidatesFromGoals({
					repositoryId: c.req.param("repositoryId"),
					goalIds: body.goalIds,
					includeInactiveGoals: body.includeInactiveGoals,
				}),
				201,
			);
		}),
	)
	.openapi(
		getMissionRoute,
		withOpenApiRouteError(getMissionRoute, async (c) =>
			c.json(await service.getMissionDetail(c.req.param("missionId")), 200),
		),
	)
	.openapi(
		deleteMissionRoute,
		withOpenApiRouteError(deleteMissionRoute, async (c) =>
			c.json(await service.deleteMission(c.req.param("missionId")), 200),
		),
	)
	.openapi(
		decomposeMissionRoute,
		withOpenApiRouteError(decomposeMissionRoute, async (c) => {
			const body = c.req.valid("json");
			return c.json(
				await service.decomposeMission({
					missionId: c.req.param("missionId"),
					force: body.force,
				}),
				200,
			);
		}),
	)
	.openapi(
		listPlanningResultsRoute,
		withOpenApiRouteError(listPlanningResultsRoute, async (c) =>
			c.json(await service.listPlanningResults(c.req.param("missionId")), 200),
		),
	)
	.openapi(
		evaluatePlanningResultRoute,
		withOpenApiRouteError(evaluatePlanningResultRoute, async (c) =>
			c.json(
				await service.evaluatePlanningResult(c.req.param("resultId")),
				200,
			),
		),
	)
	.openapi(
		requestPlanningRevisionRoute,
		withOpenApiRouteError(requestPlanningRevisionRoute, async (c) => {
			const body = c.req.valid("json");
			return c.json(
				await service.requestPlanningRevision({
					planningResultId: c.req.param("resultId"),
					reason: body.reason,
				}),
				200,
			);
		}),
	)
	.openapi(
		listTaskProposalsRoute,
		withOpenApiRouteError(listTaskProposalsRoute, async (c) =>
			c.json(await service.listTaskProposals(c.req.param("resultId")), 200),
		),
	)
	.openapi(
		listRepositoryTaskProposalsRoute,
		withOpenApiRouteError(listRepositoryTaskProposalsRoute, async (c) =>
			c.json(
				await service.listRepositoryTaskProposals({
					repositoryId: c.req.param("repositoryId"),
					status: c.req.valid("query").status,
				}),
				200,
			),
		),
	)
	.openapi(
		dismissTaskProposalRoute,
		withOpenApiRouteError(dismissTaskProposalRoute, async (c) =>
			c.json(await service.dismissTaskProposal(c.req.param("proposalId")), 200),
		),
	)
	.openapi(
		createTasksFromMissionTaskProposalsRoute,
		withOpenApiRouteError(
			createTasksFromMissionTaskProposalsRoute,
			async (c) => {
				const body = c.req.valid("json");
				return c.json(
					await service.createTasksFromMissionTaskProposals({
						proposalIds: body.proposalIds,
						mode: body.mode,
					}),
					201,
				);
			},
		),
	);
