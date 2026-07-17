import { and, asc, eq, isNull } from "drizzle-orm";
import type { TaskOperatorProjectionV1 } from "../../../../shared/modules/taskOperator";
import { db } from "../../../db/client";
import {
	missionPilotAgentSessions,
	missionPilotTaskEventInbox,
} from "../../../db/mission-pilot-agent-schema";
import type { MissionPilotTaskReadPort } from "./mission-pilot-agent.ports";

export type MissionPilotCurrentStepContext = {
	version: 1;
	taskRef: { id: string; revision: number; status: string };
	sourceDigest: string;
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
	headProjection?: TaskOperatorProjectionV1;
};

export async function buildMissionPilotCurrentStepContext(input: {
	sessionId: string;
	taskId: string;
	readPort: MissionPilotTaskReadPort;
}): Promise<MissionPilotCurrentStepContext> {
	const [agent, events, projection] = await Promise.all([
		db.query.missionPilotAgentSessions.findFirst({
			where: eq(missionPilotAgentSessions.sessionId, input.sessionId),
		}),
		db
			.select({
				sequence: missionPilotTaskEventInbox.sequence,
				eventType: missionPilotTaskEventInbox.eventType,
			})
			.from(missionPilotTaskEventInbox)
			.where(
				and(
					eq(missionPilotTaskEventInbox.sessionId, input.sessionId),
					isNull(missionPilotTaskEventInbox.consumedAt),
				),
			)
			.orderBy(asc(missionPilotTaskEventInbox.sequence)),
		input.readPort.readTaskOperatorView({
			taskId: input.taskId,
			sessionId: input.sessionId,
		}),
	]);
	if (!agent) throw new Error("Mission Pilot agent session not found");
	const resourceRefs = [
		{
			kind: "task",
			id: projection.task.id,
			revision: projection.task.revision,
		},
		...(projection.questionnaire
			? [
					{
						kind: "questionnaire",
						id: projection.questionnaire.id,
						revision: projection.questionnaire.revision,
					},
				]
			: []),
		...(projection.activeRun
			? [
					{
						kind: "task_run",
						id: projection.activeRun.id,
						revision: projection.activeRun.revision,
					},
				]
			: []),
	];
	return {
		version: 1,
		taskRef: {
			id: projection.task.id,
			revision: projection.task.revision,
			status: projection.task.status,
		},
		sourceDigest: projection.sourceDigest,
		changedSincePreviousTurn: {
			eventTypes: [...new Set(events.map((event) => event.eventType))],
			resourceRefs,
		},
		activeRunRef: projection.activeRun
			? { id: projection.activeRun.id, status: projection.activeRun.status }
			: null,
		currentTodoRef: projection.activeRun?.currentTodoRef ?? null,
		availableActionIds: projection.commandCatalog.availableIds,
		unreadEventRange: {
			from: events[0]?.sequence ?? null,
			through: events.at(-1)?.sequence ?? null,
		},
		...(agent.nextTurnIndex <= 2 ? { headProjection: projection } : {}),
	};
}

export function serializeMissionPilotCurrentStepContext(
	context: MissionPilotCurrentStepContext,
) {
	return JSON.stringify(context);
}

export type MissionPilotCurrentStepWorkspace = TaskOperatorProjectionV1;
