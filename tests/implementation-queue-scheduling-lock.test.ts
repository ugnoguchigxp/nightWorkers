import crypto from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { client } from "../api/db/client";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";
import type { TaskExecutionType } from "../api/modules/queue/queue.repository";
import * as queueRepo from "../api/modules/queue/queue.repository";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

let createdRepositoryIds: string[] = [];

afterEach(async () => {
	for (const id of createdRepositoryIds.reverse()) {
		await nightworkersRepo.deleteRepository(id);
	}
	createdRepositoryIds = [];
});

async function createRepository() {
	const repository = await nightworkersRepo.createRepository({
		name: `TEST: Scheduling ${crypto.randomUUID()}`,
		localPath: "/Users/y.noguchi/Code/nightWorkers",
		branch: "main",
	});
	createdRepositoryIds.push(repository.id);
	return repository;
}

async function createEntry(input: {
	repositoryId: string;
	title?: string;
	priority?: number;
	executionType?: TaskExecutionType;
	sequenceGroupId?: string | null;
	sequenceOrder?: number | null;
	claimReady?: boolean;
}) {
	const priority = 1_500_000_000 + (input.priority ?? 0);
	const task = await nightworkersRepo.createTask({
		repositoryId: input.repositoryId,
		title: input.title ?? `TEST: Queue scheduling ${crypto.randomUUID()}`,
		description: "Queue scheduling fixture",
		objective: "Exercise scheduling lock behavior",
		acceptanceCriteria: "Claim order is deterministic",
		status: "queued",
		priority,
	});
	const entry = await queueRepo.createImplementationQueueEntry({
		taskId: task.id,
		repositoryId: input.repositoryId,
		priority,
		executionType: input.executionType ?? "normal",
		executionLockKey: `repository:${input.repositoryId}`,
		sequenceGroupId: input.sequenceGroupId ?? null,
		sequenceOrder: input.sequenceOrder ?? null,
		schedulingReason: "test fixture",
		claimReady: input.claimReady,
	});
	return { task, entry };
}

async function claim(owner: string, candidateLimit?: number) {
	return queueRepo.claimNextImplementationQueueEntry({
		processorCount: 1_000,
		leaseOwnerId: owner,
		leaseTtlMs: 60_000,
		now: new Date("2026-07-03T04:00:00.000Z"),
		candidateLimit,
	});
}

function expectClaimed(result: Awaited<ReturnType<typeof claim>>) {
	expect(result.kind).toBe("claimed");
	if (result.kind !== "claimed") throw new Error("Expected queue claim");
	return result.entry;
}

