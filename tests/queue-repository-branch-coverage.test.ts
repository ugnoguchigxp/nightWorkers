import { describe, expect, it } from "vitest";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";
import * as queueRepo from "../api/modules/queue/queue.repository";

describe("implementation queue repository critical defaults", () => {
	it("persists minimal normal and explicit sequence entries without ambiguous scheduling state", async () => {
		const repository = await nightworkersRepo.createRepository({
			name: `TEST: queue branch ${crypto.randomUUID()}`,
			localPath: process.cwd(),
			branch: "main",
			allowed: true,
		});
		const normalTask = await nightworkersRepo.createTask({
			repositoryId: repository.id,
			title: "TEST: minimal queue defaults",
			status: "ready",
		});
		const normal = await queueRepo.createImplementationQueueEntry({
			taskId: normalTask.id,
			repositoryId: repository.id,
		});
		expect(normal).toMatchObject({
			priority: 0,
			queuePosition: null,
			executionType: "normal",
			executionLockKey: `repository:${repository.id}`,
			sequenceGroupId: null,
			sequenceOrder: null,
			sequenceDependsOnEntryId: null,
			schedulingReason: null,
		});

		const sequenceTask = await nightworkersRepo.createTask({
			repositoryId: repository.id,
			title: "TEST: explicit sequence queue",
			status: "ready",
		});
		const sequence = await queueRepo.createImplementationQueueEntry({
			taskId: sequenceTask.id,
			repositoryId: repository.id,
			executionType: "sequence",
			executionLockKey: "sequence:release",
			sequenceGroupId: "release",
			sequenceOrder: 2,
			sequenceDependsOnEntryId: normal.id,
			schedulingReason: "ordered release",
		});
		expect(sequence).toMatchObject({
			executionType: "sequence",
			executionLockKey: "sequence:release",
			sequenceGroupId: "release",
			sequenceOrder: 2,
			sequenceDependsOnEntryId: normal.id,
			schedulingReason: "ordered release",
		});

		expect(
			await queueRepo.recoverImplementationQueueEntryFromSnapshot(
				crypto.randomUUID(),
				{ status: "queued", leaseVersion: 0 },
				{ status: "failed" },
			),
		).toBeNull();
		expect(
			await queueRepo.refreshImplementationQueueLease({
				entryId: crypto.randomUUID(),
				leaseOwnerId: "missing-owner",
				leaseVersion: 0,
				leaseTtlMs: 1_000,
			}),
		).toBeNull();
		const health = await queueRepo.listImplementationQueueHealthSnapshot();
		expect(health.generatedAt).toBeInstanceOf(Date);
	});
});
