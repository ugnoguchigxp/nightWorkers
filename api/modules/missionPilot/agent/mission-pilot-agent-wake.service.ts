import { runMissionPilotAgentWake } from "./mission-pilot-agent-runtime";
import {
	getMissionPilotAgentSessionById,
	getMissionPilotSessionById,
} from "./mission-pilot-agent-session.repository";
import { listPendingMissionPilotTaskEvents } from "./mission-pilot-task-event.repository";

const scheduled = new Set<string>();
export function scheduleMissionPilotAgentWake(input: {
	sessionId: string;
	providerEndpointId?: string | null;
	model?: string | null;
	thinkingDepth?: string | null;
}) {
	if (scheduled.has(input.sessionId)) return false;
	scheduled.add(input.sessionId);
	queueMicrotask(() => {
		void runMissionPilotAgentWake(input)
			.finally(async () => {
				scheduled.delete(input.sessionId);
				const [session, agent, pendingEvents] = await Promise.all([
					getMissionPilotSessionById(input.sessionId),
					getMissionPilotAgentSessionById(input.sessionId),
					listPendingMissionPilotTaskEvents(input.sessionId),
				]);
				if (
					session?.desiredState === "playing" &&
					agent?.runtimeState !== "running" &&
					agent?.runtimeState !== "completed" &&
					pendingEvents.length > 0
				)
					scheduleMissionPilotAgentWake(input);
			})
			.catch(() => scheduled.delete(input.sessionId));
	});
	return true;
}
export async function runMissionPilotAgentWakeAndPublish(
	input: Parameters<typeof runMissionPilotAgentWake>[0],
) {
	return runMissionPilotAgentWake(input);
}
