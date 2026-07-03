import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  implementationQueueEntries,
  implementationQueueSettings,
  repositories,
  taskRuns,
  tasks,
  todoWorkflowSettings,
} from '../../db/schema';

const ACTIVE_IMPLEMENTATION_QUEUE_STATUSES = [
  'queued',
  'claimed',
  'processing',
  'needs_human',
  'awaiting_commit_decision',
  'execution_completed',
  'failed',
  'cancelled',
] as const;
const OCCUPIED_PROCESSOR_STATUSES = [
  'claimed',
  'processing',
  'needs_human',
  'awaiting_commit_decision',
] as const;
type ImplementationQueueEntryStatus =
  | 'queued'
  | 'claimed'
  | 'processing'
  | 'needs_human'
  | 'awaiting_commit_decision'
  | 'execution_completed'
  | 'execution_archived'
  | 'failed'
  | 'cancelled';

type ClaimNextImplementationQueueEntryInput = {
  processorCount: number;
  leaseOwnerId: string;
  leaseTtlMs: number;
  now?: Date;
  allowExpiredClaimRecovery?: boolean;
};

const RUNNING_TASK_RUN_STATUSES = ['running', 'context_compiling', 'finalizing'] as const;
const QUEUE_COMPLETION_SOURCE_STATUSES = [
  'claimed',
  'processing',
  'awaiting_commit_decision',
] as const;

function isRunningTaskRunStatus(status: string | null | undefined) {
  return Boolean(status && (RUNNING_TASK_RUN_STATUSES as readonly string[]).includes(status));
}

function queueStatusForRunStatus(status: string): ImplementationQueueEntryStatus {
  if (status === 'completed') return 'execution_completed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'needs_human') return 'needs_human';
  return 'failed';
}

export async function getImplementationQueueSettings() {
  const [settings] = await db
    .select()
    .from(implementationQueueSettings)
    .where(eq(implementationQueueSettings.id, 'global'));
  if (settings) return settings;
  const now = new Date();
  const [created] = await db
    .insert(implementationQueueSettings)
    .values({ id: 'global', processorCount: 1, createdAt: now, updatedAt: now })
    .returning();
  return created;
}

export async function updateImplementationQueueSettings(data: { processorCount: number }) {
  const now = new Date();
  const processorCount = Math.min(3, Math.max(1, Math.floor(data.processorCount)));
  const [settings] = await db
    .insert(implementationQueueSettings)
    .values({ id: 'global', processorCount, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: implementationQueueSettings.id,
      set: { processorCount, updatedAt: now },
    })
    .returning();
  return settings;
}

export async function getTodoWorkflowSettings() {
  const [settings] = await db
    .select()
    .from(todoWorkflowSettings)
    .where(eq(todoWorkflowSettings.id, 'global'));
  if (settings) return settings;
  const now = new Date();
  const [created] = await db
    .insert(todoWorkflowSettings)
    .values({ id: 'global', createdAt: now, updatedAt: now })
    .returning();
  return created;
}

export async function updateTodoWorkflowSettings(data: {
  requirePerTodoReview?: boolean;
  requirePerTodoFix?: boolean;
  requireFinalVerification?: boolean;
  requireRegisterCandidatePrompt?: boolean;
  askCommitOnCompletion?: boolean;
  hookPolicyJson?: unknown;
}) {
  const current = await getTodoWorkflowSettings();
  const now = new Date();
  const [settings] = await db
    .update(todoWorkflowSettings)
    .set({
      requirePerTodoReview: data.requirePerTodoReview ?? current.requirePerTodoReview,
      requirePerTodoFix: data.requirePerTodoFix ?? current.requirePerTodoFix,
      requireFinalVerification: data.requireFinalVerification ?? current.requireFinalVerification,
      requireRegisterCandidatePrompt:
        data.requireRegisterCandidatePrompt ?? current.requireRegisterCandidatePrompt,
      askCommitOnCompletion: data.askCommitOnCompletion ?? current.askCommitOnCompletion,
      hookPolicyJson: data.hookPolicyJson ?? current.hookPolicyJson,
      updatedAt: now,
    })
    .where(eq(todoWorkflowSettings.id, 'global'))
    .returning();
  return settings;
}

export async function listImplementationQueueEntries() {
  return db
    .select({
      entry: implementationQueueEntries,
      task: tasks,
      repository: repositories,
    })
    .from(implementationQueueEntries)
    .innerJoin(tasks, eq(implementationQueueEntries.taskId, tasks.id))
    .innerJoin(repositories, eq(implementationQueueEntries.repositoryId, repositories.id))
    .orderBy(
      desc(implementationQueueEntries.priority),
      asc(implementationQueueEntries.queuePosition),
      asc(implementationQueueEntries.createdAt)
    );
}

