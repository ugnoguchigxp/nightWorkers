import type {
	CreateWorktreeRequest,
	WorktreeSummary,
} from "../../../../shared/schemas/gitworktree.schema";
import { discardableWorktreeRemoveBlockers } from "../../../../shared/schemas/gitworktree.schema";

const discardableRemoveBlockers = new Set<string>(
	discardableWorktreeRemoveBlockers,
);

export type WorktreeDiff = {
	diff: string;
	diffStat: string;
	hasChanges: boolean;
	truncated: boolean;
};

export function worktreeHasChanges(worktree: WorktreeSummary) {
	return (
		worktree.stagedCount +
			worktree.modifiedCount +
			worktree.untrackedCount +
			worktree.conflictedCount >
		0
	);
}

export function canDiscardAndRemoveWorktree(worktree: WorktreeSummary) {
	return (
		worktree.removeBlockers.length > 0 &&
		worktree.removeBlockers.every((blocker) =>
			discardableRemoveBlockers.has(blocker),
		)
	);
}

export function worktreeStatusLabelKey(worktree: WorktreeSummary) {
	if (worktree.prunable) return "projectDetail.worktrees.status.prunable";
	if (worktree.removeBlockers.includes("worktree_status_unavailable"))
		return "projectDetail.worktrees.status.unavailable";
	if (worktree.locked) return "projectDetail.worktrees.status.locked";
	if (worktree.conflictedCount > 0)
		return "projectDetail.worktrees.status.conflicted";
	if (worktreeHasChanges(worktree))
		return "projectDetail.worktrees.status.changed";
	return "projectDetail.worktrees.status.clean";
}

export function defaultCreateDraft(): CreateWorktreeRequest {
	return { mode: "new_branch", branchName: "", startPoint: "HEAD" };
}
