import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppError, NotFoundError } from '../../lib/errors';
import { compileContext, evaluateContext } from '../../services/context-still';
import { decideRunOutcome } from '../../services/run-control/run-outcome-gate';
import { nativeLocalRunner } from '../../services/runner/NativeLocalRunner';
import * as repo from './nightworkers.repository';

// --- Repositories ---
export async function createRepository(data: {
  name: string;
  localPath: string;
  branch: string;
  allowed?: boolean;
  safetyPolicy?: any;
}) {
  return repo.createRepository(data);
}

export async function getRepository(id: string) {
  return repo.getRepository(id);
}

export async function listRepositories() {
  return repo.listRepositories();
}

export async function deleteRepository(id: string) {
  return repo.deleteRepository(id);
}

// --- Tasks ---
export async function createTask(data: {
  repositoryId: string;
  title: string;
  description?: string | null;
  objective?: string | null;
  acceptanceCriteria?: string | null;
  timeoutSeconds?: number;
  priority?: number;
  createdBy?: string | null;
}) {
  const task = await repo.createTask({
    ...data,
    status: 'draft',
  });
  if (data.description?.trim()) {
    await repo.createTaskMessage({
      taskId: task.id,
      role: 'user',
      content: data.description.trim(),
      messageType: 'text',
    });
  }
  return task;
}

export async function getTask(id: string) {
  return repo.getTask(id);
}

export async function listTasks() {
  return repo.listTasks();
}

export async function listTaskMessages(taskId: string) {
  const task = await repo.getTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  return repo.listTaskMessages(taskId);
}

export async function updateTask(
  id: string,
  data: {
    title?: string;
    description?: string | null;
    objective?: string | null;
    acceptanceCriteria?: string | null;
    status?: string;
  }
) {
  return repo.updateTask(id, data);
}

export async function appendTaskMessage(id: string, prompt: string) {
  const task = await repo.getTask(id);
  if (!task) throw new NotFoundError('Task not found');
  const trimmed = prompt.trim();
  if (!trimmed) throw new AppError(400, 'EMPTY_PROMPT', 'Prompt must not be empty');
  const existingMessages = await repo.listTaskMessages(id);
  const hasAnyUserMessage = existingMessages.some((message) => message.role === 'user');
  await repo.createTaskMessage({
    taskId: id,
    role: 'user',
    content: trimmed,
    messageType: 'text',
  });
  if (task.title === 'New Session' && !hasAnyUserMessage) {
    const firstPromptTitle = trimmed.replace(/\s+/g, ' ').slice(0, 40);
    await repo.updateTask(id, { title: firstPromptTitle });
  }
  const latestTask = await repo.getTask(id);
  if (!latestTask) throw new NotFoundError('Task not found');
  return latestTask;
}

export async function deleteTask(id: string) {
  return repo.deleteTask(id);
}