export async function listActiveImplementationQueueEntries() {
  return db
    .select()
    .from(implementationQueueEntries)
    .where(inArray(implementationQueueEntries.status, [...ACTIVE_IMPLEMENTATION_QUEUE_STATUSES]));
}

export async function listOccupiedImplementationQueueEntries() {
  return db
    .select()
    .from(implementationQueueEntries)
    .where(inArray(implementationQueueEntries.status, [...OCCUPIED_PROCESSOR_STATUSES]));
}

export async function listPlanReadyTasksWithoutActiveQueueEntry() {
  const rows = await db
    .select({
      task: tasks,
      repository: repositories,
      activeQueueEntryId: implementationQueueEntries.id,
    })
    .from(tasks)
    .innerJoin(repositories, eq(tasks.repositoryId, repositories.id))
    .leftJoin(
      implementationQueueEntries,
      and(
        eq(implementationQueueEntries.taskId, tasks.id),
        inArray(implementationQueueEntries.status, [...ACTIVE_IMPLEMENTATION_QUEUE_STATUSES])
      )
    )
    .where(
      and(inArray(tasks.status, ['ready', 'queued']), sql`${implementationQueueEntries.id} is null`)
    )
    .orderBy(desc(tasks.priority), desc(tasks.updatedAt));
  return rows.map(({ activeQueueEntryId: _activeQueueEntryId, ...row }) => row);
}

export async function hasActiveImplementationQueueEntry(taskId: string) {
  const [entry] = await db
    .select()
    .from(implementationQueueEntries)
    .where(
      and(
        eq(implementationQueueEntries.taskId, taskId),
        inArray(implementationQueueEntries.status, [...ACTIVE_IMPLEMENTATION_QUEUE_STATUSES])
      )
    )
    .limit(1);
  return Boolean(entry);
}

