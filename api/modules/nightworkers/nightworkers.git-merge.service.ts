import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import {
	repositories,
	taskGitWorkspaces,
	taskRunCommitRecords,
	taskRunMergeRecords,
	taskRuns,
	tasks,
} from "../../db/schema";
import { AppError, NotFoundError } from "../../lib/errors";
import { listRepositoryWorktrees } from "../gitworktree/gitworktree.service";
import { withRepositoryGitMutationLock } from "../gitworktree/repository-git-mutation-lock";
import * as mergeRepo from "./nightworkers.git-merge.repository";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]) {
	const { stdout } = await execFileAsync("git", args, {
		cwd,
		maxBuffer: 8 * 1024 * 1024,
	});
	return stdout.trim();
}

export async function createMergeRecordForCommittedRun(runId: string) {
	const existing = await mergeRepo.getTaskRunMergeRecord(runId);
	if (existing) return existing;
	const [run] = await db.select().from(taskRuns).where(eq(taskRuns.id, runId));
	if (!run) throw new NotFoundError("Run not found");
	const { getTaskRunCommitRecord } = await import("./nightworkers.repository");
	const commit = await getTaskRunCommitRecord(runId);
	if (!commit?.commitSha)
		throw new AppError(
			409,
			"merge_source_missing",
			"Committed source SHA is missing",
		);
	const [workspace] = await db
		.select()
		.from(taskGitWorkspaces)
		.where(eq(taskGitWorkspaces.taskId, run.taskId));
	if (!workspace?.targetBaseSha)
		throw new AppError(
			409,
			"workspace_provenance_missing",
			"Task Git workspace provenance is missing",
		);
	const policy = workspace.integrationPolicySnapshotJson as {
		defaultMergeStrategy?: string;
		ciGate?: string;
		targetPushPolicy?: string;
	};
	const record = await mergeRepo.createTaskRunMergeRecord({
		runId: run.id,
		taskId: run.taskId,
		repositoryId: workspace.repositoryId,
		workspaceId: workspace.id,
		sourceBranch: workspace.sourceBranch,
		sourceCommitSha: commit.commitSha,
		planTargetBranch: workspace.targetBranch,
		planTargetBaseSha: workspace.targetBaseSha,
		targetBranch: workspace.targetBranch,
		targetSelectedSha: workspace.targetBaseSha,
		strategy: policy.defaultMergeStrategy ?? "merge_commit",
		ciStatus:
			policy.ciGate === "external_ci_required" ? "pending" : "not_required",
		targetPushStatus:
			policy.targetPushPolicy === "after_merge" ||
			policy.targetPushPolicy === "manual"
				? "not_started"
				: "not_required",
	});
	await db
		.update(taskGitWorkspaces)
		.set({
			status: "integration_pending",
			expectedHeadSha: commit.commitSha,
			lastVerifiedHead: commit.commitSha,
			updatedAt: new Date(),
		})
		.where(eq(taskGitWorkspaces.id, workspace.id));
	return record;
}

