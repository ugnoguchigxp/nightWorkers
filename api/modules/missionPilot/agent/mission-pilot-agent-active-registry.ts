const activeTaskIds = new Set<string>();

export function markMissionPilotAgentTaskActive(taskId: string) {
	activeTaskIds.add(taskId);
}

export function clearMissionPilotAgentTaskActive(taskId: string) {
	activeTaskIds.delete(taskId);
}

export function isMissionPilotAgentTaskActive(taskId: string) {
	return activeTaskIds.has(taskId);
}
