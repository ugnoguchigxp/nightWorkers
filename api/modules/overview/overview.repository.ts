import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../../db/client";
import {
	llmUsageRecords,
	repositories,
	taskRuns,
	tasks,
} from "../../db/schema";

const ACTIVE_STATUSES = new Set(["running", "context_compiling", "finalizing"]);
const FAILED_STATUSES = new Set(["failed", "timed_out"]);

export async function getOverviewRunSummary(input: {
	repositoryId?: string | null;
	cutoff: Date | null;
}) {
	const conditions = [];
	if (input.repositoryId) {
		conditions.push(eq(taskRuns.repositoryId, input.repositoryId));
	}
	if (input.cutoff) {
		conditions.push(gte(taskRuns.startedAt, input.cutoff));
	}
	const rows = await db
		.select({ status: taskRuns.status })
		.from(taskRuns)
		.where(conditions.length ? and(...conditions) : undefined);

	return {
		total: rows.length,
		completed: rows.filter((row) => row.status === "completed").length,
		failed: rows.filter((row) => FAILED_STATUSES.has(row.status)).length,
		active: rows.filter((row) => ACTIVE_STATUSES.has(row.status)).length,
	};
}

export async function overviewRepositoryExists(repositoryId: string) {
	const [repository] = await db
		.select({ id: repositories.id })
		.from(repositories)
		.where(eq(repositories.id, repositoryId))
		.limit(1);
	return Boolean(repository);
}

export async function countRawOverviewUsageRows(input: {
	cutoff: Date | null;
	repositoryId?: string | null;
}) {
	const conditions = [];
	if (input.cutoff)
		conditions.push(gte(llmUsageRecords.createdAt, input.cutoff));
	if (input.repositoryId)
		conditions.push(eq(tasks.repositoryId, input.repositoryId));
	const [row] = await db
		.select({ count: sql<number>`count(*)` })
		.from(llmUsageRecords)
		.leftJoin(tasks, eq(llmUsageRecords.taskId, tasks.id))
		.where(conditions.length ? and(...conditions) : undefined);
	return Number(row?.count ?? 0);
}
