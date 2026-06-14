import fs from 'node:fs/promises';
import { AppError, NotFoundError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { getCurrentSettings } from '../../routes/settings';
import { createLedgerSink } from '../../services/agent-runtime/ledger-sink';
import {
  resolveAgentRuntime,
  resolveRuntimeLaneDefinition,
} from '../../services/agent-runtime/registry';
import {
  type RuntimeLaneResolution,
  readRuntimeLaneConfigFromEnv,
  resolveRuntimeLane,
} from '../../services/agent-runtime/runtime-lane';
import {
  buildOpenTodoRuntimeContractWarning,
  mergeRuntimeContractSnapshot,
  normalizeRuntimeContractWarnings,
} from '../../services/agent-runtime/shared';
import type { AgentRuntimeKind, AgentRuntimeResult } from '../../services/agent-runtime/types';
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
import { getSessionQueueMaxConcurrencyFromEnv } from '../../services/runtime-env';
import {
  type ResolvedStructuredLlmRoute,
  resolveStructuredLlmRoleRoute,
} from '../../services/structured-llm/role-routing';
import { normalizeStructuredLlmModelTarget } from '../../services/structured-llm/selection';
import {
  readStructuredLlmProviderSettings,
  type StructuredLlmModelTarget,
} from '../../services/structured-llm/settings';
import { digestText } from '../../services/text-digest';
import type { RuntimePromptSnapshot } from '../../services/todo-context';
import {
  buildStandardImplementationTodoList,
  evaluateTodoCompletionGate,
} from '../../services/todo-runtime';
import {
  outcomeFromRuntimeResult,
  resolveBlueprintPlanningReadiness,
} from './nightworkers.basic.service';
import * as repo from './nightworkers.repository';
import { createPlanningArtifactMessageIfNeeded } from './nightworkers.workbench.service';

export const runStatusTransitionTable = {
  ready: ['queued', 'running'],
  queued: ['running', 'ready', 'cancelled'],
  running: ['finalizing', 'needs_human', 'failed', 'cancelled'],
  finalizing: ['needs_review', 'completed', 'failed', 'needs_human', 'cancelled'],
  needs_review: ['completed', 'failed', 'needs_human'],
  completed: [],
  failed: [],
  needs_human: ['queued', 'running', 'failed', 'cancelled'],
  cancelled: ['queued', 'running'],
  timed_out: ['queued', 'running', 'failed'],
} as const satisfies Record<string, readonly string[]>;

export function assertRunStatusTransition(from: string, to: string) {
  if (from === to) return;
  const transitionTable: Record<string, readonly string[]> = runStatusTransitionTable;
  const allowed = transitionTable[from];
  if (!allowed?.includes(to)) {
    throw new AppError(
      409,
      'INVALID_RUN_STATUS_TRANSITION',
      `Invalid run status transition: ${from} -> ${to}`
    );
  }
}

function listOpenTodos<TTodo extends { status: string }>(todos: TTodo[]) {
  return todos.filter((todo) => todo.status === 'pending' || todo.status === 'running');
}

async function markRunningTodosNeedsHuman(input: {
  runId: string;
  taskId: string;
  todos: Array<{
    id: string;
    seq: number;
    title: string;
    description?: string | null;
    taskType: string;
    status: string;
    procedureId?: string | null;
    procedureSnapshot?: unknown;
  }>;
  runtimeResult: AgentRuntimeResult;
  outcomeStatus: string;
}) {
  const runningTodos = input.todos.filter((todo) => todo.status === 'running');
  if (runningTodos.length === 0) return;
  const completedAt = new Date();
  const statusReason = input.runtimeResult.finalReport || input.runtimeResult.summary;
  await Promise.all(
    runningTodos.map((todo) =>
      repo.updateTaskRunTodo(
        todo.id,
        {
          status: 'needs_human',
          statusReason: statusReason || 'Runtime stopped and requires human review.',
          completionGateResult: evaluateTodoCompletionGate({
            todo,
            runtimeResult: input.runtimeResult,
            outcomeStatus: input.outcomeStatus,
          }),
          completedAt,
        },
        { notifyTaskId: input.taskId, notifyRunId: input.runId }
      )
    )
  );
}

async function closeOpenTodosForCancelledRun(input: {
  runId: string;
  taskId: string;
  todos: Array<{
    id: string;
    seq: number;
    title: string;
    taskType: string;
    status: string;
    procedureId?: string | null;
    startedAt?: unknown;
  }>;
  evidence?: string;
}) {
  const openTodos = listOpenTodos(input.todos);
  if (openTodos.length === 0) return;

  const completedAt = new Date();
  await Promise.all(
    openTodos.map(async (todo) => {
      const status = todo.status === 'running' ? 'failed' : 'skipped';
      const reason =
        status === 'failed'
          ? 'Run was cancelled while this Todo was active.'
          : 'Skipped because the run was cancelled before this Todo started.';
      const completionGateResult = {
        version: 1,
        todoId: todo.id,
        todoSeq: todo.seq,
        procedureId: todo.procedureId ?? null,
        status,
        passed: false,
        reason,
        checks: [
          {
            id: 'run_cancelled',
            passed: false,
            evidence: input.evidence || 'cancelled',
          },
        ],
        evidence: {
          terminalState: 'cancelled',
          stoppedBy: 'cancelled',
          riskLevel: 'medium',
          summaryDigest: digestText(reason),
        },
      };
      await repo.updateTaskRunTodo(
        todo.id,
        {
          status,
          statusReason: reason,
          completionGateResult,
          completedAt,
          startedAt: todo.startedAt ? new Date(String(todo.startedAt)) : completedAt,
        },
        { notifyTaskId: input.taskId, notifyRunId: input.runId }
      );
      await repo.createRunEvent({
        version: 1,
        runId: input.runId,
        taskId: input.taskId,
        timestamp: new Date().toISOString(),
        type: 'turn.finished',
        severity: status === 'failed' ? 'warning' : 'info',
        actor: 'system',
        message: `Todo #${todo.seq} ${status} because the run was cancelled: ${todo.title}`,
        data: {
          todoId: todo.id,
          todoSeq: todo.seq,
          todoTitle: todo.title,
          taskType: todo.taskType,
          procedureId: todo.procedureId ?? null,
          completionGateResult,
        },
      });
    })
  );
}

function isPlanningOnlyRun<TTodo extends { taskType: string }>(todos: TTodo[]) {
  return todos.length === 0;
}

const IMPLEMENTATION_PHASE_PREAMBLE = [
  '実装フェーズに移行しました。',
  'plan mode はこの時点で終了です。',
  'ここからは計画相談ではなく、実装・検証・必要な修正・closeout まで最後までやり切ってください。',
  'Todo を作成・更新する場合も、この実装フェーズ前提で進めてください。',
].join('\n');

function injectImplementationPhaseContext(latestUserMessage: string) {
  return `${IMPLEMENTATION_PHASE_PREAMBLE}\n\n${latestUserMessage}`.trim();
}

function readMessageLlmRouteOverride(
  message: Awaited<ReturnType<typeof repo.listTaskMessages>>[number] | undefined
): StructuredLlmModelTarget | null {
  const metadata =
    message?.metadataJson &&
    typeof message.metadataJson === 'object' &&
    !Array.isArray(message.metadataJson)
      ? (message.metadataJson as Record<string, unknown>)
      : {};
  return normalizeStructuredLlmModelTarget(metadata.llmSelection);
}

function resolveRuntimeLaneForImplementationRoute(
  fallback: RuntimeLaneResolution,
  route: ResolvedStructuredLlmRoute | null
): RuntimeLaneResolution {
  if (!route) return fallback;
  const lane = route.providerId === 'codex' ? 'codex-sdk' : 'native-supervisor';
  return {
    lane,
    workerKind: lane === 'codex-sdk' ? 'codex-agent' : 'native-local',
    source: 'role_route',
    diagnostics: [
      ...fallback.diagnostics,
      {
        level: 'info',
        message: `Role Routing selected ${lane} for implementation via ${route.source}: ${route.providerEndpointId}/${route.model}.`,
      },
    ],
  };
}

function summarizeResolvedRoute(route: ResolvedStructuredLlmRoute) {
  return {
    role: route.role,
    providerEndpointId: route.providerEndpointId,
    providerId: route.providerId,
    model: route.model,
    thinkingDepth: route.thinkingDepth || null,
    source: route.source,
    diagnostics: route.diagnostics,
  };
}

async function safelyRefreshConversationContext(input: RefreshConversationContextInput) {
  if (!isConversationContextBuildOnIdleEnabled()) return;
  try {
    await refreshConversationContextSnapshot(input);
  } catch (error) {
    logger.warn(
      {
        error: toErrorMessage(error),
        taskId: input.taskId,
        runId: input.runId,
      },
      'conversation context refresh failed'
    );
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
    logger.warn(
      {
        error: toErrorMessage(error),
        taskId,
      },
      'conversation context load failed'
    );
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
  const llmRouteOverride = readMessageLlmRouteOverride(lastUserMessage);
  const compiledPromptText = lastUserMessage?.content || task.description || task.objective || '';
  if (!compiledPromptText.trim()) {
    throw new AppError(400, 'EMPTY_PROMPT', 'No user message found to start a run');
  }
  const blueprintReadiness = await resolveBlueprintPlanningReadiness(taskId);
  const settings = getCurrentSettings();
  const baseRuntimeLaneResolution = resolveRuntimeLane({
    settingsRuntimeLane: settings.IMPLEMENTATION_RUNTIME_LANE,
    activeLlmProvider: settings.ACTIVE_LLM_PROVIDER,
    codexEnabled: settings.CODEX_ENABLED,
    ...readRuntimeLaneConfigFromEnv(),
  });
  const implementationLlmRoute = resolveStructuredLlmRoleRoute({
    role: 'implementation',
    settings: readStructuredLlmProviderSettings(),
    override: llmRouteOverride,
  });
  const runtimeLaneResolution = resolveRuntimeLaneForImplementationRoute(
    baseRuntimeLaneResolution,
    implementationLlmRoute
  );
  const runtimeLaneDefinition = resolveRuntimeLaneDefinition(runtimeLaneResolution.lane);
  const effectiveLlmRouting = {
    implementation: implementationLlmRoute ? summarizeResolvedRoute(implementationLlmRoute) : null,
    override: llmRouteOverride,
  };
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
      effectiveLlmRouting,
    },
    startedAt: new Date(),
  });
  const runtimeLaneSetupInput = {
    compiledPromptText,
    runtimeLaneResolution,
    implementationLlmRoute,
    llmRouteOverride,
  };
  const initialTodos = runtimeLaneDefinition.buildInitialTodos(runtimeLaneSetupInput);
  await repo.replaceTaskRunTodosForRun(
    run.id,
    buildStandardImplementationTodoList({
      todos: initialTodos,
      startFirst: true,
    })
  );

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
      effectiveLlmRouting,
    },
  });
  await repo.createRunEvent({
    version: 1,
    runId: run.id,
    taskId,
    timestamp: new Date().toISOString(),
    type: 'system.info',
    severity: 'info',
    actor: 'system',
    message: implementationLlmRoute
      ? `Implementation LLM route resolved: ${implementationLlmRoute.model} (${implementationLlmRoute.providerEndpointId}).`
      : 'Implementation LLM route was not configured; using runtime lane defaults.',
    data: {
      effectiveLlmRouting,
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
    effectiveLlmRouting,
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

  const rawLatestUserMessage = injectImplementationPhaseContext(
    lastUserMessage?.content || compiledPromptText
  );
  const conversationContext = await maybeLoadConversationStateCard(taskId, lastUserMessage?.id);
  const runtimePromptParts = buildPromptWithStateCardParts({
    latestUserMessage: rawLatestUserMessage,
    stateCardText: conversationContext?.stateCardText,
  });
  const runtimeLatestUserMessage = runtimePromptParts.promptText;
  const runtimeContextSnapshot: RuntimePromptSnapshot = {
    ...contextSnapshot,
    executionPhase: 'implementation',
    planModeClosed: true,
    implementationPhasePreamble: IMPLEMENTATION_PHASE_PREAMBLE,
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
      effectiveLlmRouting,
    },
  });

  // Track logs in memory and create database event entries
  const runtime = runtimeLaneDefinition.createAdapter();
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
          runtimeOptions: runtimeLaneDefinition.buildRuntimeOptions(runtimeLaneSetupInput),
        },
        sink
      );
      const latestRunBeforeFinalize = await repo.getTaskRun(run.id);
      const stopWasRequested =
        latestRunBeforeFinalize?.status === 'cancelled' ||
        runtimeResult.terminalState === 'cancelled';
      const runtimeContractWarnings = normalizeRuntimeContractWarnings(
        runtimeResult.contractWarnings
      );
      const contextSnapshotBeforeFinalize =
        latestRunBeforeFinalize?.contextSnapshot ?? runtimeContextSnapshot;

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
          contractWarnings: runtimeContractWarnings,
        },
      });

      if (stopWasRequested) {
        const outcome = outcomeFromRuntimeResult(runtimeResult);
        const finalReport = runtimeResult.finalReport || outcome.summary;
        const todosBeforeCancelCloseout = await repo.listTaskRunTodosForRun(run.id);
        await closeOpenTodosForCancelledRun({
          runId: run.id,
          taskId,
          todos: todosBeforeCancelCloseout,
          evidence: runtimeResult.stoppedBy || runtimeResult.terminalState,
        });
        assertRunStatusTransition(latestRunBeforeFinalize?.status || 'running', 'cancelled');
        await repo.updateTaskRun(run.id, {
          status: 'cancelled',
          endedAt: new Date(),
          finishedAt: new Date(),
          logContent: runtimeResult.logContent,
          diffPatch: runtimeResult.diffPatch,
          testResults: runtimeResult.testResults,
          contextSnapshot: mergeRuntimeContractSnapshot(
            contextSnapshotBeforeFinalize,
            runtimeContractWarnings,
            { lane: runtimeLaneResolution.lane }
          ),
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

      assertRunStatusTransition(latestRunBeforeFinalize?.status || 'running', 'finalizing');
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
      let finalTodos = await repo.listTaskRunTodosForRun(run.id);
      if (outcome.status === 'needs_human') {
        await markRunningTodosNeedsHuman({
          runId: run.id,
          taskId,
          todos: finalTodos,
          runtimeResult,
          outcomeStatus: outcome.status,
        });
        finalTodos = await repo.listTaskRunTodosForRun(run.id);
      }
      const openTodos = listOpenTodos(finalTodos);
      const todoFinalizationBlocked =
        outcome.status === 'completed' && openTodos.length > 0 && !isPlanningOnlyRun(finalTodos);
      const openTodoWarning = todoFinalizationBlocked
        ? buildOpenTodoRuntimeContractWarning(openTodos)
        : null;
      const finalContractWarnings = openTodoWarning
        ? [...runtimeContractWarnings, openTodoWarning]
        : runtimeContractWarnings;
      const guardedStatus = todoFinalizationBlocked ? 'needs_human' : outcome.status;
      const finalReport = todoFinalizationBlocked
        ? [
            runtimeResult.finalReport || outcome.summary,
            '',
            `Todo closeout incomplete: ${openTodos.map((todo) => `#${todo.seq} ${todo.title} (${todo.status})`).join(', ')}`,
            'Codex contract warning: codex_open_todos_before_completion.',
          ]
            .filter(Boolean)
            .join('\n')
        : runtimeResult.finalReport || outcome.summary;
      assertRunStatusTransition('finalizing', guardedStatus);
      await repo.updateTaskRun(run.id, {
        status: guardedStatus,
        endedAt: new Date(),
        finishedAt: new Date(),
        contextSnapshot: mergeRuntimeContractSnapshot(
          contextSnapshotBeforeFinalize,
          finalContractWarnings,
          { lane: runtimeLaneResolution.lane }
        ),
        finalReport,
        finalJudgment: null,
        summary: todoFinalizationBlocked
          ? 'Runtime finished without explicitly closing all open Todos.'
          : runtimeResult.summary || outcome.summary,
      });
      if (todoFinalizationBlocked) {
        await repo.createRunEvent({
          version: 1,
          runId: run.id,
          taskId,
          timestamp: new Date().toISOString(),
          type: 'run.outcome_decided',
          severity: 'warning',
          actor: 'system',
          message:
            'Runtime finished before explicit Todo closeout; run cannot be marked completed.',
          data: {
            warningCode: 'codex_open_todos_before_completion',
            contractWarning: openTodoWarning,
            terminalState: outcome.status,
            nextStatus: guardedStatus,
            openTodos: openTodos.map((todo) => ({
              id: todo.id,
              seq: todo.seq,
              title: todo.title,
              status: todo.status,
            })),
          },
        });
      }
      await repo.updateTaskStatus(taskId, guardedStatus);
      await completeImplementationQueueEntryForRun(run.id, guardedStatus);
      if (shouldContinueSessionQueue(guardedStatus)) {
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
          status: guardedStatus,
        },
      });
      await safelyRefreshConversationContext({
        taskId,
        runId: run.id,
        reason: 'run_finished',
      });
    } catch (err: unknown) {
      const errorMessage = toErrorMessage(err);
      logger.error({ error: errorMessage, runId: run.id }, 'NativeLocalRunner execution failed');
      const finalReport = `実行に失敗しました: ${errorMessage}`;
      await repo.updateTaskStatus(taskId, 'failed');
      assertRunStatusTransition('running', 'failed');
      await repo.updateTaskRun(run.id, {
        status: 'failed',
        endedAt: new Date(),
        finishedAt: new Date(),
        logContent: `[System Error] ${errorMessage}`,
        finalReport,
        finalJudgment: null,
        summary: `Execution crashed: ${errorMessage}`,
      });

      await repo.createTaskMessage({
        taskId,
        runId: run.id,
        role: 'assistant',
        content: finalReport,
        messageType: 'text',
        payloadJson: {
          finalReport,
          summary: `Execution crashed: ${errorMessage}`,
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

  const runtime = resolveAgentRuntime(normalizeAgentRuntimeKind(run.workerKind));
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
  const todosBeforeCancelCloseout = await repo.listTaskRunTodosForRun(runId);
  await closeOpenTodosForCancelledRun({
    runId,
    taskId: run.taskId,
    todos: todosBeforeCancelCloseout,
    evidence: 'user_stop_requested',
  });
  assertRunStatusTransition(run.status, 'cancelled');
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

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getSessionQueueMaxConcurrency() {
  return getSessionQueueMaxConcurrencyFromEnv();
}

function normalizeAgentRuntimeKind(value: unknown): AgentRuntimeKind {
  if (
    value === 'native-local' ||
    value === 'codex-agent' ||
    value === 'external-process' ||
    value === 'future-adapter'
  ) {
    return value;
  }
  return 'native-local';
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
