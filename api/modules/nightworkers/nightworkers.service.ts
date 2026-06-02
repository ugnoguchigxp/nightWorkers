import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppError, NotFoundError } from '../../lib/errors';
import { createLedgerSink } from '../../services/agent-runtime/ledger-sink';
import { resolveAgentRuntime } from '../../services/agent-runtime/registry';
import type { AgentRuntimeResult } from '../../services/agent-runtime/types';
import { compileContext, evaluateContext } from '../../services/context-still';
import { buildFinalJudgment } from '../../services/final-judgment/build-final-judgment';
import { renderFinalMessage } from '../../services/final-judgment/render-final-message';
import { extractLearningCandidates } from '../../services/memory-feedback/candidate-extractor';
import {
  createLearningCandidateEvent,
  getLearningCandidateFromEvents,
  listLearningCandidatesForRun,
} from '../../services/memory-feedback/candidate-store';
import { evaluateMemoryFeedback } from '../../services/memory-feedback/effectiveness';
import { digestText } from '../../services/memory-feedback/hash';
import { weakMatchCandidateRefs } from '../../services/memory-feedback/injection-matcher';
import { registerApprovedCandidate } from '../../services/memory-feedback/register';
import type {
  ContextCompileSnapshot,
  LearningCandidate,
  RunLedgerView,
} from '../../services/memory-feedback/types';
import { selectProcedureForTaskType, toProcedureSnapshot } from '../../services/procedures';
import { buildReviewResult } from '../../services/review-results/build-review-result';
import { collectDefaultReviewEvidence } from '../../services/review-results/evidence-collector';
import type { ReviewResult, ReviewRunRequest } from '../../services/review-results/types';
import { buildReviewEvidencePackFromRun } from '../../services/review-rubrics/evidence-pack';
import { listRubrics } from '../../services/review-rubrics/loader';
import {
  runReviewerEvaluationFromPack,
  runReviewReplayEvaluation,
  runReviewReplayEvaluationFromJsonl,
} from '../../services/review-rubrics/replay-evaluation';
import type { ReviewerEvaluationMode } from '../../services/review-rubrics/types';
import { decideRunOutcome } from '../../services/run-control/run-outcome-gate';
import { serializeRunToJsonl } from '../../services/run-events/jsonl-export';
import type { RunEventBase } from '../../services/run-events/types';
import { nativeLocalRunner } from '../../services/runner/NativeLocalRunner';
import { planTaskIntake } from '../../services/task-intake';
import { buildTodoContextSnapshot } from '../../services/todo-context';
import {
  appendTodoSummaryToFinalReport,
  buildSkippedTodoGate,
  evaluateTodoCompletionGate,
} from '../../services/todo-runtime';
import * as repo from './nightworkers.repository';

type PlannedTodoRow = Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>[number];

function buildTodoRuntimePrompt(input: { compiledPrompt: string; todo: PlannedTodoRow }) {
  return [
    input.compiledPrompt,
    '',
    'Current Todo Runtime Boundary:',
    `- todoId: ${input.todo.id}`,
    `- seq: ${input.todo.seq}`,
    `- title: ${input.todo.title}`,
    `- taskType: ${input.todo.taskType}`,
    input.todo.description ? `- description: ${input.todo.description}` : null,
    `- procedureId: ${input.todo.procedureId || 'none'}`,
    '',
    'Execute this Todo only. Do not mark later Todos complete. Report evidence for this Todo so the completion gate can evaluate it before the next Todo starts.',
  ]
    .filter(Boolean)
    .join('\n');
}

function combineRuntimeResults(results: AgentRuntimeResult[]): AgentRuntimeResult {
  const latest = results.at(-1);
  if (!latest) {
    return {
      terminalState: 'needs_human',
      summary: 'No executable Todo was available.',
      finalReport: 'No executable Todo was available.',
      stoppedBy: 'missing_tool_call',
      riskLevel: 'medium',
      logContent: '',
      diffPatch: '',
    };
  }
  return {
    ...latest,
    summary: results.map((result, index) => `Todo ${index + 1}: ${result.summary}`).join('\n'),
    finalReport: results
      .map((result, index) => `Todo ${index + 1} report:\n${result.finalReport || result.summary}`)
      .join('\n\n'),
    logContent: results
      .map((result) => result.logContent || '')
      .filter(Boolean)
      .join('\n'),
  };
}

function outcomeFromRuntimeResult(runtimeResult: AgentRuntimeResult) {
  return runtimeResult.terminalState === 'cancelled'
    ? {
        status: 'cancelled' as const,
        reason: 'human_review' as const,
        summary: runtimeResult.summary || 'Run cancelled by runtime.',
      }
    : decideRunOutcome({
        supervisor: {
          finalReport: runtimeResult.finalReport || '',
          terminalState: runtimeResult.terminalState,
          summary:
            runtimeResult.summary || `Runtime finished with status=${runtimeResult.terminalState}`,
          stoppedBy:
            runtimeResult.stoppedBy === 'cancelled' ? 'llm_error' : runtimeResult.stoppedBy,
          riskLevel: runtimeResult.riskLevel,
        },
        budgetStopped: runtimeResult.stoppedBy === 'budget',
        safetyViolation: runtimeResult.stoppedBy === 'policy',
      });
}

