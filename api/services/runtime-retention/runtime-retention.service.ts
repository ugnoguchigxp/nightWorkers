import { lt } from "drizzle-orm";
import { client, db } from "../../db/client";
import { runtimeRetentionAuditEvents } from "../../db/schema";
import {
	configureRuntimeLogRetention,
	sweepRuntimeLogs,
} from "../../lib/logger";
import { readGeneralSettings } from "../settings/general-settings";

const DAY_MS = 24 * 60 * 60 * 1000;
const DELETE_BATCH_SIZE = 1_000;

let activeSweep: Promise<RuntimeRetentionResult> | null = null;
let lastUsageCleanupAt = 0;

export type RuntimeRetentionResult = {
	usageCleanupRan: boolean;
	rowsDeleted: Record<string, number>;
};

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
			return { usageCleanupRan: usageDue, rowsDeleted };
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

export async function pruneRuntimeRetentionAuditEvents(now = new Date()) {
	const retention = readGeneralSettings().dataRetention;
	const cutoff = new Date(now.getTime() - retention.auditEventDays * DAY_MS);
	return db
		.delete(runtimeRetentionAuditEvents)
		.where(lt(runtimeRetentionAuditEvents.createdAt, cutoff));
}
