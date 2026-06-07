import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { artifacts, taskEvents, taskRuns, taskRunTodos, tasks } from '../../db/schema';
import { nightWorkersRealtimeBroker } from '../../services/realtime/nightworkers-ws';
import { normalizeRunEventToLegacy } from '../../services/run-events/normalizer';
import type { RunEventBase } from '../../services/run-events/types';
import {
  appendActivityEvent,
  runEventToActivityKind,
  runEventToActivityStatus,
  runEventToActivityText,
  runEventToActivityTurnId,
  schemaFirstAgentEventType,
  schemaFirstPayload,
  shouldProjectRunEventToActivity,
} from './nightworkers.activity.repository';

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
    .where(
      and(
        eq(tasks.repositoryId, repositoryId),
        inArray(tasks.status, ['ready', 'queued']),
        sql`not exists (
          select 1 from implementation_queue_entries iqe
          where iqe.task_id = ${tasks.id}
            and iqe.status in ('queued', 'claimed', 'processing', 'needs_human', 'awaiting_commit_decision', 'execution_completed', 'failed', 'cancelled')
        )`
      )
    )
    .orderBy(desc(tasks.priority), asc(tasks.updatedAt))
    .limit(1);
  if (!task) return null;
  const [claimed] = await db
    .update(tasks)
    .set({ status: 'running', updatedAt: new Date() })
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

export async function replaceTaskRunTodosForRun(
  runId: string,
  todos: Array<{
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
  }>
) {
  const created = await db.transaction(async (tx) => {
    await tx.delete(taskRunTodos).where(eq(taskRunTodos.runId, runId));
    if (todos.length === 0) return [];
    return tx
      .insert(taskRunTodos)
      .values(
        todos.map((todo) => ({
          ...todo,
          runId,
          dependsOn: todo.dependsOn ?? [],
        }))
      )
      .returning();
  });
  const [run] = await db.select().from(taskRuns).where(eq(taskRuns.id, runId));
  if (run) {
    nightWorkersRealtimeBroker.publish(run.taskId, {
      type: 'task_run_updated',
      runId: run.id,
      payload: { run },
    });
  }
  return created;
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
  return event;
}

export async function createRunEvent(
  event: RunEventBase,
  options?: { legacyPayload?: unknown; payloadJson?: Record<string, unknown> }
) {
  if (event.type === 'model.response_delta') return null;

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
  const finalEvent = updated ?? { ...created, payloadJson: patchedPayload };
  let taskId = event.taskId || (patchedPayload.runEvent as any)?.taskId;
  if (!taskId) {
    const [run] = await db.select().from(taskRuns).where(eq(taskRuns.id, event.runId));
    taskId = run?.taskId;
  }
  if (taskId) {
    const agentEventType = schemaFirstAgentEventType(patchedPayload);
    const projectToActivity = shouldProjectRunEventToActivity({
      eventType: event.type,
      agentEventType,
    });
    if (!projectToActivity) {
      nightWorkersRealtimeBroker.publish(taskId, {
        type: 'task_event_created',
        runId: event.runId,
        event: finalEvent,
      });
      return finalEvent;
    }
    await appendActivityEvent({
      taskId,
      runId: event.runId,
      turnId: runEventToActivityTurnId({
        runId: event.runId,
        eventType: event.type,
        agentEventType,
      }),
      runSeq: finalEvent.seq,
      kind: runEventToActivityKind(event.type, finalEvent.type, agentEventType),
      source:
        event.actor === 'worker'
          ? 'worker'
          : event.actor === 'tool'
            ? 'tool'
            : event.actor === 'supervisor'
              ? 'supervisor'
              : event.actor === 'runtime'
                ? 'runtime'
                : event.actor === 'human'
                  ? 'user'
                  : 'system',
      status: runEventToActivityStatus({
        eventType: event.type,
        legacyType: finalEvent.type,
        agentEventType,
      }),
      text: runEventToActivityText({
        eventType: event.type,
        agentEventType,
        message: event.message,
        payload: patchedPayload,
      }),
      payloadJson: {
        runEvent: patchedPayload.runEvent,
        legacyEvent: finalEvent,
        legacyPayload: options?.legacyPayload ?? null,
        agentEventType,
        payload: schemaFirstPayload(patchedPayload),
      },
      externalId: finalEvent.id,
      dedupeKey: `task_event:${finalEvent.id}`,
      createdAt: finalEvent.timestamp,
    });
    nightWorkersRealtimeBroker.publish(taskId, {
      type: 'task_event_created',
      runId: event.runId,
      event: finalEvent,
    });
  }
  return finalEvent;
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
