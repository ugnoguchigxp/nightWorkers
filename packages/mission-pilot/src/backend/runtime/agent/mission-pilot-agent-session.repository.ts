import type { MissionPilotAuthorizationV4 } from "../../../contracts";
import { callMissionPilotPersistence } from "../../persistence-port";
import type { MissionPilotAgentRecord } from "../../persistence-records";
import type { MissionPilotSessionRecord } from "../../storage/repository";
import {
	clearMissionPilotAgentTaskActive,
	markMissionPilotAgentTaskActive,
} from "./mission-pilot-agent-active-registry";

export function backfillStoppedMissionPilotAgentSessions() {
	return callMissionPilotPersistence<number>(
		"backfillStoppedMissionPilotAgentSessions",
	);
}

export function isMissionPilotAgentSession(sessionId: string) {
	return callMissionPilotPersistence<boolean>(
		"isMissionPilotAgentSession",
		sessionId,
	);
}

export function getMissionPilotAgentSessionById(sessionId: string) {
	return callMissionPilotPersistence<MissionPilotAgentRecord | null>(
		"getMissionPilotAgentSessionById",
		sessionId,
	);
}

export async function claimAgentPlay(
	taskId: string,
	expectedVersion: number,
	principal?: {
		kind: "human";
		actorId: string;
		authorizationRef: string;
	},
	activation?: {
		systemContext: (authorization: MissionPilotAuthorizationV4) => string;
		initialPrompt: string;
		acceptanceCriteria: string | null;
		taskRevision: number;
		sourceEventId: string;
	},
) {
	const claimed =
		await callMissionPilotPersistence<MissionPilotSessionRecord | null>(
			"claimAgentPlay",
			taskId,
			expectedVersion,
			principal,
			activation,
		);
	if (claimed) markMissionPilotAgentTaskActive(taskId);
	return claimed;
}

export function completeAgentInitialPromptDispatch(input: {
	taskId: string;
	expectedVersion: number;
	messageId: string | null;
	activeRunId: string | null;
	phase: "initial_intake" | "implementation" | "review";
}) {
	return callMissionPilotPersistence<MissionPilotSessionRecord | null>(
		"completeAgentInitialPromptDispatch",
		input,
	);
}

export async function claimAgentStop(taskId: string, expectedVersion: number) {
	const stopped =
		await callMissionPilotPersistence<MissionPilotSessionRecord | null>(
			"claimAgentStop",
			taskId,
			expectedVersion,
		);
	if (stopped) clearMissionPilotAgentTaskActive(taskId);
	return stopped;
}

export function getMissionPilotSessionById(id: string) {
	return callMissionPilotPersistence<MissionPilotSessionRecord | null>(
		"getMissionPilotSessionById",
		id,
	);
}

export function listPlayingAgentSessions() {
	return callMissionPilotPersistence<
		Array<{
			session: MissionPilotSessionRecord;
			agent: Record<string, unknown>;
		}>
	>("listPlayingAgentSessions");
}
