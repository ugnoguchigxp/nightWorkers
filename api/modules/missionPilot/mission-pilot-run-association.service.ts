import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import {
	missionPilotPhaseRuns,
	missionPilotSessions,
} from "../../db/mission-pilot-schema";
import { appendMissionPilotEvent } from "./mission-pilot-event.repository";
import type { MissionPilotImplementationEnvelope } from "./mission-pilot-implementation-todo-projection.service";

export async function associateMissionPilotImplementationRun(input: {
	taskId: string;
	runId: string;
	missionPilot: MissionPilotImplementationEnvelope;
}) {
	const [session] = await db
		.select()
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.id, input.missionPilot.sessionId))
		.limit(1);
	if (
		!session ||
		session.taskId !== input.taskId ||
		session.desiredState !== "playing" ||
		session.implementationCycle !== input.missionPilot.cycle ||
		session.contextRevision !== input.missionPilot.contextRevision ||
		session.contextDigest !== input.missionPilot.contextDigest
	)
		return null;
	if (
		!["queued", "implementation_starting", "implementing"].includes(
			session.phase,
		)
	)
		return null;
	const handoff = session.queueHandoffJson;
	if (
		!handoff ||
		handoff.reviewedContextDigest !== input.missionPilot.contextDigest ||
		handoff.featurePlanMessageId !== input.missionPilot.featurePlanMessageId ||
		handoff.verificationDocumentId !==
			input.missionPilot.verificationDocumentId ||
		handoff.planReviewId !== input.missionPilot.planReviewId
	)
		return null;
	const now = new Date();
	const cycle = session.implementationCycle;
	const [existing] = await db
		.select()
		.from(missionPilotPhaseRuns)
		.where(eq(missionPilotPhaseRuns.runId, input.runId))
		.limit(1);
	const phaseRun =
		existing ??
		(
			await db
				.insert(missionPilotPhaseRuns)
				.values({
					id: crypto.randomUUID(),
					sessionId: session.id,
					taskId: session.taskId,
					phase: "implementation",
					cycle,
					attempt: 1,
					runId: input.runId,
					inputContextRevision: session.contextRevision,
					inputContextDigest: session.contextDigest,
					status: "running",
					evidenceJson: { queueHandoff: handoff },
					startedAt: now,
				})
				.onConflictDoNothing({ target: missionPilotPhaseRuns.runId })
				.returning()
		)[0];
	if (!phaseRun) return null;
	if (existing) {
		await db
			.update(missionPilotPhaseRuns)
			.set({
				evidenceJson: {
					...record(existing.evidenceJson),
					queueHandoff: handoff,
				},
			})
			.where(eq(missionPilotPhaseRuns.id, existing.id));
	}
	await db
		.update(missionPilotSessions)
		.set({
			phase: "implementing",
			activeRunId: input.runId,
			activePhaseRunId: phaseRun.id,
			updatedAt: now,
		})
		.where(
			and(
				eq(missionPilotSessions.id, session.id),
				eq(missionPilotSessions.contextDigest, session.contextDigest),
			),
		);
	await appendMissionPilotEvent({
		sessionId: session.id,
		taskId: session.taskId,
		eventType: "mission_pilot.phase_run_created",
		phase: "implementing",
		cycle,
		contextRevision: session.contextRevision,
		contextDigest: session.contextDigest,
		dedupeKey: `implementation:${cycle}:run:${input.runId}`,
		sourceKind: "task_run",
		sourceId: input.runId,
		payload: { phaseRunId: phaseRun.id },
	});
	return phaseRun;
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export async function associateMissionPilotChildRun(input: {
	taskId: string;
	runId: string;
	phase: "repository_bootstrap" | "implementation" | "test" | "review";
	missionPilot: {
		sessionId: string;
		cycle: number;
		contextRevision: number;
		contextDigest: string;
	};
}) {
	const [session] = await db
		.select()
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.id, input.missionPilot.sessionId))
		.limit(1);
	if (
		!session ||
		session.taskId !== input.taskId ||
		session.desiredState !== "playing" ||
		session.implementationCycle !== input.missionPilot.cycle ||
		session.contextRevision !== input.missionPilot.contextRevision ||
		session.contextDigest !== input.missionPilot.contextDigest
	)
		return null;
	const now = new Date();
	const previousAttempts = await db
		.select()
		.from(missionPilotPhaseRuns)
		.where(
			and(
				eq(missionPilotPhaseRuns.sessionId, session.id),
				eq(missionPilotPhaseRuns.phase, input.phase),
				eq(missionPilotPhaseRuns.cycle, input.missionPilot.cycle),
			),
		);
	const attempt =
		Math.max(0, ...previousAttempts.map((item) => item.attempt)) + 1;
	const [phaseRun] = await db
		.insert(missionPilotPhaseRuns)
		.values({
			id: crypto.randomUUID(),
			sessionId: session.id,
			taskId: session.taskId,
			phase: input.phase,
			cycle: input.missionPilot.cycle,
			attempt,
			runId: input.runId,
			inputContextRevision: input.missionPilot.contextRevision,
			inputContextDigest: input.missionPilot.contextDigest,
			status: "running",
			evidenceJson: {},
			startedAt: now,
		})
		.onConflictDoNothing({ target: missionPilotPhaseRuns.runId })
		.returning();
	if (!phaseRun) return null;
	await db
		.update(missionPilotSessions)
		.set({
			phase:
				input.phase === "repository_bootstrap"
					? "repository_bootstrapping"
					: input.phase === "implementation"
						? "implementing"
						: input.phase === "test"
							? "testing"
							: "reviewing",
			activeRunId: input.runId,
			activePhaseRunId: phaseRun.id,
			...(input.phase === "repository_bootstrap"
				? {
						preQueueDiagnosticJson: null,
						lastErrorCode: null,
						lastErrorMessage: null,
					}
				: {}),
			updatedAt: now,
		})
		.where(eq(missionPilotSessions.id, session.id));
	await appendMissionPilotEvent({
		sessionId: session.id,
		taskId: session.taskId,
		eventType: `${input.phase}_mode.run_started`,
		phase:
			input.phase === "repository_bootstrap"
				? "repository_bootstrapping"
				: input.phase === "implementation"
					? "implementing"
					: input.phase === "test"
						? "testing"
						: "reviewing",
		cycle: input.missionPilot.cycle,
		contextRevision: input.missionPilot.contextRevision,
		contextDigest: input.missionPilot.contextDigest,
		dedupeKey: `${input.phase}:${input.missionPilot.cycle}:run:${input.runId}`,
		sourceKind: "task_run",
		sourceId: input.runId,
		payload: { phaseRunId: phaseRun.id },
	});
	return phaseRun;
}
