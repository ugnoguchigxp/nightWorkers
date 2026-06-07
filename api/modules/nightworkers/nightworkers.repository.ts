import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { repositories, taskMessages, tasks } from '../../db/schema';
import { nightWorkersRealtimeBroker } from '../../services/realtime/nightworkers-ws';
import {
  appendActivityArtifact,
  appendActivityEvent,
  getToolDiffActivityKind,
  taskMessageRoleToActivityKind,
  taskMessageRoleToActivitySource,
} from './nightworkers.activity.repository';

const _ACTIVE_IMPLEMENTATION_QUEUE_STATUSES = [
  'queued',
  'claimed',
  'processing',
  'needs_human',
  'awaiting_commit_decision',
  'execution_completed',
  'failed',
  'cancelled',
] as const;
const _OCCUPIED_PROCESSOR_STATUSES = [
  'claimed',
  'processing',
  'needs_human',
  'awaiting_commit_decision',
] as const;

const _KNOWN_ACTIVITY_KINDS = new Set([
  'user.message',
  'assistant.delta',
  'assistant.message',
  'assistant.pause',
  'assistant.resume',
  'assistant.raw_output',
  'llm.request',
  'llm.response_delta',
  'llm.response_final',
  'llm.decision_json',
  'llm.schema_result',
  'llm.error',
  'llm.usage',
  'llm.provider_activity',
  'runtime.decision',
  'runtime.state',
  'tool.call',
  'tool.result',
  'tool.error',
  'command.output',
  'file.diff',
  'file.patch',
  'file.write',
  'verification.output',
  'run.status',
  'todo.status',
  'transport.subscribe',
  'transport.replay',
  'transport.publish',
  'ui.optimistic',
  'system.info',
  'system.error',
  'unknown.activity',
]);

export type ActivitySource =
  | 'user'
  | 'assistant'
  | 'supervisor'
  | 'worker'
  | 'tool'
  | 'system'
  | 'provider'
  | 'runtime'
  | 'transport'
  | 'ui';

export type ActivityStatus =
  | 'started'
  | 'delta'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'resumed'
  | 'info'
  | 'unknown';

export type ImplementationQueueEntryStatus =
  | 'queued'
  | 'claimed'
  | 'processing'
  | 'needs_human'
  | 'awaiting_commit_decision'
  | 'execution_completed'
  | 'execution_archived'
  | 'failed'
  | 'cancelled';

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
    safetyPolicy?: any;
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
    await appendActivityEvent({
      taskId: data.taskId,
      runId: data.runId ?? null,
      turnId: message.id,
      kind: taskMessageRoleToActivityKind(data.role),
      source: taskMessageRoleToActivitySource(data.role),
      status: 'completed',
      text: data.content,
      payloadJson: {
        message,
        messageType: data.messageType ?? null,
        metadata: data.payloadJson ?? null,
      },
      externalId: message.id,
      dedupeKey: `task_message:${message.id}`,
      createdAt: message.createdAt,
    });
    if (isAppBlueprintDocumentMessage(data.messageType, data.payloadJson)) {
      const artifact = await appendActivityArtifact({
        taskId: data.taskId,
        runId: data.runId ?? null,
        kind: 'app_blueprint',
        path: `${message.id}.app-blueprint.json`,
        contentText: JSON.stringify(data.payloadJson.appBlueprint, null, 2),
        metadataJson: {
          messageId: message.id,
          intent: data.payloadJson.intent,
          title: data.payloadJson.title,
          appBlueprint: data.payloadJson.appBlueprint,
          validation: data.payloadJson.validation,
          generation: data.payloadJson.generation,
          source: data.payloadJson.source,
        },
      });
      await appendActivityEvent({
        taskId: data.taskId,
        runId: data.runId ?? null,
        turnId: message.id,
        kind: 'system.info',
        source: 'assistant',
        status: 'completed',
        text: `Blueprint artifact: ${data.payloadJson.title || data.payloadJson.appBlueprint.name || 'App Blueprint'}`,
        payloadJson: {
          messageId: message.id,
          messageType: data.messageType ?? null,
          metadata: data.payloadJson,
        },
        artifactId: artifact?.id ?? null,
        externalId: message.id,
        dedupeKey: `task_message_artifact:${message.id}`,
        createdAt: message.createdAt,
      });
    }
    const diffActivityKind = getToolDiffActivityKind(data.payloadJson);
    if (diffActivityKind) {
      const artifact = await appendActivityArtifact({
        taskId: data.taskId,
        runId: data.runId ?? null,
        kind: diffActivityKind === 'file.patch' ? 'patch' : 'diff',
        path:
          data.payloadJson?.codeBlock?.filename ?? `${data.payloadJson?.toolName || 'tool'}.diff`,
        contentText: data.payloadJson?.codeBlock?.code ?? data.content,
        metadataJson: {
          messageId: message.id,
          toolName: data.payloadJson?.toolName,
          title: data.payloadJson?.title,
          iteration: data.payloadJson?.iteration,
          toolResult: data.payloadJson?.toolResult,
        },
      });
      await appendActivityEvent({
        taskId: data.taskId,
        runId: data.runId ?? null,
        turnId: message.id,
        kind: diffActivityKind,
        source: 'tool',
        status: data.payloadJson?.toolResult?.ok === false ? 'failed' : 'completed',
        text: data.payloadJson?.title ?? message.content.slice(0, 240),
        payloadJson: {
          messageId: message.id,
          toolName: data.payloadJson?.toolName,
          toolResult: data.payloadJson?.toolResult,
        },
        artifactId: artifact?.id ?? null,
        externalId: message.id,
        dedupeKey: `task_message_diff:${message.id}`,
        createdAt: message.createdAt,
      });
    }
    nightWorkersRealtimeBroker.publish(data.taskId, {
      type: 'task_message_created',
      runId: data.runId ?? undefined,
      payload: { message },
    });
  }
  return message;
}

function isAppBlueprintDocumentMessage(messageType: string | null | undefined, payloadJson: any) {
  return Boolean(
    messageType === 'markdown_document' &&
      payloadJson &&
      typeof payloadJson === 'object' &&
      payloadJson.intent === 'app_blueprint' &&
      payloadJson.appBlueprint
  );
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

// --- Task Runs ---
export * from './nightworkers.activity.repository';
export * from './nightworkers.blueprint-adoption.repository';
export * from './nightworkers.design-questionnaire.repository';
export * from './nightworkers.queue.repository';
export * from './nightworkers.runs.repository';
