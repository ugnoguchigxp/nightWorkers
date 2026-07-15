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
import { createSession } from "../api/modules/missionPilot/mission-pilot.repository";
import {
	holdBlockedMissionPilotImplementationStart,
	resolveMissionPilotImplementationStart,
} from "../api/modules/missionPilot/mission-pilot-implementation-todo-projection.service";
import { associateMissionPilotChildRun } from "../api/modules/missionPilot/mission-pilot-run-association.service";
import { buildFeaturePlanImplementationPlanMetadata } from "../api/modules/specification/feature-plan-implementation-plan";
import { buildStandardImplementationTodoList } from "../api/services/todo-runtime";

const repositoryIds: string[] = [];

beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const id of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, id));
	}
});

async function createFixture(input?: { admissionKey?: string | null }) {
	const repositoryId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	const sourceId = crypto.randomUUID();
	repositoryIds.push(repositoryId);
	const implementationPlan = buildFeaturePlanImplementationPlanMetadata({
		version: 1,
		requiresDataMigration: true,
		steps: [
			{
				key: "db",
				title: "Todo schemaを実装する",
				description: "Todoを所有者単位で保存するschemaを追加する。",
				taskType: "implementation",
				dependsOnKeys: [],
			},
			{
				key: "api",
				title: "Todo APIを実装する",
				description: "認証済み所有者のCRUD APIを追加する。",
				taskType: "implementation",
				dependsOnKeys: ["db"],
			},
		],
	});
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
				content: "# Feature Plan\n\n## 実装計画\n1. Todo schema",
				messageType: "markdown_document",
				metadataJson: {
					intent: "feature_plan",
					title: "Feature Plan",
					implementationPlan,
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
							implementationTodoProjectionVersion: 1,
							implementationPlanSourceMessageId: featurePlanMessage.id,
							implementationPlanDigest: implementationPlan.digest,
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
			implementationPlan,
			planReviewId,
		};
	});
	return fixture;
}

describe("Mission Pilot implementation Todo projection", () => {
	it("resolves reviewed Feature Plan steps and migration provenance", async () => {
		const fixture = await createFixture();
		const resolution = await resolveMissionPilotImplementationStart(
			fixture.entry,
		);
		expect(resolution).toMatchObject({
			kind: "ready",
			requireDataMigrationGates: true,
			implementationPlanProvenance: {
				version: 1,
				sourceMessageId: fixture.featurePlanMessage.id,
				digest: fixture.implementationPlan.digest,
			},
			initialTodos: [
				{ seq: 1, title: "Todo schemaを実装する", dependsOn: [] },
				{ seq: 2, title: "Todo APIを実装する", dependsOn: [1] },
			],
		});
		if (resolution.kind !== "ready") throw new Error("Expected ready");
		expect(resolution.initialTodos).toHaveLength(2);
		expect(
			buildStandardImplementationTodoList({
				todos: resolution.initialTodos,
				requireDataMigrationGates: resolution.requireDataMigrationGates,
			}).map((todo) => todo.procedureId),
		).toEqual([
			"coding_preparation",
			null,
			null,
			"data_migration.apply_migration",
			"quality_gate_verify",
			"final_completion_report",
		]);
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
					implementationPlanDigest: `sha256:${"0".repeat(64)}`,
				},
			})
			.where(eq(missionPilotSessions.id, fixture.session.id));
		const resolution = await resolveMissionPilotImplementationStart(
			fixture.entry,
		);
		expect(resolution).toMatchObject({
			kind: "blocked",
			code: "MISSION_PILOT_IMPLEMENTATION_TODO_PROJECTION_DIGEST_MISMATCH",
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
			lastFailureKind: "mission_pilot_todo_projection_blocked",
		});
		expect(heldSession).toMatchObject({
			phase: "attention",
			resumePhase: "implementation_starting",
			lastErrorCode:
				"MISSION_PILOT_IMPLEMENTATION_TODO_PROJECTION_DIGEST_MISMATCH",
		});
		expect(runs).toHaveLength(0);
		expect(events).toEqual([
			expect.objectContaining({
				eventType: "todo_projection_blocked",
				payloadJson: expect.objectContaining({
					featurePlanMessageId: fixture.featurePlanMessage.id,
					planReviewId: fixture.planReviewId,
					implementationPlanDigest: `sha256:${"0".repeat(64)}`,
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
					implementationPlanDigest: `sha256:${"0".repeat(64)}`,
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
