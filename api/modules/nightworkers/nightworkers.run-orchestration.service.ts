import fs from 'node:fs/promises';
import { AppError, NotFoundError } from '../../lib/errors';
import { getCurrentSettings } from '../../routes/settings';
import { createLedgerSink } from '../../services/agent-runtime/ledger-sink';
import { resolveAgentRuntime } from '../../services/agent-runtime/registry';
import { resolveRuntimeLane } from '../../services/agent-runtime/runtime-lane';
import {
  buildPromptWithStateCardParts,
  getLatestConversationContextForTask,
  type RefreshConversationContextInput,
  refreshConversationContextSnapshot,
} from '../../services/conversation-context';
import {
  isConversationContextBuildOnIdleEnabled,
  isConversationContextStateCardEnabled,
} from '../../services/conversation-context/flags';
import { digestText } from '../../services/text-digest';
import type { RuntimePromptSnapshot } from '../../services/todo-context';
import {
  outcomeFromRuntimeResult,
  resolveBlueprintPlanningReadiness,
} from './nightworkers.basic.service';
import * as repo from './nightworkers.repository';
import { createPlanningArtifactMessageIfNeeded } from './nightworkers.workbench.service';

async function completeOpenTodosForTerminalRun(runId: string, status: string, reason: string) {
  if (!['completed', 'needs_review'].includes(status)) return;
  const todos = await repo.listTaskRunTodosForRun(runId);
  const now = new Date();
  for (const todo of todos) {
    if (!['pending', 'running'].includes(todo.status)) continue;
    await repo.updateTaskRunTodo(todo.id, {
      status: 'passed',
      statusReason: reason,
      startedAt: todo.startedAt ? new Date(todo.startedAt as any) : now,
      completedAt: now,
    });
  }
}

async function safelyRefreshConversationContext(input: RefreshConversationContextInput) {
  if (!isConversationContextBuildOnIdleEnabled()) return;
  try {
    await refreshConversationContextSnapshot(input);
  } catch (error) {
    console.warn('conversation context refresh failed', {
      error,
      taskId: input.taskId,
      runId: input.runId,
    });
  }
}

async function maybeLoadConversationStateCard(taskId: string, latestUserMessageId?: string | null) {
  if (!isConversationContextStateCardEnabled()) return null;
  try {
    const snapshot = await getLatestConversationContextForTask(taskId);
    if (snapshot?.latestUserMessageId && snapshot.latestUserMessageId === latestUserMessageId) {
      return null;
    }
    return snapshot;
  } catch (error) {
    console.warn('conversation context load failed', { error, taskId });
    return null;
  }
}

