import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";
import * as queueRepo from "../api/modules/queue/queue.repository";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

async function createQueueFixture() {
	const repository = await nightworkersRepo.createRepository({
		name: `TEST: Queue entry transition ${crypto.randomUUID()}`,
		localPath: "/Users/y.noguchi/Code/nightWorkers",
		branch: "main",
	});
	const task = await nightworkersRepo.createTask({
		repositoryId: repository.id,
		title: `TEST: Queue entry transition ${crypto.randomUUID()}`,
		description: "Queue transition fixture",
		objective: "Keep queue leases and task projection consistent",
		acceptanceCriteria: "CAS transitions leave no ghost processing state",
		status: "queued",
	});
	const entry = await queueRepo.createImplementationQueueEntry({
		taskId: task.id,
		repositoryId: repository.id,
	});
	return { task, entry };
}

describe("Queue entry state transitions", () => {
	it("cancels a queued entry and restores its Task projection atomically", async () => {
		const fixture = await createQueueFixture();
		const result = await queueRepo.cancelImplementationQueueEntryWithoutRun({
			entry: {
				id: fixture.entry.id,
				expectedStatus: "queued",
				expectedLeaseVersion: fixture.entry.leaseVersion,
				expectedActiveRunId: null,
			},
			task: {
				id: fixture.task.id,
				expectedStatus: "queued",
				expectedUpdatedAt: fixture.task.updatedAt,
			},
		});
		expect(result).toMatchObject({
			kind: "applied",
			entry: {
				status: "cancelled",
				processorSlot: null,
				leaseOwnerId: null,
				leaseVersion: fixture.entry.leaseVersion + 1,
			},
			task: {
				status: "ready",
				revision: fixture.task.revision,
			},
		});
	});

	it("does not let a stale cancel overwrite a new Queue lease or Task snapshot", async () => {
		const fixture = await createQueueFixture();
		await queueRepo.updateImplementationQueueEntry(fixture.entry.id, {
			status: "claimed",
			leaseOwnerId: "other-worker",
			leaseVersion: fixture.entry.leaseVersion + 1,
		});
		const result = await queueRepo.cancelImplementationQueueEntryWithoutRun({
			entry: {
				id: fixture.entry.id,
				expectedStatus: "queued",
				expectedLeaseVersion: fixture.entry.leaseVersion,
				expectedActiveRunId: null,
			},
			task: {
				id: fixture.task.id,
				expectedStatus: "queued",
				expectedUpdatedAt: fixture.task.updatedAt,
			},
		});
		expect(result).toMatchObject({
			kind: "conflict",
			entry: { status: "claimed", leaseOwnerId: "other-worker" },
			task: { status: "queued" },
		});
	});

	it("resumes a Run-less human-blocked entry as claimable queued work", async () => {
		const fixture = await createQueueFixture();
		const blocked = await queueRepo.updateImplementationQueueEntry(
			fixture.entry.id,
			{
				status: "needs_human",
				processorSlot: 1,
				leaseOwnerId: "previous-worker",
				leaseAcquiredAt: new Date(),
				leaseExpiresAt: new Date(Date.now() + 60_000),
				leaseVersion: fixture.entry.leaseVersion + 1,
				claimReady: false,
			},
		);
		if (!blocked) throw new Error("Queue fixture was not updated");
		const result = await queueRepo.resumeImplementationQueueEntryWithoutRun({
			id: blocked.id,
			expectedStatus: blocked.status,
			expectedLeaseVersion: blocked.leaseVersion,
			expectedActiveRunId: null,
		});
		expect(result).toMatchObject({
			kind: "applied",
			entry: {
				status: "queued",
				activeRunId: null,
				processorSlot: null,
				leaseOwnerId: null,
				claimReady: true,
				leaseVersion: blocked.leaseVersion + 1,
			},
		});
	});
});
