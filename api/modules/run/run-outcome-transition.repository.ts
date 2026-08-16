import { and, eq, sql } from "drizzle-orm";
import { type DbTransaction, db } from "../../db/client";
import {
	implementationQueueEntries,
	type TaskRunStatus,
	type TaskStatus,
	taskRuns,
	tasks,
} from "../../db/schema";
import {
	type TaskRunUpdateData,
	transitionTaskRunIfCurrent,
} from "../nightworkers/nightworkers.run-transition.repository";
import { queueStatusForRunStatus } from "../queue/queue-repository-row-mapper";

type Database = typeof db | DbTransaction;

export type RunOutcomeTransitionInput = {
	run: {
		id: string;
		expectedStatuses: readonly [TaskRunStatus, ...TaskRunStatus[]];
		expectedUpdatedAt: Date;
		targetStatus: TaskRunStatus;
		patch?: Omit<TaskRunUpdateData, "status">;
	};
	task: {
		id: string;
		expectedStatus: TaskStatus;
		expectedUpdatedAt: Date;
		targetStatus: TaskStatus;
	};
	afterApply?: (
		outcome: {
			run: typeof taskRuns.$inferSelect;
			task: typeof tasks.$inferSelect;
			queueEntry: typeof implementationQueueEntries.$inferSelect | null;
		},
		database: DbTransaction,
	) => Promise<void>;
};

export type RunOutcomeTransitionResult =
	| {
			kind: "applied";
			run: typeof taskRuns.$inferSelect;
			task: typeof tasks.$inferSelect;
			queueEntry: typeof implementationQueueEntries.$inferSelect | null;
	  }
	| {
			kind: "conflict";
			run: typeof taskRuns.$inferSelect | null;
			task: typeof tasks.$inferSelect | null;
			queueEntry: typeof implementationQueueEntries.$inferSelect | null;
	  }
	| { kind: "not_found" };

class RunOutcomeConflict extends Error {}

async function readRun(id: string, database: Database = db) {
	const [run] = await database
		.select()
		.from(taskRuns)
		.where(eq(taskRuns.id, id));
	return run ?? null;
}

async function readTask(id: string, database: Database = db) {
	const [task] = await database.select().from(tasks).where(eq(tasks.id, id));
	return task ?? null;
}

async function readQueueEntryForRun(runId: string, database: Database = db) {
	const [entry] = await database
		.select()
		.from(implementationQueueEntries)
		.where(eq(implementationQueueEntries.activeRunId, runId));
	return entry ?? null;
}

export async function transitionRunOutcome(
	input: RunOutcomeTransitionInput,
): Promise<RunOutcomeTransitionResult> {
	try {
		return await db.transaction(async (tx) => {
			const runTransition = await transitionTaskRunIfCurrent(
				{
					runId: input.run.id,
					expectedStatuses: input.run.expectedStatuses,
					expectedUpdatedAt: input.run.expectedUpdatedAt,
					targetStatus: input.run.targetStatus,
					patch: input.run.patch,
				},
				tx,
			);
			if (runTransition.kind === "not_found") return runTransition;
			if (runTransition.kind === "conflict") {
				return {
					kind: "conflict",
					run: runTransition.current,
					task: await readTask(input.task.id, tx),
					queueEntry: await readQueueEntryForRun(input.run.id, tx),
				};
			}

			const now = new Date();
			const [projectedTask] = await tx
				.update(tasks)
				.set({
					status: input.task.targetStatus,
					updatedAt: now,
					...(input.task.targetStatus === "completed"
						? { completedAt: now }
						: {}),
					...(input.task.targetStatus === "archived"
						? { archivedAt: now }
						: {}),
				})
				.where(
					and(
						eq(tasks.id, input.task.id),
						eq(tasks.status, input.task.expectedStatus),
						eq(tasks.updatedAt, input.task.expectedUpdatedAt),
					),
				)
				.returning();
			if (!projectedTask) throw new RunOutcomeConflict();

			const currentQueueEntry = await readQueueEntryForRun(input.run.id, tx);
			let queueEntry: typeof implementationQueueEntries.$inferSelect | null =
				null;
			if (currentQueueEntry) {
				const [updatedQueueEntry] = await tx
					.update(implementationQueueEntries)
					.set({
						status: queueStatusForRunStatus(input.run.targetStatus),
						processorSlot: null,
						leaseOwnerId: null,
						leaseAcquiredAt: null,
						leaseExpiresAt: null,
						lastHeartbeatAt: now,
						statusReason:
							input.run.targetStatus === "failed"
								? `Run finished with status=${input.run.targetStatus}`
								: null,
						leaseVersion: sql`${implementationQueueEntries.leaseVersion} + 1`,
						updatedAt: now,
					})
					.where(
						and(
							eq(implementationQueueEntries.id, currentQueueEntry.id),
							eq(implementationQueueEntries.activeRunId, input.run.id),
							eq(implementationQueueEntries.status, currentQueueEntry.status),
							eq(
								implementationQueueEntries.leaseVersion,
								currentQueueEntry.leaseVersion,
							),
						),
					)
					.returning();
				if (!updatedQueueEntry) throw new RunOutcomeConflict();
				queueEntry = updatedQueueEntry;
			}

			const outcome = {
				kind: "applied",
				run: runTransition.run,
				task: projectedTask,
				queueEntry,
			} as const;
			await input.afterApply?.(outcome, tx);
			return outcome;
		});
	} catch (error) {
		if (!(error instanceof RunOutcomeConflict)) throw error;
		const [run, task, queueEntry] = await Promise.all([
			readRun(input.run.id),
			readTask(input.task.id),
			readQueueEntryForRun(input.run.id),
		]);
		return { kind: "conflict", run, task, queueEntry };
	}
}
