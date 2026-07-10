import { createRoute, z } from "@hono/zod-openapi";
import {
	applyMissionReplanRequestSchema,
	applyMissionReplanResponseSchema,
	createMissionFromImprovementRequestSchema,
	createMissionFromImprovementResponseSchema,
	createMissionReplanSuggestionRequestSchema,
	createMissionReplanSuggestionResponseSchema,
	decideMissionApprovalSchema,
	enqueueMissionTaskRequestSchema,
	enqueueMissionTaskResponseSchema,
	evaluateMissionRequestSchema,
	evaluateMissionResponseSchema,
	materializeMissionTaskRequestSchema,
	materializeMissionTaskResponseSchema,
	missionApprovalSchema,
	missionAutopilotCommandRequestSchema,
	missionAutopilotGrantSchema,
	missionAutopilotTickResponseSchema,
	missionPilotDetailSchema,
	requestMissionApprovalSchema,
	startMissionAutopilotRequestSchema,
	syncMissionExecutionRequestSchema,
	syncMissionExecutionResponseSchema,
} from "../../../shared/schemas/mission-pilot.schema";
import { createOpenApiRouter } from "../../lib/openapi";
import { withOpenApiRouteError } from "../nightworkers/nightworkers.route-utils";
import { createMissionFromProjectEvaluationImprovement } from "./mission-pilot.service";
import {
	decideMissionApproval,
	requestMissionApproval,
} from "./mission-pilot-approval.service";
import {
	pauseMissionAutopilot,
	resumeMissionAutopilot,
	revokeMissionAutopilot,
	startMissionAutopilot,
	tickMissionAutopilot,
} from "./mission-pilot-autopilot";
import {
	evaluateMission,
	syncMissionExecution,
} from "./mission-pilot-evaluation";
import {
	enqueueMissionTask,
	materializeMissionTask,
} from "./mission-pilot-queue";
import { getMissionPilotDetail } from "./mission-pilot-read-model";
import {
	applyMissionReplan,
	createMissionReplanSuggestion,
} from "./mission-pilot-replan";

const getMissionPilotDetailRoute = createRoute({
	method: "get",
	path: "/missions/:missionId/pilot-detail",
	request: { params: z.object({ missionId: z.string().uuid() }) },
	responses: {
		200: {
			content: { "application/json": { schema: missionPilotDetailSchema } },
			description: "Mission Pilot read-only detail",
		},
	},
});

const createMissionFromImprovementRoute = createRoute({
	method: "post",
	path: "/repositories/:repositoryId/missions/from-project-evaluation-improvement",
	request: {
		params: z.object({ repositoryId: z.string().uuid() }),
		body: {
			content: {
				"application/json": {
					schema: createMissionFromImprovementRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: createMissionFromImprovementResponseSchema,
				},
			},
			description: "Existing source-linked Mission",
		},
		201: {
			content: {
				"application/json": {
					schema: createMissionFromImprovementResponseSchema,
				},
			},
			description: "Source-linked Mission created",
		},
	},
});

const requestApprovalRoute = createRoute({
	method: "post",
	path: "/missions/:missionId/approvals",
	request: {
		params: z.object({ missionId: z.string().uuid() }),
		body: {
			content: { "application/json": { schema: requestMissionApprovalSchema } },
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						approval: missionApprovalSchema,
						created: z.boolean(),
					}),
				},
			},
			description: "Existing approval request",
		},
		201: {
			content: {
				"application/json": {
					schema: z.object({
						approval: missionApprovalSchema,
						created: z.boolean(),
					}),
				},
			},
			description: "Approval requested",
		},
	},
});

function decisionRoute(decision: "approve" | "reject") {
	return createRoute({
		method: "post",
		path: `/missions/:missionId/approvals/:approvalId/${decision}`,
		request: {
			params: z.object({
				missionId: z.string().uuid(),
				approvalId: z.string().uuid(),
			}),
			body: {
				content: {
					"application/json": { schema: decideMissionApprovalSchema },
				},
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: missionApprovalSchema } },
				description: `Approval ${decision}d`,
			},
		},
	});
}

const approveRoute = decisionRoute("approve");
const rejectRoute = decisionRoute("reject");

const materializeRoute = createRoute({
	method: "post",
	path: "/missions/:missionId/task-candidates/:taskCandidateId/materialize",
	request: {
		params: z.object({
			missionId: z.string().uuid(),
			taskCandidateId: z.string().uuid(),
		}),
		body: {
			content: {
				"application/json": { schema: materializeMissionTaskRequestSchema },
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: materializeMissionTaskResponseSchema },
			},
			description: "MissionTask materialized",
		},
	},
});