export async function previewTaskRunMerge(input: {
	runId: string;
	expectedVersion: number;
}) {
	const record = await mergeRepo.getTaskRunMergeRecord(input.runId);
	if (!record) throw new NotFoundError("Merge record not found");
	if (record.recordVersion !== input.expectedVersion)
		throw new AppError(
			409,
			"merge_record_changed",
			"Merge record changed; refresh and retry",
		);
	const [repository] = await db
		.select()
		.from(repositories)
		.where(eq(repositories.id, record.repositoryId));
	if (!repository) throw new NotFoundError("Repository not found");
	const [sourceHead, targetHead] = await Promise.all([
		git(repository.localPath, [
			"rev-parse",
			"--verify",
			`${record.sourceBranch}^{commit}`,
		]),
		git(repository.localPath, [
			"rev-parse",
			"--verify",
			`${record.targetBranch}^{commit}`,
		]),
	]);
	if (sourceHead !== record.sourceCommitSha)
		throw new AppError(
			409,
			"merge_source_changed",
			"Source branch moved after review commit",
		);
	if (record.sourceBranch === record.targetBranch)
		throw new AppError(
			409,
			"merge_source_equals_target",
			"Source and target branch must differ",
		);
	if (record.ciStatus === "pending") {
		const updated = await mergeRepo.compareAndSetTaskRunMergeRecord({
			id: record.id,
			expectedVersion: input.expectedVersion,
			data: {
				status: "merge_blocked",
				observedTargetSha: targetHead,
				lastErrorCode: "external_ci_required",
			},
		});
		return updated;
	}
	const [workspace, commitRecord] = await Promise.all([
		db
			.select()
			.from(taskGitWorkspaces)
			.where(eq(taskGitWorkspaces.id, record.workspaceId))
			.then((rows) => rows[0]),
		db
			.select()
			.from(taskRunCommitRecords)
			.where(eq(taskRunCommitRecords.runId, record.runId))
			.then((rows) => rows[0]),
	]);
	const policy = workspace?.integrationPolicySnapshotJson as
		| { sourcePushPolicy?: string }
		| undefined;
	if (
		policy?.sourcePushPolicy === "required_before_merge" &&
		commitRecord?.pushStatus !== "pushed"
	)
		return mergeRepo.compareAndSetTaskRunMergeRecord({
			id: record.id,
			expectedVersion: input.expectedVersion,
			data: {
				status: "merge_blocked",
				observedTargetSha: targetHead,
				lastErrorCode: "source_push_required",
			},
		});
	const ancestor = await execFileAsync(
		"git",
		["merge-base", "--is-ancestor", record.sourceCommitSha, targetHead],
		{ cwd: repository.localPath },
	)
		.then(() => true)
		.catch(() => false);
	const mergeBase = await git(repository.localPath, [
		"merge-base",
		record.sourceCommitSha,
		targetHead,
	]).catch(() => null);
	if (!mergeBase)
		return mergeRepo.compareAndSetTaskRunMergeRecord({
			id: record.id,
			expectedVersion: input.expectedVersion,
			data: {
				status: "merge_blocked",
				observedTargetSha: targetHead,
				lastErrorCode: "unrelated_history",
			},
		});
	const previewMerge = await execFileAsync(
		"git",
		["merge-tree", "--write-tree", targetHead, record.sourceCommitSha],
		{ cwd: repository.localPath, maxBuffer: 8 * 1024 * 1024 },
	)
		.then(() => ({ conflict: false, output: "" }))
		.catch((error: { stdout?: string; stderr?: string }) => ({
			conflict: true,
			output: `${error.stdout ?? ""}\n${error.stderr ?? ""}`,
		}));
	if (previewMerge.conflict) {
		const conflictPaths = Array.from(
			previewMerge.output.matchAll(/CONFLICT .* in (.+)$/gm),
			(match) => match[1]?.trim(),
		).filter((value): value is string => Boolean(value));
		return mergeRepo.compareAndSetTaskRunMergeRecord({
			id: record.id,
			expectedVersion: input.expectedVersion,
			data: {
				status: "merge_conflicted",
				observedTargetSha: targetHead,
				conflictPathsJson: conflictPaths,
				lastErrorCode: "merge_conflicted",
			},
		});
	}
	if (record.strategy === "fast_forward_only" && !ancestor) {
		const canFastForward = await execFileAsync(
			"git",
			["merge-base", "--is-ancestor", targetHead, record.sourceCommitSha],
			{ cwd: repository.localPath },
		)
			.then(() => true)
			.catch(() => false);
		if (!canFastForward)
			return mergeRepo.compareAndSetTaskRunMergeRecord({
				id: record.id,
				expectedVersion: input.expectedVersion,
				data: {
					status: "merge_blocked",
					observedTargetSha: targetHead,
					lastErrorCode: "fast_forward_required",
				},
			});
	}
	return mergeRepo.compareAndSetTaskRunMergeRecord({
		id: record.id,
		expectedVersion: input.expectedVersion,
		data: {
			status: "merge_ready",
			observedTargetSha: targetHead,
			previewEvidenceJson: {
				sourceHead,
				targetHead,
				alreadyIntegrated: ancestor,
			},
		},
	});
}

export async function deferTaskRunMerge(input: {
	runId: string;
	expectedVersion: number;
}) {
	const record = await mergeRepo.getTaskRunMergeRecord(input.runId);
	if (!record) throw new NotFoundError("Merge record not found");
	const updated = await mergeRepo.compareAndSetTaskRunMergeRecord({
		id: record.id,
		expectedVersion: input.expectedVersion,
		data: { decision: "defer", status: "deferred", decidedAt: new Date() },
	});
	if (!updated)
		throw new AppError(
			409,
			"merge_record_changed",
			"Merge record changed; refresh and retry",
		);
	await db
		.update(tasks)
		.set({ status: "integration_pending", updatedAt: new Date() })
		.where(eq(tasks.id, record.taskId));
	return updated;
}

