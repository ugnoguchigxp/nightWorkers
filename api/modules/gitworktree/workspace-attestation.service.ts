import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import {
	repositories,
	taskGitWorkspaces,
	workspaceAttestations,
} from "../../db/schema";
import { AppError } from "../../lib/errors";
import { runGitCommand } from "./gitworktree-cli";

export async function attestTaskWorkspaceForRun(input: {
	taskId: string;
	requireClean: boolean;
	allowedDirtyPaths?: string[];
	allowCurrentDirtyState?: boolean;
}) {
	const [workspace] = await db
		.select()
		.from(taskGitWorkspaces)
		.where(eq(taskGitWorkspaces.taskId, input.taskId));
	if (!workspace?.worktreePath) {
		throw new AppError(
			409,
			"workspace_binding_required",
			"RunにはTask専用workspaceの割当てが必要です。",
		);
	}
	const [repository] = await db
		.select()
		.from(repositories)
		.where(eq(repositories.id, workspace.repositoryId));
	if (
		repository?.repositoryIdentityStatus !== "ready" ||
		!repository.gitCommonDirCanonical ||
		!repository.repositoryIdentityDigest ||
		repository.repositoryIdentityRevision < 1
	) {
		throw new AppError(
			409,
			"repository_identity_not_ready",
			"Project Git identityが検証済みではありません。",
		);
	}
	if (
		workspace.repositoryIdentityRevision !==
			repository.repositoryIdentityRevision ||
		workspace.repositoryIdentityDigest !== repository.repositoryIdentityDigest
	) {
		throw new AppError(
			409,
			"workspace_repository_identity_mismatch",
			"Workspace作成後にProject Git identityが変化しました。",
		);
	}

	const canonicalPath = await fs.realpath(workspace.worktreePath);
	if (
		!workspace.taskWorktreePathCanonical ||
		canonicalPath !== workspace.taskWorktreePathCanonical
	) {
		throw new AppError(
			409,
			"workspace_canonical_path_mismatch",
			"Task workspaceのcanonical pathが割当てと一致しません。",
		);
	}
	const [topLevel, commonDir, branch, head, status, conflicts] =
		await Promise.all([
			runGitCommand(["-C", canonicalPath, "rev-parse", "--show-toplevel"]),
			runGitCommand(["-C", canonicalPath, "rev-parse", "--git-common-dir"]),
			runGitCommand([
				"-C",
				canonicalPath,
				"symbolic-ref",
				"--quiet",
				"--short",
				"HEAD",
			]),
			runGitCommand(["-C", canonicalPath, "rev-parse", "HEAD"]),
			runGitCommand([
				"-C",
				canonicalPath,
				"status",
				"--porcelain=v1",
				"-z",
				"--untracked-files=normal",
			]),
			runGitCommand([
				"-C",
				canonicalPath,
				"diff",
				"--name-only",
				"--diff-filter=U",
			]),
		]);
	const topLevelCanonical = await canonicalGitPath(
		canonicalPath,
		topLevel.stdout,
	);
	const commonDirCanonical = await canonicalGitPath(
		canonicalPath,
		commonDir.stdout,
	);
	const branchRef = `refs/heads/${branch.stdout.trim()}`;
	const headSha = head.stdout.trim();
	const statusPaths = parsePorcelainStatus(status.stdout);
	const conflictPaths = conflicts.stdout
		.split("\n")
		.map((value) => value.trim())
		.filter(Boolean)
		.sort();
	const dirty = statusPaths.all.length > 0;
	const conflicted = conflictPaths.length > 0;
	assertObservedWorkspace({
		canonicalPath,
		topLevelCanonical,
		commonDirCanonical,
		branchRef,
		headSha,
		dirty,
		conflicted,
		requireClean: input.requireClean,
		allowedDirtyPaths: input.allowedDirtyPaths,
		allowCurrentDirtyState: input.allowCurrentDirtyState,
		dirtyPaths: statusPaths.all,
		expected: {
			commonDirCanonical: repository.gitCommonDirCanonical,
			sourceRef: workspace.sourceRef,
			expectedHeadSha: workspace.expectedHeadSha,
		},
	});

	const comparisonRef = workspace.targetRef;
	const comparison = comparisonRef
		? await readComparison(canonicalPath, comparisonRef)
		: { ahead: 0, behind: 0, comparisonSha: null };
	const upstream = comparisonRef
		? await readUpstreamComparison(canonicalPath, comparisonRef)
		: {
				upstreamRef: null,
				upstreamSha: null,
				upstreamAhead: null,
				upstreamBehind: null,
				upstreamFreshness: "upstream_missing" as const,
				upstreamFetchedAt: null,
			};
	const observedAt = new Date();
	const revision = workspace.attestationRevision + 1;
	const digest = digestValue(
		JSON.stringify({
			workspaceId: workspace.id,
			revision,
			canonicalPath,
			commonDirCanonical,
			branchRef,
			headSha,
			dirty,
			conflicted,
			statusPaths,
			conflictPaths,
			comparisonRef,
			...comparison,
			...upstream,
			observedAt: observedAt.toISOString(),
		}),
	);
	return db.transaction(async (tx) => {
		const [attestation] = await tx
			.insert(workspaceAttestations)
			.values({
				workspaceId: workspace.id,
				taskId: workspace.taskId,
				repositoryId: workspace.repositoryId,
				revision,
				digest,
				canonicalPath,
				gitCommonDirCanonical: commonDirCanonical,
				branchRef,
				headSha,
				expectedHeadSha: workspace.expectedHeadSha,
				dirty,
				conflicted,
				stagedPathsJson: statusPaths.staged,
				modifiedPathsJson: statusPaths.modified,
				untrackedPathsJson: statusPaths.untracked,
				conflictPathsJson: conflictPaths,
				ahead: comparison.ahead,
				behind: comparison.behind,
				comparisonRef,
				comparisonSha: comparison.comparisonSha,
				...upstream,
				observedAt,
			})
			.returning();
		const [updated] = await tx
			.update(taskGitWorkspaces)
			.set({
				attestationRevision: revision,
				lastAttestationId: attestation.id,
				lastAttestationDigest: digest,
				lastVerifiedHead: headSha,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(taskGitWorkspaces.id, workspace.id),
					eq(
						taskGitWorkspaces.attestationRevision,
						workspace.attestationRevision,
					),
				),
			)
			.returning();
		if (!updated) {
			throw new AppError(
				409,
				"workspace_attestation_revision_conflict",
				"Workspace attestationが並行更新されました。",
			);
		}
		return { workspace: updated, attestation };
	});
}

