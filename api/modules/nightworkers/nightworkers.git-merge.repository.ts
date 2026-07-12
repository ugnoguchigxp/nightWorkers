import { and, eq } from "drizzle-orm";
import { type DbTransaction, db } from "../../db/client";
import { taskGitWorkspaces, taskRunMergeRecords, tasks } from "../../db/schema";
import { AppError } from "../../lib/errors";

export async function getTaskRunMergeRecord(runId: string) {
	const [record] = await db
		.select()
		.from(taskRunMergeRecords)
		.where(eq(taskRunMergeRecords.runId, runId))
		.limit(1);
	return record ?? null;
}

export async function createTaskRunMergeRecord(
	data: typeof taskRunMergeRecords.$inferInsert,
) {
	const [record] = await db
		.insert(taskRunMergeRecords)
		.values(data)
		.returning();
	return record;
}

export async function compareAndSetTaskRunMergeRecord(
	input: {
		id: string;
		expectedVersion: number;
		data: Partial<typeof taskRunMergeRecords.$inferInsert>;
	},
	database: typeof db | DbTransaction = db,
) {
	const [record] = await database
		.update(taskRunMergeRecords)
		.set({
			...input.data,
			recordVersion: input.expectedVersion + 1,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(taskRunMergeRecords.id, input.id),
				eq(taskRunMergeRecords.recordVersion, input.expectedVersion),
			),
		)
		.returning();
	return record ?? null;
}

export async function persistMergedLifecycle(input: {
	record: typeof taskRunMergeRecords.$inferSelect;
	expectedVersion: number;
	mergeOrigin: "already_ancestor" | "local";
	targetHeadAfter: string;
	mergeCommitSha?: string;
}) {
	return db.transaction(async (tx) => {
		const updated = await compareAndSetTaskRunMergeRecord(
			{
				id: input.record.id,
				expectedVersion: input.expectedVersion,
				data: {
					decision: "merge",
					status: "merged",
					mergeOrigin: input.mergeOrigin,
					mergeCommitSha: input.mergeCommitSha,
					targetHeadAfter: input.targetHeadAfter,
					mergedAt: new Date(),
					decidedAt: new Date(),
				},
			},
			tx,
		);
		if (!updated)
			throw new AppError(
				409,
				"merge_record_changed",
				"Merge record changed during merge",
			);
		await tx
			.update(taskGitWorkspaces)
			.set({ status: "merged", updatedAt: new Date() })
			.where(eq(taskGitWorkspaces.id, input.record.workspaceId));
		await tx
			.update(tasks)
			.set({
				status: "completed",
				completedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(tasks.id, input.record.taskId));
		return updated;
	});
}
