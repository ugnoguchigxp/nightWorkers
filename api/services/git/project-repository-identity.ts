import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ProjectRepositoryIdentity } from "../../../shared/schemas/workspace-authority.schema";
import { buildChildProcessEnvironment } from "../execution/child-process-environment";

const execFileAsync = promisify(execFile);

export async function inspectProjectRepositoryIdentity(
	requestedRoot: string,
): Promise<ProjectRepositoryIdentity> {
	const verifiedAt = new Date().toISOString();
	const absoluteRequestedRoot = path.resolve(requestedRoot);
	const requestedRootStat = await fs
		.lstat(absoluteRequestedRoot)
		.catch(() => null);
	const registeredRootCanonical = await fs
		.realpath(absoluteRequestedRoot)
		.catch(() => absoluteRequestedRoot);
	const stat = await fs.stat(registeredRootCanonical).catch(() => null);
	if (!stat?.isDirectory()) {
		return pendingIdentity({
			registeredRootCanonical,
			verifiedAt,
			failureCode: "project_root_not_directory",
		});
	}

	const topLevel = await runGitProbe(registeredRootCanonical, [
		"rev-parse",
		"--show-toplevel",
	]);
	if (!topLevel.ok) {
		return pendingIdentity({
			registeredRootCanonical,
			verifiedAt,
			failureCode: "not_git_repository",
		});
	}
	const topLevelCanonical = await canonicalizeGitPath(
		registeredRootCanonical,
		topLevel.stdout,
	);
	if (
		requestedRootStat?.isSymbolicLink() ||
		topLevelCanonical !== registeredRootCanonical
	) {
		return invalidIdentity({
			registeredRootCanonical,
			verifiedAt,
			failureCode: requestedRootStat?.isSymbolicLink()
				? "project_root_symlink_alias"
				: "project_root_not_git_toplevel",
		});
	}

	const [commonDir, gitDir, head, branch, status] = await Promise.all([
		runRequiredGitProbe(registeredRootCanonical, [
			"rev-parse",
			"--git-common-dir",
		]),
		runRequiredGitProbe(registeredRootCanonical, ["rev-parse", "--git-dir"]),
		runRequiredGitProbe(registeredRootCanonical, ["rev-parse", "HEAD"]),
		runGitProbe(registeredRootCanonical, [
			"symbolic-ref",
			"--quiet",
			"--short",
			"HEAD",
		]),
		runRequiredGitProbe(registeredRootCanonical, [
			"status",
			"--porcelain=v1",
			"--untracked-files=normal",
		]),
	]);
	const gitCommonDirCanonical = await canonicalizeGitPath(
		registeredRootCanonical,
		commonDir,
	);
	const gitDirCanonical = await canonicalizeGitPath(
		registeredRootCanonical,
		gitDir,
	);
	if (gitDirCanonical !== gitCommonDirCanonical) {
		return invalidIdentity({
			registeredRootCanonical,
			verifiedAt,
			failureCode: "project_root_is_secondary_worktree",
		});
	}

	const baseWorktreeId = digestValue(
		`${gitCommonDirCanonical}\n${registeredRootCanonical}`,
	);
	const digest = digestValue(
		JSON.stringify({
			repositoryKind: "git",
			registeredRootCanonical,
			gitCommonDirCanonical,
			baseWorktreePathCanonical: registeredRootCanonical,
			baseWorktreeId,
		}),
	);
	return {
		repositoryKind: "git",
		status: "ready",
		registeredRootCanonical,
		gitCommonDirCanonical,
		baseWorktreePathCanonical: registeredRootCanonical,
		baseWorktreeId,
		digest,
		revision: 1,
		verifiedAt,
		observedBranch: branch.ok ? branch.stdout.trim() || null : null,
		observedHeadSha: head.trim(),
		baseWorktreeDirty: status.trim().length > 0,
		failureCode: null,
	};
}

function pendingIdentity(input: {
	registeredRootCanonical: string;
	verifiedAt: string;
	failureCode: string;
}): ProjectRepositoryIdentity {
	return {
		repositoryKind: "non_git",
		status: "materialization_pending",
		registeredRootCanonical: input.registeredRootCanonical,
		gitCommonDirCanonical: null,
		baseWorktreePathCanonical: null,
		baseWorktreeId: null,
		digest: null,
		revision: 1,
		verifiedAt: input.verifiedAt,
		observedBranch: null,
		observedHeadSha: null,
		baseWorktreeDirty: false,
		failureCode: input.failureCode,
	};
}

function invalidIdentity(input: {
	registeredRootCanonical: string;
	verifiedAt: string;
	failureCode: string;
}): ProjectRepositoryIdentity {
	return {
		...pendingIdentity(input),
		repositoryKind: "git",
		status: "invalid",
	};
}

async function runRequiredGitProbe(root: string, args: string[]) {
	const result = await runGitProbe(root, args);
	if (!result.ok)
		throw new Error(`Git repository identity probe failed: ${args.join(" ")}`);
	return result.stdout.trim();
}

async function runGitProbe(root: string, args: string[]) {
	try {
		const result = await execFileAsync("git", ["-C", root, ...args], {
			env: buildChildProcessEnvironment({ purpose: "workspace_bootstrap" }),
			timeout: 10_000,
			maxBuffer: 1024 * 1024,
		});
		return { ok: true as const, stdout: result.stdout };
	} catch {
		return { ok: false as const, stdout: "" };
	}
}

async function canonicalizeGitPath(root: string, value: string) {
	const resolved = path.resolve(root, value.trim());
	return fs.realpath(resolved).catch(() => resolved);
}

function digestValue(value: string) {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
