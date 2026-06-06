import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  activityArtifacts,
  activityEvents,
  artifacts,
  blueprintArtifactAdoptions,
  blueprintDbDesignAdoptions,
  blueprintDesignSettings,
  blueprintDesignTokenAdoptions,
  designQuestionnaireAnswers,
  designQuestionnaireQuestionSets,
  designQuestionnaireReviews,
  designQuestionnaireSessions,
  implementationQueueEntries,
  implementationQueueSettings,
  repositories,
  taskEvents,
  taskMessages,
  taskRuns,
  taskRunTodos,
  tasks,
  todoWorkflowSettings,
} from '../../db/schema';
import { nightWorkersRealtimeBroker } from '../../services/realtime/nightworkers-ws';
import { normalizeRunEventToLegacy } from '../../services/run-events/normalizer';
import type { RunEventBase } from '../../services/run-events/types';

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

const KNOWN_ACTIVITY_KINDS = new Set([
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

function normalizeActivityKind(kind: string) {
  return KNOWN_ACTIVITY_KINDS.has(kind) ? kind : 'unknown.activity';
}

function taskMessageRoleToActivityKind(role: string) {
  if (role === 'user') return 'user.message';
  if (role === 'assistant') return 'assistant.message';
  if (role === 'tool') return 'tool.result';
  return 'system.info';
}

function getToolDiffActivityKind(payload: any) {
  if (payload?.intent !== 'tool_diff') return null;
  if (payload?.toolName === 'apply_patch') return 'file.patch';
  if (payload?.toolName === 'replace_content') return 'file.diff';
  return 'file.diff';
}

function activityPayloadJson(payload: any, normalizedKind: string, originalKind: string) {
  const base =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : payload === undefined
        ? {}
        : { rawPayload: payload };
  if (normalizedKind === originalKind) return base;
  return { ...base, originalKind, rawPayload: payload };
}

function taskMessageRoleToActivitySource(role: string): ActivitySource {
  if (role === 'user') return 'user';
  if (role === 'assistant') return 'assistant';
  if (role === 'tool') return 'tool';
  return 'system';
}

function runEventToActivityKind(
  eventType?: string | null,
  legacyType?: string | null,
  agentEventType?: string | null
) {
  if (agentEventType === 'model.response_finished') return 'assistant.raw_output';
  if (agentEventType === 'round1.parsed' || agentEventType === 'round2.parsed') {
    return 'llm.schema_result';
  }
  if (agentEventType === 'round1.prompt_built' || agentEventType === 'round2.prompt_built') {
    return 'llm.request';
  }
  if (agentEventType === 'skill.loaded') return 'runtime.state';
  if (agentEventType === 'tool.validation_failed') return 'tool.error';
  if (agentEventType === 'run.started' || agentEventType === 'run.completed') return 'run.status';
  if (agentEventType === 'run.needs_human' || agentEventType === 'run.failed') {
    return agentEventType === 'run.failed' ? 'system.error' : 'run.status';
  }
  if (eventType === 'model.response_delta') return 'assistant.delta';
  if (eventType === 'model.response_finished') return 'llm.response_final';
  if (eventType === 'model.request_started') return 'llm.request';
  if (
    eventType === 'model.provider_activity_detected' ||
    eventType === 'model.provider_tool_call_detected' ||
    eventType === 'model.provider_activity_rejected'
  ) {
    return 'llm.provider_activity';
  }
  if (eventType === 'model.response_parse_failed') return 'llm.error';
  if (eventType === 'supervisor.decision') return 'llm.decision_json';
  if (eventType === 'tool.call_started' || eventType === 'tool.call_progress') return 'tool.call';
  if (eventType === 'tool.call_finished') return 'tool.result';
  if (eventType === 'tool.policy_blocked') return 'tool.error';
  if (eventType === 'verification.started' || eventType === 'verification.finished') {
    return 'verification.output';
  }
  if (eventType?.startsWith('run.') || eventType?.startsWith('turn.')) return 'run.status';
  if (eventType?.startsWith('safety.')) return 'runtime.decision';
  if (eventType?.startsWith('system.'))
    return eventType === 'system.error' ? 'system.error' : 'system.info';
  if (legacyType === 'error') return 'system.error';
  if (legacyType === 'state_change' || legacyType === 'checkpoint') return 'runtime.state';
  return 'unknown.activity';
}

function schemaFirstAgentEventType(payload: any): string | null {
  const direct = payload?.agentEventType;
  if (typeof direct === 'string') return direct;
  const dataEventType = payload?.runEvent?.data?.agentEventType;
  if (typeof dataEventType === 'string') return dataEventType;
  return null;
}

function schemaFirstPayload(payload: any): any {
  return payload?.payload ?? payload?.runEvent?.data?.payload ?? payload?.runEvent?.data ?? {};
}

function shouldProjectRunEventToActivity(input: {
  eventType?: string | null;
  agentEventType?: string | null;
}) {
  if (
    input.agentEventType === 'round1.prompt_built' ||
    input.agentEventType === 'round2.prompt_built' ||
    input.agentEventType === 'round1.parsed' ||
    input.agentEventType === 'round2.parsed' ||
    input.agentEventType === 'skill.loaded' ||
    input.agentEventType === 'model.response_finished' ||
    input.agentEventType === 'tool.started' ||
    input.agentEventType === 'tool.finished' ||
    input.agentEventType === 'tool.failed' ||
    input.agentEventType === 'tool.validation_failed' ||
    input.agentEventType === 'job.switched'
  ) {
    return true;
  }
  return (
    input.eventType === 'model.request_started' ||
    input.eventType === 'model.response_finished' ||
    input.eventType === 'model.response_parse_failed' ||
    input.eventType === 'supervisor.decision' ||
    input.eventType === 'tool.call_started' ||
    input.eventType === 'tool.call_finished' ||
    input.eventType === 'tool.policy_blocked'
  );
}

function runEventToActivityText(input: {
  eventType?: string | null;
  agentEventType?: string | null;
  message: string;
  payload: any;
}) {
  const payload = schemaFirstPayload(input.payload);
  if (input.agentEventType === 'model.response_finished') {
    return String(
      input.payload?.rawContent || input.payload?.runEvent?.data?.rawContent || input.message || ''
    );
  }
  if (input.agentEventType === 'round1.parsed' || input.agentEventType === 'round2.parsed') {
    return JSON.stringify(payload, null, 2);
  }
  if (
    input.agentEventType === 'round1.prompt_built' ||
    input.agentEventType === 'round2.prompt_built'
  ) {
    return String(payload.systemPrompt || input.message || '');
  }
  if (input.agentEventType === 'skill.loaded') {
    return String(payload.skillPath || 'skill.loaded');
  }
  if (input.agentEventType === 'tool.validation_failed') {
    return String(payload.summary || input.message || 'tool validation failed');
  }
  if (input.agentEventType === 'tool.started') {
    return `${String(payload.toolName || 'tool')} started`;
  }
  if (input.agentEventType === 'tool.finished' || input.agentEventType === 'tool.failed') {
    return String(payload.summary || input.message || input.agentEventType);
  }
  if (input.agentEventType === 'job.switched') {
    return `jobType -> ${String(payload.nextJobType || '')}`;
  }
  if (input.agentEventType === 'finalize.received') {
    return String(payload.message || input.message || '');
  }
  if (input.agentEventType?.startsWith('run.')) {
    return String(
      payload.finalReport ||
        payload.reason ||
        payload.error ||
        input.message ||
        input.agentEventType
    );
  }
  return input.message;
}

function runEventToActivityStatus(input: {
  eventType?: string | null;
  legacyType?: string | null;
  agentEventType?: string | null;
}) {
  if (input.agentEventType?.endsWith('.started')) return 'started';
  if (input.agentEventType?.endsWith('.failed')) return 'failed';
  if (input.agentEventType === 'round1.invalid' || input.agentEventType === 'round2.invalid') {
    return 'failed';
  }
  if (input.agentEventType === 'tool.validation_failed') return 'failed';
  if (input.eventType === 'model.response_delta') return 'delta';
  if (input.legacyType === 'error') return 'failed';
  return 'completed';
}

function runEventToActivityTurnId(input: {
  runId: string;
  eventType?: string | null;
  agentEventType?: string | null;
}) {
  if (input.agentEventType) return `assistant:${input.runId}`;
  if (input.eventType === 'model.response_delta' || input.eventType === 'model.response_finished') {
    return `assistant:${input.runId}`;
  }
  return undefined;
}

export async function appendActivityArtifact(data: {
  taskId: string;
  runId?: string | null;
  kind: string;
  path?: string | null;
  contentText?: string | null;
  metadataJson?: any;
}) {
  const [artifact] = await db
    .insert(activityArtifacts)
    .values({
      taskId: data.taskId,
      runId: data.runId ?? null,
      kind: data.kind,
      path: data.path ?? null,
      contentText: data.contentText ?? null,
      metadataJson: data.metadataJson ?? null,
    })
    .returning();
  return artifact;
}

export async function appendActivityEvent(data: {
  taskId: string;
  runId?: string | null;
  turnId?: string | null;
  parentEventId?: string | null;
  runSeq?: number | null;
  kind: string;
  source: ActivitySource | string;
  status?: ActivityStatus | string | null;
  text?: string | null;
  payloadJson?: any;
  artifactId?: string | null;
  clientTempId?: string | null;
  externalId?: string | null;
  dedupeKey?: string | null;
  ingestError?: string | null;
  visibility?: string;
  createdAt?: Date;
}) {
  const normalizedKind = normalizeActivityKind(data.kind);
  const ingestError =
    normalizedKind === data.kind
      ? data.ingestError
      : [data.ingestError, `Unsupported activity kind: ${data.kind}`].filter(Boolean).join('\n');

  if (data.dedupeKey) {
    const [existing] = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.dedupeKey, data.dedupeKey));
    if (existing) return existing;
  }

  const result = await db.transaction(async (tx) => {
    const [seqRow] = await tx
      .select({ maxSeq: sql<number>`coalesce(max(${activityEvents.seq}), 0)` })
      .from(activityEvents)
      .where(eq(activityEvents.taskId, data.taskId));
    const seq = (seqRow?.maxSeq || 0) + 1;
    const [event] = await tx
      .insert(activityEvents)
      .values({
        taskId: data.taskId,
        runId: data.runId ?? null,
        turnId: data.turnId ?? null,
        parentEventId: data.parentEventId ?? null,
        seq,
        runSeq: data.runSeq ?? null,
        kind: normalizedKind,
        source: data.source,
        status: data.status ?? null,
        text: data.text ?? null,
        payloadJson: activityPayloadJson(data.payloadJson, normalizedKind, data.kind),
        artifactId: data.artifactId ?? null,
        clientTempId: data.clientTempId ?? null,
        externalId: data.externalId ?? null,
        dedupeKey: data.dedupeKey ?? null,
        ingestError: ingestError || null,
        visibility: data.visibility ?? 'visible',
        createdAt: data.createdAt ?? new Date(),
      })
      .returning();
    return event;
  });

  if (result) {
    nightWorkersRealtimeBroker.publish(data.taskId, {
      type: 'activity_event_created',
      runId: data.runId ?? undefined,
      seq: result.seq,
      payload: { event: result },
    });
  }
  return result;
}

