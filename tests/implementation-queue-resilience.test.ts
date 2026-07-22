import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../api/app";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { client } from "../api/db/client";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";
import * as queueRepo from "../api/modules/queue/queue.repository";
import * as queueService from "../api/modules/queue/queue-management.service";

const sameOriginHeaders = { Origin: "http://localhost:39174" };

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

async function createQueuedEntry(input: { priority?: number } = {}) {
	const repository = await nightworkersRepo.createRepository({
		name: `TEST: Queue Resilience ${crypto.randomUUID()}`,
		localPath: "/Users/y.noguchi/Code/nightWorkers",
		branch: "main",
	});
	const task = await nightworkersRepo.createTask({
		repositoryId: repository.id,
		title: `TEST: Queue task ${crypto.randomUUID()}`,
		description: "Queue resilience fixture",
		objective: "Exercise queue resilience behavior",
		acceptanceCriteria: "Queue state is deterministic",
		status: "queued",
		priority: input.priority ?? 0,
	});
	const entry = await queueRepo.createImplementationQueueEntry({
		taskId: task.id,
		repositoryId: repository.id,
		priority: input.priority ?? task.priority,
	});
	return { repository, task, entry };
}

describe("Implementation Queue resilience repository behavior", () => {
	it("updates a prepared run only while its expected status still matches", async () => {
		const repository = await nightworkersRepo.createRepository({
			name: `TEST: Run CAS ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await nightworkersRepo.createTask({
			repositoryId: repository.id,
			title: `TEST: Run CAS ${crypto.randomUUID()}`,
			description: "Run CAS fixture",
			objective: "Preserve concurrent run status",
			acceptanceCriteria: "Stale updates are rejected",
			status: "running",
		});
		const run = await nightworkersRepo.createTaskRun({
			taskId: task.id,
			repositoryId: repository.id,
			status: "running",
		});

		const heldRun = await nightworkersRepo.updateTaskRunIfStatus(
			run.id,
			"running",
			{ status: "needs_human" },
		);
		expect(heldRun?.status).toBe("needs_human");

		await expect(
			nightworkersRepo.updateTaskRunIfStatus(run.id, "running", {
				status: "cancelled",
			}),
		).resolves.toBeUndefined();
		await expect(nightworkersRepo.getTaskRun(run.id)).resolves.toMatchObject({
			status: "needs_human",
		});
	});

	it("claims one queued entry with a durable lease and respects processor capacity", async () => {
		const first = await createQueuedEntry({ priority: 900_001 });
		await createQueuedEntry({ priority: 900_000 });
		const now = new Date("2026-07-03T00:00:00.000Z");
		const occupiedBefore =
			await queueRepo.listOccupiedImplementationQueueEntries();
		const processorCount = occupiedBefore.length + 1;

		const claimed = await queueRepo.claimNextImplementationQueueEntry({
			processorCount,
			leaseOwnerId: "test-owner",
			leaseTtlMs: 60_000,
			now,
		});

		expect(claimed.kind).toBe("claimed");
		const claimedEntry = claimed.kind === "claimed" ? claimed.entry : null;
		expect(claimedEntry).toMatchObject({
			id: first.entry.id,
			status: "claimed",
			leaseOwnerId: "test-owner",
			leaseAcquiredAt: now,
			leaseExpiresAt: new Date(now.getTime() + 60_000),
			leaseVersion: 1,
			attemptCount: 1,
		});
		expect(claimedEntry?.processorSlot).toBeGreaterThan(0);

		await expect(
			queueRepo.claimNextImplementationQueueEntry({
				processorCount,
				leaseOwnerId: "test-owner-2",
				leaseTtlMs: 60_000,
				now,
			}),
		).resolves.toMatchObject({ kind: "not_claimed", reason: "processor_full" });
	});

	it("only recovers an expired claimed lease when recovery is explicitly allowed", async () => {
		const fixture = await createQueuedEntry({ priority: 901_000 });
		const now = new Date("2026-07-03T01:00:00.000Z");
		const expiredAt = new Date(now.getTime() - 1_000);
		await queueRepo.updateImplementationQueueEntry(fixture.entry.id, {
			status: "claimed",
			processorSlot: 1,
			leaseOwnerId: "dead-owner",
			leaseAcquiredAt: new Date(now.getTime() - 120_000),
			leaseExpiresAt: expiredAt,
			leaseVersion: 4,
			attemptCount: 2,
			claimedAt: new Date(now.getTime() - 120_000),
			lastHeartbeatAt: new Date(now.getTime() - 120_000),
		});

		const notRecovered = await queueRepo.claimNextImplementationQueueEntry({
			processorCount: 1_000,
			leaseOwnerId: "new-owner",
			leaseTtlMs: 60_000,
			now,
			allowExpiredClaimRecovery: false,
		});
		if (notRecovered.kind === "claimed") {
			expect(notRecovered.entry.id).not.toBe(fixture.entry.id);
		}

		const recovered = await queueRepo.claimNextImplementationQueueEntry({
			processorCount: 1_000,
			leaseOwnerId: "new-owner",
			leaseTtlMs: 60_000,
			now,
			allowExpiredClaimRecovery: true,
		});

		expect(recovered.kind).toBe("claimed");
		const recoveredEntry =
			recovered.kind === "claimed" ? recovered.entry : null;
		expect(recoveredEntry).toMatchObject({
			id: fixture.entry.id,
			status: "claimed",
			leaseOwnerId: "new-owner",
			leaseAcquiredAt: now,
			leaseExpiresAt: new Date(now.getTime() + 60_000),
			leaseVersion: 5,
			attemptCount: 3,
			recoveredAt: now,
			recoveryReason: "lease_expired_before_run_start",
		});
	});

	it("releases processor capacity while a run awaits commit decision", async () => {
		const awaiting = await createQueuedEntry({ priority: 2_000_001 });
		const next = await createQueuedEntry({ priority: 2_000_000 });
		const occupiedBefore =
			await queueRepo.listOccupiedImplementationQueueEntries();
		const processorCount = occupiedBefore.length + 1;
		const now = new Date("2026-07-03T01:30:00.000Z");
		const run = await nightworkersRepo.createTaskRun({
			taskId: awaiting.task.id,
			repositoryId: awaiting.repository.id,
			status: "needs_review",
		});
		await queueRepo.updateImplementationQueueEntry(awaiting.entry.id, {
			status: "processing",
			processorSlot: processorCount,
			activeRunId: run.id,
			leaseOwnerId: "review-owner",
			leaseExpiresAt: new Date(now.getTime() + 60_000),
		});

		await expect(
			queueRepo.completeImplementationQueueEntryForRunId({
				runId: run.id,
				runStatus: "needs_review",
				now,
			}),
		).resolves.toMatchObject({
			id: awaiting.entry.id,
			status: "awaiting_commit_decision",
			processorSlot: null,
		});

		const claimed = await queueRepo.claimNextImplementationQueueEntry({
			processorCount,
			leaseOwnerId: "next-owner",
			leaseTtlMs: 60_000,
			now,
		});
		expect(claimed).toMatchObject({
			kind: "claimed",
			entry: { id: next.entry.id },
		});

		const dashboard = await queueService.listImplementationQueueDashboard();
		expect(dashboard.completed).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: awaiting.entry.id,
					status: "awaiting_commit_decision",
				}),
			]),
		);
		expect(
			dashboard.processors.some(
				(processor) => processor.entry?.id === awaiting.entry.id,
			),
		).toBe(false);

		const health = await queueService.listImplementationQueueHealth({ now });
		expect(
			health.items.find((item) => item.entryId === awaiting.entry.id),
		).toMatchObject({
			status: "awaiting_commit_decision",
			classification: "normal",
			recommendedAction: "none",
		});
	});

	it("builds a scoped health snapshot for stale and inconsistent queue entries", async () => {
		const repository = await nightworkersRepo.createRepository({
			name: `TEST: Queue Health ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const now = new Date("2026-07-03T02:00:00.000Z");
		const staleTime = new Date(now.getTime() - 120_000);
		const entries = [];
		for (const status of [
			"queued",
			"claimed",
			"processing",
			"processing",
			"processing",
		] as const) {
			const task = await nightworkersRepo.createTask({
				repositoryId: repository.id,
				title: `TEST: Health ${status} ${crypto.randomUUID()}`,
				description: "Queue health fixture",
				objective: "Classify queue health",
				acceptanceCriteria: "Snapshot classification is deterministic",
				status: "queued",
			});
			entries.push(
				await queueRepo.createImplementationQueueEntry({
					taskId: task.id,
					repositoryId: repository.id,
				}),
			);
		}
		const runningRun = await nightworkersRepo.createTaskRun({
			taskId: entries[2].taskId,
			repositoryId: repository.id,
			status: "running",
		});
		const terminalRun = await nightworkersRepo.createTaskRun({
			taskId: entries[3].taskId,
			repositoryId: repository.id,
			status: "completed",
		});
		await queueRepo.updateImplementationQueueEntry(entries[1].id, {
			status: "claimed",
			leaseExpiresAt: new Date(now.getTime() - 1_000),
			attemptCount: 1,
		});
		await queueRepo.updateImplementationQueueEntry(entries[2].id, {
			status: "processing",
			activeRunId: runningRun.id,
			lastHeartbeatAt: staleTime,
		});
		await queueRepo.updateImplementationQueueEntry(entries[3].id, {
			status: "processing",
			activeRunId: terminalRun.id,
			lastHeartbeatAt: now,
		});
		await client.execute("PRAGMA foreign_keys = OFF");
		try {
			await client.execute({
				sql: "UPDATE implementation_queue_entries SET status = ?, active_run_id = ? WHERE id = ?",
				args: ["processing", crypto.randomUUID(), entries[4].id],
			});
		} finally {
			await client.execute("PRAGMA foreign_keys = ON");
		}

		const snapshot = await queueRepo.listImplementationQueueHealthSnapshot({
			repositoryId: repository.id,
			now,
			staleProcessingMs: 60_000,
			maxAttempts: 3,
		});

		expect(snapshot.counts).toMatchObject({
			queued: 1,
			claimed: 1,
			processing: 3,
			staleClaimed: 1,
			staleProcessing: 1,
			activeRunMissing: 1,
			terminalRunWithActiveQueueEntry: 1,
		});
		expect(snapshot.items.map((item) => item.classification).sort()).toEqual([
			"normal",
			"orphaned_active_run",
			"stale_claim",
			"stale_processing",
			"terminal_run_pending_completion",
		]);
	});

	it("moves claimed entries to processing with lease CAS and completes terminal runs idempotently", async () => {
		const fixture = await createQueuedEntry({ priority: 902_000 });
		const now = new Date("2026-07-03T03:00:00.000Z");
		const claimed = await queueRepo.claimNextImplementationQueueEntry({
			processorCount: 1_000,
			leaseOwnerId: "processor-a",
			leaseTtlMs: 60_000,
			now,
		});
		expect(claimed.kind).toBe("claimed");
		const claimedEntry = claimed.kind === "claimed" ? claimed.entry : null;
		expect(claimedEntry?.id).toBe(fixture.entry.id);
		const run = await nightworkersRepo.createTaskRun({
			taskId: fixture.task.id,
			repositoryId: fixture.repository.id,
			status: "running",
		});

		await expect(
			queueRepo.markImplementationQueueEntryProcessing({
				entryId: fixture.entry.id,
				runId: run.id,
				leaseOwnerId: "processor-a",
				leaseVersion: 999,
				leaseTtlMs: 60_000,
				now,
			}),
		).resolves.toBeNull();

		const processing = await queueRepo.markImplementationQueueEntryProcessing({
			entryId: fixture.entry.id,
			runId: run.id,
			leaseOwnerId: "processor-a",
			leaseVersion: claimedEntry?.leaseVersion ?? 0,
			leaseTtlMs: 60_000,
			now,
		});
		expect(processing).toMatchObject({
			id: fixture.entry.id,
			status: "processing",
			activeRunId: run.id,
			leaseVersion: (claimedEntry?.leaseVersion ?? 0) + 1,
		});

		const refreshed = await queueRepo.refreshImplementationQueueLease({
			entryId: fixture.entry.id,
			leaseOwnerId: "processor-a",
			leaseVersion: processing?.leaseVersion ?? 0,
			leaseTtlMs: 120_000,
			now: new Date(now.getTime() + 1_000),
		});
		expect(refreshed).toMatchObject({
			id: fixture.entry.id,
			status: "processing",
			leaseVersion: (processing?.leaseVersion ?? 0) + 1,
		});

		await nightworkersRepo.updateTaskRun(run.id, { status: "completed" });
		const completed = await queueRepo.completeImplementationQueueEntryForRunId({
			runId: run.id,
			runStatus: "completed",
			now,
		});
		expect(completed).toMatchObject({
			id: fixture.entry.id,
			status: "execution_completed",
			processorSlot: null,
			leaseOwnerId: null,
			leaseExpiresAt: null,
		});
		await expect(
			queueRepo.completeImplementationQueueEntryForRunId({
				runId: run.id,
				runStatus: "completed",
				now,
			}),
		).resolves.toBeNull();
	});

	it("applies reconciliation without changing healthy processing or awaiting commit entries", async () => {
		const staleClaim = await createQueuedEntry({ priority: 903_000 });
		const healthyProcessing = await createQueuedEntry({ priority: 903_001 });
		const awaitingCommit = await createQueuedEntry({ priority: 903_002 });
		const staleProcessingWithoutRun = await createQueuedEntry({
			priority: 903_003,
		});
		const now = new Date("2026-07-03T04:00:00.000Z");
		const run = await nightworkersRepo.createTaskRun({
			taskId: healthyProcessing.task.id,
			repositoryId: healthyProcessing.repository.id,
			status: "running",
		});
		await queueRepo.updateImplementationQueueEntry(staleClaim.entry.id, {
			status: "claimed",
			processorSlot: 1,
			leaseOwnerId: "dead-owner",
			leaseExpiresAt: new Date(now.getTime() - 1_000),
			attemptCount: 1,
		});
		await queueRepo.updateImplementationQueueEntry(healthyProcessing.entry.id, {
			status: "processing",
			processorSlot: 2,
			activeRunId: run.id,
			lastHeartbeatAt: now,
			leaseOwnerId: "live-owner",
			leaseExpiresAt: new Date(now.getTime() + 60_000),
		});
		await queueRepo.updateImplementationQueueEntry(awaitingCommit.entry.id, {
			status: "awaiting_commit_decision",
			processorSlot: 3,
			leaseOwnerId: "commit-owner",
			leaseExpiresAt: new Date(now.getTime() - 60_000),
		});
		await queueRepo.updateImplementationQueueEntry(
			staleProcessingWithoutRun.entry.id,
			{
				status: "processing",
				processorSlot: 4,
				lastHeartbeatAt: new Date(now.getTime() - 60 * 60 * 1000),
				attemptCount: 1,
			},
		);

		const result = await queueService.reconcileImplementationQueue({
			apply: true,
			now,
		});

		expect(result.actions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					entryId: staleClaim.entry.id,
					action: "retry",
					status: "queued",
				}),
				expect.objectContaining({
					entryId: staleProcessingWithoutRun.entry.id,
					action: "retry",
					status: "queued",
				}),
			]),
		);
		await expect(
			queueRepo.getImplementationQueueEntry(staleClaim.entry.id),
		).resolves.toMatchObject({
			status: "queued",
			leaseOwnerId: null,
			recoveryReason: "lease_expired_before_run_start",
		});
		await expect(
			queueRepo.getImplementationQueueEntry(healthyProcessing.entry.id),
		).resolves.toMatchObject({
			status: "processing",
			activeRunId: run.id,
		});
		await expect(
			queueRepo.getImplementationQueueEntry(awaitingCommit.entry.id),
		).resolves.toMatchObject({
			status: "awaiting_commit_decision",
			processorSlot: 3,
		});
		await expect(
			queueRepo.getImplementationQueueEntry(staleProcessingWithoutRun.entry.id),
		).resolves.toMatchObject({
			status: "queued",
			activeRunId: null,
			recoveryReason: "heartbeat_stale_processing",
		});
		const messages = await nightworkersRepo.listTaskMessages(
			staleClaim.task.id,
		);
		expect(
			messages.some((message) =>
				message.content.includes("Implementation Queue recovery"),
			),
		).toBe(true);
	});

	it("exposes queue health and manual recovery through API routes", async () => {
		const fixture = await createQueuedEntry({ priority: 904_000 });
		await queueRepo.updateImplementationQueueEntry(fixture.entry.id, {
			status: "claimed",
			processorSlot: 1,
			leaseOwnerId: "manual-owner",
			leaseExpiresAt: new Date(0),
			attemptCount: 1,
		});

		const healthRes = await app.request(
			"http://localhost/api/implementation-queue/health",
			{
				headers: sameOriginHeaders,
			},
		);
		expect(healthRes.status).toBe(200);
		const health = await healthRes.json();
		expect(health.items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					entryId: fixture.entry.id,
					classification: "stale_claim",
					recommendedAction: "retry",
				}),
			]),
		);

		const recoverRes = await app.request(
			`http://localhost/api/implementation-queue/entries/${fixture.entry.id}/recover`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({ action: "retry", note: "test retry" }),
			},
		);
		expect(recoverRes.status).toBe(200);
		await expect(
			queueRepo.getImplementationQueueEntry(fixture.entry.id),
		).resolves.toMatchObject({
			status: "queued",
			leaseOwnerId: null,
			recoveryReason: "manual_retry",
		});
	});

	it("rejects manual retry when the active run is still running", async () => {
		const fixture = await createQueuedEntry({ priority: 905_000 });
		const run = await nightworkersRepo.createTaskRun({
			taskId: fixture.task.id,
			repositoryId: fixture.repository.id,
			status: "running",
		});
		await queueRepo.updateImplementationQueueEntry(fixture.entry.id, {
			status: "processing",
			activeRunId: run.id,
			processorSlot: 1,
			lastHeartbeatAt: new Date(0),
		});

		const recoverRes = await app.request(
			`http://localhost/api/implementation-queue/entries/${fixture.entry.id}/recover`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({ action: "retry" }),
			},
		);

		expect(recoverRes.status).toBe(409);
		await expect(
			queueRepo.getImplementationQueueEntry(fixture.entry.id),
		).resolves.toMatchObject({
			status: "processing",
			activeRunId: run.id,
		});
	});
});