export async function startTaskRun(taskId: string) {
  const task = await repo.getTask(taskId);
  if (!task) {
    throw new NotFoundError('Task not found');
  }
  const activeRuns = await repo.listActiveTaskRunsForTask(taskId);
  if (activeRuns.length > 0) {
    throw new AppError(409, 'RUN_ALREADY_ACTIVE', 'Another run is already active for this task');
  }

  // 1. Mark the task as running while the runtime prompt is prepared.
  await repo.updateTaskStatus(taskId, 'running');

  // 2. Fetch repo information and create the run before compiling context.
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
  const compiledPromptText = lastUserMessage?.content || task.description || task.objective || '';
  if (!compiledPromptText.trim()) {
    throw new AppError(400, 'EMPTY_PROMPT', 'No user message found to start a run');
  }
  const blueprintReadiness = await resolveBlueprintPlanningReadiness(taskId);
  const settings = getCurrentSettings();
  const runtimeLaneResolution = resolveRuntimeLane({
    settingsRuntimeLane: settings.IMPLEMENTATION_RUNTIME_LANE,
    activeLlmProvider: settings.ACTIVE_LLM_PROVIDER,
    codexEnabled: settings.CODEX_ENABLED,
  });
  const run = await repo.createTaskRun({
    taskId,
    repositoryId: task.repositoryId,
    status: 'running',
    workerKind: runtimeLaneResolution.workerKind,
    timeoutSeconds: task.timeoutSeconds,
    contextSnapshot: {
      compiledPrompt: compiledPromptText,
      blueprintPlanning: blueprintReadiness,
      runtimeLane: runtimeLaneResolution.lane,
      runtimeLaneResolution: {
        workerKind: runtimeLaneResolution.workerKind,
        source: runtimeLaneResolution.source,
        diagnostics: runtimeLaneResolution.diagnostics,
      },
    },
    startedAt: new Date(),
  });

  await repo.createRunEvent({
    version: 1,
    runId: run.id,
    taskId,
    timestamp: new Date().toISOString(),
    type: 'run.created',
    severity: 'info',
    actor: 'system',
    message: 'Task run created. Runtime prompt is being prepared.',
    data: {
      contextSource: 'task_prompt',
      blueprintPlanning: blueprintReadiness,
      runtimeLane: runtimeLaneResolution.lane,
      workerKind: runtimeLaneResolution.workerKind,
      runtimeLaneResolution,
    },
  });

  const contextSnapshot: RuntimePromptSnapshot = {
    compiledPrompt: compiledPromptText,
    source: 'task_prompt',
    degraded: false,
    blueprintPlanning: blueprintReadiness,
    runtimeLane: runtimeLaneResolution.lane,
    runtimeLaneResolution: {
      workerKind: runtimeLaneResolution.workerKind,
      source: runtimeLaneResolution.source,
      diagnostics: runtimeLaneResolution.diagnostics,
    },
    request: {
      repositoryPath: repoInfo.localPath,
      taskTitle: task.title,
      taskDescriptionDigest: digestText(
        lastUserMessage?.content || task.description || task.objective || ''
      ),
    },
    result: {
      digest: digestText(compiledPromptText),
      charCount: compiledPromptText.length,
    },
  };

  const rawLatestUserMessage = lastUserMessage?.content || compiledPromptText;
  const conversationContext = await maybeLoadConversationStateCard(taskId, lastUserMessage?.id);
  const runtimePromptParts = buildPromptWithStateCardParts({
    latestUserMessage: rawLatestUserMessage,
    stateCardText: conversationContext?.stateCardText,
  });
  const runtimeLatestUserMessage = runtimePromptParts.promptText;
  const runtimeContextSnapshot: RuntimePromptSnapshot = {
    ...contextSnapshot,
    conversationContext: conversationContext
      ? {
          snapshotId: conversationContext.id,
          version: conversationContext.version,
          tokenEstimate: conversationContext.tokenEstimate,
          stateCardIncluded: true,
          stateCardText: conversationContext.stateCardText,
          snapshotJson: conversationContext.snapshotJson,
          usage: {
            latestUserMessageTokens: runtimePromptParts.estimates.latestUserMessageTokens,
            stateCardTokens: runtimePromptParts.estimates.stateCardTokens,
            runtimeUserPromptTokens: runtimePromptParts.estimates.promptTokens,
          },
        }
      : {
          stateCardIncluded: false,
          usage: {
            latestUserMessageTokens: runtimePromptParts.estimates.latestUserMessageTokens,
            stateCardTokens: 0,
            runtimeUserPromptTokens: runtimePromptParts.estimates.promptTokens,
          },
        },
  };

  await repo.updateTaskCompiledPrompt(taskId, compiledPromptText);
  const compiledRun = await repo.updateTaskRun(run.id, {
    status: 'running',
    contextSnapshot: runtimeContextSnapshot,
  });
  await repo.createRunEvent({
    version: 1,
    runId: run.id,
    taskId,
    timestamp: new Date().toISOString(),
    type: 'run.prompt_prepared',
    severity: 'info',
    actor: 'system',
    message: 'Runtime prompt prepared.',
    data: {
      source: contextSnapshot.source,
      degraded: false,
      digest: contextSnapshot.result.digest,
      charCount: contextSnapshot.result.charCount,
      runtimeLane: runtimeLaneResolution.lane,
      workerKind: runtimeLaneResolution.workerKind,
      runtimeLaneResolution,
    },
  });

  // Track logs in memory and create database event entries
  const runtime = resolveAgentRuntime(runtimeLaneResolution.workerKind);
  const sink = createLedgerSink(run.id);

  // Asynchronously execute runner so that startTaskRun returns immediately
  (async () => {
    try {
      await repo.updateTaskStatus(taskId, 'running');
      const runtimeResult = await runtime.start(
        {
          runId: run.id,
          taskId,
          repositoryId: task.repositoryId,
          repoRoot: repoInfo.localPath,
          compiledPrompt: compiledPromptText,
          latestUserMessage: runtimeLatestUserMessage,
          timeoutSeconds: task.timeoutSeconds ?? 3600,
          safetyPolicy: repoInfo.safetyPolicy || undefined,
          contextSnapshot: runtimeContextSnapshot,
          runtimeOptions: {
            runtimeLane: runtimeLaneResolution.lane,
            runtimeLaneResolution,
          },
        },
        sink
      );
      const latestRunBeforeFinalize = await repo.getTaskRun(run.id);
      const stopWasRequested =
        latestRunBeforeFinalize?.status === 'cancelled' ||
        runtimeResult.terminalState === 'cancelled';

      await repo.createRunEvent({
        version: 1,
        runId: run.id,
        taskId,
        timestamp: new Date().toISOString(),
        type: 'run.runtime_finished',
        severity: 'checkpoint',
        actor: 'runtime',
        message: `Runtime execution finished with terminal status: ${runtimeResult.terminalState}.`,
        data: {
          terminalState: runtimeResult.terminalState,
          stoppedBy: runtimeResult.stoppedBy,
          riskLevel: runtimeResult.riskLevel,
        },
      });

      if (stopWasRequested) {
        const outcome = outcomeFromRuntimeResult(runtimeResult);
        const finalReport = runtimeResult.finalReport || outcome.summary;
        await repo.updateTaskRun(run.id, {
          status: 'cancelled',
          endedAt: new Date(),
          finishedAt: new Date(),
          logContent: runtimeResult.logContent,
          diffPatch: runtimeResult.diffPatch,
          testResults: runtimeResult.testResults,
          finalReport,
          finalJudgment: null,
          summary: runtimeResult.summary || outcome.summary,
        });
        await repo.updateTaskStatus(taskId, 'ready');
        await completeImplementationQueueEntryForRun(run.id, 'cancelled');
        await repo.createTaskMessage({
          taskId,
          runId: run.id,
          role: 'assistant',
          content: finalReport,
          messageType: 'text',
          payloadJson: {
            finalReport,
            summary: runtimeResult.summary || outcome.summary,
            status: 'cancelled',
          },
        });
        await safelyRefreshConversationContext({
          taskId,
          runId: run.id,
          reason: 'run_finished',
        });
        return;
      }

      await repo.updateTaskRun(run.id, {
        status: 'finalizing',
        logContent: runtimeResult.logContent,
        diffPatch: runtimeResult.diffPatch,
        testResults: runtimeResult.testResults,
        finalReport: runtimeResult.finalReport,
        summary: runtimeResult.summary,
      });
      await repo.updateTaskStatus(taskId, 'finalizing');
      await repo.createRunEvent({
        version: 1,
        runId: run.id,
        taskId,
        timestamp: new Date().toISOString(),
        type: 'run.finalizing_started',
        severity: 'info',
        actor: 'system',
        message: 'Runtime result captured.',
        data: { terminalState: runtimeResult.terminalState },
      });

      const outcome = outcomeFromRuntimeResult(runtimeResult);
      const finalReport = runtimeResult.finalReport || outcome.summary;
      await repo.updateTaskRun(run.id, {
        status: outcome.status,
        endedAt: new Date(),
        finishedAt: new Date(),
        finalReport,
        finalJudgment: null,
        summary: runtimeResult.summary || outcome.summary,
      });
      await completeOpenTodosForTerminalRun(
        run.id,
        outcome.status,
        'Runtime finalized successfully before explicit Todo completion.'
      );
      await repo.updateTaskStatus(taskId, outcome.status);
      await completeImplementationQueueEntryForRun(run.id, outcome.status);
      if (shouldContinueSessionQueue(outcome.status)) {
        void runSessionQueueForRepository(task.repositoryId);
      }

      await createPlanningArtifactMessageIfNeeded({
        taskId,
        runId: run.id,
        finalReport,
      });
      await repo.createTaskMessage({
        taskId,
        runId: run.id,
        role: 'assistant',
        content: finalReport,
        messageType: 'text',
        payloadJson: {
          finalReport,
          summary: runtimeResult.summary || outcome.summary,
          status: outcome.status,
        },
      });
      await safelyRefreshConversationContext({
        taskId,
        runId: run.id,
        reason: 'run_finished',
      });
    } catch (err: any) {
      console.error(`Error during NativeLocalRunner execution for run ${run.id}:`, err);
      const finalReport = `実行に失敗しました: ${err.message}`;
      await repo.updateTaskStatus(taskId, 'failed');
      await repo.updateTaskRun(run.id, {
        status: 'failed',
        endedAt: new Date(),
        finishedAt: new Date(),
        logContent: `[System Error] ${err.message}`,
        finalReport,
        finalJudgment: null,
        summary: `Execution crashed: ${err.message}`,
      });

      await repo.createTaskMessage({
        taskId,
        runId: run.id,
        role: 'assistant',
        content: finalReport,
        messageType: 'text',
        payloadJson: {
          finalReport,
          summary: `Execution crashed: ${err.message}`,
          status: 'failed',
        },
      });
      await safelyRefreshConversationContext({
        taskId,
        runId: run.id,
        reason: 'run_finished',
      });
    }
  })();

  return compiledRun ?? run;
}

