import crypto from "node:crypto";
import fs from "node:fs/promises";
import { lt } from "drizzle-orm";
import { client, db } from "../../db/client";
import { runtimeRetentionAuditEvents } from "../../db/schema";
import { AppError } from "../../lib/errors";
import {
	configureRuntimeLogRetention,
	sweepRuntimeLogs,
} from "../../lib/logger";
import { canonicalDigest } from "../../modules/agentsShare";
import { readGeneralSettings } from "../settings/general-settings";
import {
	purgeRuntimeRecordDetails,
	readRuntimeForeignKeyViolations,
} from "./runtime-record-purge";

const DAY_MS = 24 * 60 * 60 * 1000;
const DELETE_BATCH_SIZE = 1_000;

let activeSweep: Promise<RuntimeRetentionResult> | null = null;
let lastUsageCleanupAt = 0;

export type RuntimeRetentionResult = {
	usageCleanupRan: boolean;
	rowsDeleted: Record<string, number>;
	detailCleanup?: RuntimeRecordCleanupResult;
};

export type RuntimeRecordCleanupPreview = {
	previewId: string;
	settingsRevision: number;
	policyDigest: string;
	cutoffAt: string;
	expiresAt: string;
	databaseBytesBefore: number;
	walBytesBefore: number;
	deletable: {
		payloads: number;
		detailRows: number;
		estimatedPayloadBytes: number;
		estimatedDatabaseBytes: number;
	};
	protected: {
		activeRuns: number;
		reviewPendingRuns: number;
		closeoutPendingRuns: number;
		needsHumanRuns: number;
	};
	categories: Array<{
		kind: string;
		records: number;
		estimatedBytes: number;
	}>;
};

export type RuntimeRecordCleanupResult = {
	status: "completed";
	runsPurged: number;
	detailRowsDeleted: number;
	detailBytesPurged: number;
	rowsDeleted: Record<string, number>;
	reclaim: {
		requested: "incremental" | "skip";
		status: "completed" | "skipped" | "unsupported";
	};
};

type CleanupCandidate = {
	id: string;
	estimatedBytes: number;
	detailRows: number;
	stateVersion: number;
};

type StoredPreview = RuntimeRecordCleanupPreview & {
	candidateIds: string[];
	candidateBytes: Record<string, number>;
	candidateDigest: string;
};

type StoredCleanupReceipt = {
	previewId: string;
	expectedSettingsRevision: number;
	reclaimDiskSpace: "incremental" | "skip";
	expiresAt: number;
	result: RuntimeRecordCleanupResult;
};

const cleanupPreviews = new Map<string, StoredPreview>();
const cleanupReceipts = new Map<string, StoredCleanupReceipt>();
const schedulerReloadListeners = new Set<() => void>();
const PREVIEW_TTL_MS = 15 * 60 * 1000;
const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STORED_PREVIEWS = 100;
const MAX_STORED_RECEIPTS = 1_000;

async function deleteOldRows(table: string, column: string, cutoff: Date) {
	let deleted = 0;
	while (true) {
		const result = (await client.execute({
			sql: `DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE ${column} < ? LIMIT ?)`,
			args: [Math.floor(cutoff.getTime() / 1000), DELETE_BATCH_SIZE],
		})) as { rowsAffected?: number };
		const count = Number(result.rowsAffected ?? 0);
		deleted += count;
		if (count < DELETE_BATCH_SIZE) return deleted;
	}
}

async function writeAudit(input: {
	status: "completed" | "failed";
	startedAt: Date;
	settings: Record<string, unknown>;
	rowsDeleted: Record<string, number>;
	errorSummary?: string;
}) {
	await db.insert(runtimeRetentionAuditEvents).values({
		eventType:
			input.status === "completed"
				? "retention.sweep_completed"
				: "retention.sweep_failed",
		status: input.status,
		startedAt: input.startedAt,
		finishedAt: new Date(),
		settingsSnapshotJson: input.settings,
		rowsDeletedJson: input.rowsDeleted,
		errorSummary: input.errorSummary ?? null,
	});
}

