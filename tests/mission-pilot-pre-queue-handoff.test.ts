import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	missionPilotContextSnapshots,
	missionPilotPhaseRuns,
	missionPilotSessions,
} from "../api/db/mission-pilot-schema";
import {
	implementationQueueEntries,
	repositories,
	taskMessages,
	taskRuns,
	tasks,
} from "../api/db/schema";
import { verificationDocuments } from "../api/db/verification-schema";
import { createSession } from "../api/modules/missionPilot/mission-pilot.repository";
import { createPlanReview } from "../api/modules/missionPilot/mission-pilot-plan.repository";
import { reconcileMissionPilotPreQueueSessions } from "../api/modules/missionPilot/mission-pilot-pre-queue-recovery.service";
import { admitMissionPilotQueueHandoff } from "../api/modules/missionPilot/mission-pilot-queue-handoff.service";
import { claimMissionPilotRepositoryBootstrapStart } from "../api/modules/missionPilot/mission-pilot-repository-bootstrap.service";
import { associateMissionPilotChildRun } from "../api/modules/missionPilot/mission-pilot-run-association.service";
import { claimNextImplementationQueueEntry } from "../api/modules/queue/queue.repository";
import { buildFeaturePlanImplementationPlanMetadata } from "../api/modules/specification/feature-plan-implementation-plan";
import { nightWorkersRealtimeBroker } from "../api/services/realtime/nightworkers-ws";

const repositoryIds: string[] = [];
const repositoryPaths: string[] = [];

beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const id of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, id));
	}
	for (const repositoryPath of repositoryPaths.splice(0)) {
		await rm(repositoryPath, { recursive: true, force: true });
	}
});

async function createHandoffFixture() {
	const repositoryId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	const sourceId = crypto.randomUUID();
	const leaseOwner = `test:${crypto.randomUUID()}`;
	const repositoryPath = await mkdtemp(
		path.join(os.tmpdir(), "nightworkers-handoff-"),
	);
	await writeFile(path.join(repositoryPath, "README.md"), "# fixture\n");
	execFileSync("git", ["init", "--initial-branch=main"], {
		cwd: repositoryPath,
	});
	execFileSync("git", ["add", "."], { cwd: repositoryPath });
	execFileSync(
		"git",
		[
			"-c",
			"user.email=test@example.com",
			"-c",
			"user.name=Test",
			"commit",
			"-m",
			"initial",
		],
		{ cwd: repositoryPath },
	);
	repositoryIds.push(repositoryId);
	repositoryPaths.push(repositoryPath);
	const { session, featurePlanMessage } = await db.transaction(async (tx) => {
		const implementationPlan = buildFeaturePlanImplementationPlanMetadata({
			version: 1,
			requiresDataMigration: false,
			steps: [
				{
					key: "queue-handoff",
					title: "review済みhandoffを実装する",
					description: "review済みFeature PlanをQueue開始へ引き渡す。",
					taskType: "implementation",
					dependsOnKeys: [],
				},
			],
		});
		await tx.insert(repositories).values({
			id: repositoryId,
			name: "Mission Pilot Queue handoff",
			localPath: repositoryPath,
			branch: "main",
		});
		const [task] = await tx
			.insert(tasks)
			.values({
				id: taskId,
				repositoryId,
				title: "Queue reviewed Mission Pilot plan",
				objective: "Create a reviewed plan and queue it",
				acceptanceCriteria: "Exactly one Queue entry is created",
				status: "ready",
			})
			.returning();
		const session = await createSession(
			{
				task,
				sourceKind: "mission_task_candidate",
				sourceId,
			},
			tx,
		);
		const [featurePlanMessage] = await tx
			.insert(taskMessages)
			.values({
				taskId,
				role: "assistant",
				content: "# Feature Plan\n\n## Verification\n- Run tests",
				messageType: "markdown_document",
				metadataJson: {
					intent: "feature_plan",
					title: "Feature Plan",
					implementationPlan,
				},
			})
			.returning();
		await tx
			.update(missionPilotSessions)
			.set({
				desiredState: "playing",
				phase: "queueing",
				authorizationVersion: 2,
				authorizationJson: {
					version: 2,
					sessionId: session.id,
					taskId,
					sourceRef: { source: "mission_task_candidate", id: sourceId },
					grantedByAction: "mission_pilot_play",
					grantedAt: new Date().toISOString(),
					scopes: {
						plan: true,
						queue: true,
						implementation: true,
						testMutation: true,
						review: true,
						localCommit: true,
						taskComplete: true,
						taskArchive: true,
						push: false,
					},
					pushPolicy: "never",
				},
				leaseOwner,
				leaseExpiresAt: new Date(Date.now() + 60_000),
				version: session.version + 1,
				updatedAt: new Date(),
			})
			.where(eq(missionPilotSessions.id, session.id));
		return { session, featurePlanMessage };
	});
	const current = await db.query.missionPilotSessions.findFirst({
		where: eq(missionPilotSessions.id, session.id),
	});
	if (!current) throw new Error("Mission Pilot Session missing");
	const review = await createPlanReview({
		sessionId: session.id,
		contextRevision: current.contextRevision,
		contextDigest: current.contextDigest,
		featurePlanMessageId: featurePlanMessage.id,
		attempt: 1,
		review: {
			verdict: "pass",
			summary: "Ready for implementation",
			coverage: {
				goal: "pass",
				scope: "pass",
				acceptanceCriteria: "pass",
				implementationSteps: "pass",
				verification: "pass",
				artifactConsistency: "pass",
				riskAndSafety: "pass",
			},
			findings: [],
			revisionTargets: [],
		},
	});
	const [verificationDocument] = await db
		.insert(verificationDocuments)
		.values({
			taskId,
			specMessageId: featurePlanMessage.id,
			sourceSpecPath: "task-message",
			documentJson: {},
			generatedAt: new Date(),
		})
		.returning();
	return {
		repositoryId,
		taskId,
		sessionId: session.id,
		leaseOwner,
		featurePlanMessageId: featurePlanMessage.id,
		verificationDocumentId: verificationDocument.id,
		planReviewId: review.id,
		contextRevision: current.contextRevision,
		contextDigest: current.contextDigest,
	};
}

