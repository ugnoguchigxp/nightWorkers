import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { taskRunActionRecords } from "../../db/schema";

export async function getRunControlMetrics(runId: string) {
	try {
		const [metrics] = await db
			.select({
				actionCount: sql<number>`count(*)`,
				reusedActionCount: sql<number>`coalesce(sum(${taskRunActionRecords.repeatCount}), 0)`,
				domainFailureCount: sql<number>`coalesce(sum(case when ${taskRunActionRecords.domainOutcome} = 'failed' then 1 else 0 end), 0)`,
				transportFailureCount: sql<number>`coalesce(sum(case when ${taskRunActionRecords.transportStatus} = 'failed' then 1 else 0 end), 0)`,
				modelVisibleChars: sql<number>`coalesce(sum(length(${taskRunActionRecords.modelViewJson})), 0)`,
			})
			.from(taskRunActionRecords)
			.where(eq(taskRunActionRecords.runId, runId));
		return {
			state: null,
			actionCount: Number(metrics?.actionCount ?? 0),
			reusedActionCount: Number(metrics?.reusedActionCount ?? 0),
			domainFailureCount: Number(metrics?.domainFailureCount ?? 0),
			transportFailureCount: Number(metrics?.transportFailureCount ?? 0),
			modelVisibleChars: Number(metrics?.modelVisibleChars ?? 0),
		};
	} catch {
		return null;
	}
}
