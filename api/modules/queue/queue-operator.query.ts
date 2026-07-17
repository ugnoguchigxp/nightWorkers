import { desc, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { implementationQueueEntries } from "../../db/schema";

export async function readQueueOperatorState(taskId: string) {
	const [entry] = await db
		.select({
			id: implementationQueueEntries.id,
			updatedAt: implementationQueueEntries.updatedAt,
			status: implementationQueueEntries.status,
			activeRunId: implementationQueueEntries.activeRunId,
		})
		.from(implementationQueueEntries)
		.where(eq(implementationQueueEntries.taskId, taskId))
		.orderBy(desc(implementationQueueEntries.createdAt))
		.limit(1);
	return entry
		? {
				id: entry.id,
				revision: entry.updatedAt.getTime(),
				status: entry.status,
				activeRunId: entry.activeRunId,
			}
		: null;
}
