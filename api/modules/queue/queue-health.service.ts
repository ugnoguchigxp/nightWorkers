import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import * as repo from "./queue.repository";
import { runImplementationQueueWhenEnabled } from "./queue-admission.service";

type QueueHealthClassification =
	| "normal"
	| "stale_claim"
	| "stale_processing"
	| "terminal_run_pending_completion"
	| "orphaned_active_run"
	| "needs_human"
	| "failed";

const DEFAULT_STALE_PROCESSING_MS = 30 * 60 * 1000;
const DEFAULT_MAX_QUEUE_ATTEMPTS = 3;

export function isRunningRunStatus(status: string | null | undefined) {
	return Boolean(
		status && ["running", "context_compiling", "finalizing"].includes(status),
	);
}

export function isTerminalQueueStatus(status: string) {
	return [
		"execution_completed",
		"failed",
		"cancelled",
		"needs_human",
		"execution_archived",
	].includes(status);
}

function recommendedActionForHealthItem(item: {
	classification: string;
	retryable: boolean;
	entry: { status: string };
	run: { status: string } | null;
}): "none" | "retry" | "complete" | "mark_needs_human" | "archive" {
	if (item.classification === "terminal_run_pending_completion")
		return "complete";
	if (
		item.classification === "stale_claim" ||
		item.classification === "orphaned_active_run"
	) {
		return item.retryable ? "retry" : "mark_needs_human";
	}
	if (item.classification === "stale_processing") {
		if (item.run && !isRunningRunStatus(item.run.status)) return "complete";
		return item.retryable && !item.run ? "retry" : "mark_needs_human";
	}
	if (
		["execution_completed", "failed", "cancelled"].includes(item.entry.status)
	)
		return "archive";
	return "none";
}

function healthClassification(item: {
	classification: string;
	entry: { status: string };
}): QueueHealthClassification {
	if (item.entry.status === "needs_human") return "needs_human";
	if (item.entry.status === "failed") return "failed";
	return item.classification as QueueHealthClassification;
}

export async function listImplementationQueueHealth(
	options: {
		now?: Date;
		staleProcessingMs?: number;
		maxAttempts?: number;
	} = {},
) {
	const snapshot = await repo.listImplementationQueueHealthSnapshot({
		now: options.now,
		staleProcessingMs: options.staleProcessingMs ?? DEFAULT_STALE_PROCESSING_MS,
		maxAttempts: options.maxAttempts ?? DEFAULT_MAX_QUEUE_ATTEMPTS,
	});
	const items = await Promise.all(
		snapshot.items.map(async (item) => {
			const classification = healthClassification(item);
			return {
				entryId: item.entry.id,
				taskId: item.entry.taskId,
				runId: item.entry.activeRunId,
				status: item.entry.status,
				classification,
				processorSlot: item.entry.processorSlot,
				leaseOwnerId: item.entry.leaseOwnerId,
				leaseExpiresAt: item.entry.leaseExpiresAt,
				lastHeartbeatAt: item.entry.lastHeartbeatAt,
				attemptCount: item.entry.attemptCount,
				recoveryReason: item.entry.recoveryReason,
				statusReason: item.entry.statusReason,
				recommendedAction: recommendedActionForHealthItem(item),
				scheduling: await repo.getImplementationQueueEntrySchedulingHealth(
					item.entry,
				),
			};
		}),
	);
	return {
		generatedAt: snapshot.generatedAt,
		counts: {
			queued: snapshot.counts.queued,
			claimed: snapshot.counts.claimed,
			processing: snapshot.counts.processing,
			stale: snapshot.counts.staleClaimed + snapshot.counts.staleProcessing,
			retryable: items.filter((item) => item.recommendedAction === "retry")
				.length,
			needsHuman: items.filter((item) => item.classification === "needs_human")
				.length,
			orphaned: snapshot.counts.activeRunMissing,
			pendingCompletion: snapshot.counts.terminalRunWithActiveQueueEntry,
		},
		items,
	};
}

export async function recordQueueRecoveryEvidence(input: {
	taskId: string;
	runId?: string | null;
	queueEntryId: string;
	action: string;
	reason: string;
	note?: string;
}) {
	await nightworkersRepo.createTaskMessage({
		taskId: input.taskId,
		runId: input.runId ?? undefined,
		role: "system",
		content: `Implementation Queue recovery: ${input.reason}.`,
		messageType: "text",
		payloadJson: {
			source: "implementation_queue",
			status: "recovery",
			action: input.action,
			reason: input.reason,
			queueEntryId: input.queueEntryId,
			note: input.note?.trim() || undefined,
		},
	});
	if (!input.runId) return;
	await nightworkersRepo.createRunEvent({
		version: 1,
		runId: input.runId,
		taskId: input.taskId,
		timestamp: new Date().toISOString(),
		type: "run.recovered",
		severity: "warning",
		actor: "system",
		message: `Implementation Queue recovery: ${input.reason}.`,
		data: {
			source: "implementation_queue",
			action: input.action,
			reason: input.reason,
			queueEntryId: input.queueEntryId,
		},
	});
}