export async function runRuntimeRetentionSweep(
	input: {
		now?: Date;
		forceUsageCleanup?: boolean;
		skipLogSweep?: boolean;
	} = {},
): Promise<RuntimeRetentionResult> {
	if (activeSweep) return activeSweep;
	const run = async () => {
		const startedAt = input.now ?? new Date();
		const retention = readGeneralSettings().dataRetention;
		configureRuntimeLogRetention(retention);
		const rowsDeleted: Record<string, number> = {};
		try {
			if (!input.skipLogSweep) await sweepRuntimeLogs();
			const usageDue =
				input.forceUsageCleanup ||
				startedAt.getTime() - lastUsageCleanupAt >= DAY_MS;
			if (usageDue) {
				const cutoff = new Date(
					startedAt.getTime() - retention.usageDataDays * DAY_MS,
				);
				rowsDeleted.llm_usage_records = await deleteOldRows(
					"llm_usage_records",
					"created_at",
					cutoff,
				);
				rowsDeleted.llm_usage_summary_buckets = await deleteOldRows(
					"llm_usage_summary_buckets",
					"bucket_hour_utc",
					cutoff,
				);
				rowsDeleted.llm_usage_summary_task_buckets = await deleteOldRows(
					"llm_usage_summary_task_buckets",
					"bucket_hour_utc",
					cutoff,
				);
				rowsDeleted.llm_usage_summary_warnings = await deleteOldRows(
					"llm_usage_summary_warnings",
					"bucket_hour_utc",
					cutoff,
				);
				lastUsageCleanupAt = startedAt.getTime();
			}
			const automaticPreview =
				await buildRuntimeRecordCleanupPreview(startedAt);
			const detailCleanup = await executeRuntimeRecordCleanupCandidates({
				preview: automaticPreview,
				reclaimDiskSpace: "incremental",
			});
			Object.assign(rowsDeleted, detailCleanup.rowsDeleted);
			const auditCutoff = new Date(
				startedAt.getTime() - retention.auditEventDays * DAY_MS,
			);
			rowsDeleted.runtime_retention_audit_events = await db
				.delete(runtimeRetentionAuditEvents)
				.where(lt(runtimeRetentionAuditEvents.createdAt, auditCutoff))
				.returning({ id: runtimeRetentionAuditEvents.id })
				.then((rows) => rows.length);
			await writeAudit({
				status: "completed",
				startedAt,
				settings: retention,
				rowsDeleted,
			});
			return { usageCleanupRan: usageDue, rowsDeleted, detailCleanup };
		} catch (error) {
			await writeAudit({
				status: "failed",
				startedAt,
				settings: retention,
				rowsDeleted,
				errorSummary: error instanceof Error ? error.message : String(error),
			}).catch(() => undefined);
			throw error;
		}
	};
	activeSweep = run().finally(() => {
		activeSweep = null;
	});
	return activeSweep;
}

export async function previewRuntimeRecordCleanup(
	now = new Date(),
): Promise<RuntimeRecordCleanupPreview> {
	pruneCleanupState(now);
	const preview = await buildRuntimeRecordCleanupPreview(now);
	cleanupPreviews.set(preview.previewId, preview);
	trimOldestEntries(cleanupPreviews, MAX_STORED_PREVIEWS);
	return publicPreview(preview);
}

export function notifyRuntimeRetentionSettingsChanged() {
	for (const listener of schedulerReloadListeners) listener();
}

export function subscribeRuntimeRetentionSettingsChanged(listener: () => void) {
	schedulerReloadListeners.add(listener);
	return () => schedulerReloadListeners.delete(listener);
}

