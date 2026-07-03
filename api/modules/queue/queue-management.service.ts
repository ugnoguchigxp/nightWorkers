import { AppError, NotFoundError } from '../../lib/errors';
import { isAutoQueueDrainEnabled } from '../../services/runtime-env';
import {
  assertTaskDraftComplete,
  getTaskDraftMissingFields,
  hasImplementationPlanEvidence,
} from '../nightworkers/nightworkers.planning-helpers.service';
import * as nightworkersRepo from '../nightworkers/nightworkers.repository';
import * as repo from './queue.repository';
import { triggerConfiguredQueueDrain } from './queue-scheduler-port';

type QueueSideEffectOptions = {
  autoDrain?: boolean;
};

type QueueRecoveryAction = 'retry' | 'mark_needs_human' | 'cancel' | 'archive' | 'complete';
type QueueHealthClassification =
  | 'normal'
  | 'stale_claim'
  | 'stale_processing'
  | 'terminal_run_pending_completion'
  | 'orphaned_active_run'
  | 'needs_human'
  | 'failed';

const DEFAULT_STALE_PROCESSING_MS = 30 * 60 * 1000;
const DEFAULT_MAX_QUEUE_ATTEMPTS = 3;

function shouldAutoDrain(options: QueueSideEffectOptions = {}) {
  return options.autoDrain ?? isAutoQueueDrainEnabled();
}

export async function queueTask(id: string, options: QueueSideEffectOptions = {}) {
  await createImplementationQueueEntry(id, options);
  const task = await nightworkersRepo.getTask(id);
  if (!task) throw new NotFoundError('Task not found');
  return task;
}

export async function listImplementationQueueDashboard() {
  const [settings, rows, tasks, repositories, activeQueueEntries] = await Promise.all([
    repo.getImplementationQueueSettings(),
    repo.listImplementationQueueEntries(),
    nightworkersRepo.listTasks(),
    nightworkersRepo.listRepositories(),
    repo.listActiveImplementationQueueEntries(),
  ]);
  const entries = rows.map(({ entry, task, repository }) => ({ ...entry, task, repository }));
  const activeQueuedTaskIds = new Set(activeQueueEntries.map((entry) => entry.taskId));
  const repositoryById = new Map(repositories.map((repository) => [repository.id, repository]));
  const notQueued = [];
  for (const task of tasks) {
    if (activeQueuedTaskIds.has(task.id)) continue;
    if (['completed', 'cancelled', 'failed', 'timed_out'].includes(task.status)) continue;
    const messages = await nightworkersRepo.listTaskMessages(task.id);
    const hasPlanEvidence = hasImplementationPlanEvidence(messages);
    if (getTaskDraftMissingFields(task).length > 0 && !hasPlanEvidence) continue;
    if (!hasPlanEvidence && !['ready', 'queued'].includes(task.status)) continue;
    const repository = repositoryById.get(task.repositoryId);
    if (!repository) continue;
    notQueued.push({ task, repository });
  }
  const occupiedEntries = entries.filter((entry) =>
    ['claimed', 'processing', 'needs_human', 'awaiting_commit_decision'].includes(entry.status)
  );
  const processors = Array.from({ length: settings.processorCount }, (_value, index) => {
    const slot = index + 1;
    return {
      slot,
      entry: occupiedEntries.find((entry) => entry.processorSlot === slot) || null,
    };
  });
  return {
    settings: { processorCount: settings.processorCount },
    processors,
    queued: entries.filter((entry) => entry.status === 'queued'),
    completed: entries.filter((entry) =>
      ['execution_completed', 'failed', 'cancelled'].includes(entry.status)
    ),
    notQueued,
  };
}

function isRunningRunStatus(status: string | null | undefined) {
  return Boolean(status && ['running', 'context_compiling', 'finalizing'].includes(status));
}

function isTerminalQueueStatus(status: string) {
  return [
    'execution_completed',
    'failed',
    'cancelled',
    'needs_human',
    'execution_archived',
  ].includes(status);
}

function recommendedActionForHealthItem(item: {
  classification: string;
  retryable: boolean;
  entry: { status: string };
  run: { status: string } | null;
}): 'none' | 'retry' | 'complete' | 'mark_needs_human' | 'archive' {
  if (item.classification === 'terminal_run_pending_completion') return 'complete';
  if (item.classification === 'stale_claim' || item.classification === 'orphaned_active_run') {
    return item.retryable ? 'retry' : 'mark_needs_human';
  }
  if (item.classification === 'stale_processing') {
    if (item.run && !isRunningRunStatus(item.run.status)) return 'complete';
    return item.retryable && !item.run ? 'retry' : 'mark_needs_human';
  }
  if (['execution_completed', 'failed', 'cancelled'].includes(item.entry.status)) return 'archive';
  return 'none';
}

