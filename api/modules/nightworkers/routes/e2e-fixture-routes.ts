import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { createOpenApiRouter } from "../../../lib/openapi";
import * as missionPilotRepo from "../../missionPilot/mission-pilot.repository";
import * as queueRepo from "../../queue/queue-repository-commands";
import { appendActivityEvent } from "../nightworkers.activity-persistence.repository";
import * as repo from "../nightworkers.repository";
import {
	codingAgentChatTrace,
	missionPilotThoughtTrace,
} from "../nightworkers.trace-provenance";
import * as verificationRepo from "../nightworkers.verification.repository";

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
		404: { description: "Route unavailable" },
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
		404: { description: "Route unavailable" },
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
		404: { description: "Route unavailable" },
	},
});

const createTraceFixtureRoute = createRoute({
	method: "post",
	path: "/e2e/fixtures/trace-events",
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
		201: {
			content: {
				"application/json": {
					schema: z.object({ sessionId: z.string().uuid() }),
				},
			},
			description: "Create isolated Mission Pilot trace fixtures.",
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
	.openapi(createTaskSchedulingFixtureRoute, async (c) => {
		if (
			process.env.NIGHTWORKERS_E2E_ISOLATED !== "1" ||
			c.req.header("x-nightworkers-e2e") !== "1"
		) {
			return c.json({ error: "Not found" }, 404);
		}
		const input = c.req.valid("json");
		if (!(await repo.getTask(input.taskId)))
			return c.json({ error: "Task not found" }, 404);
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
			return c.json({ error: "Not found" }, 404);
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
			return c.json({ error: "Not found" }, 404);
		}
		const input = c.req.valid("json");
		if (!(await repo.getTask(input.taskId)))
			return c.json({ error: "Task not found" }, 404);
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
	})
	.openapi(createTraceFixtureRoute, async (c) => {
		if (
			process.env.NIGHTWORKERS_E2E_ISOLATED !== "1" ||
			c.req.header("x-nightworkers-e2e") !== "1"
		) {
			return c.json({ error: "Not found" }, 404);
		}
		const { taskId } = c.req.valid("json");
		const session = await missionPilotRepo.getSessionByTaskId(taskId);
		if (!session)
			return c.json({ error: "Mission Pilot session not found" }, 404);
		await appendActivityEvent({
			taskId,
			turnId: "pilot-turn",
			kind: "runtime.decision",
			source: "e2e",
			status: "completed",
			text: "MISSION_PILOT_THOUGHT_ONLY",
			payloadJson: { missionPilotSessionId: session.id },
			dedupeKey: `e2e:pilot:${taskId}`,
			trace: missionPilotThoughtTrace({ sessionId: session.id }),
		});
		await appendActivityEvent({
			taskId,
			turnId: "coding-turn",
			kind: "assistant.message",
			source: "worker",
			status: "completed",
			text: "CODING_AGENT_CHAT_ONLY",
			payloadJson: {},
			dedupeKey: `e2e:coding:${taskId}`,
			trace: codingAgentChatTrace(),
		});
		await repo.createTaskMessage({
			taskId,
			role: "assistant",
			content: "MISSION_PILOT_ARTIFACT_BODY",
			messageType: "markdown_document",
			payloadJson: { intent: "feature_plan" },
			trace: codingAgentChatTrace(),
		});
		return c.json({ sessionId: session.id }, 201);
	});
