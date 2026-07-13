import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../../db/client";
import {
	missionPilotContextSnapshots,
	missionPilotPhaseRuns,
	missionPilotSessions,
} from "../../db/mission-pilot-schema";
import { taskRuns } from "../../db/schema";
import { executeMissionPilotCloseout } from "./mission-pilot-closeout.service";
import { continueMissionPilotAfterRun } from "./mission-pilot-post-queue-coordinator.service";
import {
	executeMissionPilotContinuation,
	markMissionPilotContinuationFailed,
	resumeInterruptedImplementation,
	startImplementationRework,
} from "./mission-pilot-runtime-continuation.service";

const terminalStatuses = [
	"completed",
	"needs_review",
	"needs_human",
	"failed",
	"blocked",
	"timed_out",
	"cancelled",
] as const;

export async function recoverMissionPilotPostQueueSessions() {
	const sessions = await db
		.select()
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.desiredState, "playing"));
	let recovered = 0;
	for (const session of sessions) {
		if (session.phase === "implementing" && !session.activeRunId) {
			const [interruptedPhaseRun] = await db
				.select()
				.from(missionPilotPhaseRuns)
				.where(
					and(
						eq(missionPilotPhaseRuns.sessionId, session.id),
						eq(missionPilotPhaseRuns.phase, "implementation"),
						eq(missionPilotPhaseRuns.cycle, session.implementationCycle),
						eq(missionPilotPhaseRuns.status, "running"),
					),
				)
				.orderBy(desc(missionPilotPhaseRuns.attempt))
				.limit(1);
			if (interruptedPhaseRun) {
				await db
					.update(missionPilotPhaseRuns)
					.set({
						status: "failed",
						verdict: "attention",
						evidenceJson: {
							...interruptedPhaseRun.evidenceJson,
							interrupted: true,
							resumeReason: "mission_pilot_play",
						},
						finishedAt: new Date(),
					})
					.where(eq(missionPilotPhaseRuns.id, interruptedPhaseRun.id));
			}
			await resumeInterruptedImplementation({
				taskId: session.taskId,
				missionPilot: {
					sessionId: session.id,
					cycle: session.implementationCycle,
					contextRevision: session.contextRevision,
					contextDigest: session.contextDigest,
					...(interruptedPhaseRun
						? { interruptedRunId: interruptedPhaseRun.runId }
						: {}),
				},
			});
			recovered += 1;
			continue;
		}
		if (session.phase === "implementation_rework" && !session.activeRunId) {
			const [latestContext] = await db
				.select()
				.from(missionPilotContextSnapshots)
				.where(eq(missionPilotContextSnapshots.sessionId, session.id))
				.orderBy(desc(missionPilotContextSnapshots.revision))
				.limit(1);
			const pendingRework = readRecord(
				readRecord(latestContext?.contextJson).execution,
			).pendingRework;
			await startImplementationRework({
				taskId: session.taskId,
				missionPilot: {
					sessionId: session.id,
					cycle: session.implementationCycle,
					contextRevision: session.contextRevision,
					contextDigest: session.contextDigest,
					...(pendingRework ? { reworkPacket: pendingRework } : {}),
				},
			});
			recovered += 1;
			continue;
		}
		if (
			["closeout_preparing", "committing", "pushing", "completing"].includes(
				session.phase,
			) &&
			session.activeCloseoutId
		) {
			const closeout = await executeMissionPilotCloseout(session.id);
			if (closeout.status === "rework_required")
				await startImplementationRework(closeout.input);
			recovered += 1;
			continue;
		}
		if (!session.activeRunId) continue;
		const [run] = await db
			.select()
			.from(taskRuns)
			.where(
				and(
					eq(taskRuns.id, session.activeRunId),
					inArray(taskRuns.status, terminalStatuses),
					isNotNull(taskRuns.finishedAt),
				),
			)
			.limit(1);
		if (!run) continue;
		const snapshot = readRecord(run.contextSnapshot);
		const continuation = await continueMissionPilotAfterRun({
			taskId: session.taskId,
			runId: run.id,
			executionMode:
				typeof snapshot.executionMode === "string"
					? snapshot.executionMode
					: "implementation",
		});
		try {
			await executeMissionPilotContinuation(continuation);
		} catch (error) {
			await markMissionPilotContinuationFailed(run.id, error);
		}
		recovered += 1;
	}
	return recovered;
}

function readRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
