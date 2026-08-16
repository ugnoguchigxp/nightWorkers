import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { apiErrorOpenApiResponse } from "../../../../shared/schemas/api-error.schema";
import { serializeApiError } from "../../../lib/api-error-response";
import { NotFoundError } from "../../../lib/errors";
import { createOpenApiRouter } from "../../../lib/openapi";
import * as taskGenerationRepo from "../../taskGeneration/task-generation.repository";
import { buildProjectSignalSnapshot } from "../../taskGeneration/task-generation-signal.service";
import * as repo from "../nightworkers.repository";

function notFound(message = "Not found") {
	return serializeApiError(new NotFoundError(message)).body;
}

const createMissionCandidatesFixtureRoute = createRoute({
	method: "post",
	path: "/e2e/fixtures/mission-candidates",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						repositoryId: z.string().uuid(),
						goalId: z.string().uuid(),
						candidates: z.array(
							z.object({
								title: z.string().min(1),
								summary: z.string().min(1),
								rationale: z.string().min(1),
								taskPrompt: z.string().min(1),
								acceptanceCriteria: z.string().min(1),
								verificationPlan: z.string().min(1),
								status: z.enum(["candidate", "selected", "dismissed"]),
							}),
						),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({
						batchId: z.string().uuid(),
						candidateIds: z.array(z.string().uuid()),
					}),
				},
			},
			description: "Create isolated Mission candidate fixtures.",
		},
		404: apiErrorOpenApiResponse("Route unavailable"),
	},
});

export const missionCandidatesFixtureRouter = createOpenApiRouter().openapi(
	createMissionCandidatesFixtureRoute,
	async (c) => {
		if (
			process.env.NIGHTWORKERS_E2E_ISOLATED !== "1" ||
			c.req.header("x-nightworkers-e2e") !== "1"
		) {
			return c.json(notFound(), 404);
		}
		const input = c.req.valid("json");
		const repository = await repo.getRepository(input.repositoryId);
		const goal = await taskGenerationRepo.getMissionGoal(input.goalId);
		if (!repository || !goal || goal.repositoryId !== repository.id) {
			return c.json(notFound("Repository or goal not found"), 404);
		}
		const signalSnapshot = await buildProjectSignalSnapshot({
			repository,
			goals: [goal],
		});
		const batch = await taskGenerationRepo.createRunningMissionBatch({
			repositoryId: input.repositoryId,
			requestedGoalIds: [input.goalId],
			signalSnapshot,
		});
		const candidates = await taskGenerationRepo.createMissionCandidates(
			input.candidates.map((candidate) => ({
				batchId: batch.id,
				repositoryId: input.repositoryId,
				goalId: input.goalId,
				candidateKind: "feature_followup",
				secondaryModulesJson: [],
				routingConfidencePercent: 100,
				constraintGoalIdsJson: [input.goalId],
				planModeOpenQuestionsJson: [],
				title: candidate.title,
				summary: candidate.summary,
				rationale: candidate.rationale,
				evidenceJson: [],
				importancePercent: 90,
				confidencePercent: 95,
				tokenSize: "small",
				complexity: "simple",
				taskPrompt: candidate.taskPrompt,
				acceptanceCriteria: candidate.acceptanceCriteria,
				verificationPlan: candidate.verificationPlan,
				status: candidate.status,
			})),
		);
		await taskGenerationRepo.completeMissionBatch({
			batchId: batch.id,
			rawOutput: { fixture: true },
			selectedModel: { provider: "fixture" },
		});
		return c.json(
			{
				batchId: batch.id,
				candidateIds: candidates.map((candidate) => candidate.id),
			},
			201,
		);
	},
);
