import { callMissionPilotPersistence } from "../persistence-port";
import type { MissionPilotToolCallRecord } from "../persistence-records";
import { readTaskActivityEvents } from "../task";
import {
	getMissionPilotAgentSessionById,
	getMissionPilotSessionById,
} from "./agent/mission-pilot-agent-session.repository";
import { listMissionPilotConversation } from "./agent/mission-pilot-conversation.repository";
import { MissionPilotError } from "./mission-pilot.errors";
import {
	buildMissionPilotThoughtEntries,
	projectMissionPilotAgentVisibleItems,
} from "./mission-pilot-thought-projection";

export {
	buildMissionPilotThoughtEntries,
	projectMissionPilotAgentVisibleItems,
} from "./mission-pilot-thought-projection";

export async function getMissionPilotExecution(sessionId: string) {
	const session = await getMissionPilotSessionById(sessionId);
	if (!session) throw notFound();
	const [agent, conversationItems, toolCalls, activityEvents] =
		await Promise.all([
			getMissionPilotAgentSessionById(sessionId),
			listMissionPilotConversation(sessionId),
			callMissionPilotPersistence<MissionPilotToolCallRecord[]>(
				"listMissionPilotToolCalls",
				sessionId,
			),
			readTaskActivityEvents(session.taskId, {
				traceOwner: "mission_pilot",
				traceChannel: "pilot_thought",
			}),
		]);
	return {
		version: 2 as const,
		executionModel: "task_operator_v1" as const,
		session,
		activityEvents,
		entries: buildMissionPilotThoughtEntries({
			sessionId,
			activityEvents,
			messages: [],
			conversationItems,
			toolCalls,
		}),
		agent: agent
			? {
					sessionId: agent.sessionId,
					conversationRevision: agent.conversationRevision,
					visibleItems: projectMissionPilotAgentVisibleItems(conversationItems),
				}
			: null,
	};
}

export async function getMissionPilotExecutionForTask(taskId: string) {
	const session = await import("../storage/repository").then(
		({ getSessionByTaskId }) => getSessionByTaskId(taskId),
	);
	if (!session) throw notFound();
	return getMissionPilotExecution(session.id);
}

function notFound() {
	return new MissionPilotError(
		404,
		"MISSION_PILOT_NOT_FOUND",
		"Mission Pilot session not found",
	);
}
