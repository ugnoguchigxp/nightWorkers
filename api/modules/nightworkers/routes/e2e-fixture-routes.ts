import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { createOpenApiRouter } from "../../../lib/openapi";
import * as repo from "../nightworkers.repository";
import * as verificationRepo from "../nightworkers.verification.repository";
import * as taskGenerationRepo from "../../taskGeneration/task-generation.repository";

const createTaskMarkdownFixtureRoute = createRoute({
	method: "post",
	path: "/e2e/fixtures/task-markdown",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						taskId: z.string().uuid(),
						content: z.string().min(1),
						intent: z.enum(["implementation_plan", "feature_plan"]),
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
						messageId: z.string().uuid(),
						specArtifactId: z.string(),
					}),
				},
			},
			description: "Create an isolated E2E markdown fixture.",
		},
		404: { description: "Task not found or route unavailable" },
	},
});

const readTaskVerificationSummaryRoute = createRoute({
	method: "post",
	path: "/e2e/fixtures/task-verification-summary",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({ taskId: z.string().uuid() }),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						documents: z.number(),
						documentStatuses: z.string().nullable(),
						evidenceRuns: z.number(),
						checklistItems: z.number(),
						checklistStatuses: z.string().nullable(),
						completedItems: z.number(),
					}),
				},
			},
			description: "Read isolated E2E verification evidence.",
		},
		404: { description: "Route unavailable" },
	},
});

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
		404: { description: "Route unavailable" },
	},
});

export const e2eFixtureRouter = createOpenApiRouter()
	.openapi(createTaskMarkdownFixtureRoute, async (c) => {
		if (
			process.env.NIGHTWORKERS_E2E_ISOLATED !== "1" ||
			c.req.header("x-nightworkers-e2e") !== "1"
		) {
			return c.json({ error: "Not found" }, 404);
		}
		const input = c.req.valid("json");
		if (!(await repo.getTask(input.taskId))) {
			return c.json({ error: "Task not found" }, 404);
		}
		const message = await repo.createTaskMessage({
			taskId: input.taskId,
			role: "assistant",
			content: input.content,
			messageType: "markdown_document",
			payloadJson: { intent: input.intent },
		});
		return c.json(
			{
				messageId: message.id,
				specArtifactId: `${input.intent === "implementation_plan" ? "implementation-plan" : "feature-plan"}-${message.id}`,
			},
			201,
		);
	})
	.openapi(readTaskVerificationSummaryRoute, async (c) => {
		if (
			process.env.NIGHTWORKERS_E2E_ISOLATED !== "1" ||
			c.req.header("x-nightworkers-e2e") !== "1"
		) {
			return c.json({ error: "Not found" }, 404);
		}
		const { taskId } = c.req.valid("json");
		const document =
			await verificationRepo.getLatestVerificationDocumentForTask(taskId);
		if (!document) return c.json({ error: "Not found" }, 404);
		const [items, evidenceRuns] = await Promise.all([
			verificationRepo.listVerificationChecklistItems(document.id),
			verificationRepo.listVerificationEvidenceRunsForTask(taskId),
		]);
		return c.json(
			{
				documents: 1,
				documentStatuses: document.status,
				evidenceRuns: evidenceRuns.length,
				checklistItems: items.length,
				checklistStatuses: items.map((item) => item.status).join(","),
				completedItems: items.filter((item) =>
					["passed", "covered", "manual", "not_applicable"].includes(
						item.status,
					),
				).length,
			},
			200,
		);
	})
	.openapi(createMissionCandidatesFixtureRoute, async (c) => {
		if (
			process.env.NIGHTWORKERS_E2E_ISOLATED !== "1" ||
			c.req.header("x-nightworkers-e2e") !== "1"
		) {
			return c.json({ error: "Not found" }, 404);
		}
		const input = c.req.valid("json");
		const batch = await taskGenerationRepo.createRunningMissionBatch({
			repositoryId: input.repositoryId,
			requestedGoalIds: [input.goalId],
			signalSnapshot: {},
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
	});