describe("Mission Pilot pre-Queue handoff", () => {
	it("persists one immutable reviewed handoff and reuses it on retry", async () => {
		const publishSpy = vi.spyOn(nightWorkersRealtimeBroker, "publish");
		const fixture = await createHandoffFixture();
		const input = {
			taskId: fixture.taskId,
			sessionId: fixture.sessionId,
			planReviewId: fixture.planReviewId,
			featurePlanMessageId: fixture.featurePlanMessageId,
			verificationDocumentId: fixture.verificationDocumentId,
			leaseOwner: fixture.leaseOwner,
		};
		const [first, second] = await Promise.all([
			admitMissionPilotQueueHandoff(input),
			admitMissionPilotQueueHandoff(input),
		]);
		expect(second).toEqual(first);
		const [session, task, queueEntries, contextSnapshots, runs, messages] =
			await Promise.all([
				db.query.missionPilotSessions.findFirst({
					where: eq(missionPilotSessions.id, fixture.sessionId),
				}),
				db.query.tasks.findFirst({ where: eq(tasks.id, fixture.taskId) }),
				db
					.select()
					.from(implementationQueueEntries)
					.where(eq(implementationQueueEntries.taskId, fixture.taskId)),
				db
					.select()
					.from(missionPilotContextSnapshots)
					.where(eq(missionPilotContextSnapshots.sessionId, fixture.sessionId)),
				db.select().from(taskRuns).where(eq(taskRuns.taskId, fixture.taskId)),
				db
					.select()
					.from(taskMessages)
					.where(eq(taskMessages.taskId, fixture.taskId)),
			]);
		expect(session).toMatchObject({
			phase: "queued",
			contextRevision: fixture.contextRevision,
			contextDigest: fixture.contextDigest,
			queueHandoffJson: expect.objectContaining({
				queueEntryId: first.queueEntryId,
				admissionKey: first.admissionKey,
				implementationTodoProjectionVersion: 1,
				implementationPlanSourceMessageId: fixture.featurePlanMessageId,
				implementationPlanDigest: expect.stringMatching(
					/^sha256:[a-f0-9]{64}$/,
				),
			}),
		});
		expect(task?.status).toBe("queued");
		expect(queueEntries).toHaveLength(1);
		expect(queueEntries[0]).toMatchObject({
			status: "queued",
			claimReady: false,
			activeRunId: null,
			missionPilotAdmissionKey: first.admissionKey,
		});
		expect(contextSnapshots).toHaveLength(1);
		expect(runs).toHaveLength(0);
		expect(
			await claimNextImplementationQueueEntry({
				processorCount: 1,
				leaseOwnerId: "unrelated-drain",
				leaseTtlMs: 60_000,
			}),
		).toMatchObject({ kind: "not_claimed" });
		expect(
			messages.filter(
				(message) =>
					(message.metadataJson as { missionPilotAdmissionKey?: string } | null)
						?.missionPilotAdmissionKey === first.admissionKey,
			),
		).toHaveLength(1);
		await db
			.update(missionPilotSessions)
			.set({ phase: "queueing", updatedAt: new Date() })
			.where(eq(missionPilotSessions.id, fixture.sessionId));
		expect(await reconcileMissionPilotPreQueueSessions()).toBe(1);
		expect(
			await db.query.missionPilotSessions.findFirst({
				where: eq(missionPilotSessions.id, fixture.sessionId),
			}),
		).toMatchObject({
			phase: "queued",
			queueHandoffJson: expect.objectContaining({
				queueEntryId: first.queueEntryId,
			}),
		});
		expect(publishSpy).toHaveBeenCalledWith(
			fixture.taskId,
			expect.objectContaining({
				type: "mission_pilot.updated",
				payload: expect.objectContaining({
					missionPilot: expect.objectContaining({ phase: "queued" }),
				}),
			}),
		);
		publishSpy.mockRestore();
	});

	it("rolls back every Queue mutation when the Session CAS fails", async () => {
		const fixture = await createHandoffFixture();
		await expect(
			admitMissionPilotQueueHandoff({
				taskId: fixture.taskId,
				sessionId: fixture.sessionId,
				planReviewId: fixture.planReviewId,
				featurePlanMessageId: fixture.featurePlanMessageId,
				verificationDocumentId: fixture.verificationDocumentId,
				leaseOwner: "wrong-owner",
			}),
		).rejects.toMatchObject({
			code: "MISSION_PILOT_QUEUE_HANDOFF_STALE_CONTEXT",
		});
		const [task, queueEntries, session, messages] = await Promise.all([
			db.query.tasks.findFirst({ where: eq(tasks.id, fixture.taskId) }),
			db
				.select()
				.from(implementationQueueEntries)
				.where(eq(implementationQueueEntries.taskId, fixture.taskId)),
			db.query.missionPilotSessions.findFirst({
				where: eq(missionPilotSessions.id, fixture.sessionId),
			}),
			db
				.select()
				.from(taskMessages)
				.where(eq(taskMessages.taskId, fixture.taskId)),
		]);
		expect(task?.status).toBe("ready");
		expect(queueEntries).toHaveLength(0);
		expect(session).toMatchObject({
			phase: "queueing",
			queueHandoffJson: null,
		});
		expect(
			messages.filter(
				(message) =>
					(message.metadataJson as { source?: string } | null)?.source ===
					"implementation_queue",
			),
		).toHaveLength(0);
	});

	it("recovers a terminal child run that failed before Queue release", async () => {
		const fixture = await createHandoffFixture();
		await admitMissionPilotQueueHandoff({
			taskId: fixture.taskId,
			sessionId: fixture.sessionId,
			planReviewId: fixture.planReviewId,
			featurePlanMessageId: fixture.featurePlanMessageId,
			verificationDocumentId: fixture.verificationDocumentId,
			leaseOwner: fixture.leaseOwner,
		});
		const [failedRun] = await db
			.insert(taskRuns)
			.values({
				taskId: fixture.taskId,
				repositoryId: fixture.repositoryId,
				status: "failed",
				workerKind: "codex-agent",
				startedAt: new Date(),
				finishedAt: new Date(),
			})
			.returning();

		expect(await reconcileMissionPilotPreQueueSessions()).toBe(1);
		expect(
			await db.query.missionPilotSessions.findFirst({
				where: eq(missionPilotSessions.id, fixture.sessionId),
			}),
		).toMatchObject({
			desiredState: "playing",
			phase: "queued",
			lastErrorCode: null,
			lastErrorMessage: null,
		});
		expect(
			await db.query.taskRuns.findFirst({
				where: eq(taskRuns.id, failedRun.id),
			}),
		).toMatchObject({ status: "failed" });
	});

	it("moves a queued Session to bootstrap preparation before child run association", async () => {
		const fixture = await createHandoffFixture();
		await admitMissionPilotQueueHandoff({
			taskId: fixture.taskId,
			sessionId: fixture.sessionId,
			planReviewId: fixture.planReviewId,
			featurePlanMessageId: fixture.featurePlanMessageId,
			verificationDocumentId: fixture.verificationDocumentId,
			leaseOwner: fixture.leaseOwner,
		});
		const preparing = await claimMissionPilotRepositoryBootstrapStart({
			taskId: fixture.taskId,
			sessionId: fixture.sessionId,
			contextRevision: fixture.contextRevision,
			contextDigest: fixture.contextDigest,
			implementationCycle: 1,
		});
		expect(preparing).toMatchObject({
			phase: "repository_bootstrap_preparing",
			activeRunId: null,
			activePhaseRunId: null,
		});
		const [run] = await db
			.insert(taskRuns)
			.values({
				taskId: fixture.taskId,
				repositoryId: fixture.repositoryId,
				status: "running",
				workerKind: "codex-agent",
				startedAt: new Date(),
			})
			.returning();
		const phaseRun = await associateMissionPilotChildRun({
			taskId: fixture.taskId,
			runId: run.id,
			phase: "repository_bootstrap",
			missionPilot: {
				sessionId: fixture.sessionId,
				cycle: 1,
				contextRevision: fixture.contextRevision,
				contextDigest: fixture.contextDigest,
			},
		});
		expect(phaseRun).toMatchObject({
			phase: "repository_bootstrap",
			status: "running",
			runId: run.id,
		});
		expect(
			await db.query.missionPilotSessions.findFirst({
				where: eq(missionPilotSessions.id, fixture.sessionId),
			}),
		).toMatchObject({
			phase: "repository_bootstrapping",
			activeRunId: run.id,
		});
		expect(
			await db
				.select()
				.from(missionPilotPhaseRuns)
				.where(eq(missionPilotPhaseRuns.runId, run.id)),
		).toHaveLength(1);
	});
});
