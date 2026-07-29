import { AppError, NotFoundError } from "../../lib/errors";
import {
	assertTaskDraftComplete,
	hasImplementationPlanEvidence,
} from "../nightworkers/nightworkers.planning-helpers.service";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import * as repo from "./queue.repository";
import {
	assertMissionProposalQueueApproval,
	ensureMissionProposalQueueApproval,
	type QueueRecoveryAction,
	type QueueSideEffectOptions,
	resolveSchedulingDecisionFromMessages,
	runImplementationQueueWhenEnabled,
} from "./queue-admission.service";
import {
	isRunningRunStatus,
	isTerminalQueueStatus,
	recordQueueRecoveryEvidence,
} from "./queue-health.service";
import { prepareImplementationQueueRepository } from "./queue-repository-readiness.service";
import { isProcessorReleasedQueueStatus } from "./queue-repository-row-mapper";

export async function queueTask(
	id: string,
	options: QueueSideEffectOptions = {},
) {
	await createImplementationQueueEntry(id, options);
	const task = await nightworkersRepo.getTask(id);
	if (!task) throw new NotFoundError("Task not found");
	return task;
}

export async function updateImplementationQueueSettings(
	data: { processorCount: number },
	options: QueueSideEffectOptions = {},
) {
	const settings = await repo.updateImplementationQueueSettings(data);
	runImplementationQueueWhenEnabled(options);
	return { processorCount: settings.processorCount };
}

export async function getTodoWorkflowSettings() {
	return repo.getTodoWorkflowSettings();
}

export async function updateTodoWorkflowSettings(
	data: Parameters<typeof repo.updateTodoWorkflowSettings>[0],
) {
	return repo.updateTodoWorkflowSettings(data);
}

export async function createImplementationQueueEntry(
	taskId: string,
	options: QueueSideEffectOptions = {},
) {
	const task = await nightworkersRepo.getTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	if (["completed", "cancelled", "failed", "timed_out"].includes(task.status)) {
		throw new AppError(
			409,
			"TASK_TERMINAL",
			"Terminal sessions cannot enter the Implementation Queue.",
		);
	}
	let messages = await nightworkersRepo.listTaskMessages(taskId);
	assertTaskDraftComplete(task, messages);
	if (await repo.hasActiveImplementationQueueEntry(taskId)) {
		throw new AppError(
			409,
			"QUEUE_ENTRY_EXISTS",
			"This session already has an active Queue Entry.",
		);
	}
	if (
		!hasImplementationPlanEvidence(messages) &&
		!["ready", "queued"].includes(task.status)
	) {
		throw new AppError(
			422,
			"IMPLEMENTATION_PLAN_REQUIRED",
			"Create or mark an implementation plan before adding this session to the Queue.",
		);
	}
	messages = await ensureMissionProposalQueueApproval(
		taskId,
		messages,
		options,
	);
	assertMissionProposalQueueApproval(messages);
	const workspace = await prepareImplementationQueueRepository({
		task,
		messages,
	});
	const scheduling = resolveSchedulingDecisionFromMessages(messages);
	const queuedTask =
		task.status === "queued"
			? task
			: await nightworkersRepo.updateTask(taskId, { status: "queued" });
	if (!queuedTask) throw new NotFoundError("Task not found");
	const entry = await repo.createImplementationQueueEntry({
		taskId,
		repositoryId: queuedTask.repositoryId,
		priority: queuedTask.priority,
		executionType: scheduling.executionType,
		executionLockKey: `repository:${queuedTask.repositoryId}`,
		sequenceGroupId: scheduling.sequenceGroupId,
		sequenceOrder: scheduling.sequenceOrder,
		schedulingReason: scheduling.schedulingReason,
		workspaceId: workspace?.id ?? null,
		workspaceRequired: Boolean(workspace),
	});
	await nightworkersRepo.createTaskMessage({
		taskId,
		role: "system",
		content: "Implementation Queue entry created.",
		messageType: "text",
		payloadJson: {
			source: "implementation_queue",
			status: "queued",
			queueEntryId: entry.id,
		},
	});
	runImplementationQueueWhenEnabled(options);
	return entry;
}

