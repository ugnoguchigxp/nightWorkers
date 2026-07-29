import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client";
import { repositories, taskGitWorkspaces } from "../../db/schema";
import { buildChildProcessEnvironment } from "../execution/child-process-environment";

const execFileAsync = promisify(execFile);
const RECONCILABLE_STATUSES = ["ready", "active", "integration_pending"];

export async function reconcileTaskWorkspaceAuthorities() {
	const workspaces = await db
		.select({
			workspace: taskGitWorkspaces,
			repository: repositories,
		})
		.from(taskGitWorkspaces)
		.innerJoin(
			repositories,
			eq(taskGitWorkspaces.repositoryId, repositories.id),
		)
		.where(inArray(taskGitWorkspaces.status, RECONCILABLE_STATUSES));
	const results = [];
	for (const { workspace, repository } of workspaces) {
		const mismatchCode = await observeMismatch({ workspace, repository });
		if (mismatchCode) {
			await db
				.update(taskGitWorkspaces)
				.set({
					status: "attention",
					lastErrorCode: mismatchCode,
					lastErrorMessage:
						"起動時照合でTask workspace authorityの不一致を検出しました。",
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(taskGitWorkspaces.id, workspace.id),
						eq(taskGitWorkspaces.status, workspace.status),
					),
				);
		}
		results.push({
			workspaceId: workspace.id,
			previousStatus: workspace.status,
			status: mismatchCode ? "attention" : workspace.status,
			mismatchCode,
		});
	}
	return results;
}

async function observeMismatch(input: {
	workspace: typeof taskGitWorkspaces.$inferSelect;
	repository: typeof repositories.$inferSelect;
}) {
	const { workspace, repository } = input;
	if (
		repository.repositoryIdentityStatus !== "ready" ||
		workspace.repositoryIdentityRevision !==
			repository.repositoryIdentityRevision ||
		workspace.repositoryIdentityDigest !== repository.repositoryIdentityDigest
	) {
		return "workspace_repository_identity_mismatch";
	}
	const configuredRoot =
		workspace.taskWorktreePathCanonical ?? workspace.worktreePath;
	if (!configuredRoot) return "workspace_binding_required";
	const canonicalRoot = await fs.realpath(configuredRoot).catch(() => null);
	if (!canonicalRoot || canonicalRoot !== workspace.taskWorktreePathCanonical) {
		return "workspace_canonical_path_mismatch";
	}
	try {
		const options = {
			env: buildChildProcessEnvironment({ purpose: "git" }),
			timeout: 10_000,
			maxBuffer: 1024 * 1024,
		};
		const [topLevel, commonDir, branch, head, conflicts] = await Promise.all([
			execFileAsync(
				"git",
				["-C", canonicalRoot, "rev-parse", "--show-toplevel"],
				options,
			),
			execFileAsync(
				"git",
				["-C", canonicalRoot, "rev-parse", "--git-common-dir"],
				options,
			),
			execFileAsync(
				"git",
				["-C", canonicalRoot, "symbolic-ref", "--quiet", "HEAD"],
				options,
			),
			execFileAsync("git", ["-C", canonicalRoot, "rev-parse", "HEAD"], options),
			execFileAsync(
				"git",
				["-C", canonicalRoot, "diff", "--name-only", "--diff-filter=U"],
				options,
			),
		]);
		const observedTopLevel = await canonicalize(canonicalRoot, topLevel.stdout);
		const observedCommonDir = await canonicalize(
			canonicalRoot,
			commonDir.stdout,
		);
		if (observedTopLevel !== canonicalRoot)
			return "workspace_git_toplevel_mismatch";
		if (observedCommonDir !== repository.gitCommonDirCanonical)
			return "workspace_git_common_dir_mismatch";
		if (workspace.sourceRef && branch.stdout.trim() !== workspace.sourceRef)
			return "workspace_branch_mismatch";
		if (
			workspace.expectedHeadSha &&
			head.stdout.trim() !== workspace.expectedHeadSha
		) {
			return "workspace_head_mismatch";
		}
		if (conflicts.stdout.trim()) return "workspace_conflict_detected";
		return null;
	} catch {
		return "workspace_git_probe_failed";
	}
}

async function canonicalize(root: string, value: string) {
	const resolved = path.resolve(root, value.trim());
	return fs.realpath(resolved).catch(() => resolved);
}
