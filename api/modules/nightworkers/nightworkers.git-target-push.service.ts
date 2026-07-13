import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { repositories, taskGitWorkspaces } from "../../db/schema";
import { AppError, NotFoundError } from "../../lib/errors";
import { listRepositoryWorktrees } from "../gitworktree/gitworktree.service";
import { pushBlockedByPolicy } from "./git-closeout-support";
import * as mergeRepo from "./nightworkers.git-merge.repository";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]) {
	const { stdout } = await execFileAsync("git", args, {
		cwd,
		maxBuffer: 8 * 1024 * 1024,
	});
	return stdout.trim();
}

export async function pushMergedTaskRunTarget(runId: string) {
	const record = await mergeRepo.getTaskRunMergeRecord(runId);
	if (!record) throw new NotFoundError("Merge record not found");
	if (record.status !== "merged") {
		throw new AppError(
			409,
			"merge_target_not_ready",
			"Target branch can be pushed only after merge",
		);
	}
	if (record.targetPushStatus === "pushed") return record;

	const [workspace, repository] = await Promise.all([
		db
			.select()
			.from(taskGitWorkspaces)
			.where(eq(taskGitWorkspaces.id, record.workspaceId))
			.then((rows) => rows[0]),
		db
			.select()
			.from(repositories)
			.where(eq(repositories.id, record.repositoryId))
			.then((rows) => rows[0]),
	]);
	if (!workspace) throw new NotFoundError("Git workspace not found");
	if (!repository) throw new NotFoundError("Repository not found");
	if (pushBlockedByPolicy(repository.safetyPolicy)) {
		const blocked = await mergeRepo.compareAndSetTaskRunMergeRecord({
			id: record.id,
			expectedVersion: record.recordVersion,
			data: {
				targetPushStatus: "blocked",
				lastErrorCode: "target_push_policy_blocked",
				lastErrorMessage: "Repository safety policy blocks git push.",
			},
		});
		return blocked ?? record;
	}
	const policy = workspace.integrationPolicySnapshotJson as {
		remoteName?: string | null;
	};
	const worktrees = await listRepositoryWorktrees(record.repositoryId);
	const targetWorktree = worktrees.worktrees.find(
		(item) => item.branch === record.targetBranch,
	);
	if (!targetWorktree || targetWorktree.bare || targetWorktree.prunable) {
		throw new AppError(
			409,
			"merge_target_worktree_unavailable",
			"Target branch worktree is unavailable",
		);
	}
	const targetRoot = targetWorktree.canonicalPath;
	const targetHead = await git(targetRoot, ["rev-parse", "HEAD"]);
	if (!record.targetHeadAfter || targetHead !== record.targetHeadAfter) {
		throw new AppError(
			409,
			"merge_target_changed",
			"Target branch advanced after merge",
		);
	}
	if (!policy.remoteName) {
		const upstream = await git(targetRoot, [
			"rev-parse",
			"--abbrev-ref",
			"--symbolic-full-name",
			"@{upstream}",
		]).catch(() => null);
		if (!upstream) {
			const blocked = await mergeRepo.compareAndSetTaskRunMergeRecord({
				id: record.id,
				expectedVersion: record.recordVersion,
				data: {
					targetPushStatus: "blocked",
					lastErrorCode: "target_upstream_missing",
					lastErrorMessage: "Target branch does not have an upstream.",
				},
			});
			return blocked ?? record;
		}
	}

	const pushing = await mergeRepo.compareAndSetTaskRunMergeRecord({
		id: record.id,
		expectedVersion: record.recordVersion,
		data: {
			targetPushStatus: "pushing",
			lastErrorCode: null,
			lastErrorMessage: null,
		},
	});
	if (!pushing) {
		throw new AppError(409, "merge_record_changed", "Merge record changed");
	}
	try {
		await git(
			targetRoot,
			policy.remoteName
				? ["push", policy.remoteName, record.targetBranch]
				: ["push"],
		);
		return await mergeRepo.compareAndSetTaskRunMergeRecord({
			id: record.id,
			expectedVersion: pushing.recordVersion,
			data: { targetPushStatus: "pushed", targetPushedAt: new Date() },
		});
	} catch (error) {
		return await mergeRepo.compareAndSetTaskRunMergeRecord({
			id: record.id,
			expectedVersion: pushing.recordVersion,
			data: {
				targetPushStatus: "failed",
				lastErrorCode: "target_push_failed",
				lastErrorMessage:
					error instanceof Error ? error.message : "Target push failed",
			},
		});
	}
}
