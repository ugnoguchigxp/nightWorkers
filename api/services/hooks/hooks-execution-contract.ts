export const HOOK_OUTPUT_LIMIT_BYTES = 64 * 1024;
export const HOOK_DEFAULT_TIMEOUT_SECONDS = 30;

export type HookExecutionResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};
