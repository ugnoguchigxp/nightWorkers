import fs from "node:fs/promises";
import path from "node:path";
import type {
	CreateWorktreeRequest,
	RemoveWorktreeRequest,
	WorktreeListResponse,
	WorktreeRemoveBlocker,
	WorktreeRemoveWarning,
	WorktreeSummary,
	WorktreeUsage,
} from "../../../shared/schemas/gitworktree.schema";
import { discardableWorktreeRemoveBlockers } from "../../../shared/schemas/gitworktree.schema";
import { AppError, NotFoundError } from "../../lib/errors";
import { gitDiffTool } from "../../services/worker-tools/git";
import * as gitworktreeRepo from "./gitworktree.repository";
import {
	GitCliError,
	type GitCommandRunner,
	probeGit,
	runGitCommand,
} from "./gitworktree-cli";
import {
	parseWorktreeListPorcelain,
	parseWorktreeStatusPorcelain,
} from "./gitworktree-parser";
import {
	branchSlug,
	canonicalize,
	canonicalizeProspectivePath,
	overlapsExisting,
	worktreeId,
} from "./gitworktree-paths";

type RepositoryIdentity = { topLevel: string; commonDir: string };
type WorktreeServiceOptions = { runner?: GitCommandRunner };
const discardableRemoveBlockers = new Set<WorktreeRemoveBlocker>(
	discardableWorktreeRemoveBlockers,
);

function appError(status: number, code: string, message: string) {
	return new AppError(status, code, message);
}

function gitOperationError(error: unknown, fallback: string) {
	if (!(error instanceof GitCliError))
		return appError(409, "git_command_failed", fallback);
	if (error.reason === "git_command_timed_out")
		return appError(504, error.reason, error.message);
	if (error.reason === "git_output_too_large")
		return appError(502, error.reason, error.message);
	if (error.reason === "git_not_found")
		return appError(503, error.reason, error.message);
	return appError(409, "git_command_failed", error.message || fallback);
}

function invalidInputOrGitError(error: unknown, code: string, message: string) {
	if (error instanceof GitCliError && error.reason !== "git_command_failed")
		return gitOperationError(error, message);
	return appError(400, code, message);
}

async function readRepositoryIdentity(
	localPath: string,
	runner: GitCommandRunner,
): Promise<RepositoryIdentity> {
	try {
		const [topLevel, commonDir] = await Promise.all([
			runner(["-C", localPath, "rev-parse", "--show-toplevel"]),
			runner([
				"-C",
				localPath,
				"rev-parse",
				"--path-format=absolute",
				"--git-common-dir",
			]),
		]);
		return {
			topLevel: await canonicalize(topLevel.stdout.trim()),
			commonDir: await canonicalize(commonDir.stdout.trim()),
		};
	} catch (error) {
		if (error instanceof GitCliError) throw error;
		throw appError(
			409,
			"repository_probe_failed",
			"Git repository probe failed",
		);
	}
}

function emptyUsage(): WorktreeUsage {
	return {
		taskIds: [],
		runIds: [],
		activeTaskCount: 0,
		activeRunCount: 0,
		pendingCloseoutCount: 0,
	};
}

