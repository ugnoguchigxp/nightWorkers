import crypto from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db/client";
import {
	missionPilotPhaseRuns,
	missionPilotSessions,
} from "../../db/mission-pilot-schema";
import {
	registerTaskRunAssociationHandler,
	type TaskRunAssociationRequest,
} from "../agentsShare";
import { appendMissionPilotEvent } from "./mission-pilot-event.repository";
import type { MissionPilotImplementationEnvelope } from "./mission-pilot-implementation-todo-projection.service";
import { parseMissionPilotReworkPacket } from "./mission-pilot-rework";

const MISSION_PILOT_RUN_ASSOCIATION_KIND = "mission_pilot";

export type MissionPilotRunPhase =
	| "repository_bootstrap"
	| "implementation"
	| "review";

export class MissionPilotRunAssociationError extends Error {
	constructor(
		message = "Mission Pilot could not claim the prepared child run.",
	) {
		super(message);
		this.name = "MissionPilotRunAssociationError";
	}
}

export function readMissionPilotRunAssociationPayload(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Record<string, unknown>;
	if (
		candidate.phase !== "repository_bootstrap" &&
		candidate.phase !== "implementation" &&
		candidate.phase !== "review"
	)
		return null;
	const phase: MissionPilotRunPhase = candidate.phase;
	const missionPilot = record(candidate.missionPilot);
	if (
		typeof missionPilot.sessionId !== "string" ||
		typeof missionPilot.cycle !== "number" ||
		typeof missionPilot.contextRevision !== "number" ||
		typeof missionPilot.contextDigest !== "string"
	)
		return null;
	const hasReworkPacket = Object.hasOwn(missionPilot, "reworkPacket");
	const reworkPacket = parseMissionPilotReworkPacket(missionPilot.reworkPacket);
	if (hasReworkPacket && !reworkPacket) return null;
	return {
		phase,
		missionPilot: {
			sessionId: missionPilot.sessionId,
			cycle: missionPilot.cycle,
			contextRevision: missionPilot.contextRevision,
			contextDigest: missionPilot.contextDigest,
			...(reworkPacket ? { reworkPacket } : {}),
		},
	};
}

export function buildMissionPilotRunAssociationRequest(input: {
	phase: MissionPilotRunPhase;
	missionPilot: unknown;
}): TaskRunAssociationRequest {
	const payload = readMissionPilotRunAssociationPayload(input);
	if (!payload) {
		throw new MissionPilotRunAssociationError(
			"Mission Pilot run association payload is invalid.",
		);
	}
	return { kind: MISSION_PILOT_RUN_ASSOCIATION_KIND, payload };
}

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
	const [updatedSession] = await db
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
				eq(missionPilotSessions.desiredState, "playing"),
				eq(missionPilotSessions.contextDigest, session.contextDigest),
				eq(missionPilotSessions.implementationCycle, input.missionPilot.cycle),
				inArray(missionPilotSessions.phase, [
					"queued",
					"implementation_starting",
					"implementing",
				]),
				isNull(missionPilotSessions.activeRunId),
				isNull(missionPilotSessions.activePhaseRunId),
			),
		)
		.returning({ id: missionPilotSessions.id });
	if (!updatedSession) {
		if (!existing) {
			await db
				.delete(missionPilotPhaseRuns)
				.where(eq(missionPilotPhaseRuns.id, phaseRun.id));
		}
		return null;
	}
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
	phase: MissionPilotRunPhase;
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
	const expectedCycle = session
		? missionPilotCycleForPhase(session, input.phase)
		: null;
	if (
		!session ||
		session.taskId !== input.taskId ||
		session.desiredState !== "playing" ||
		expectedCycle !== input.missionPilot.cycle ||
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
	const [updatedSession] = await db
		.update(missionPilotSessions)
		.set({
			phase:
				input.phase === "repository_bootstrap"
					? "repository_bootstrapping"
					: input.phase === "implementation"
						? "implementing"
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
		.where(
			and(
				eq(missionPilotSessions.id, session.id),
				eq(missionPilotSessions.desiredState, "playing"),
				eq(
					missionPilotSessions.contextRevision,
					input.missionPilot.contextRevision,
				),
				eq(
					missionPilotSessions.contextDigest,
					input.missionPilot.contextDigest,
				),
				phaseCycleCondition(input.phase, input.missionPilot.cycle),
				inArray(
					missionPilotSessions.phase,
					missionPilotAssociationSourcePhases(input.phase),
				),
				isNull(missionPilotSessions.activeRunId),
				isNull(missionPilotSessions.activePhaseRunId),
			),
		)
		.returning({ id: missionPilotSessions.id });
	if (!updatedSession) {
		await db
			.delete(missionPilotPhaseRuns)
			.where(eq(missionPilotPhaseRuns.id, phaseRun.id));
		return null;
	}
	await appendMissionPilotEvent({
		sessionId: session.id,
		taskId: session.taskId,
		eventType: `${input.phase}_mode.run_started`,
		phase:
			input.phase === "repository_bootstrap"
				? "repository_bootstrapping"
				: input.phase === "implementation"
					? "implementing"
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

function missionPilotCycleForPhase(
	session: typeof missionPilotSessions.$inferSelect,
	phase: MissionPilotRunPhase,
) {
	if (phase === "review") return session.reviewCycle;
	return session.implementationCycle;
}

function phaseCycleCondition(phase: MissionPilotRunPhase, cycle: number) {
	if (phase === "review") return eq(missionPilotSessions.reviewCycle, cycle);
	return eq(missionPilotSessions.implementationCycle, cycle);
}

function missionPilotAssociationSourcePhases(phase: MissionPilotRunPhase) {
	if (phase === "repository_bootstrap")
		return ["repository_bootstrap_preparing", "repository_bootstrapping"];
	if (phase === "implementation")
		return [
			"queued",
			"implementation_starting",
			"implementation_rework",
			"implementing",
		];
	return ["review_preparing", "reviewing"];
}

registerTaskRunAssociationHandler(
	MISSION_PILOT_RUN_ASSOCIATION_KIND,
	async ({ taskId, runId, payload }) => {
		const association = readMissionPilotRunAssociationPayload(payload);
		if (!association) {
			throw new MissionPilotRunAssociationError(
				"Mission Pilot run association payload is invalid.",
			);
		}
		const associated = await associateMissionPilotChildRun({
			taskId,
			runId,
			...association,
		});
		if (!associated) throw new MissionPilotRunAssociationError();
	},
);
