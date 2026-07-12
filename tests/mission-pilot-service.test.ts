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
	stopRun: vi.fn(),
	register: vi.fn(),
}));

const planIntakeMocks = vi.hoisted(() => ({
	start: vi.fn(),
}));

vi.mock("../api/modules/missionPilot/mission-pilot-workbench.port", () => ({
	stopTaskRun: workbenchMocks.stopRun,
	registerTaskRunUpdatedListener: workbenchMocks.register,
}));
vi.mock("../api/modules/missionPilot/mission-pilot-plan-intake.port", () => ({
	startOrResumeMissionPilotPlanIntake: planIntakeMocks.start,
}));

const service = await import(
	"../api/modules/missionPilot/mission-pilot.service"
);
const repositoryIds: string[] = [];

beforeAll(() => ensureNightWorkersSchema());
beforeEach(() => {
	workbenchMocks.stopRun.mockReset();
	planIntakeMocks.start.mockReset();
	planIntakeMocks.start.mockResolvedValue({
		questionnaireSessionId: crypto.randomUUID(),
		questionnaireStatus: "answering",
	});
});
afterEach(async () => {
	for (const id of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, id));
	}
});

async function createPilotFixture() {
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
			},
			tx,
		);
	});
	return { repositoryId, taskId, runId };
}

describe("Mission Pilot service", () => {
	it("activates authorization and dispatches one prompt through typed Plan intake", async () => {
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
			initialPromptState: "sent",
			activeRunId: null,
			phase: "initial_intake",
		});
		expect(planIntakeMocks.start).toHaveBeenCalledWith({
			taskId: fixture.taskId,
			initialPrompt: "Play時点の最新プロンプト",
		});
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
		expect(publishSpy).toHaveBeenCalledWith(
			fixture.taskId,
			expect.objectContaining({
				type: "task_message_created",
				payload: {
					message: expect.objectContaining({
						role: "user",
						content: "Play時点の最新プロンプト",
						messageType: "mission_pilot_initial_prompt",
					}),
				},
			}),
		);
		publishSpy.mockRestore();
	});

	it("keeps the initial user message exactly once after intake failure and retry", async () => {
		const fixture = await createPilotFixture();
		planIntakeMocks.start.mockRejectedValueOnce(
			new Error("provider unavailable"),
		);
		await expect(service.play(fixture.taskId, 0)).rejects.toMatchObject({
			code: "MISSION_PILOT_INTAKE_FAILED",
		});
		const failed = await getSessionByTaskId(fixture.taskId);
		expect(failed).toMatchObject({
			desiredState: "stopped",
			phase: "attention",
			initialPromptState: "sent",
		});
		await service.play(fixture.taskId, failed?.version ?? -1);
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
		).toHaveLength(1);
	});

	it("preserves typed Plan intake conflicts instead of replacing them with a 502", async () => {
		const fixture = await createPilotFixture();
		planIntakeMocks.start.mockRejectedValueOnce(
			new MissionPilotError(
				409,
				"MISSION_PILOT_PLAN_INTAKE_NEEDS_EDIT",
				"Questionnaire needs review",
			),
		);
		await expect(service.play(fixture.taskId, 0)).rejects.toMatchObject({
			statusCode: 409,
			code: "MISSION_PILOT_PLAN_INTAKE_NEEDS_EDIT",
		});
		expect(await getSessionByTaskId(fixture.taskId)).toMatchObject({
			phase: "attention",
			lastErrorCode: "MISSION_PILOT_PLAN_INTAKE_NEEDS_EDIT",
		});
	});

	it("treats Questionnaire intervention as a successful intake handoff", async () => {
		const fixture = await createPilotFixture();
		planIntakeMocks.start.mockImplementationOnce(async () => {
			const current = await getSessionByTaskId(fixture.taskId);
			if (!current) throw new Error("missing Mission Pilot session");
			await db
				.update(missionPilotSessions)
				.set({
					phase: "waiting_intervention",
					nextWakeAt: new Date(Date.now() + 20_000),
					version: current.version + 1,
					updatedAt: new Date(),
				})
				.where(eq(missionPilotSessions.id, current.id));
			return {
				questionnaireSessionId: crypto.randomUUID(),
				questionnaireStatus: "answering",
			};
		});

		const played = await service.play(fixture.taskId, 0);
		expect(played.missionPilot).toMatchObject({
			desiredState: "playing",
			phase: "waiting_intervention",
		});
		expect(played.run).toBeNull();
	});

	it("preserves an unstopped run and allows Stop to be retried", async () => {
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
		workbenchMocks.stopRun.mockRejectedValueOnce(new Error("stop unavailable"));
		const failedStop = await service.stop(fixture.taskId, associated.version);
		expect(failedStop.missionPilot).toMatchObject({
			desiredState: "stopped",
			activityState: "attention",
			activeRunId: fixture.runId,
		});
		workbenchMocks.stopRun.mockResolvedValueOnce({
			...run,
			status: "cancelled",
		});
		const retried = await service.stop(
			fixture.taskId,
			failedStop.missionPilot.version,
		);
		expect(workbenchMocks.stopRun).toHaveBeenCalledTimes(2);
		expect(retried.missionPilot).toMatchObject({
			desiredState: "stopped",
			activityState: "idle",
			activeRunId: null,
		});
	});
});
