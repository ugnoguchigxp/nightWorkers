import { and, eq, isNull, notExists, or, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { designQuestionnaireSessions } from "../../db/design-questionnaire-schema";
import { missionPilotSessions } from "../../db/mission-pilot-schema";

export async function recoverInterruptedIntakeSessions() {
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
				eq(missionPilotSessions.runtimeKind, "legacy"),
				eq(missionPilotSessions.desiredState, "playing"),
				isNull(missionPilotSessions.activeRunId),
				or(
					eq(missionPilotSessions.phase, "starting"),
					and(
						eq(missionPilotSessions.phase, "initial_intake"),
						notExists(
							db
								.select({ id: designQuestionnaireSessions.id })
								.from(designQuestionnaireSessions)
								.where(
									eq(
										designQuestionnaireSessions.taskId,
										missionPilotSessions.taskId,
									),
								),
						),
					),
				),
			),
		)
		.returning();
}
