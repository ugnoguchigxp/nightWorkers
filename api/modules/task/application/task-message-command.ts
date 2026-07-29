import { eq } from "drizzle-orm";
import type { TraceProvenance } from "../../../../shared/schemas/trace-provenance.schema";
import { db } from "../../../db/client";
import { tasks } from "../../../db/schema";
import { AppError, NotFoundError } from "../../../lib/errors";
import { createTaskMessage } from "../../nightworkers/nightworkers.repository";
import { publishTaskMessageCreated } from "../events/task-message-events";

export async function sendTaskOperatorMessage(
	taskId: string,
	content: string,
	metadata?: Record<string, unknown>,
	trace?: TraceProvenance,
) {
	const [task] = await db
		.select({ id: tasks.id })
		.from(tasks)
		.where(eq(tasks.id, taskId));
	if (!task) throw new NotFoundError("Task not found");
	const trimmed = content.trim();
	if (!trimmed)
		throw new AppError(
			400,
			"EMPTY_ASSISTANT_MESSAGE",
			"Message must not be empty",
		);
	const message = await createTaskMessage({
		taskId,
		role: "assistant",
		content: trimmed,
		messageType: "text",
		payloadJson: metadata,
		trace,
	});
	if (message) publishTaskMessageCreated(message);
	return message;
}