const enqueueRoute = createRoute({
	method: "post",
	path: "/missions/:missionId/tasks/:missionTaskId/enqueue",
	request: {
		params: z.object({
			missionId: z.string().uuid(),
			missionTaskId: z.string().uuid(),
		}),
		body: {
			content: {
				"application/json": { schema: enqueueMissionTaskRequestSchema },
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: enqueueMissionTaskResponseSchema },
			},
			description: "MissionTask queued",
		},
	},
});

const startAutopilotRoute = createRoute({
	method: "post",
	path: "/missions/:missionId/autopilot/start",
	request: {
		params: z.object({ missionId: z.string().uuid() }),
		body: {
			content: {
				"application/json": { schema: startMissionAutopilotRequestSchema },
			},
		},
	},
	responses: {
		200: {
			content: { "application/json": { schema: missionAutopilotGrantSchema } },
			description: "Level 1 Autopilot started",
		},
	},
});

function autopilotCommandRoute(command: "pause" | "resume" | "revoke") {
	return createRoute({
		method: "post",
		path: `/missions/:missionId/autopilot/${command}`,
		request: {
			params: z.object({ missionId: z.string().uuid() }),
			body: {
				content: {
					"application/json": { schema: missionAutopilotCommandRequestSchema },
				},
			},
		},
		responses: {
			200: {
				content: {
					"application/json": { schema: missionAutopilotGrantSchema },
				},
				description: `Autopilot ${command}`,
			},
		},
	});
}

const pauseAutopilotRoute = autopilotCommandRoute("pause");
const resumeAutopilotRoute = autopilotCommandRoute("resume");
const revokeAutopilotRoute = autopilotCommandRoute("revoke");
const tickAutopilotRoute = createRoute({
	method: "post",
	path: "/missions/:missionId/autopilot/tick",
	request: {
		params: z.object({ missionId: z.string().uuid() }),
		body: {
			content: {
				"application/json": { schema: missionAutopilotCommandRequestSchema },
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: missionAutopilotTickResponseSchema },
			},
			description: "One deterministic Autopilot action",
		},
	},
});

const syncExecutionRoute = createRoute({
	method: "post",
	path: "/missions/:missionId/sync-execution",
	request: {
		params: z.object({ missionId: z.string().uuid() }),
		body: {
			content: {
				"application/json": { schema: syncMissionExecutionRequestSchema },
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: syncMissionExecutionResponseSchema },
			},
			description: "Mission execution synchronized",
		},
	},
});

const evaluateRoute = createRoute({
	method: "post",
	path: "/missions/:missionId/evaluate",
	request: {
		params: z.object({ missionId: z.string().uuid() }),
		body: {
			content: { "application/json": { schema: evaluateMissionRequestSchema } },
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: evaluateMissionResponseSchema },
			},
			description: "Mission evidence evaluated",
		},
	},
});

const createReplanSuggestionRoute = createRoute({
	method: "post",
	path: "/missions/:missionId/replan-suggestions",
	request: {
		params: z.object({ missionId: z.string().uuid() }),
		body: {
			content: {
				"application/json": {
					schema: createMissionReplanSuggestionRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: createMissionReplanSuggestionResponseSchema,
				},
			},
			description: "Existing or created replan suggestion",
		},
	},
});

const applyReplanRoute = createRoute({
	method: "post",
	path: "/missions/:missionId/replan-suggestions/:suggestionId/apply",
	request: {
		params: z.object({
			missionId: z.string().uuid(),
			suggestionId: z.string().uuid(),
		}),
		body: {
			content: {
				"application/json": { schema: applyMissionReplanRequestSchema },
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: applyMissionReplanResponseSchema },
			},
			description: "Approved replan applied",
		},
	},
});

