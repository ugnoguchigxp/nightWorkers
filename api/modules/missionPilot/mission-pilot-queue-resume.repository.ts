import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client";
import { missionPilotSessions } from "../../db/mission-pilot-schema";
import * as missionPilotRepo from "./mission-pilot.repository";

export async function claimQueueHandoffResume(
	taskId: string,
	expectedVersion: number,
) {
	const row = await missionPilotRepo.getSessionByTaskId(taskId);
	if (
		!row ||
		row.version !== expectedVersion ||
		row.desiredState !== "stopped" ||
		row.phase !== "attention" ||
		!row.queueHandoffJson ||
		row.activeRunId
	)
		return null;
	const [updated] = await db
		.update(missionPilotSessions)
		.set({
			desiredState: "playing",
			phase: "queued",
			resumePhase: null,
			startedAt: new Date(),
			stoppedAt: null,
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
