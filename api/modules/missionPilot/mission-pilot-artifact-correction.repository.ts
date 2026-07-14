import crypto from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { PlanModeArtifactCorrectionTarget } from "../../../shared/schemas/plan-mode-artifact-correction.schema";
import { db } from "../../db/client";
import {
	missionPilotArtifactCorrectionRuns,
	missionPilotContextSnapshots,
	missionPilotSessions,
} from "../../db/mission-pilot-schema";
import { MissionPilotContextConflictError } from "./mission-pilot-plan-errors";

export async function createArtifactCorrectionRuns(input: {
	sessionId: string;
	taskId: string;
	planReviewId: string;
	contextRevision: number;
	contextDigest: string;
	targets: PlanModeArtifactCorrectionTarget[];
}) {
	const now = new Date();
	const existingRuns = await listArtifactCorrectionRuns(input.sessionId);
	const exhaustedTargets = new Set(
		existingRuns
			.filter((run) => run.planReviewId !== input.planReviewId)
			.map((run) => run.target),
	);
	const scheduledTargets = new Set(
		existingRuns
			.filter((run) => run.planReviewId === input.planReviewId)
			.map((run) => run.target),
	);
	for (const [index, target] of input.targets.entries()) {
		if (
			exhaustedTargets.has(target.target) ||
			scheduledTargets.has(target.target)
		)
			continue;
		scheduledTargets.add(target.target);
		const dispatchKey = crypto
			.createHash("sha256")
			.update(
				JSON.stringify({
					sessionId: input.sessionId,
					planReviewId: input.planReviewId,
					ordinal: index + 1,
					target,
				}),
			)
			.digest("hex");
		await db
			.insert(missionPilotArtifactCorrectionRuns)
			.values({
				id: crypto.randomUUID(),
				sessionId: input.sessionId,
				taskId: input.taskId,
				planReviewId: input.planReviewId,
				ordinal: index + 1,
				target: target.target,
				focusJson: target.focus,
				instruction: target.instruction,
				preserveUnfocusedContent: target.preserveUnfocusedContent,
				sourceMessageId: target.sourceMessageId,
				sourceContextRevision: input.contextRevision,
				sourceContextDigest: input.contextDigest,
				status: "pending",
				dispatchKey,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing();
	}
	return listArtifactCorrectionRunsForReview(input.planReviewId);
}

export function listArtifactCorrectionRunsForReview(planReviewId: string) {
	return db
		.select()
		.from(missionPilotArtifactCorrectionRuns)
		.where(eq(missionPilotArtifactCorrectionRuns.planReviewId, planReviewId))
		.orderBy(asc(missionPilotArtifactCorrectionRuns.ordinal));
}

export function listArtifactCorrectionRuns(sessionId: string) {
	return db
		.select()
		.from(missionPilotArtifactCorrectionRuns)
		.where(eq(missionPilotArtifactCorrectionRuns.sessionId, sessionId))
		.orderBy(desc(missionPilotArtifactCorrectionRuns.createdAt));
}

export function canResumePartialArtifactCorrections(
	runs: Awaited<ReturnType<typeof listArtifactCorrectionRunsForReview>>,
	currentContextRevision: number,
) {
	const hasUnfinished = runs.some((run) =>
		["pending", "failed"].includes(run.status),
	);
	const appliedRevisions = runs
		.filter((run) => run.status === "applied")
		.map((run) => run.outputContextRevision)
		.filter((revision): revision is number => revision !== null);
	return (
		hasUnfinished &&
		appliedRevisions.length > 0 &&
		Math.max(...appliedRevisions) === currentContextRevision
	);
}

export async function getArtifactCorrectionRun(id: string) {
	const [row] = await db
		.select()
		.from(missionPilotArtifactCorrectionRuns)
		.where(eq(missionPilotArtifactCorrectionRuns.id, id));
	return row ?? null;
}

export async function claimArtifactCorrectionRun(id: string) {
	return db.transaction(async (tx) => {
		const [current] = await tx
			.select()
			.from(missionPilotArtifactCorrectionRuns)
			.where(eq(missionPilotArtifactCorrectionRuns.id, id));
		if (!current || !["pending", "failed"].includes(current.status))
			return null;
		const [session] = await tx
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, current.sessionId));
		const [latestContext] = await tx
			.select()
			.from(missionPilotContextSnapshots)
			.where(eq(missionPilotContextSnapshots.sessionId, current.sessionId))
			.orderBy(desc(missionPilotContextSnapshots.revision))
			.limit(1);
		if (
			!session ||
			!latestContext ||
			latestContext.revision !== session.contextRevision ||
			latestContext.digest !== session.contextDigest
		) {
			throw new MissionPilotContextConflictError(
				"Mission Pilot Session and latest Context snapshot diverged",
			);
		}
		const now = new Date();
		const [row] = await tx
			.update(missionPilotArtifactCorrectionRuns)
			.set({
				status: "running",
				attempt: current.attempt + 1,
				sourceContextRevision: session.contextRevision,
				sourceContextDigest: session.contextDigest,
				startedAt: now,
				lastError: null,
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotArtifactCorrectionRuns.id, id),
					eq(missionPilotArtifactCorrectionRuns.attempt, current.attempt),
					inArray(missionPilotArtifactCorrectionRuns.status, [
						"pending",
						"failed",
					]),
				),
			)
			.returning();
		return row ?? null;
	});
}

