import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { missionPilotQueueHandoffSchema } from "../../../shared/modules/missionPilot";
import { db } from "../../db/client";
import {
	missionPilotEvents,
	missionPilotPlanReviews,
	missionPilotSessions,
} from "../../db/mission-pilot-schema";
import { implementationQueueEntries, taskMessages } from "../../db/schema";
import { readFeaturePlanImplementationPlanMetadata } from "../specification/feature-plan-implementation-plan";

type QueueEntry = typeof implementationQueueEntries.$inferSelect;
type MissionPilotSessionGuard = { sessionId: string; version: number };

export type MissionPilotImplementationEnvelope = {
	sessionId: string;
	cycle: number;
	contextRevision: number;
	contextDigest: string;
	featurePlanMessageId: string;
	verificationDocumentId: string;
	planReviewId: string;
	implementationPlanProvenance: {
		version: 1;
		sourceMessageId: string;
		digest: string;
	};
};

export type MissionPilotImplementationStartResolution =
	| { kind: "not_mission_pilot" }
	| {
			kind: "ready";
			envelope: MissionPilotImplementationEnvelope;
			implementationPlanProvenance: {
				version: 1;
				sourceMessageId: string;
				digest: string;
			};
	  }
	| {
			kind: "blocked";
			code: string;
			message: string;
			sessionGuard: MissionPilotSessionGuard | null;
	  };

export async function resolveMissionPilotImplementationStart(
	entry: QueueEntry,
): Promise<MissionPilotImplementationStartResolution> {
	if (!entry.missionPilotAdmissionKey) return { kind: "not_mission_pilot" };
	const [session] = await db
		.select()
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.taskId, entry.taskId))
		.limit(1);
	if (session?.desiredState !== "playing") {
		return blocked(
			"MISSION_PILOT_IMPLEMENTATION_HANDOFF_MISMATCH",
			"Mission Pilot Session is missing or is not playing.",
			session,
		);
	}
	const parsedHandoff = missionPilotQueueHandoffSchema.safeParse(
		session.queueHandoffJson,
	);
	if (!parsedHandoff.success) {
		return blocked(
			"MISSION_PILOT_IMPLEMENTATION_TODO_PROJECTION_MISSING",
			"Mission Pilot Queue handoff is missing or invalid.",
			session,
		);
	}
	const handoff = parsedHandoff.data;
	if (
		handoff.admissionKey !== entry.missionPilotAdmissionKey ||
		handoff.queueEntryId !== entry.id ||
		handoff.taskId !== entry.taskId ||
		handoff.sessionId !== session.id ||
		handoff.reviewedContextRevision !== session.contextRevision ||
		handoff.reviewedContextDigest !== session.contextDigest ||
		handoff.routingRevision !== session.planRoutingRevision ||
		handoff.implementationTodoProjectionVersion !== 1 ||
		handoff.implementationPlanSourceMessageId !== handoff.featurePlanMessageId
	) {
		return blocked(
			"MISSION_PILOT_IMPLEMENTATION_HANDOFF_MISMATCH",
			"Mission Pilot Queue entry does not match its reviewed handoff.",
			session,
		);
	}
	const [[review], [featurePlanMessage]] = await Promise.all([
		db
			.select()
			.from(missionPilotPlanReviews)
			.where(eq(missionPilotPlanReviews.id, handoff.planReviewId))
			.limit(1),
		db
			.select()
			.from(taskMessages)
			.where(eq(taskMessages.id, handoff.implementationPlanSourceMessageId))
			.limit(1),
	]);
	if (
		!review ||
		review.sessionId !== session.id ||
		review.verdict !== "pass" ||
		review.contextRevision !== handoff.reviewedContextRevision ||
		review.contextDigest !== handoff.reviewedContextDigest ||
		review.routingRevision !== handoff.routingRevision ||
		review.featurePlanMessageId !== handoff.featurePlanMessageId
	) {
		return blocked(
			"MISSION_PILOT_IMPLEMENTATION_HANDOFF_MISMATCH",
			"Mission Pilot passing review does not match its Queue handoff.",
			session,
		);
	}
	if (!featurePlanMessage || featurePlanMessage.taskId !== entry.taskId) {
		return blocked(
			"MISSION_PILOT_IMPLEMENTATION_TODO_PROJECTION_MISSING",
			"Reviewed Feature Plan message is missing.",
			session,
		);
	}
	const implementationPlan = readFeaturePlanImplementationPlanMetadata(
		featurePlanMessage.metadataJson,
	);
	if (!implementationPlan) {
		return blocked(
			"MISSION_PILOT_IMPLEMENTATION_TODO_PROJECTION_INVALID",
			"Reviewed Feature Plan implementation plan is missing or invalid.",
			session,
		);
	}
	if (implementationPlan.digest !== handoff.implementationPlanDigest) {
		return blocked(
			"MISSION_PILOT_IMPLEMENTATION_TODO_PROJECTION_DIGEST_MISMATCH",
			"Reviewed Feature Plan implementation plan digest does not match the Queue handoff.",
			session,
		);
	}
	return {
		kind: "ready",
		envelope: {
			sessionId: session.id,
			cycle: session.implementationCycle,
			contextRevision: session.contextRevision,
			contextDigest: session.contextDigest,
			featurePlanMessageId: handoff.featurePlanMessageId,
			verificationDocumentId: handoff.verificationDocumentId,
			planReviewId: handoff.planReviewId,
			implementationPlanProvenance: {
				version: 1,
				sourceMessageId: handoff.implementationPlanSourceMessageId,
				digest: implementationPlan.digest,
			},
		},
		implementationPlanProvenance: {
			version: 1,
			sourceMessageId: handoff.implementationPlanSourceMessageId,
			digest: implementationPlan.digest,
		},
	};
}

