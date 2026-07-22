import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/client";
import type {
	ImplementationQueueEntryStatus,
	TaskRunStatus,
} from "../../db/schema";
import { implementationQueueEntries, taskRuns } from "../../db/schema";

class StaleRunRecoveryConflict extends Error {}

export async function timeoutStaleRunAndQueueFromSnapshot(input: {
	now: Date;
	expectedEntry: {
		id: string;
		status: ImplementationQueueEntryStatus;
		leaseVersion: number;
		activeRunId: string;
	};
	expectedRun: {
		id: string;
		status: TaskRunStatus;
		updatedAt: Date;
	};
	finalReport: string;
	summary: string;
}) {
	try {
		return await db.transaction(async (tx) => {
			const [timedOutRun] = await tx
				.update(taskRuns)
				.set({
					status: "timed_out",
					endedAt: input.now,
					finishedAt: input.now,
					finalReport: input.finalReport,
					summary: input.summary,
					updatedAt: input.now,
				})
				.where(
					and(
						eq(taskRuns.id, input.expectedRun.id),
						eq(taskRuns.status, input.expectedRun.status),
						eq(taskRuns.updatedAt, input.expectedRun.updatedAt),
					),
				)
				.returning();
			if (!timedOutRun) return null;

			const [failedEntry] = await tx
				.update(implementationQueueEntries)
				.set({
					status: "failed",
					processorSlot: null,
					leaseOwnerId: null,
					leaseAcquiredAt: null,
					leaseExpiresAt: null,
					lastHeartbeatAt: input.now,
					recoveredAt: input.now,
					recoveryReason: "run_deadline_exceeded",
					lastFailureKind: "run_deadline_exceeded",
					statusReason: "Run exceeded its deadline after heartbeats stopped.",
					leaseVersion: sql`${implementationQueueEntries.leaseVersion} + 1`,
					updatedAt: input.now,
				})
				.where(
					and(
						eq(implementationQueueEntries.id, input.expectedEntry.id),
						eq(implementationQueueEntries.status, input.expectedEntry.status),
						eq(
							implementationQueueEntries.leaseVersion,
							input.expectedEntry.leaseVersion,
						),
						eq(
							implementationQueueEntries.activeRunId,
							input.expectedEntry.activeRunId,
						),
					),
				)
				.returning();
			if (!failedEntry) throw new StaleRunRecoveryConflict();
			return { run: timedOutRun, entry: failedEntry };
		});
	} catch (error) {
		if (error instanceof StaleRunRecoveryConflict) return null;
		throw error;
	}
}