export async function recordArtifactCorrectionResult(
	id: string,
	input: { resultMessageId: string; resultArtifactId?: string | null },
) {
	const [row] = await db
		.update(missionPilotArtifactCorrectionRuns)
		.set({
			status: "result_received",
			resultMessageId: input.resultMessageId,
			resultArtifactId: input.resultArtifactId ?? null,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(missionPilotArtifactCorrectionRuns.id, id),
				eq(missionPilotArtifactCorrectionRuns.status, "running"),
			),
		)
		.returning();
	return row ?? null;
}

export async function markArtifactCorrectionValidating(id: string) {
	const [row] = await db
		.update(missionPilotArtifactCorrectionRuns)
		.set({ status: "validating", updatedAt: new Date() })
		.where(
			and(
				eq(missionPilotArtifactCorrectionRuns.id, id),
				eq(missionPilotArtifactCorrectionRuns.status, "result_received"),
			),
		)
		.returning();
	return row ?? null;
}

export async function applyArtifactCorrectionRun(
	id: string,
	outputContextRevision: number,
) {
	const [row] = await db
		.update(missionPilotArtifactCorrectionRuns)
		.set({
			status: "applied",
			outputContextRevision,
			finishedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(missionPilotArtifactCorrectionRuns.id, id),
				eq(missionPilotArtifactCorrectionRuns.status, "validating"),
			),
		)
		.returning();
	return row ?? null;
}

export async function failArtifactCorrectionRun(id: string, error: string) {
	await db
		.update(missionPilotArtifactCorrectionRuns)
		.set({
			status: "failed",
			lastError: error,
			finishedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(eq(missionPilotArtifactCorrectionRuns.id, id));
}

export async function recoverArtifactCorrectionRuns(sessionId: string) {
	await db
		.update(missionPilotArtifactCorrectionRuns)
		.set({ status: "pending", updatedAt: new Date() })
		.where(
			and(
				eq(missionPilotArtifactCorrectionRuns.sessionId, sessionId),
				inArray(missionPilotArtifactCorrectionRuns.status, [
					"dispatching",
					"running",
					"result_received",
					"validating",
				]),
			),
		);
}

export async function supersedeArtifactCorrectionRunsForReview(
	planReviewId: string,
) {
	await db
		.update(missionPilotArtifactCorrectionRuns)
		.set({
			status: "superseded",
			finishedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(missionPilotArtifactCorrectionRuns.planReviewId, planReviewId),
				inArray(missionPilotArtifactCorrectionRuns.status, [
					"pending",
					"dispatching",
					"running",
					"result_received",
					"validating",
					"failed",
				]),
			),
		);
}

export async function supersedeConceptArtifactCorrectionRunsForReview(
	planReviewId: string,
) {
	await db
		.update(missionPilotArtifactCorrectionRuns)
		.set({
			status: "superseded",
			finishedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(missionPilotArtifactCorrectionRuns.planReviewId, planReviewId),
				inArray(missionPilotArtifactCorrectionRuns.target, [
					"blueprint",
					"user_flow",
					"activity_flow",
					"sequence_flow",
				]),
				inArray(missionPilotArtifactCorrectionRuns.status, [
					"pending",
					"dispatching",
					"running",
					"result_received",
					"validating",
					"failed",
				]),
			),
		);
}
