import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { taskRunMergeRecords } from "../../db/schema";

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

export async function compareAndSetTaskRunMergeRecord(input: {
	id: string;
	expectedVersion: number;
	data: Partial<typeof taskRunMergeRecords.$inferInsert>;
}) {
	const [record] = await db
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
