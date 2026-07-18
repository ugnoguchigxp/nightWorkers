import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { missionPilotAgentSessions } from "../api/db/mission-pilot-agent-schema";
import {
	missionPilotContextSnapshots,
	missionPilotSessions,
} from "../api/db/mission-pilot-schema";
import { repositories, taskMessages, taskRuns, tasks } from "../api/db/schema";
import { MissionPilotError } from "../api/modules/missionPilot/mission-pilot.errors";
import {
	createSession,
	getSessionByTaskId,
} from "../api/modules/missionPilot/mission-pilot.repository";
import { nightWorkersRealtimeBroker } from "../api/services/realtime/nightworkers-ws";

const workbenchMocks = vi.hoisted(() => ({
	startRun: vi.fn(),
	stopRun: vi.fn(),
	register: vi.fn(),
}));
const queueRecoveryMocks = vi.hoisted(() => ({
	release: vi.fn(),
}));

vi.mock("../api/modules/missionPilot/mission-pilot-workbench.port", () => ({
	startTaskRun: workbenchMocks.startRun,
	stopTaskRun: workbenchMocks.stopRun,
	registerTaskRunUpdatedListener: workbenchMocks.register,
}));
vi.mock(
	"../api/modules/missionPilot/mission-pilot-post-queue-coordinator.service",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("../api/modules/missionPilot/mission-pilot-post-queue-coordinator.service")
		>()),
		releaseMissionPilotQueueHandoff: queueRecoveryMocks.release,
	}),
);
const service = await import(
	"../api/modules/missionPilot/mission-pilot.service"
);
const repositoryIds: string[] = [];

beforeAll(() => ensureNightWorkersSchema());
beforeEach(() => {
	workbenchMocks.startRun.mockReset();
	workbenchMocks.startRun.mockImplementation(async (taskId: string) => {
		const task = await db.query.tasks.findFirst({
			where: eq(tasks.id, taskId),
		});
		if (!task) throw new Error("Task not found");
		const [run] = await db
			.insert(taskRuns)
			.values({
				id: crypto.randomUUID(),
				taskId,
				repositoryId: task.repositoryId,
				status: "running",
			})
			.returning();
		return run;
	});
	workbenchMocks.stopRun.mockReset();
	queueRecoveryMocks.release.mockReset();
	queueRecoveryMocks.release.mockResolvedValue("queue-entry");
});
afterEach(async () => {
	for (const id of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, id));
	}
});

async function createPilotFixture(options: { runtimeKind?: "agent" } = {}) {
	const repositoryId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	const runId = crypto.randomUUID();
	repositoryIds.push(repositoryId);
	await db.transaction(async (tx) => {
		await tx.insert(repositories).values({
			id: repositoryId,
			name: "Mission Pilot service test",
			localPath: "/tmp/mission-pilot-service",
			branch: "main",
		});
		const [task] = await tx
			.insert(tasks)
			.values({
				id: taskId,
				repositoryId,
				title: "Pilot service",
				objective: "初期プロンプトを一度だけ送信する",
				status: "draft",
			})
			.returning();
		await createSession(
			{
				task,
				sourceKind: "mission_task_candidate",
				sourceId: crypto.randomUUID(),
				...(options.runtimeKind ? { runtimeKind: options.runtimeKind } : {}),
			},
			tx,
		);
	});
	return { repositoryId, taskId, runId };
}

