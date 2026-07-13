import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client";
import {
	missionPilotCloseouts,
	missionPilotEvents,
	missionPilotPhaseRuns,
	missionPilotReviewDecisions,
	missionPilotSessions,
	missionPilotTestSnapshots,
} from "../../db/mission-pilot-schema";
import { taskEvents } from "../../db/schema";
import { MissionPilotError } from "./mission-pilot.errors";
import { releaseMissionPilotQueueHandoff } from "./mission-pilot-post-queue-coordinator.service";

export async function getMissionPilotExecution(sessionId: string) {
	const [session] = await db
		.select()
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.id, sessionId))
		.limit(1);
	if (!session)
		throw new MissionPilotError(
			404,
			"MISSION_PILOT_NOT_FOUND",
			"Mission Pilot session not found",
		);
	const [phaseRuns, testSnapshots, reviewDecisions, closeouts, events] =
		await Promise.all([
			db
				.select()
				.from(missionPilotPhaseRuns)
				.where(eq(missionPilotPhaseRuns.sessionId, sessionId))
				.orderBy(desc(missionPilotPhaseRuns.startedAt)),
			db
				.select()
				.from(missionPilotTestSnapshots)
				.where(eq(missionPilotTestSnapshots.sessionId, sessionId))
				.orderBy(desc(missionPilotTestSnapshots.createdAt)),
			db
				.select()
				.from(missionPilotReviewDecisions)
				.where(eq(missionPilotReviewDecisions.sessionId, sessionId))
				.orderBy(desc(missionPilotReviewDecisions.createdAt)),
			db
				.select()
				.from(missionPilotCloseouts)
				.where(eq(missionPilotCloseouts.sessionId, sessionId))
				.orderBy(desc(missionPilotCloseouts.attempt)),
			db
				.select()
				.from(missionPilotEvents)
				.where(eq(missionPilotEvents.sessionId, sessionId))
				.orderBy(asc(missionPilotEvents.createdAt)),
		]);
	const phaseRunByRunId = new Map(
		phaseRuns.map((phaseRun) => [phaseRun.runId, phaseRun] as const),
	);
	const runEvents =
		phaseRuns.length === 0
			? []
			: await db
					.select()
					.from(taskEvents)
					.where(
						inArray(
							taskEvents.taskRunId,
							phaseRuns.map((phaseRun) => phaseRun.runId),
						),
					)
					.orderBy(asc(taskEvents.timestamp), asc(taskEvents.seq));
	return {
		session,
		phaseRuns,
		testSnapshots,
		reviewDecisions,
		closeouts,
		events,
		runEvents: runEvents.map((event) => {
			const phaseRun = phaseRunByRunId.get(event.taskRunId);
			return {
				...event,
				missionPilotPhase: phaseRun?.phase ?? null,
				missionPilotCycle: phaseRun?.cycle ?? null,
				missionPilotAttempt: phaseRun?.attempt ?? null,
			};
		}),
	};
}

export async function getMissionPilotExecutionForTask(taskId: string) {
	const [session] = await db
		.select({ id: missionPilotSessions.id })
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.taskId, taskId))
		.limit(1);
	if (!session)
		throw new MissionPilotError(
			404,
			"MISSION_PILOT_NOT_FOUND",
			"Mission Pilot session not found",
		);
	return getMissionPilotExecution(session.id);
}

export async function getLatestMissionPilotTestSnapshot(sessionId: string) {
	const [row] = await db
		.select()
		.from(missionPilotTestSnapshots)
		.where(eq(missionPilotTestSnapshots.sessionId, sessionId))
		.orderBy(desc(missionPilotTestSnapshots.createdAt))
		.limit(1);
	return row ?? null;
}

export async function getLatestMissionPilotReviewDecision(sessionId: string) {
	const [row] = await db
		.select()
		.from(missionPilotReviewDecisions)
		.where(eq(missionPilotReviewDecisions.sessionId, sessionId))
		.orderBy(desc(missionPilotReviewDecisions.createdAt))
		.limit(1);
	return row ?? null;
}

export async function getLatestMissionPilotCloseout(sessionId: string) {
	const [row] = await db
		.select()
		.from(missionPilotCloseouts)
		.where(eq(missionPilotCloseouts.sessionId, sessionId))
		.orderBy(desc(missionPilotCloseouts.attempt))
		.limit(1);
	return row ?? null;
}

export async function reconcileMissionPilotExecution(sessionId: string) {
	const [session] = await db
		.select()
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.id, sessionId))
		.limit(1);
	if (!session)
		throw new MissionPilotError(
			404,
			"MISSION_PILOT_NOT_FOUND",
			"Mission Pilot session not found",
		);
	await releaseMissionPilotQueueHandoff(session.taskId);
	return getMissionPilotExecution(sessionId);
}
