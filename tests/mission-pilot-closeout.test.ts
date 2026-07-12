import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	missionPilotCloseouts,
	missionPilotContextSnapshots,
	missionPilotPhaseRuns,
	missionPilotReviewDecisions,
	missionPilotSessions,
	missionPilotTestSnapshots,
	taskArchiveRecords,
} from "../api/db/mission-pilot-schema";
import { repositories, taskRuns, tasks } from "../api/db/schema";
import {
	executeMissionPilotCloseout,
	recoverMissionPilotCommittedCloseout,
} from "../api/modules/missionPilot/mission-pilot-closeout.service";

const repositoryIds: string[] = [];
const tempDirectories: string[] = [];
beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const id of repositoryIds.splice(0))
		await db.delete(repositories).where(eq(repositories.id, id));
	for (const directory of tempDirectories.splice(0))
		fs.rmSync(directory, { recursive: true, force: true });
});

describe("Mission Pilot aggregate Git closeout", () => {
	it("reconciles a commit that succeeded before its database response was lost", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "mission-closeout-recovery-"),
		);
		tempDirectories.push(repoRoot);
		git(repoRoot, "init");
		git(repoRoot, "config", "user.email", "mission-pilot@example.test");
		git(repoRoot, "config", "user.name", "Mission Pilot Test");
		fs.writeFileSync(path.join(repoRoot, "feature.txt"), "before\n");
		git(repoRoot, "add", "feature.txt");
		git(repoRoot, "commit", "-m", "initial");
		const baselineHead = git(repoRoot, "rev-parse", "HEAD");
		fs.writeFileSync(path.join(repoRoot, "feature.txt"), "after\n");
		git(repoRoot, "add", "feature.txt");
		git(repoRoot, "commit", "-m", "mission closeout");
		const currentHead = git(repoRoot, "rev-parse", "HEAD");

		await expect(
			recoverMissionPilotCommittedCloseout({
				repoRoot,
				currentHead,
				baselineHead,
				stageablePaths: ["feature.txt"],
			}),
		).resolves.toBe(true);
		await expect(
			recoverMissionPilotCommittedCloseout({
				repoRoot,
				currentHead,
				baselineHead,
				stageablePaths: ["other.txt"],
			}),
		).resolves.toBe(false);
	});

	it("commits the owned path, completes the Task, and true-archives exactly once", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "mission-closeout-"),
		);
		tempDirectories.push(repoRoot);
		git(repoRoot, "init");
		git(repoRoot, "config", "user.email", "mission-pilot@example.test");
		git(repoRoot, "config", "user.name", "Mission Pilot Test");
		fs.writeFileSync(path.join(repoRoot, "feature.txt"), "before\n");
		git(repoRoot, "add", "feature.txt");
		git(repoRoot, "commit", "-m", "initial");
		const baselineHead = git(repoRoot, "rev-parse", "HEAD");
		fs.writeFileSync(path.join(repoRoot, "feature.txt"), "after\n");
		fs.writeFileSync(path.join(repoRoot, "notes.txt"), "unrelated\n");

		const repositoryId = crypto.randomUUID();
		const taskId = crypto.randomUUID();
		const sessionId = crypto.randomUUID();
		const testRunId = crypto.randomUUID();
		const reviewRunId = crypto.randomUUID();
		const testPhaseRunId = crypto.randomUUID();
		const reviewPhaseRunId = crypto.randomUUID();
		const snapshotId = crypto.randomUUID();
		const decisionId = crypto.randomUUID();
		const closeoutId = crypto.randomUUID();
		repositoryIds.push(repositoryId);
		const now = new Date();
		await db.insert(repositories).values({
			id: repositoryId,
			name: "closeout",
			localPath: repoRoot,
			branch: "main",
		});
		await db.insert(tasks).values({
			id: taskId,
			repositoryId,
			title: "Closeout",
			objective: "finish",
			status: "needs_review",
		});
		await db.insert(taskRuns).values([
			{
				id: testRunId,
				taskId,
				repositoryId,
				status: "completed",
				workerKind: "test",
				timeoutSeconds: 60,
				startedAt: now,
				finishedAt: now,
			},
			{
				id: reviewRunId,
				taskId,
				repositoryId,
				status: "completed",
				workerKind: "review",
				timeoutSeconds: 60,
				startedAt: now,
				finishedAt: now,
			},
		]);
		await db.insert(missionPilotSessions).values({
			id: sessionId,
			taskId,
			repositoryId,
			sourceKind: "task",
			sourceId: taskId,
			desiredState: "playing",
			phase: "closeout_preparing",
			initialPromptSnapshot: "finish",
			initialPromptState: "sent",
			contextRevision: 4,
			contextDigest: "ctx-4",
			createdAt: now,
			updatedAt: now,
		});
		await db.insert(missionPilotContextSnapshots).values({
			id: crypto.randomUUID(),
			sessionId,
			revision: 4,
			reason: "review_completed",
			contextJson: { execution: { review: { verdict: "pass" } } },
			digest: "ctx-4",
			tokenEstimate: 16,
			createdAt: now,
		});
		await db.insert(missionPilotPhaseRuns).values([
			{
				id: testPhaseRunId,
				sessionId,
				taskId,
				phase: "test",
				cycle: 1,
				attempt: 1,
				runId: testRunId,
				inputContextRevision: 4,
				inputContextDigest: "ctx-4",
				status: "completed",
				verdict: "pass",
				evidenceJson: {},
				startedAt: now,
				finishedAt: now,
			},
			{
				id: reviewPhaseRunId,
				sessionId,
				taskId,
				phase: "review",
				cycle: 1,
				attempt: 1,
				runId: reviewRunId,
				inputContextRevision: 4,
				inputContextDigest: "ctx-4",
				status: "completed",
				verdict: "pass",
				evidenceJson: {},
				startedAt: now,
				finishedAt: now,
			},
		]);
		await db.insert(missionPilotTestSnapshots).values({
			id: snapshotId,
			sessionId,
			phaseRunId: testPhaseRunId,
			verificationDocumentId: crypto.randomUUID(),
			contextRevision: 4,
			contextDigest: "ctx-4",
			checklistDigest: "checklist",
			requiredTotal: 1,
			requiredComplete: 1,
			failedRequired: 0,
			unknownRequired: 0,
			evidenceRunIdsJson: [],
			completionCheckEventId: "event",
			testChangedPathsJson: [],
			verdict: "pass",
			snapshotJson: {},
			createdAt: now,
		});
		await db.insert(missionPilotReviewDecisions).values({
			id: decisionId,
			sessionId,
			reviewSessionId: crypto.randomUUID(),
			reviewPhaseRunId,
			contextRevision: 4,
			contextDigest: "ctx-4",
			testSnapshotId: snapshotId,
			targetManifestDigest: "target",
			verdict: "pass",
			blockingCount: 0,
			warningCount: 0,
			infoCount: 0,
			findingIdsJson: [],
			decisionJson: { verdict: "pass", summary: "ok", findings: [] },
			createdAt: now,
		});
		await db.insert(missionPilotCloseouts).values({
			id: closeoutId,
			sessionId,
			attempt: 1,
			repositoryId,
			baselineHead,
			reviewDecisionId: decisionId,
			reviewedContextDigest: "ctx-4",
			ownedPhaseRunIdsJson: [testPhaseRunId],
			stageableOwnedPathsJson: ["feature.txt"],
			excludedPathsJson: ["notes.txt"],
			status: "ready",
			pushPolicy: "never",
			pushStatus: "not_requested",
			createdAt: now,
			updatedAt: now,
		});
		await db
			.update(missionPilotSessions)
			.set({
				activeTestSnapshotId: snapshotId,
				activeReviewDecisionId: decisionId,
				activeCloseoutId: closeoutId,
			})
			.where(eq(missionPilotSessions.id, sessionId));

		const result = await executeMissionPilotCloseout(sessionId);
		expect(result.status).toBe("archived");
		expect(result.pushStatus).toBe("skipped");
		expect(git(repoRoot, "show", "--format=", "--name-only", "HEAD")).toBe(
			"feature.txt",
		);
		expect(fs.readFileSync(path.join(repoRoot, "notes.txt"), "utf8")).toBe(
			"unrelated\n",
		);
		const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
		expect(task?.status).toBe("archived");
		const records = await db
			.select()
			.from(taskArchiveRecords)
			.where(eq(taskArchiveRecords.taskId, taskId));
		expect(records).toHaveLength(1);
	});
});

function git(cwd: string, ...args: string[]) {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