export async function listActivityEventsForTask(taskId: string, options?: { afterSeq?: number }) {
  const predicates = [eq(activityEvents.taskId, taskId)];
  if (typeof options?.afterSeq === 'number') {
    predicates.push(gt(activityEvents.seq, options.afterSeq));
  }
  return db
    .select()
    .from(activityEvents)
    .where(and(...predicates))
    .orderBy(activityEvents.seq, activityEvents.createdAt);
}

export async function listActivityEventsForRun(runId: string, options?: { afterSeq?: number }) {
  const predicates = [eq(activityEvents.runId, runId)];
  if (typeof options?.afterSeq === 'number') {
    predicates.push(gt(activityEvents.seq, options.afterSeq));
  }
  return db
    .select()
    .from(activityEvents)
    .where(and(...predicates))
    .orderBy(activityEvents.seq, activityEvents.createdAt);
}

export async function listActivityArtifactsForTask(taskId: string) {
  return db
    .select()
    .from(activityArtifacts)
    .where(eq(activityArtifacts.taskId, taskId))
    .orderBy(activityArtifacts.createdAt);
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

export async function getTaskMessage(id: string) {
  const [message] = await db.select().from(taskMessages).where(eq(taskMessages.id, id));
  return message;
}

export async function createDesignQuestionnaireSession(data: {
  taskId: string;
  repositoryId: string;
  sourceBlueprintMessageId: string;
  status?: string;
}) {
  const [session] = await db
    .insert(designQuestionnaireSessions)
    .values({
      ...data,
      status: data.status ?? 'draft',
    })
    .returning();
  return session;
}

export async function updateDesignQuestionnaireSessionStatus(id: string, status: string) {
  const [session] = await db
    .update(designQuestionnaireSessions)
    .set({ status, updatedAt: new Date() })
    .where(eq(designQuestionnaireSessions.id, id))
    .returning();
  return session;
}

export async function listDesignQuestionnaireSessionsForTask(taskId: string) {
  return db
    .select()
    .from(designQuestionnaireSessions)
    .where(eq(designQuestionnaireSessions.taskId, taskId))
    .orderBy(desc(designQuestionnaireSessions.createdAt));
}

export async function getDesignQuestionnaireSession(id: string) {
  const [session] = await db
    .select()
    .from(designQuestionnaireSessions)
    .where(eq(designQuestionnaireSessions.id, id));
  return session;
}

export async function createDesignQuestionnaireQuestionSet(data: {
  sessionId: string;
  sequence: number;
  questionnaireJson?: any;
  rawOutput?: string | null;
  validationStatus: 'valid' | 'invalid';
}) {
  const [questionSet] = await db
    .insert(designQuestionnaireQuestionSets)
    .values({
      sessionId: data.sessionId,
      sequence: data.sequence,
      questionnaireJson: data.questionnaireJson ?? null,
      rawOutput: data.rawOutput ?? null,
      validationStatus: data.validationStatus,
    })
    .returning();
  return questionSet;
}

export async function listDesignQuestionnaireQuestionSets(sessionId: string) {
  return db
    .select()
    .from(designQuestionnaireQuestionSets)
    .where(eq(designQuestionnaireQuestionSets.sessionId, sessionId))
    .orderBy(asc(designQuestionnaireQuestionSets.sequence));
}

export async function upsertDesignQuestionnaireAnswer(data: {
  sessionId: string;
  questionId: string;
  answerJson: any;
}) {
  const now = new Date();
  const [answer] = await db
    .insert(designQuestionnaireAnswers)
    .values({
      sessionId: data.sessionId,
      questionId: data.questionId,
      answerJson: data.answerJson,
      answeredAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [designQuestionnaireAnswers.sessionId, designQuestionnaireAnswers.questionId],
      set: {
        answerJson: data.answerJson,
        answeredAt: now,
        updatedAt: now,
      },
    })
    .returning();
  return answer;
}

export async function listDesignQuestionnaireAnswers(sessionId: string) {
  return db
    .select()
    .from(designQuestionnaireAnswers)
    .where(eq(designQuestionnaireAnswers.sessionId, sessionId))
    .orderBy(asc(designQuestionnaireAnswers.createdAt));
}

export async function createDesignQuestionnaireReview(data: {
  sessionId: string;
  reviewJson?: any;
  publishedMessageId?: string | null;
  status?: string;
}) {
  const [review] = await db
    .insert(designQuestionnaireReviews)
    .values({
      sessionId: data.sessionId,
      reviewJson: data.reviewJson ?? null,
      publishedMessageId: data.publishedMessageId ?? null,
      status: data.status ?? 'draft',
    })
    .returning();
  return review;
}

export async function updateDesignQuestionnaireReview(
  id: string,
  data: { status?: string; publishedMessageId?: string | null; reviewJson?: any }
) {
  const [review] = await db
    .update(designQuestionnaireReviews)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(designQuestionnaireReviews.id, id))
    .returning();
  return review;
}

export async function listDesignQuestionnaireReviews(sessionId: string) {
  return db
    .select()
    .from(designQuestionnaireReviews)
    .where(eq(designQuestionnaireReviews.sessionId, sessionId))
    .orderBy(desc(designQuestionnaireReviews.createdAt));
}

export async function getDesignQuestionnaireReview(id: string) {
  const [review] = await db
    .select()
    .from(designQuestionnaireReviews)
    .where(eq(designQuestionnaireReviews.id, id));
  return review;
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

// --- Implementation Queue ---
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
  hookPolicyJson?: any;
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
