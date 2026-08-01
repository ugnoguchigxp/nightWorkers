import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../api/app";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories, taskMessages, taskRuns, tasks } from "../api/db/schema";
import { AppError } from "../api/lib/errors";
import { registerCodingAgentRunHandlers } from "../api/modules/agentsShare";
import {
	initializeCodingAgentRunHandlers,
	resolveCodingAgentImplementationRequest,
} from "../api/modules/codingAgent";
import { taskOperatorCommandFailureResponse } from "../api/modules/commandDelivery";
import { codingAgentCommandResponseV1Schema } from "../shared/modules/codingAgent";

const repositoryIds: string[] = [];

beforeAll(() => ensureNightWorkersSchema());
afterAll(async () => {
	for (const id of repositoryIds)
		await db.delete(repositories).where(eq(repositories.id, id));
});

async function fixture(objective: string | null = "HTTP commandを検証する") {
	const repositoryId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	repositoryIds.push(repositoryId);
	await db.insert(repositories).values({
		id: repositoryId,
		name: "Coding Agent command HTTP",
		localPath: "/tmp/coding-agent-command-http",
		branch: "main",
	});
	const [task] = await db
		.insert(tasks)
		.values({
			id: taskId,
			repositoryId,
			title: "Coding Agent command HTTP",
			objective,
			status: "ready",
		})
		.returning();
	if (!task) throw new Error("Task fixture was not created");
	return task;
}

function command(taskId: string, expectedTaskRevision: number) {
	const requestId = crypto.randomUUID();
	return {
		version: 1,
		type: "coding_agent.command.execute",
		requestId,
		idempotencyKey: requestId,
		taskId,
		actionId: "run.implementation.start",
		expectedTaskRevision,
		arguments: {},
	};
}

