import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import {
	repositories,
	taskGitWorkspaces,
	taskRuns,
	workspaceAttestations,
} from "../../db/schema";
import { buildChildProcessEnvironment } from "../execution/child-process-environment";

const execFileAsync = promisify(execFile);

export type RunWorkspaceAuthority =
	| {
			ok: true;
			kind: "task_workspace";
			runId: string;
			taskId: string;
			repositoryId: string;
			executionRoot: string;
			workspaceId: string | null;
			workspaceIdentity: string;
	  }
	| {
			ok: false;
			code:
				| "RUN_NOT_FOUND"
				| "RUN_WORKSPACE_BINDING_REQUIRED"
				| "RUN_WORKSPACE_BINDING_MISMATCH"
				| "RUN_WORKSPACE_ROOT_MISMATCH"
				| "RUN_WORKSPACE_HEAD_MISMATCH"
				| "RUN_WORKSPACE_CONFLICTED";
			message: string;
	  };

export async function resolveRunWorkspaceAuthority(
	runId: string,
): Promise<RunWorkspaceAuthority> {
	const [run] = await db.select().from(taskRuns).where(eq(taskRuns.id, runId));
	if (!run) {
		return {
			ok: false,
			code: "RUN_NOT_FOUND",
			message: "Runが存在しません。",
		};
	}
	const [repository] = run.repositoryId
		? await db
				.select()
				.from(repositories)
				.where(eq(repositories.id, run.repositoryId))
		: [];
	if (!run.workspaceId) {
		return {
			ok: false,
			code: "RUN_WORKSPACE_BINDING_REQUIRED",
			message: "Coding Agent RunにはTask workspace bindingが必要です。",
		};
	}
	const [workspace] = await db
		.select()
		.from(taskGitWorkspaces)
		.where(eq(taskGitWorkspaces.id, run.workspaceId));
	const [attestation] = run.admissionAttestationId
		? await db
				.select()
				.from(workspaceAttestations)
				.where(eq(workspaceAttestations.id, run.admissionAttestationId))
		: [];
	if (
		!workspace ||
		!repository ||
		!attestation ||
		workspace.taskId !== run.taskId ||
		workspace.repositoryId !== run.repositoryId ||
		run.workspaceAllocationVersion !== workspace.allocationVersion ||
		run.repositoryIdentityRevision !== repository.repositoryIdentityRevision ||
		workspace.repositoryIdentityDigest !==
			repository.repositoryIdentityDigest ||
		run.admissionAttestationDigest !== attestation.digest ||
		attestation.workspaceId !== workspace.id
	) {
		return {
			ok: false,
			code: "RUN_WORKSPACE_BINDING_MISMATCH",
			message:
				"Run、Project identity、Task workspace、admission attestationのbindingが一致しません。",
		};
	}
	const configuredRoot =
		workspace.taskWorktreePathCanonical ?? workspace.worktreePath;
	if (!configuredRoot) {
		return {
			ok: false,
			code: "RUN_WORKSPACE_BINDING_MISMATCH",
			message: "Task workspaceのcanonical rootがありません。",
		};
	}
	const executionRoot = await fs.realpath(configuredRoot).catch(() => null);
	if (!executionRoot || executionRoot !== attestation.canonicalPath) {
		return {
			ok: false,
			code: "RUN_WORKSPACE_ROOT_MISMATCH",
			message: "Task workspace rootがadmission attestationと一致しません。",
		};
	}
	const observedGit = await observeWorkspaceGitIdentity(executionRoot).catch(
		() => null,
	);
	if (
		!observedGit ||
		observedGit.topLevel !== executionRoot ||
		observedGit.commonDir !== attestation.gitCommonDirCanonical ||
		(workspace.sourceRef && observedGit.branchRef !== workspace.sourceRef)
	) {
		return {
			ok: false,
			code: "RUN_WORKSPACE_ROOT_MISMATCH",
			message:
				"Task workspaceのGit top-level、common dir、branchがRun bindingと一致しません。",
		};
	}
	if (
		workspace.expectedHeadSha &&
		observedGit.headSha !== workspace.expectedHeadSha
	) {
		return {
			ok: false,
			code: "RUN_WORKSPACE_HEAD_MISMATCH",
			message:
				"Task workspaceのHEADがRun bindingのexpected HEADと一致しません。",
		};
	}
	return {
		ok: true,
		kind: "task_workspace",
		runId: run.id,
		taskId: run.taskId,
		repositoryId: repository.id,
		executionRoot,
		workspaceId: workspace.id,
		workspaceIdentity: `${workspace.id}:${workspace.allocationVersion}:${attestation.digest}`,
	};
}

async function observeWorkspaceGitIdentity(root: string) {
	const options = {
		env: buildChildProcessEnvironment({ purpose: "git" }),
		timeout: 10_000,
		maxBuffer: 1024 * 1024,
	};
	const [topLevel, commonDir, branch, head] = await Promise.all([
		execFileAsync("git", ["-C", root, "rev-parse", "--show-toplevel"], options),
		execFileAsync(
			"git",
			["-C", root, "rev-parse", "--git-common-dir"],
			options,
		),
		execFileAsync(
			"git",
			["-C", root, "symbolic-ref", "--quiet", "HEAD"],
			options,
		),
		execFileAsync("git", ["-C", root, "rev-parse", "HEAD"], options),
	]);
	const canonicalize = async (value: string) => {
		const resolved = path.resolve(root, value.trim());
		return fs.realpath(resolved).catch(() => resolved);
	};
	return {
		topLevel: await canonicalize(topLevel.stdout),
		commonDir: await canonicalize(commonDir.stdout),
		branchRef: branch.stdout.trim(),
		headSha: head.stdout.trim(),
	};
}

export async function assertRequestedRunWorkspaceRoot(input: {
	runId: string;
	taskId?: string;
	requestedRoot: string;
}) {
	const authority = await resolveRunWorkspaceAuthority(input.runId);
	if (!authority.ok) return authority;
	const requestedRoot = await fs
		.realpath(input.requestedRoot)
		.catch(() => null);
	if (
		!requestedRoot ||
		requestedRoot !== authority.executionRoot ||
		(input.taskId && input.taskId !== authority.taskId)
	) {
		return {
			ok: false as const,
			code: "RUN_WORKSPACE_ROOT_MISMATCH" as const,
			message:
				"Toolのrepository rootまたはTaskがRun-scoped workspace authorityと一致しません。",
		};
	}
	return authority;
}

export async function assertRunWorkspaceSideEffectAuthority(input: {
	runId: string;
	taskId?: string;
	requestedRoot: string;
}) {
	const authority = await assertRequestedRunWorkspaceRoot(input);
	if (!authority.ok) return authority;
	const conflicts = await execFileAsync(
		"git",
		["-C", authority.executionRoot, "diff", "--name-only", "--diff-filter=U"],
		{
			env: buildChildProcessEnvironment({ purpose: "git" }),
			timeout: 10_000,
			maxBuffer: 1024 * 1024,
		},
	).catch(() => null);
	if (!conflicts || conflicts.stdout.trim()) {
		return {
			ok: false as const,
			code: "RUN_WORKSPACE_CONFLICTED" as const,
			message:
				"conflict中またはGit状態を再検証できないTask workspaceではside effectを開始できません。",
		};
	}
	return authority;
}