async function collectWorktrees(input: {
	repositoryId: string;
	localPath: string;
	identity: RepositoryIdentity;
	runner: GitCommandRunner;
}) {
	const [listResult, usageMap] = await Promise.all([
		input
			.runner(["-C", input.localPath, "worktree", "list", "--porcelain", "-z"])
			.catch((error) => {
				throw gitOperationError(error, "Failed to list Git worktrees");
			}),
		gitworktreeRepo.readUsage(input.repositoryId),
	]);
	const records = parseWorktreeListPorcelain(listResult.stdout);
	return Promise.all(
		records.map(async (record): Promise<WorktreeSummary> => {
			const canonicalPath = await canonicalize(record.path);
			const usage = usageMap.get(path.resolve(canonicalPath)) ?? emptyUsage();
			let status = parseWorktreeStatusPorcelain("");
			let statusUnavailable = false;
			let headSubject: string | null = null;
			if (!record.bare && !record.prunable) {
				const [statusResult, subjectResult] = await Promise.all([
					input
						.runner([
							"-C",
							record.path,
							"status",
							"--porcelain=v2",
							"--branch",
							"-z",
						])
						.catch(() => null),
					input
						.runner(["-C", record.path, "log", "-1", "--format=%s"])
						.catch(() => null),
				]);
				if (statusResult)
					status = parseWorktreeStatusPorcelain(statusResult.stdout);
				else statusUnavailable = true;
				headSubject = subjectResult?.stdout.trim() || null;
			}
			const blockers: WorktreeRemoveBlocker[] = [];
			const warnings: WorktreeRemoveWarning[] = [];
			if (canonicalPath === input.identity.topLevel)
				blockers.push("base_worktree_protected");
			if (record.locked) blockers.push("worktree_locked");
			if (record.prunable) blockers.push("worktree_prunable");
			if (statusUnavailable) blockers.push("worktree_status_unavailable");
			if (status.conflictedCount > 0) blockers.push("worktree_conflicted");
			else if (
				status.stagedCount + status.modifiedCount + status.untrackedCount >
				0
			)
				blockers.push("worktree_dirty");
			if (
				usage.activeTaskCount +
					usage.activeRunCount +
					usage.pendingCloseoutCount >
				0
			)
				blockers.push("worktree_in_use");
			if (record.detached && record.head) {
				const refs = await input
					.runner([
						"-C",
						input.localPath,
						"for-each-ref",
						"--contains",
						record.head,
						"--format=%(refname)",
						"refs/heads",
						"refs/remotes",
						"refs/tags",
					])
					.catch(() => null);
				if (!refs?.stdout.trim()) blockers.push("detached_commits_unprotected");
			}
			if (!status.upstream && record.branch) warnings.push("upstream_missing");
			if (status.ahead > 0) warnings.push("upstream_ahead");
			return {
				id: worktreeId(input.identity.commonDir, canonicalPath),
				path: record.path,
				canonicalPath,
				isBase: canonicalPath === input.identity.topLevel,
				head: record.head,
				headSubject,
				branch: record.branch,
				detached: record.detached,
				bare: record.bare,
				locked: record.locked,
				lockReason: record.lockReason,
				prunable: record.prunable,
				pruneReason: record.pruneReason,
				...status,
				usage,
				canRemove: blockers.length === 0,
				removeBlockers: blockers,
				removeWarnings: warnings,
			};
		}),
	);
}

async function requireRepository(repositoryId: string) {
	const repository = await gitworktreeRepo.getRepository(repositoryId);
	if (!repository) throw new NotFoundError("Repository not found");
	return repository;
}

export async function listRepositoryWorktrees(
	repositoryId: string,
	options: WorktreeServiceOptions = {},
): Promise<WorktreeListResponse> {
	const repository = await requireRepository(repositoryId);
	const runner = options.runner ?? runGitCommand;
	const git = await probeGit(runner);
	if (!git.available) {
		return {
			git,
			repository: { available: false, commonDir: null, reason: null },
			worktrees: [],
			refreshedAt: new Date().toISOString(),
		};
	}
	let identity: RepositoryIdentity;
	try {
		identity = await readRepositoryIdentity(repository.localPath, runner);
	} catch (error) {
		return {
			git,
			repository: {
				available: false,
				commonDir: null,
				reason:
					error instanceof GitCliError && error.reason === "git_command_failed"
						? "not_git_repository"
						: "repository_probe_failed",
			},
			worktrees: [],
			refreshedAt: new Date().toISOString(),
		};
	}
	const worktrees = await collectWorktrees({
		repositoryId,
		localPath: repository.localPath,
		identity,
		runner,
	});
	return {
		git,
		repository: {
			available: true,
			commonDir: identity.commonDir,
			reason: null,
		},
		worktrees,
		refreshedAt: new Date().toISOString(),
	};
}

export function assertGitworktreeAvailable(data: WorktreeListResponse) {
	if (!data.git.available)
		throw appError(
			503,
			data.git.reason || "git_probe_failed",
			"Git is not available",
		);
	if (!data.repository.available)
		throw appError(
			409,
			data.repository.reason || "not_git_repository",
			"Registered project path is not a Git repository",
		);
}

export async function resolveWorktreePath(
	repositoryId: string,
	id: string,
	options: WorktreeServiceOptions = {},
) {
	const data = await listRepositoryWorktrees(repositoryId, options);
	assertGitworktreeAvailable(data);
	const worktree = data.worktrees.find((item) => item.id === id);
	if (!worktree)
		throw appError(404, "worktree_not_found", "Worktree not found");
	return worktree.canonicalPath;
}

