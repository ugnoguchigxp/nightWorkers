import type { TaskRunStatus, TaskStatus } from "../../../db/schema";

export function projectCodingAgentTaskStatusAfterRun(input: {
	runStatus: TaskRunStatus;
	planModeRequested: boolean;
}): TaskStatus | null {
	if (input.planModeRequested && input.runStatus === "completed") {
		return "ready";
	}
	return null;
}
