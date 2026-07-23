import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import app from "../api/app";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	implementationQueueEntries,
	repositories,
	taskGitWorkspaces,
	taskRunMergeRecords,
	tasks,
} from "../api/db/schema";
import {
	ensureTaskGitWorkspace,
	provisionTaskGitWorkspace,
	releaseProvisionedTaskWorkspace,
} from "../api/modules/gitworktree/task-git-workspace.service";
import {
	createMergeRecordForCommittedRun,
	deferTaskRunMerge,
	executeTaskRunMerge,
	overrideTaskRunMergeTarget,
	previewTaskRunMerge,
	requestTaskRunRework,
} from "../api/modules/nightworkers/nightworkers.git-merge.service";
import { pushMergedTaskRunTarget } from "../api/modules/nightworkers/nightworkers.git-target-push.service";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const repositoryIds: string[] = [];
const headers = {
	Origin: "http://localhost:39174",
	"Content-Type": "application/json",
};

beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const id of repositoryIds.splice(0))
		await db.delete(repositories).where(eq(repositories.id, id));
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true });
});

async function git(cwd: string, args: string[]) {
	return (await execFileAsync("git", args, { cwd })).stdout.trim();
}

async function fixture() {
	const root = await mkdtemp(path.join(tmpdir(), "nw-plan-workspace-"));
	roots.push(root, `${root}-worktrees`);
	await git(root, ["init", "--initial-branch=main"]);
	await git(root, ["config", "user.name", "NightWorkers Test"]);
	await git(root, ["config", "user.email", "nightworkers@example.test"]);
	await writeFile(path.join(root, "feature.txt"), "base\n");
	await git(root, ["add", "."]);
	await git(root, ["commit", "-m", "base"]);
	const project = await nightworkersRepo.createRepository({
		name: `TEST: plan workspace ${crypto.randomUUID()}`,
		localPath: root,
		branch: "main",
	});
	repositoryIds.push(project.id);
	const task = await nightworkersRepo.createTask({
		repositoryId: project.id,
		title: "Dedicated workspace",
		status: "queued",
	});
	return { root, project, task };
}

async function reviewedFixture(
	strategy: "merge_commit" | "squash" | "fast_forward_only",
	ciGate: "none" | "external_ci_required" = "none",
) {
	const base = await fixture();
	await nightworkersRepo.updateRepository(base.project.id, {
		gitIntegrationPolicyJson: {
			version: 1,
			remoteName: null,
			defaultMergeStrategy: strategy,
			sourcePushPolicy: "optional",
			targetPushPolicy: "manual",
			ciGate,
		},
	});
	const allocation = await ensureTaskGitWorkspace({
		taskId: base.task.id,
		planReviewId: crypto.randomUUID(),
		admissionKey: `test:${base.task.id}`,
	});
	const ready = await provisionTaskGitWorkspace(base.task.id);
	if (!ready.worktreePath)
		throw new Error("Dedicated worktree was not provisioned");
	await writeFile(path.join(ready.worktreePath, "feature.txt"), "reviewed\n");
	await git(ready.worktreePath, ["add", "feature.txt"]);
	await git(ready.worktreePath, ["commit", "-m", "reviewed change"]);
	const sourceSha = await git(ready.worktreePath, ["rev-parse", "HEAD"]);
	const run = await nightworkersRepo.createTaskRun({
		taskId: base.task.id,
		repositoryId: base.project.id,
		status: "needs_review",
		worktreePath: ready.worktreePath,
	});
	await nightworkersRepo.createTaskRunCommitRecord({
		runId: run.id,
		repositoryId: base.project.id,
		status: "committed",
		commitSha: sourceSha,
		verificationStatus: "passed",
	});
	await createMergeRecordForCommittedRun(run.id);
	return { ...base, allocation, ready, sourceSha, run };
}

