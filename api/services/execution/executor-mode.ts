export type TaskExecutorMode = "process" | "in_process";

export function readTaskExecutorMode(
	env: NodeJS.ProcessEnv = process.env,
): TaskExecutorMode {
	if (env.NIGHTWORKERS_EXECUTION_ROLE === "worker") return "in_process";
	const configured = env.NIGHTWORKERS_EXECUTOR_MODE?.trim().toLowerCase();
	if (configured === "in_process" || configured === "in-process") {
		return "in_process";
	}
	if (configured === "process") return "process";
	return "in_process";
}

export function shouldUseIsolatedTaskExecutor(
	env: NodeJS.ProcessEnv = process.env,
) {
	return readTaskExecutorMode(env) === "process";
}