describe("Implementation Queue scheduling locks", () => {
	it("keeps held Mission work unclaimed without blocking ready normal work", async () => {
		const repository = await createRepository();
		const held = await createEntry({
			repositoryId: repository.id,
			priority: 100,
			executionType: "exclusive",
			claimReady: false,
		});
		const normal = await createEntry({
			repositoryId: repository.id,
			priority: 1,
		});

		expect(expectClaimed(await claim("claim-ready-normal")).id).toBe(
			normal.entry.id,
		);
		await expect(
			queueRepo.getImplementationQueueEntrySchedulingHealth(held.entry),
		).resolves.toMatchObject({ schedulingBlockedReason: "claim_not_ready" });
	});

	it("claims multiple normal tasks from the same repository within processor capacity", async () => {
		const repository = await createRepository();
		const first = await createEntry({
			repositoryId: repository.id,
			priority: 10,
		});
		const second = await createEntry({
			repositoryId: repository.id,
			priority: 9,
		});

		expect(expectClaimed(await claim("normal-a")).id).toBe(first.entry.id);
		expect(expectClaimed(await claim("normal-b")).id).toBe(second.entry.id);
	});

	it("lets a ready exclusive task drain before new normal work on the same lock key", async () => {
		const repository = await createRepository();
		await createEntry({ repositoryId: repository.id, priority: 100 });
		const exclusive = await createEntry({
			repositoryId: repository.id,
			priority: 1,
			executionType: "exclusive",
		});

		const claimed = expectClaimed(await claim("exclusive-ready"));
		expect(claimed.id).toBe(exclusive.entry.id);
		expect(claimed.executionType).toBe("exclusive");
	});

	it("blocks exclusive work while a normal task is active and claims it after drain", async () => {
		const repository = await createRepository();
		const normal = await createEntry({
			repositoryId: repository.id,
			priority: 20,
		});
		const normalClaim = expectClaimed(await claim("active-normal"));
		expect(normalClaim.id).toBe(normal.entry.id);
		const exclusive = await createEntry({
			repositoryId: repository.id,
			priority: 10,
			executionType: "exclusive",
		});

		await expect(claim("exclusive-blocked", 1)).resolves.toMatchObject({
			kind: "not_claimed",
			reason: "blocked_by_lock",
			skipped: [
				expect.objectContaining({
					entryId: exclusive.entry.id,
					reason: "exclusive_waiting_for_active_tasks",
				}),
			],
		});

		await queueRepo.updateImplementationQueueEntry(normal.entry.id, {
			status: "execution_completed",
			processorSlot: null,
			leaseOwnerId: null,
			leaseExpiresAt: null,
		});

		expect(expectClaimed(await claim("exclusive-after-drain")).id).toBe(
			exclusive.entry.id,
		);
	});

	it("treats legacy null execution lock keys as the repository default lock", async () => {
		const repository = await createRepository();
		const normal = await createEntry({
			repositoryId: repository.id,
			priority: 20,
		});
		const normalClaim = expectClaimed(await claim("legacy-null-lock-active"));
		expect(normalClaim.id).toBe(normal.entry.id);
		await client.execute({
			sql: "UPDATE implementation_queue_entries SET execution_lock_key = NULL WHERE id = ?",
			args: [normal.entry.id],
		});
		const exclusive = await createEntry({
			repositoryId: repository.id,
			priority: 10,
			executionType: "exclusive",
		});

		await expect(claim("legacy-null-lock-exclusive", 1)).resolves.toMatchObject(
			{
				kind: "not_claimed",
				reason: "blocked_by_lock",
				skipped: [
					expect.objectContaining({
						entryId: exclusive.entry.id,
						reason: "exclusive_waiting_for_active_tasks",
					}),
				],
			},
		);
	});

	it("skips a blocked priority head and claims a later candidate in the window", async () => {
		const blockedRepository = await createRepository();
		const freeRepository = await createRepository();
		const active = await createEntry({
			repositoryId: blockedRepository.id,
			priority: 300,
		});
		expect(expectClaimed(await claim("head-active")).id).toBe(active.entry.id);
		const blockedExclusive = await createEntry({
			repositoryId: blockedRepository.id,
			priority: 250,
			executionType: "exclusive",
		});
		const freeNormal = await createEntry({
			repositoryId: freeRepository.id,
			priority: 1,
		});

		const claimed = expectClaimed(await claim("skip-head", 2));
		expect(claimed.id).toBe(freeNormal.entry.id);
		expect(claimed.id).not.toBe(blockedExclusive.entry.id);
	});

	it("claims sequence tasks only after the predecessor has completed", async () => {
		const repository = await createRepository();
		const sequenceGroupId = `sequence:${crypto.randomUUID()}`;
		const second = await createEntry({
			repositoryId: repository.id,
			priority: 100,
			executionType: "sequence",
			sequenceGroupId,
			sequenceOrder: 2,
		});
		const first = await createEntry({
			repositoryId: repository.id,
			priority: 1,
			executionType: "sequence",
			sequenceGroupId,
			sequenceOrder: 1,
		});

		expect(expectClaimed(await claim("sequence-first")).id).toBe(
			first.entry.id,
		);
		await expect(claim("sequence-second-blocked", 1)).resolves.toMatchObject({
			kind: "not_claimed",
			reason: "blocked_by_lock",
			skipped: [
				expect.objectContaining({
					entryId: second.entry.id,
					reason: "sequence_predecessor_pending",
				}),
			],
		});
		await queueRepo.updateImplementationQueueEntry(first.entry.id, {
			status: "execution_completed",
			processorSlot: null,
			leaseOwnerId: null,
			leaseExpiresAt: null,
		});
		expect(expectClaimed(await claim("sequence-second")).id).toBe(
			second.entry.id,
		);
	});

	it("does not claim a sequence successor after a failed predecessor", async () => {
		const repository = await createRepository();
		const sequenceGroupId = `sequence:${crypto.randomUUID()}`;
		const first = await createEntry({
			repositoryId: repository.id,
			priority: 100,
			executionType: "sequence",
			sequenceGroupId,
			sequenceOrder: 1,
		});
		const second = await createEntry({
			repositoryId: repository.id,
			priority: 90,
			executionType: "sequence",
			sequenceGroupId,
			sequenceOrder: 2,
		});

		await queueRepo.updateImplementationQueueEntry(first.entry.id, {
			status: "failed",
		});
		await expect(claim("sequence-failed", 1)).resolves.toMatchObject({
			kind: "not_claimed",
			reason: "blocked_by_lock",
			skipped: [
				expect.objectContaining({
					entryId: second.entry.id,
					reason: "sequence_predecessor_failed",
				}),
			],
		});
	});
});
