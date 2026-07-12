import type { DbTransaction, db } from "../../db/client";
import type {
	ImplementationQueueEntryStatus,
	implementationQueueEntries,
} from "../../db/schema";

export const ACTIVE_IMPLEMENTATION_QUEUE_STATUSES = [
	"queued",
	"claimed",
	"processing",
	"needs_human",
	"awaiting_commit_decision",
	"execution_completed",
	"failed",
	"cancelled",
] as const;
export const OCCUPIED_PROCESSOR_STATUSES = [
	"claimed",
	"processing",
	"needs_human",
	"awaiting_commit_decision",
] as const;
export type ClaimNextImplementationQueueEntryInput = {
	processorCount: number;
	leaseOwnerId: string;
	leaseTtlMs: number;
	now?: Date;
	allowExpiredClaimRecovery?: boolean;
	candidateLimit?: number;
};

export type TaskExecutionType = "normal" | "exclusive" | "sequence";
export type QueueSchedulingBlockedReason =
	| "none"
	| "claim_not_ready"
	| "workspace_not_ready"
	| "exclusive_waiting_for_active_tasks"
	| "normal_blocked_by_ready_non_normal"
	| "normal_blocked_by_active_non_normal"
	| "sequence_predecessor_pending"
	| "sequence_predecessor_failed"
	| "sequence_order_conflict"
	| "candidate_window_exhausted"
	| "cas_lost";
export type ClaimSkipEvidence = {
	entryId: string;
	reason: QueueSchedulingBlockedReason;
	executionType: TaskExecutionType;
	lockKey: string;
	activeEntryIds: string[];
	readyNonNormalEntryIds: string[];
};
export type ClaimImplementationQueueResult =
	| { kind: "claimed"; entry: typeof implementationQueueEntries.$inferSelect }
	| {
			kind: "not_claimed";
			reason: "empty" | "processor_full" | "blocked_by_lock" | "cas_lost";
			skipped: ClaimSkipEvidence[];
	  };
export type QueueSchedulingLockState = {
	activeCount: number;
	activeNonNormalCount: number;
	readyNonNormalCount: number;
	activeEntryIds: string[];
	readyNonNormalEntryIds: string[];
};
export type QueueDb = DbTransaction | typeof db;

export const RUNNING_TASK_RUN_STATUSES = [
	"running",
	"context_compiling",
	"finalizing",
] as const;
export const QUEUE_COMPLETION_SOURCE_STATUSES = [
	"claimed",
	"processing",
	"awaiting_commit_decision",
] as const;
export const LOCK_ACTIVE_STATUSES = ["claimed", "processing"] as const;
export const SEQUENCE_TERMINAL_BLOCKER_STATUSES = [
	"failed",
	"cancelled",
	"needs_human",
] as const;

export function normalizeExecutionType(
	value: string | null | undefined,
): TaskExecutionType {
	return value === "exclusive" || value === "sequence" ? value : "normal";
}

export function resolveImplementationQueueExecutionLockKey(entry: {
	repositoryId: string;
	executionLockKey?: string | null;
}) {
	return entry.executionLockKey?.trim() || `repository:${entry.repositoryId}`;
}

export function isRunningTaskRunStatus(status: string | null | undefined) {
	return Boolean(
		status && (RUNNING_TASK_RUN_STATUSES as readonly string[]).includes(status),
	);
}

export function queueStatusForRunStatus(
	status: string,
): ImplementationQueueEntryStatus {
	if (status === "completed") return "execution_completed";
	if (status === "needs_review") return "awaiting_commit_decision";
	if (status === "cancelled") return "cancelled";
	if (status === "needs_human") return "needs_human";
	return "failed";
}
