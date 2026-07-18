import type { RunTerminalOutcome } from "../contracts/task-run-execution";

export type TaskRunTerminalEvent = RunTerminalOutcome & {
	type: "task_run.terminal";
};

type Listener = (event: TaskRunTerminalEvent) => void | Promise<void>;
const listeners = new Set<Listener>();

export type TaskRunTerminalPublicationResult = {
	listenerCount: number;
	failures: unknown[];
};

export function registerTaskRunTerminalListener(listener: Listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export async function publishTaskRunTerminal(
	event: TaskRunTerminalEvent,
): Promise<TaskRunTerminalPublicationResult> {
	const settled = await Promise.allSettled(
		[...listeners].map((listener) =>
			Promise.resolve().then(() => listener(event)),
		),
	);
	return {
		listenerCount: settled.length,
		failures: settled.flatMap((result) =>
			result.status === "rejected" ? [result.reason] : [],
		),
	};
}
