import { callMissionPilotPersistence } from "../persistence-port";
import type { MissionPilotSessionRecord } from "./repository";

export function claimStop(taskId: string, expectedVersion: number) {
	return callMissionPilotPersistence<MissionPilotSessionRecord | null>(
		"claimStop",
		taskId,
		expectedVersion,
	);
}

export function finishStop(
	taskId: string,
	expectedVersion: number,
	error?: string,
	remainingActiveRunId?: string | null,
	errorCode?: string,
	initialPromptState?: "failed",
) {
	return callMissionPilotPersistence<MissionPilotSessionRecord | null>(
		"finishStop",
		taskId,
		expectedVersion,
		error,
		remainingActiveRunId,
		errorCode,
		initialPromptState,
	);
}
