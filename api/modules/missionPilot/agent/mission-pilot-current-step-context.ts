import { and, asc, eq, isNull } from "drizzle-orm";
import type { MissionPilotTaskReadModel } from "../../../../shared/modules/missionPilot";
import { db } from "../../../db/client";
import {
	missionPilotAgentSessions,
	missionPilotTaskEventInbox,
} from "../../../db/mission-pilot-agent-schema";
import { missionPilotSessions } from "../../../db/mission-pilot-schema";
import type { MissionPilotTaskReadPort } from "./mission-pilot-agent.ports";
import { missionPilotDigest } from "./mission-pilot-content-page";

export type MissionPilotCurrentStepContext = {
	sessionRef: { id: string; revision: number };
	taskRef: { id: string; revision: number; status: string };
	authorizationRef: { version: number; digest: string };
	projectRef: { id: string | null; registeredRepoRoot: string | null };
	activeRunRefs: Array<{
		id: string;
		kind: string;
		status: string;
		startedAt: string | null;
	}>;
	latestTerminalRunRefs: Array<{
		id: string;
		status: string;
		outcomeDigest: string;
	}>;
	unreadEventRange: { from: number | null; through: number | null };
	availableActionIds: string[];
	availableActionDigest: string;
	observedAt: string;
};

export async function buildMissionPilotCurrentStepContext(input: {
	sessionId: string;
	taskId: string;
	readPort: MissionPilotTaskReadPort;
}): Promise<MissionPilotCurrentStepContext> {
	const [session, agent, events, workspace] = await Promise.all([
		db.query.missionPilotSessions.findFirst({
			where: eq(missionPilotSessions.id, input.sessionId),
		}),
		db.query.missionPilotAgentSessions.findFirst({
			where: eq(missionPilotAgentSessions.sessionId, input.sessionId),
		}),
		db
			.select({ sequence: missionPilotTaskEventInbox.sequence })
			.from(missionPilotTaskEventInbox)
			.where(
				and(
					eq(missionPilotTaskEventInbox.sessionId, input.sessionId),
					isNull(missionPilotTaskEventInbox.consumedAt),
				),
			)
			.orderBy(asc(missionPilotTaskEventInbox.sequence)),
		readWorkspace(input.readPort, input.taskId, input.sessionId),
	]);
	if (!session || !agent)
		throw new Error("Mission Pilot agent session not found");
	const availableActionIds = workspace.availableActions
		.filter((action) => action.availability === "available")
		.map((action) => action.actionId)
		.sort();
	return {
		sessionRef: { id: input.sessionId, revision: agent.conversationRevision },
		taskRef: {
			id: workspace.task.id,
			revision: workspace.task.revision,
			status: workspace.task.status,
		},
		authorizationRef: {
			version:
				typeof session.authorizationJson?.version === "number"
					? session.authorizationJson.version
					: agent.systemContextVersion,
			digest: missionPilotDigest(
				JSON.stringify(session.authorizationJson ?? null),
			),
		},
		projectRef: {
			id: workspace.project.id,
			registeredRepoRoot:
				workspace.repository &&
				typeof workspace.repository === "object" &&
				"localPath" in workspace.repository &&
				typeof workspace.repository.localPath === "string"
					? workspace.repository.localPath
					: null,
		},
		activeRunRefs: (Array.isArray(workspace.activeRuns)
			? workspace.activeRuns
			: []
		).map((value) => {
			const run = record(value);
			return {
				id: text(run.id),
				kind: "task_run",
				status: text(run.status),
				startedAt:
					run.startedAt instanceof Date
						? run.startedAt.toISOString()
						: typeof run.startedAt === "string"
							? run.startedAt
							: null,
			};
		}),
		latestTerminalRunRefs: workspace.terminalRuns.map((value) => {
			const run = record(value);
			return {
				id: text(run.runId),
				status: text(run.status),
				outcomeDigest: missionPilotDigest(JSON.stringify(run)),
			};
		}),
		unreadEventRange: {
			from: events[0]?.sequence ?? null,
			through: events.at(-1)?.sequence ?? null,
		},
		availableActionIds,
		availableActionDigest: missionPilotDigest(
			JSON.stringify(availableActionIds),
		),
		observedAt: new Date().toISOString(),
	};
}

async function readWorkspace(
	readPort: MissionPilotTaskReadPort,
	taskId: string,
	sessionId: string,
) {
	return readPort.readTaskWorkspace({ taskId, sessionId });
}

function text(value: unknown) {
	return typeof value === "string" ? value : String(value);
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export function serializeMissionPilotCurrentStepContext(
	context: MissionPilotCurrentStepContext,
) {
	return JSON.stringify(context);
}

export type MissionPilotCurrentStepWorkspace = MissionPilotTaskReadModel;