export const missionPilotRouter = createOpenApiRouter()
	.openapi(
		getMissionPilotDetailRoute,
		withOpenApiRouteError(getMissionPilotDetailRoute, async (c) =>
			c.json(await getMissionPilotDetail(c.req.param("missionId")), 200),
		),
	)
	.openapi(
		createMissionFromImprovementRoute,
		withOpenApiRouteError(createMissionFromImprovementRoute, async (c) => {
			const result = await createMissionFromProjectEvaluationImprovement({
				repositoryId: c.req.param("repositoryId"),
				request: c.req.valid("json"),
			});
			return result.created ? c.json(result, 201) : c.json(result, 200);
		}),
	)
	.openapi(
		requestApprovalRoute,
		withOpenApiRouteError(requestApprovalRoute, async (c) => {
			const result = await requestMissionApproval({
				missionId: c.req.param("missionId"),
				request: c.req.valid("json"),
			});
			return result.created ? c.json(result, 201) : c.json(result, 200);
		}),
	)
	.openapi(
		approveRoute,
		withOpenApiRouteError(approveRoute, async (c) =>
			c.json(
				await decideMissionApproval({
					missionId: c.req.param("missionId"),
					approvalId: c.req.param("approvalId"),
					decision: "approve",
					request: c.req.valid("json"),
				}),
				200,
			),
		),
	)
	.openapi(
		rejectRoute,
		withOpenApiRouteError(rejectRoute, async (c) =>
			c.json(
				await decideMissionApproval({
					missionId: c.req.param("missionId"),
					approvalId: c.req.param("approvalId"),
					decision: "reject",
					request: c.req.valid("json"),
				}),
				200,
			),
		),
	)
	.openapi(
		materializeRoute,
		withOpenApiRouteError(materializeRoute, async (c) =>
			c.json(
				await materializeMissionTask({
					missionId: c.req.param("missionId"),
					taskCandidateId: c.req.param("taskCandidateId"),
					request: c.req.valid("json"),
				}),
				200,
			),
		),
	)
	.openapi(
		enqueueRoute,
		withOpenApiRouteError(enqueueRoute, async (c) =>
			c.json(
				await enqueueMissionTask({
					missionId: c.req.param("missionId"),
					missionTaskId: c.req.param("missionTaskId"),
					request: c.req.valid("json"),
				}),
				200,
			),
		),
	)
	.openapi(
		startAutopilotRoute,
		withOpenApiRouteError(startAutopilotRoute, async (c) =>
			c.json(
				await startMissionAutopilot({
					missionId: c.req.param("missionId"),
					request: c.req.valid("json"),
				}),
				200,
			),
		),
	)
	.openapi(
		pauseAutopilotRoute,
		withOpenApiRouteError(pauseAutopilotRoute, async (c) =>
			c.json(
				await pauseMissionAutopilot(
					c.req.param("missionId"),
					c.req.valid("json").idempotencyKey,
				),
				200,
			),
		),
	)
	.openapi(
		resumeAutopilotRoute,
		withOpenApiRouteError(resumeAutopilotRoute, async (c) =>
			c.json(
				await resumeMissionAutopilot(
					c.req.param("missionId"),
					c.req.valid("json").idempotencyKey,
				),
				200,
			),
		),
	)
	.openapi(
		revokeAutopilotRoute,
		withOpenApiRouteError(revokeAutopilotRoute, async (c) =>
			c.json(
				await revokeMissionAutopilot(
					c.req.param("missionId"),
					c.req.valid("json").idempotencyKey,
				),
				200,
			),
		),
	)
	.openapi(
		tickAutopilotRoute,
		withOpenApiRouteError(tickAutopilotRoute, async (c) =>
			c.json(
				await tickMissionAutopilot({
					missionId: c.req.param("missionId"),
					idempotencyKey: c.req.valid("json").idempotencyKey,
				}),
				200,
			),
		),
	)
	.openapi(
		syncExecutionRoute,
		withOpenApiRouteError(syncExecutionRoute, async (c) =>
			c.json(
				await syncMissionExecution({
					missionId: c.req.param("missionId"),
					...c.req.valid("json"),
				}),
				200,
			),
		),
	)
	.openapi(
		evaluateRoute,
		withOpenApiRouteError(evaluateRoute, async (c) =>
			c.json(
				await evaluateMission({
					missionId: c.req.param("missionId"),
					...c.req.valid("json"),
				}),
				200,
			),
		),
	)
	.openapi(
		createReplanSuggestionRoute,
		withOpenApiRouteError(createReplanSuggestionRoute, async (c) =>
			c.json(
				await createMissionReplanSuggestion({
					missionId: c.req.param("missionId"),
					...c.req.valid("json"),
				}),
				200,
			),
		),
	)
	.openapi(
		applyReplanRoute,
		withOpenApiRouteError(applyReplanRoute, async (c) =>
			c.json(
				await applyMissionReplan({
					missionId: c.req.param("missionId"),
					suggestionId: c.req.param("suggestionId"),
					...c.req.valid("json"),
				}),
				200,
			),
		),
	);
