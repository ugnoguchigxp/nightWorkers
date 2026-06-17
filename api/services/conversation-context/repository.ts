import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  conversationContextSnapshots,
  repositories,
  taskEvents,
  taskMessages,
  taskRuns,
  tasks,
} from '../../db/schema';
import type {
  ConversationContextSnapshotRecord,
  ConversationContextSnapshotV1,
  ConversationContextSource,
  ConversationWorkerEvidence,
} from './types';

export async function loadConversationContextSource(input: {
  taskId: string;
  runId?: string | null;
}): Promise<ConversationContextSource> {
  const [taskRow] = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      description: tasks.description,
      objective: tasks.objective,
      repositoryPath: repositories.localPath,
    })
    .from(tasks)
    .innerJoin(repositories, eq(tasks.repositoryId, repositories.id))
    .where(eq(tasks.id, input.taskId))
    .limit(1);
  if (!taskRow) {
    throw new Error(`Task not found: ${input.taskId}`);
  }
  const [messages, runs, previousSnapshot] = await Promise.all([
    db
      .select()
      .from(taskMessages)
      .where(eq(taskMessages.taskId, input.taskId))
      .orderBy(taskMessages.createdAt),
    db
      .select()
      .from(taskRuns)
      .where(eq(taskRuns.taskId, input.taskId))
      .orderBy(desc(taskRuns.startedAt)),
    getLatestConversationContextForTask(input.taskId),
  ]);

  const runToolEvidence = await loadRunToolEvidenceMap(runs.slice(0, 8).map((run) => run.id));

  return {
    task: taskRow,
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      metadataJson: message.metadataJson,
      createdAt: message.createdAt,
    })),
    runs: runs.map((run) => ({
      id: run.id,
      status: run.status,
      summary: run.summary,
      finalReport: run.finalReport,
      finalJudgment: run.finalJudgment,
      contextSnapshot: run.contextSnapshot,
      lastToolFailure: runToolEvidence.get(run.id)?.lastFailure ?? null,
      lastWorkerEvidence: runToolEvidence.get(run.id) ?? null,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      endedAt: run.endedAt,
    })),
    previousSnapshot,
  };
}

async function loadRunToolEvidenceMap(runIds: string[]) {
  const failures = new Map<string, ConversationWorkerEvidence>();
  await Promise.all(
    runIds.map(async (runId) => {
      const events = await db
        .select()
        .from(taskEvents)
        .where(eq(taskEvents.taskRunId, runId))
        .orderBy(desc(taskEvents.seq))
        .limit(80);
      const failed = events.find((event) => {
        const payload = asRecord(event.payloadJson);
        const toolPayload = asRecord(payload.payload);
        return event.eventType === 'tool_result' && toolPayload.ok === false;
      });
      if (!failed) return;
      const payload = asRecord(failed.payloadJson);
      const toolPayload = asRecord(payload.payload);
      const toolName = typeof toolPayload.toolName === 'string' ? toolPayload.toolName : 'tool';
      const summary = typeof toolPayload.summary === 'string' ? toolPayload.summary : '';
      const error = asRecord(toolPayload.error);
      const errorCode = typeof error.code === 'string' ? error.code : null;
      const errorMessage = typeof error.message === 'string' ? error.message : null;
      const evidence = asRecord(toolPayload.evidence);
      const recovery = asRecord(evidence.recoveryDirective);
      const criticalEvidence = Object.keys(evidence).length
        ? [
            {
              toolName: typeof evidence.toolName === 'string' ? evidence.toolName : toolName,
              failureKind:
                typeof evidence.failureKind === 'string' ? evidence.failureKind : undefined,
              targetPath: typeof evidence.targetPath === 'string' ? evidence.targetPath : undefined,
              reason:
                typeof evidence.reason === 'string'
                  ? truncateText(evidence.reason, 300)
                  : truncateText(summary || failed.message, 300),
            },
          ]
        : [];
      const targetPath = typeof evidence.targetPath === 'string' ? evidence.targetPath : null;
      failures.set(runId, {
        lastFailure: truncateText(
          [toolName, errorCode, errorMessage || summary || failed.message]
            .filter(Boolean)
            .join(': '),
          500
        ),
        recoveryDirective: Object.keys(recovery).length
          ? {
              kind: String(recovery.kind || 'ask_user'),
              targetPath: typeof recovery.targetPath === 'string' ? recovery.targetPath : undefined,
              reason:
                typeof recovery.reason === 'string'
                  ? truncateText(recovery.reason, 300)
                  : 'Recover from the previous worker tool failure.',
              maxRepeats: typeof recovery.maxRepeats === 'number' ? recovery.maxRepeats : undefined,
            }
          : null,
        criticalEvidence,
        targets: targetPath ? [targetPath] : [],
      });
    })
  );
  return failures;
}

export async function getLatestConversationContextForTask(
  taskId: string
): Promise<ConversationContextSnapshotRecord | null> {
  const [row] = await db
    .select()
    .from(conversationContextSnapshots)
    .where(eq(conversationContextSnapshots.taskId, taskId))
    .orderBy(desc(conversationContextSnapshots.updatedAt))
    .limit(1);
  return row ? toRecord(row) : null;
}

export async function upsertConversationContextSnapshot(input: {
  taskId: string;
  runId?: string | null;
  snapshot: ConversationContextSnapshotV1;
  stateCardText: string;
}): Promise<ConversationContextSnapshotRecord> {
  const now = new Date();
  const values = {
    taskId: input.taskId,
    runId: input.runId ?? null,
    version: input.snapshot.version,
    sourceMessageId: input.snapshot.task.latestUserMessageId,
    sourceRunId: input.runId ?? null,
    sourceEventCursor: null,
    jobType: input.snapshot.classification.jobType,
    latestUserMessageId: input.snapshot.task.latestUserMessageId,
    previousRunId: input.snapshot.continuity.previousRunId,
    terminalState: input.snapshot.continuity.previousTerminalState,
    tokenEstimate: input.snapshot.limits.tokenEstimate,
    snapshotJson: input.snapshot,
    stateCardText: input.stateCardText,
    updatedAt: now,
  };

  const existing = input.runId
    ? await db
        .select()
        .from(conversationContextSnapshots)
        .where(
          and(
            eq(conversationContextSnapshots.taskId, input.taskId),
            eq(conversationContextSnapshots.runId, input.runId)
          )
        )
        .orderBy(desc(conversationContextSnapshots.updatedAt))
        .limit(1)
    : [];

  if (existing[0]) {
    const [updated] = await db
      .update(conversationContextSnapshots)
      .set(values)
      .where(eq(conversationContextSnapshots.id, existing[0].id))
      .returning();
    return toRecord(updated);
  }

  const [inserted] = await db
    .insert(conversationContextSnapshots)
    .values({
      ...values,
      createdAt: now,
    })
    .returning();
  return toRecord(inserted);
}

function toRecord(
  row: typeof conversationContextSnapshots.$inferSelect
): ConversationContextSnapshotRecord {
  return {
    id: row.id,
    taskId: row.taskId,
    runId: row.runId,
    version: row.version,
    jobType: row.jobType,
    latestUserMessageId: row.latestUserMessageId,
    previousRunId: row.previousRunId,
    terminalState: row.terminalState,
    tokenEstimate: row.tokenEstimate,
    snapshotJson: row.snapshotJson as ConversationContextSnapshotV1,
    stateCardText: row.stateCardText,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function truncateText(value: string, maxChars: number) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxChars ? normalized.slice(0, maxChars) : normalized;
}