// --- Repositories ---
export async function createRepository(data: {
  name: string;
  localPath: string;
  branch?: string;
  allowed?: boolean;
  safetyPolicy?: any;
}) {
  return repo.createRepository({ ...data, branch: data.branch || 'main' });
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
    priority?: number;
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

export type WorkbenchChatIntent =
  | 'discuss'
  | 'draft_spec'
  | 'create_task'
  | 'queue'
  | 'run_task'
  | 'adjust_running'
  | 'review_followup'
  | 'learning_capture';

export async function appendWorkbenchMessage(
  id: string,
  input: { prompt: string; intent?: WorkbenchChatIntent }
) {
  const intent = input.intent || 'discuss';
  const task = await repo.getTask(id);
  if (!task) throw new NotFoundError('Task not found');
  const prompt = input.prompt.trim();
  if (!prompt) throw new AppError(400, 'EMPTY_PROMPT', 'Prompt must not be empty');

  if (intent === 'run_task') {
    assertRunnableWorkbenchTask(task);
    await appendTaskMessage(id, prompt);
    const run = await startTaskRun(id);
    return {
      task: await repo.getTask(id),
      run,
      messages: await repo.listTaskMessages(id),
    };
  }

  await appendTaskMessage(id, prompt);

  if (intent === 'draft_spec') {
    const title =
      task.title === 'New Session' ? prompt.replace(/\s+/g, ' ').slice(0, 60) : task.title;
    const markdown = [
      `# ${title}`,
      '',
      '## Request',
      prompt,
      '',
      '## Draft',
      'この内容を Session の仕様ドラフトとして保持しました。必要な objective / acceptance criteria を補って Queue に入れてください。',
    ].join('\n');
    await repo.createTaskMessage({
      taskId: id,
      role: 'assistant',
      content: markdown,
      messageType: 'markdown_document',
      payloadJson: {
        intent: 'draft_spec',
        title,
        source: 'workbench',
      },
    });
    const updated = await repo.updateTask(id, {
      title,
      objective: task.objective || prompt,
      acceptanceCriteria:
        task.acceptanceCriteria || 'User reviews this draft, then explicitly queues or runs it.',
      status: task.status === 'draft' ? 'ready' : task.status,
    });
    return { task: updated, run: null, messages: await repo.listTaskMessages(id) };
  }

  if (intent === 'queue' || intent === 'create_task') {
    const queued = await queueTask(id);
    return { task: queued, run: null, messages: await repo.listTaskMessages(id) };
  }

  if (intent === 'review_followup') {
    await repo.createTaskMessage({
      taskId: id,
      role: 'assistant',
      content:
        'レビュー後の追加依頼として記録しました。内容を確認して Queue または Run を明示してください。',
      messageType: 'text',
      payloadJson: { intent: 'review_followup', source: 'workbench' },
    });
  }

  if (intent === 'learning_capture') {
    await repo.createTaskMessage({
      taskId: id,
      role: 'assistant',
      content: '学習候補の整理依頼として記録しました。登録は明示承認後に行います。',
      messageType: 'text',
      payloadJson: { intent: 'learning_capture', requiresApproval: true, source: 'workbench' },
    });
  }

  return { task: await repo.getTask(id), run: null, messages: await repo.listTaskMessages(id) };
}

function assertRunnableWorkbenchTask(task: Awaited<ReturnType<typeof repo.getTask>>) {
  if (!task) throw new NotFoundError('Task not found');
  if (!['queued', 'ready'].includes(task.status)) {
    throw new AppError(
      409,
      'TASK_NOT_READY_TO_RUN',
      'Workbench runs require a ready or queued task. Discuss or draft first, then queue the task.'
    );
  }
  assertTaskDraftComplete(task);
}

function assertTaskDraftComplete(task: Awaited<ReturnType<typeof repo.getTask>>) {
  if (!task) throw new NotFoundError('Task not found');
  const missing = [
    !task.title?.trim() || task.title === 'New Session' ? 'title' : null,
    !task.objective?.trim() ? 'objective' : null,
    !task.acceptanceCriteria?.trim() ? 'acceptanceCriteria' : null,
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new AppError(422, 'TASK_DRAFT_INCOMPLETE', `Missing draft fields: ${missing.join(', ')}`);
  }
}

export async function queueTask(id: string) {
  const task = await repo.getTask(id);
  if (!task) throw new NotFoundError('Task not found');
  assertTaskDraftComplete(task);
  const queued = await repo.updateTask(id, { status: 'queued' });
  if (!queued) throw new NotFoundError('Task not found');
  return queued;
}

export async function startWorkbenchTaskRun(taskId: string) {
  const task = await repo.getTask(taskId);
  assertRunnableWorkbenchTask(task);
  return startTaskRun(taskId);
}

export async function createWorkbenchSession(data: {
  repositoryId: string;
  title?: string;
  description?: string | null;
  objective?: string | null;
  acceptanceCriteria?: string | null;
  timeoutSeconds?: number;
  priority?: number;
  createdBy?: string | null;
}) {
  return createTask({
    repositoryId: data.repositoryId,
    title: data.title?.trim() || 'New Session',
    description: data.description || '',
    objective: data.objective || '',
    acceptanceCriteria: data.acceptanceCriteria || '',
    timeoutSeconds: data.timeoutSeconds,
    priority: data.priority,
    createdBy: data.createdBy,
  });
}

export async function archiveTask(id: string) {
  const task = await repo.getTask(id);
  if (!task) throw new NotFoundError('Task not found');
  if (['completed', 'cancelled', 'failed'].includes(task.status)) return task;
  const archived = await repo.updateTask(id, { status: 'cancelled' });
  if (!archived) throw new NotFoundError('Task not found');
  return archived;
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
  let compiledPromptText = lastUserMessage?.content || task.description || task.objective || '';
  let contextSource: 'context-still' | 'fallback' = 'fallback';
  if (!compiledPromptText.trim()) {
    throw new AppError(400, 'EMPTY_PROMPT', 'No user message found to start a run');
  }
  const run = await repo.createTaskRun({
    taskId,
    repositoryId: task.repositoryId,
    status: 'context_compiling',
    workerKind: 'native-local',
    timeoutSeconds: task.timeoutSeconds,
    contextSnapshot: { compiledPrompt: compiledPromptText },
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
    message: 'Task run created. Context compile is starting.',
    data: { contextSource },
  });

  const intakePlan = await planTaskIntake({
    taskTitle: task.title,
    taskDescription: task.description || task.objective || null,
    latestUserMessage: lastUserMessage?.content || compiledPromptText,
    maxTodos: 8,
  });
  for (const todo of intakePlan.todos) {
    const procedure = await selectProcedureForTaskType(todo.taskType);
    await repo.createTaskRunTodo({
      runId: run.id,
      seq: todo.seq,
      title: todo.title,
      description: todo.description,
      taskType: todo.taskType,
      status: todo.status,
      procedureId: procedure.id,
      procedureSnapshot: toProcedureSnapshot(procedure),
      dependsOn: todo.dependsOn,
      statusReason: todo.statusReason,
    });
  }
  if (intakePlan.warnings.length > 0) {
    await repo.createRunEvent({
      version: 1,
      runId: run.id,
      taskId,
      timestamp: new Date().toISOString(),
      type: 'system.warning',
      severity: 'warning',
      actor: 'system',
      message: 'Task intake planner completed with fallback or compression warnings.',
      data: {
        intakeSource: intakePlan.source,
        warningCodes: intakePlan.warnings,
        todoCount: intakePlan.todos.length,
      },
    });
  }

  const compileResult = await compileContext({
    repositoryPath: repoInfo.localPath,
    taskTitle: task.title,
    taskDescription: compiledPromptText,
    taskId,
    runId: run.id,
  });
  compiledPromptText = compileResult.compiledPromptText;
  contextSource = compileResult.degraded ? 'fallback' : 'context-still';
  const previousRuns = (await repo.listTaskRunsForTask(taskId)).filter(
    (taskRun) => taskRun.id !== run.id
  );
  const previousCandidates: LearningCandidate[] = [];
  for (const previousRun of previousRuns) {
    const previousEvents = await repo.listTaskEventsForRun(previousRun.id);
    previousCandidates.push(
      ...listLearningCandidatesForRun(previousEvents).filter((candidate) =>
        ['approved', 'registered'].includes(candidate.status)
      )
    );
  }
  const weakMatchedRefs =
    compileResult.includedMemoryRefs.length === 0
      ? weakMatchCandidateRefs({ compiledText: compiledPromptText, candidates: previousCandidates })
      : [];
  const includedMemoryRefs = [...compileResult.includedMemoryRefs, ...weakMatchedRefs];
  const contextSnapshot: ContextCompileSnapshot = {
    compiledPrompt: compiledPromptText,
    source: contextSource,
    degraded: compileResult.degraded,
    degradedReason: compileResult.degradedReason,
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
      sourceMetadata: compileResult.sourceMetadata,
      includedMemoryRefs,
    },
  };

  await repo.updateTaskCompiledPrompt(taskId, compiledPromptText);
  const plannedTodos = await repo.listTaskRunTodosForRun(run.id);
  for (const todo of plannedTodos) {
    await repo.updateTaskRunTodo(todo.id, {
      contextSnapshot: buildTodoContextSnapshot({
        todo: {
          id: todo.id,
          seq: todo.seq,
          title: todo.title,
          description: todo.description,
          taskType: todo.taskType,
          procedureId: todo.procedureId,
          procedureSnapshot: todo.procedureSnapshot as any,
        },
        runContext: contextSnapshot,
        previousTodoSummaries: plannedTodos
          .filter((candidate) => candidate.seq < todo.seq)
          .map((candidate) => ({
            id: candidate.id,
            seq: candidate.seq,
            title: candidate.title,
            status: candidate.status,
            summary: null,
          })),
      }),
    });
  }
  const compiledRun = await repo.updateTaskRun(run.id, {
    status: 'running',
    contextSnapshot,
  });
  await repo.createRunEvent({
    version: 1,
    runId: run.id,
    taskId,
    timestamp: new Date().toISOString(),
    type: 'run.context_compiled',
    severity: 'info',
    actor: 'system',
    message: compileResult.degraded
      ? 'Context compile completed with degraded fallback.'
      : 'Context compile completed.',
    data: {
      source: contextSource,
      degraded: compileResult.degraded,
      degradedReason: compileResult.degradedReason,
      digest: contextSnapshot.result.digest,
      charCount: contextSnapshot.result.charCount,
    },
  });
  await repo.createRunEvent({
    version: 1,
    runId: run.id,
    taskId,
    timestamp: new Date().toISOString(),
    type: 'memory.context_injected',
    severity: compileResult.degraded ? 'warning' : 'info',
    actor: 'system',
    message: includedMemoryRefs.length
      ? `Context compile included ${includedMemoryRefs.length} memory source refs.`
      : 'Context compile completed without memory source refs.',
    data: {
      runId: run.id,
      source: contextSource,
      degraded: compileResult.degraded,
      degradedReason: compileResult.degradedReason,
      compiledContextDigest: contextSnapshot.result.digest,
      includedSourceRefs: includedMemoryRefs,
      charCount: contextSnapshot.result.charCount,
    },
  });

  // Track logs in memory and create database event entries
  const runtime = resolveAgentRuntime('native-local');
  const sink = createLedgerSink(run.id);

  // Asynchronously execute runner so that startTaskRun returns immediately
  (async () => {
    try {
      await repo.updateTaskStatus(taskId, 'running');
      const runtimeResults: AgentRuntimeResult[] = [];
      const todoStatuses = new Map(plannedTodos.map((todo) => [todo.id, todo.status]));
      let terminalOutcome: ReturnType<typeof outcomeFromRuntimeResult> | null = null;

      for (const todo of plannedTodos) {
        if (todoStatuses.get(todo.id) === 'needs_human') {
          terminalOutcome = {
            status: 'needs_human' as const,
            reason: 'human_review' as const,
            summary: todo.statusReason || `Todo #${todo.seq} requires human input.`,
          };
          break;
        }

        await repo.updateTaskRunTodo(todo.id, {
          status: 'running',
          statusReason: 'Runtime execution started for this Todo.',
          startedAt: new Date(),
        });
        todoStatuses.set(todo.id, 'running');
        await repo.createRunEvent({
          version: 1,
          runId: run.id,
          taskId,
          timestamp: new Date().toISOString(),
          type: 'turn.started',
          severity: 'info',
          actor: 'system',
          message: `Todo #${todo.seq} started: ${todo.title}`,
          data: {
            todoId: todo.id,
            todoSeq: todo.seq,
            todoTitle: todo.title,
            taskType: todo.taskType,
            procedureId: todo.procedureId,
          },
        });

        const runtimeResult = await runtime.start(
          {
            runId: run.id,
            taskId,
            repositoryId: task.repositoryId,
            repoRoot: repoInfo.localPath,
            compiledPrompt: buildTodoRuntimePrompt({ compiledPrompt: compiledPromptText, todo }),
            latestUserMessage: lastUserMessage?.content || compiledPromptText,
            timeoutSeconds: task.timeoutSeconds ?? 3600,
            safetyPolicy: repoInfo.safetyPolicy || undefined,
            contextSnapshot,
            currentTodo: {
              id: todo.id,
              seq: todo.seq,
              title: todo.title,
              taskType: todo.taskType,
              status: todoStatuses.get(todo.id) || todo.status,
              procedureId: todo.procedureId,
            },
            todoPlan: plannedTodos.map((candidate) => {
              const procedureSnapshot = candidate.procedureSnapshot as
                | { digest?: string; id?: string }
                | null
                | undefined;
              return {
                id: candidate.id,
                seq: candidate.seq,
                title: candidate.title,
                description: candidate.description,
                taskType: candidate.taskType,
                status: todoStatuses.get(candidate.id) || candidate.status,
                procedureId: candidate.procedureId,
                procedureDigest: procedureSnapshot?.digest || null,
                contextDigest: contextSnapshot.result.digest,
              };
            }),
          },
          sink
        );
        runtimeResults.push(runtimeResult);

        await repo.createRunEvent({
          version: 1,
          runId: run.id,
          taskId,
          timestamp: new Date().toISOString(),
          type: 'run.runtime_finished',
          severity: 'checkpoint',
          actor: 'runtime',
          message: `Runtime execution finished for Todo #${todo.seq} with terminal status: ${runtimeResult.terminalState}.`,
          data: {
            todoId: todo.id,
            todoSeq: todo.seq,
            procedureId: todo.procedureId,
            terminalState: runtimeResult.terminalState,
            stoppedBy: runtimeResult.stoppedBy,
            riskLevel: runtimeResult.riskLevel,
          },
        });

        const todoOutcome = outcomeFromRuntimeResult(runtimeResult);
        const gate = evaluateTodoCompletionGate({
          todo,
          runtimeResult,
          outcomeStatus: todoOutcome.status,
        });
        const status = gate.status === 'passed' ? 'passed' : gate.status;
        const completedAt = new Date();
        await repo.updateTaskRunTodo(todo.id, {
          status,
          statusReason: gate.reason,
          completionGateResult: {
            ...gate,
            status,
            passed: status === 'passed',
          },
          completedAt,
        });
        todoStatuses.set(todo.id, status);
        await repo.createRunEvent({
          version: 1,
          runId: run.id,
          taskId,
          timestamp: new Date().toISOString(),
          type: 'turn.finished',
          severity: status === 'passed' ? 'checkpoint' : 'warning',
          actor: 'system',
          message: `Todo #${todo.seq} ${status}: ${todo.title}`,
          data: {
            todoId: todo.id,
            todoSeq: todo.seq,
            todoTitle: todo.title,
            taskType: todo.taskType,
            procedureId: todo.procedureId,
            completionGateResult: {
              ...gate,
              status,
              passed: status === 'passed',
            },
          },
        });

        if (status !== 'passed') {
          terminalOutcome = todoOutcome;
          for (const skippedTodo of plannedTodos.filter((candidate) => candidate.seq > todo.seq)) {
            if (
              ['passed', 'failed', 'skipped', 'needs_human'].includes(
                todoStatuses.get(skippedTodo.id) || ''
              )
            ) {
              continue;
            }
            const skippedGate = buildSkippedTodoGate({
              todo: skippedTodo,
              reason: 'Skipped because an earlier Todo did not pass the runtime completion gate.',
              runtimeResult,
            });
            await repo.updateTaskRunTodo(skippedTodo.id, {
              status: 'skipped',
              statusReason: skippedGate.reason,
              completionGateResult: skippedGate,
              completedAt: new Date(),
            });
            todoStatuses.set(skippedTodo.id, 'skipped');
            await repo.createRunEvent({
              version: 1,
              runId: run.id,
              taskId,
              timestamp: new Date().toISOString(),
              type: 'turn.finished',
              severity: 'info',
              actor: 'system',
              message: `Todo #${skippedTodo.seq} skipped: ${skippedTodo.title}`,
              data: {
                todoId: skippedTodo.id,
                todoSeq: skippedTodo.seq,
                todoTitle: skippedTodo.title,
                taskType: skippedTodo.taskType,
                procedureId: skippedTodo.procedureId,
                completionGateResult: skippedGate,
              },
            });
          }
          break;
        }
      }

      const runtimeResult = combineRuntimeResults(runtimeResults);

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
        message: 'Runtime result captured. Building final judgment.',
        data: { terminalState: runtimeResult.terminalState },
      });

      const outcome = terminalOutcome ?? outcomeFromRuntimeResult(runtimeResult);
      const finalizedTodos = await repo.listTaskRunTodosForRun(run.id);
      const finalReportWithTodos = appendTodoSummaryToFinalReport({
        finalReport: runtimeResult.finalReport || '',
        todos: finalizedTodos,
      });
      const finalJudgment = buildFinalJudgment({
        runId: run.id,
        taskId,
        outcomeStatus: outcome.status,
        outcomeSummary: outcome.summary,
        supervisor: {
          finalReport: finalReportWithTodos,
          summary: runtimeResult.summary,
          terminalState: runtimeResult.terminalState,
          stoppedBy: runtimeResult.stoppedBy,
          riskLevel: runtimeResult.riskLevel,
        },
      });
      const finalMessage = renderFinalMessage(finalJudgment);
      await repo.updateTaskRun(run.id, {
        status: outcome.status,
        endedAt: new Date(),
        finishedAt: new Date(),
        finalReport: finalReportWithTodos || finalJudgment.conclusion,
        finalJudgment,
        summary: runtimeResult.summary || outcome.summary,
      });
      await repo.updateTaskStatus(taskId, outcome.status);

      await repo.createRunEvent({
        version: 1,
        runId: run.id,
        taskId,
        timestamp: new Date().toISOString(),
        type: 'run.final_judgment_created',
        severity: 'checkpoint',
        actor: 'system',
        message: `Final judgment created: ${finalJudgment.title}`,
        data: { finalJudgment },
      });
      await repo.createRunEvent(
        {
          version: 1,
          runId: run.id,
          taskId,
          timestamp: new Date().toISOString(),
          type: 'run.outcome_decided',
          severity: 'info',
          actor: 'system',
          message: `Run outcome decided: ${outcome.status} (${outcome.reason})`,
          data: outcome as Record<string, unknown>,
        },
        { legacyPayload: outcome }
      );

      // Feedback evaluation back to contextStill
      await evaluateContext(
        run.id,
        `Task run execution completed with status: ${outcome.status}. Diff size: ${(runtimeResult.diffPatch || '').length} bytes.`,
        outcome.status === 'completed'
      );
      await repo.createTaskMessage({
        taskId,
        runId: run.id,
        role: 'assistant',
        content: finalMessage,
        messageType: 'text',
        payloadJson: {
          finalJudgment,
          finalReport: finalReportWithTodos || finalJudgment.conclusion,
          summary: runtimeResult.summary || outcome.summary,
          status: outcome.status,
        },
      });
    } catch (err: any) {
      console.error(`Error during NativeLocalRunner execution for run ${run.id}:`, err);
      const crashCompletedAt = new Date();
      for (const [index, todo] of plannedTodos.entries()) {
        const status = index === 0 ? 'failed' : 'skipped';
        const reason =
          index === 0
            ? `Runtime crashed before this todo could pass: ${err.message}`
            : 'Skipped because runtime crashed before reaching this todo.';
        const completionGateResult = {
          version: 1,
          todoId: todo.id,
          todoSeq: todo.seq,
          procedureId: todo.procedureId,
          status,
          passed: false,
          reason,
          checks: [{ id: 'runtime_crash', passed: false, evidence: err.message }],
          evidence: {
            terminalState: 'failed',
            stoppedBy: 'llm_error',
            riskLevel: 'high',
            summaryDigest: digestText(reason),
            finalReportDigest: digestText(`実行に失敗しました: ${err.message}`),
            diffBytes: 0,
            hasTests: false,
          },
        };
        await repo.updateTaskRunTodo(todo.id, {
          status,
          statusReason: reason,
          completionGateResult,
          completedAt: crashCompletedAt,
          startedAt: todo.startedAt ? new Date(todo.startedAt as any) : crashCompletedAt,
        });
        await repo.createRunEvent({
          version: 1,
          runId: run.id,
          taskId,
          timestamp: new Date().toISOString(),
          type: 'turn.finished',
          severity: status === 'failed' ? 'error' : 'warning',
          actor: 'system',
          message: `Todo #${todo.seq} ${status} after runtime crash: ${todo.title}`,
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
      const finalJudgment = buildFinalJudgment({
        runId: run.id,
        taskId,
        outcomeStatus: 'failed',
        outcomeSummary: `Execution crashed: ${err.message}`,
        supervisor: {
          finalReport: `実行に失敗しました: ${err.message}`,
          summary: `Execution crashed: ${err.message}`,
          terminalState: 'failed',
          stoppedBy: 'llm_error',
          riskLevel: 'high',
        },
      });
      await repo.updateTaskStatus(taskId, 'failed');
      await repo.updateTaskRun(run.id, {
        status: 'failed',
        endedAt: new Date(),
        finishedAt: new Date(),
        logContent: `[System Error] ${err.message}`,
        finalReport: finalJudgment.conclusion,
        finalJudgment,
        summary: `Execution crashed: ${err.message}`,
      });
      await repo.createRunEvent({
        version: 1,
        runId: run.id,
        taskId,
        timestamp: new Date().toISOString(),
        type: 'run.final_judgment_created',
        severity: 'checkpoint',
        actor: 'system',
        message: `Final judgment created after runtime crash: ${finalJudgment.title}`,
        data: { finalJudgment },
      });

      await evaluateContext(run.id, `Execution crashed: ${err.message}`, false);
      await repo.createTaskMessage({
        taskId,
        runId: run.id,
        role: 'assistant',
        content: renderFinalMessage(finalJudgment),
        messageType: 'text',
        payloadJson: {
          finalJudgment,
          finalReport: finalJudgment.conclusion,
          summary: `Execution crashed: ${err.message}`,
          status: 'failed',
        },
      });
    }
  })();

  return compiledRun ?? run;
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
        startedAt: todo.startedAt ? new Date(todo.startedAt as any) : recoveredAt,
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
      finalJudgment: buildFinalJudgment({
        runId: activeRun.id,
        taskId,
        outcomeStatus: 'failed',
        outcomeSummary: 'Run recovered as failed after stale active-state detection.',
        supervisor: {
          summary: activeRun.summary || undefined,
          finalReport: activeRun.finalReport || undefined,
          terminalState: activeRun.status,
          stoppedBy: 'llm_error',
          riskLevel: 'high',
        },
      }),
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
  const todos = await repo.listTaskRunTodosForRun(runId);
  const events = await repo.listTaskEventsForRun(runId);
  const reviews = events
    .map((event) => (event.payloadJson as { reviewResult?: ReviewResult } | null)?.reviewResult)
    .filter((reviewResult): reviewResult is ReviewResult => Boolean(reviewResult));
  return { ...run, todos, events, reviews };
}

function extractRunEvents(
  events: Awaited<ReturnType<typeof repo.listTaskEventsForRun>>
): RunEventBase[] {
  return events
    .map((event) => ((event.payloadJson || {}) as { runEvent?: RunEventBase }).runEvent)
    .filter((event): event is RunEventBase => Boolean(event));
}

async function getRunWithEvents(runId: string) {
  const run = await repo.getTaskRun(runId);
  if (!run) throw new NotFoundError('Run not found');
  const events = await repo.listTaskEventsForRun(runId);
  return { run, events, runEvents: extractRunEvents(events) };
}

export async function listMemoryCandidates(runId: string) {
  const { events } = await getRunWithEvents(runId);
  return listLearningCandidatesForRun(events);
}

export async function generateMemoryCandidates(runId: string) {
  const { run, events, runEvents } = await getRunWithEvents(runId);
  const existing = listLearningCandidatesForRun(events);
  if (existing.length > 0) return existing;
  const repository = run.repositoryId ? await repo.getRepository(run.repositoryId) : null;
  const candidates = extractLearningCandidates({
    runId: run.id,
    taskId: run.taskId,
    repositoryId: run.repositoryId,
    repoPath: repository?.localPath,
    events: runEvents,
    outcomeStatus: run.status,
  });

  for (const candidate of candidates) {
    await repo.createRunEvent(
      createLearningCandidateEvent({ runId: run.id, taskId: run.taskId, candidate }),
      {
        payloadJson: { memoryCandidate: candidate },
      }
    );
  }
  return candidates;
}

export async function approveMemoryCandidate(
  runId: string,
  candidateId: string,
  approvalNote?: string
) {
  const { run, events } = await getRunWithEvents(runId);
  const candidate = getLearningCandidateFromEvents(events, candidateId);
  if (!candidate) throw new NotFoundError('Memory candidate not found');
  if (candidate.status === 'rejected') {
    throw new AppError(409, 'MEMORY_CANDIDATE_REJECTED', 'Rejected candidate cannot be approved');
  }
  const approvedAt = new Date().toISOString();
  const approvedCandidate: LearningCandidate = {
    ...candidate,
    status: 'approved',
    approvedAt,
  };
  await repo.createRunEvent(
    {
      version: 1,
      runId,
      taskId: run.taskId,
      timestamp: approvedAt,
      type: 'memory.candidate_approved',
      severity: 'info',
      actor: 'human',
      message: `Memory candidate approved: ${candidate.title}`,
      data: {
        candidateId,
        sourceRunId: candidate.sourceRunId,
        approvedBy: 'human',
        approvalNote,
        approvedAt,
      },
    },
    { payloadJson: { memoryCandidate: approvedCandidate } }
  );
  return approvedCandidate;
}

export async function rejectMemoryCandidate(runId: string, candidateId: string, note?: string) {
  const { run, events } = await getRunWithEvents(runId);
  const candidate = getLearningCandidateFromEvents(events, candidateId);
  if (!candidate) throw new NotFoundError('Memory candidate not found');
  if (candidate.status === 'registered') {
    throw new AppError(
      409,
      'MEMORY_CANDIDATE_REGISTERED',
      'Registered candidate cannot be rejected'
    );
  }
  const rejectedCandidate: LearningCandidate = {
    ...candidate,
    status: 'rejected',
  };
  await repo.createRunEvent(
    {
      version: 1,
      runId,
      taskId: run.taskId,
      timestamp: new Date().toISOString(),
      type: 'system.warning',
      severity: 'warning',
      actor: 'human',
      message: `Memory candidate rejected: ${candidate.title}`,
      data: {
        candidateId,
        sourceRunId: candidate.sourceRunId,
        status: 'rejected',
        note,
      },
    },
    { payloadJson: { memoryCandidate: rejectedCandidate } }
  );
  return rejectedCandidate;
}

export async function registerMemoryCandidate(runId: string, candidateId: string) {
  const { run, events } = await getRunWithEvents(runId);
  const candidate = getLearningCandidateFromEvents(events, candidateId);
  if (!candidate) throw new NotFoundError('Memory candidate not found');
  if (candidate.status !== 'approved') {
    throw new AppError(
      409,
      'MEMORY_CANDIDATE_NOT_APPROVED',
      'Only approved memory candidates can be registered'
    );
  }
  return registerApprovedCandidate({
    runId,
    taskId: run.taskId,
    candidate,
    appendEvent: (event, payloadJson) => repo.createRunEvent(event, { payloadJson }),
  });
}

export async function evaluateMemoryFeedbackForRuns(input: {
  baselineRunId: string;
  followupRunId: string;
  candidateIds: string[];
}) {
  const baseline = await getRunWithEvents(input.baselineRunId);
  const followup = await getRunWithEvents(input.followupRunId);
  const baselineView: RunLedgerView = {
    runId: baseline.run.id,
    events: baseline.runEvents,
    terminal: { status: baseline.run.status, summary: baseline.run.summary || undefined },
  };
  const followupView: RunLedgerView = {
    runId: followup.run.id,
    events: followup.runEvents,
    terminal: { status: followup.run.status, summary: followup.run.summary || undefined },
  };
  const evaluation = evaluateMemoryFeedback({
    baselineRun: baselineView,
    followupRun: followupView,
    candidateIds: input.candidateIds,
  });
  await repo.createRunEvent({
    version: 1,
    runId: followup.run.id,
    taskId: followup.run.taskId,
    timestamp: new Date().toISOString(),
    type: 'memory.feedback_evaluated',
    severity: 'checkpoint',
    actor: 'system',
    message: `Memory feedback evaluated: ${evaluation.verdict}`,
    data: evaluation as unknown as Record<string, unknown>,
  });
  return evaluation;
}

export async function getTaskRunsForTask(taskId: string) {
  return repo.listTaskRunsForTask(taskId);
}

export async function reviewTaskRun(runId: string, request: ReviewRunRequest) {
  const run = await repo.getTaskRun(runId);
  if (!run) throw new Error('Run not found');
  const events = await repo.listTaskEventsForRun(runId);
  const defaultEvidenceRefs = collectDefaultReviewEvidence(run, events);

  const outcome = decideRunOutcome({
    supervisor: {
      finalReport: run.finalReport || '',
      terminalState: (run.status as any) || 'needs_review',
      summary: run.summary || `Review action: ${request.action}`,
      stoppedBy: 'decision',
      riskLevel: 'medium',
    },
    humanAction: request.action,
  });
  const finalTaskStatus = outcome.status;
  const reviewResult = buildReviewResult({
    run: {
      id: run.id,
      taskId: run.taskId,
      status: run.status,
      summary: run.summary,
    },
    request,
    outcome,
    evidenceRefs: request.evidenceRefs?.length ? request.evidenceRefs : defaultEvidenceRefs,
  });

  await repo.createRunEvent(
    {
      version: 1,
      runId,
      taskId: run.taskId,
      timestamp: new Date().toISOString(),
      type: 'human.review_submitted',
      severity: 'info',
      actor: 'human',
      message: `Human review completed. Action: ${request.action}. Note: ${request.note || 'None'}`,
      data: { action: request.action, reviewResultId: reviewResult.id },
    },
    { payloadJson: { reviewResult } }
  );

  await repo.updateTaskRun(runId, {
    status: outcome.status,
    summary: request.note || outcome.summary,
  });

  await repo.updateTaskStatus(run.taskId, finalTaskStatus);

  await repo.createRunEvent(
    {
      version: 1,
      runId,
      taskId: run.taskId,
      timestamp: new Date().toISOString(),
      type: 'run.outcome_decided',
      severity: 'info',
      actor: 'human',
      message: `Run outcome decided: ${outcome.status} (${outcome.reason})`,
      data: { ...outcome, reviewResultId: reviewResult.id },
    },
    { legacyPayload: outcome, payloadJson: { reviewResultId: reviewResult.id } }
  );

  // Feedback evaluation back to contextStill should never fail the review persistence.
  void evaluateContext(
    run.id,
    `Review submitted with status=${finalTaskStatus}. Outcome=${outcome.status}.`,
    outcome.status === 'completed'
  );

  return { ok: true, status: finalTaskStatus, outcome, reviewResult };
}

export function getReviewRubrics() {
  return listRubrics().map((loaded) => ({
    id: loaded.rubric.id,
    title: loaded.rubric.title,
    description: loaded.rubric.description,
    source: loaded.source,
    digest: loaded.digest,
    criteriaCount: loaded.criteriaCount,
    llm: loaded.rubric.llm,
  }));
}

export async function createReviewerEvaluation(
  runId: string,
  request: {
    rubricId?: string;
    mode?: ReviewerEvaluationMode;
    persist?: boolean;
  }
) {
  const run = await repo.getTaskRun(runId);
  if (!run) throw new NotFoundError('Run not found');
  const events = await repo.listTaskEventsForRun(runId);
  const pack = buildReviewEvidencePackFromRun(run, events);
  const evaluation = await runReviewerEvaluationFromPack({
    pack,
    rubricId: request.rubricId || 'basic-coding-run',
    mode: request.mode || 'deterministic_only',
    run: {
      id: run.id,
      taskId: run.taskId,
      status: run.status,
      summary: run.summary,
    },
  });

  if (request.persist !== false) {
    for (const event of evaluation.events) {
      await repo.createRunEvent(
        event,
        event.type === 'review.evaluation_finished'
          ? { payloadJson: { reviewResult: evaluation.reviewResult } }
          : undefined
      );
    }
  }

  return evaluation;
}

export async function createReviewerReplayEvaluation(
  runId: string,
  request: {
    rubricId?: string;
    mode?: ReviewerEvaluationMode;
    jsonl?: string;
    parsedJsonl?: any;
    replayResult?: any;
  }
) {
  const rubricId = request.rubricId || 'basic-coding-run';
  const mode = request.mode || 'deterministic_only';

  if (request.jsonl?.trim()) {
    return runReviewReplayEvaluationFromJsonl({
      jsonl: request.jsonl,
      rubricId,
      mode,
    });
  }

  if (request.parsedJsonl || request.replayResult) {
    return runReviewReplayEvaluation({
      parsedJsonl: request.parsedJsonl,
      replayResult: request.replayResult,
      rubricId,
      mode,
    });
  }

  const jsonl = await exportTaskRunJsonl(runId);
  if (!jsonl) throw new NotFoundError('Run not found');
  return runReviewReplayEvaluationFromJsonl({
    jsonl,
    rubricId,
    mode,
  });
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

const PROJECT_TREE_EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-api',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
]);
const PROJECT_FILE_READ_LIMIT = 256 * 1024;

