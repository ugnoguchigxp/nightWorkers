import type { CallSupervisorOptions } from "./types";

export async function authorizeStructuredProviderCall(
	options: Pick<CallSupervisorOptions, "executionPolicy" | "signal" | "taskId">,
) {
	options.signal?.throwIfAborted();
	await options.executionPolicy?.authorizeProviderCall?.({
		taskId: options.taskId ?? null,
		signal: options.signal,
	});
	options.signal?.throwIfAborted();
}