// --- Execution Orchestration (Runner Integration) ---
export async function startTaskRun(taskId: string) {
  const task = await repo.getTask(taskId);
  if (!task) {
    throw new NotFoundError('Task not found');
  }
  const activeRuns = await repo.listActiveTaskRunsForTask(taskId);
  if (activeRuns.length > 0) {
    throw new AppError(409, 'RUN_ALREADY_ACTIVE', 'Another run is already active for this task');
  }

  // 1. Update status to context_compiling
  await repo.updateTaskStatus(taskId, 'context_compiling');

  // 2. Fetch repo information and compile context
  const repoInfo = await repo.getRepository(task.repositoryId);
  if (!repoInfo?.localPath) {
    throw new AppError(422, 'REPO_PATH_INVALID', 'Repository path is not configured');
  }
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(repoInfo.localPath);
  } catch {
    throw new AppError(422, 'REPO_PATH_INVALID', 'Repository path does not exist');
  }
  if (!stat.isDirectory()) {
    throw new AppError(422, 'REPO_PATH_INVALID', 'Repository path is not a directory');
  }
  const messages = await repo.listTaskMessages(taskId);
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  let compiledPromptText = lastUserMessage?.content || task.description || task.objective || '';
  if (!compiledPromptText.trim()) {
    throw new AppError(400, 'EMPTY_PROMPT', 'No user message found to start a run');
  }
  try {
    const compileResult = await compileContext(repoInfo.localPath, task.title, compiledPromptText);
    compiledPromptText = compileResult.compiledPromptText;
  } catch (err) {
    console.error('Failed to compile context, falling back to latest user message', err);
    // Keep the already selected latest user message as fallback.
  }

  await repo.updateTaskCompiledPrompt(taskId, compiledPromptText);

  // 3. Create a Run record
  const run = await repo.createTaskRun({
    taskId,
    repositoryId: task.repositoryId,
    status: 'running',
    workerKind: 'native-local-worker',
    timeoutSeconds: task.timeoutSeconds,
    contextSnapshot: { compiledPrompt: compiledPromptText },
    startedAt: new Date(),
  });

  await repo.createTaskEvent({
    taskRunId: run.id,
    type: 'info',
    message: 'Task run started. Compiling context completed.',
    actor: 'system',
    eventType: 'state_change',
  });

  // Track logs in memory and create database event entries
  let accumulativeLog = '';
  nativeLocalRunner.onLog(run.id, async (logChunk) => {
    accumulativeLog += `${logChunk}\n`;
    await repo.createTaskEvent({
      taskRunId: run.id,
      type: 'info',
      message: logChunk.trim().slice(0, 500),
      actor: 'worker',
      eventType: 'info',
    });
  });

  // Asynchronously execute runner so that startTaskRun returns immediately
  (async () => {
    try {
      await repo.updateTaskStatus(taskId, 'running');

      await nativeLocalRunner.start(run.id, repoInfo?.localPath || '', compiledPromptText, {
        timeoutSeconds: task.timeoutSeconds,
        latestUserMessage: lastUserMessage?.content || compiledPromptText,
        safetyPolicy: repoInfo.safetyPolicy || undefined,
      });

      // Poll until process is no longer running
      let runnerStatus = await nativeLocalRunner.getStatus(run.id);
      while (runnerStatus.status === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        runnerStatus = await nativeLocalRunner.getStatus(run.id);
      }

      // Collect diff output from the repository workspace
      const diff = await nativeLocalRunner.getGitDiff(repoInfo.localPath);

      // Update the run record
      await repo.updateTaskRun(run.id, {
        status: runnerStatus.status,
        endedAt: new Date(),
        finishedAt: new Date(),
        logContent: accumulativeLog,
        diffPatch: diff,
      });

      const completedRun = await repo.getTaskRun(run.id);
      const outcome = decideRunOutcome({
        supervisor: {
          finalReport: completedRun?.finalReport || '',
          terminalState: (runnerStatus.status as any) || 'failed',
          summary: completedRun?.summary || `Runner finished with status=${runnerStatus.status}`,
          stoppedBy:
            runnerStatus.status === 'timed_out' || runnerStatus.status === 'blocked'
              ? 'budget'
              : runnerStatus.status === 'needs_human'
                ? 'missing_tool_call'
                : runnerStatus.status === 'failed'
                  ? 'llm_error'
                  : 'decision',
          riskLevel: 'medium',
        },
      });
      await repo.updateTaskRun(run.id, {
        status: outcome.status,
        summary: completedRun?.summary || outcome.summary,
      });
      await repo.updateTaskStatus(taskId, outcome.status);

      await repo.createTaskEvent({
        taskRunId: run.id,
        type: 'checkpoint',
        message: `Execution finished with runner status: ${runnerStatus.status}. Task status: ${outcome.status}`,
        actor: 'system',
        eventType: 'state_change',
      });
      await repo.createTaskEvent({
        taskRunId: run.id,
        type: 'info',
        message: `Run outcome decided: ${outcome.status} (${outcome.reason})`,
        actor: 'system',
        eventType: 'run_outcome_decided',
        payloadJson: outcome,
      });

      // Feedback evaluation back to contextStill
      await evaluateContext(
        run.id,
        `Task run execution completed with status: ${outcome.status}. Diff size: ${diff.length} bytes.`,
        outcome.status === 'completed'
      );
      const completedRunAfterOutcome = await repo.getTaskRun(run.id);
      const responseText =
        completedRunAfterOutcome?.finalReport ||
        completedRunAfterOutcome?.summary ||
        (outcome.status === 'completed'
          ? '実行が完了しました。'
          : `実行が終了しました。status: ${outcome.status}`);
      await repo.createTaskMessage({
        taskId,
        runId: run.id,
        role: 'assistant',
        content: responseText,
        messageType: 'text',
        payloadJson: {
          finalReport: completedRunAfterOutcome?.finalReport ?? null,
          summary: completedRunAfterOutcome?.summary ?? null,
          status: outcome.status,
        },
      });
    } catch (err: any) {
      console.error(`Error during NativeLocalRunner execution for run ${run.id}:`, err);
      await repo.updateTaskStatus(taskId, 'failed');
      await repo.updateTaskRun(run.id, {
        status: 'failed',
        endedAt: new Date(),
        finishedAt: new Date(),
        logContent: `${accumulativeLog}\n[System Error] ${err.message}`,
      });

      await evaluateContext(run.id, `Execution crashed: ${err.message}`, false);
      await repo.createTaskMessage({
        taskId,
        runId: run.id,
        role: 'assistant',
        content: `実行に失敗しました: ${err.message}`,
        messageType: 'text',
      });
    }
  })();

  return run;
}

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

    await repo.updateTaskRun(activeRun.id, {
      status: 'failed',
      endedAt: new Date(),
      finishedAt: new Date(),
      summary: 'Run recovered as failed after stale active-state detection.',
    });
    await repo.updateTaskStatus(taskId, 'failed');
    await repo.createTaskEvent({
      taskRunId: activeRun.id,
      type: 'error',
      message: `Stale active run auto-recovered. Previous status was active but runner state is "${runnerStatus.status}".`,
      actor: 'system',
      eventType: 'state_change',
    });
    await repo.createTaskMessage({
      taskId,
      runId: activeRun.id,
      role: 'assistant',
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
  const events = await repo.listTaskEventsForRun(runId);
  return { ...run, events };
}

export async function getTaskRunsForTask(taskId: string) {
  return repo.listTaskRunsForTask(taskId);
}

export async function reviewTaskRun(
  runId: string,
  action: 'complete' | 'request_follow_up' | 'cancel' | 'accept_risk',
  note?: string
) {
  const run = await repo.getTaskRun(runId);
  if (!run) throw new Error('Run not found');

  const outcome = decideRunOutcome({
    supervisor: {
      finalReport: run.finalReport || '',
      terminalState: (run.status as any) || 'needs_review',
      summary: run.summary || `Review action: ${action}`,
      stoppedBy: 'decision',
      riskLevel: 'medium',
    },
    humanAction: action,
  });
  const finalStatus = action === 'request_follow_up' ? 'ready' : outcome.status;

  await repo.updateTaskRun(runId, {
    status: finalStatus === 'ready' ? 'failed' : outcome.status,
    summary: note || outcome.summary,
  });

  await repo.updateTaskStatus(run.taskId, finalStatus);

  await repo.createTaskEvent({
    taskRunId: runId,
    type: 'info',
    message: `Human review completed. Action: ${action}. Note: ${note || 'None'}`,
    actor: 'human',
    eventType: 'state_change',
  });
  await repo.createTaskEvent({
    taskRunId: runId,
    type: 'info',
    message: `Run outcome decided: ${outcome.status} (${outcome.reason})`,
    actor: 'human',
    eventType: 'run_outcome_decided',
    payloadJson: outcome,
  });

  return { ok: true, status: finalStatus };
}

export async function browseLocalFolders(targetPath?: string) {
  const baseDir = targetPath ? path.resolve(targetPath) : os.homedir();

  try {
    const files = await fs.readdir(baseDir, { withFileTypes: true });
    const directories = [];

    for (const file of files) {
      if (file.isDirectory() && !file.name.startsWith('.')) {
        directories.push({
          name: file.name,
          path: path.join(baseDir, file.name),
        });
      }
    }

    directories.sort((a, b) => a.name.localeCompare(b.name));

    const parentPath = baseDir === '/' ? null : path.dirname(baseDir);

    return {
      currentPath: baseDir,
      parentPath,
      directories,
    };
  } catch (err: any) {
    const parentPath = baseDir === '/' ? null : path.dirname(baseDir);
    return {
      currentPath: baseDir,
      parentPath,
      directories: [],
      error: err.message,
    };
  }
}