export async function holdBlockedMissionPilotImplementationStart(input: {
	entry: QueueEntry;
	code: string;
	message: string;
	sessionGuard: MissionPilotSessionGuard | null;
}) {
	const now = new Date();
	return db.transaction(async (tx) => {
		const [held] = await tx
			.update(implementationQueueEntries)
			.set({
				status: "queued",
				claimReady: false,
				processorSlot: null,
				activeRunId: null,
				claimedAt: null,
				lastHeartbeatAt: null,
				leaseOwnerId: null,
				leaseAcquiredAt: null,
				leaseExpiresAt: null,
				statusReason: input.message,
				lastFailureKind: "mission_pilot_todo_projection_blocked",
				updatedAt: now,
			})
			.where(
				and(
					eq(implementationQueueEntries.id, input.entry.id),
					eq(implementationQueueEntries.status, "claimed"),
					eq(implementationQueueEntries.leaseVersion, input.entry.leaseVersion),
				),
			)
			.returning();
		if (!held) {
			throw new Error(
				"Implementation Queue lease changed before Mission Pilot projection hold.",
			);
		}
		if (!input.sessionGuard) return { entry: held, session: null };
		const [session] = await tx
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, input.sessionGuard.sessionId))
			.limit(1);
		if (
			!session ||
			session.taskId !== input.entry.taskId ||
			session.version !== input.sessionGuard.version
		)
			return { entry: held, session: null };
		const diagnosticHandoff = missionPilotQueueHandoffSchema.safeParse(
			session.queueHandoffJson,
		);
		const [updatedSession] = await tx
			.update(missionPilotSessions)
			.set({
				phase: "attention",
				resumePhase: "implementation_starting",
				activeRunId: null,
				lastErrorCode: input.code,
				lastErrorMessage: input.message,
				version: sql`${missionPilotSessions.version} + 1`,
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotSessions.id, session.id),
					eq(missionPilotSessions.version, input.sessionGuard.version),
				),
			)
			.returning();
		if (!updatedSession) return { entry: held, session: null };
		await tx
			.insert(missionPilotEvents)
			.values({
				id: crypto.randomUUID(),
				sessionId: session.id,
				taskId: session.taskId,
				eventType: "todo_projection_blocked",
				phase: "attention",
				cycle: session.implementationCycle,
				contextRevision: session.contextRevision,
				contextDigest: session.contextDigest,
				dedupeKey: `todo-projection:blocked:${input.entry.id}:${input.entry.leaseVersion}`,
				sourceKind: "queue",
				sourceId: input.entry.id,
				payloadJson: {
					code: input.code,
					message: input.message,
					admissionKey: input.entry.missionPilotAdmissionKey,
					...(diagnosticHandoff.success
						? {
								featurePlanMessageId:
									diagnosticHandoff.data.featurePlanMessageId,
								planReviewId: diagnosticHandoff.data.planReviewId,
								reviewedContextRevision:
									diagnosticHandoff.data.reviewedContextRevision,
								reviewedContextDigest:
									diagnosticHandoff.data.reviewedContextDigest,
								implementationPlanDigest:
									diagnosticHandoff.data.implementationPlanDigest,
							}
						: {}),
				},
				processStatus: "pending",
				attemptCount: 0,
				availableAt: now,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing({
				target: [missionPilotEvents.sessionId, missionPilotEvents.dedupeKey],
			});
		return { entry: held, session: updatedSession };
	});
}

function blocked(
	code: string,
	message: string,
	session: { id: string; version: number } | null | undefined,
) {
	return {
		kind: "blocked",
		code,
		message,
		sessionGuard: session
			? { sessionId: session.id, version: session.version }
			: null,
	} as const;
}
