import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { apiErrorOpenApiResponse } from "../../../../shared/schemas/api-error.schema";
import { serializeApiError } from "../../../lib/api-error-response";
import { NotFoundError } from "../../../lib/errors";
import { createOpenApiRouter } from "../../../lib/openapi";
import * as queueRepo from "../../queue/queue-repository-commands";
import { appendActivityEvent } from "../nightworkers.activity-persistence.repository";
import * as repo from "../nightworkers.repository";
import * as verificationRepo from "../nightworkers.verification.repository";

function notFound(message = "Not found") {
	return serializeApiError(new NotFoundError(message)).body;
}

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
		404: apiErrorOpenApiResponse("Task not found or route unavailable"),
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
		404: apiErrorOpenApiResponse("Route unavailable"),
	},
});

const createTaskSchedulingFixtureRoute = createRoute({
	method: "post",
	path: "/e2e/fixtures/task-scheduling",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						taskId: z.string().uuid(),
						scheduling: z.record(z.string(), z.unknown()),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ messageId: z.string().uuid() }),
				},
			},
			description: "Create isolated E2E scheduling fixture.",
		},
		404: apiErrorOpenApiResponse("Route unavailable"),
	},
});

const readQueueEntryFixtureRoute = createRoute({
	method: "post",
	path: "/e2e/fixtures/queue-entry",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({ entryIds: z.array(z.string().uuid()) }),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ entries: z.array(z.unknown()) }),
				},
			},
			description: "Read isolated E2E queue fixtures.",
		},
		404: apiErrorOpenApiResponse("Route unavailable"),
	},
});

const createActivityFixtureRoute = createRoute({
	method: "post",
	path: "/e2e/fixtures/activity-events",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						taskId: z.string().uuid(),
						sequences: z.array(z.number().int()),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": { schema: z.object({ count: z.number() }) },
			},
			description: "Create isolated E2E activity fixtures.",
		},
		404: apiErrorOpenApiResponse("Route unavailable"),
	},
});

export const e2eFixtureRouter = createOpenApiRouter()
	.openapi(createTaskMarkdownFixtureRoute, async (c) => {
		if (
			process.env.NIGHTWORKERS_E2E_ISOLATED !== "1" ||
			c.req.header("x-nightworkers-e2e") !== "1"
		) {
			return c.json(notFound(), 404);
		}
		const input = c.req.valid("json");
		if (!(await repo.getTask(input.taskId))) {
			return c.json(notFound("Task not found"), 404);
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
			return c.json(notFound(), 404);
		}
		const { taskId } = c.req.valid("json");
		const document =
			await verificationRepo.getLatestVerificationDocumentForTask(taskId);
		if (!document) return c.json(notFound(), 404);
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
	.openapi(createTaskSchedulingFixtureRoute, async (c) => {
		if (
			process.env.NIGHTWORKERS_E2E_ISOLATED !== "1" ||
			c.req.header("x-nightworkers-e2e") !== "1"
		) {
			return c.json(notFound(), 404);
		}
		const input = c.req.valid("json");
		if (!(await repo.getTask(input.taskId)))
			return c.json(notFound("Task not found"), 404);
		const message = await repo.createTaskMessage({
			taskId: input.taskId,
			role: "system",
			content: "E2E scheduling fixture",
			messageType: "text",
			payloadJson: { intakeJobSelection: { scheduling: input.scheduling } },
		});
		return c.json({ messageId: message.id }, 201);
	})
	.openapi(readQueueEntryFixtureRoute, async (c) => {
		if (
			process.env.NIGHTWORKERS_E2E_ISOLATED !== "1" ||
			c.req.header("x-nightworkers-e2e") !== "1"
		) {
			return c.json(notFound(), 404);
		}
		const { entryIds } = c.req.valid("json");
		const entries = await Promise.all(
			entryIds.map((entryId) => queueRepo.getImplementationQueueEntry(entryId)),
		);
		return c.json({ entries: entries.filter(Boolean) }, 200);
	})
	.openapi(createActivityFixtureRoute, async (c) => {
		if (
			process.env.NIGHTWORKERS_E2E_ISOLATED !== "1" ||
			c.req.header("x-nightworkers-e2e") !== "1"
		) {
			return c.json(notFound(), 404);
		}
		const input = c.req.valid("json");
		if (!(await repo.getTask(input.taskId)))
			return c.json(notFound("Task not found"), 404);
		for (const sequence of input.sequences) {
			await appendActivityEvent({
				taskId: input.taskId,
				kind: "fixture.replay",
				source: "e2e",
				status: "completed",
				text: `fixture ${sequence}`,
				payloadJson: { fixtureSequence: sequence },
				dedupeKey: `e2e-fixture-${input.taskId}-${sequence}`,
			});
		}
		return c.json({ count: input.sequences.length }, 201);
	});
