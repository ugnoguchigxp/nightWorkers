import crypto from "node:crypto";
import {
	type MissionPilotSourceRef,
	missionPilotControlSummarySchema,
} from "@nightworkers/mission-pilot/contracts";
import { eq } from "drizzle-orm";
import { type DbTransaction, db } from "../../../db/client";
import { missionPilotAgentSessions } from "./agent-schema";
import { missionPilotContextSnapshots, missionPilotSessions } from "./schema";

export { claimStop, finishStop } from "./stop-repository";

type Db = typeof db | DbTransaction;
type SessionRow = typeof missionPilotSessions.$inferSelect;

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
		updatedAt: row.updatedAt,
	});
}

export function hasValidAuthorization(row: SessionRow) {
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
		.onConflictDoNothing({ target: missionPilotSessions.taskId })
		.returning();
	if (!row) {
		const [existing] = await tx
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.taskId, input.task.id));
		if (!existing)
			throw new Error("Mission Pilot session creation did not converge");
		return existing;
	}
	await tx.insert(missionPilotAgentSessions).values({
		sessionId: id,
		engineMode: "agent",
		contextDigest: digest,
		createdAt: now,
		updatedAt: now,
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

export function getOrCreateSession(input: Parameters<typeof createSession>[0]) {
	return db.transaction((tx) => createSession(input, tx));
}

export async function getSessionByTaskId(taskId: string, database: Db = db) {
	const [row] = await database
		.select()
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.taskId, taskId));
	return row ?? null;
}
