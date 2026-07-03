import { NotFoundError } from '../../lib/errors';
import type { ReviewResult } from '../../services/review-results/types';
import { nativeLocalRunner } from '../../services/runner/NativeLocalRunner';
import { digestText } from '../../services/text-digest';
import * as repo from './nightworkers.repository';

export async function getActiveTaskRun(taskId: string) {
  const task = await repo.getTask(taskId);
  if (!task) {
    throw new NotFoundError('Task not found');
  }
  const activeRuns = await repo.listActiveTaskRunsForTask(taskId);
  return activeRuns[0] ?? null;
}

export async function recoverStaleActiveRuns(taskId: string) {
  const task = await repo.getTask(taskId);
  if (!task) {
    throw new NotFoundError('Task not found');
  }

  const activeRuns = await repo.listActiveTaskRunsForTask(taskId);
  if (activeRuns.length === 0) {
    return { hasRunning: false as const, recoveredRunIds: [] as string[] };
  }

  const recoveredRunIds: string[] = [];
  for (const activeRun of activeRuns) {
    const runnerStatus = await nativeLocalRunner.getStatus(activeRun.id);
    if (runnerStatus.status === 'running') {
      return { hasRunning: true as const, recoveredRunIds };
    }

    const activeTodos = await repo.listTaskRunTodosForRun(activeRun.id);
    const recoveredAt = new Date();
    for (const todo of activeTodos) {
      if (['passed', 'failed', 'skipped', 'needs_human'].includes(todo.status)) continue;
      const status = todo.status === 'running' ? 'failed' : 'skipped';
      const reason =
        status === 'failed'
          ? 'Run recovered as failed while this Todo was active.'
          : 'Skipped because the run was recovered before this Todo started.';
      const completionGateResult = {
        version: 1,
        todoId: todo.id,
        todoSeq: todo.seq,
        procedureId: todo.procedureId,
        status,
        passed: false,
        reason,
        checks: [{ id: 'stale_run_recovery', passed: false, evidence: runnerStatus.status }],
        evidence: {
          terminalState: 'failed',
          stoppedBy: 'llm_error',
          riskLevel: 'high',
          summaryDigest: digestText(reason),
          finalReportDigest: digestText(activeRun.finalReport || ''),
          diffBytes: Buffer.byteLength(activeRun.diffPatch || '', 'utf8'),
          hasTests: activeRun.testResults !== undefined && activeRun.testResults !== null,
        },
      };
      await repo.updateTaskRunTodo(todo.id, {
        status,
        statusReason: reason,
        completionGateResult,
        completedAt: recoveredAt,
        startedAt: todo.startedAt
          ? new Date(todo.startedAt as string | number | Date)
          : recoveredAt,
      });
      await repo.createRunEvent({
        version: 1,
        runId: activeRun.id,
        taskId,
        timestamp: new Date().toISOString(),
        type: 'turn.finished',
        severity: status === 'failed' ? 'error' : 'warning',
        actor: 'system',
        message: `Todo #${todo.seq} ${status} during stale run recovery: ${todo.title}`,
        data: {
          todoId: todo.id,
          todoSeq: todo.seq,
          todoTitle: todo.title,
          taskType: todo.taskType,
          procedureId: todo.procedureId,
          completionGateResult,
        },
      });
    }

    await repo.updateTaskRun(activeRun.id, {
      status: 'failed',
      endedAt: new Date(),
      finishedAt: new Date(),
      summary: 'Run recovered as failed after stale active-state detection.',
      finalJudgment: null,
    });
    await repo.updateTaskStatus(taskId, 'failed');
    await repo.createRunEvent({
      version: 1,
      runId: activeRun.id,
      taskId,
      timestamp: new Date().toISOString(),
      type: 'run.recovered',
      severity: 'warning',
      actor: 'system',
      message: `Stale active run auto-recovered. Previous status was active but runner state is "${runnerStatus.status}".`,
      data: { runnerStatus: runnerStatus.status },
    });
    await repo.createTaskMessage({
      taskId,
      runId: activeRun.id,
      role: 'system',
      content:
        '前回の実行は中断状態のまま残っていたため、失敗として確定しました。新しい依頼を継続します。',
      messageType: 'text',
    });
    recoveredRunIds.push(activeRun.id);
  }

  return { hasRunning: false as const, recoveredRunIds };
}

export async function getTaskRun(runId: string) {
  const run = await repo.getTaskRun(runId);
  if (!run) return null;
  const todos = await repo.listTaskRunTodosForRun(runId);
  const events = await repo.listTaskEventsForRun(runId);
  const commitRecord = await repo.getTaskRunCommitRecord(runId);
  const reviews = events
    .map((event) => (event.payloadJson as { reviewResult?: ReviewResult } | null)?.reviewResult)
    .filter((reviewResult): reviewResult is ReviewResult => Boolean(reviewResult));
  return { ...run, todos, events, reviews, commitRecord };
}

export async function listTaskRunEvents(runId: string, options?: { afterSeq?: number }) {
  const run = await repo.getTaskRun(runId);
  if (!run) throw new NotFoundError('Run not found');
  return repo.listTaskEventsForRun(runId, { afterSeq: options?.afterSeq });
}

export async function listTaskRunActivityEvents(runId: string, options?: { afterSeq?: number }) {
  const run = await repo.getTaskRun(runId);
  if (!run) throw new NotFoundError('Run not found');
  const events = await repo.listActivityEventsForRun(runId, { afterSeq: options?.afterSeq });
  const artifacts = await listReferencedActivityArtifacts(run.taskId, events);
  return { events, artifacts };
}

async function listReferencedActivityArtifacts(
  taskId: string,
  events: Array<{ artifactId?: string | null }>
) {
  const artifactIds = new Set(events.map((event) => event.artifactId).filter(Boolean));
  if (artifactIds.size === 0) return [];
  const artifacts = await repo.listActivityArtifactsForTask(taskId);
  return artifacts.filter((artifact) => artifactIds.has(artifact.id));
}

export async function listTaskRunEventsForReplay(input: {
  taskId: string;
  runId: string;
  afterSeq?: number;
}) {
  const run = await repo.getTaskRun(input.runId);
  if (!run || run.taskId !== input.taskId) {
    throw new NotFoundError('Run not found for task');
  }
  return repo.listTaskEventsForRun(input.runId, { afterSeq: input.afterSeq });
}

export async function getTaskRunsForTask(taskId: string) {
  return repo.listTaskRunsForTask(taskId);
}
