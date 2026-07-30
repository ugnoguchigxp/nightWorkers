import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { missionPilotSessions } from "../../db/mission-pilot-schema";

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
	remainingActiveRunId?: string | null,
	errorCode?: string,
	initialPromptState?: "failed",
) {
	const row = await getSessionByTaskId(taskId);
	if (!row) return null;
	const [updated] = await db
		.update(missionPilotSessions)
		.set({
			phase: error ? "attention" : "paused",
			activeRunId: error
				? remainingActiveRunId === undefined
					? row.activeRunId
					: remainingActiveRunId
				: null,
			lastErrorCode: error
				? (errorCode ?? "MISSION_PILOT_RUN_STOP_FAILED")
				: null,
			lastErrorMessage: error ?? null,
			...(initialPromptState ? { initialPromptState } : {}),
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
	return updated ?? null;
}

async function getSessionByTaskId(taskId: string) {
	const [row] = await db
		.select()
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.taskId, taskId));
	return row ?? null;
}