export async function patchImplementationQueueEntry(
	id: string,
	input: {
		action?: "cancel" | "resume";
		priority?: number;
		queuePosition?: number | null;
	},
	options: QueueSideEffectOptions = {},
) {
	const entry = await repo.getImplementationQueueEntry(id);
	if (!entry) throw new NotFoundError("Queue Entry not found");
	if (input.action === "cancel") {
		const cancelled = await repo.updateImplementationQueueEntry(id, {
			status: "cancelled",
			statusReason: "Cancelled by user.",
			processorSlot: null,
			leaseOwnerId: null,
			leaseAcquiredAt: null,
			leaseExpiresAt: null,
			lastFailureKind: "manual_cancel",
		});
		const task = await nightworkersRepo.getTask(entry.taskId);
		if (task?.status === "queued") {
			await nightworkersRepo.updateTask(entry.taskId, { status: "ready" });
		}
		return cancelled;
	}
	if (input.action === "resume") {
		if (entry.status !== "needs_human") {
			throw new AppError(
				409,
				"QUEUE_ENTRY_NOT_RESUMABLE",
				"Only needs_human entries can resume.",
			);
		}
		const resumed = await repo.updateImplementationQueueEntry(id, {
			status: "processing",
			statusReason: null,
		});
		runImplementationQueueWhenEnabled(options);
		return resumed;
	}
	if (entry.status !== "queued") {
		throw new AppError(
			409,
			"QUEUE_ENTRY_NOT_REORDERABLE",
			"Only queued entries can be reordered.",
		);
	}
	return repo.updateImplementationQueueEntry(id, {
		priority: input.priority ?? entry.priority,
		queuePosition: input.queuePosition ?? entry.queuePosition,
	});
}

export async function archiveImplementationQueueEntry(
	id: string,
	options: QueueSideEffectOptions = {},
) {
	const entry = await repo.getImplementationQueueEntry(id);
	if (!entry) throw new NotFoundError("Queue Entry not found");
	if (!["execution_completed", "failed", "cancelled"].includes(entry.status)) {
		throw new AppError(
			409,
			"QUEUE_ENTRY_NOT_ARCHIVABLE",
			"Only completed Queue executions can archive.",
		);
	}
	const archived = await repo.updateImplementationQueueEntry(id, {
		status: "execution_archived",
		processorSlot: null,
		archivedAt: new Date(),
	});
	runImplementationQueueWhenEnabled(options);
	return archived;
}

