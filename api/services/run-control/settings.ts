import type { AgentRunContext } from "../agent-runtime/types";

export type RunControlKernelMode = "disabled" | "observe" | "enforce";

export function readRunControlKernelMode(
	context?: Pick<AgentRunContext, "runtimeOptions">,
): RunControlKernelMode {
	const runtimeValue = context?.runtimeOptions?.runControlKernelMode;
	if (isMode(runtimeValue)) return runtimeValue;
	const environmentValue = process.env.NIGHTWORKERS_RUN_CONTROL_KERNEL_MODE;
	if (isMode(environmentValue)) return environmentValue;
	return process.env.NODE_ENV === "test" ? "observe" : "enforce";
}

function isMode(value: unknown): value is RunControlKernelMode {
	return value === "disabled" || value === "observe" || value === "enforce";
}
