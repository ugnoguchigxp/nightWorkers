import { and, eq, gt, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { activityArtifacts, activityEvents } from '../../db/schema';
import { nightWorkersRealtimeBroker } from '../../services/realtime/nightworkers-ws';
import type { ActivitySource, ActivityStatus } from './nightworkers.repository';

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

export function normalizeActivityKind(kind: string) {
  return KNOWN_ACTIVITY_KINDS.has(kind) ? kind : 'unknown.activity';
}

export function taskMessageRoleToActivityKind(role: string) {
  if (role === 'user') return 'user.message';
  if (role === 'assistant') return 'assistant.message';
  if (role === 'tool') return 'tool.result';
  return 'system.info';
}

export function getToolDiffActivityKind(payload: any) {
  if (payload?.intent !== 'tool_diff') return null;
  if (payload?.toolName === 'apply_patch') return 'file.patch';
  if (payload?.toolName === 'replace_content') return 'file.diff';
  return 'file.diff';
}

export function activityPayloadJson(payload: any, normalizedKind: string, originalKind: string) {
  const base =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : payload === undefined
        ? {}
        : { rawPayload: payload };
  if (normalizedKind === originalKind) return base;
  return { ...base, originalKind, rawPayload: payload };
}

export function taskMessageRoleToActivitySource(role: string): ActivitySource {
  if (role === 'user') return 'user';
  if (role === 'assistant') return 'assistant';
  if (role === 'tool') return 'tool';
  return 'system';
}

export function runEventToActivityKind(
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
  if (agentEventType === 'procedure.loaded') return 'runtime.state';
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
  if (eventType === 'git.diff_collected') return 'file.diff';
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

export function schemaFirstAgentEventType(payload: any): string | null {
  const direct = payload?.agentEventType;
  if (typeof direct === 'string') return direct;
  const dataEventType = payload?.runEvent?.data?.agentEventType;
  if (typeof dataEventType === 'string') return dataEventType;
  return null;
}

export function schemaFirstPayload(payload: any): any {
  return payload?.payload ?? payload?.runEvent?.data?.payload ?? payload?.runEvent?.data ?? {};
}

export function shouldProjectRunEventToActivity(input: {
  eventType?: string | null;
  agentEventType?: string | null;
}) {
  if (
    input.agentEventType === 'round1.prompt_built' ||
    input.agentEventType === 'round2.prompt_built' ||
    input.agentEventType === 'round1.parsed' ||
    input.agentEventType === 'round2.parsed' ||
    input.agentEventType === 'procedure.loaded' ||
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
    input.eventType === 'tool.call_progress' ||
    input.eventType === 'tool.call_finished' ||
    input.eventType === 'tool.policy_blocked' ||
    input.eventType === 'git.diff_collected' ||
    input.eventType === 'run.runtime_started' ||
    input.eventType === 'run.runtime_finished' ||
    input.eventType === 'turn.started' ||
    input.eventType === 'turn.finished'
  );
}

export function runEventToActivityText(input: {
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
  if (input.agentEventType === 'procedure.loaded') {
    return String(payload.procedurePath || 'procedure.loaded');
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
  if (
    input.eventType === 'tool.call_started' ||
    input.eventType === 'tool.call_progress' ||
    input.eventType === 'tool.call_finished'
  ) {
    return formatToolRunEventActivityText(input.message, payload);
  }
  if (input.eventType === 'git.diff_collected') {
    return formatDiffRunEventActivityText(input.message, payload);
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

function formatToolRunEventActivityText(message: string, payload: any) {
  const toolName = String(payload.toolName || 'tool');
  const command = typeof payload.command === 'string' ? payload.command : '';
  const status = typeof payload.status === 'string' ? payload.status : '';
  const exitCode =
    typeof payload.exitCode === 'number' || payload.exitCode === null
      ? `exit=${payload.exitCode ?? 'pending'}`
      : '';
  const output =
    typeof payload.aggregatedOutput === 'string' ? payload.aggregatedOutput.trim() : '';
  const header = [toolName, command, status, exitCode].filter(Boolean).join(' | ');
  if (output) return [header || message, output].filter(Boolean).join('\n');
  return header || message;
}

function formatDiffRunEventActivityText(message: string, payload: any) {
  const changedFiles = Array.isArray(payload.changedFiles)
    ? payload.changedFiles.filter((file: unknown): file is string => typeof file === 'string')
    : [];
  if (!changedFiles.length) return message;
  return [`Changed files (${changedFiles.length})`, ...changedFiles].join('\n');
}

export function runEventToActivityStatus(input: {
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

export function runEventToActivityTurnId(input: {
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
