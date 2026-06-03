import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  artifacts,
  blueprintArtifactAdoptions,
  blueprintDbDesignAdoptions,
  blueprintDesignSettings,
  blueprintDesignTokenAdoptions,
  repositories,
  taskEvents,
  taskMessages,
  taskRuns,
  taskRunTodos,
  tasks,
} from '../../db/schema';
import { nightWorkersRealtimeBroker } from '../../services/realtime/nightworkers-ws';
import { normalizeRunEventToLegacy } from '../../services/run-events/normalizer';
import type { RunEventBase } from '../../services/run-events/types';

// --- Repositories ---
export async function createRepository(data: {
  name: string;
  localPath: string;
  branch: string;
  allowed?: boolean;
  queueEnabled?: boolean;
  maxConcurrentSessions?: number;
  safetyPolicy?: any;
}) {
  const [repo] = await db.insert(repositories).values(data).returning();
  return repo;
}

export async function getRepository(id: string) {
  const [repo] = await db.select().from(repositories).where(eq(repositories.id, id));
  return repo;
}

export async function listRepositories() {
  return db.select().from(repositories).orderBy(desc(repositories.createdAt));
}

export async function updateRepository(
  id: string,
  data: {
    queueEnabled?: boolean;
    maxConcurrentSessions?: number;
  }
) {
  const [repo] = await db
    .update(repositories)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(repositories.id, id))
    .returning();
  return repo;
}

export async function deleteRepository(id: string) {
  const [repo] = await db.delete(repositories).where(eq(repositories.id, id)).returning();
  return repo;
}

// --- Tasks ---
export async function createTask(data: {
  repositoryId: string;
  title: string;
  description?: string | null;
  objective?: string | null;
  acceptanceCriteria?: string | null;
  status?: string;
  timeoutSeconds?: number;
  priority?: number;
  createdBy?: string | null;
}) {
  const [task] = await db.insert(tasks).values(data).returning();
  return task;
}

export async function getTask(id: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  return task;
}

export async function listTasks() {
  return db.select().from(tasks).orderBy(desc(tasks.createdAt));
}

export async function listTaskMessages(taskId: string) {
  return db
    .select()
    .from(taskMessages)
    .where(eq(taskMessages.taskId, taskId))
    .orderBy(taskMessages.createdAt);
}

export async function createTaskMessage(data: {
  taskId: string;
  runId?: string | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  messageType?: string | null;
  payloadJson?: any;
}) {
  const [message] = await db
    .insert(taskMessages)
    .values({
      taskId: data.taskId,
      runId: data.runId ?? null,
      role: data.role,
      content: data.content,
      messageType: data.messageType ?? null,
      metadataJson: data.payloadJson ?? null,
    })
    .returning();
  if (message) {
    nightWorkersRealtimeBroker.publish(data.taskId, {
      type: 'task_message_created',
      runId: data.runId ?? undefined,
      payload: { message },
    });
  }
  return message;
}

export async function getTaskMessage(id: string) {
  const [message] = await db.select().from(taskMessages).where(eq(taskMessages.id, id));
  return message;
}