describe("Coding Agent command HTTP adapter", () => {
	it("documents the shared request and response contract", async () => {
		const response = await app.request("/api/doc");
		expect(response.status).toBe(200);
		const document = (await response.json()) as {
			paths?: Record<string, Record<string, unknown>>;
		};
		const operation = document.paths?.["/api/coding-agent/commands"]?.post;
		expect(operation).toBeDefined();
		expect(JSON.stringify(operation)).toContain("coding_agent.command.execute");
		expect(JSON.stringify(operation)).toContain("coding_agent.command.result");
	});

	it("returns a typed revision conflict without starting a Run", async () => {
		const task = await fixture();
		const response = await app.request("/api/coding-agent/commands", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: "http://localhost:39174",
				"x-nightworkers-e2e": "1",
			},
			body: JSON.stringify(command(task.id, task.revision + 1)),
		});
		expect(response.status).toBe(409);
		const payload = codingAgentCommandResponseV1Schema.parse(
			await response.json(),
		);
		expect(payload.result).toMatchObject({
			ok: false,
			error: {
				kind: "revision_conflict",
				code: "TASK_REVISION_CONFLICT",
				currentRevision: task.revision,
			},
		});
	});

	it("executes a valid command once and replays the same delivery", async () => {
		const task = await fixture();
		const runId = crypto.randomUUID();
		const request = command(task.id, task.revision);
		const unregisterCurrent = initializeCodingAgentRunHandlers();
		unregisterCurrent();
		let starts = 0;
		const unregisterFake = registerCodingAgentRunHandlers({
			start: async () => {
				starts += 1;
				return { taskId: task.id, runId, status: "running" };
			},
			resume: async () => ({ taskId: task.id, runId, status: "running" }),
		});
		try {
			const responses = [];
			for (let index = 0; index < 2; index += 1) {
				const response = await app.request("/api/coding-agent/commands", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: "http://localhost:39174",
						"x-nightworkers-e2e": "1",
					},
					body: JSON.stringify(request),
				});
				expect(response.status).toBe(200);
				responses.push(
					codingAgentCommandResponseV1Schema.parse(await response.json()),
				);
			}
			expect(starts).toBe(1);
			expect(responses[0].result).toMatchObject({
				ok: true,
				receipt: { replayed: false },
				data: { taskId: task.id, runId },
			});
			expect(responses[1].result).toMatchObject({
				ok: true,
				receipt: { replayed: true },
			});
			const conflict = await app.request("/api/coding-agent/commands", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: "http://localhost:39174",
					"x-nightworkers-e2e": "1",
				},
				body: JSON.stringify({
					...request,
					arguments: { request: "different request" },
				}),
			});
			expect(conflict.status).toBe(409);
			expect(
				codingAgentCommandResponseV1Schema.parse(await conflict.json()).result,
			).toMatchObject({
				ok: false,
				error: { kind: "idempotency_conflict" },
			});
			expect(starts).toBe(1);
		} finally {
			unregisterFake();
			initializeCodingAgentRunHandlers();
		}
	});

	it("normalizes request validation failures to the command response", async () => {
		const response = await app.request("/api/coding-agent/commands", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: "http://localhost:39174",
				"x-nightworkers-e2e": "1",
			},
			body: JSON.stringify({ type: "coding_agent.command.execute" }),
		});
		expect(response.status).toBe(400);
		const payload = codingAgentCommandResponseV1Schema.parse(
			await response.json(),
		);
		expect(payload.result).toMatchObject({
			ok: false,
			error: { kind: "schema_validation" },
		});
	});

	it("replays an omitted-request command before resolving mutable defaults", async () => {
		const task = await fixture("Old objective");
		const previousRunAt = new Date(Date.now() - 20_000);
		const [previousRun] = await db
			.insert(taskRuns)
			.values({
				taskId: task.id,
				repositoryId: task.repositoryId,
				status: "failed",
				workerKind: "native-api",
				createdAt: previousRunAt,
				updatedAt: previousRunAt,
			})
			.returning();
		if (!previousRun) throw new Error("Previous Run fixture was not created");
		await db.insert(taskMessages).values({
			taskId: task.id,
			role: "user",
			content: "Retry with the latest fixes",
			messageType: "text",
			createdAt: new Date(previousRun.updatedAt.getTime() + 1_000),
		});
		const request = command(task.id, task.revision);
		const runId = crypto.randomUUID();
		const instructions: string[] = [];
		const unregisterCurrent = initializeCodingAgentRunHandlers();
		unregisterCurrent();
		const unregisterFake = registerCodingAgentRunHandlers({
			start: async (input) => {
				instructions.push(input.instruction);
				await db.insert(taskRuns).values({
					id: runId,
					taskId: task.id,
					repositoryId: task.repositoryId,
					status: "running",
					workerKind: "native-api",
				});
				return { taskId: task.id, runId, status: "running" };
			},
			resume: async () => ({ taskId: task.id, runId, status: "running" }),
		});
		try {
			const first = await app.request("/api/coding-agent/commands", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: "http://localhost:39174",
					"x-nightworkers-e2e": "1",
				},
				body: JSON.stringify(request),
			});
			const replay = await app.request("/api/coding-agent/commands", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: "http://localhost:39174",
					"x-nightworkers-e2e": "1",
				},
				body: JSON.stringify(request),
			});

			expect(first.status).toBe(200);
			expect(replay.status).toBe(200);
			expect(instructions).toEqual(["Retry with the latest fixes"]);
			expect(
				codingAgentCommandResponseV1Schema.parse(await replay.json()).result,
			).toMatchObject({ ok: true, receipt: { replayed: true } });
		} finally {
			unregisterFake();
			initializeCodingAgentRunHandlers();
		}
	});

	it("preserves the three-stage default implementation request resolution", async () => {
		const objectiveTask = await fixture("Task objective");
		await expect(
			resolveCodingAgentImplementationRequest(objectiveTask.id),
		).resolves.toBe("Task objective");

		const fallbackTask = await fixture(null);
		await expect(
			resolveCodingAgentImplementationRequest(fallbackTask.id),
		).resolves.toBe(
			`Task「${fallbackTask.title}」を実装し、検証まで完了してください。`,
		);

		const retryTask = await fixture("Old objective");
		const [run] = await db
			.insert(taskRuns)
			.values({
				taskId: retryTask.id,
				repositoryId: retryTask.repositoryId,
				status: "failed",
				workerKind: "native-api",
			})
			.returning();
		if (!run) throw new Error("Run fixture was not created");
		await db.insert(taskMessages).values({
			taskId: retryTask.id,
			role: "user",
			content: "  最新の修正依頼  ",
			messageType: "text",
			createdAt: new Date(run.updatedAt.getTime() + 1_000),
		});
		await expect(
			resolveCodingAgentImplementationRequest(retryTask.id),
		).resolves.toBe("最新の修正依頼");
	});
});

describe("Coding Agent command failure normalization", () => {
	it("exposes the current Todo revision through the shared failure contract", () => {
		expect(
			taskOperatorCommandFailureResponse(
				new AppError(409, "TODO_REVISION_CONFLICT", "stale", {
					currentTodoRevision: 7,
				}),
			),
		).toMatchObject({
			statusCode: 409,
			failure: { kind: "revision_conflict", currentRevision: 7 },
		});
	});

	it("maps unsupported application status codes to a documented HTTP status", () => {
		expect(
			taskOperatorCommandFailureResponse(
				new AppError(418, "COMMAND_PRECONDITION", "not ready"),
			).statusCode,
		).toBe(400);
	});
});
