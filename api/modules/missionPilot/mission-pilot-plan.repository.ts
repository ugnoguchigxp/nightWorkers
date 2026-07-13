import crypto from "node:crypto";
import {
	and,
	asc,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	lt,
	or,
} from "drizzle-orm";
import type { PlanModeExecutionStep } from "../../../shared/plan-mode-execution";
import type { MissionPilotPlanReview } from "../../../shared/schemas/mission-pilot-plan-review.schema";
import { db } from "../../db/client";
import {
	missionPilotArtifactCorrectionRuns,
	missionPilotContextSnapshots,
	missionPilotPlanReviews,
	missionPilotSessions,
	missionPilotSteps,
} from "../../db/mission-pilot-schema";

export class MissionPilotContextConflictError extends Error {}

export {
	applyArtifactCorrectionRun,
	claimArtifactCorrectionRun,
	createArtifactCorrectionRuns,
	failArtifactCorrectionRun,
	getArtifactCorrectionRun,
	listArtifactCorrectionRuns,
	listArtifactCorrectionRunsForReview,
	markArtifactCorrectionValidating,
	recordArtifactCorrectionResult,
	recoverArtifactCorrectionRuns,
	supersedeArtifactCorrectionRunsForReview,
	supersedeConceptArtifactCorrectionRunsForReview,
} from "./mission-pilot-artifact-correction.repository";

export async function claimPipelineLease(input: {
	taskId: string;
	owner: string;
	expiresAt: Date;
}) {
	const now = new Date();
	const session = await db.query.missionPilotSessions.findFirst({
		where: eq(missionPilotSessions.taskId, input.taskId),
	});
	if (
		!session ||
		session.desiredState !== "playing" ||
		session.nextWakeAt ||
		(session.leaseOwner &&
			session.leaseExpiresAt &&
			session.leaseExpiresAt > now)
	)
		return null;
	const [claimed] = await db
		.update(missionPilotSessions)
		.set({
			leaseOwner: input.owner,
			leaseExpiresAt: input.expiresAt,
			version: session.version + 1,
			updatedAt: now,
		})
		.where(
			and(
				eq(missionPilotSessions.id, session.id),
				eq(missionPilotSessions.version, session.version),
				eq(missionPilotSessions.desiredState, "playing"),
				isNull(missionPilotSessions.nextWakeAt),
				or(
					isNull(missionPilotSessions.leaseOwner),
					isNull(missionPilotSessions.leaseExpiresAt),
					lt(missionPilotSessions.leaseExpiresAt, now),
				),
			),
		)
		.returning();
	return claimed ?? null;
}

export async function renewPipelineLease(input: {
	sessionId: string;
	owner: string;
	expiresAt: Date;
}) {
	const [renewed] = await db
		.update(missionPilotSessions)
		.set({ leaseExpiresAt: input.expiresAt, updatedAt: new Date() })
		.where(
			and(
				eq(missionPilotSessions.id, input.sessionId),
				eq(missionPilotSessions.leaseOwner, input.owner),
				eq(missionPilotSessions.desiredState, "playing"),
			),
		)
		.returning();
	return renewed ?? null;
}

export async function releasePipelineLease(sessionId: string, owner: string) {
	await db
		.update(missionPilotSessions)
		.set({
			leaseOwner: null,
			leaseExpiresAt: null,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(missionPilotSessions.id, sessionId),
				eq(missionPilotSessions.leaseOwner, owner),
			),
		);
}

export async function recoverPipelineLeases() {
	const leased = await db
		.select({
			id: missionPilotSessions.id,
			leaseOwner: missionPilotSessions.leaseOwner,
			leaseExpiresAt: missionPilotSessions.leaseExpiresAt,
		})
		.from(missionPilotSessions)
		.where(isNotNull(missionPilotSessions.leaseOwner));
	const recovered: string[] = [];
	for (const session of leased) {
		if (!session.leaseOwner) continue;
		if (
			isLeaseOwnerProcessAlive(session.leaseOwner) &&
			(!session.leaseExpiresAt || session.leaseExpiresAt > new Date())
		)
			continue;
		const [row] = await db
			.update(missionPilotSessions)
			.set({ leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date() })
			.where(
				and(
					eq(missionPilotSessions.id, session.id),
					eq(missionPilotSessions.leaseOwner, session.leaseOwner),
				),
			)
			.returning({ id: missionPilotSessions.id });
		if (row) recovered.push(row.id);
	}
	return recovered;
}

