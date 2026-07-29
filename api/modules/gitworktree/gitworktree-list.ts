import path from "node:path";
import type {
	WorktreeRemoveBlocker,
	WorktreeRemoveWarning,
	WorktreeSummary,
	WorktreeUsage,
} from "../../../shared/schemas/gitworktree.schema";
import type { GitCommandRunner } from "./gitworktree-cli";
import {
	parseWorktreeListPorcelain,
	parseWorktreeStatusPorcelain,
} from "./gitworktree-parser";
import { canonicalize, worktreeId } from "./gitworktree-paths";

function emptyUsage(): WorktreeUsage {
	return {
		taskIds: [],
		runIds: [],
		activeTaskCount: 0,
		activeRunCount: 0,
		pendingCloseoutCount: 0,
		workspaceBinding: null,
	};
}

export async function collectWorktrees(input: {
	listOutput: string;
	usageMap: Map<string, WorktreeUsage>;
	localPath: string;
	targetBranch: string;
	identity: { topLevel: string; commonDir: string };
	runner: GitCommandRunner;
}) {
	const records = parseWorktreeListPorcelain(input.listOutput);
	return Promise.all(
		records.map(async (record): Promise<WorktreeSummary> => {
			const canonicalPath = await canonicalize(record.path);
			const usage =
				input.usageMap.get(path.resolve(canonicalPath)) ?? emptyUsage();
			let status = parseWorktreeStatusPorcelain("");
			let statusUnavailable = false;
			let headSubject: string | null = null;
			let comparisonSha: string | null = null;
			const comparisonObservedAt = new Date().toISOString();
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
				if (status.upstream) {
					const comparisonResult = await input
						.runner([
							"-C",
							record.path,
							"rev-parse",
							"--verify",
							status.upstream,
						])
						.catch(() => null);
					comparisonSha = comparisonResult?.stdout.trim() || null;
				}
			}
			const blockers: WorktreeRemoveBlocker[] = [];
			const warnings: WorktreeRemoveWarning[] = [];
			if (canonicalPath === input.identity.topLevel) {
				blockers.push("base_worktree_protected");
			} else if (record.branch === input.targetBranch) {
				blockers.push("target_branch_protected");
			}
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
				comparisonRef: status.upstream,
				comparisonSha,
				comparisonObservedAt,
				comparisonFreshness: "local_ref",
				usage,
				canRemove: blockers.length === 0,
				removeBlockers: blockers,
				removeWarnings: warnings,
			};
		}),
	);
}
