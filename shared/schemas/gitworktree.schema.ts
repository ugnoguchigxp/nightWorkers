import { z } from "@hono/zod-openapi";

export * from "./git-integration.schema";

export const gitCapabilityReasonSchema = z
	.enum(["git_not_found", "git_probe_timed_out", "git_probe_failed"])
	.nullable();

export const gitRepositoryCapabilityReasonSchema = z
	.enum(["not_git_repository", "repository_probe_failed"])
	.nullable();

export const worktreeRemoveBlockerSchema = z.enum([
	"base_worktree_protected",
	"target_branch_protected",
	"worktree_in_use",
	"worktree_dirty",
	"worktree_conflicted",
	"worktree_status_unavailable",
	"worktree_locked",
	"worktree_prunable",
	"detached_commits_unprotected",
]);

export const discardableWorktreeRemoveBlockers = [
	"worktree_dirty",
	"worktree_conflicted",
] as const;

export const worktreeRemoveWarningSchema = z.enum([
	"upstream_missing",
	"upstream_ahead",
]);

export const worktreeUsageSchema = z.object({
	taskIds: z.array(z.string()),
	runIds: z.array(z.string()),
	activeTaskCount: z.number().int().nonnegative(),
	activeRunCount: z.number().int().nonnegative(),
	pendingCloseoutCount: z.number().int().nonnegative(),
});

export const worktreeSummarySchema = z.object({
	id: z.string(),
	path: z.string(),
	canonicalPath: z.string(),
	isBase: z.boolean(),
	head: z.string().nullable(),
	headSubject: z.string().nullable(),
	branch: z.string().nullable(),
	detached: z.boolean(),
	bare: z.boolean(),
	locked: z.boolean(),
	lockReason: z.string().nullable(),
	prunable: z.boolean(),
	pruneReason: z.string().nullable(),
	upstream: z.string().nullable(),
	ahead: z.number().int().nonnegative(),
	behind: z.number().int().nonnegative(),
	stagedCount: z.number().int().nonnegative(),
	modifiedCount: z.number().int().nonnegative(),
	untrackedCount: z.number().int().nonnegative(),
	conflictedCount: z.number().int().nonnegative(),
	usage: worktreeUsageSchema,
	canRemove: z.boolean(),
	removeBlockers: z.array(worktreeRemoveBlockerSchema),
	removeWarnings: z.array(worktreeRemoveWarningSchema),
});

export const worktreeListResponseSchema = z
	.object({
		git: z.object({
			available: z.boolean(),
			version: z.string().nullable(),
			reason: gitCapabilityReasonSchema,
		}),
		repository: z.object({
			available: z.boolean(),
			commonDir: z.string().nullable(),
			reason: gitRepositoryCapabilityReasonSchema,
		}),
		worktrees: z.array(worktreeSummarySchema),
		refreshedAt: z.string(),
	})
	.openapi("WorktreeListResponse");

export const createWorktreeRequestSchema = z
	.discriminatedUnion("mode", [
		z.object({
			mode: z.literal("new_branch"),
			branchName: z.string().trim().min(1).max(240),
			startPoint: z.string().trim().min(1).max(500),
			path: z.string().trim().min(1).optional(),
		}),
		z.object({
			mode: z.literal("existing_branch"),
			branchName: z.string().trim().min(1).max(240),
			path: z.string().trim().min(1).optional(),
		}),
	])
	.openapi("CreateWorktreeRequest");

export const worktreeIdRequestSchema = z
	.object({ worktreeId: z.string().min(1) })
	.strict();

export const removeWorktreeRequestSchema = z
	.object({
		worktreeId: z.string().min(1),
		expectedHead: z.string().min(1),
		discardChanges: z.boolean().optional(),
	})
	.strict()
	.openapi("RemoveWorktreeRequest");

export const worktreeDiffSchema = z
	.object({
		diff: z.string(),
		diffStat: z.string(),
		hasChanges: z.boolean(),
		truncated: z.boolean(),
	})
	.openapi("WorktreeDiff");

export const worktreePrunePreviewSchema = z
	.object({ entries: z.array(z.string()), refreshedAt: z.string() })
	.openapi("WorktreePrunePreview");

export type WorktreeRemoveBlocker = z.infer<typeof worktreeRemoveBlockerSchema>;
export type WorktreeRemoveWarning = z.infer<typeof worktreeRemoveWarningSchema>;
export type WorktreeUsage = z.infer<typeof worktreeUsageSchema>;
export type WorktreeSummary = z.infer<typeof worktreeSummarySchema>;
export type WorktreeListResponse = z.infer<typeof worktreeListResponseSchema>;
export type CreateWorktreeRequest = z.infer<typeof createWorktreeRequestSchema>;
export type RemoveWorktreeRequest = z.infer<typeof removeWorktreeRequestSchema>;
