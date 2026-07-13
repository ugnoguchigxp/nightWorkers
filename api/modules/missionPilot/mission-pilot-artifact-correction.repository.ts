import crypto from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { PlanModeArtifactCorrectionTarget } from "../../../shared/schemas/plan-mode-artifact-correction.schema";
import { db } from "../../db/client";
import { missionPilotArtifactCorrectionRuns } from "../../db/mission-pilot-schema";

export async function createArtifactCorrectionRuns(input: {
	sessionId: string;
	taskId: string;
	planReviewId: string;
	contextRevision: number;
	contextDigest: string;
	targets: PlanModeArtifactCorrectionTarget[];
}) {
	const now = new Date();
	for (const [index, target] of input.targets.entries()) {
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

export async function getArtifactCorrectionRun(id: string) {
	const [row] = await db
		.select()
		.from(missionPilotArtifactCorrectionRuns)
		.where(eq(missionPilotArtifactCorrectionRuns.id, id));
	return row ?? null;
}

export async function claimArtifactCorrectionRun(id: string) {
	const [current] = await db
		.select()
		.from(missionPilotArtifactCorrectionRuns)
		.where(eq(missionPilotArtifactCorrectionRuns.id, id));
	if (!current || !["pending", "failed"].includes(current.status)) return null;
	const [row] = await db
		.update(missionPilotArtifactCorrectionRuns)
		.set({
			status: "running",
			attempt: current.attempt + 1,
			startedAt: new Date(),
			lastError: null,
			updatedAt: new Date(),
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