function healthClassification(item: {
  classification: string;
  entry: { status: string };
}): QueueHealthClassification {
  if (item.entry.status === 'needs_human') return 'needs_human';
  if (item.entry.status === 'failed') return 'failed';
  return item.classification as QueueHealthClassification;
}

export async function listImplementationQueueHealth(
  options: { now?: Date; staleProcessingMs?: number; maxAttempts?: number } = {}
) {
  const snapshot = await repo.listImplementationQueueHealthSnapshot({
    now: options.now,
    staleProcessingMs: options.staleProcessingMs ?? DEFAULT_STALE_PROCESSING_MS,
    maxAttempts: options.maxAttempts ?? DEFAULT_MAX_QUEUE_ATTEMPTS,
  });
  const items = snapshot.items.map((item) => {
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
    };
  });
  return {
    generatedAt: snapshot.generatedAt,
    counts: {
      queued: snapshot.counts.queued,
      claimed: snapshot.counts.claimed,
      processing: snapshot.counts.processing,
      stale: snapshot.counts.staleClaimed + snapshot.counts.staleProcessing,
      retryable: items.filter((item) => item.recommendedAction === 'retry').length,
      needsHuman: items.filter((item) => item.classification === 'needs_human').length,
      orphaned: snapshot.counts.activeRunMissing,
      pendingCompletion: snapshot.counts.terminalRunWithActiveQueueEntry,
    },
    items,
  };
}