export async function resolveTaskExecutionRoot(
	input: {
		repositoryId: string;
		repositoryPath: string;
		worktreePath?: string | null;
	},
	options: WorktreeServiceOptions = {},
) {
	if (!input.worktreePath) return canonicalize(input.repositoryPath);
	const expectedPath = await canonicalize(input.worktreePath);
	const data = await listRepositoryWorktrees(input.repositoryId, options);
	assertGitworktreeAvailable(data);
	const worktree = data.worktrees.find(
		(item) => item.canonicalPath === expectedPath,
	);
	if (!worktree) {
		throw appError(
			409,
			"worktree_unavailable",
			"The task worktree is no longer available",
		);
	}
	if (worktree.prunable || worktree.bare) {
		throw appError(
			409,
			"worktree_unavailable",
			"The task worktree cannot be used for execution",
		);
	}
	return worktree.canonicalPath;
}

export async function createRepositoryWorktree(
	repositoryId: string,
	request: CreateWorktreeRequest,
	options: WorktreeServiceOptions = {},
) {
	const repository = await requireRepository(repositoryId);
	const runner = options.runner ?? runGitCommand;
	const before = await listRepositoryWorktrees(repositoryId, { runner });
	assertGitworktreeAvailable(before);
	try {
		await runner(["check-ref-format", "--branch", request.branchName]);
	} catch (error) {
		throw invalidInputOrGitError(
			error,
			"branch_invalid",
			"Branch name is invalid",
		);
	}
	if (before.worktrees.some((item) => item.branch === request.branchName))
		throw appError(
			409,
			"branch_already_checked_out",
			"Branch is already checked out in another worktree",
		);
	let resolvedStartPoint: string | null = null;
	if (request.mode === "new_branch") {
		try {
			resolvedStartPoint = (
				await runner([
					"-C",
					repository.localPath,
					"rev-parse",
					"--verify",
					`${request.startPoint}^{commit}`,
				])
			).stdout.trim();
		} catch (error) {
			throw invalidInputOrGitError(
				error,
				"start_point_invalid",
				"Start point is invalid",
			);
		}
	} else {
		try {
			await runner([
				"-C",
				repository.localPath,
				"show-ref",
				"--verify",
				`refs/heads/${request.branchName}`,
			]);
		} catch (error) {
			throw invalidInputOrGitError(
				error,
				"branch_invalid",
				"Local branch does not exist",
			);
		}
	}
	const defaultRoot = path.join(
		path.dirname(repository.localPath),
		`${path.basename(repository.localPath)}-worktrees`,
	);
	const target = path.resolve(
		request.path || path.join(defaultRoot, branchSlug(request.branchName)),
	);
	if (request.path && !path.isAbsolute(request.path))
		throw appError(400, "path_conflict", "Worktree path must be absolute");
	const canonicalTargetBeforeCreate = await canonicalizeProspectivePath(target);
	if (
		before.worktrees.some((item) =>
			overlapsExisting(canonicalTargetBeforeCreate, item.canonicalPath),
		)
	)
		throw appError(
			409,
			"path_conflict",
			"Worktree path overlaps an existing worktree",
		);
	const targetEntries = await fs
		.readdir(target)
		.catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return [];
			if (error.code === "ENOTDIR" || error.code === "EACCES")
				throw appError(
					409,
					"path_conflict",
					"Worktree path is not an accessible directory",
				);
			throw error;
		});
	if (targetEntries.length > 0)
		throw appError(409, "path_not_empty", "Worktree path is not empty");
	const args = ["-C", repository.localPath, "worktree", "add"];
	if (request.mode === "new_branch")
		args.push("-b", request.branchName, "--", target, request.startPoint);
	else args.push("--", target, request.branchName);
	try {
		await runner(args, { timeoutMs: 60_000 });
	} catch (error) {
		throw gitOperationError(error, "Git worktree add failed");
	}
	const after = await listRepositoryWorktrees(repositoryId, { runner });
	const canonicalTarget = await canonicalize(target);
	const created = after.worktrees.find(
		(item) => item.canonicalPath === canonicalTarget,
	);
	if (!created)
		throw appError(
			409,
			"created_but_unverified",
			"Worktree command completed but the result could not be verified",
		);
	if (
		created.branch !== request.branchName ||
		(resolvedStartPoint && created.head !== resolvedStartPoint)
	)
		throw appError(
			409,
			"created_but_unverified",
			"Created worktree does not match the requested branch or start point",
		);
	return created;
}