describe("Plan-time Git workspace and Review merge", () => {
	it("validates Project merge target and rejects stale settings writes", async () => {
		const { project } = await fixture();
		const body = {
			branch: "main",
			gitIntegrationPolicy: {
				version: 1,
				remoteName: null,
				defaultMergeStrategy: "merge_commit",
				sourcePushPolicy: "optional",
				targetPushPolicy: "manual",
				ciGate: "none",
			},
			expectedGitIntegrationVersion: 0,
		};
		const saved = await app.request(
			`http://localhost/api/repositories/${project.id}`,
			{
				method: "PATCH",
				headers,
				body: JSON.stringify(body),
			},
		);
		expect(saved.status).toBe(200);
		expect((await saved.json()).gitIntegrationVersion).toBe(1);
		const stale = await app.request(
			`http://localhost/api/repositories/${project.id}`,
			{
				method: "PATCH",
				headers,
				body: JSON.stringify(body),
			},
		);
		expect(stale.status).toBe(409);
	});

	it("keeps the Plan target snapshot when Project settings change", async () => {
		const { project, task, root } = await fixture();
		await git(root, ["branch", "release"]);
		const workspace = await ensureTaskGitWorkspace({
			taskId: task.id,
			planReviewId: crypto.randomUUID(),
			admissionKey: `snapshot:${task.id}`,
		});
		const response = await app.request(
			`http://localhost/api/repositories/${project.id}`,
			{
				method: "PATCH",
				headers,
				body: JSON.stringify({
					branch: "release",
					gitIntegrationPolicy: {
						version: 1,
						remoteName: null,
						defaultMergeStrategy: "squash",
						sourcePushPolicy: "optional",
						targetPushPolicy: "manual",
						ciGate: "none",
					},
					expectedGitIntegrationVersion: 0,
				}),
			},
		);
		expect(response.status).toBe(200);
		const persisted = await db.query.taskGitWorkspaces.findFirst({
			where: eq(taskGitWorkspaces.id, workspace.id),
		});
		expect(persisted?.targetBranch).toBe("main");
		expect(persisted?.integrationPolicySnapshotJson).toMatchObject({
			defaultMergeStrategy: "merge_commit",
		});
	});

	it("provisions two same-Project tasks into distinct roots under concurrency", async () => {
		const { project, task } = await fixture();
		const second = await nightworkersRepo.createTask({
			repositoryId: project.id,
			title: "Second workspace",
			status: "queued",
		});
		await Promise.all([
			ensureTaskGitWorkspace({
				taskId: task.id,
				planReviewId: crypto.randomUUID(),
				admissionKey: `parallel:${task.id}`,
			}),
			ensureTaskGitWorkspace({
				taskId: second.id,
				planReviewId: crypto.randomUUID(),
				admissionKey: `parallel:${second.id}`,
			}),
		]);
		const [firstReady, secondReady] = await Promise.all([
			provisionTaskGitWorkspace(task.id),
			provisionTaskGitWorkspace(second.id),
		]);
		expect(firstReady.worktreePath).toBeTruthy();
		expect(secondReady.worktreePath).toBeTruthy();
		expect(firstReady.worktreePath).not.toBe(secondReady.worktreePath);
		expect(firstReady.sourceBranch).not.toBe(secondReady.sourceBranch);
	}, 20_000);

	it("provisions a dedicated workspace and merges only the reviewed SHA", async () => {
		const { root, task, allocation, ready, sourceSha, run } =
			await reviewedFixture("merge_commit");
		expect(ready.status).toBe("ready");
		expect(ready.worktreePath).not.toBe(root);
		expect(ready.targetBranch).toBe("main");
		const record = await createMergeRecordForCommittedRun(run.id);
		expect(record.sourceCommitSha).toBe(sourceSha);
		const preview = await previewTaskRunMerge({
			runId: run.id,
			expectedVersion: 0,
		});
		expect(preview?.status).toBe("merge_ready");
		const merged = await executeTaskRunMerge({
			runId: run.id,
			expectedVersion: 1,
		});
		expect(merged.status).toBe("merged");
		expect(await git(root, ["rev-parse", "HEAD"])).toBe(merged.targetHeadAfter);
		await expect(
			executeTaskRunMerge({ runId: run.id, expectedVersion: 1 }),
		).rejects.toMatchObject({ code: "merge_preview_stale" });
		const [completedTask] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.id, task.id));
		expect(completedTask?.status).toBe("completed");
		const [workspace] = await db
			.select()
			.from(taskGitWorkspaces)
			.where(eq(taskGitWorkspaces.id, allocation.id));
		expect(workspace?.status).toBe("merged");
	});

	it("pushes the merged target branch for a manual Review Mode push", async () => {
		const { run, root } = await reviewedFixture("merge_commit");
		const remote = await mkdtemp(path.join(tmpdir(), "nw-target-remote-"));
		roots.push(remote);
		await git(remote, ["init", "--bare"]);
		await git(root, ["remote", "add", "origin", remote]);
		await git(root, ["push", "-u", "origin", "main"]);
		await previewTaskRunMerge({ runId: run.id, expectedVersion: 0 });
		const merged = await executeTaskRunMerge({
			runId: run.id,
			expectedVersion: 1,
		});
		expect(merged.targetPushStatus).toBe("not_started");

		const pushed = await pushMergedTaskRunTarget(run.id);

		expect(pushed?.targetPushStatus).toBe("pushed");
		expect(await git(remote, ["rev-parse", "refs/heads/main"])).toBe(
			merged.targetHeadAfter,
		);
	});

	it.each([
		"squash",
		"fast_forward_only",
	] as const)("executes the %s strategy with the reviewed SHA guard", async (strategy) => {
		const { run, root } = await reviewedFixture(strategy);
		const preview = await previewTaskRunMerge({
			runId: run.id,
			expectedVersion: 0,
		});
		expect(preview?.status).toBe("merge_ready");
		const merged = await executeTaskRunMerge({
			runId: run.id,
			expectedVersion: 1,
		});
		expect(merged.status).toBe("merged");
		expect(await git(root, ["status", "--porcelain"])).toBe("");
	});

	it("blocks merge when external CI evidence is required", async () => {
		const { run } = await reviewedFixture(
			"merge_commit",
			"external_ci_required",
		);
		const preview = await previewTaskRunMerge({
			runId: run.id,
			expectedVersion: 0,
		});
		expect(preview).toMatchObject({
			status: "merge_blocked",
			ciStatus: "pending",
		});
	});

	it("persists defer and rework as explicit decisions without changing the target snapshot", async () => {
		const { run, task, allocation } = await reviewedFixture("merge_commit");
		const deferred = await deferTaskRunMerge({
			runId: run.id,
			expectedVersion: 0,
		});
		expect(deferred).toMatchObject({ decision: "defer", status: "deferred" });
		const [pendingTask] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.id, task.id));
		expect(pendingTask?.status).toBe("integration_pending");
		const rework = await requestTaskRunRework({
			runId: run.id,
			expectedVersion: 1,
		});
		expect(rework).toMatchObject({
			decision: "rework",
			status: "rework_requested",
		});
		const [workspace] = await db
			.select()
			.from(taskGitWorkspaces)
			.where(eq(taskGitWorkspaces.id, allocation.id));
		expect(workspace).toMatchObject({ status: "active", targetBranch: "main" });
	});

	it("changes only the effective target and invalidates preview evidence", async () => {
		const { run, root } = await reviewedFixture("merge_commit");
		await git(root, ["branch", "release"]);
		const overridden = await overrideTaskRunMergeTarget({
			runId: run.id,
			targetBranch: "release",
			expectedVersion: 0,
		});
		expect(overridden).toMatchObject({
			planTargetBranch: "main",
			targetBranch: "release",
			status: "decision_required",
			previewEvidenceJson: null,
		});
	});

	it("does not mutate a dirty target worktree", async () => {
		const { run, root } = await reviewedFixture("merge_commit");
		const preview = await previewTaskRunMerge({
			runId: run.id,
			expectedVersion: 0,
		});
		expect(preview?.status).toBe("merge_ready");
		const before = await git(root, ["rev-parse", "HEAD"]);
		await writeFile(path.join(root, "dirty.txt"), "dirty\n");
		await expect(
			executeTaskRunMerge({ runId: run.id, expectedVersion: 1 }),
		).rejects.toMatchObject({ code: "merge_target_dirty" });
		expect(await git(root, ["rev-parse", "HEAD"])).toBe(before);
	});

	it("detects a conflict in preview without mutating the target", async () => {
		const { run, root } = await reviewedFixture("merge_commit");
		await writeFile(path.join(root, "feature.txt"), "target change\n");
		await git(root, ["add", "feature.txt"]);
		await git(root, ["commit", "-m", "target change"]);
		const targetBefore = await git(root, ["rev-parse", "HEAD"]);
		const preview = await previewTaskRunMerge({
			runId: run.id,
			expectedVersion: 0,
		});
		expect(preview?.status).toBe("merge_conflicted");
		expect(await git(root, ["rev-parse", "HEAD"])).toBe(targetBefore);
		expect(await git(root, ["status", "--porcelain"])).toBe("");
		const [record] = await db
			.select()
			.from(taskRunMergeRecords)
			.where(eq(taskRunMergeRecords.runId, run.id));
		expect(record).toMatchObject({
			status: "merge_conflicted",
			conflictPathsJson: ["feature.txt"],
		});
	});

	it("blocks target drift after preview without merging", async () => {
		const { run, root } = await reviewedFixture("merge_commit");
		const preview = await previewTaskRunMerge({
			runId: run.id,
			expectedVersion: 0,
		});
		expect(preview?.status).toBe("merge_ready");
		await writeFile(path.join(root, "target.txt"), "advanced\n");
		await git(root, ["add", "target.txt"]);
		await git(root, ["commit", "-m", "advance target"]);
		const advanced = await git(root, ["rev-parse", "HEAD"]);
		await expect(
			executeTaskRunMerge({ runId: run.id, expectedVersion: 1 }),
		).rejects.toMatchObject({ code: "merge_target_changed" });
		expect(await git(root, ["rev-parse", "HEAD"])).toBe(advanced);
	});

	it("blocks when the source branch moves after review", async () => {
		const { run, root, ready } = await reviewedFixture("merge_commit");
		const preview = await previewTaskRunMerge({
			runId: run.id,
			expectedVersion: 0,
		});
		expect(preview?.status).toBe("merge_ready");
		if (!ready.worktreePath)
			throw new Error("Dedicated worktree was not provisioned");
		await writeFile(path.join(ready.worktreePath, "later.txt"), "later\n");
		await git(ready.worktreePath, ["add", "later.txt"]);
		await git(ready.worktreePath, ["commit", "-m", "move source"]);
		const targetBefore = await git(root, ["rev-parse", "HEAD"]);
		await expect(
			executeTaskRunMerge({ runId: run.id, expectedVersion: 1 }),
		).rejects.toMatchObject({ code: "merge_source_changed" });
		expect(await git(root, ["rev-parse", "HEAD"])).toBe(targetBefore);
	});

	it("does not release a Queue entry with another Task workspace", async () => {
		const { project, task } = await fixture();
		await ensureTaskGitWorkspace({
			taskId: task.id,
			planReviewId: crypto.randomUUID(),
			admissionKey: `release-owner:${task.id}`,
		});
		const ready = await provisionTaskGitWorkspace(task.id);
		const otherTask = await nightworkersRepo.createTask({
			repositoryId: project.id,
			title: "Other queued task",
			status: "queued",
		});
		const [entry] = await db
			.insert(implementationQueueEntries)
			.values({
				taskId: otherTask.id,
				repositoryId: project.id,
				status: "queued",
				claimReady: false,
				workspaceRequired: true,
			})
			.returning();
		await expect(
			releaseProvisionedTaskWorkspace({
				entryId: entry.id,
				workspaceId: ready.id,
			}),
		).rejects.toMatchObject({ code: "workspace_queue_release_lost" });
	});

	it("requires an explicit merge decision when the reviewed source is already integrated", async () => {
		const { run, root, ready, task } =
			await reviewedFixture("fast_forward_only");
		await git(root, ["merge", "--ff-only", ready.sourceBranch]);
		const preview = await previewTaskRunMerge({
			runId: run.id,
			expectedVersion: 0,
		});
		expect(preview).toMatchObject({
			status: "merge_ready",
			previewEvidenceJson: { alreadyIntegrated: true },
		});
		const [beforeDecision] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.id, task.id));
		expect(beforeDecision?.status).not.toBe("completed");
		const merged = await executeTaskRunMerge({
			runId: run.id,
			expectedVersion: 1,
		});
		expect(merged).toMatchObject({
			status: "merged",
			mergeOrigin: "already_ancestor",
		});
		const [completed] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.id, task.id));
		expect(completed?.status).toBe("completed");
	});
});