async function recordQueueRecoveryEvidence(input: {
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
    role: 'system',
    content: `Implementation Queue recovery: ${input.reason}.`,
    messageType: 'text',
    payloadJson: {
      source: 'implementation_queue',
      status: 'recovery',
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
    type: 'run.recovered',
    severity: 'warning',
    actor: 'system',
    message: `Implementation Queue recovery: ${input.reason}.`,
    data: {
      source: 'implementation_queue',
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
  } = {}
) {
  const now = options.now ?? new Date();
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_QUEUE_ATTEMPTS;
  const snapshot = await repo.listImplementationQueueHealthSnapshot({
    now,
    staleProcessingMs: options.staleProcessingMs ?? DEFAULT_STALE_PROCESSING_MS,
    maxAttempts,
  });
  if (!options.apply) {
    return { applied: false, actions: [], health: await listImplementationQueueHealth(options) };
  }

  const actions: Array<{ entryId: string; action: string; status: string }> = [];
  for (const item of snapshot.items) {
    const entry = item.entry;
    if (entry.status === 'awaiting_commit_decision') continue;
    if (item.classification === 'terminal_run_pending_completion' && item.run) {
      const completed = await repo.completeImplementationQueueEntryForRunId({
        runId: item.run.id,
        runStatus: item.run.status,
        now,
      });
      if (completed) {
        actions.push({ entryId: entry.id, action: 'complete', status: completed.status });
        await recordQueueRecoveryEvidence({
          taskId: entry.taskId,
          runId: item.run.id,
          queueEntryId: entry.id,
          action: 'complete',
          reason: 'terminal_run_missing_queue_completion',
        });
      }
      continue;
    }
    if (item.classification === 'stale_claim') {
      const retryable = entry.attemptCount < maxAttempts;
      const updated = await repo.recoverImplementationQueueEntryFromSnapshot(
        entry.id,
        { status: entry.status, leaseVersion: entry.leaseVersion },
        {
          status: retryable ? 'queued' : 'needs_human',
          processorSlot: retryable ? null : entry.processorSlot,
          leaseOwnerId: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          recoveredAt: now,
          recoveryReason: 'lease_expired_before_run_start',
          lastFailureKind: 'lease_expired_before_run_start',
          statusReason: retryable ? null : 'Queue claim lease expired before run start.',
        }
      );
      if (updated) {
        actions.push({
          entryId: entry.id,
          action: retryable ? 'retry' : 'needs_human',
          status: updated.status,
        });
        await recordQueueRecoveryEvidence({
          taskId: entry.taskId,
          queueEntryId: entry.id,
          action: retryable ? 'retry' : 'mark_needs_human',
          reason: 'lease_expired_before_run_start',
        });
      }
      continue;
    }
    if (
      item.classification === 'orphaned_active_run' ||
      item.classification === 'stale_processing'
    ) {
      const activeRunIsTerminal = item.run && !isRunningRunStatus(item.run.status);
      if (activeRunIsTerminal && item.run) {
        const completed = await repo.completeImplementationQueueEntryForRunId({
          runId: item.run.id,
          runStatus: item.run.status,
          now,
        });
        if (completed) {
          actions.push({ entryId: entry.id, action: 'complete', status: completed.status });
          await recordQueueRecoveryEvidence({
            taskId: entry.taskId,
            runId: item.run.id,
            queueEntryId: entry.id,
            action: 'complete',
            reason:
              item.classification === 'orphaned_active_run'
                ? 'active_run_not_found'
                : 'heartbeat_stale_processing',
          });
        }
        continue;
      }
      const canRetry =
        (item.classification === 'orphaned_active_run' ||
          (item.classification === 'stale_processing' && !entry.activeRunId && !item.run)) &&
        entry.attemptCount < maxAttempts;
      const updated = await repo.recoverImplementationQueueEntryFromSnapshot(
        entry.id,
        { status: entry.status, leaseVersion: entry.leaseVersion },
        {
          status: canRetry ? 'queued' : 'needs_human',
          processorSlot: canRetry ? null : entry.processorSlot,
          activeRunId: canRetry ? null : entry.activeRunId,
          leaseOwnerId: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          recoveredAt: now,
          recoveryReason:
            item.classification === 'orphaned_active_run'
              ? 'active_run_not_found'
              : 'heartbeat_stale_processing',
          lastFailureKind:
            item.classification === 'orphaned_active_run'
              ? 'active_run_not_found'
              : 'heartbeat_stale_processing',
          statusReason: canRetry
            ? null
            : 'Queue processing heartbeat is stale or run state is unsafe.',
        }
      );
      if (updated) {
        actions.push({
          entryId: entry.id,
          action: canRetry ? 'retry' : 'needs_human',
          status: updated.status,
        });
        await recordQueueRecoveryEvidence({
          taskId: entry.taskId,
          runId: item.run?.id,
          queueEntryId: entry.id,
          action: canRetry ? 'retry' : 'mark_needs_human',
          reason:
            item.classification === 'orphaned_active_run'
              ? 'active_run_not_found'
              : 'heartbeat_stale_processing',
        });
      }
    }
  }
  if (actions.some((action) => action.action === 'retry')) {
    runImplementationQueueWhenEnabled();
  }
  return { applied: true, actions, health: await listImplementationQueueHealth(options) };
}

export async function updateImplementationQueueSettings(
  data: { processorCount: number },
  options: QueueSideEffectOptions = {}
) {
  const settings = await repo.updateImplementationQueueSettings(data);
  runImplementationQueueWhenEnabled(options);
  return { processorCount: settings.processorCount };
}

export async function getTodoWorkflowSettings() {
  return repo.getTodoWorkflowSettings();
}

export async function updateTodoWorkflowSettings(
  data: Parameters<typeof repo.updateTodoWorkflowSettings>[0]
) {
  return repo.updateTodoWorkflowSettings(data);
}

export async function createImplementationQueueEntry(
  taskId: string,
  options: QueueSideEffectOptions = {}
) {
  const task = await nightworkersRepo.getTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  if (['completed', 'cancelled', 'failed', 'timed_out'].includes(task.status)) {
    throw new AppError(
      409,
      'TASK_TERMINAL',
      'Terminal sessions cannot enter the Implementation Queue.'
    );
  }
  const messages = await nightworkersRepo.listTaskMessages(taskId);
  assertTaskDraftComplete(task, messages);
  if (await repo.hasActiveImplementationQueueEntry(taskId)) {
    throw new AppError(
      409,
      'QUEUE_ENTRY_EXISTS',
      'This session already has an active Queue Entry.'
    );
  }
  if (!hasImplementationPlanEvidence(messages) && !['ready', 'queued'].includes(task.status)) {
    throw new AppError(
      422,
      'IMPLEMENTATION_PLAN_REQUIRED',
      'Create or mark an implementation plan before adding this session to the Queue.'
    );
  }
  const queuedTask =
    task.status === 'queued'
      ? task
      : await nightworkersRepo.updateTask(taskId, { status: 'queued' });
  if (!queuedTask) throw new NotFoundError('Task not found');
  const entry = await repo.createImplementationQueueEntry({
    taskId,
    repositoryId: queuedTask.repositoryId,
    priority: queuedTask.priority,
  });
  await nightworkersRepo.createTaskMessage({
    taskId,
    role: 'system',
    content: 'Implementation Queue entry created.',
    messageType: 'text',
    payloadJson: { source: 'implementation_queue', status: 'queued', queueEntryId: entry.id },
  });
  runImplementationQueueWhenEnabled(options);
  return entry;
}

export async function patchImplementationQueueEntry(
  id: string,
  input: { action?: 'cancel' | 'resume'; priority?: number; queuePosition?: number | null },
  options: QueueSideEffectOptions = {}
) {
  const entry = await repo.getImplementationQueueEntry(id);
  if (!entry) throw new NotFoundError('Queue Entry not found');
  if (input.action === 'cancel') {
    const cancelled = await repo.updateImplementationQueueEntry(id, {
      status: 'cancelled',
      statusReason: 'Cancelled by user.',
      processorSlot: null,
      leaseOwnerId: null,
      leaseAcquiredAt: null,
      leaseExpiresAt: null,
      lastFailureKind: 'manual_cancel',
    });
    const task = await nightworkersRepo.getTask(entry.taskId);
    if (task?.status === 'queued') {
      await nightworkersRepo.updateTask(entry.taskId, { status: 'ready' });
    }
    return cancelled;
  }
  if (input.action === 'resume') {
    if (entry.status !== 'needs_human') {
      throw new AppError(409, 'QUEUE_ENTRY_NOT_RESUMABLE', 'Only needs_human entries can resume.');
    }
    const resumed = await repo.updateImplementationQueueEntry(id, {
      status: 'processing',
      statusReason: null,
    });
    runImplementationQueueWhenEnabled(options);
    return resumed;
  }
  if (entry.status !== 'queued') {
    throw new AppError(409, 'QUEUE_ENTRY_NOT_REORDERABLE', 'Only queued entries can be reordered.');
  }
  return repo.updateImplementationQueueEntry(id, {
    priority: input.priority ?? entry.priority,
    queuePosition: input.queuePosition ?? entry.queuePosition,
  });
}

export async function archiveImplementationQueueEntry(
  id: string,
  options: QueueSideEffectOptions = {}
) {
  const entry = await repo.getImplementationQueueEntry(id);
  if (!entry) throw new NotFoundError('Queue Entry not found');
  if (!['execution_completed', 'failed', 'cancelled'].includes(entry.status)) {
    throw new AppError(
      409,
      'QUEUE_ENTRY_NOT_ARCHIVABLE',
      'Only completed Queue executions can archive.'
    );
  }
  const archived = await repo.updateImplementationQueueEntry(id, {
    status: 'execution_archived',
    processorSlot: null,
    archivedAt: new Date(),
  });
  runImplementationQueueWhenEnabled(options);
  return archived;
}

export async function recoverImplementationQueueEntry(
  id: string,
  input: { action?: QueueRecoveryAction; note?: string } = {},
  options: QueueSideEffectOptions = {}
) {
  const entry = await repo.getImplementationQueueEntry(id);
  if (!entry) throw new NotFoundError('Queue Entry not found');
  const now = new Date();
  const run = entry.activeRunId ? await nightworkersRepo.getTaskRun(entry.activeRunId) : null;

  if (input.action === 'archive') {
    return archiveImplementationQueueEntry(id, options);
  }

  if (input.action === 'cancel') {
    const cancelled = await patchImplementationQueueEntry(id, { action: 'cancel' }, options);
    await recordQueueRecoveryEvidence({
      taskId: entry.taskId,
      runId: entry.activeRunId,
      queueEntryId: entry.id,
      action: 'cancel',
      reason: 'manual_cancel',
      note: input.note,
    });
    return cancelled;
  }

  if (input.action === 'complete') {
    if (!run || isRunningRunStatus(run.status)) {
      throw new AppError(
        409,
        'QUEUE_ENTRY_COMPLETION_UNSAFE',
        'Only entries with a terminal active run can be completed.'
      );
    }
    const completed = await repo.completeImplementationQueueEntryForRunId({
      runId: run.id,
      runStatus: run.status,
      now,
    });
    if (!completed) {
      if (isTerminalQueueStatus(entry.status)) return entry;
      throw new AppError(409, 'QUEUE_ENTRY_COMPLETION_CONFLICT', 'Queue Entry was not completed.');
    }
    await recordQueueRecoveryEvidence({
      taskId: entry.taskId,
      runId: run.id,
      queueEntryId: entry.id,
      action: 'complete',
      reason: 'manual_complete',
      note: input.note,
    });
    if (['execution_completed', 'cancelled', 'failed'].includes(completed.status)) {
      runImplementationQueueWhenEnabled(options);
    }
    return completed;
  }

  if (input.action === 'retry') {
    if (run && isRunningRunStatus(run.status)) {
      throw new AppError(
        409,
        'QUEUE_ENTRY_RETRY_UNSAFE',
        'Running Queue Entries cannot be retried.'
      );
    }
    const retried = await repo.updateImplementationQueueEntry(id, {
      status: 'queued',
      processorSlot: null,
      activeRunId: null,
      leaseOwnerId: null,
      leaseAcquiredAt: null,
      leaseExpiresAt: null,
      recoveredAt: now,
      recoveryReason: 'manual_retry',
      lastFailureKind: null,
      statusReason: input.note?.trim() || null,
    });
    await recordQueueRecoveryEvidence({
      taskId: entry.taskId,
      runId: run?.id,
      queueEntryId: entry.id,
      action: 'retry',
      reason: 'manual_retry',
      note: input.note,
    });
    runImplementationQueueWhenEnabled(options);
    return retried;
  }

  if (input.action === 'mark_needs_human') {
    const needsHuman = await repo.updateImplementationQueueEntry(id, {
      status: 'needs_human',
      leaseOwnerId: null,
      leaseAcquiredAt: null,
      leaseExpiresAt: null,
      recoveredAt: now,
      recoveryReason: 'manual_needs_human',
      lastFailureKind: 'manual_needs_human',
      statusReason: input.note?.trim() || 'Marked needs_human by Queue recovery.',
    });
    await recordQueueRecoveryEvidence({
      taskId: entry.taskId,
      runId: run?.id,
      queueEntryId: entry.id,
      action: 'mark_needs_human',
      reason: 'manual_needs_human',
      note: input.note,
    });
    return needsHuman;
  }

  throw new AppError(422, 'QUEUE_RECOVERY_ACTION_INVALID', 'Unsupported Queue recovery action.');
}

export async function requeueImplementationQueueEntry(
  id: string,
  input: { note?: string } = {},
  options: QueueSideEffectOptions = {}
) {
  const entry = await repo.getImplementationQueueEntry(id);
  if (!entry) throw new NotFoundError('Queue Entry not found');
  if (['queued', 'claimed', 'processing', 'awaiting_commit_decision'].includes(entry.status)) {
    throw new AppError(
      409,
      'QUEUE_ENTRY_ALREADY_ACTIVE',
      'Active Queue Entries cannot be requeued.'
    );
  }
  const task = await nightworkersRepo.getTask(entry.taskId);
  if (!task) throw new NotFoundError('Task not found');
  if (task.status === 'cancelled') {
    throw new AppError(409, 'TASK_CANCELLED', 'Cancelled sessions cannot be requeued.');
  }

  if (entry.status !== 'execution_archived') {
    await repo.updateImplementationQueueEntry(id, {
      status: 'execution_archived',
      processorSlot: null,
      archivedAt: new Date(),
      statusReason: input.note?.trim() || entry.statusReason,
    });
  }

  const queuedTask =
    task.status === 'queued'
      ? task
      : await nightworkersRepo.updateTask(entry.taskId, { status: 'queued' });
  if (!queuedTask) throw new NotFoundError('Task not found');
  const nextEntry = await repo.createImplementationQueueEntry({
    taskId: entry.taskId,
    repositoryId: entry.repositoryId,
    priority: entry.priority,
    queuePosition: entry.queuePosition,
  });
  await nightworkersRepo.createTaskMessage({
    taskId: entry.taskId,
    role: 'system',
    content: 'Implementation Queue entry requeued with preserved priority.',
    messageType: 'text',
    payloadJson: {
      source: 'implementation_queue',
      status: 'requeued',
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

function runImplementationQueueWhenEnabled(options: QueueSideEffectOptions = {}) {
  if (!shouldAutoDrain(options)) return;
  triggerConfiguredQueueDrain();
}