export async function requestTaskRunRework(input: {
	runId: string;
	expectedVersion: number;
}) {
	const record = await mergeRepo.getTaskRunMergeRecord(input.runId);
	if (!record) throw new NotFoundError("Merge record not found");
	const updated = await mergeRepo.compareAndSetTaskRunMergeRecord({
		id: record.id,
		expectedVersion: input.expectedVersion,
		data: {
			decision: "rework",
			status: "rework_requested",
			decidedAt: new Date(),
		},
	});
	if (!updated)
		throw new AppError(
			409,
			"merge_record_changed",
			"Merge record changed; refresh and retry",
		);
	await db
		.update(taskGitWorkspaces)
		.set({ status: "active", updatedAt: new Date() })
		.where(eq(taskGitWorkspaces.id, record.workspaceId));
	await db
		.update(tasks)
		.set({ status: "needs_review", updatedAt: new Date() })
		.where(eq(tasks.id, record.taskId));
	return updated;
}

export async function overrideTaskRunMergeTarget(input: {
	runId: string;
	targetBranch: string;
	expectedVersion: number;
}) {
	const record = await mergeRepo.getTaskRunMergeRecord(input.runId);
	if (!record) throw new NotFoundError("Merge record not found");
	const [repository, workspace] = await Promise.all([
		db
			.select()
			.from(repositories)
			.where(eq(repositories.id, record.repositoryId))
			.then((rows) => rows[0]),
		db
			.select()
			.from(taskGitWorkspaces)
			.where(eq(taskGitWorkspaces.id, record.workspaceId))
			.then((rows) => rows[0]),
	]);
	if (!repository || !workspace)
		throw new NotFoundError("Git integration context not found");
	try {
		await git(repository.localPath, [
			"check-ref-format",
			"--branch",
			input.targetBranch,
		]);
	} catch {
		throw new AppError(
			400,
			"merge_target_invalid",
			"Target branch name is invalid",
		);
	}
	const targetSelectedSha = await git(repository.localPath, [
		"rev-parse",
		"--verify",
		`${input.targetBranch}^{commit}`,
	]).catch(() => null);
	if (!targetSelectedSha)
		throw new AppError(
			400,
			"merge_target_invalid",
			"Local target branch does not exist",
		);
	const policy = workspace.integrationPolicySnapshotJson as { ciGate?: string };
	const updated = await mergeRepo.compareAndSetTaskRunMergeRecord({
		id: record.id,
		expectedVersion: input.expectedVersion,
		data: {
			targetBranch: input.targetBranch,
			targetSelectedSha,
			observedTargetSha: null,
			status: "decision_required",
			decision: "undecided",
			previewEvidenceJson: null,
			ciEvidenceJson: null,
			ciStatus:
				policy.ciGate === "external_ci_required" ? "pending" : "not_required",
		},
	});
	if (!updated)
		throw new AppError(
			409,
			"merge_record_changed",
			"Merge record changed; refresh and retry",
		);
	return updated;
}