export async function executeRuntimeRecordCleanup(input: {
	previewId: string;
	expectedSettingsRevision: number;
	idempotencyKey: string;
	reclaimDiskSpace: "incremental" | "skip";
	now?: Date;
}): Promise<RuntimeRecordCleanupResult> {
	const now = input.now ?? new Date();
	pruneCleanupState(now);
	const receipt = cleanupReceipts.get(input.idempotencyKey);
	if (receipt) {
		if (
			receipt.previewId !== input.previewId ||
			receipt.expectedSettingsRevision !== input.expectedSettingsRevision ||
			receipt.reclaimDiskSpace !== input.reclaimDiskSpace
		) {
			throw new AppError(
				409,
				"cleanup_idempotency_conflict",
				"Idempotency key was already used for another cleanup request.",
			);
		}
		return receipt.result;
	}
	const preview = cleanupPreviews.get(input.previewId);
	if (!preview || Date.parse(preview.expiresAt) <= now.getTime())
		throw new AppError(
			409,
			"cleanup_preview_expired",
			"Cleanup preview expired; create a new preview.",
		);
	const settingsRevision = retentionPolicyRevision(
		readGeneralSettings().dataRetention.codingAgentFullRecordDays,
	);
	if (
		settingsRevision !== input.expectedSettingsRevision ||
		settingsRevision !== preview.settingsRevision
	) {
		throw new AppError(
			409,
			"cleanup_settings_changed",
			"Retention settings changed; create a new preview.",
		);
	}
	const current = await buildRuntimeRecordCleanupPreview(now);
	if (
		current.policyDigest !== preview.policyDigest ||
		current.candidateDigest !== preview.candidateDigest
	) {
		throw new AppError(
			409,
			"cleanup_candidates_changed",
			"Cleanup candidates changed; create a new preview.",
		);
	}
	const result = await executeRuntimeRecordCleanupCandidates({
		preview,
		reclaimDiskSpace: input.reclaimDiskSpace,
	});
	cleanupReceipts.set(input.idempotencyKey, {
		previewId: input.previewId,
		expectedSettingsRevision: input.expectedSettingsRevision,
		reclaimDiskSpace: input.reclaimDiskSpace,
		expiresAt: now.getTime() + RECEIPT_TTL_MS,
		result,
	});
	trimOldestEntries(cleanupReceipts, MAX_STORED_RECEIPTS);
	cleanupPreviews.delete(input.previewId);
	return result;
}

async function buildRuntimeRecordCleanupPreview(
	now: Date,
): Promise<StoredPreview> {
	const retention = readGeneralSettings().dataRetention;
	const cutoff = new Date(
		now.getTime() - retention.codingAgentFullRecordDays * DAY_MS,
	);
	const [candidates, storage, protectedCounts] = await Promise.all([
		listCleanupCandidates(cutoff),
		readSqliteStorage(),
		readProtectedRunCounts(),
	]);
	const candidateIds = candidates.map((candidate) => candidate.id).sort();
	const estimatedBytes = candidates.reduce(
		(total, candidate) => total + candidate.estimatedBytes,
		0,
	);
	const detailRows = candidates.reduce(
		(total, candidate) => total + candidate.detailRows,
		0,
	);
	const policyDigest = canonicalDigest({
		codingAgentFullRecordDays: retention.codingAgentFullRecordDays,
	});
	const settingsRevision = retentionPolicyRevision(
		retention.codingAgentFullRecordDays,
	);
	return {
		previewId: crypto.randomUUID(),
		settingsRevision,
		policyDigest,
		cutoffAt: cutoff.toISOString(),
		expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS).toISOString(),
		databaseBytesBefore: storage.databaseBytes,
		walBytesBefore: storage.walBytes,
		deletable: {
			payloads: candidates.length,
			detailRows,
			estimatedPayloadBytes: estimatedBytes,
			estimatedDatabaseBytes: estimatedBytes,
		},
		protected: protectedCounts,
		categories: [
			{
				kind: "coding_agent_full_record",
				records: candidates.length,
				estimatedBytes,
			},
		],
		candidateIds,
		candidateBytes: Object.fromEntries(
			candidates.map((candidate) => [candidate.id, candidate.estimatedBytes]),
		),
		candidateDigest: canonicalDigest(
			candidates.map((candidate) => ({
				id: candidate.id,
				detailRows: candidate.detailRows,
				estimatedBytes: candidate.estimatedBytes,
				stateVersion: candidate.stateVersion,
			})),
		),
	};
}

