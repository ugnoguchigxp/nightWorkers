import crypto from "node:crypto";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
	type MissionPilotSourceRef,
	missionPilotControlSummarySchema,
} from "../../../shared/modules/missionPilot";
import { type DbTransaction, db } from "../../db/client";
import {
	missionPilotContextSnapshots,
	missionPilotSessions,
} from "../../db/mission-pilot-schema";
import { createMissionPilotAgentSession } from "./agent/mission-pilot-agent-session.repository";
import { resolvePostQueueResumePhase } from "./mission-pilot-post-queue-resume";

export { claimStop, finishStop } from "./mission-pilot-stop.repository";

type Db = typeof db | DbTransaction;
type SessionRow = typeof missionPilotSessions.$inferSelect;

export class MissionPilotStateConflictError extends Error {}

export function toControlSummary(row: SessionRow) {
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
		authorizationVersion: row.authorizationVersion ?? null,
		initialPromptState: row.initialPromptState,
		initialPromptMessageId: row.initialPromptMessageId ?? null,
		activeRunId: row.activeRunId ?? null,
		nextWakeAt: row.nextWakeAt ?? null,
		version: row.version,
		lastErrorCode: row.lastErrorCode ?? null,
		lastError: row.lastErrorMessage ?? null,
		stoppedAt: row.stoppedAt ?? null,
		queueHandoff: row.queueHandoffJson ?? null,
		preQueueDiagnostic: row.preQueueDiagnosticJson ?? null,
		updatedAt: row.updatedAt,
	});
}

export function hasValidAuthorization(row: SessionRow) {
	const authorization = row.authorizationJson;
	if (!authorization || authorization.sessionId !== row.id) return false;
	if (authorization.taskId !== row.taskId) return false;
	if (authorization.version === 2) {
		return (
			row.authorizationVersion === 2 &&
			authorization.sourceRef.source === row.sourceKind &&
			authorization.sourceRef.id === row.sourceId
		);
	}
	return (
		(row.authorizationVersion === 3 || row.authorizationVersion === 4) &&
		authorization.taskRef.source === "task" &&
		authorization.taskRef.id === row.taskId &&
		authorization.activationContextRevision <= row.contextRevision &&
		Boolean(authorization.activationContextDigest)
	);
}

export async function createSession(
	input: {
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
	},
	tx: DbTransaction,
) {
	const objective = input.task.objective ?? "";
	const id = crypto.randomUUID();
	const context = {
		version: 1,
		session: {
			id,
			taskId: input.task.id,
			sourceRef: { source: input.sourceKind, id: input.sourceId },
		},
		task: {
			title: input.task.title,
			initialPrompt: objective,
			description: input.task.description,
			acceptanceCriteria: input.task.acceptanceCriteria,
		},
	};
	const serialized = JSON.stringify(context);
	const digest = crypto.createHash("sha256").update(serialized).digest("hex");
	const now = new Date();
	const [row] = await tx
		.insert(missionPilotSessions)
		.values({
			id,
			taskId: input.task.id,
			repositoryId: input.task.repositoryId,
			sourceKind: input.sourceKind,
			sourceId: input.sourceId,
			initialPromptSnapshot: objective,
			contextDigest: digest,
			createdAt: now,
			updatedAt: now,
		})
		.returning();
	await createMissionPilotAgentSession(tx, {
		sessionId: id,
		contextDigest: digest,
		now,
	});
	await tx.insert(missionPilotContextSnapshots).values({
		id: crypto.randomUUID(),
		sessionId: id,
		revision: 1,
		reason: "initial",
		contextJson: context,
		digest,
		tokenEstimate: Math.ceil(serialized.length / 4),
		createdAt: now,
	});
	return row;
}

export async function getSessionByTaskId(taskId: string, database: Db = db) {
	const [row] = await database
		.select()
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.taskId, taskId));
	return row ?? null;
}

export async function listPlayingSessionsWithActiveRuns() {
	return db
		.select()
		.from(missionPilotSessions)
		.where(
			and(
				eq(missionPilotSessions.desiredState, "playing"),
				isNotNull(missionPilotSessions.activeRunId),
			),
		);
}

export async function listSessionSummariesByTaskIds(taskIds: string[]) {
	if (!taskIds.length) return new Map();
	const rows = await db
		.select()
		.from(missionPilotSessions)
		.where(inArray(missionPilotSessions.taskId, taskIds));
	return new Map(rows.map((row) => [row.taskId, toControlSummary(row)]));
}
export async function claimPostQueueResume(
	taskId: string,
	expectedVersion: number,
) {
	const row = await getSessionByTaskId(taskId);
	const resumePhase = row?.resumePhase;
	if (
		!row ||
		row.version !== expectedVersion ||
		row.desiredState !== "stopped" ||
		row.activeRunId ||
		!resumePhase
	)
		return null;
	const [updated] = await db
		.update(missionPilotSessions)
		.set({
			desiredState: "playing",
			phase: resolvePostQueueResumePhase({ ...row, resumePhase }),
			resumePhase: null,
			startedAt: new Date(),
			stoppedAt: null,
			preQueueDiagnosticJson: null,
			lastErrorCode: null,
			lastErrorMessage: null,
			version: row.version + 1,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(missionPilotSessions.id, row.id),
				eq(missionPilotSessions.version, expectedVersion),
				eq(missionPilotSessions.desiredState, "stopped"),
				isNull(missionPilotSessions.activeRunId),
			),
		)
		.returning();
	return updated ?? null;
}

export async function finishPlay(taskId: string, activeRunId: string | null) {
	const row = await getSessionByTaskId(taskId);
	if (!row) return null;
	const [updated] = await db
		.update(missionPilotSessions)
		.set({
			phase: row.nextWakeAt
				? "waiting_intervention"
				: activeRunId
					? "running"
					: "initial_intake",
			resumePhase: null,
			activeRunId,
			version: row.version + 1,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(missionPilotSessions.id, row.id),
				eq(missionPilotSessions.version, row.version),
				eq(missionPilotSessions.desiredState, "playing"),
			),
		)
		.returning();
	return updated ?? (await getSessionByTaskId(taskId));
}
export async function markAttention(
	taskId: string,
	expectedVersion: number,
	code: string,
	message: string,
) {
	const row = await getSessionByTaskId(taskId);
	if (!row) return null;
	const [updated] = await db
		.update(missionPilotSessions)
		.set({
			desiredState: "stopped",
			phase: "attention",
			lastErrorCode: code,
			lastErrorMessage: message,
			version: row.version + 1,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(missionPilotSessions.id, row.id),
				eq(missionPilotSessions.version, expectedVersion),
				eq(missionPilotSessions.desiredState, "playing"),
			),
		)
		.returning();
	return updated ?? (await getSessionByTaskId(taskId));
}
export async function syncCompletedRun(taskId: string, runId: string) {
	const row = await getSessionByTaskId(taskId);
	if (!row || row.activeRunId !== runId || row.desiredState !== "playing")
		return null;
	const [updated] = await db
		.update(missionPilotSessions)
		.set({
			activeRunId: null,
			phase: row.phase === "running" ? "initial_intake" : row.phase,
			version: row.version + 1,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(missionPilotSessions.id, row.id),
				eq(missionPilotSessions.version, row.version),
				eq(missionPilotSessions.activeRunId, runId),
				eq(missionPilotSessions.desiredState, "playing"),
			),
		)
		.returning();
	return updated ?? null;
}