async function executeTaskRunMergeUnlocked(input: {
	runId: string;
	expectedVersion: number;
}) {
	const record = await mergeRepo.getTaskRunMergeRecord(input.runId);
	if (!record) throw new NotFoundError("Merge record not found");
	if (
		record.recordVersion !== input.expectedVersion ||
		record.status !== "merge_ready"
	)
		throw new AppError(
			409,
			"merge_preview_stale",
			"A current merge preview is required",
		);
	const [repository] = await db
		.select()
		.from(repositories)
		.where(eq(repositories.id, record.repositoryId));
	if (!repository) throw new NotFoundError("Repository not found");
	const sourceHead = await git(repository.localPath, [
		"rev-parse",
		"--verify",
		`${record.sourceBranch}^{commit}`,
	]);
	if (sourceHead !== record.sourceCommitSha)
		throw new AppError(
			409,
			"merge_source_changed",
			"Source branch moved after review commit",
		);
	const worktrees = await listRepositoryWorktrees(record.repositoryId);
	const targetWorktree = worktrees.worktrees.find(
		(item) => item.branch === record.targetBranch,
	);
	if (!targetWorktree || targetWorktree.bare || targetWorktree.prunable)
		throw new AppError(
			409,
			"merge_target_worktree_unavailable",
			"Target branch worktree is unavailable",
		);
	if (
		targetWorktree.usage.activeTaskCount +
			targetWorktree.usage.activeRunCount +
			targetWorktree.usage.pendingCloseoutCount >
		0
	)
		throw new AppError(409, "merge_target_in_use", "Target worktree is in use");
	const targetRoot = targetWorktree.canonicalPath;
	const targetHead = await git(targetRoot, ["rev-parse", "HEAD"]);
	if (targetHead !== record.observedTargetSha)
		throw new AppError(
			409,
			"merge_target_changed",
			"Target branch advanced after preview",
		);
	const targetStatus = await git(targetRoot, ["status", "--porcelain"]);
	if (targetStatus)
		throw new AppError(
			409,
			"merge_target_dirty",
			"Target worktree has uncommitted changes",
		);
	try {
		const alreadyIntegrated = await execFileAsync(
			"git",
			["merge-base", "--is-ancestor", record.sourceCommitSha, targetHead],
			{ cwd: targetRoot },
		)
			.then(() => true)
			.catch(() => false);
		const args =
			record.strategy === "squash"
				? ["merge", "--squash", record.sourceCommitSha]
				: record.strategy === "fast_forward_only"
					? ["merge", "--ff-only", record.sourceCommitSha]
					: ["merge", "--no-ff", "--no-edit", record.sourceCommitSha];
		await git(targetRoot, args);
		if (record.strategy === "squash")
			await git(targetRoot, [
				"commit",
				"-m",
				`Merge reviewed task ${record.taskId.slice(0, 8)}`,
			]);
		const after = await git(targetRoot, ["rev-parse", "HEAD"]);
		const updated = await mergeRepo.persistMergedLifecycle({
			record,
			expectedVersion: input.expectedVersion,
			mergeOrigin: alreadyIntegrated ? "already_ancestor" : "local",
			targetHeadAfter: after,
			mergeCommitSha: after,
		});
		const [workspace] = await db
			.select()
			.from(taskGitWorkspaces)
			.where(eq(taskGitWorkspaces.id, record.workspaceId));
		const policy = workspace?.integrationPolicySnapshotJson as
			| { targetPushPolicy?: string; remoteName?: string | null }
			| undefined;
		if (policy?.targetPushPolicy === "after_merge") {
			if (!policy.remoteName) {
				await db
					.update(taskRunMergeRecords)
					.set({
						targetPushStatus: "blocked",
						lastErrorCode: "target_push_policy_blocked",
						updatedAt: new Date(),
					})
					.where(eq(taskRunMergeRecords.id, record.id));
			} else {
				await db
					.update(taskRunMergeRecords)
					.set({ targetPushStatus: "pushing", updatedAt: new Date() })
					.where(eq(taskRunMergeRecords.id, record.id));
				await git(targetRoot, ["push", policy.remoteName, record.targetBranch])
					.then(async () => {
						await db
							.update(taskRunMergeRecords)
							.set({
								targetPushStatus: "pushed",
								targetPushedAt: new Date(),
								updatedAt: new Date(),
							})
							.where(eq(taskRunMergeRecords.id, record.id));
					})
					.catch(async (pushError) => {
						await db
							.update(taskRunMergeRecords)
							.set({
								targetPushStatus: "failed",
								lastErrorCode: "target_push_failed",
								lastErrorMessage:
									pushError instanceof Error
										? pushError.message
										: "Target push failed",
								updatedAt: new Date(),
							})
							.where(eq(taskRunMergeRecords.id, record.id));
					});
			}
		}
		return (await mergeRepo.getTaskRunMergeRecord(record.runId)) ?? updated;
	} catch (error) {
		const conflicts = await git(targetRoot, [
			"diff",
			"--name-only",
			"--diff-filter=U",
		]).catch(() => "");
		await execFileAsync("git", ["merge", "--abort"], {
			cwd: targetRoot,
		}).catch(() => undefined);
		await execFileAsync(
			"git",
			["reset", "--merge", record.observedTargetSha ?? "HEAD"],
			{
				cwd: targetRoot,
			},
		).catch(() => undefined);
		await mergeRepo.compareAndSetTaskRunMergeRecord({
			id: record.id,
			expectedVersion: input.expectedVersion,
			data: {
				status: "merge_conflicted",
				lastErrorCode: "merge_conflicted",
				lastErrorMessage:
					error instanceof Error ? error.message : "Merge failed",
				conflictPathsJson: conflicts.split("\n").filter(Boolean),
			},
		});
		throw error;
	}
}

export async function executeTaskRunMerge(input: {
	runId: string;
	expectedVersion: number;
}) {
	const record = await mergeRepo.getTaskRunMergeRecord(input.runId);
	if (!record) throw new NotFoundError("Merge record not found");
	return withRepositoryGitMutationLock(record.repositoryId, "merge", () =>
		executeTaskRunMergeUnlocked(input),
	);
}
