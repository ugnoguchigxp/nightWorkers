import { getSessionByTaskId } from "../mission-pilot.repository";
import { scheduleMissionPilotAgentWake } from "./mission-pilot-agent-wake.service";
import { appendMissionPilotTaskEvent } from "./mission-pilot-task-event.repository";

export async function recordMissionPilotTaskEvent(input: {
	taskId: string;
	type: Parameters<typeof appendMissionPilotTaskEvent>[0]["eventType"];
	sourceEventId: string;
	taskRevision: number;
	payload: unknown;
}) {
	const event = await appendMissionPilotTaskEvent({
		taskId: input.taskId,
		eventType: input.type,
		sourceEventId: input.sourceEventId,
		taskRevision: input.taskRevision,
		payload: input.payload,
	});
	if (!event) return null;
	const session = await getSessionByTaskId(input.taskId);
	if (session?.runtimeKind === "agent" && session.desiredState === "playing") {
		scheduleMissionPilotAgentWake({ sessionId: session.id });
	}
	return event;
}

export async function recordMissionPilotUserTaskEvent(input: {
	taskId: string;
	type: "task.user_message_added" | "task.state_changed";
	sourceEventId: string;
	taskRevision: number;
	payload: unknown;
}) {
	return recordMissionPilotTaskEvent(input);
}