function isLeaseOwnerProcessAlive(owner: string) {
	const [pidText] = owner.split(":", 1);
	const pid = Number(pidText);
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export async function synchronizePlanSteps(
	sessionId: string,
	steps: PlanModeExecutionStep[],
) {
	const session = await db.query.missionPilotSessions.findFirst({
		where: eq(missionPilotSessions.id, sessionId),
	});
	if (!session) return [];
	const existing = await db
		.select()
		.from(missionPilotSteps)
		.where(eq(missionPilotSteps.sessionId, sessionId));
	const byKey = new Map(existing.map((row) => [row.stepKey, row]));
	const now = new Date();
	for (const step of steps) {
		const current = byKey.get(step.key);
		if (!current) {
			const routingInvalidated =
				session.planRoutingRevision > 0 &&
				step.key !== "questionnaire" &&
				step.decision === "include";
			await db.insert(missionPilotSteps).values({
				id: crypto.randomUUID(),
				sessionId,
				stepKey: step.key,
				ordinal: step.ordinal,
				status: routingInvalidated ? "pending" : step.status,
				contextRevision: session.contextRevision,
				contextDigest: session.contextDigest,
				evidenceJson: {
					kind: step.kind,
					view: step.view,
					required: step.required,
					enabled: step.enabled,
					decision: step.decision,
					...(routingInvalidated
						? { invalidatedByRoutingRevision: session.planRoutingRevision }
						: {}),
				},
				createdAt: now,
				updatedAt: now,
			});
			continue;
		}
		if (current.status === "running" || current.status === "completed")
			if (
				current.evidenceJson.invalidatedByRoutingRevision !==
					session.planRoutingRevision ||
				current.evidenceJson.artifactRoutingRevision ===
					session.planRoutingRevision
			)
				continue;
		const routingInvalidated =
			current.evidenceJson.invalidatedByRoutingRevision ===
				session.planRoutingRevision &&
			current.evidenceJson.artifactRoutingRevision !==
				session.planRoutingRevision;
		await db
			.update(missionPilotSteps)
			.set({
				ordinal: step.ordinal,
				status: routingInvalidated
					? step.decision === "omit"
						? "skipped"
						: "pending"
					: step.status === "skipped" || step.status === "completed"
						? step.status
						: current.status === "failed"
							? "failed"
							: step.status,
				evidenceJson: {
					...current.evidenceJson,
					kind: step.kind,
					view: step.view,
					required: step.required,
					enabled: step.enabled,
					decision: step.decision,
				},
				updatedAt: now,
			})
			.where(eq(missionPilotSteps.id, current.id));
	}
	const activeStepKeys = new Set(steps.map((step) => step.key));
	for (const current of existing) {
		const kind = current.evidenceJson.kind;
		if (
			activeStepKeys.has(current.stepKey) ||
			current.status === "completed" ||
			current.status === "running" ||
			![
				"questionnaire",
				"blueprint",
				"data_model",
				"dedicated_view",
				"feature_plan",
			].includes(String(kind))
		)
			continue;
		await db
			.update(missionPilotSteps)
			.set({
				status: "skipped",
				evidenceJson: {
					...current.evidenceJson,
					skippedReason: "No longer included in the Plan Mode execution plan",
				},
				updatedAt: now,
			})
			.where(eq(missionPilotSteps.id, current.id));
	}
	return listPlanSteps(sessionId);
}

export function listPlanSteps(sessionId: string) {
	return db
		.select()
		.from(missionPilotSteps)
		.where(eq(missionPilotSteps.sessionId, sessionId))
		.orderBy(asc(missionPilotSteps.ordinal));
}

export async function updatePlanStepEvidence(
	stepId: string,
	evidence: Record<string, unknown>,
) {
	const [current] = await db
		.select()
		.from(missionPilotSteps)
		.where(eq(missionPilotSteps.id, stepId));
	if (!current) return null;
	const [updated] = await db
		.update(missionPilotSteps)
		.set({
			evidenceJson: { ...current.evidenceJson, ...evidence },
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(missionPilotSteps.id, stepId),
				eq(missionPilotSteps.status, current.status),
				eq(missionPilotSteps.attempt, current.attempt),
			),
		)
		.returning();
	return updated ?? null;
}

export async function recoverRunningPlanSteps(sessionId: string) {
	await db
		.update(missionPilotSteps)
		.set({ status: "pending", updatedAt: new Date() })
		.where(
			and(
				eq(missionPilotSteps.sessionId, sessionId),
				eq(missionPilotSteps.status, "running"),
			),
		);
}

export async function claimPlanStep(stepId: string) {
	const [current] = await db
		.select()
		.from(missionPilotSteps)
		.where(eq(missionPilotSteps.id, stepId));
	if (!current || !["pending", "failed"].includes(current.status)) return null;
	const [claimed] = await db
		.update(missionPilotSteps)
		.set({
			status: "running",
			attempt: current.attempt + 1,
			startedAt: new Date(),
			lastError: null,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(missionPilotSteps.id, stepId),
				eq(missionPilotSteps.attempt, current.attempt),
				inArray(missionPilotSteps.status, ["pending", "failed"]),
			),
		)
		.returning();
	return claimed ?? null;
}

export async function completePlanStep(
	stepId: string,
	input: { artifactMessageId: string; evidence: Record<string, unknown> },
) {
	const [row] = await db
		.update(missionPilotSteps)
		.set({
			status: "completed",
			artifactMessageId: input.artifactMessageId,
			evidenceJson: input.evidence,
			finishedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(missionPilotSteps.id, stepId),
				eq(missionPilotSteps.status, "running"),
			),
		)
		.returning();
	return row ?? null;
}

export async function adoptPlanStepArtifact(
	stepId: string,
	input: { artifactMessageId: string; evidence: Record<string, unknown> },
) {
	const [row] = await db
		.update(missionPilotSteps)
		.set({
			status: "completed",
			artifactMessageId: input.artifactMessageId,
			evidenceJson: input.evidence,
			finishedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(missionPilotSteps.id, stepId),
				inArray(missionPilotSteps.status, ["pending", "completed", "failed"]),
			),
		)
		.returning();
	return row ?? null;
}

export async function failPlanStep(stepId: string, error: string) {
	await db
		.update(missionPilotSteps)
		.set({ status: "failed", lastError: error, updatedAt: new Date() })
		.where(eq(missionPilotSteps.id, stepId));
}

export async function appendPlanContext(
	sessionId: string,
	reason: "task" | "questionnaire" | "artifact" | "review",
	entry: Record<string, unknown>,
	options: { correctionRunId?: string } = {},
) {
	return db.transaction(async (tx) => {
		const [session] = await tx
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, sessionId));
		if (!session) {
			throw new MissionPilotContextConflictError(
				"Mission Pilot Session is missing",
			);
		}
		const [latest] = await tx
			.select()
			.from(missionPilotContextSnapshots)
			.where(eq(missionPilotContextSnapshots.sessionId, sessionId))
			.orderBy(desc(missionPilotContextSnapshots.revision))
			.limit(1);
		if (!latest) {
			throw new MissionPilotContextConflictError(
				"Mission Pilot Context snapshot is missing",
			);
		}
		if (
			latest.revision !== session.contextRevision ||
			latest.digest !== session.contextDigest
		) {
			throw new MissionPilotContextConflictError(
				"Mission Pilot Session and latest Context snapshot diverged",
			);
		}
		const current = latest.contextJson as Record<string, unknown>;
		const plan =
			current.plan &&
			typeof current.plan === "object" &&
			!Array.isArray(current.plan)
				? (current.plan as Record<string, unknown>)
				: {};
		const listKey = reason === "artifact" ? "artifacts" : "reviews";
		const existing = Array.isArray(plan[listKey]) ? plan[listKey] : [];
		if (
			reason === "artifact" &&
			existing.some(
				(item) =>
					item &&
					typeof item === "object" &&
					!Array.isArray(item) &&
					(item as Record<string, unknown>).sourceMessageId ===
						entry.sourceMessageId,
			)
		)
			return session;
		const context = {
			...current,
			...(reason === "task" ? { task: entry } : {}),
			plan:
				reason === "task"
					? plan
					: reason === "questionnaire"
						? { ...plan, questionnaire: entry }
						: { ...plan, [listKey]: [...existing, entry] },
		};
		const serialized = JSON.stringify(context);
		const digest = crypto.createHash("sha256").update(serialized).digest("hex");
		const revision = session.contextRevision + 1;
		const now = new Date();
		await tx.insert(missionPilotContextSnapshots).values({
			id: crypto.randomUUID(),
			sessionId,
			revision,
			reason,
			contextJson: context,
			digest,
			tokenEstimate: Math.ceil(serialized.length / 4),
			createdAt: now,
		});
		const [updated] = await tx
			.update(missionPilotSessions)
			.set({
				contextRevision: revision,
				contextDigest: digest,
				version: session.version + 1,
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotSessions.id, session.id),
					eq(missionPilotSessions.version, session.version),
					eq(missionPilotSessions.contextRevision, session.contextRevision),
				),
			)
			.returning();
		if (!updated) {
			throw new MissionPilotContextConflictError(
				"Mission Pilot Context changed while appending a revision",
			);
		}
		if (options.correctionRunId) {
			const [appliedCorrection] = await tx
				.update(missionPilotArtifactCorrectionRuns)
				.set({
					status: "applied",
					outputContextRevision: revision,
					finishedAt: now,
					updatedAt: now,
				})
				.where(
					and(
						eq(missionPilotArtifactCorrectionRuns.id, options.correctionRunId),
						eq(missionPilotArtifactCorrectionRuns.status, "validating"),
					),
				)
				.returning({ id: missionPilotArtifactCorrectionRuns.id });
			if (!appliedCorrection) {
				throw new MissionPilotContextConflictError(
					"Mission Pilot correction changed while adopting Context",
				);
			}
		}
		return updated;
	});
}

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
