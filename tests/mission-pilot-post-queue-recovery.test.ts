import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	missionPilotContextSnapshots,
	missionPilotPhaseRuns,
	missionPilotSessions,
} from "../api/db/mission-pilot-schema";
import { repositories, taskRuns, tasks } from "../api/db/schema";

const continuationMocks = vi.hoisted(() => ({
	execute: vi.fn(),
	markFailed: vi.fn(),
	resumeInterruptedImplementation: vi.fn(),
	startImplementationRework: vi.fn(),
}));

vi.mock(
	"../api/modules/missionPilot/mission-pilot-runtime-continuation.service",
	() => ({
		executeMissionPilotContinuation: continuationMocks.execute,
		markMissionPilotContinuationFailed: continuationMocks.markFailed,
		resumeInterruptedImplementation:
			continuationMocks.resumeInterruptedImplementation,
		startImplementationRework: continuationMocks.startImplementationRework,
	}),
);

import { recoverMissionPilotPostQueueSessions } from "../api/modules/missionPilot/mission-pilot-recovery.service";

const repositoryIds: string[] = [];

beforeAll(() => ensureNightWorkersSchema());

afterEach(async () => {
	vi.clearAllMocks();
	for (const id of repositoryIds.splice(0))
		await db.delete(repositories).where(eq(repositories.id, id));
});

describe("Mission Pilot post-Queue recovery", () => {
	it("starts a continuation run when Play resumes an interrupted implementation", async () => {
		const repositoryId = crypto.randomUUID();
		const taskId = crypto.randomUUID();
		const sessionId = crypto.randomUUID();
		const runId = crypto.randomUUID();
		const phaseRunId = crypto.randomUUID();
		repositoryIds.push(repositoryId);
		const now = new Date();
		await db.insert(repositories).values({
			id: repositoryId,
			name: "implementation-resume-recovery",
			localPath: "/tmp/implementation-resume-recovery",
			branch: "main",
		});
		await db.insert(tasks).values({
			id: taskId,
			repositoryId,
			title: "Resume implementation",
			objective: "continue existing implementation",
			status: "running",
		});
		await db.insert(taskRuns).values({
			id: runId,
			taskId,
			repositoryId,
			status: "cancelled",
			endedAt: now,
			finishedAt: now,
		});
		await db.insert(missionPilotSessions).values({
			id: sessionId,
			taskId,
			repositoryId,
			sourceKind: "task",
			sourceId: taskId,
			desiredState: "playing",
			phase: "implementing",
			initialPromptSnapshot: "continue existing implementation",
			initialPromptState: "sent",
			implementationCycle: 1,
			contextRevision: 7,
			contextDigest: "ctx-7",
			createdAt: now,
			updatedAt: now,
		});
		await db.insert(missionPilotPhaseRuns).values({
			id: phaseRunId,
			sessionId,
			taskId,
			phase: "implementation",
			cycle: 1,
			attempt: 1,
			runId,
			inputContextRevision: 7,
			inputContextDigest: "ctx-7",
			status: "running",
			evidenceJson: {},
			startedAt: now,
		});

		await expect(recoverMissionPilotPostQueueSessions()).resolves.toBe(1);
		expect(
			continuationMocks.resumeInterruptedImplementation,
		).toHaveBeenCalledWith({
			taskId,
			missionPilot: {
				sessionId,
				cycle: 1,
				contextRevision: 7,
				contextDigest: "ctx-7",
				interruptedRunId: runId,
			},
		});
		expect(
			await db.query.missionPilotPhaseRuns.findFirst({
				where: eq(missionPilotPhaseRuns.id, phaseRunId),
			}),
		).toMatchObject({
			status: "failed",
			verdict: "attention",
			evidenceJson: {
				interrupted: true,
				resumeReason: "mission_pilot_play",
			},
		});
	});

	it("restarts an interrupted implementation rework with its durable packet", async () => {
		const repositoryId = crypto.randomUUID();
		const taskId = crypto.randomUUID();
		const sessionId = crypto.randomUUID();
		repositoryIds.push(repositoryId);
		const now = new Date();
		await db.insert(repositories).values({
			id: repositoryId,
			name: "rework-recovery",
			localPath: "/tmp/rework-recovery",
			branch: "main",
		});
		await db.insert(tasks).values({
			id: taskId,
			repositoryId,
			title: "Recover rework",
			objective: "resume",
			status: "needs_review",
		});
		await db.insert(missionPilotSessions).values({
			id: sessionId,
			taskId,
			repositoryId,
			sourceKind: "task",
			sourceId: taskId,
			desiredState: "playing",
			phase: "implementation_rework",
			initialPromptSnapshot: "resume",
			initialPromptState: "sent",
			implementationCycle: 2,
			contextRevision: 8,
			contextDigest: "ctx-8",
			createdAt: now,
			updatedAt: now,
		});
		const reworkPacket = {
			reason: "commit_hook_mutation",
			mutationPaths: ["src/greeting.txt"],
		};
		await db.insert(missionPilotContextSnapshots).values({
			id: crypto.randomUUID(),
			sessionId,
			revision: 8,
			reason: "commit_hook_mutation",
			contextJson: { execution: { pendingRework: reworkPacket } },
			digest: "ctx-8",
			tokenEstimate: 16,
			createdAt: now,
		});

		await expect(recoverMissionPilotPostQueueSessions()).resolves.toBe(1);
		expect(continuationMocks.startImplementationRework).toHaveBeenCalledWith({
			taskId,
			missionPilot: {
				sessionId,
				cycle: 2,
				contextRevision: 8,
				contextDigest: "ctx-8",
				reworkPacket,
			},
		});
	});
});