function assertObservedWorkspace(input: {
	canonicalPath: string;
	topLevelCanonical: string;
	commonDirCanonical: string;
	branchRef: string;
	headSha: string;
	dirty: boolean;
	conflicted: boolean;
	requireClean: boolean;
	allowedDirtyPaths?: string[];
	allowCurrentDirtyState?: boolean;
	dirtyPaths: string[];
	expected: {
		commonDirCanonical: string;
		sourceRef: string | null;
		expectedHeadSha: string | null;
	};
}) {
	const mismatch =
		input.topLevelCanonical !== input.canonicalPath ||
		input.commonDirCanonical !== input.expected.commonDirCanonical ||
		input.branchRef !== input.expected.sourceRef ||
		(Boolean(input.expected.expectedHeadSha) &&
			input.headSha !== input.expected.expectedHeadSha) ||
		input.conflicted ||
		(!input.allowCurrentDirtyState && input.requireClean && input.dirty) ||
		(!input.allowCurrentDirtyState &&
			!input.requireClean &&
			input.dirtyPaths.some(
				(value) => !new Set(input.allowedDirtyPaths ?? []).has(value),
			));
	if (!mismatch) return;
	throw new AppError(
		409,
		"workspace_attestation_failed",
		"Task workspaceのpath、Git common dir、branch、HEAD、dirty state、conflict stateが期待値と一致しません。",
		{
			expected: input.expected,
			observed: {
				canonicalPath: input.canonicalPath,
				topLevelCanonical: input.topLevelCanonical,
				commonDirCanonical: input.commonDirCanonical,
				branchRef: input.branchRef,
				headSha: input.headSha,
				dirty: input.dirty,
				conflicted: input.conflicted,
				dirtyPaths: input.dirtyPaths,
			},
		},
	);
}

