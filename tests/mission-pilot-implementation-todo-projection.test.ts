import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	missionPilotEvents,
	missionPilotPlanReviews,
	missionPilotSessions,
} from "../api/db/mission-pilot-schema";
import {
	implementationQueueEntries,
	repositories,
	taskMessages,
	taskRuns,
	tasks,
} from "../api/db/schema";
import { digestImplementationPlan } from "../api/modules/agentsShare";
import { createSession } from "../api/modules/missionPilot/mission-pilot.repository";
import {
	holdBlockedMissionPilotImplementationStart,
	resolveMissionPilotImplementationStart,
} from "../api/modules/missionPilot/mission-pilot-implementation-todo-projection.service";
import { associateMissionPilotChildRun } from "../api/modules/missionPilot/mission-pilot-run-association.service";
import { digestFeaturePlanContent } from "../api/modules/specification/feature-plan-content";

const repositoryIds: string[] = [];

beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const id of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, id));
	}
});

async function createFixture(input?: {
	admissionKey?: string | null;
	legacyHandoff?: boolean;
	missingProvenance?: boolean;
}) {
	const repositoryId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	const sourceId = crypto.randomUUID();
	repositoryIds.push(repositoryId);
	const featurePlanContent = "# Feature Plan\n\n## 実装計画\n1. Todo schema";
	const featurePlanContentDigest = digestFeaturePlanContent(featurePlanContent);
	const implementationPlan = {
		steps: [
			{
				title: "Todo schema",
				systemContext: "最小Todo schemaを実装する。",
			},
		],
	};
	const implementationPlanDigest = digestImplementationPlan(implementationPlan);
	const fixture = await db.transaction(async (tx) => {
		await tx.insert(repositories).values({
			id: repositoryId,
			name: `TEST: projection ${repositoryId}`,
			localPath: "/tmp",
			branch: "main",
		});
		const [task] = await tx
			.insert(tasks)
			.values({
				id: taskId,
				repositoryId,
				title: "Project Feature Plan Todos",
				description: "Project reviewed implementation steps into a run.",
				objective: "Preserve fixed gates and implementation steps.",
				status: "queued",
			})
			.returning();
		const session = await createSession(
			{ task, sourceKind: "task", sourceId },
			tx,
		);
		const [featurePlanMessage] = await tx
			.insert(taskMessages)
			.values({
				taskId,
				role: "assistant",
				content: featurePlanContent,
				messageType: "markdown_document",
				metadataJson: {
					intent: "feature_plan",
					title: "Feature Plan",
					featurePlanContent: {
						version: 1,
						digest: featurePlanContentDigest,
					},
					implementationPlan,
					implementationPlanProvenance: {
						version: 1,
						digest: implementationPlanDigest,
					},
				},
			})
			.returning();
		const planReviewId = crypto.randomUUID();
		await tx.insert(missionPilotPlanReviews).values({
			id: planReviewId,
			sessionId: session.id,
			contextRevision: session.contextRevision,
			contextDigest: session.contextDigest,
			routingRevision: 0,
			featurePlanMessageId: featurePlanMessage.id,
			attempt: 1,
			verdict: "pass",
			reviewJson: {
				verdict: "pass",
				summary: "Feature Plan is ready for implementation.",
				coverage: {
					goal: "pass",
					scope: "pass",
					acceptanceCriteria: "pass",
					implementationSteps: "pass",
					verification: "pass",
					artifactConsistency: "pass",
					riskAndSafety: "pass",
				},
				artifactScores: [],
				findings: [],
				revisionTargets: [],
				routingToolCall: null,
			},
			createdAt: new Date(),
		});
		const queueEntryId = crypto.randomUUID();
		const admissionKey =
			input?.admissionKey === undefined
				? `mission-pilot:${session.id}:projection`
				: input.admissionKey;
		const [entry] = await tx
			.insert(implementationQueueEntries)
			.values({
				id: queueEntryId,
				taskId,
				repositoryId,
				status: "claimed",
				processorSlot: 1,
				leaseOwnerId: "projection-test",
				leaseAcquiredAt: new Date(),
				leaseExpiresAt: new Date(Date.now() + 60_000),
				leaseVersion: 1,
				attemptCount: 1,
				missionPilotAdmissionKey: admissionKey,
				claimReady: true,
			})
			.returning();
		await tx
			.update(missionPilotSessions)
			.set({
				desiredState: "playing",
				phase: "implementation_starting",
				queueHandoffJson: admissionKey
					? {
							sessionId: session.id,
							taskId,
							admissionKey,
							queueEntryId,
							queueEntryStatus: "queued",
							queueClaimReady: false,
							reviewedContextRevision: session.contextRevision,
							reviewedContextDigest: session.contextDigest,
							routingRevision: 0,
							featurePlanMessageId: featurePlanMessage.id,
							featurePlanContentDigest,
							...(input?.missingProvenance
								? {}
								: input?.legacyHandoff
									? {
											implementationTodoProjectionVersion: 1,
											implementationPlanSourceMessageId: featurePlanMessage.id,
											implementationPlanDigest: `sha256:${"1".repeat(64)}`,
										}
									: {
											implementationTodoProjectionVersion: 1,
											implementationPlanSourceMessageId: featurePlanMessage.id,
											implementationPlanDigest,
										}),
							verificationDocumentId: crypto.randomUUID(),
							planReviewId,
							planReviewVerdict: "pass",
							queuedAt: new Date().toISOString(),
						}
					: null,
				updatedAt: new Date(),
			})
			.where(eq(missionPilotSessions.id, session.id));
		return {
			task,
			session,
			featurePlanMessage,
			entry,
			featurePlanContentDigest,
			implementationPlan,
			implementationPlanDigest,
			planReviewId,
		};
	});
	return fixture;
}

