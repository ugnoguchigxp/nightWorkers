import crypto from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import type { MissionPilotPlanReview } from "../../../shared/schemas/mission-pilot-plan-review.schema";
import { db } from "../../db/client";
import {
	missionPilotPlanReviews,
	missionPilotSessions,
} from "../../db/mission-pilot-schema";
import { MissionPilotContextConflictError } from "./mission-pilot-plan-errors";

export async function createPlanReview(input: {
	sessionId: string;
	routingRevision?: number;
	contextRevision: number;
	contextDigest: string;
	featurePlanMessageId: string;
	attempt: number;
	review: MissionPilotPlanReview;
}) {
	const session =
		input.routingRevision === undefined
			? await db.query.missionPilotSessions.findFirst({
					where: eq(missionPilotSessions.id, input.sessionId),
				})
			: null;
	const [row] = await db
		.insert(missionPilotPlanReviews)
		.values({
			id: crypto.randomUUID(),
			...input,
			routingRevision:
				input.routingRevision ?? session?.planRoutingRevision ?? 0,
			verdict: input.review.verdict,
			reviewJson: input.review,
			createdAt: new Date(),
		})
		.returning();
	return row;
}

export async function createCurrentPlanReview(input: {
	sessionId: string;
	leaseOwner: string;
	routingRevision: number;
	contextRevision: number;
	contextDigest: string;
	featurePlanMessageId: string;
	attempt: number;
	review: MissionPilotPlanReview;
}) {
	return db.transaction(async (tx) => {
		const session = await tx.query.missionPilotSessions.findFirst({
			where: eq(missionPilotSessions.id, input.sessionId),
		});
		if (
			!session ||
			session.desiredState !== "playing" ||
			session.leaseOwner !== input.leaseOwner ||
			!session.leaseExpiresAt ||
			session.leaseExpiresAt <= new Date() ||
			session.contextRevision !== input.contextRevision ||
			session.contextDigest !== input.contextDigest ||
			session.planRoutingRevision !== input.routingRevision
		) {
			throw new MissionPilotContextConflictError(
				"Mission Pilot state changed before adopting the plan review",
			);
		}
		const [row] = await tx
			.insert(missionPilotPlanReviews)
			.values({
				id: crypto.randomUUID(),
				sessionId: input.sessionId,
				contextRevision: input.contextRevision,
				contextDigest: input.contextDigest,
				routingRevision: input.routingRevision,
				featurePlanMessageId: input.featurePlanMessageId,
				attempt: input.attempt,
				verdict: input.review.verdict,
				reviewJson: input.review,
				createdAt: new Date(),
			})
			.returning();
		if (!row) {
			throw new MissionPilotContextConflictError(
				"Mission Pilot plan review was not adopted",
			);
		}
		return row;
	});
}

export async function getLatestPlanReview(sessionId: string) {
	const [row] = await db
		.select()
		.from(missionPilotPlanReviews)
		.where(eq(missionPilotPlanReviews.sessionId, sessionId))
		.orderBy(desc(missionPilotPlanReviews.attempt))
		.limit(1);
	return row ?? null;
}

export function listPlanReviews(sessionId: string) {
	return db
		.select()
		.from(missionPilotPlanReviews)
		.where(eq(missionPilotPlanReviews.sessionId, sessionId))
		.orderBy(asc(missionPilotPlanReviews.attempt));
}
