import crypto from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
	type MissionPilotAuthorizationV2,
	type MissionPilotSourceRef,
	missionPilotControlSummarySchema,
} from "../../../shared/schemas/mission-pilot.schema";
import { type DbTransaction, db } from "../../db/client";
import {
	missionPilotContextSnapshots,
	missionPilotSessions,
} from "../../db/mission-pilot-schema";
import { taskMessages } from "../../db/schema";
import { MissionPilotError } from "./mission-pilot.errors";

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
		lastError: row.lastErrorMessage ?? null,
		updatedAt: row.updatedAt,
	});
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
	const objective = input.task.objective;
	if (!objective?.trim())
		throw new MissionPilotError(
			400,
			"MISSION_PILOT_INITIAL_PROMPT_REQUIRED",
			"Mission Pilot requires a non-empty initial prompt",
		);
	const id = crypto.randomUUID();
	const context = {
		version: 1,
		session: {
			id,
			taskId: input.task.id,
			repositoryId: input.task.repositoryId,
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
export async function listSessionSummariesByTaskIds(taskIds: string[]) {
	if (!taskIds.length) return new Map();
	const rows = await db
		.select()
		.from(missionPilotSessions)
		.where(inArray(missionPilotSessions.taskId, taskIds));
	return new Map(rows.map((row) => [row.taskId, toControlSummary(row)]));
}
export async function claimPlay(
	taskId: string,
	expectedVersion: number,
	authorization: MissionPilotAuthorizationV2,
) {
	const now = new Date();
	const [row] = await db
		.update(missionPilotSessions)
		.set({
			desiredState: "playing",
			phase: "starting",
			authorizationVersion: 2,
			authorizationJson: authorization,
			startedAt: now,
			lastErrorCode: null,
			lastErrorMessage: null,
			version: expectedVersion + 1,
			updatedAt: now,
		})
		.where(
			and(
				eq(missionPilotSessions.taskId, taskId),
				eq(missionPilotSessions.version, expectedVersion),
				eq(missionPilotSessions.desiredState, "stopped"),
				isNull(missionPilotSessions.activeRunId),
			),
		)
		.returning();
	return row ?? null;
}

export async function claimInitialPromptDispatch(taskId: string) {
	const row = await getSessionByTaskId(taskId);
	if (!row) return null;
	if (row.desiredState !== "playing") {
		throw new MissionPilotStateConflictError(
			"Mission Pilot stopped before the initial prompt was claimed",
		);
	}
	if (row.initialPromptState !== "pending") return row;
	const [updated] = await db
		.update(missionPilotSessions)
		.set({
			initialPromptState: "dispatching",
			version: row.version + 1,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(missionPilotSessions.id, row.id),
				eq(missionPilotSessions.version, row.version),
				eq(missionPilotSessions.desiredState, "playing"),
				eq(missionPilotSessions.initialPromptState, "pending"),
			),
		)
		.returning();
	if (!updated) {
		throw new MissionPilotStateConflictError(
			"Mission Pilot state changed while dispatching the initial prompt",
		);
	}
	return updated;
}

export async function ensureInitialPromptMessage(taskId: string) {
	await claimInitialPromptDispatch(taskId);
	return db.transaction(async (tx) => {
		const row = await getSessionByTaskId(taskId, tx);
		if (!row) return null;
		if (row.desiredState !== "playing") {
			throw new MissionPilotStateConflictError(
				"Mission Pilot stopped before the initial prompt was claimed",
			);
		}
		if (row.initialPromptState === "sent" && row.initialPromptMessageId)
			return {
				row,
				messageId: row.initialPromptMessageId,
				inserted: false,
				message: null,
			};
		if (row.initialPromptState !== "dispatching") {
			throw new MissionPilotStateConflictError(
				"Mission Pilot initial prompt is not dispatchable",
			);
		}
		const existing = await tx
			.select()
			.from(taskMessages)
			.where(
				and(
					eq(taskMessages.taskId, taskId),
					eq(taskMessages.messageType, "mission_pilot_initial_prompt"),
				),
			)
			.limit(1);
		const messageId = existing[0]?.id ?? crypto.randomUUID();
		let message = existing[0] ?? null;
		if (!message) {
			[message] = await tx
				.insert(taskMessages)
				.values({
					id: messageId,
					taskId,
					role: "user",
					content: row.initialPromptSnapshot,
					messageType: "mission_pilot_initial_prompt",
					metadataJson: {
						source: "mission_pilot",
						intent: "initial_prompt",
						controlVersion: row.version,
					},
				})
				.returning();
		}
		const [updated] = await tx
			.update(missionPilotSessions)
			.set({
				initialPromptState: "sent",
				initialPromptMessageId: messageId,
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
		if (!updated) {
			throw new MissionPilotStateConflictError(
				"Mission Pilot state changed while claiming the initial prompt",
			);
		}
		return { row: updated, messageId, inserted: !existing[0], message };
	});
}
export async function finishPlay(taskId: string, activeRunId: string | null) {
	const row = await getSessionByTaskId(taskId);
	if (!row) return null;
	const [updated] = await db
		.update(missionPilotSessions)
		.set({
			phase: activeRunId ? "running" : "initial_intake",
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
export async function claimStop(taskId: string, expectedVersion: number) {
	const row = await getSessionByTaskId(taskId);
	if (!row) return null;
	if (row.desiredState === "stopped") return row;
	const [updated] = await db
		.update(missionPilotSessions)
		.set({
			desiredState: "stopped",
			resumePhase: row.phase,
			phase: "stopping",
			nextWakeAt: null,
			version: expectedVersion + 1,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(missionPilotSessions.id, row.id),
				eq(missionPilotSessions.version, expectedVersion),
			),
		)
		.returning();
	return updated ?? null;
}
export async function finishStop(
	taskId: string,
	expectedVersion: number,
	error?: string,
) {
	const row = await getSessionByTaskId(taskId);
	if (!row) return null;
	const [updated] = await db
		.update(missionPilotSessions)
		.set({
			phase: error ? "attention" : "paused",
			activeRunId: error ? row.activeRunId : null,
			lastErrorCode: error ? "MISSION_PILOT_RUN_STOP_FAILED" : null,
			lastErrorMessage: error ?? null,
			stoppedAt: new Date(),
			version: row.version + 1,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(missionPilotSessions.id, row.id),
				eq(missionPilotSessions.version, expectedVersion),
				eq(missionPilotSessions.desiredState, "stopped"),
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

export async function recoverInterruptedStartingSessions() {
	return db
		.update(missionPilotSessions)
		.set({
			desiredState: "stopped",
			phase: "attention",
			lastErrorCode: "MISSION_PILOT_RESTART_RECOVERY_REQUIRED",
			lastErrorMessage:
				"サーバー再起動で初期処理が中断されました。Playで安全に再開できます。",
			version: sql`${missionPilotSessions.version} + 1`,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(missionPilotSessions.desiredState, "playing"),
				eq(missionPilotSessions.phase, "starting"),
				isNull(missionPilotSessions.activeRunId),
			),
		)
		.returning();
}
