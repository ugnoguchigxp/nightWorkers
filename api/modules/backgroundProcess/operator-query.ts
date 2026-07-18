import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { backgroundProcesses } from "../../db/schema";

export async function backgroundProcessBelongsToTask(
	taskId: string,
	processId: string,
) {
	const [process] = await db
		.select({ id: backgroundProcesses.id })
		.from(backgroundProcesses)
		.where(
			and(
				eq(backgroundProcesses.id, processId),
				eq(backgroundProcesses.taskId, taskId),
			),
		);
	return Boolean(process);
}
