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
import { repositories, taskMessages, taskRuns, tasks } from "../api/db/schema";
import {
	createSession,
	getSessionByTaskId,
} from "../api/modules/missionPilot/mission-pilot.repository";
import { nightWorkersRealtimeBroker } from "../api/services/realtime/nightworkers-ws";

const workbenchMocks = vi.hoisted(() => ({
	resume: vi.fn(),
	stopRun: vi.fn(),
	register: vi.fn(),
}));

vi.mock("../api/modules/missionPilot/mission-pilot-workbench.port", () => ({
	resumeWorkbenchIntakeMessage: workbenchMocks.resume,
	stopTaskRun: workbenchMocks.stopRun,
	registerTaskRunUpdatedListener: workbenchMocks.register,
}));

const service = await import(
	"../api/modules/missionPilot/mission-pilot.service"
);
const repositoryIds: string[] = [];

beforeAll(() => ensureNightWorkersSchema());
beforeEach(() => {
	workbenchMocks.resume.mockReset();
	workbenchMocks.stopRun.mockReset();
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
		await tx.insert(taskRuns).values({
			id: runId,
			taskId,
			repositoryId,
			status: "running",
		});
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
	it("activates authorization, dispatches one prompt, and stops the active run", async () => {
		const publishSpy = vi.spyOn(nightWorkersRealtimeBroker, "publish");
		const fixture = await createPilotFixture();
		const task = await db.query.tasks.findFirst({
			where: eq(tasks.id, fixture.taskId),
		});
		const run = await db.query.taskRuns.findFirst({
			where: eq(taskRuns.id, fixture.runId),
		});
		workbenchMocks.resume.mockResolvedValue({ task, run, messages: [] });
		workbenchMocks.stopRun.mockResolvedValue({ ...run, status: "cancelled" });

		const played = await service.play(fixture.taskId, 0);
		expect(played.missionPilot).toMatchObject({
			desiredState: "playing",
			authorizationVersion: 2,
			initialPromptState: "sent",
			activeRunId: fixture.runId,
		});
		expect(workbenchMocks.resume).toHaveBeenCalledWith(
			fixture.taskId,
			"初期プロンプトを一度だけ送信する",
			{ waitForIntake: true },
		);
		expect(publishSpy).toHaveBeenCalledWith(
			fixture.taskId,
			expect.objectContaining({
				type: "task_message_created",
				payload: {
					message: expect.objectContaining({
						role: "user",
						content: "初期プロンプトを一度だけ送信する",
						messageType: "mission_pilot_initial_prompt",
					}),
				},
			}),
		);
		const stopped = await service.stop(
			fixture.taskId,
			played.missionPilot.version,
		);
		expect(workbenchMocks.stopRun).toHaveBeenCalledWith(fixture.runId);
		expect(stopped.missionPilot).toMatchObject({
			desiredState: "stopped",
			activityState: "idle",
			activeRunId: null,
		});
		publishSpy.mockRestore();
	});

	it("keeps the initial user message exactly once after intake failure and retry", async () => {
		const fixture = await createPilotFixture();
		workbenchMocks.resume.mockRejectedValueOnce(
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
		workbenchMocks.resume.mockResolvedValue({
			task: await db.query.tasks.findFirst({
				where: eq(tasks.id, fixture.taskId),
			}),
			run: null,
			messages: [],
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

	it("preserves an unstopped run and allows Stop to be retried", async () => {
		const fixture = await createPilotFixture();
		const task = await db.query.tasks.findFirst({
			where: eq(tasks.id, fixture.taskId),
		});
		const run = await db.query.taskRuns.findFirst({
			where: eq(taskRuns.id, fixture.runId),
		});
		workbenchMocks.resume.mockResolvedValue({ task, run, messages: [] });
		const played = await service.play(fixture.taskId, 0);
		workbenchMocks.stopRun.mockRejectedValueOnce(new Error("stop unavailable"));
		const failedStop = await service.stop(
			fixture.taskId,
			played.missionPilot.version,
		);
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