export async function createImplementationQueueEntry(data: {
  taskId: string;
  repositoryId: string;
  priority?: number;
  queuePosition?: number | null;
}) {
  const now = new Date();
  const [entry] = await db
    .insert(implementationQueueEntries)
    .values({
      taskId: data.taskId,
      repositoryId: data.repositoryId,
      priority: data.priority ?? 0,
      queuePosition: data.queuePosition ?? null,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return entry;
}

export async function updateImplementationQueueEntry(
  id: string,
  data: {
    status?: ImplementationQueueEntryStatus;
    priority?: number;
    queuePosition?: number | null;
    processorSlot?: number | null;
    activeRunId?: string | null;
    claimedAt?: Date | null;
    lastHeartbeatAt?: Date | null;
    archivedAt?: Date | null;
    statusReason?: string | null;
    leaseOwnerId?: string | null;
    leaseAcquiredAt?: Date | null;
    leaseExpiresAt?: Date | null;
    leaseVersion?: number;
    attemptCount?: number;
    recoveredAt?: Date | null;
    recoveryReason?: string | null;
    lastFailureKind?: string | null;
  }
) {
  const [entry] = await db
    .update(implementationQueueEntries)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(implementationQueueEntries.id, id))
    .returning();
  return entry;
}

export async function recoverImplementationQueueEntryFromSnapshot(
  id: string,
  expected: { status: string; leaseVersion: number },
  data: {
    status?: ImplementationQueueEntryStatus;
    priority?: number;
    queuePosition?: number | null;
    processorSlot?: number | null;
    activeRunId?: string | null;
    claimedAt?: Date | null;
    lastHeartbeatAt?: Date | null;
    archivedAt?: Date | null;
    statusReason?: string | null;
    leaseOwnerId?: string | null;
    leaseAcquiredAt?: Date | null;
    leaseExpiresAt?: Date | null;
    leaseVersion?: number;
    attemptCount?: number;
    recoveredAt?: Date | null;
    recoveryReason?: string | null;
    lastFailureKind?: string | null;
  }
) {
  const [entry] = await db
    .update(implementationQueueEntries)
    .set({
      ...data,
      leaseVersion: sql`${implementationQueueEntries.leaseVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(implementationQueueEntries.id, id),
        eq(implementationQueueEntries.status, expected.status),
        eq(implementationQueueEntries.leaseVersion, expected.leaseVersion)
      )
    )
    .returning();
  return entry ?? null;
}

export async function getImplementationQueueEntry(id: string) {
  const [entry] = await db
    .select()
    .from(implementationQueueEntries)
    .where(eq(implementationQueueEntries.id, id));
  return entry;
}

export async function getImplementationQueueEntryForRun(runId: string) {
  const [entry] = await db
    .select()
    .from(implementationQueueEntries)
    .where(eq(implementationQueueEntries.activeRunId, runId));
  return entry;
}

export async function markImplementationQueueEntryProcessing(input: {
  entryId: string;
  runId: string;
  leaseOwnerId: string;
  leaseVersion: number;
  leaseTtlMs: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const [entry] = await db
    .update(implementationQueueEntries)
    .set({
      status: 'processing',
      activeRunId: input.runId,
      lastHeartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + input.leaseTtlMs),
      leaseVersion: sql`${implementationQueueEntries.leaseVersion} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(implementationQueueEntries.id, input.entryId),
        eq(implementationQueueEntries.status, 'claimed'),
        eq(implementationQueueEntries.leaseOwnerId, input.leaseOwnerId),
        eq(implementationQueueEntries.leaseVersion, input.leaseVersion)
      )
    )
    .returning();
  return entry ?? null;
}

export async function refreshImplementationQueueLease(input: {
  entryId: string;
  leaseOwnerId: string;
  leaseVersion: number;
  leaseTtlMs: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const [entry] = await db
    .update(implementationQueueEntries)
    .set({
      lastHeartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + input.leaseTtlMs),
      leaseVersion: sql`${implementationQueueEntries.leaseVersion} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(implementationQueueEntries.id, input.entryId),
        eq(implementationQueueEntries.leaseOwnerId, input.leaseOwnerId),
        eq(implementationQueueEntries.leaseVersion, input.leaseVersion),
        inArray(implementationQueueEntries.status, ['claimed', 'processing'])
      )
    )
    .returning();
  return entry ?? null;
}

export async function refreshImplementationQueueLeaseForRun(input: {
  runId: string;
  leaseTtlMs: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const [entry] = await db
    .update(implementationQueueEntries)
    .set({
      lastHeartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + input.leaseTtlMs),
      leaseVersion: sql`${implementationQueueEntries.leaseVersion} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(implementationQueueEntries.activeRunId, input.runId),
        eq(implementationQueueEntries.status, 'processing')
      )
    )
    .returning();
  return entry ?? null;
}

export async function completeImplementationQueueEntryForRunId(input: {
  runId: string;
  runStatus: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const nextStatus = queueStatusForRunStatus(input.runStatus);
  const [entry] = await db
    .update(implementationQueueEntries)
    .set({
      status: nextStatus,
      processorSlot: null,
      leaseOwnerId: null,
      leaseAcquiredAt: null,
      leaseExpiresAt: null,
      activeRunId: input.runId,
      lastHeartbeatAt: now,
      statusReason: nextStatus === 'failed' ? `Run finished with status=${input.runStatus}` : null,
      leaseVersion: sql`${implementationQueueEntries.leaseVersion} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(implementationQueueEntries.activeRunId, input.runId),
        inArray(implementationQueueEntries.status, [...QUEUE_COMPLETION_SOURCE_STATUSES])
      )
    )
    .returning();
  return entry ?? null;
}

export async function listImplementationQueueHealthSnapshot(
  options: {
    repositoryId?: string;
    now?: Date;
    staleProcessingMs?: number;
    maxAttempts?: number;
  } = {}
) {
  const now = options.now ?? new Date();
  const staleProcessingMs = options.staleProcessingMs ?? 30 * 60 * 1000;
  const staleProcessingBefore = new Date(now.getTime() - staleProcessingMs);
  const rows = await db
    .select({
      entry: implementationQueueEntries,
      run: taskRuns,
    })
    .from(implementationQueueEntries)
    .leftJoin(taskRuns, eq(implementationQueueEntries.activeRunId, taskRuns.id))
    .where(
      options.repositoryId
        ? eq(implementationQueueEntries.repositoryId, options.repositoryId)
        : undefined
    );

  const items = rows.map(({ entry, run }) => {
    const activeRunMissing = Boolean(entry.activeRunId && !run);
    const runIsTerminal = Boolean(run && !isRunningTaskRunStatus(run.status));
    const leaseExpired = Boolean(entry.leaseExpiresAt && entry.leaseExpiresAt < now);
    const heartbeatStale = Boolean(
      entry.lastHeartbeatAt && entry.lastHeartbeatAt < staleProcessingBefore
    );
    const retryable = options.maxAttempts === undefined || entry.attemptCount < options.maxAttempts;
    const classification = activeRunMissing
      ? 'orphaned_active_run'
      : runIsTerminal &&
          ['claimed', 'processing', 'awaiting_commit_decision'].includes(entry.status)
        ? 'terminal_run_pending_completion'
        : entry.status === 'claimed' && leaseExpired && !entry.activeRunId
          ? 'stale_claim'
          : entry.status === 'processing' && heartbeatStale
            ? 'stale_processing'
            : 'normal';
    return {
      entry,
      run,
      classification,
      retryable,
    };
  });

  return {
    generatedAt: now,
    counts: {
      queued: items.filter(({ entry }) => entry.status === 'queued').length,
      claimed: items.filter(({ entry }) => entry.status === 'claimed').length,
      processing: items.filter(({ entry }) => entry.status === 'processing').length,
      awaitingCommitDecision: items.filter(
        ({ entry }) => entry.status === 'awaiting_commit_decision'
      ).length,
      staleClaimed: items.filter(({ classification }) => classification === 'stale_claim').length,
      staleProcessing: items.filter(({ classification }) => classification === 'stale_processing')
        .length,
      activeRunMissing: items.filter(
        ({ classification }) => classification === 'orphaned_active_run'
      ).length,
      terminalRunWithActiveQueueEntry: items.filter(
        ({ classification }) => classification === 'terminal_run_pending_completion'
      ).length,
    },
    items,
  };
}

export async function claimNextImplementationQueueEntry(
  input: ClaimNextImplementationQueueEntryInput
) {
  const now = input.now ?? new Date();
  const processorCount = Math.max(1, Math.floor(input.processorCount));
  const leaseExpiresAt = new Date(now.getTime() + input.leaseTtlMs);
  const occupied = (await listOccupiedImplementationQueueEntries()).filter((entry) => {
    if (
      input.allowExpiredClaimRecovery &&
      entry.status === 'claimed' &&
      entry.leaseExpiresAt &&
      entry.leaseExpiresAt < now &&
      !entry.activeRunId
    ) {
      return false;
    }
    return true;
  });
  if (occupied.length >= processorCount) return null;
  const occupiedSlots = new Set(occupied.map((entry) => entry.processorSlot).filter(Boolean));
  const processorSlot =
    Array.from({ length: processorCount }, (_value, index) => index + 1).find(
      (slot) => !occupiedSlots.has(slot)
    ) ?? 1;

  const [candidate] = await db
    .select()
    .from(implementationQueueEntries)
    .where(
      input.allowExpiredClaimRecovery
        ? or(
            eq(implementationQueueEntries.status, 'queued'),
            and(
              eq(implementationQueueEntries.status, 'claimed'),
              lt(implementationQueueEntries.leaseExpiresAt, now),
              isNull(implementationQueueEntries.activeRunId)
            )
          )
        : eq(implementationQueueEntries.status, 'queued')
    )
    .orderBy(
      desc(implementationQueueEntries.priority),
      asc(implementationQueueEntries.queuePosition),
      asc(implementationQueueEntries.createdAt)
    )
    .limit(1);
  if (!candidate) return null;

  const isExpiredClaimRecovery = candidate.status === 'claimed';
  const claimPredicate = isExpiredClaimRecovery
    ? and(
        eq(implementationQueueEntries.id, candidate.id),
        eq(implementationQueueEntries.status, 'claimed'),
        eq(implementationQueueEntries.leaseVersion, candidate.leaseVersion),
        lt(implementationQueueEntries.leaseExpiresAt, now),
        isNull(implementationQueueEntries.activeRunId)
      )
    : and(
        eq(implementationQueueEntries.id, candidate.id),
        eq(implementationQueueEntries.status, 'queued')
      );
  const [claimed] = await db
    .update(implementationQueueEntries)
    .set({
      status: 'claimed',
      processorSlot,
      leaseOwnerId: input.leaseOwnerId,
      leaseAcquiredAt: now,
      leaseExpiresAt,
      leaseVersion: sql`${implementationQueueEntries.leaseVersion} + 1`,
      attemptCount: sql`${implementationQueueEntries.attemptCount} + 1`,
      claimedAt: now,
      lastHeartbeatAt: now,
      recoveredAt: isExpiredClaimRecovery ? now : candidate.recoveredAt,
      recoveryReason: isExpiredClaimRecovery
        ? 'lease_expired_before_run_start'
        : candidate.recoveryReason,
      updatedAt: now,
    })
    .where(claimPredicate)
    .returning();
  return claimed ?? null;
}
