import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../../db/client";
import {
	missionPilotContextSnapshots,
	missionPilotPhaseRuns,
	missionPilotSessions,
	missionPilotTestSnapshots,
} from "../../db/mission-pilot-schema";
import { taskRuns } from "../../db/schema";
import { executeMissionPilotCloseout } from "./mission-pilot-closeout.service";
import { appendMissionPilotEvent } from "./mission-pilot-event.repository";
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
		if (
			session.phase === "attention" &&
			!session.activeRunId &&
			session.activePhaseRunId
		) {
			const [phaseRun] = await db
				.select()
				.from(missionPilotPhaseRuns)
				.where(
					and(
						eq(missionPilotPhaseRuns.id, session.activePhaseRunId),
						eq(missionPilotPhaseRuns.sessionId, session.id),
						eq(missionPilotPhaseRuns.taskId, session.taskId),
						eq(missionPilotPhaseRuns.phase, "test"),
					),
				)
				.limit(1);
			const run = phaseRun ? await findTerminalRun(phaseRun.runId) : null;
			if (phaseRun && run) {
				const continuation = await continueMissionPilotAfterRun({
					taskId: session.taskId,
					runId: run.id,
					executionMode: "test",
				});
				try {
					await executeMissionPilotContinuation(continuation);
					if (continuation.kind === "start_review") {
						await appendMissionPilotEvent({
							sessionId: session.id,
							taskId: session.taskId,
							eventType: "mission_pilot.test_gate_recovered",
							phase: "review_preparing",
							cycle: phaseRun.cycle,
							contextRevision: session.contextRevision,
							contextDigest: session.contextDigest,
							dedupeKey: `test:${phaseRun.id}:gate-recovered`,
							sourceKind: "task_run",
							sourceId: run.id,
							payload: { phaseRunId: phaseRun.id, runId: run.id },
						});
					}
				} catch (error) {
					await markMissionPilotContinuationFailed(run.id, error);
				}
				recovered += 1;
				continue;
			}
		}
		if (
			["attention", "review_preparing"].includes(session.phase) &&
			!session.activeRunId &&
			session.activeTestSnapshotId
		) {
			const [snapshot] = await db
				.select()
				.from(missionPilotTestSnapshots)
				.where(
					and(
						eq(missionPilotTestSnapshots.id, session.activeTestSnapshotId),
						eq(missionPilotTestSnapshots.sessionId, session.id),
					),
				)
				.limit(1);
			const [phaseRun] = snapshot
				? await db
						.select()
						.from(missionPilotPhaseRuns)
						.where(eq(missionPilotPhaseRuns.id, snapshot.phaseRunId))
						.limit(1)
				: [];
			if (phaseRun) {
				const continuation = await continueMissionPilotAfterRun({
					taskId: session.taskId,
					runId: phaseRun.runId,
					executionMode: "test",
				});
				try {
					await executeMissionPilotContinuation(continuation);
				} catch (error) {
					await markMissionPilotContinuationFailed(phaseRun.runId, error);
				}
				recovered += 1;
				continue;
			}
		}
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

async function findTerminalRun(runId: string) {
	const [run] = await db
		.select()
		.from(taskRuns)
		.where(
			and(
				eq(taskRuns.id, runId),
				inArray(taskRuns.status, terminalStatuses),
				isNotNull(taskRuns.finishedAt),
			),
		)
		.limit(1);
	return run ?? null;
}

function readRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
