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
