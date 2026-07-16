import { and, asc, desc, eq, exists, inArray, sql } from "drizzle-orm";
import { type DbTransaction, db } from "../../db/client";
import { withSqliteBusyRetry } from "../../db/retry";
import type { TaskRunStatus } from "../../db/schema";
import {
	taskRunCommitRecords,
	taskRuns,
	taskRunTodos,
	tasks,
} from "../../db/schema";
import { nightWorkersRealtimeBroker } from "../../services/realtime/nightworkers-ws";

export * from "./nightworkers.runs-event.repository";
export * from "./nightworkers.runs-support";

import { notifyTaskRunUpdatedListeners } from "./nightworkers.runs-support";

export async function createTaskRun(
	data: {
		taskId: string;
		repositoryId?: string | null;
		agentModeSessionId?: string | null;
		status?: TaskRunStatus;
		workerKind?: string;
		baseRef?: string | null;
		worktreePath?: string | null;
		timeoutSeconds?: number;
		contextSnapshot?: unknown;
		summary?: string | null;
		finalReport?: string | null;
		finalJudgment?: unknown;
		startedAt?: Date;
		endedAt?: Date;
		finishedAt?: Date;
	},
	database: typeof db | DbTransaction = db,
) {
	const [run] = await database.insert(taskRuns).values(data).returning();
	return run;
}

export async function getTaskRun(id: string) {
	const [run] = await db.select().from(taskRuns).where(eq(taskRuns.id, id));
	return run;
}

export async function createTaskRunCommitRecord(data: {
	runId: string;
	repositoryId: string;
	status?: string;
	baselineHead?: string | null;
	baselineStatusJson?: unknown;
	preExistingDirtyPaths?: string[];
	ownedCandidatePaths?: string[];
	stageableOwnedPaths?: string[];
	excludedPaths?: Array<{ path: string; reason: string }>;
	verificationStatus?: "not_run" | "passed" | "failed" | "partial";
	verificationEvidenceJson?: unknown;
	commitSha?: string | null;
	commitMessage?: string | null;
	pushStatus?: string | null;
	pushedAt?: Date | null;
	pushRemote?: string | null;
	pushBranch?: string | null;
	statusReason?: string | null;
}) {
	const now = new Date();
	const values = {
		runId: data.runId,
		repositoryId: data.repositoryId,
		status: data.status ?? "pending",
		baselineHead: data.baselineHead ?? null,
		baselineStatusJson: data.baselineStatusJson ?? null,
		preExistingDirtyPathsJson: data.preExistingDirtyPaths ?? [],
		ownedCandidatePathsJson: data.ownedCandidatePaths ?? [],
		stageableOwnedPathsJson: data.stageableOwnedPaths ?? [],
		excludedPathsJson: data.excludedPaths ?? [],
		verificationStatus: data.verificationStatus ?? "not_run",
		verificationEvidenceJson: data.verificationEvidenceJson ?? null,
		commitSha: data.commitSha ?? null,
		commitMessage: data.commitMessage ?? null,
		pushStatus: data.pushStatus ?? null,
		pushedAt: data.pushedAt ?? null,
		pushRemote: data.pushRemote ?? null,
		pushBranch: data.pushBranch ?? null,
		statusReason: data.statusReason ?? null,
		createdAt: now,
		updatedAt: now,
	};
	const updateValues = {
		repositoryId: values.repositoryId,
		status: values.status,
		baselineHead: values.baselineHead,
		baselineStatusJson: values.baselineStatusJson,
		preExistingDirtyPathsJson: values.preExistingDirtyPathsJson,
		ownedCandidatePathsJson: values.ownedCandidatePathsJson,
		stageableOwnedPathsJson: values.stageableOwnedPathsJson,
		excludedPathsJson: values.excludedPathsJson,
		verificationStatus: values.verificationStatus,
		verificationEvidenceJson: values.verificationEvidenceJson,
		commitSha: values.commitSha,
		commitMessage: values.commitMessage,
		pushStatus: values.pushStatus,
		pushedAt: values.pushedAt,
		pushRemote: values.pushRemote,
		pushBranch: values.pushBranch,
		statusReason: values.statusReason,
		updatedAt: now,
	};
	const [record] = await db
		.insert(taskRunCommitRecords)
		.values(values)
		.onConflictDoUpdate({
			target: taskRunCommitRecords.runId,
			set: updateValues,
		})
		.returning();
	return record;
}

