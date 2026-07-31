import type {
	MissionPilotAuthorization,
	MissionPilotSourceRef,
} from "../../contracts";
import { missionPilotControlSummarySchema } from "../../contracts";
import { callMissionPilotPersistence } from "../persistence-port";

export { claimStop, finishStop } from "./stop-repository";

export type MissionPilotSessionRecord = {
	id: string;
	taskId: string;
	repositoryId: string;
	sourceKind: string;
	sourceId: string;
	authorizationVersion: number | null;
	authorizationJson: MissionPilotAuthorization | null;
	desiredState: string;
	phase: string;
	initialPromptState: string;
	initialPromptMessageId: string | null;
	activeRunId: string | null;
	version: number;
	contextRevision: number;
	nextWakeAt: Date | null;
	lastErrorCode: string | null;
	lastErrorMessage: string | null;
	stoppedAt: Date | null;
	updatedAt: Date;
	[key: string]: unknown;
};

export function toControlSummary(row: MissionPilotSessionRecord) {
	const activityState =
		row.phase === "attention"
			? "attention"
			: row.phase === "starting"
				? "starting"
				: row.phase === "stopping"
					? "stopping"
					: row.activeRunId
						? "running"
						: "idle";
	return missionPilotControlSummarySchema.parse({
		taskId: row.taskId,
		desiredState: row.desiredState,
		activityState,
		phase: row.phase,
		authorizationVersion: row.authorizationVersion,
		initialPromptState: row.initialPromptState,
		initialPromptMessageId: row.initialPromptMessageId,
		activeRunId: row.activeRunId,
		nextWakeAt: row.nextWakeAt,
		version: row.version,
		lastErrorCode: row.lastErrorCode,
		lastError: row.lastErrorMessage,
		stoppedAt: row.stoppedAt,
		updatedAt: row.updatedAt,
	});
}

export function hasValidAuthorization(row: MissionPilotSessionRecord) {
	const authorization = row.authorizationJson;
	if (!authorization || authorization.sessionId !== row.id) return false;
	if (authorization.taskId !== row.taskId) return false;
	if (authorization.version === 2)
		return (
			row.authorizationVersion === 2 &&
			authorization.sourceRef.source === row.sourceKind &&
			authorization.sourceRef.id === row.sourceId
		);
	return (
		(row.authorizationVersion === 3 || row.authorizationVersion === 4) &&
		authorization.taskRef.source === "task" &&
		authorization.taskRef.id === row.taskId &&
		authorization.activationContextRevision <= row.contextRevision &&
		Boolean(authorization.activationContextDigest)
	);
}

export type CreateMissionPilotSessionInput = {
	task: {
		id: string;
		repositoryId: string;
		title: string;
		description: string | null;
		objective: string | null;
		acceptanceCriteria: string | null;
	};
	sourceKind: MissionPilotSourceRef["source"];
	sourceId: string;
};

export function getOrCreateSession(input: CreateMissionPilotSessionInput) {
	return callMissionPilotPersistence<MissionPilotSessionRecord>(
		"getOrCreateSession",
		input,
	);
}

export function getSessionByTaskId(taskId: string) {
	return callMissionPilotPersistence<MissionPilotSessionRecord | null>(
		"getSessionByTaskId",
		taskId,
	);
}