export async function stopTaskRun(runId: string) {
  const run = await repo.getTaskRun(runId);
  if (!run) {
    throw new NotFoundError('Run not found');
  }
  if (!['running', 'context_compiling', 'compiling_context', 'finalizing'].includes(run.status)) {
    return run;
  }

  const runtime = resolveAgentRuntime(run.workerKind as any);
  await runtime.stop(runId);
  await repo.createRunEvent({
    version: 1,
    runId,
    taskId: run.taskId,
    timestamp: new Date().toISOString(),
    type: 'run.stop_requested',
    severity: 'warning',
    actor: 'human',
    message: 'User requested run stop from the composer.',
    data: {
      workerKind: run.workerKind,
      previousStatus: run.status,
    },
  });
  const stoppedRun = await repo.updateTaskRun(runId, {
    status: 'cancelled',
    endedAt: new Date(),
    finishedAt: new Date(),
    summary: run.summary || 'Run stop requested by user.',
    finalReport: run.finalReport || 'Run stop requested by user.',
  });
  await repo.updateTaskStatus(run.taskId, 'ready');
  await completeImplementationQueueEntryForRun(runId, 'cancelled');
  return stoppedRun ?? run;
}

function getSessionQueueMaxConcurrency() {
  const parsed = Number(process.env.SESSION_QUEUE_MAX_CONCURRENCY || 2);
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(1, Math.floor(parsed));
}

