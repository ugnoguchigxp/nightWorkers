import { getSessionQueueMaxConcurrencyFromEnv } from '../../../services/runtime-env';
import * as repo from '../nightworkers.repository';
import { startTaskRun } from './start-task-run';

function getSessionQueueMaxConcurrency() {
  return getSessionQueueMaxConcurrencyFromEnv();
}

export function shouldContinueSessionQueue(status: string) {
  return ['completed', 'cancelled', 'failed'].includes(status);
}

let implementationQueueDrainPromise: Promise<void> | null = null;
export const IMPLEMENTATION_QUEUE_LEASE_TTL_MS = 30 * 60 * 1000;
const IMPLEMENTATION_QUEUE_LEASE_OWNER_ID = `api-process:${process.pid}`;

export async function runImplementationQueue() {
  if (implementationQueueDrainPromise) {
    await implementationQueueDrainPromise;
    return [];
  }
  const started: Awaited<ReturnType<typeof startTaskRun>>[] = [];
  implementationQueueDrainPromise = drainImplementationQueue(started).finally(() => {
    implementationQueueDrainPromise = null;
  });
  await implementationQueueDrainPromise;
  return started;
}

async function drainImplementationQueue(started: Awaited<ReturnType<typeof startTaskRun>>[]) {
  while (true) {
    const settings = await repo.getImplementationQueueSettings();
    const claimed = await repo.claimNextImplementationQueueEntry({
      processorCount: settings.processorCount,
      leaseOwnerId: IMPLEMENTATION_QUEUE_LEASE_OWNER_ID,
      leaseTtlMs: IMPLEMENTATION_QUEUE_LEASE_TTL_MS,
      allowExpiredClaimRecovery: false,
    });
    if (claimed.kind !== 'claimed') break;
    const claimedEntry = claimed.entry;
    try {
      const run = await startTaskRun(claimedEntry.taskId, {
        executionMode: 'implementation',
        executionModeSource: 'implementation_queue',
      });
      started.push(run);
      const processingEntry = await repo.markImplementationQueueEntryProcessing({
        entryId: claimedEntry.id,
        runId: run.id,
        leaseOwnerId: IMPLEMENTATION_QUEUE_LEASE_OWNER_ID,
        leaseVersion: claimedEntry.leaseVersion,
        leaseTtlMs: IMPLEMENTATION_QUEUE_LEASE_TTL_MS,
      });
      if (!processingEntry) {
        await repo.updateTaskRun(run.id, {
          status: 'needs_human',
          endedAt: new Date(),
          finishedAt: new Date(),
          finalReport: 'Implementation Queue lease changed before run ownership was recorded.',
        });
        await repo.createRunEvent({
          version: 1,
          runId: run.id,
          taskId: claimedEntry.taskId,
          timestamp: new Date().toISOString(),
          type: 'system.warning',
          severity: 'warning',
          actor: 'system',
          message: 'Implementation Queue lease changed before run ownership was recorded.',
          data: {
            source: 'implementation_queue',
            queueEntryId: claimedEntry.id,
            leaseOwnerId: IMPLEMENTATION_QUEUE_LEASE_OWNER_ID,
            leaseVersion: claimedEntry.leaseVersion,
          },
        });
        await repo.createTaskMessage({
          taskId: claimedEntry.taskId,
          runId: run.id,
          role: 'system',
          content: 'Implementation Queue could not attach the run because the lease changed.',
          messageType: 'text',
          payloadJson: {
            source: 'implementation_queue',
            status: 'lease_conflict',
            queueEntryId: claimedEntry.id,
            runId: run.id,
          },
        });
        continue;
      }
      await repo.createTaskMessage({
        taskId: claimedEntry.taskId,
        runId: run.id,
        role: 'system',
        content: `Implementation Queue processor ${processingEntry.processorSlot ?? 1} started this run.`,
        messageType: 'text',
        payloadJson: {
          source: 'implementation_queue',
          status: 'processing',
          queueEntryId: claimedEntry.id,
          processorSlot: processingEntry.processorSlot,
          leaseOwnerId: processingEntry.leaseOwnerId,
          leaseVersion: processingEntry.leaseVersion,
        },
      });
    } catch (err) {
      await repo.updateImplementationQueueEntry(claimedEntry.id, {
        status: 'failed',
        processorSlot: null,
        leaseOwnerId: null,
        leaseExpiresAt: null,
        lastFailureKind: 'start_task_run_failed',
        statusReason: err instanceof Error ? err.message : String(err),
      });
      await repo.createTaskMessage({
        taskId: claimedEntry.taskId,
        role: 'system',
        content: `Implementation Queue failed to start this task: ${
          err instanceof Error ? err.message : String(err)
        }`,
        messageType: 'text',
        payloadJson: {
          source: 'implementation_queue',
          status: 'failed_to_start',
          queueEntryId: claimedEntry.id,
        },
      });
      break;
    }
  }
}