export async function getTaskRunCommitRecord(runId: string) {
	const [record] = await db
		.select()
		.from(taskRunCommitRecords)
		.where(eq(taskRunCommitRecords.runId, runId));
	return record ?? null;
}

export async function updateTaskRunCommitRecord(
	runId: string,
	data: {
		status?: string;
		ownedCandidatePaths?: string[];
		stageableOwnedPaths?: string[];
		excludedPaths?: Array<{ path: string; reason: string }>;
		verificationStatus?: "not_run" | "passed" | "failed" | "partial";
		verificationEvidenceJson?: unknown;
		commitSha?: string | null;
		commitMessage?: string | null;
		pushStatus?: string | null;
		pushedAt?: Date | null;
		pushRemote?: string | null;
		pushBranch?: string | null;
		statusReason?: string | null;
	},
) {
	const updateValues = {
		...(data.status !== undefined ? { status: data.status } : {}),
		...(data.ownedCandidatePaths !== undefined
			? { ownedCandidatePathsJson: data.ownedCandidatePaths }
			: {}),
		...(data.stageableOwnedPaths !== undefined
			? { stageableOwnedPathsJson: data.stageableOwnedPaths }
			: {}),
		...(data.excludedPaths !== undefined
			? { excludedPathsJson: data.excludedPaths }
			: {}),
		...(data.verificationStatus !== undefined
			? { verificationStatus: data.verificationStatus }
			: {}),
		...(data.verificationEvidenceJson !== undefined
			? { verificationEvidenceJson: data.verificationEvidenceJson }
			: {}),
		...(data.commitSha !== undefined ? { commitSha: data.commitSha } : {}),
		...(data.commitMessage !== undefined
			? { commitMessage: data.commitMessage }
			: {}),
		...(data.pushStatus !== undefined ? { pushStatus: data.pushStatus } : {}),
		...(data.pushedAt !== undefined ? { pushedAt: data.pushedAt } : {}),
		...(data.pushRemote !== undefined ? { pushRemote: data.pushRemote } : {}),
		...(data.pushBranch !== undefined ? { pushBranch: data.pushBranch } : {}),
		...(data.statusReason !== undefined
			? { statusReason: data.statusReason }
			: {}),
		updatedAt: new Date(),
	};
	const [record] = await db
		.update(taskRunCommitRecords)
		.set(updateValues)
		.where(eq(taskRunCommitRecords.runId, runId))
		.returning();
	return record ?? null;
}

export async function listTaskRunsForTask(taskId: string) {
	return db
		.select()
		.from(taskRuns)
		.where(eq(taskRuns.taskId, taskId))
		.orderBy(desc(taskRuns.startedAt));
}

export async function listNeedsHumanTaskRuns() {
	return db
		.select()
		.from(taskRuns)
		.where(eq(taskRuns.status, "needs_human"))
		.orderBy(desc(taskRuns.updatedAt));
}

export async function listActiveTaskRunsForTask(taskId: string) {
	return db
		.select()
		.from(taskRuns)
		.where(
			and(
				eq(taskRuns.taskId, taskId),
				inArray(taskRuns.status, [
					"running",
					"context_compiling",
					"finalizing",
				]),
			),
		);
}

export async function countActiveTaskRuns(repositoryId?: string) {
	const rows = await db
		.select({ count: sql<number>`count(*)` })
		.from(taskRuns)
		.where(
			repositoryId
				? and(
						eq(taskRuns.repositoryId, repositoryId),
						inArray(taskRuns.status, [
							"running",
							"context_compiling",
							"finalizing",
						]),
					)
				: inArray(taskRuns.status, [
						"running",
						"context_compiling",
						"finalizing",
					]),
		);
	return Number(rows[0]?.count ?? 0);
}

