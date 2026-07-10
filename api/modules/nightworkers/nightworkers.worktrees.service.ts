import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import type {
	CreateWorktreeRequest,
	RemoveWorktreeRequest,
	WorktreeAdviceRequest,
	WorktreeAdviceResponse,
	WorktreeListResponse,
	WorktreeRemoveBlocker,
	WorktreeRemoveWarning,
	WorktreeSummary,
	WorktreeUsage,
} from "../../../shared/schemas/git-worktree.schema";
import { worktreeAdviceResponseSchema } from "../../../shared/schemas/git-worktree.schema";
import { db } from "../../db/client";
import { taskRunCommitRecords, taskRuns, tasks } from "../../db/schema";
import { AppError, NotFoundError } from "../../lib/errors";
import {
	GitCliError,
	type GitCommandRunner,
	probeGit,
	runGitCommand,
} from "../../services/git-worktree/git-worktree-cli";
import {
	parseWorktreeListPorcelain,
	parseWorktreeStatusPorcelain,
} from "../../services/git-worktree/git-worktree-parser";
import { callStructuredJsonLLM } from "../../services/structured-llm";
import { parseRepairedJsonWithSchema } from "../../services/structured-llm/json";
import { gitDiffTool } from "../../services/worker-tools/git";
import * as repo from "./nightworkers.repository";

const ACTIVE_TASK_STATUSES = [
	"draft",
	"ready",
	"context_compiling",
	"queued",
	"running",
	"finalizing",
	"verifying",
	"needs_review",
	"blocked",
	"needs_human",
] as const;
const ACTIVE_RUN_STATUSES = [
	"running",
	"context_compiling",
	"finalizing",
	"needs_review",
	"blocked",
	"needs_human",
] as const;
const PENDING_CLOSEOUT_STATUSES = ["pending", "ready", "needs_human"] as const;

type RepositoryIdentity = { topLevel: string; commonDir: string };
type WorktreeServiceOptions = { runner?: GitCommandRunner };

function appError(status: number, code: string, message: string) {
	return new AppError(status, code, message);
}

async function canonicalize(value: string) {
	const absolute = path.resolve(value);
	return fs.realpath(absolute).catch(() => absolute);
}