export function shouldContinueSessionQueue(status: string) {
  return ['completed', 'cancelled', 'failed'].includes(status);
}

let implementationQueueDrainPromise: Promise<void> | null = null;

export async function runImplementationQueue() {
  if (implementationQueueDrainPromise) {
    await implementationQueueDrainPromise;
    return [];
  }
  const started: Awaited<ReturnType<typeof startTaskRun>>[] = [];
  implementationQueueDrainPromise = drainImplementationQueue(started).finally(() => {
    implementationQueueDrainPromise = null;
  });
  await implementationQueueDrainPromise;
  return started;
}

async function drainImplementationQueue(started: Awaited<ReturnType<typeof startTaskRun>>[]) {
  while (true) {
    const settings = await repo.getImplementationQueueSettings();
    const claimed = await repo.claimNextImplementationQueueEntry(settings.processorCount);
    if (!claimed) break;
    try {
      const run = await startTaskRun(claimed.taskId);
      started.push(run);
      await repo.updateImplementationQueueEntry(claimed.id, {
        status: 'processing',
        activeRunId: run.id,
        lastHeartbeatAt: new Date(),
      });
      await repo.createTaskMessage({
        taskId: claimed.taskId,
        runId: run.id,
        role: 'system',
        content: `Implementation Queue processor ${claimed.processorSlot ?? 1} started this run.`,
        messageType: 'text',
        payloadJson: {
          source: 'implementation_queue',
          status: 'processing',
          queueEntryId: claimed.id,
          processorSlot: claimed.processorSlot,
        },
      });
    } catch (err) {
      await repo.updateImplementationQueueEntry(claimed.id, {
        status: 'failed',
        processorSlot: null,
        statusReason: err instanceof Error ? err.message : String(err),
      });
      await repo.createTaskMessage({
        taskId: claimed.taskId,
        role: 'system',
        content: `Implementation Queue failed to start this task: ${
          err instanceof Error ? err.message : String(err)
        }`,
        messageType: 'text',
        payloadJson: {
          source: 'implementation_queue',
          status: 'failed_to_start',
          queueEntryId: claimed.id,
        },
      });
      break;
    }
  }
}

