import { callMissionPilotPersistence } from "../../persistence-port";

export type MissionPilotRuntimeOwnership =
	| { kind: "agent"; sessionId: string }
	| { kind: "none" };

export function resolveMissionPilotRuntimeOwnership(input: {
	sessionId?: string;
	taskId?: string;
}): Promise<MissionPilotRuntimeOwnership> {
	return callMissionPilotPersistence(
		"resolveMissionPilotRuntimeOwnership",
		input,
	);
}

export function isAgentMissionPilotRuntime(input: {
	sessionId?: string;
	taskId?: string;
}) {
	return callMissionPilotPersistence<boolean>(
		"isAgentMissionPilotRuntime",
		input,
	);
}