describe("Mission Pilot implementation handoff validation", () => {
	it("validates reviewed Feature Plan provenance without generating TODOs", async () => {
		const fixture = await createFixture();
		const resolution = await resolveMissionPilotImplementationStart(
			fixture.entry,
		);
		expect(resolution).toMatchObject({
			kind: "ready",
			featurePlanProvenance: {
				version: 1,
				sourceMessageId: fixture.featurePlanMessage.id,
				digest: fixture.featurePlanContentDigest,
			},
		});
		if (resolution.kind !== "ready") throw new Error("Expected ready");
		expect(resolution).not.toHaveProperty("initialTodos");
		expect(resolution.implementationPlan).toEqual(fixture.implementationPlan);
	});

	it("rejects a Queue handoff with a stale structured plan digest", async () => {
		const fixture = await createFixture({ legacyHandoff: true });

		expect(
			await resolveMissionPilotImplementationStart(fixture.entry),
		).toMatchObject({
			kind: "blocked",
			code: "MISSION_PILOT_FEATURE_PLAN_DIGEST_MISMATCH",
		});
	});

	it("rejects a Queue handoff without current or legacy provenance", async () => {
		const fixture = await createFixture({ missingProvenance: true });

		expect(
			await resolveMissionPilotImplementationStart(fixture.entry),
		).toMatchObject({
			kind: "blocked",
			code: "MISSION_PILOT_FEATURE_PLAN_HANDOFF_MISSING",
		});
	});

	it("uses admission key absence as the normal Queue boundary even when a Session exists", async () => {
		const fixture = await createFixture({ admissionKey: null });
		expect(await resolveMissionPilotImplementationStart(fixture.entry)).toEqual(
			{ kind: "not_mission_pilot" },
		);
	});

	it("rejects a child run association from a stale implementation cycle", async () => {
		const fixture = await createFixture();
		expect(
			await associateMissionPilotChildRun({
				taskId: fixture.task.id,
				runId: crypto.randomUUID(),
				phase: "implementation",
				missionPilot: {
					sessionId: fixture.session.id,
					cycle: fixture.session.implementationCycle + 1,
					contextRevision: fixture.session.contextRevision,
					contextDigest: fixture.session.contextDigest,
				},
			}),
		).toBeNull();
	});

	it("holds the claimed row and creates no TaskRun on a digest mismatch", async () => {
		const fixture = await createFixture();
		const [session] = await db
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, fixture.session.id));
		if (!session.queueHandoffJson) throw new Error("Missing Queue handoff");
		await db
			.update(missionPilotSessions)
			.set({
				queueHandoffJson: {
					...session.queueHandoffJson,
					featurePlanContentDigest: `sha256:${"0".repeat(64)}`,
				},
			})
			.where(eq(missionPilotSessions.id, fixture.session.id));
		const resolution = await resolveMissionPilotImplementationStart(
			fixture.entry,
		);
		expect(resolution).toMatchObject({
			kind: "blocked",
			code: "MISSION_PILOT_FEATURE_PLAN_DIGEST_MISMATCH",
		});
		if (resolution.kind !== "blocked") throw new Error("Expected blocked");
		await holdBlockedMissionPilotImplementationStart({
			entry: fixture.entry,
			code: resolution.code,
			message: resolution.message,
			sessionGuard: resolution.sessionGuard,
		});

		const [entry, heldSession, runs, events] = await Promise.all([
			db.query.implementationQueueEntries.findFirst({
				where: eq(implementationQueueEntries.id, fixture.entry.id),
			}),
			db.query.missionPilotSessions.findFirst({
				where: eq(missionPilotSessions.id, fixture.session.id),
			}),
			db.select().from(taskRuns).where(eq(taskRuns.taskId, fixture.task.id)),
			db
				.select()
				.from(missionPilotEvents)
				.where(eq(missionPilotEvents.sessionId, fixture.session.id)),
		]);
		expect(entry).toMatchObject({
			status: "queued",
			claimReady: false,
			processorSlot: null,
			leaseOwnerId: null,
			leaseExpiresAt: null,
			activeRunId: null,
			lastFailureKind: "mission_pilot_feature_plan_handoff_blocked",
		});
		expect(heldSession).toMatchObject({
			phase: "attention",
			resumePhase: "implementation_starting",
			lastErrorCode: "MISSION_PILOT_FEATURE_PLAN_DIGEST_MISMATCH",
		});
		expect(runs).toHaveLength(0);
		expect(events).toEqual([
			expect.objectContaining({
				eventType: "feature_plan_handoff_blocked",
				payloadJson: expect.objectContaining({
					featurePlanMessageId: fixture.featurePlanMessage.id,
					planReviewId: fixture.planReviewId,
					featurePlanContentDigest: `sha256:${"0".repeat(64)}`,
				}),
			}),
		]);
	});

	it("fails closed when the passing review no longer matches the handoff", async () => {
		const fixture = await createFixture();
		await db
			.update(missionPilotPlanReviews)
			.set({ verdict: "revise" })
			.where(eq(missionPilotPlanReviews.id, fixture.planReviewId));

		expect(
			await resolveMissionPilotImplementationStart(fixture.entry),
		).toMatchObject({
			kind: "blocked",
			code: "MISSION_PILOT_IMPLEMENTATION_HANDOFF_MISMATCH",
		});
	});

	it("does not overwrite a Session that changed after projection resolution", async () => {
		const fixture = await createFixture();
		const [session] = await db
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, fixture.session.id));
		if (!session.queueHandoffJson) throw new Error("Missing Queue handoff");
		await db
			.update(missionPilotSessions)
			.set({
				queueHandoffJson: {
					...session.queueHandoffJson,
					featurePlanContentDigest: `sha256:${"0".repeat(64)}`,
				},
			})
			.where(eq(missionPilotSessions.id, fixture.session.id));
		const resolution = await resolveMissionPilotImplementationStart(
			fixture.entry,
		);
		if (resolution.kind !== "blocked") throw new Error("Expected blocked");

		await db
			.update(missionPilotSessions)
			.set({ phase: "queued", version: session.version + 1 })
			.where(eq(missionPilotSessions.id, fixture.session.id));
		await holdBlockedMissionPilotImplementationStart({
			entry: fixture.entry,
			code: resolution.code,
			message: resolution.message,
			sessionGuard: resolution.sessionGuard,
		});

		const [updatedSession, events] = await Promise.all([
			db.query.missionPilotSessions.findFirst({
				where: eq(missionPilotSessions.id, fixture.session.id),
			}),
			db
				.select()
				.from(missionPilotEvents)
				.where(eq(missionPilotEvents.sessionId, fixture.session.id)),
		]);
		expect(updatedSession).toMatchObject({
			phase: "queued",
			version: session.version + 1,
			lastErrorCode: null,
		});
		expect(events).toHaveLength(0);
	});
});