export async function completeImplementationQueueEntryForRun(runId: string, status: string) {
  try {
    const entry = await repo.getImplementationQueueEntryForRun(runId);
    if (!entry) return;
    const completed = await repo.completeImplementationQueueEntryForRunId({
      runId,
      runStatus: status,
    });
    const finalStatus = completed?.status ?? entry.status;
    if (['execution_completed', 'cancelled', 'failed'].includes(finalStatus)) {
      void runImplementationQueue();
    }
  } catch {
    // Queue bookkeeping must not change the run outcome.
  }
}

export async function archiveImplementationQueueEntryForRun(runId: string) {
  try {
    const entry = await repo.getImplementationQueueEntryForRun(runId);
    if (!entry || !['execution_completed', 'failed', 'cancelled'].includes(entry.status)) return;
    await repo.updateImplementationQueueEntry(entry.id, {
      status: 'execution_archived',
      processorSlot: null,
      archivedAt: new Date(),
    });
  } catch {
    // Queue archive bookkeeping must not change the review outcome.
  }
}

const pendingSessionQueueRepositoryIds = new Set<string>();
let sessionQueueDrainPromise: Promise<void> | null = null;

export async function runSessionQueueForRepository(repositoryId: string) {
  const started: Awaited<ReturnType<typeof startTaskRun>>[] = [];
  pendingSessionQueueRepositoryIds.add(repositoryId);
  if (sessionQueueDrainPromise) {
    await sessionQueueDrainPromise;
    return started;
  }

  sessionQueueDrainPromise = drainPendingSessionQueues(started).finally(() => {
    sessionQueueDrainPromise = null;
  });
  await sessionQueueDrainPromise;
  return started;
}

async function drainPendingSessionQueues(started: Awaited<ReturnType<typeof startTaskRun>>[]) {
  while (pendingSessionQueueRepositoryIds.size > 0) {
    const repositoryIds = [...pendingSessionQueueRepositoryIds];
    pendingSessionQueueRepositoryIds.clear();
    for (const repositoryId of repositoryIds) {
      started.push(...(await drainSessionQueueForRepository(repositoryId)));
    }
  }
}

async function drainSessionQueueForRepository(repositoryId: string) {
  const repository = await repo.getRepository(repositoryId);
  if (!repository?.queueEnabled) return [];

  const started: Awaited<ReturnType<typeof startTaskRun>>[] = [];
  while (true) {
    const globalActive = await repo.countActiveTaskRuns();
    const globalLimit = getSessionQueueMaxConcurrency();
    if (globalActive >= globalLimit) break;

    const projectActive = await repo.countActiveTaskRuns(repositoryId);
    const projectLimit = Math.max(1, Math.floor(repository.maxConcurrentSessions || 1));
    if (projectActive >= projectLimit) break;

    const nextTask = await repo.claimNextQueuedTask(repositoryId);
    if (!nextTask) break;

    try {
      const run = await startTaskRun(nextTask.id, {
        executionMode: 'implementation',
        executionModeSource: 'session_queue',
      });
      started.push(run);
    } catch (err) {
      await repo.updateTaskStatus(nextTask.id, 'failed');
      await repo.createTaskMessage({
        taskId: nextTask.id,
        role: 'system',
        content: `Session queue failed to start this task: ${err instanceof Error ? err.message : String(err)}`,
        messageType: 'text',
        payloadJson: { source: 'session_queue', status: 'failed_to_start' },
      });
      break;
    }
  }
  return started;
}
