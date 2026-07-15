import { publishMissionPilotUpdated } from "../mission-pilot-realtime";
import {
	type MissionPilotAgentRuntimeDependencies,
	runMissionPilotAgentWake,
} from "./mission-pilot-agent-runtime";
import { getMissionPilotSessionById } from "./mission-pilot-agent-session.repository";
import { toControlSummary } from "./mission-pilot-control-summary";

const scheduledRetries = new Set<string>();

export async function runMissionPilotAgentWakeAndPublish(
	input: Parameters<typeof runMissionPilotAgentWake>[0],
	dependencies?: MissionPilotAgentRuntimeDependencies,
) {
	const result = await runMissionPilotAgentWake(input, dependencies);
	const session = await getMissionPilotSessionById(input.sessionId);
	if (session) {
		publishMissionPilotUpdated(session.taskId, toControlSummary(session));
	}
	if (result.kind === "already_running") scheduleRetry(input, dependencies);
	return result;
}

export function scheduleMissionPilotAgentWake(
	input: Parameters<typeof runMissionPilotAgentWake>[0],
) {
	void runMissionPilotAgentWakeAndPublish(input).catch(() => undefined);
}

function scheduleRetry(
	input: Parameters<typeof runMissionPilotAgentWake>[0],
	dependencies?: MissionPilotAgentRuntimeDependencies,
) {
	if (scheduledRetries.has(input.sessionId)) return;
	scheduledRetries.add(input.sessionId);
	setTimeout(() => {
		scheduledRetries.delete(input.sessionId);
		void runMissionPilotAgentWakeAndPublish(input, dependencies).catch(
			() => undefined,
		);
	}, 25);
}