async function listCleanupCandidates(
	cutoff: Date,
): Promise<CleanupCandidate[]> {
	const result = await client.execute({
		sql: `
			SELECT tr.id,
				tr.updated_at,
				1 +
				(SELECT count(*) FROM verification_evidence_cases vec
				 WHERE vec.evidence_run_id IN (
					SELECT ver.id FROM verification_evidence_runs ver WHERE ver.run_id = tr.id
				 )) +
				(SELECT count(*) FROM coding_agent_test_condition_mappings catcm
				 WHERE catcm.inventory_id IN (
					SELECT cair.id FROM coding_agent_test_inventory_runs cair WHERE cair.run_id = tr.id
				 )) +
				(SELECT count(*) FROM coding_agent_test_inventory_cases catic
				 WHERE catic.inventory_id IN (
					SELECT cair.id FROM coding_agent_test_inventory_runs cair WHERE cair.run_id = tr.id
				 )) +
				(SELECT count(*) FROM native_api_tool_calls WHERE run_id = tr.id) +
				(SELECT count(*) FROM native_api_turns WHERE run_id = tr.id) +
				(SELECT count(*) FROM activity_events WHERE run_id = tr.id) +
				(SELECT count(*) FROM activity_artifacts WHERE run_id = tr.id) +
				(SELECT count(*) FROM conversation_context_snapshots WHERE run_id = tr.id) +
				(SELECT count(*) FROM task_events WHERE task_run_id = tr.id) +
				(SELECT count(*) FROM task_messages WHERE run_id = tr.id)
				AS detail_rows,
				coalesce(length(tr.log_content), 0) +
				coalesce(length(tr.diff_patch), 0) +
				coalesce(length(tr.test_results), 0) +
				coalesce(length(tr.context_snapshot), 0) AS estimated_bytes
			FROM task_runs tr
			LEFT JOIN task_run_merge_records mr ON mr.run_id = tr.id
			WHERE tr.details_purged_at IS NULL
			  AND (
				(tr.status IN ('failed', 'timed_out', 'cancelled')
				 AND coalesce(tr.finished_at, tr.ended_at, tr.updated_at) < ?)
				OR
				(mr.status = 'merged' AND mr.merged_at IS NOT NULL AND mr.merged_at < ?)
				OR EXISTS (
					SELECT 1 FROM closeout_admissions ca
					WHERE ca.run_id = tr.id
					  AND ca.status = 'consumed'
					  AND ca.consumed_at IS NOT NULL
					  AND ca.consumed_at < ?
				)
			  )
			ORDER BY tr.id
			LIMIT 1000
		`,
		args: [
			Math.floor(cutoff.getTime() / 1000),
			Math.floor(cutoff.getTime() / 1000),
			Math.floor(cutoff.getTime() / 1000),
		],
	});
	return result.rows.map((row) => ({
		id: String(row.id),
		detailRows: Number(row.detail_rows ?? 1),
		estimatedBytes: Number(row.estimated_bytes ?? 0),
		stateVersion: Number(row.updated_at ?? 0),
	}));
}

async function executeRuntimeRecordCleanupCandidates(input: {
	preview: StoredPreview;
	reclaimDiskSpace: "incremental" | "skip";
}): Promise<RuntimeRecordCleanupResult> {
	const foreignKeyViolationsBefore = await readRuntimeForeignKeyViolations();
	const rowsDeleted: Record<string, number> = {};
	let detailRowsDeleted = 0;
	let detailBytesPurged = 0;
	let runsPurged = 0;
	for (const runId of input.preview.candidateIds) {
		const estimatedBytes = input.preview.candidateBytes[runId] ?? 0;
		const result = await purgeRuntimeRecordDetails({
			runId,
			estimatedBytes,
			cutoff: new Date(input.preview.cutoffAt),
			foreignKeyViolationsBefore,
		});
		if (!result.purged) continue;
		runsPurged += 1;
		detailRowsDeleted += result.rows;
		detailBytesPurged += result.bytes;
		for (const [table, count] of Object.entries(result.byTable)) {
			rowsDeleted[table] = (rowsDeleted[table] ?? 0) + count;
		}
	}
	await client.execute("PRAGMA wal_checkpoint(PASSIVE)");
	let reclaim: RuntimeRecordCleanupResult["reclaim"];
	if (input.reclaimDiskSpace === "skip") {
		reclaim = { requested: "skip", status: "skipped" };
	} else {
		const autoVacuum = await client.execute("PRAGMA auto_vacuum");
		const mode = Number(autoVacuum.rows[0]?.auto_vacuum ?? 0);
		reclaim =
			mode === 2
				? await client
						.execute("PRAGMA incremental_vacuum(1000)")
						.then(() => ({
							requested: "incremental" as const,
							status: "completed" as const,
						}))
						.catch(() => ({
							requested: "incremental" as const,
							status: "unsupported" as const,
						}))
				: { requested: "incremental", status: "unsupported" };
	}
	return {
		status: "completed",
		runsPurged,
		detailRowsDeleted,
		detailBytesPurged,
		rowsDeleted,
		reclaim,
	};
}