describe("Mission Pilot service", () => {
	it("activates authorization from Task Operator without starting Coding Agent", async () => {
		const publishSpy = vi.spyOn(nightWorkersRealtimeBroker, "publish");
		const fixture = await createPilotFixture();
		await db
			.update(tasks)
			.set({ objective: "Play時点の最新プロンプト" })
			.where(eq(tasks.id, fixture.taskId));

		const played = await service.play(fixture.taskId, 0);
		expect(played.missionPilot).toMatchObject({
			desiredState: "playing",
			authorizationVersion: 3,
			initialPromptState: "pending",
			activeRunId: null,
			phase: "starting",
		});
		expect(workbenchMocks.startRun).not.toHaveBeenCalled();
		const activated = await getSessionByTaskId(fixture.taskId);
		expect(activated?.authorizationJson).toMatchObject({
			version: 3,
			taskRef: { source: "task", id: fixture.taskId },
			activationContextRevision: 2,
			activationContextDigest: activated?.contextDigest,
		});
		expect(
			await db
				.select()
				.from(missionPilotContextSnapshots)
				.where(eq(missionPilotContextSnapshots.sessionId, activated?.id ?? "")),
		).toHaveLength(2);
		expect(played.run).toBeNull();
		expect(
			await db
				.select()
				.from(taskRuns)
				.where(eq(taskRuns.taskId, fixture.taskId)),
		).toHaveLength(0);
		expect(publishSpy).not.toHaveBeenCalledWith(
			fixture.taskId,
			expect.objectContaining({ type: "task_message_created" }),
		);
		publishSpy.mockRestore();
	});

	it("never creates a pseudo initial user message during Play", async () => {
		const fixture = await createPilotFixture();
		await service.play(fixture.taskId, 0);
		expect(
			await db
				.select()
				.from(taskMessages)
				.where(
					and(
						eq(taskMessages.taskId, fixture.taskId),
						eq(taskMessages.messageType, "mission_pilot_initial_prompt"),
					),
				),
		).toHaveLength(0);
	});

	it("resumes a held Queue handoff without regenerating Plan context", async () => {
		const fixture = await createPilotFixture();
		const current = await getSessionByTaskId(fixture.taskId);
		if (!current) throw new Error("missing Mission Pilot session");
		const featurePlanMessageId = crypto.randomUUID();
		await db
			.update(missionPilotSessions)
			.set({
				desiredState: "stopped",
				phase: "attention",
				queueHandoffJson: {
					sessionId: current.id,
					taskId: fixture.taskId,
					admissionKey: `mission-pilot:${current.id}:digest:review`,
					queueEntryId: crypto.randomUUID(),
					queueEntryStatus: "queued",
					queueClaimReady: false,
					reviewedContextRevision: current.contextRevision,
					reviewedContextDigest: current.contextDigest,
					featurePlanMessageId,
					implementationTodoProjectionVersion: 1,
					implementationPlanSourceMessageId: featurePlanMessageId,
					implementationPlanDigest: `sha256:${"1".repeat(64)}`,
					verificationDocumentId: crypto.randomUUID(),
					planReviewId: crypto.randomUUID(),
					planReviewVerdict: "pass",
					queuedAt: new Date().toISOString(),
				},
				version: current.version + 1,
				updatedAt: new Date(),
			})
			.where(eq(missionPilotSessions.id, current.id));
		const before = await getSessionByTaskId(fixture.taskId);
		const played = await service.play(fixture.taskId, before?.version ?? -1);
		expect(queueRecoveryMocks.release).not.toHaveBeenCalled();
		expect(workbenchMocks.startRun).not.toHaveBeenCalled();
		expect(played.missionPilot).toMatchObject({
			desiredState: "playing",
			phase: "starting",
		});
	});

	it("resumes the interrupted implementation phase without legacy recovery", async () => {
		const fixture = await createPilotFixture();
		const current = await getSessionByTaskId(fixture.taskId);
		if (!current) throw new Error("missing Mission Pilot session");
		await db
			.update(missionPilotSessions)
			.set({
				desiredState: "stopped",
				phase: "paused",
				resumePhase: "implementing",
				version: current.version + 1,
				updatedAt: new Date(),
			})
			.where(eq(missionPilotSessions.id, current.id));
		const before = await getSessionByTaskId(fixture.taskId);

		const played = await service.play(fixture.taskId, before?.version ?? -1);

		expect(workbenchMocks.startRun).not.toHaveBeenCalled();
		expect(played.missionPilot).toMatchObject({
			desiredState: "playing",
			phase: "starting",
		});
	});

	it("does not couple Play to Coding Agent start conflicts", async () => {
		const fixture = await createPilotFixture();
		workbenchMocks.startRun.mockRejectedValueOnce(
			new MissionPilotError(
				409,
				"MISSION_PILOT_RUN_START_CONFLICT",
				"Coding Agent run is already active",
			),
		);
		await expect(service.play(fixture.taskId, 0)).resolves.toMatchObject({
			run: null,
			missionPilot: { phase: "starting" },
		});
		expect(workbenchMocks.startRun).not.toHaveBeenCalled();
	});

	it("does not create or answer a Questionnaire during Mission Pilot Play", async () => {
		const fixture = await createPilotFixture();
		const played = await service.play(fixture.taskId, 0);
		expect(played.missionPilot).toMatchObject({
			desiredState: "playing",
			phase: "starting",
		});
		expect(
			(
				await db
					.select()
					.from(taskMessages)
					.where(eq(taskMessages.taskId, fixture.taskId))
			).some(
				(message) =>
					message.metadataJson?.intent === "design_questionnaire_ready",
			),
		).toBe(false);
	});

	it("stops Mission Pilot without stopping an accepted Coding Agent Run", async () => {
		const fixture = await createPilotFixture();
		const [run] = await db
			.insert(taskRuns)
			.values({
				id: fixture.runId,
				taskId: fixture.taskId,
				repositoryId: fixture.repositoryId,
				status: "running",
			})
			.returning();
		const played = await service.play(fixture.taskId, 0);
		const [associated] = await db
			.update(missionPilotSessions)
			.set({
				activeRunId: fixture.runId,
				phase: "running",
				version: played.missionPilot.version + 1,
				updatedAt: new Date(),
			})
			.where(eq(missionPilotSessions.taskId, fixture.taskId))
			.returning();
		if (!associated) throw new Error("failed to associate active run");
		const stopped = await service.stop(fixture.taskId, associated.version);
		expect(stopped.missionPilot).toMatchObject({
			desiredState: "stopped",
			activityState: "idle",
			activeRunId: null,
		});
		expect(workbenchMocks.stopRun).not.toHaveBeenCalled();
		expect(
			await db.query.taskRuns.findFirst({ where: eq(taskRuns.id, run.id) }),
		).toMatchObject({ status: "running" });
	});

	it("ignores historical requester provenance when stopping Mission Pilot", async () => {
		const fixture = await createPilotFixture({ runtimeKind: "agent" });
		const agentSession = await getSessionByTaskId(fixture.taskId);
		if (!agentSession) throw new Error("missing agent session");
		const [run] = await db
			.insert(taskRuns)
			.values({
				id: fixture.runId,
				taskId: fixture.taskId,
				repositoryId: fixture.repositoryId,
				status: "running",
				contextSnapshot: {
					missionPilotAgent: {
						kind: "agent",
						sessionId: agentSession.id,
						toolCallId: crypto.randomUUID(),
						idempotencyKey: crypto.randomUUID(),
						completionOwner: "mission_pilot",
						sourceRunId: null,
					},
				},
			})
			.returning();
		const [playing] = await db
			.update(missionPilotSessions)
			.set({
				desiredState: "playing",
				phase: "implementation",
				activeRunId: fixture.runId,
				version: 1,
				updatedAt: new Date(),
			})
			.where(eq(missionPilotSessions.taskId, fixture.taskId))
			.returning();
		if (!playing) throw new Error("failed to prepare agent session");

		const stopped = await service.stop(fixture.taskId, playing.version);
		expect(stopped.missionPilot).toMatchObject({
			desiredState: "stopped",
			activityState: "idle",
			activeRunId: null,
		});
		expect(workbenchMocks.stopRun).not.toHaveBeenCalled();
		expect(
			await db.query.taskRuns.findFirst({ where: eq(taskRuns.id, run.id) }),
		).toMatchObject({ status: "running" });
	});

	it("does not stop an active Run that is not owned by Mission Pilot", async () => {
		const fixture = await createPilotFixture({ runtimeKind: "agent" });
		const [manualRun] = await db
			.insert(taskRuns)
			.values({
				id: fixture.runId,
				taskId: fixture.taskId,
				repositoryId: fixture.repositoryId,
				status: "running",
			})
			.returning();
		const [playing] = await db
			.update(missionPilotSessions)
			.set({
				desiredState: "playing",
				phase: "implementation",
				version: 1,
				updatedAt: new Date(),
			})
			.where(eq(missionPilotSessions.taskId, fixture.taskId))
			.returning();
		if (!playing) throw new Error("failed to prepare agent session");

		const stopped = await service.stop(fixture.taskId, playing.version);

		expect(workbenchMocks.stopRun).not.toHaveBeenCalled();
		expect(stopped.missionPilot).toMatchObject({
			desiredState: "stopped",
			phase: "paused",
			activeRunId: null,
		});
		expect(
			await db.query.taskRuns.findFirst({
				where: eq(taskRuns.id, manualRun.id),
			}),
		).toMatchObject({ status: "running" });
	});

	it("requires a Stop retry before replay after a runtime stop timeout", async () => {
		const fixture = await createPilotFixture({ runtimeKind: "agent" });
		const [timedOut] = await db
			.update(missionPilotSessions)
			.set({
				desiredState: "stopped",
				phase: "attention",
				version: 1,
				lastErrorCode: "MISSION_PILOT_RUNTIME_STOP_TIMEOUT",
				lastErrorMessage: "runtime did not acknowledge stop",
				updatedAt: new Date(),
			})
			.where(eq(missionPilotSessions.taskId, fixture.taskId))
			.returning();
		if (!timedOut) throw new Error("failed to prepare timeout state");

		await expect(
			service.play(fixture.taskId, timedOut.version),
		).rejects.toMatchObject({
			code: "MISSION_PILOT_VERSION_CONFLICT",
		});
	});

	it("stops an agent session that is waiting in attention", async () => {
		const fixture = await createPilotFixture({ runtimeKind: "agent" });
		const [playing] = await db
			.update(missionPilotSessions)
			.set({
				desiredState: "playing",
				phase: "attention",
				version: 1,
				lastErrorCode: "PROVIDER_UNSUPPORTED",
				lastErrorMessage: "provider route unavailable",
				updatedAt: new Date(),
			})
			.where(eq(missionPilotSessions.taskId, fixture.taskId))
			.returning();
		if (!playing) throw new Error("failed to prepare agent session");
		await db
			.update(missionPilotAgentSessions)
			.set({
				runtimeState: "attention",
				lastFailureJson: {
					kind: "unknown",
					retryable: false,
					providerCode: null,
					httpStatus: null,
					message: "provider route unavailable",
					retryAfterMs: null,
					attempt: 1,
					actionId: "provider.next_turn",
					idempotencyKey: null,
				},
			})
			.where(eq(missionPilotAgentSessions.sessionId, playing.id));

		const stopped = await service.stop(fixture.taskId, playing.version);

		expect(stopped.missionPilot).toMatchObject({
			desiredState: "stopped",
			activityState: "idle",
			phase: "paused",
			activeRunId: null,
		});
		const [agent] = await db
			.select()
			.from(missionPilotAgentSessions)
			.where(eq(missionPilotAgentSessions.sessionId, playing.id));
		expect(agent).toMatchObject({
			runtimeState: "stopped",
			currentTurnId: null,
			leaseOwner: null,
			leaseExpiresAt: null,
		});
	});
});
