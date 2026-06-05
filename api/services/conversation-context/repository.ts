import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  conversationContextSnapshots,
  repositories,
  taskMessages,
  taskRuns,
  tasks,
} from '../../db/schema';
import type {
  ConversationContextSnapshotRecord,
  ConversationContextSnapshotV1,
  ConversationContextSource,
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
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      endedAt: run.endedAt,
    })),
    previousSnapshot,
  };
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
