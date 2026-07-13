import { eq } from "drizzle-orm";
import type { DbTransaction, db } from "../../../db/client";
import { type llmUsageRecords, tasks } from "../../../db/schema";

export type UsageSummaryDbExecutor = typeof db | DbTransaction;
export type UsageRecord = Omit<
	typeof llmUsageRecords.$inferSelect,
	"traceOwner" | "traceChannel"
>;

export async function resolveUsageRepositoryId(
	taskId: string,
	executor: UsageSummaryDbExecutor,
) {
	const [task] = await executor
		.select({ repositoryId: tasks.repositoryId })
		.from(tasks)
		.where(eq(tasks.id, taskId))
		.limit(1);
	return task?.repositoryId ?? null;
}
