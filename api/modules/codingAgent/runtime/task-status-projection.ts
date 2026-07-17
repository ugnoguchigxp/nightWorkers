import type { TaskRunStatus, TaskStatus } from "../../../db/schema";
import type { CodingAgentInvocationSource } from "../context/system-context";

export function projectCodingAgentTaskStatusAfterRun(input: {
	runStatus: TaskRunStatus;
	invocationSource: CodingAgentInvocationSource;
	planModeRequested: boolean;
}): TaskStatus | null {
	if (
		input.invocationSource === "user" &&
		input.planModeRequested &&
		input.runStatus === "completed"
	) {
		return "ready";
	}
	return null;
}