function resolveProjectPath(rootPath: string, relativePath?: string) {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, relativePath || '.');
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new AppError(400, 'PATH_OUTSIDE_PROJECT', 'Path must stay inside the project root');
  }
  return { root, target };
}

export async function listProjectFiles(repositoryId: string, relativePath?: string) {
  const repository = await repo.getRepository(repositoryId);
  if (!repository) throw new NotFoundError('Repository not found');
  const { root, target } = resolveProjectPath(repository.localPath, relativePath);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const result = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith('.') || entry.name === '.env.example')
      .filter((entry) => !(entry.isDirectory() && PROJECT_TREE_EXCLUDED_DIRS.has(entry.name)))
      .slice(0, 400)
      .map(async (entry) => {
        const absolutePath = path.join(target, entry.name);
        const stat = await fs.stat(absolutePath).catch(() => null);
        return {
          name: entry.name,
          path: path.relative(root, absolutePath),
          type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
          size: stat?.isFile() ? stat.size : undefined,
        };
      })
  );
  return result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function readProjectFile(repositoryId: string, relativePath: string) {
  const repository = await repo.getRepository(repositoryId);
  if (!repository) throw new NotFoundError('Repository not found');
  const { root, target } = resolveProjectPath(repository.localPath, relativePath);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new AppError(400, 'NOT_A_FILE', 'Path is not a file');
  const handle = await fs.open(target, 'r');
  try {
    const readLength = Math.min(stat.size, PROJECT_FILE_READ_LIMIT);
    const buffer = Buffer.alloc(readLength);
    await handle.read(buffer, 0, readLength, 0);
    return {
      path: path.relative(root, target),
      content: buffer.toString('utf8'),
      size: stat.size,
      truncated: stat.size > PROJECT_FILE_READ_LIMIT,
    };
  } finally {
    await handle.close();
  }
}

export async function exportTaskRunJsonl(runId: string) {
  const run = await repo.getTaskRun(runId);
  if (!run) return null;
  const events = await repo.listTaskEventsForRun(runId);
  const todos = await repo.listTaskRunTodosForRun(runId);
  const repository = run.repositoryId ? await repo.getRepository(run.repositoryId) : null;
  return serializeRunToJsonl({ run, events, repository, todos });
}