export async function readRepositoryWorktreeDiff(
	repositoryId: string,
	id: string,
	options: WorktreeServiceOptions = {},
) {
	const target = await resolveWorktreePath(repositoryId, id, options);
	const result = await gitDiffTool({ repoRoot: target });
	if (!result.ok)
		throw appError(
			409,
			"git_command_failed",
			result.error?.message || "Git diff failed",
		);
	const maxLength = 200_000;
	return {
		diff: result.payload.diff.slice(0, maxLength),
		diffStat: result.payload.diffStat,
		hasChanges: result.payload.hasChanges,
		truncated: result.payload.diff.length > maxLength,
	};
}

export async function removeRepositoryWorktree(
	repositoryId: string,
	request: RemoveWorktreeRequest,
	options: WorktreeServiceOptions = {},
) {
	const repository = await requireRepository(repositoryId);
	const runner = options.runner ?? runGitCommand;
	const before = await listRepositoryWorktrees(repositoryId, { runner });
	assertGitworktreeAvailable(before);
	const target = before.worktrees.find(
		(item) => item.id === request.worktreeId,
	);
	if (!target) throw appError(404, "worktree_not_found", "Worktree not found");
	if (target.head !== request.expectedHead)
		throw appError(
			409,
			"worktree_changed",
			"Worktree HEAD changed; refresh and retry",
		);
	const remainingBlockers = target.removeBlockers.filter(
		(blocker) =>
			!(request.discardChanges && discardableRemoveBlockers.has(blocker)),
	);
	if (remainingBlockers.length > 0)
		throw new AppError(
			409,
			remainingBlockers[0] || "worktree_in_use",
			"Worktree cannot be removed",
			{
				blockers: remainingBlockers,
				warnings: target.removeWarnings,
			},
		);
	try {
		await runner(
			[
				"-C",
				repository.localPath,
				"worktree",
				"remove",
				...(request.discardChanges ? ["--force"] : []),
				"--",
				target.path,
			],
			{ timeoutMs: 60_000 },
		);
	} catch (error) {
		throw gitOperationError(error, "Git worktree remove failed");
	}
	const after = await listRepositoryWorktrees(repositoryId, { runner });
	if (after.worktrees.some((item) => item.id === request.worktreeId))
		throw appError(
			409,
			"git_command_failed",
			"Worktree still exists after remove",
		);
	return { removed: true as const, branch: target.branch, path: target.path };
}

function parsePruneEntries(output: string) {
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(0, 200);
}

export async function previewRepositoryWorktreePrune(
	repositoryId: string,
	options: WorktreeServiceOptions = {},
) {
	const repository = await requireRepository(repositoryId);
	const runner = options.runner ?? runGitCommand;
	const data = await listRepositoryWorktrees(repositoryId, { runner });
	assertGitworktreeAvailable(data);
	const result = await runner([
		"-C",
		repository.localPath,
		"worktree",
		"prune",
		"--dry-run",
		"--verbose",
	]).catch((error) => {
		throw gitOperationError(error, "Failed to preview Git worktree prune");
	});
	return {
		entries: parsePruneEntries(
			[result.stdout, result.stderr].filter(Boolean).join("\n"),
		),
		refreshedAt: new Date().toISOString(),
	};
}

export async function pruneRepositoryWorktrees(
	repositoryId: string,
	options: WorktreeServiceOptions = {},
) {
	const repository = await requireRepository(repositoryId);
	const runner = options.runner ?? runGitCommand;
	const preview = await previewRepositoryWorktreePrune(repositoryId, {
		runner,
	});
	if (preview.entries.length === 0)
		return { pruned: false as const, entries: [] };
	try {
		await runner([
			"-C",
			repository.localPath,
			"worktree",
			"prune",
			"--verbose",
		]);
	} catch (error) {
		throw gitOperationError(error, "Failed to prune Git worktrees");
	}
	return { pruned: true as const, entries: preview.entries };
}
