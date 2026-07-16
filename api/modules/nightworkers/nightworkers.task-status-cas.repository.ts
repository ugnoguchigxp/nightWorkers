import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { type TaskStatus, tasks } from "../../db/schema";
import { nightWorkersRealtimeBroker } from "../../services/realtime/nightworkers-ws";

export async function updateTaskStatusIfUnchanged(input: {
	id: string;
	status: TaskStatus;
	expectedStatus: TaskStatus;
	expectedUpdatedAt: Date;
}) {
	const now = new Date();
	const [task] = await db
		.update(tasks)
		.set({
			status: input.status,
			updatedAt: now,
			...(input.status === "completed" ? { completedAt: now } : {}),
			...(input.status === "archived" ? { archivedAt: now } : {}),
		})
		.where(
			and(
				eq(tasks.id, input.id),
				eq(tasks.status, input.expectedStatus),
				eq(tasks.updatedAt, input.expectedUpdatedAt),
			),
		)
		.returning();
	if (task)
		nightWorkersRealtimeBroker.publish(task.id, {
			type: "task_status_updated",
			payload: { status: task.status, task },
		});
	return task ?? null;
}
