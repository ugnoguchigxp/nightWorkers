import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  implementationQueueEntries,
  implementationQueueSettings,
  repositories,
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
  }
) {
  const [entry] = await db
    .update(implementationQueueEntries)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(implementationQueueEntries.id, id))
    .returning();
  return entry;
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

export async function claimNextImplementationQueueEntry(processorCount: number) {
  const occupied = await listOccupiedImplementationQueueEntries();
  if (occupied.length >= processorCount) return null;
  const occupiedSlots = new Set(occupied.map((entry) => entry.processorSlot).filter(Boolean));
  const processorSlot =
    Array.from({ length: processorCount }, (_value, index) => index + 1).find(
      (slot) => !occupiedSlots.has(slot)
    ) ?? 1;

  const [candidate] = await db
    .select()
    .from(implementationQueueEntries)
    .where(eq(implementationQueueEntries.status, 'queued'))
    .orderBy(
      desc(implementationQueueEntries.priority),
      asc(implementationQueueEntries.queuePosition),
      asc(implementationQueueEntries.createdAt)
    )
    .limit(1);
  if (!candidate) return null;

  const now = new Date();
  const [claimed] = await db
    .update(implementationQueueEntries)
    .set({
      status: 'claimed',
      processorSlot,
      claimedAt: now,
      lastHeartbeatAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(implementationQueueEntries.id, candidate.id),
        eq(implementationQueueEntries.status, 'queued')
      )
    )
    .returning();
  return claimed ?? null;
}
