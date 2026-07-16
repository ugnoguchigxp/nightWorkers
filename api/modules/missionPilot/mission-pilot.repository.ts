import crypto from "node:crypto";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { MissionPilotRuntimeKind } from "../../../shared/modules/missionPilot";
import {
	type MissionPilotAuthorizationV3,
	type MissionPilotSourceRef,
	missionPilotControlSummarySchema,
} from "../../../shared/modules/missionPilot";
import { type DbTransaction, db } from "../../db/client";
import {
	missionPilotContextSnapshots,
	missionPilotSessions,
} from "../../db/mission-pilot-schema";
import { taskMessages, tasks } from "../../db/schema";
import { missionPilotInitialPromptTrace } from "../nightworkers/nightworkers.trace-provenance";
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
		row.authorizationVersion === 3 &&
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
			worktreePath?: string | null;
		};
		sourceKind: MissionPilotSourceRef["source"];
		sourceId: string;
		runtimeKind?: MissionPilotRuntimeKind;
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
			repositoryId: input.task.repositoryId,
			sourceRef: { source: input.sourceKind, id: input.sourceId },
		},
		task: {
			title: input.task.title,
			initialPrompt: objective,
			description: input.task.description,
			acceptanceCriteria: input.task.acceptanceCriteria,
			worktreePath: input.task.worktreePath ?? null,
			repositoryId: input.task.repositoryId,
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
	if (input.runtimeKind === "agent") {
		await createMissionPilotAgentSession(tx, {
			sessionId: id,
			contextDigest: digest,
			now,
		});
	}
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

export async function backfillMissingTaskSessions() {
	const missingTasks = await db
		.select({ task: tasks })
		.from(tasks)
		.leftJoin(missionPilotSessions, eq(missionPilotSessions.taskId, tasks.id))
		.where(isNull(missionPilotSessions.id));
	let created = 0;
	for (const { task } of missingTasks) {
		const inserted = await db.transaction(async (tx) => {
			if (await getSessionByTaskId(task.id, tx)) return false;
			await createSession(
				{
					task,
					sourceKind: "task",
					sourceId: task.id,
				},
				tx,
			);
			return true;
		});
		if (inserted) created++;
	}
	return created;
}
export async function listSessionSummariesByTaskIds(taskIds: string[]) {
	if (!taskIds.length) return new Map();
	const rows = await db
		.select()
		.from(missionPilotSessions)
		.where(inArray(missionPilotSessions.taskId, taskIds));
	return new Map(rows.map((row) => [row.taskId, toControlSummary(row)]));
}
export async function claimPlay(taskId: string, expectedVersion: number) {
	return db.transaction(async (tx) => {
		const [session] = await tx
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.taskId, taskId));
		const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
		if (
			!session ||
			!task ||
			session.version !== expectedVersion ||
			session.desiredState !== "stopped" ||
			session.activeRunId
		) {
			return null;
		}
		const [currentContext] = await tx
			.select()
			.from(missionPilotContextSnapshots)
			.where(
				and(
					eq(missionPilotContextSnapshots.sessionId, session.id),
					eq(missionPilotContextSnapshots.revision, session.contextRevision),
				),
			);
		const previousContext =
			currentContext?.contextJson &&
			typeof currentContext.contextJson === "object" &&
			!Array.isArray(currentContext.contextJson)
				? currentContext.contextJson
				: {};
		const context = {
			...previousContext,
			version: 1,
			session: {
				id: session.id,
				taskId,
				repositoryId: task.repositoryId,
				sourceRef: { source: session.sourceKind, id: session.sourceId },
			},
			task: {
				title: task.title,
				initialPrompt: task.objective ?? "",
				description: task.description,
				acceptanceCriteria: task.acceptanceCriteria,
				worktreePath: task.worktreePath,
				repositoryId: task.repositoryId,
			},
		};
		const serialized = JSON.stringify(context);
		const digest = crypto.createHash("sha256").update(serialized).digest("hex");
		const currentAuthorization = session.authorizationJson;
		const reuseActivation =
			currentAuthorization?.version === 3 &&
			currentAuthorization.activationContextDigest === digest;
		const revision = reuseActivation
			? currentAuthorization.activationContextRevision
			: session.contextRevision + 1;
		const now = new Date();
		if (!reuseActivation) {
			await tx.insert(missionPilotContextSnapshots).values({
				id: crypto.randomUUID(),
				sessionId: session.id,
				revision,
				reason: "play_activation",
				contextJson: context,
				digest,
				tokenEstimate: Math.ceil(serialized.length / 4),
				createdAt: now,
			});
		}
		const authorization: MissionPilotAuthorizationV3 = {
			version: 3,
			sessionId: session.id,
			taskId,
			taskRef: { source: "task", id: taskId },
			activationContextRevision: revision,
			activationContextDigest: digest,
			grantedByAction: "mission_pilot_play",
			grantedAt: now.toISOString(),
			scopes: {
				plan: true,
				queue: true,
				implementation: true,
				testMutation: true,
				review: true,
				localCommit: true,
				taskComplete: true,
				taskArchive: true,
				push: false,
			},
			pushPolicy: "never",
		};
		const [row] = await tx
			.update(missionPilotSessions)
			.set({
				desiredState: "playing",
				phase: "starting",
				authorizationVersion: 3,
				authorizationJson: authorization,
				initialPromptSnapshot: task.objective ?? "",
				contextRevision: revision,
				contextDigest: digest,
				startedAt: now,
				lastErrorCode: null,
				lastErrorMessage: null,
				version: expectedVersion + 1,
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotSessions.id, session.id),
					eq(missionPilotSessions.version, expectedVersion),
					eq(missionPilotSessions.desiredState, "stopped"),
					isNull(missionPilotSessions.activeRunId),
				),
			)
			.returning();
		return row ?? null;
	});
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
			const { trace, metadataJson } = missionPilotInitialPromptTrace(
				row.id,
				row.version,
			);
			[message] = await tx
				.insert(taskMessages)
				.values({
					id: messageId,
					taskId,
					role: "user",
					content: row.initialPromptSnapshot,
					messageType: "mission_pilot_initial_prompt",
					metadataJson,
					traceOwner: trace.owner,
					traceChannel: trace.channel,
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