export async function claimNextQueuedTask(repositoryId: string) {
	const [task] = await db
		.select()
		.from(tasks)
		.where(
			and(
				eq(tasks.repositoryId, repositoryId),
				inArray(tasks.status, ["ready", "queued"]),
				sql`not exists (
          select 1 from implementation_queue_entries iqe
          where iqe.task_id = ${tasks.id}
            and iqe.status in ('queued', 'claimed', 'processing', 'needs_human', 'awaiting_commit_decision', 'execution_completed', 'failed', 'cancelled')
        )`,
			),
		)
		.orderBy(desc(tasks.priority), asc(tasks.updatedAt))
		.limit(1);
	if (!task) return null;
	const [claimed] = await db
		.update(tasks)
		.set({ status: "running", updatedAt: new Date() })
		.where(
			and(eq(tasks.id, task.id), inArray(tasks.status, ["ready", "queued"])),
		)
		.returning();
	if (claimed) {
		nightWorkersRealtimeBroker.publish(claimed.id, {
			type: "task_status_updated",
			payload: { status: claimed.status, task: claimed },
		});
	}
	return claimed ?? null;
}

type TaskRunUpdateData = {
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

export async function publishTaskRunUpdate(run: typeof taskRuns.$inferSelect) {
	nightWorkersRealtimeBroker.publish(run.taskId, {
		type: "task_run_updated",
		runId: run.id,
		payload: { run },
	});
	await notifyTaskRunUpdatedListeners(run);
}

export async function updateTaskRun(id: string, data: TaskRunUpdateData) {
	const [run] = await db
		.update(taskRuns)
		.set({ ...data, updatedAt: new Date() })
		.where(eq(taskRuns.id, id))
		.returning();
	if (run) await publishTaskRunUpdate(run);
	return run;
}

export async function updateTaskRunIfStatus(
	id: string,
	expectedStatus: TaskRunStatus | readonly TaskRunStatus[],
	data: TaskRunUpdateData,
) {
	const expectedStatuses = Array.isArray(expectedStatus)
		? [...expectedStatus]
		: [expectedStatus];
	const [run] = await db
		.update(taskRuns)
		.set({ ...data, updatedAt: new Date() })
		.where(and(eq(taskRuns.id, id), inArray(taskRuns.status, expectedStatuses)))
		.returning();
	if (run) await publishTaskRunUpdate(run);
	return run;
}

export async function updateTaskRunIfStatusAndTodoRevision(input: {
	runId: string;
	expectedStatus: TaskRunStatus;
	todoId: string;
	expectedTodoStatus: typeof taskRunTodos.$inferSelect.status;
	expectedTodoRevision: number;
	data: TaskRunUpdateData;
}) {
	const matchingTodo = db
		.select({ id: taskRunTodos.id })
		.from(taskRunTodos)
		.where(
			and(
				eq(taskRunTodos.runId, input.runId),
				eq(taskRunTodos.id, input.todoId),
				eq(taskRunTodos.status, input.expectedTodoStatus),
				eq(taskRunTodos.revision, input.expectedTodoRevision),
			),
		);
	const [run] = await db
		.update(taskRuns)
		.set({ ...input.data, updatedAt: new Date() })
		.where(
			and(
				eq(taskRuns.id, input.runId),
				eq(taskRuns.status, input.expectedStatus),
				exists(matchingTodo),
			),
		)
		.returning();
	if (run) await publishTaskRunUpdate(run);
	return run ?? null;
}

export async function updateTaskRunIfStatusWithoutPublish(
	id: string,
	expectedStatus: TaskRunStatus | readonly TaskRunStatus[],
	data: TaskRunUpdateData,
) {
	const expectedStatuses = Array.isArray(expectedStatus)
		? [...expectedStatus]
		: [expectedStatus];
	const [run] = await db
		.update(taskRuns)
		.set({ ...data, updatedAt: new Date() })
		.where(and(eq(taskRuns.id, id), inArray(taskRuns.status, expectedStatuses)))
		.returning();
	return run;
}

export async function heartbeatActiveTaskRun(id: string) {
	const [run] = await db
		.update(taskRuns)
		.set({ updatedAt: new Date() })
		.where(
			and(
				eq(taskRuns.id, id),
				inArray(taskRuns.status, [
					"running",
					"context_compiling",
					"finalizing",
				]),
			),
		)
		.returning();
	if (run) await publishTaskRunUpdate(run);
	return run ?? null;
}

// --- Task Run Todos (read-only; all writes go through TodoMutationService) ---
export async function listTaskRunTodosForRun(runId: string) {
	return withSqliteBusyRetry(() =>
		db
			.select()
			.from(taskRunTodos)
			.where(eq(taskRunTodos.runId, runId))
			.orderBy(taskRunTodos.seq),
	);
}

// --- Task Events ---