function parsePorcelainStatus(output: string) {
	const staged = new Set<string>();
	const modified = new Set<string>();
	const untracked = new Set<string>();
	const tokens = output.split("\0").filter(Boolean);
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index] ?? "";
		const x = token[0] ?? " ";
		const y = token[1] ?? " ";
		const relativePath = token.slice(3);
		if (!relativePath) continue;
		if (x === "?" && y === "?") untracked.add(relativePath);
		else {
			if (x !== " " && x !== "?") staged.add(relativePath);
			if (y !== " ") modified.add(relativePath);
		}
		if (x === "R" || x === "C") {
			const originalPath = tokens[index + 1] ?? "";
			if (originalPath) staged.add(originalPath);
			index += 1;
		}
	}
	const all = new Set([...staged, ...modified, ...untracked]);
	return {
		staged: [...staged].sort(),
		modified: [...modified].sort(),
		untracked: [...untracked].sort(),
		all: [...all].sort(),
	};
}

async function readComparison(canonicalPath: string, comparisonRef: string) {
	const [counts, comparisonHead] = await Promise.all([
		runGitCommand([
			"-C",
			canonicalPath,
			"rev-list",
			"--left-right",
			"--count",
			`HEAD...${comparisonRef}`,
		]),
		runGitCommand(["-C", canonicalPath, "rev-parse", comparisonRef]),
	]);
	const [ahead = 0, behind = 0] = counts.stdout
		.trim()
		.split(/\s+/)
		.map((value) => Number.parseInt(value, 10));
	return {
		ahead: Number.isFinite(ahead) ? ahead : 0,
		behind: Number.isFinite(behind) ? behind : 0,
		comparisonSha: comparisonHead.stdout.trim(),
	};
}

async function readUpstreamComparison(
	canonicalPath: string,
	comparisonRef: string,
) {
	const upstreamRef = (
		await runGitCommand([
			"-C",
			canonicalPath,
			"for-each-ref",
			"--format=%(upstream)",
			comparisonRef,
		])
	).stdout.trim();
	if (!upstreamRef) {
		return {
			upstreamRef: null,
			upstreamSha: null,
			upstreamAhead: null,
			upstreamBehind: null,
			upstreamFreshness: "upstream_missing" as const,
			upstreamFetchedAt: null,
		};
	}
	const [counts, sha] = await Promise.all([
		runGitCommand([
			"-C",
			canonicalPath,
			"rev-list",
			"--left-right",
			"--count",
			`${comparisonRef}...${upstreamRef}`,
		]),
		runGitCommand(["-C", canonicalPath, "rev-parse", upstreamRef]),
	]);
	const [ahead = 0, behind = 0] = counts.stdout
		.trim()
		.split(/\s+/)
		.map((value) => Number.parseInt(value, 10));
	return {
		upstreamRef,
		upstreamSha: sha.stdout.trim(),
		upstreamAhead: Number.isFinite(ahead) ? ahead : 0,
		upstreamBehind: Number.isFinite(behind) ? behind : 0,
		upstreamFreshness: "local_only" as const,
		upstreamFetchedAt: null,
	};
}

async function canonicalGitPath(root: string, value: string) {
	const resolved = path.resolve(root, value.trim());
	return fs.realpath(resolved).catch(() => resolved);
}

function digestValue(value: string) {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
