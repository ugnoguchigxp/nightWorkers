import type { MissionPilotTaskEventType } from "../../../contracts";
import { callMissionPilotPersistence } from "../../persistence-port";

export function appendMissionPilotTaskEvent(input: {
	taskId: string;
	eventType: MissionPilotTaskEventType;
	sourceEventId: string;
	taskRevision: number;
	payload: unknown;
	availableAt?: Date;
}) {
	return callMissionPilotPersistence("appendMissionPilotTaskEvent", input);
}

export function projectMissionPilotNextWakeAt(
	sessionId: string,
	now = new Date(),
) {
	return callMissionPilotPersistence(
		"projectMissionPilotNextWakeAt",
		sessionId,
		now,
	);
}

export function projectMissionPilotExecutionEvent(input: {
	taskId: string;
	type: "task.run.started" | "task.run.terminal" | "task.run.failed";
	runId: string;
}) {
	return callMissionPilotPersistence(
		"projectMissionPilotExecutionEvent",
		input,
	);
}

export function listPendingMissionPilotTaskEvents(
	sessionId: string,
	now = new Date(),
) {
	return callMissionPilotPersistence<
		Array<{
			sequence: number;
			eventType: MissionPilotTaskEventType;
			[key: string]: unknown;
		}>
	>("listPendingMissionPilotTaskEvents", sessionId, now);
}

export function getNextMissionPilotTaskEventAt(sessionId: string) {
	return callMissionPilotPersistence<Date | null>(
		"getNextMissionPilotTaskEventAt",
		sessionId,
	);
}

export function consumeMissionPilotTaskEventBySource(
	sessionId: string,
	sourceEventId: string,
) {
	return callMissionPilotPersistence<boolean>(
		"consumeMissionPilotTaskEventBySource",
		sessionId,
		sourceEventId,
	);
}

export function consumePendingMissionPilotQuestionnaireEvents(input: {
	sessionId: string;
	questionnaireSessionId: string;
	status: string;
}) {
	return callMissionPilotPersistence(
		"consumePendingMissionPilotQuestionnaireEvents",
		input,
	);
}

export function hasConsumedMissionPilotQuestionnaireAnsweringEvent(input: {
	sessionId: string;
	questionnaireSessionId: string;
	now?: Date;
}) {
	return callMissionPilotPersistence<boolean>(
		"hasConsumedMissionPilotQuestionnaireAnsweringEvent",
		input,
	);
}

export function cancelMissionPilotProviderRetryEvents(sessionId: string) {
	return callMissionPilotPersistence(
		"cancelMissionPilotProviderRetryEvents",
		sessionId,
	);
}