export async function completeImplementationQueueEntryForRun(runId: string, status: string) {
  try {
    const entry = await repo.getImplementationQueueEntryForRun(runId);
    if (!entry) return;
    const nextStatus =
      status === 'completed'
        ? 'execution_completed'
        : status === 'cancelled'
          ? 'cancelled'
          : status === 'needs_human'
            ? 'needs_human'
            : 'failed';
    await repo.updateImplementationQueueEntry(entry.id, {
      status: nextStatus,
      processorSlot: null,
      lastHeartbeatAt: new Date(),
      statusReason: nextStatus === 'failed' ? `Run finished with status=${status}` : null,
    });
    if (['execution_completed', 'cancelled', 'failed'].includes(nextStatus)) {
      void runImplementationQueue();
    }
  } catch {
    // Queue bookkeeping must not change the run outcome.
  }
}

export async function archiveImplementationQueueEntryForRun(runId: string) {
  try {
    const entry = await repo.getImplementationQueueEntryForRun(runId);
    if (!entry || !['execution_completed', 'failed', 'cancelled'].includes(entry.status)) return;
    await repo.updateImplementationQueueEntry(entry.id, {
      status: 'execution_archived',
      processorSlot: null,
      archivedAt: new Date(),
    });
  } catch {
    // Queue archive bookkeeping must not change the review outcome.
  }
}

const pendingSessionQueueRepositoryIds = new Set<string>();
let sessionQueueDrainPromise: Promise<void> | null = null;

export async function runSessionQueueForRepository(repositoryId: string) {
  const started: Awaited<ReturnType<typeof startTaskRun>>[] = [];
  pendingSessionQueueRepositoryIds.add(repositoryId);
  if (sessionQueueDrainPromise) {
    await sessionQueueDrainPromise;
    return started;
  }

  sessionQueueDrainPromise = drainPendingSessionQueues(started).finally(() => {
    sessionQueueDrainPromise = null;
  });
  await sessionQueueDrainPromise;
  return started;
}

async function drainPendingSessionQueues(started: Awaited<ReturnType<typeof startTaskRun>>[]) {
  while (pendingSessionQueueRepositoryIds.size > 0) {
    const repositoryIds = [...pendingSessionQueueRepositoryIds];
    pendingSessionQueueRepositoryIds.clear();
    for (const repositoryId of repositoryIds) {
      started.push(...(await drainSessionQueueForRepository(repositoryId)));
    }
  }
}

async function drainSessionQueueForRepository(repositoryId: string) {
  const repository = await repo.getRepository(repositoryId);
  if (!repository?.queueEnabled) return [];

  const started: Awaited<ReturnType<typeof startTaskRun>>[] = [];
  while (true) {
    const globalActive = await repo.countActiveTaskRuns();
    const globalLimit = getSessionQueueMaxConcurrency();
    if (globalActive >= globalLimit) break;

    const projectActive = await repo.countActiveTaskRuns(repositoryId);
    const projectLimit = Math.max(1, Math.floor(repository.maxConcurrentSessions || 1));
    if (projectActive >= projectLimit) break;

    const nextTask = await repo.claimNextQueuedTask(repositoryId);
    if (!nextTask) break;

    try {
      const run = await startTaskRun(nextTask.id);
      started.push(run);
    } catch (err) {
      await repo.updateTaskStatus(nextTask.id, 'failed');
      await repo.createTaskMessage({
        taskId: nextTask.id,
        role: 'system',
        content: `Session queue failed to start this task: ${err instanceof Error ? err.message : String(err)}`,
        messageType: 'text',
        payloadJson: { source: 'session_queue', status: 'failed_to_start' },
      });
      break;
    }
  }
  return started;
}
