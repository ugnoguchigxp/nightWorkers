import { callMissionPilotPersistence } from "../../persistence-port";
import type { TaskOperatorProjectionV1 } from "../../taskOperator";
import type { MissionPilotTaskReadPort } from "./mission-pilot-agent.ports";

export type MissionPilotCurrentStepContext = {
	version: 1;
	taskRef: { id: string; revision: number | null; status: string };
	sourceDigest: string | null;
	changedSincePreviousTurn: {
		eventTypes: string[];
		resourceRefs: Array<{ kind: string; id: string; revision: number }>;
	};
	activeRunRef: { id: string; status: string } | null;
	currentTodoRef: {
		id: string;
		revision: number;
		status: string;
		blockerDigest: string | null;
	} | null;
	availableActionIds: string[];
	unreadEventRange: { from: number | null; through: number | null };
	readFailure?: { code: string; message: string };
	headProjection?: TaskOperatorProjectionV1;
};

export function buildMissionPilotCurrentStepContext(input: {
	sessionId: string;
	taskId: string;
	readPort: MissionPilotTaskReadPort;
	triggerEvents?: ReadonlyArray<{ sequence: number; eventType: string }>;
}): Promise<MissionPilotCurrentStepContext> {
	return callMissionPilotPersistence(
		"buildMissionPilotCurrentStepContext",
		input,
	);
}

export function serializeMissionPilotCurrentStepContext(
	context: MissionPilotCurrentStepContext,
) {
	return JSON.stringify(context);
}

export type MissionPilotCurrentStepWorkspace = TaskOperatorProjectionV1;