function retentionPolicyRevision(codingAgentFullRecordDays: number) {
	const digest = canonicalDigest({ codingAgentFullRecordDays });
	const hex = digest.slice(digest.lastIndexOf(":") + 1);
	return Number.parseInt(hex.slice(0, 12), 16);
}

async function readSqliteStorage() {
	const [pageCount, pageSize, databaseList] = await Promise.all([
		client.execute("PRAGMA page_count"),
		client.execute("PRAGMA page_size"),
		client.execute("PRAGMA database_list"),
	]);
	const count = Number(pageCount.rows[0]?.page_count ?? 0);
	const size = Number(pageSize.rows[0]?.page_size ?? 0);
	const main = databaseList.rows.find((row) => row.name === "main");
	const databasePath = typeof main?.file === "string" ? main.file : "";
	const walBytes = databasePath
		? await fs
				.stat(`${databasePath}-wal`)
				.then((stat) => stat.size)
				.catch(() => 0)
		: 0;
	return { databaseBytes: count * size, walBytes };
}

async function readProtectedRunCounts() {
	const result = await client.execute(`
		SELECT
			sum(CASE WHEN tr.status IN ('running', 'context_compiling', 'finalizing') THEN 1 ELSE 0 END) AS active_runs,
			sum(CASE WHEN tr.status = 'needs_review' THEN 1 ELSE 0 END) AS review_pending_runs,
			sum(CASE
				WHEN tr.status = 'completed'
				 AND NOT EXISTS (
					SELECT 1 FROM task_run_merge_records mr
					WHERE mr.run_id = tr.id AND mr.status = 'merged'
				 )
				 AND NOT EXISTS (
					SELECT 1 FROM closeout_admissions ca
					WHERE ca.run_id = tr.id AND ca.status = 'consumed'
				 )
				THEN 1 ELSE 0 END) AS closeout_pending_runs,
			sum(CASE WHEN tr.status IN ('blocked', 'needs_human') THEN 1 ELSE 0 END) AS needs_human_runs
		FROM task_runs tr
		WHERE tr.details_purged_at IS NULL
	`);
	const row = result.rows[0] ?? {};
	return {
		activeRuns: Number(row.active_runs ?? 0),
		reviewPendingRuns: Number(row.review_pending_runs ?? 0),
		closeoutPendingRuns: Number(row.closeout_pending_runs ?? 0),
		needsHumanRuns: Number(row.needs_human_runs ?? 0),
	};
}

function publicPreview(preview: StoredPreview): RuntimeRecordCleanupPreview {
	const {
		candidateIds: _ids,
		candidateBytes: _bytes,
		candidateDigest: _digest,
		...value
	} = preview;
	return value;
}

function pruneCleanupState(now: Date) {
	for (const [id, preview] of cleanupPreviews) {
		if (Date.parse(preview.expiresAt) <= now.getTime())
			cleanupPreviews.delete(id);
	}
	for (const [idempotencyKey, receipt] of cleanupReceipts) {
		if (receipt.expiresAt <= now.getTime())
			cleanupReceipts.delete(idempotencyKey);
	}
}

function trimOldestEntries<K, V>(entries: Map<K, V>, maximum: number) {
	while (entries.size > maximum) {
		const oldest = entries.keys().next();
		if (oldest.done) return;
		entries.delete(oldest.value);
	}
}

export async function pruneRuntimeRetentionAuditEvents(now = new Date()) {
	const retention = readGeneralSettings().dataRetention;
	const cutoff = new Date(now.getTime() - retention.auditEventDays * DAY_MS);
	return db
		.delete(runtimeRetentionAuditEvents)
		.where(lt(runtimeRetentionAuditEvents.createdAt, cutoff));
}
