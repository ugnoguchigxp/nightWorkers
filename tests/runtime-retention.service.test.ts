import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { client, db } from "../api/db/client";
import {
	llmUsageRecords,
	runtimeRetentionAuditEvents,
	taskRuns,
} from "../api/db/schema";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import {
	executeRuntimeRecordCleanup,
	previewRuntimeRecordCleanup,
	runRuntimeRetentionSweep,
} from "../api/services/runtime-retention/runtime-retention.service";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

describe("runtime retention service", () => {
	it("deletes expired usage rows and audit records while keeping current usage", async () => {
		const repository = await repo.createRepository({
			name: `TEST: retention ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: repository.id,
			title: "TEST: retention usage",
			status: "draft",
		});
		const now = new Date();
		const old = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
		const current = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
		const oldRecordId = crypto.randomUUID();
		const currentRecordId = crypto.randomUUID();
		const oldAuditId = crypto.randomUUID();
		await db.insert(llmUsageRecords).values({
			id: oldRecordId,
			createdAt: old,
			updatedAt: old,
			taskId: task.id,
			callId: crypto.randomUUID(),
			provider: "fixture",
			label: "expired",
			usageMode: "estimated",
			durationMs: 1,
		});
		await db.insert(llmUsageRecords).values({
			id: currentRecordId,
			createdAt: current,
			updatedAt: current,
			taskId: task.id,
			callId: crypto.randomUUID(),
			provider: "fixture",
			label: "current",
			usageMode: "estimated",
			durationMs: 1,
		});
		await db.insert(runtimeRetentionAuditEvents).values({
			id: oldAuditId,
			createdAt: new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000),
			updatedAt: new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000),
			eventType: "retention.sweep_completed",
			status: "completed",
			startedAt: old,
		});
		const beforeCleanup = await client.execute({
			sql: "SELECT id, created_at FROM llm_usage_records WHERE id IN (?, ?)",
			args: [oldRecordId, currentRecordId],
		});
		expect(beforeCleanup.rows).toHaveLength(2);
		const createdAtById = new Map(
			beforeCleanup.rows.map((row) => [String(row.id), Number(row.created_at)]),
		);
		expect(createdAtById.get(currentRecordId)).toBeGreaterThan(
			Math.floor((now.getTime() - 30 * 24 * 60 * 60 * 1000) / 1000),
		);

		const result = await runRuntimeRetentionSweep({
			now,
			forceUsageCleanup: true,
			skipLogSweep: true,
		});

		expect(result.rowsDeleted.llm_usage_records).toBeGreaterThanOrEqual(1);
		expect(
			result.rowsDeleted.runtime_retention_audit_events,
		).toBeGreaterThanOrEqual(1);
		expect(
			await db
				.select({ id: llmUsageRecords.id })
				.from(llmUsageRecords)
				.where(eq(llmUsageRecords.id, oldRecordId)),
		).toHaveLength(0);
		expect(
			await db
				.select({ id: llmUsageRecords.id })
				.from(llmUsageRecords)
				.where(eq(llmUsageRecords.id, currentRecordId)),
		).toHaveLength(1);
		expect(
			await db
				.select({ id: runtimeRetentionAuditEvents.id })
				.from(runtimeRetentionAuditEvents)
				.where(eq(runtimeRetentionAuditEvents.id, oldAuditId)),
		).toHaveLength(0);
	});

	it("purges only expired full-fidelity details while retaining the Run receipt", async () => {
		const repository = await repo.createRepository({
			name: `TEST: detail retention ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: repository.id,
			title: "TEST: detail retention",
			status: "draft",
		});
		const old = new Date("2026-01-01T00:00:00.000Z");
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: repository.id,
			status: "failed",
			logContent: undefined,
			contextSnapshot: { raw: "large context" },
			finalReport: "失敗理由の基幹receipt",
			finishedAt: old,
			endedAt: old,
		});
		await db
			.update(taskRuns)
			.set({
				logContent: "large log",
				diffPatch: "large diff",
				testResults: { raw: "large tests" },
				updatedAt: old,
			})
			.where(eq(taskRuns.id, run.id));

		const preview = await previewRuntimeRecordCleanup(
			new Date("2026-07-29T00:00:00.000Z"),
		);
		expect(preview.deletable.detailRows).toBeGreaterThanOrEqual(1);
		const idempotencyKey = `test-${crypto.randomUUID()}`;
		const cleanupRequest = {
			previewId: preview.previewId,
			expectedSettingsRevision: preview.settingsRevision,
			idempotencyKey,
			reclaimDiskSpace: "skip",
			now: new Date("2026-07-29T00:00:00.000Z"),
		} as const;
		const result = await executeRuntimeRecordCleanup(cleanupRequest);
		expect(result.runsPurged).toBeGreaterThanOrEqual(1);
		expect(await executeRuntimeRecordCleanup(cleanupRequest)).toEqual(result);
		await expect(
			executeRuntimeRecordCleanup({
				...cleanupRequest,
				previewId: crypto.randomUUID(),
			}),
		).rejects.toMatchObject({ code: "cleanup_idempotency_conflict" });
		const retained = await repo.getTaskRun(run.id);
		expect(retained).toMatchObject({
			id: run.id,
			status: "failed",
			finalReport: "失敗理由の基幹receipt",
			logContent: null,
			diffPatch: null,
			testResults: null,
			contextSnapshot: null,
		});
		expect(retained?.detailsPurgedAt).toBeInstanceOf(Date);
	});
});
