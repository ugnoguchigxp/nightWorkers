import { eq } from "drizzle-orm";
import type { TraceProvenance } from "../../../../shared/schemas/trace-provenance.schema";
import { db } from "../../../db/client";
import { tasks } from "../../../db/schema";
import { AppError, NotFoundError } from "../../../lib/errors";
import {
	createTaskMessage,
	listTaskMessages,
} from "../../nightworkers/nightworkers.repository";
import { publishTaskMessageCreated } from "../events/task-message-events";

export async function sendTaskOperatorMessage(
	taskId: string,
	content: string,
	metadata?: Record<string, unknown>,
	trace?: TraceProvenance,
) {
	return sendTaskChatMessage({
		taskId,
		content,
		metadata,
		trace,
		role: "assistant",
		emptyCode: "EMPTY_ASSISTANT_MESSAGE",
	});
}

export async function sendTaskOperatorUserMessage(
	taskId: string,
	content: string,
	metadata?: Record<string, unknown>,
	deduplicationKey?: string,
) {
	return sendTaskChatMessage({
		taskId,
		content,
		metadata,
		deduplicationKey,
		role: "user",
		emptyCode: "EMPTY_USER_MESSAGE",
	});
}

async function sendTaskChatMessage(input: {
	taskId: string;
	content: string;
	metadata?: Record<string, unknown>;
	trace?: TraceProvenance;
	deduplicationKey?: string;
	role: "user" | "assistant";
	emptyCode: "EMPTY_USER_MESSAGE" | "EMPTY_ASSISTANT_MESSAGE";
}) {
	const [task] = await db
		.select({ id: tasks.id })
		.from(tasks)
		.where(eq(tasks.id, input.taskId));
	if (!task) throw new NotFoundError("Task not found");
	const trimmed = input.content.trim();
	if (!trimmed)
		throw new AppError(400, input.emptyCode, "Message must not be empty");
	if (input.deduplicationKey) {
		const identity = messageDeduplicationIdentity(
			input.metadata,
			input.deduplicationKey,
		);
		const existing = identity
			? (await listTaskMessages(input.taskId)).find(
					(message) =>
						message.role === input.role &&
						messageDeduplicationIdentity(message.metadataJson) === identity,
				)
			: null;
		if (existing) {
			if (existing.content !== trimmed)
				throw new AppError(
					409,
					"TASK_MESSAGE_REQUEST_CONFLICT",
					"The message request identity was already used with different content.",
				);
			return existing;
		}
	}
	const message = await createTaskMessage({
		taskId: input.taskId,
		role: input.role,
		content: trimmed,
		messageType: "text",
		payloadJson: input.metadata,
		trace: input.trace,
	});
	if (message) publishTaskMessageCreated(message);
	return message;
}

function messageDeduplicationIdentity(
	metadata: unknown,
	requestIdOverride?: string,
) {
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
		return null;
	const record = metadata as Record<string, unknown>;
	const actor = record.actor;
	const provenance = record.commandProvenance;
	if (
		!actor ||
		typeof actor !== "object" ||
		Array.isArray(actor) ||
		!provenance ||
		typeof provenance !== "object" ||
		Array.isArray(provenance)
	)
		return null;
	const actorRecord = actor as Record<string, unknown>;
	const requestId =
		requestIdOverride ?? (provenance as Record<string, unknown>).requestId;
	return typeof actorRecord.kind === "string" &&
		typeof actorRecord.actorId === "string" &&
		typeof requestId === "string"
		? JSON.stringify([actorRecord.kind, actorRecord.actorId, requestId])
		: null;
}
