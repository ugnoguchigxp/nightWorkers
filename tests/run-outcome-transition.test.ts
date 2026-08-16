import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { taskEvents } from "../api/db/schema";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";
import { createRunEventInTransaction } from "../api/modules/nightworkers/nightworkers.runs-event.repository";
import * as queueRepo from "../api/modules/queue/queue.repository";
import { applyRunOutcomeTransition } from "../api/modules/run/application/run-outcome-transition.command";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

async function createOutcomeFixture() {
	const repository = await nightworkersRepo.createRepository({
		name: `TEST: Run outcome transition ${crypto.randomUUID()}`,
		localPath: "/Users/y.noguchi/Code/nightWorkers",
		branch: "main",
	});
	const task = await nightworkersRepo.createTask({
		repositoryId: repository.id,
		title: `TEST: Run outcome transition ${crypto.randomUUID()}`,
		description: "Run outcome transition fixture",
		objective: "Keep Run, Task, and Queue terminal state consistent",
		acceptanceCriteria: "All three durable rows change together",
		status: "running",
	});
	const run = await nightworkersRepo.createTaskRun({
		taskId: task.id,
		repositoryId: repository.id,
		status: "running",
	});
	const entry = await queueRepo.createImplementationQueueEntry({
		taskId: task.id,
		repositoryId: repository.id,
	});
	const processing = await queueRepo.updateImplementationQueueEntry(entry.id, {
		status: "processing",
		processorSlot: 1,
		activeRunId: run.id,
		leaseOwnerId: "outcome-test",
		leaseAcquiredAt: new Date(),
		leaseExpiresAt: new Date(Date.now() + 60_000),
	});
	if (!processing) throw new Error("Queue fixture was not created");
	return { task, run, entry: processing };
}

describe("Run outcome transition", () => {
	it("atomically projects a terminal Run outcome to its Task and Queue Entry", async () => {
		const fixture = await createOutcomeFixture();
		const applied = await applyRunOutcomeTransition({
			run: {
				id: fixture.run.id,
				expectedStatuses: ["running"],
				expectedUpdatedAt: fixture.run.updatedAt,
				targetStatus: "failed",
				patch: { summary: "Run failed." },
			},
			task: {
				id: fixture.task.id,
				expectedStatus: "running",
				expectedUpdatedAt: fixture.task.updatedAt,
				targetStatus: "failed",
			},
		});

		expect(applied).toMatchObject({
			kind: "applied",
			run: { status: "failed" },
			task: { status: "failed", revision: fixture.task.revision },
			queueEntry: {
				id: fixture.entry.id,
				status: "failed",
				processorSlot: null,
				leaseOwnerId: null,
			},
		});
	});

	it("rolls back the Run transition when the Task projection snapshot is stale", async () => {
		const fixture = await createOutcomeFixture();
		await nightworkersRepo.updateTask(fixture.task.id, {
			status: "needs_review",
		});

		await expect(
			applyRunOutcomeTransition({
				run: {
					id: fixture.run.id,
					expectedStatuses: ["running"],
					expectedUpdatedAt: fixture.run.updatedAt,
					targetStatus: "failed",
				},
				task: {
					id: fixture.task.id,
					expectedStatus: "running",
					expectedUpdatedAt: fixture.task.updatedAt,
					targetStatus: "failed",
				},
			}),
		).rejects.toMatchObject({ code: "RUN_OUTCOME_CONFLICT" });
		await expect(
			nightworkersRepo.getTaskRun(fixture.run.id),
		).resolves.toMatchObject({ status: "running" });
		await expect(
			queueRepo.getImplementationQueueEntry(fixture.entry.id),
		).resolves.toMatchObject({ status: "processing", processorSlot: 1 });
	});

	it("rolls back Run, Task, Queue, and transaction-bound events together", async () => {
		const fixture = await createOutcomeFixture();
		await expect(
			applyRunOutcomeTransition({
				run: {
					id: fixture.run.id,
					expectedStatuses: ["running"],
					expectedUpdatedAt: fixture.run.updatedAt,
					targetStatus: "failed",
				},
				task: {
					id: fixture.task.id,
					expectedStatus: "running",
					expectedUpdatedAt: fixture.task.updatedAt,
					targetStatus: "failed",
				},
				afterApply: async (_outcome, transaction) => {
					await createRunEventInTransaction(
						{
							version: 1,
							runId: fixture.run.id,
							taskId: fixture.task.id,
							timestamp: new Date().toISOString(),
							type: "run.outcome_decided",
							severity: "info",
							actor: "system",
							message: "Must roll back with the outcome.",
							data: {},
						},
						undefined,
						transaction,
					);
					throw new Error("force transaction rollback");
				},
			}),
		).rejects.toThrow("force transaction rollback");
		await expect(
			nightworkersRepo.getTaskRun(fixture.run.id),
		).resolves.toMatchObject({ status: "running" });
		await expect(
			queueRepo.getImplementationQueueEntry(fixture.entry.id),
		).resolves.toMatchObject({ status: "processing", processorSlot: 1 });
		await expect(
			db
				.select()
				.from(taskEvents)
				.where(eq(taskEvents.taskRunId, fixture.run.id)),
		).resolves.toEqual([]);
	});
});
