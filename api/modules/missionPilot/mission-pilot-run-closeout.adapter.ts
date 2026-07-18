import { registerTaskRunCloseoutHandler } from "../agentsShare";
import {
	applyMissionPilotParentTaskStatus,
	continueMissionPilotAfterRun,
} from "./mission-pilot-post-queue-coordinator.service";
import {
	executeMissionPilotContinuation,
	markMissionPilotContinuationFailed,
} from "./mission-pilot-runtime-continuation.service";

let initialized = false;

export function initializeMissionPilotTaskRunCloseout() {
	if (initialized) return;
	initialized = true;
	registerTaskRunCloseoutHandler({
		projectParentTaskStatus: applyMissionPilotParentTaskStatus,
		continueAfterRun: async (input) => {
			try {
				const continuation = await continueMissionPilotAfterRun(input);
				await executeMissionPilotContinuation(continuation);
			} catch (error) {
				await markMissionPilotContinuationFailed(input.runId, error);
				throw error;
			}
		},
	});
}
