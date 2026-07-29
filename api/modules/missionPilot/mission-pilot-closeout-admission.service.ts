import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import {
	missionPilotCloseouts,
	missionPilotPhaseRuns,
	missionPilotReviewDecisions,
	type missionPilotSessions,
	missionPilotVerificationSnapshots,
} from "../../db/mission-pilot-schema";
import { repositories, tasks } from "../../db/schema";
import {
	admitCloseout,
	consumeCloseoutAdmission,
} from "../gitCloseout/closeout-admission.service";

export async function admitMissionPilotCloseout(input: {
	session: typeof missionPilotSessions.$inferSelect;
	snapshot: typeof missionPilotVerificationSnapshots.$inferSelect;
	taskId: string;
}) {
	const [sourcePhaseRun] = await db
		.select()
		.from(missionPilotPhaseRuns)
		.where(eq(missionPilotPhaseRuns.id, input.snapshot.sourcePhaseRunId))
		.limit(1);
	if (
		!sourcePhaseRun?.runId ||
		sourcePhaseRun.sessionId !== input.session.id ||
		sourcePhaseRun.taskId !== input.taskId ||
		sourcePhaseRun.phase !== "implementation"
	) {
		throw new Error("Mission Pilot closeout implementation Run is missing");
	}
	return admitCloseout(sourcePhaseRun.runId);
}

export const consumeMissionPilotCloseoutAdmission = consumeCloseoutAdmission;

export async function loadMissionPilotCloseoutEvidence(
	session: typeof missionPilotSessions.$inferSelect,
) {
	if (
		!session.activeCloseoutId ||
		!session.activeReviewDecisionId ||
		!session.activeVerificationSnapshotId
	) {
		throw new Error("Mission Pilot closeout evidence is incomplete");
	}
	const [[closeout], [reviewDecision], [snapshot], [repository], [task]] =
		await Promise.all([
			db
				.select()
				.from(missionPilotCloseouts)
				.where(eq(missionPilotCloseouts.id, session.activeCloseoutId))
				.limit(1),
			db
				.select()
				.from(missionPilotReviewDecisions)
				.where(
					eq(missionPilotReviewDecisions.id, session.activeReviewDecisionId),
				)
				.limit(1),
			db
				.select()
				.from(missionPilotVerificationSnapshots)
				.where(
					eq(
						missionPilotVerificationSnapshots.id,
						session.activeVerificationSnapshotId,
					),
				)
				.limit(1),
			db
				.select()
				.from(repositories)
				.where(eq(repositories.id, session.repositoryId))
				.limit(1),
			db.select().from(tasks).where(eq(tasks.id, session.taskId)).limit(1),
		]);
	if (!closeout || !reviewDecision || !snapshot || !repository || !task)
		throw new Error("Mission Pilot closeout rows are missing");
	return { closeout, reviewDecision, snapshot, repository, task };
}