export async function recoverImplementationQueueEntry(
	id: string,
	input: { action?: QueueRecoveryAction; note?: string } = {},
	options: QueueSideEffectOptions = {},
) {
	const entry = await repo.getImplementationQueueEntry(id);
	if (!entry) throw new NotFoundError("Queue Entry not found");
	const now = new Date();
	const run = entry.activeRunId
		? await nightworkersRepo.getTaskRun(entry.activeRunId)
		: null;

	if (input.action === "archive") {
		return archiveImplementationQueueEntry(id, options);
	}

	if (input.action === "cancel") {
		const cancelled = await patchImplementationQueueEntry(
			id,
			{ action: "cancel" },
			options,
		);
		await recordQueueRecoveryEvidence({
			taskId: entry.taskId,
			runId: entry.activeRunId,
			queueEntryId: entry.id,
			action: "cancel",
			reason: "manual_cancel",
			note: input.note,
		});
		return cancelled;
	}

	if (input.action === "complete") {
		if (!run || isRunningRunStatus(run.status)) {
			throw new AppError(
				409,
				"QUEUE_ENTRY_COMPLETION_UNSAFE",
				"Only entries with a terminal active run can be completed.",
			);
		}
		const completed = await repo.completeImplementationQueueEntryForRunId({
			runId: run.id,
			runStatus: run.status,
			now,
		});
		if (!completed) {
			if (isTerminalQueueStatus(entry.status)) return entry;
			throw new AppError(
				409,
				"QUEUE_ENTRY_COMPLETION_CONFLICT",
				"Queue Entry was not completed.",
			);
		}
		await recordQueueRecoveryEvidence({
			taskId: entry.taskId,
			runId: run.id,
			queueEntryId: entry.id,
			action: "complete",
			reason: "manual_complete",
			note: input.note,
		});
		if (isProcessorReleasedQueueStatus(completed.status)) {
			runImplementationQueueWhenEnabled(options);
		}
		return completed;
	}

	if (input.action === "retry") {
		if (run && isRunningRunStatus(run.status)) {
			throw new AppError(
				409,
				"QUEUE_ENTRY_RETRY_UNSAFE",
				"Running Queue Entries cannot be retried.",
			);
		}
		const retried = await repo.updateImplementationQueueEntry(id, {
			status: "queued",
			processorSlot: null,
			activeRunId: null,
			leaseOwnerId: null,
			leaseAcquiredAt: null,
			leaseExpiresAt: null,
			recoveredAt: now,
			recoveryReason: "manual_retry",
			lastFailureKind: null,
			statusReason: input.note?.trim() || null,
		});
		await recordQueueRecoveryEvidence({
			taskId: entry.taskId,
			runId: run?.id,
			queueEntryId: entry.id,
			action: "retry",
			reason: "manual_retry",
			note: input.note,
		});
		runImplementationQueueWhenEnabled(options);
		return retried;
	}

	if (input.action === "mark_needs_human") {
		const needsHuman = await repo.updateImplementationQueueEntry(id, {
			status: "needs_human",
			leaseOwnerId: null,
			leaseAcquiredAt: null,
			leaseExpiresAt: null,
			recoveredAt: now,
			recoveryReason: "manual_needs_human",
			lastFailureKind: "manual_needs_human",
			statusReason:
				input.note?.trim() || "Marked needs_human by Queue recovery.",
		});
		await recordQueueRecoveryEvidence({
			taskId: entry.taskId,
			runId: run?.id,
			queueEntryId: entry.id,
			action: "mark_needs_human",
			reason: "manual_needs_human",
			note: input.note,
		});
		return needsHuman;
	}

	throw new AppError(
		422,
		"QUEUE_RECOVERY_ACTION_INVALID",
		"Unsupported Queue recovery action.",
	);
}

export async function requeueImplementationQueueEntry(
	id: string,
	input: { note?: string } = {},
	options: QueueSideEffectOptions = {},
) {
	const entry = await repo.getImplementationQueueEntry(id);
	if (!entry) throw new NotFoundError("Queue Entry not found");
	if (
		["queued", "claimed", "processing", "awaiting_commit_decision"].includes(
			entry.status,
		)
	) {
		throw new AppError(
			409,
			"QUEUE_ENTRY_ALREADY_ACTIVE",
			"Active Queue Entries cannot be requeued.",
		);
	}
	const task = await nightworkersRepo.getTask(entry.taskId);
	if (!task) throw new NotFoundError("Task not found");
	if (task.status === "cancelled") {
		throw new AppError(
			409,
			"TASK_CANCELLED",
			"Cancelled sessions cannot be requeued.",
		);
	}

	if (entry.status !== "execution_archived") {
		await repo.updateImplementationQueueEntry(id, {
			status: "execution_archived",
			processorSlot: null,
			archivedAt: new Date(),
			statusReason: input.note?.trim() || entry.statusReason,
		});
	}

	const queuedTask =
		task.status === "queued"
			? task
			: await nightworkersRepo.updateTask(entry.taskId, { status: "queued" });
	if (!queuedTask) throw new NotFoundError("Task not found");
	const nextEntry = await repo.createImplementationQueueEntry({
		taskId: entry.taskId,
		repositoryId: entry.repositoryId,
		priority: entry.priority,
		queuePosition: entry.queuePosition,
	});
	await nightworkersRepo.createTaskMessage({
		taskId: entry.taskId,
		role: "system",
		content: "Implementation Queue entry requeued with preserved priority.",
		messageType: "text",
		payloadJson: {
			source: "implementation_queue",
			status: "requeued",
			previousQueueEntryId: entry.id,
			queueEntryId: nextEntry.id,
			priority: nextEntry.priority,
			queuePosition: nextEntry.queuePosition,
			note: input.note?.trim() || undefined,
		},
	});
	runImplementationQueueWhenEnabled(options);
	return nextEntry;
}