export async function reconcileImplementationQueue(
	options: {
		apply?: boolean;
		now?: Date;
		staleProcessingMs?: number;
		maxAttempts?: number;
		reason?: string;
	} = {},
) {
	const now = options.now ?? new Date();
	const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_QUEUE_ATTEMPTS;
	const snapshot = await repo.listImplementationQueueHealthSnapshot({
		now,
		staleProcessingMs: options.staleProcessingMs ?? DEFAULT_STALE_PROCESSING_MS,
		maxAttempts,
	});
	if (!options.apply) {
		return {
			applied: false,
			actions: [],
			health: await listImplementationQueueHealth(options),
		};
	}

	const actions: Array<{ entryId: string; action: string; status: string }> =
		[];
	for (const item of snapshot.items) {
		const entry = item.entry;
		if (entry.status === "awaiting_commit_decision") continue;
		if (item.classification === "terminal_run_pending_completion" && item.run) {
			const completed = await repo.completeImplementationQueueEntryForRunId({
				runId: item.run.id,
				runStatus: item.run.status,
				now,
			});
			if (completed) {
				actions.push({
					entryId: entry.id,
					action: "complete",
					status: completed.status,
				});
				await recordQueueRecoveryEvidence({
					taskId: entry.taskId,
					runId: item.run.id,
					queueEntryId: entry.id,
					action: "complete",
					reason: "terminal_run_missing_queue_completion",
				});
			}
			continue;
		}
		if (item.classification === "stale_claim") {
			const retryable = entry.attemptCount < maxAttempts;
			const updated = await repo.recoverImplementationQueueEntryFromSnapshot(
				entry.id,
				{ status: entry.status, leaseVersion: entry.leaseVersion },
				{
					status: retryable ? "queued" : "needs_human",
					processorSlot: retryable ? null : entry.processorSlot,
					leaseOwnerId: null,
					leaseAcquiredAt: null,
					leaseExpiresAt: null,
					recoveredAt: now,
					recoveryReason: "lease_expired_before_run_start",
					lastFailureKind: "lease_expired_before_run_start",
					statusReason: retryable
						? null
						: "Queue claim lease expired before run start.",
				},
			);
			if (updated) {
				actions.push({
					entryId: entry.id,
					action: retryable ? "retry" : "needs_human",
					status: updated.status,
				});
				await recordQueueRecoveryEvidence({
					taskId: entry.taskId,
					queueEntryId: entry.id,
					action: retryable ? "retry" : "mark_needs_human",
					reason: "lease_expired_before_run_start",
				});
			}
			continue;
		}
		if (
			item.classification === "orphaned_active_run" ||
			item.classification === "stale_processing"
		) {
			const activeRunIsTerminal =
				item.run && !isRunningRunStatus(item.run.status);
			if (activeRunIsTerminal && item.run) {
				const completed = await repo.completeImplementationQueueEntryForRunId({
					runId: item.run.id,
					runStatus: item.run.status,
					now,
				});
				if (completed) {
					actions.push({
						entryId: entry.id,
						action: "complete",
						status: completed.status,
					});
					await recordQueueRecoveryEvidence({
						taskId: entry.taskId,
						runId: item.run.id,
						queueEntryId: entry.id,
						action: "complete",
						reason:
							item.classification === "orphaned_active_run"
								? "active_run_not_found"
								: "heartbeat_stale_processing",
					});
				}
				continue;
			}
			const canRetry =
				(item.classification === "orphaned_active_run" ||
					(item.classification === "stale_processing" &&
						!entry.activeRunId &&
						!item.run)) &&
				entry.attemptCount < maxAttempts;
			const updated = await repo.recoverImplementationQueueEntryFromSnapshot(
				entry.id,
				{ status: entry.status, leaseVersion: entry.leaseVersion },
				{
					status: canRetry ? "queued" : "needs_human",
					processorSlot: canRetry ? null : entry.processorSlot,
					activeRunId: canRetry ? null : entry.activeRunId,
					leaseOwnerId: null,
					leaseAcquiredAt: null,
					leaseExpiresAt: null,
					recoveredAt: now,
					recoveryReason:
						item.classification === "orphaned_active_run"
							? "active_run_not_found"
							: "heartbeat_stale_processing",
					lastFailureKind:
						item.classification === "orphaned_active_run"
							? "active_run_not_found"
							: "heartbeat_stale_processing",
					statusReason: canRetry
						? null
						: "Queue processing heartbeat is stale or run state is unsafe.",
				},
			);
			if (updated) {
				actions.push({
					entryId: entry.id,
					action: canRetry ? "retry" : "needs_human",
					status: updated.status,
				});
				await recordQueueRecoveryEvidence({
					taskId: entry.taskId,
					runId: item.run?.id,
					queueEntryId: entry.id,
					action: canRetry ? "retry" : "mark_needs_human",
					reason:
						item.classification === "orphaned_active_run"
							? "active_run_not_found"
							: "heartbeat_stale_processing",
				});
			}
		}
	}
	if (
		snapshot.counts.queued > 0 ||
		actions.some((action) => action.action === "retry")
	) {
		runImplementationQueueWhenEnabled();
	}
	return {
		applied: true,
		actions,
		health: await listImplementationQueueHealth(options),
	};
}