function worktreeId(commonDir: string, canonicalPath: string) {
	return createHash("sha256")
		.update(commonDir)
		.update("\0")
		.update(canonicalPath)
		.digest("hex");
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

async function readUsage(repositoryId: string) {
	const [taskRows, runRows, closeoutRows] = await Promise.all([
		db
			.select({ id: tasks.id, status: tasks.status, path: tasks.worktreePath })
			.from(tasks)
			.where(
				and(
					eq(tasks.repositoryId, repositoryId),
					isNotNull(tasks.worktreePath),
				),
			),
		db
			.select({
				id: taskRuns.id,
				status: taskRuns.status,
				path: taskRuns.worktreePath,
			})
			.from(taskRuns)
			.where(
				and(
					eq(taskRuns.repositoryId, repositoryId),
					isNotNull(taskRuns.worktreePath),
				),
			),
		db
			.select({
				runId: taskRunCommitRecords.runId,
				path: taskRuns.worktreePath,
			})
			.from(taskRunCommitRecords)
			.innerJoin(taskRuns, eq(taskRunCommitRecords.runId, taskRuns.id))
			.where(
				and(
					eq(taskRuns.repositoryId, repositoryId),
					isNotNull(taskRuns.worktreePath),
					inArray(taskRunCommitRecords.status, [...PENDING_CLOSEOUT_STATUSES]),
				),
			),
	]);
	const map = new Map<string, WorktreeUsage>();
	const get = (value: string) => {
		const key = path.resolve(value);
		let usage = map.get(key);
		if (!usage) {
			usage = {
				taskIds: [],
				runIds: [],
				activeTaskCount: 0,
				activeRunCount: 0,
				pendingCloseoutCount: 0,
			};
			map.set(key, usage);
		}
		return usage;
	};
	for (const row of taskRows) {
		if (
			!row.path ||
			!(ACTIVE_TASK_STATUSES as readonly string[]).includes(row.status)
		)
			continue;
		const usage = get(row.path);
		usage.taskIds.push(row.id);
		usage.activeTaskCount += 1;
	}
	for (const row of runRows) {
		if (
			!row.path ||
			!(ACTIVE_RUN_STATUSES as readonly string[]).includes(row.status)
		)
			continue;
		const usage = get(row.path);
		usage.runIds.push(row.id);
		usage.activeRunCount += 1;
	}
	for (const row of closeoutRows) {
		if (!row.path) continue;
		const usage = get(row.path);
		if (!usage.runIds.includes(row.runId)) usage.runIds.push(row.runId);
		usage.pendingCloseoutCount += 1;
	}
	return map;
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
		input.runner([
			"-C",
			input.localPath,
			"worktree",
			"list",
			"--porcelain",
			"-z",
		]),
		readUsage(input.repositoryId),
	]);
	const records = parseWorktreeListPorcelain(listResult.stdout);
	return Promise.all(
		records.map(async (record): Promise<WorktreeSummary> => {
			const canonicalPath = await canonicalize(record.path);
			const usage = usageMap.get(path.resolve(canonicalPath)) ?? emptyUsage();
			let status = parseWorktreeStatusPorcelain("");
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
				headSubject = subjectResult?.stdout.trim() || null;
			}
			const blockers: WorktreeRemoveBlocker[] = [];
			const warnings: WorktreeRemoveWarning[] = [];
			if (canonicalPath === input.identity.topLevel)
				blockers.push("base_worktree_protected");
			if (record.locked) blockers.push("worktree_locked");
			if (record.prunable) blockers.push("worktree_prunable");
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
	const repository = await repo.getRepository(repositoryId);
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
	} catch {
		return {
			git,
			repository: {
				available: false,
				commonDir: null,
				reason: "not_git_repository",
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

function requireAvailable(data: WorktreeListResponse) {
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
	requireAvailable(data);
	const worktree = data.worktrees.find((item) => item.id === id);
	if (!worktree)
		throw appError(404, "worktree_not_found", "Worktree not found");
	return worktree.canonicalPath;
}

export async function resolveTaskExecutionRoot(input: {
	repositoryId: string;
	repositoryPath: string;
	worktreePath?: string | null;
}) {
	if (!input.worktreePath) return canonicalize(input.repositoryPath);
	const expectedPath = await canonicalize(input.worktreePath);
	const data = await listRepositoryWorktrees(input.repositoryId);
	requireAvailable(data);
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

function branchSlug(value: string) {
	return (
		value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "") || "worktree"
	);
}

function overlapsExisting(target: string, existing: string) {
	const fromExisting = path.relative(existing, target);
	const fromTarget = path.relative(target, existing);
	return (
		fromExisting === "" ||
		(!fromExisting.startsWith("..") && !path.isAbsolute(fromExisting)) ||
		(!fromTarget.startsWith("..") && !path.isAbsolute(fromTarget))
	);
}

export async function createRepositoryWorktree(
	repositoryId: string,
	request: CreateWorktreeRequest,
	options: WorktreeServiceOptions = {},
) {
	const repository = await requireRepository(repositoryId);
	const runner = options.runner ?? runGitCommand;
	const before = await listRepositoryWorktrees(repositoryId, { runner });
	requireAvailable(before);
	try {
		await runner(["check-ref-format", "--branch", request.branchName]);
	} catch {
		throw appError(400, "branch_invalid", "Branch name is invalid");
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
		} catch {
			throw appError(400, "start_point_invalid", "Start point is invalid");
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
		} catch {
			throw appError(400, "branch_invalid", "Local branch does not exist");
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
	if (
		before.worktrees.some((item) =>
			overlapsExisting(target, item.canonicalPath),
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
		throw appError(
			409,
			"git_command_failed",
			error instanceof Error ? error.message : "Git worktree add failed",
		);
	}
	const after = await listRepositoryWorktrees(repositoryId, { runner });
	const created = after.worktrees.find(
		(item) => path.resolve(item.canonicalPath) === target,
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
	requireAvailable(before);
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
	if (!target.canRemove)
		throw new AppError(
			409,
			target.removeBlockers[0] || "worktree_in_use",
			"Worktree cannot be removed",
			{
				blockers: target.removeBlockers,
				warnings: target.removeWarnings,
			},
		);
	try {
		await runner(
			["-C", repository.localPath, "worktree", "remove", "--", target.path],
			{ timeoutMs: 60_000 },
		);
	} catch (error) {
		throw appError(
			409,
			"git_command_failed",
			error instanceof Error ? error.message : "Git worktree remove failed",
		);
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
	requireAvailable(data);
	const result = await runner([
		"-C",
		repository.localPath,
		"worktree",
		"prune",
		"--dry-run",
		"--verbose",
	]);
	return {
		entries: parsePruneEntries(result.stdout),
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
	await runner(["-C", repository.localPath, "worktree", "prune", "--verbose"]);
	return { pruned: true as const, entries: preview.entries };
}

const worktreeAdviceDraftSchema = z.object({
	summary: z.string(),
	suggestedBranchName: z.string().nullable(),
	suggestedStartPoint: z.string().nullable(),
	suggestedPathSlug: z.string().nullable(),
	cleanupWorktreeIds: z.array(z.string()),
});

export async function adviseRepositoryWorktrees(
	repositoryId: string,
	request: WorktreeAdviceRequest,
): Promise<WorktreeAdviceResponse> {
	const repository = await requireRepository(repositoryId);
	const data = await listRepositoryWorktrees(repositoryId);
	requireAvailable(data);
	const snapshot = {
		repositoryName: repository.name,
		worktrees: data.worktrees.map((item) => ({
			id: item.id,
			branch: item.branch,
			detached: item.detached,
			isBase: item.isBase,
			head: item.head?.slice(0, 12) || null,
			status:
				item.conflictedCount > 0
					? "conflicted"
					: item.stagedCount + item.modifiedCount + item.untrackedCount > 0
						? "changed"
						: "clean",
			ahead: item.ahead,
			behind: item.behind,
			inUse:
				item.usage.activeTaskCount +
					item.usage.activeRunCount +
					item.usage.pendingCloseoutCount >
				0,
			canRemove: item.canRemove,
			blockerCodes: item.removeBlockers,
			warningCodes: item.removeWarnings,
		})),
		selectedWorktreeId: request.selectedWorktreeId || null,
		taskIntent: request.taskIntent || null,
	};
	const raw = await callStructuredJsonLLM(
		[
			"あなたは Git worktree の読み取り専用アドバイザーです。",
			"確認済みスナップショットだけを根拠に、日本語で簡潔に回答してください。",
			"Git 操作や削除を実行せず、force 操作を提案しないでください。",
			"JSON schema に従ってください。",
		].join("\n"),
		`依頼種別: ${request.kind}\n状態:\n${JSON.stringify(snapshot)}`,
		{
			schemaName: "worktree_advice",
			schema: {
				type: "object",
				additionalProperties: false,
				required: [
					"summary",
					"suggestedBranchName",
					"suggestedStartPoint",
					"suggestedPathSlug",
					"cleanupWorktreeIds",
				],
				properties: {
					summary: { type: "string" },
					suggestedBranchName: { type: ["string", "null"] },
					suggestedStartPoint: { type: ["string", "null"] },
					suggestedPathSlug: { type: ["string", "null"] },
					cleanupWorktreeIds: {
						type: "array",
						items: { type: "string" },
					},
				},
			},
			role: "evaluation",
			workingDirectory: repository.localPath,
			timeoutMs: 30_000,
			allowRawOutputOnJsonParseFailure: true,
		},
	);
	const parsed = parseRepairedJsonWithSchema(raw, worktreeAdviceDraftSchema);
	if (parsed.ok) return worktreeAdviceResponseSchema.parse(parsed.value);
	return {
		summary: raw.trim() || "Worktree の状況を要約できませんでした。",
		suggestedBranchName: null,
		suggestedStartPoint: null,
		suggestedPathSlug: null,
		cleanupWorktreeIds: [],
	};
}
