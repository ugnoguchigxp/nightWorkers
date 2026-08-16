import { and, eq, inArray } from "drizzle-orm";
import { type DbTransaction, db } from "../../db/client";
import type { TaskRunStatus } from "../../db/schema";
import { taskRuns } from "../../db/schema";
import { sanitizePersistenceValue } from "../../services/security/secret-persistence-firewall";
import { appendFinalResponseEvidence } from "../evidenceLedger";
import { assertRunStatusTransition } from "./run-orchestration/status";

export type TaskRunUpdateData = {
	status?: TaskRunStatus;
	endedAt?: Date | null;
	finishedAt?: Date | null;
	logContent?: string;
	diffPatch?: string;
	testResults?: unknown;
	workerKind?: string;
	baseRef?: string | null;
	worktreePath?: string | null;
	timeoutSeconds?: number;
	contextSnapshot?: unknown;
	summary?: string | null;
	finalReport?: string | null;
	finalJudgment?: unknown;
};

export type TaskRunTransitionResult =
	| { kind: "applied"; run: typeof taskRuns.$inferSelect }
	| { kind: "conflict"; current: typeof taskRuns.$inferSelect }
	| { kind: "not_found" };

/**
 * Performs a status transition without publishing a realtime event.  Callers
 * that combine this with Task or Queue projections can therefore keep every
 * durable write in their own transaction and publish only after it commits.
 */
export async function transitionTaskRunIfCurrent(
	input: {
		runId: string;
		expectedStatuses: readonly [TaskRunStatus, ...TaskRunStatus[]];
		expectedUpdatedAt?: Date;
		targetStatus: TaskRunStatus;
		patch?: Omit<TaskRunUpdateData, "status">;
	},
	database: typeof db | DbTransaction = db,
): Promise<TaskRunTransitionResult> {
	const expectedStatuses = [...input.expectedStatuses];
	const patch = sanitizePersistenceValue(input.patch ?? {});
	const transition = async (
		target: typeof db | DbTransaction,
	): Promise<TaskRunTransitionResult> => {
		const [current] = await target
			.select()
			.from(taskRuns)
			.where(eq(taskRuns.id, input.runId));
		if (!current) return { kind: "not_found" };
		if (!expectedStatuses.includes(current.status)) {
			return { kind: "conflict", current };
		}

		assertRunStatusTransition(current.status, input.targetStatus);
		const [updated] = await target
			.update(taskRuns)
			.set({
				...patch,
				status: input.targetStatus,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(taskRuns.id, input.runId),
					inArray(taskRuns.status, expectedStatuses),
					...(input.expectedUpdatedAt
						? [eq(taskRuns.updatedAt, input.expectedUpdatedAt)]
						: []),
				),
			)
			.returning();
		if (updated) {
			if (patch.finalReport !== undefined && patch.finalReport !== null) {
				await appendFinalResponseEvidence(
					{
						taskId: updated.taskId,
						runId: updated.id,
						content: patch.finalReport,
					},
					target,
				);
			}
			return { kind: "applied", run: updated };
		}

		const [latest] = await target
			.select()
			.from(taskRuns)
			.where(eq(taskRuns.id, input.runId));
		return latest
			? { kind: "conflict", current: latest }
			: { kind: "not_found" };
	};

	return database === db ? db.transaction(transition) : transition(database);
}