export async function updateTaskStatus(id: string, status: string) {
  const [task] = await db
    .update(tasks)
    .set({ status, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();
  if (task) {
    nightWorkersRealtimeBroker.publish(task.id, {
      type: 'task_status_updated',
      payload: { status: task.status, task },
    });
  }
  return task;
}

export async function updateTaskCompiledPrompt(id: string, compiledPrompt: string) {
  const [task] = await db
    .update(tasks)
    .set({ compiledPrompt, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();
  return task;
}

export async function updateTask(
  id: string,
  data: {
    title?: string;
    description?: string | null;
    objective?: string | null;
    acceptanceCriteria?: string | null;
    status?: string;
    priority?: number;
  }
) {
  const [task] = await db
    .update(tasks)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();
  return task;
}

export async function deleteTask(id: string) {
  const [task] = await db.delete(tasks).where(eq(tasks.id, id)).returning();
  return task;
}

export async function getBlueprintDesignSettings(taskId: string) {
  const [settings] = await db
    .select()
    .from(blueprintDesignSettings)
    .where(eq(blueprintDesignSettings.taskId, taskId));
  return settings;
}

export async function upsertBlueprintDesignSettings(taskId: string, settingsJson: any) {
  const now = new Date();
  const [settings] = await db
    .insert(blueprintDesignSettings)
    .values({
      taskId,
      settingsJson,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: blueprintDesignSettings.taskId,
      set: {
        settingsJson,
        updatedAt: now,
      },
    })
    .returning();
  return settings;
}

export async function getBlueprintArtifactAdoption(taskId: string, messageId: string) {
  const [adoption] = await db
    .select()
    .from(blueprintArtifactAdoptions)
    .where(
      and(
        eq(blueprintArtifactAdoptions.taskId, taskId),
        eq(blueprintArtifactAdoptions.messageId, messageId)
      )
    );
  return adoption;
}

export async function upsertBlueprintArtifactAdoption(
  taskId: string,
  messageId: string,
  adopted: boolean
) {
  const now = new Date();
  const [adoption] = await db
    .insert(blueprintArtifactAdoptions)
    .values({
      taskId,
      messageId,
      adopted,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [blueprintArtifactAdoptions.taskId, blueprintArtifactAdoptions.messageId],
      set: {
        adopted,
        updatedAt: now,
      },
    })
    .returning();
  return adoption;
}

export async function getBlueprintDbDesignAdoption(taskId: string, messageId: string) {
  const [adoption] = await db
    .select()
    .from(blueprintDbDesignAdoptions)
    .where(
      and(
        eq(blueprintDbDesignAdoptions.taskId, taskId),
        eq(blueprintDbDesignAdoptions.messageId, messageId)
      )
    );
  return adoption;
}

export async function upsertBlueprintDbDesignAdoption(
  taskId: string,
  messageId: string,
  adopted: boolean
) {
  const now = new Date();
  const [adoption] = await db
    .insert(blueprintDbDesignAdoptions)
    .values({
      taskId,
      messageId,
      adopted,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [blueprintDbDesignAdoptions.taskId, blueprintDbDesignAdoptions.messageId],
      set: {
        adopted,
        updatedAt: now,
      },
    })
    .returning();
  return adoption;
}

export async function getBlueprintDesignTokenAdoption(taskId: string, messageId: string) {
  const [adoption] = await db
    .select()
    .from(blueprintDesignTokenAdoptions)
    .where(
      and(
        eq(blueprintDesignTokenAdoptions.taskId, taskId),
        eq(blueprintDesignTokenAdoptions.messageId, messageId)
      )
    );
  return adoption;
}

export async function upsertBlueprintDesignTokenAdoption(
  taskId: string,
  messageId: string,
  adopted: boolean
) {
  const now = new Date();
  const [adoption] = await db
    .insert(blueprintDesignTokenAdoptions)
    .values({
      taskId,
      messageId,
      adopted,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [blueprintDesignTokenAdoptions.taskId, blueprintDesignTokenAdoptions.messageId],
      set: {
        adopted,
        updatedAt: now,
      },
    })
    .returning();
  return adoption;
}

// --- Task Runs ---
export async function createTaskRun(data: {
  taskId: string;
  repositoryId?: string | null;
  status?: string;
  workerKind?: string;
  baseRef?: string | null;
  worktreePath?: string | null;
  timeoutSeconds?: number;
  contextSnapshot?: any;
  summary?: string | null;
  finalReport?: string | null;
  finalJudgment?: any;
  startedAt?: Date;
  endedAt?: Date;
  finishedAt?: Date;
}) {
  const [run] = await db.insert(taskRuns).values(data).returning();
  return run;
}

export async function getTaskRun(id: string) {
  const [run] = await db.select().from(taskRuns).where(eq(taskRuns.id, id));
  return run;
}

export async function listTaskRunsForTask(taskId: string) {
  return db
    .select()
    .from(taskRuns)
    .where(eq(taskRuns.taskId, taskId))
    .orderBy(desc(taskRuns.startedAt));
}

export async function listActiveTaskRunsForTask(taskId: string) {
  return db
    .select()
    .from(taskRuns)
    .where(
      and(
        eq(taskRuns.taskId, taskId),
        inArray(taskRuns.status, ['running', 'context_compiling', 'finalizing'])
      )
    );
}

export async function countActiveTaskRuns(repositoryId?: string) {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(taskRuns)
    .where(
      repositoryId
        ? and(
            eq(taskRuns.repositoryId, repositoryId),
            inArray(taskRuns.status, ['running', 'context_compiling', 'finalizing'])
          )
        : inArray(taskRuns.status, ['running', 'context_compiling', 'finalizing'])
    );
  return Number(rows[0]?.count ?? 0);
}

export async function claimNextQueuedTask(repositoryId: string) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.repositoryId, repositoryId), inArray(tasks.status, ['ready', 'queued'])))
    .orderBy(desc(tasks.priority), asc(tasks.updatedAt))
    .limit(1);
  if (!task) return null;
  const [claimed] = await db
    .update(tasks)
    .set({ status: 'context_compiling', updatedAt: new Date() })
    .where(and(eq(tasks.id, task.id), inArray(tasks.status, ['ready', 'queued'])))
    .returning();
  if (claimed) {
    nightWorkersRealtimeBroker.publish(claimed.id, {
      type: 'task_status_updated',
      payload: { status: claimed.status, task: claimed },
    });
  }
  return claimed ?? null;
}

export async function updateTaskRun(
  id: string,
  data: {
    status?: string;
    endedAt?: Date;
    finishedAt?: Date;
    logContent?: string;
    diffPatch?: string;
    testResults?: any;
    contextEval?: any;
    workerKind?: string;
    baseRef?: string | null;
    worktreePath?: string | null;
    timeoutSeconds?: number;
    contextSnapshot?: any;
    summary?: string | null;
    finalReport?: string | null;
    finalJudgment?: any;
  }
) {
  const [run] = await db
    .update(taskRuns)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(taskRuns.id, id))
    .returning();
  if (run) {
    nightWorkersRealtimeBroker.publish(run.taskId, {
      type: 'task_run_updated',
      runId: run.id,
      payload: { run },
    });
  }
  return run;
}

