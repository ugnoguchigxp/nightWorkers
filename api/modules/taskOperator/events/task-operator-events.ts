import { logEvent } from "../../../lib/logger";
import { registerTaskRunUpdatedListener } from "../../run";
import { readTaskOperatorTask } from "../../task/application/task-operator.query";

export type TaskOperatorExecutionEvent = {
	eventId: string;
	type: "task.run.started" | "task.run.terminal" | "task.run.failed";
	taskRef: { id: string; revision: number };
	resourceRef: { kind: "run"; id: string; revision: number };
	status: string;
	occurredAt: string;
};

type Listener = (event: TaskOperatorExecutionEvent) => Promise<void> | void;

const listeners = new Set<Listener>();
let initialized = false;

export function registerTaskOperatorExecutionEventListener(listener: Listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function initializeTaskOperatorExecutionEvents() {
	if (initialized) return;
	initialized = true;
	registerTaskRunUpdatedListener(async (run) => {
		const type = eventType(run.status);
		if (!type) return;
		const task = await readTaskOperatorTask(run.taskId);
		const event: TaskOperatorExecutionEvent = {
			eventId: `task-run:${run.id}:${run.status}:${run.updatedAt.getTime()}`,
			type,
			taskRef: { id: run.taskId, revision: task.revision },
			resourceRef: {
				kind: "run",
				id: run.id,
				revision: run.updatedAt.getTime(),
			},
			status: run.status,
			occurredAt: run.updatedAt.toISOString(),
		};
		const deliveries = await Promise.allSettled(
			[...listeners].map((listener) => listener(event)),
		);
		for (const delivery of deliveries)
			if (delivery.status === "rejected")
				logEvent({
					channel: "task-operator-events",
					level: "error",
					message: "Task Operator event listener delivery failed.",
					meta: {
						eventId: event.eventId,
						eventType: event.type,
						taskId: event.taskRef.id,
						errorMessage:
							delivery.reason instanceof Error
								? delivery.reason.message
								: String(delivery.reason),
					},
				});
	});
}

function eventType(status: string): TaskOperatorExecutionEvent["type"] | null {
	if (status === "running") return "task.run.started";
	if (
		["failed", "cancelled", "blocked", "timed_out", "needs_human"].includes(
			status,
		)
	)
		return "task.run.failed";
	if (["completed", "needs_review"].includes(status))
		return "task.run.terminal";
	return null;
}
