import type { taskMessages } from "../../../db/schema";
import { logEvent } from "../../../lib/logger";

type TaskMessage = typeof taskMessages.$inferSelect;
type TaskMessageCreatedListener = (
	message: TaskMessage,
) => Promise<void> | void;

const listeners = new Set<TaskMessageCreatedListener>();

export function registerTaskMessageCreatedListener(
	listener: TaskMessageCreatedListener,
) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function publishTaskMessageCreated(message: TaskMessage) {
	for (const listener of listeners) {
		try {
			void Promise.resolve(listener(message)).catch((error) =>
				logListenerFailure(message, error),
			);
		} catch (error) {
			logListenerFailure(message, error);
		}
	}
}

function logListenerFailure(message: TaskMessage, error: unknown) {
	logEvent({
		channel: "api",
		level: "error",
		message: "task message listener failed",
		meta: {
			taskId: message.taskId,
			messageId: message.id,
			errorMessage: error instanceof Error ? error.message : String(error),
		},
	});
}