// --- Task Run Todos ---
export async function createTaskRunTodo(data: {
  runId: string;
  seq: number;
  title: string;
  description?: string | null;
  taskType: string;
  status?: string;
  procedureId?: string | null;
  procedureSnapshot?: any;
  contextSnapshot?: any;
  completionGateResult?: any;
  dependsOn?: Array<string | number> | null;
  statusReason?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
}) {
  const [todo] = await db
    .insert(taskRunTodos)
    .values({
      ...data,
      dependsOn: data.dependsOn ?? [],
    })
    .returning();
  return todo;
}

export async function listTaskRunTodosForRun(runId: string) {
  return db
    .select()
    .from(taskRunTodos)
    .where(eq(taskRunTodos.runId, runId))
    .orderBy(taskRunTodos.seq);
}

export async function updateTaskRunTodo(
  id: string,
  data: {
    title?: string;
    description?: string | null;
    taskType?: string;
    status?: string;
    procedureId?: string | null;
    procedureSnapshot?: any;
    contextSnapshot?: any;
    completionGateResult?: any;
    dependsOn?: Array<string | number> | null;
    statusReason?: string | null;
    startedAt?: Date | null;
    completedAt?: Date | null;
  }
) {
  const [todo] = await db
    .update(taskRunTodos)
    .set({
      ...data,
      dependsOn: data.dependsOn === undefined ? undefined : (data.dependsOn ?? []),
      updatedAt: new Date(),
    })
    .where(eq(taskRunTodos.id, id))
    .returning();
  if (todo) {
    const [run] = await db.select().from(taskRuns).where(eq(taskRuns.id, todo.runId));
    if (run) {
      nightWorkersRealtimeBroker.publish(run.taskId, {
        type: 'task_run_updated',
        runId: run.id,
        payload: { run },
      });
    }
  }
  return todo;
}

// --- Task Events ---
export async function createTaskEvent(data: {
  taskRunId: string;
  type: string;
  message: string;
  seq?: number;
  actor?: string;
  eventType?: string | null;
  payloadJson?: any;
  timestamp?: Date;
}) {
  let seq = data.seq;
  if (seq === undefined) {
    const result = await db
      .select({ maxSeq: sql<number>`coalesce(max(${taskEvents.seq}), 0)` })
      .from(taskEvents)
      .where(eq(taskEvents.taskRunId, data.taskRunId));
    seq = (result[0]?.maxSeq || 0) + 1;
  }
  const [event] = await db
    .insert(taskEvents)
    .values({ ...data, seq })
    .returning();
  const [run] = await db.select().from(taskRuns).where(eq(taskRuns.id, data.taskRunId));
  if (event && run) {
    nightWorkersRealtimeBroker.publish(run.taskId, {
      type: 'task_event_created',
      runId: run.id,
      event,
    });
  }
  return event;
}

export async function createRunEvent(
  event: RunEventBase,
  options?: { legacyPayload?: unknown; payloadJson?: Record<string, unknown> }
) {
  const normalized = normalizeRunEventToLegacy({ event, legacyPayload: options?.legacyPayload });
  const payloadJson = {
    ...normalized.payloadJson,
    ...(options?.payloadJson || {}),
  };
  const created = await createTaskEvent({
    taskRunId: event.runId,
    actor: normalized.actor,
    type: normalized.type,
    eventType: normalized.eventType,
    message: normalized.message,
    payloadJson,
    timestamp: normalized.timestamp,
  });
  if (!created) return created;

  const payload = (created.payloadJson || {}) as any;
  const currentRunEvent = payload.runEvent;
  if (!currentRunEvent) return created;

  const patchedPayload = {
    ...payload,
    ...(options?.payloadJson || {}),
    runEvent: {
      ...currentRunEvent,
      id: created.id,
      seq: created.seq,
      runId: currentRunEvent.runId || created.taskRunId,
    },
  };

  const [updated] = await db
    .update(taskEvents)
    .set({ payloadJson: patchedPayload })
    .where(eq(taskEvents.id, created.id))
    .returning();
  return updated ?? { ...created, payloadJson: patchedPayload };
}

export async function listTaskEventsForRun(taskRunId: string, options?: { afterSeq?: number }) {
  const predicates = [eq(taskEvents.taskRunId, taskRunId)];
  if (typeof options?.afterSeq === 'number') {
    predicates.push(gt(taskEvents.seq, options.afterSeq));
  }
  return db
    .select()
    .from(taskEvents)
    .where(and(...predicates))
    .orderBy(taskEvents.seq, taskEvents.timestamp);
}

// --- Artifacts ---
export async function createArtifact(data: {
  runId: string;
  kind: string;
  path: string;
  metadataJson?: any;
}) {
  const [artifact] = await db.insert(artifacts).values(data).returning();
  return artifact;
}

export async function listArtifactsForRun(runId: string) {
  return db
    .select()
    .from(artifacts)
    .where(eq(artifacts.runId, runId))
    .orderBy(desc(artifacts.createdAt));
}
