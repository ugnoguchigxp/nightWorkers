import fs from 'node:fs/promises';
import { appendSupervisorTrace, logger } from '../../lib/logger';
import * as repo from '../../modules/nightworkers/nightworkers.repository';
import { estimateTokens } from '../conversation-context/token-budget';
import type { SupervisorLoopResult } from '../run-control/types';
import type { RunEventSeverity } from '../run-events/types';
import { callSupervisorLLM, type SupervisorLlmDebugEvent } from '../structured-llm';
import { executeWorkerTool } from '../worker-tools/dispatcher';
import {
  buildExecutionReviewChecklist,
  type ExecutionReviewChecklistItem,
} from './execution-review';
import {
  type LoadedProcedureSummary,
  readSupervisorProcedure,
  searchSupervisorProcedures,
} from './procedure-tools';
import {
  buildRound1JobTypePrompt,
  buildRound2ToolCallPrompt,
  getAllowedToolsForJobType,
  getExecutableWorkerToolName,
  type JobType,
  validateToolCallForJobType,
} from './prompt';
import type { AgentToolCallEnvelope } from './schema-first';
import {
  type AgentEventType,
  createSupervisorLlmRunEvent,
  createSupervisorRunEvent,
  eventActor,
  eventMessage,
  mapAgentEventToRunEventType,
} from './supervisor-loop-events';
import {
  buildExecutionReviewContextSnapshot,
  buildUserInput,
  findTodoByToolArguments,
  formatErrorMessage,
  formatToolObservation,
  getBootstrapTodoGap,
  getTemplateImportVerificationGap,
  normalizeJobType,
  normalizeTodoListInput,
  resolveCurrentTodo,
  toSupervisorTodoContext,
} from './supervisor-loop-helpers';
import type { CompactToolResult, SupervisorLoopInput } from './supervisor-loop-types';
import { renderRound2UserContext } from './user-context';

export type { SupervisorLoopInput, SupervisorTodoContext } from './supervisor-loop-types';
export async function runSupervisorLoop(input: SupervisorLoopInput): Promise<SupervisorLoopResult> {
  const { runId, repoRoot } = input;
  const maxToolCalls = input.maxToolCalls ?? 20;
  const maxIterations = input.maxIterations ?? 20;
  const run = await repo.getTaskRun(runId);
  if (!run) throw new Error(`Run context not found: ${runId}`);
  const task = await repo.getTask(run.taskId);
  if (!task) throw new Error(`Task context not found: ${run.taskId}`);

  const userInput = buildUserInput(input);
  const readFiles: string[] = [];
  const toolContext = { readFileCache: new Map() };
  const toolResults: CompactToolResult[] = [];
  const loadedProcedureSummaries = new Map<JobType, LoadedProcedureSummary>();
  let currentTodos = await repo.listTaskRunTodosForRun(runId);
  let step = 0;
  let currentJobType: JobType = 'minor_code_edit';
  let goal = userInput;
  let finalReportText = '';
  let terminalState: SupervisorLoopResult['terminalState'] = 'completed';
  let summary = '';
  let stoppedBy: SupervisorLoopResult['stoppedBy'] = 'decision';
  let riskLevel: SupervisorLoopResult['riskLevel'] = 'low';
  let reviewChecklist: ExecutionReviewChecklistItem[] = [];

  const emitAgentEvent = async (
    type: AgentEventType,
    payload: Record<string, unknown> = {},
    severity: RunEventSeverity = type.endsWith('failed') ? 'error' : 'info'
  ) => {
    await createSupervisorRunEvent({
      runId,
      taskId: task.id,
      iteration: step,
      type: mapAgentEventToRunEventType(type),
      severity,
      actor: eventActor(type),
      message: eventMessage(type),
      data: {
        agentEventType: type,
        jobType: currentJobType,
        step,
      },
      payloadJson: {
        agentEventType: type,
        jobType: currentJobType,
        step,
        payload,
      },
    });
  };

  const emitLlmDebugEvent = async (event: SupervisorLlmDebugEvent) => {
    await createSupervisorLlmRunEvent({
      runId,
      taskId: task.id,
      iteration: step,
      event,
    });
  };

  appendSupervisorTrace('schema_first_loop_started', {
    runId,
    repoRoot,
    maxIterations,
    maxToolCalls,
  });
  await emitAgentEvent('run.started', { repoRoot, userInput });

  try {
    const round1SystemPrompt = buildRound1JobTypePrompt(repoRoot);
    await emitAgentEvent('round1.prompt_built', { systemPrompt: round1SystemPrompt });
    const round1 = (await callSupervisorLLM(round1SystemPrompt, userInput, {
      round: 1,
      schemaFirst: true,
      role: 'plan',
      routeOverride: input.llmRouteOverride || null,
      emitEvent: emitLlmDebugEvent,
      workingDirectory: repoRoot,
      taskId: task.id,
      runId,
      promptPartTokenEstimates: {
        ...input.promptPartTokenEstimates,
        systemPromptTokens: estimateTokens(round1SystemPrompt),
        userPromptTokens:
          input.promptPartTokenEstimates?.userPromptTokens ?? estimateTokens(userInput),
      },
    })) as { jobType: JobType; goal: string };
    currentJobType = round1.jobType;
    goal = round1.goal.trim() || userInput;
    if (currentJobType === 'major_code_edit') {
      const procedure = readSupervisorProcedure({ jobType: currentJobType, loadedAtStep: 0 });
      loadedProcedureSummaries.set(currentJobType, procedure);
      await emitAgentEvent('procedure.loaded', {
        source: 'auto',
        jobType: currentJobType,
        procedurePath: procedure.path,
        digest: procedure.digest,
        summary: procedure.summary,
      });
    }
    await emitAgentEvent('round1.parsed', round1);

    for (step = 1; step <= maxIterations && toolResults.length < maxToolCalls; step += 1) {
      const workspaceSnapshot = await readWorkspaceSnapshot(repoRoot);
      const allowedTools = getAllowedToolsForJobType(currentJobType);

      const round2SystemPrompt = buildRound2ToolCallPrompt({
        projectRoot: repoRoot,
        taskId: task.id,
        jobType: currentJobType,
        tools: allowedTools,
        externalAllowedPaths: input.safetyPolicy?.externalAllowedPaths,
      });
      const loadedProcedureSummaryContext = [...loadedProcedureSummaries.values()].map(
        (procedure) => ({
          jobType: procedure.jobType,
          path: procedure.path,
          digest: procedure.digest,
          useWhen: procedure.summary.useWhen,
          procedure: procedure.summary.procedure,
          requiredRules: procedure.summary.requiredRules,
          loadedAtStep: procedure.loadedAtStep,
        })
      );
      const round2UserPrompt = renderRound2UserContext({
        latestUserMessage: userInput,
        goal,
        currentJobType,
        workflow: currentJobType,
        safetyPolicy: input.safetyPolicy || null,
        todoPlan: currentTodos.map(toSupervisorTodoContext),
        currentTodo: currentTodos.find((todo) => todo.status === 'running')
          ? toSupervisorTodoContext(currentTodos.find((todo) => todo.status === 'running') as any)
          : null,
        toolResults: toolResults.slice(-8),
        loadedProcedureSummaries: loadedProcedureSummaryContext,
        artifactContextRefs: input.artifactContextRefs || [],
        workspaceSnapshot,
      });
      await emitAgentEvent('round2.prompt_built', {
        systemPrompt: round2SystemPrompt,
        userPrompt: round2UserPrompt,
      });
      const round2 = (await callSupervisorLLM(round2SystemPrompt, round2UserPrompt, {
        round: 2,
        schemaFirst: true,
        role: 'implementation',
        routeOverride: input.llmRouteOverride || null,
        emitEvent: emitLlmDebugEvent,
        workingDirectory: repoRoot,
        taskId: task.id,
        runId,
        promptPartTokenEstimates: {
          systemPromptTokens: estimateTokens(round2SystemPrompt),
          userPromptTokens: estimateTokens(round2UserPrompt),
          stateCardTokens: 0,
        },
      })) as AgentToolCallEnvelope;
      await emitAgentEvent('round2.parsed', round2);

      const validation = validateToolCallForJobType({
        jobType: currentJobType,
        toolCall: round2.toolCall,
      });
      if (!validation.ok) {
        const result = {
          step,
          toolName: round2.toolCall.name,
          ok: false,
          arguments: round2.toolCall.arguments,
          summary: validation.message,
        };
        toolResults.push(result);
        await emitAgentEvent('tool.validation_failed', result, 'warning');
        continue;
      }

      if (round2.toolCall.name === 'select_job_type') {
        const nextJobType = round2.toolCall.arguments.jobType;
        if (typeof nextJobType === 'string') {
          currentJobType = nextJobType as JobType;
          await emitAgentEvent('job.switched', {
            toolCall: round2.toolCall,
            nextJobType,
          });
          continue;
        }
      }

      if (round2.toolCall.name === 'read_procedure') {
        const requestedJobType = normalizeJobType(round2.toolCall.arguments.jobType);
        if (!requestedJobType) {
          const result = {
            step,
            toolName: 'read_procedure',
            ok: false,
            arguments: round2.toolCall.arguments,
            summary: `Invalid jobType for read_procedure: ${String(round2.toolCall.arguments.jobType)}`,
          };
          toolResults.push(result);
          await emitAgentEvent('tool.validation_failed', result, 'warning');
          continue;
        }
        try {
          const procedure = readSupervisorProcedure({
            jobType: requestedJobType,
            loadedAtStep: step,
          });
          loadedProcedureSummaries.set(requestedJobType, procedure);
          const result = {
            step,
            toolName: 'read_procedure',
            ok: true,
            arguments: round2.toolCall.arguments,
            summary: `tool=read_procedure status=ok\njobType=${requestedJobType} digest=${procedure.digest}`,
            payload: procedure,
          };
          toolResults.push(result);
          await emitAgentEvent('procedure.loaded', {
            source: 'read_procedure',
            jobType: requestedJobType,
            procedurePath: procedure.path,
            digest: procedure.digest,
            summary: procedure.summary,
          });
          await emitAgentEvent('tool.finished', result);
        } catch (err) {
          const result = {
            step,
            toolName: 'read_procedure',
            ok: false,
            arguments: round2.toolCall.arguments,
            summary: `tool=read_procedure status=failed\nerror=${formatErrorMessage(err)}`,
            error: formatErrorMessage(err),
          };
          toolResults.push(result);
          await emitAgentEvent('tool.failed', result, 'warning');
        }
        continue;
      }

      if (round2.toolCall.name === 'search_procedure') {
        const query = String(round2.toolCall.arguments.query || '').trim();
        const maxResults =
          typeof round2.toolCall.arguments.maxResults === 'number'
            ? round2.toolCall.arguments.maxResults
            : undefined;
        try {
          const matches = searchSupervisorProcedures({ query, maxResults });
          const result = {
            step,
            toolName: 'search_procedure',
            ok: true,
            arguments: round2.toolCall.arguments,
            summary: `tool=search_procedure status=ok\nmatches=${matches.matches.length}`,
            payload: matches,
          };
          toolResults.push(result);
          await emitAgentEvent('tool.finished', result);
        } catch (err) {
          const result = {
            step,
            toolName: 'search_procedure',
            ok: false,
            arguments: round2.toolCall.arguments,
            summary: `tool=search_procedure status=failed\nerror=${formatErrorMessage(err)}`,
            error: formatErrorMessage(err),
          };
          toolResults.push(result);
          await emitAgentEvent('tool.failed', result, 'warning');
        }
        continue;
      }

      if (round2.toolCall.name === 'todo_list') {
        const operation = String(round2.toolCall.arguments.operation || '').trim();
        if (operation === 'list') {
          const result = {
            step,
            toolName: 'todo_list',
            ok: true,
            arguments: round2.toolCall.arguments,
            summary: `tool=todo_list operation=list status=ok\ntodos=${currentTodos.length}`,
            payload: { todos: currentTodos.map(toSupervisorTodoContext) },
          };
          toolResults.push(result);
          await emitAgentEvent('tool.finished', result);
          continue;
        }

        if (operation === 'replace') {
          try {
            const todos = normalizeTodoListInput(round2.toolCall.arguments);
            const bootstrapGap = getBootstrapTodoGap({
              workspaceSnapshot,
              currentJobType,
              todos,
            });
            if (bootstrapGap) {
              const result = {
                step,
                toolName: 'todo_list',
                ok: false,
                arguments: round2.toolCall.arguments,
                summary: `tool=todo_list operation=replace status=failed\nerror=${bootstrapGap}`,
                error: bootstrapGap,
              };
              toolResults.push(result);
              await emitAgentEvent('tool.validation_failed', result, 'warning');
              continue;
            }
            const startFirst = round2.toolCall.arguments.startFirst !== false;
            const now = new Date();
            currentTodos = await repo.replaceTaskRunTodosForRun(
              runId,
              todos.map((todo, index) => ({
                ...todo,
                taskType: 'implementation',
                procedureId: null,
                dependsOn: [],
                status: startFirst && index === 0 ? 'running' : 'pending',
                startedAt: startFirst && index === 0 ? now : null,
              }))
            );
            const result = {
              step,
              toolName: 'todo_list',
              ok: true,
              arguments: round2.toolCall.arguments,
              summary: `tool=todo_list operation=replace status=ok\ntodos=${currentTodos.length}`,
              payload: { todos: currentTodos.map(toSupervisorTodoContext) },
            };
            toolResults.push(result);
            await emitAgentEvent('tool.finished', result);
          } catch (err) {
            const result = {
              step,
              toolName: 'todo_list',
              ok: false,
              arguments: round2.toolCall.arguments,
              summary: `tool=todo_list operation=replace status=failed\nerror=${formatErrorMessage(err)}`,
              error: formatErrorMessage(err),
            };
            toolResults.push(result);
            await emitAgentEvent('tool.failed', result, 'warning');
          }
          continue;
        }

        if (operation === 'start') {
          const todo = findTodoByToolArguments(currentTodos, round2.toolCall.arguments);
          if (!todo) {
            const result = {
              step,
              toolName: 'todo_list',
              ok: false,
              arguments: round2.toolCall.arguments,
              summary: 'Todo seq not found for todo_list operation=start.',
            };
            toolResults.push(result);
            await emitAgentEvent('tool.validation_failed', result, 'warning');
            continue;
          }
          if (!['pending', 'running'].includes(todo.status)) {
            const result = {
              step,
              toolName: 'todo_list',
              ok: false,
              arguments: round2.toolCall.arguments,
              summary: 'Requested Todo is already closed and cannot be started.',
            };
            toolResults.push(result);
            await emitAgentEvent('tool.validation_failed', result, 'warning');
            continue;
          }
          const earlierOpenTodo = currentTodos.find(
            (candidate) =>
              candidate.seq < todo.seq && ['pending', 'running'].includes(candidate.status)
          );
          if (earlierOpenTodo) {
            const result = {
              step,
              toolName: 'todo_list',
              ok: false,
              arguments: round2.toolCall.arguments,
              summary: `Previous Todo #${earlierOpenTodo.seq} is still ${earlierOpenTodo.status}; close it before starting #${todo.seq}.`,
            };
            toolResults.push(result);
            await emitAgentEvent('tool.validation_failed', result, 'warning');
            continue;
          }
          const now = new Date();
          for (const candidate of currentTodos) {
            if (candidate.id === todo.id) {
              await repo.updateTaskRunTodo(candidate.id, { status: 'running', startedAt: now });
            } else if (candidate.status === 'running') {
              await repo.updateTaskRunTodo(candidate.id, { status: 'pending' });
            }
          }
          currentTodos = await repo.listTaskRunTodosForRun(runId);
          const result = {
            step,
            toolName: 'todo_list',
            ok: true,
            arguments: round2.toolCall.arguments,
            summary: `tool=todo_list operation=start status=ok\nseq=${todo.seq}`,
            payload: { todos: currentTodos.map(toSupervisorTodoContext) },
          };
          toolResults.push(result);
          await emitAgentEvent('tool.finished', result);
          continue;
        }

        if (operation === 'done' || operation === 'block' || operation === 'fail') {
          const seqTarget = findTodoByToolArguments(currentTodos, round2.toolCall.arguments);
          const currentResolution = seqTarget
            ? seqTarget.status === 'running'
              ? { ok: true as const, todo: seqTarget }
              : { ok: false as const, errorCode: 'CURRENT_TODO_MISSING' }
            : resolveCurrentTodo(currentTodos);
          const status =
            operation === 'done' ? 'passed' : operation === 'block' ? 'needs_human' : 'failed';
          if (!currentResolution.ok) {
            const result = {
              step,
              toolName: 'todo_list',
              ok: false,
              arguments: round2.toolCall.arguments,
              summary:
                currentResolution.errorCode === 'CURRENT_TODO_MISSING'
                  ? 'No running Todo exists for the current run.'
                  : 'Multiple running Todos exist; current Todo is not unique.',
            };
            toolResults.push(result);
            await emitAgentEvent('tool.validation_failed', result, 'warning');
            continue;
          }
          const todo = currentResolution.todo;
          const now = new Date();
          await repo.updateTaskRunTodo(todo.id, {
            status,
            completedAt: now,
            startedAt: todo.startedAt ? new Date(todo.startedAt as any) : now,
          });
          currentTodos = await repo.listTaskRunTodosForRun(runId);
          if (operation === 'done') {
            const nextTodo = currentTodos.find(
              (candidate) => candidate.status === 'pending' && candidate.seq > todo.seq
            );
            if (nextTodo) {
              await repo.startTaskRunTodoIfStillPendingAndNoEarlierOpen({
                id: nextTodo.id,
                runId,
                afterSeq: todo.seq,
                startedAt: new Date(),
              });
              currentTodos = await repo.listTaskRunTodosForRun(runId);
            }
          }
          const result = {
            step,
            toolName: 'todo_list',
            ok: true,
            arguments: round2.toolCall.arguments,
            summary: `tool=todo_list operation=${operation} status=ok\nseq=${todo.seq} todoStatus=${status}`,
            payload: { todos: currentTodos.map(toSupervisorTodoContext) },
          };
          toolResults.push(result);
          await emitAgentEvent('tool.finished', result);
          continue;
        }

        const result = {
          step,
          toolName: 'todo_list',
          ok: false,
          arguments: round2.toolCall.arguments,
          summary: `tool=todo_list status=failed\nerror=Invalid operation: ${operation || '(empty)'}`,
        };
        toolResults.push(result);
        await emitAgentEvent('tool.validation_failed', result, 'warning');
        continue;
      }

      if (round2.toolCall.name === 'finalize_answer') {
        const openTodos = currentTodos.filter((todo) =>
          ['pending', 'running'].includes(todo.status)
        );
        if (openTodos.length > 0) {
          const result = {
            step,
            toolName: 'finalize_answer',
            ok: false,
            arguments: round2.toolCall.arguments,
            summary: `Cannot finalize while TodoList has open items: ${openTodos
              .map((todo) => `#${todo.seq} ${todo.status}`)
              .join(
                ', '
              )}. Use todo_list operation=done, operation=block, or operation=fail first.`,
            payload: { todos: currentTodos.map(toSupervisorTodoContext) },
          };
          toolResults.push(result);
          await emitAgentEvent('tool.validation_failed', result, 'warning');
          continue;
        }
        const templateVerificationGap = getTemplateImportVerificationGap(toolResults);
        if (templateVerificationGap) {
          const result = {
            step,
            toolName: 'finalize_answer',
            ok: false,
            arguments: round2.toolCall.arguments,
            summary: templateVerificationGap,
            payload: { todos: currentTodos.map(toSupervisorTodoContext) },
          };
          toolResults.push(result);
          await emitAgentEvent('tool.validation_failed', result, 'warning');
          continue;
        }
        const message = String(round2.toolCall.arguments.message || '').trim();
        finalReportText = message || '';
        summary = finalReportText.slice(0, 200) || 'Completed';
        const failedTodos = currentTodos.filter((todo) => todo.status === 'failed');
        const needsHumanTodos = currentTodos.filter((todo) => todo.status === 'needs_human');
        terminalState =
          failedTodos.length > 0
            ? 'failed'
            : needsHumanTodos.length > 0
              ? 'needs_human'
              : 'completed';
        stoppedBy = 'decision';
        riskLevel = terminalState === 'completed' ? 'low' : 'medium';
        reviewChecklist = buildExecutionReviewChecklist({
          toolResults,
          artifactContextRefs: input.artifactContextRefs,
        });
        await emitAgentEvent('finalize.received', { message: finalReportText });
        await emitAgentEvent(
          terminalState === 'completed' ? 'run.completed' : 'run.needs_human',
          {
            finalReport: finalReportText,
            reviewChecklist,
            unresolvedTodos: [...failedTodos, ...needsHumanTodos].map(toSupervisorTodoContext),
          },
          terminalState === 'completed' ? 'info' : 'warning'
        );
        break;
      }

      const workerToolName = getExecutableWorkerToolName(round2.toolCall.name);
      if (!workerToolName) {
        const result = {
          step,
          toolName: round2.toolCall.name,
          ok: false,
          arguments: round2.toolCall.arguments,
          summary: `Tool is not executable: ${round2.toolCall.name}`,
        };
        toolResults.push(result);
        await emitAgentEvent('tool.validation_failed', result, 'warning');
        continue;
      }

      await emitAgentEvent('tool.started', {
        toolName: workerToolName,
        arguments: round2.toolCall.arguments,
      });
      const dispatch = await executeWorkerTool({
        toolName: workerToolName,
        args: round2.toolCall.arguments,
        repoRoot,
        taskId: task.id,
        safetyPolicy: input.safetyPolicy,
        readFiles,
        toolContext,
      });
      if (dispatch.readFilesChanged) {
        readFiles.splice(0, readFiles.length, ...dispatch.readFilesChanged);
      }
      const toolResult = dispatch.result;
      const compactResult: CompactToolResult = {
        step,
        toolName: workerToolName,
        ok: toolResult.ok,
        arguments: round2.toolCall.arguments,
        summary: formatToolObservation(workerToolName, toolResult),
        payload: toolResult.payload,
        error: toolResult.error,
      };
      toolResults.push(compactResult);
      await emitAgentEvent(toolResult.ok ? 'tool.finished' : 'tool.failed', compactResult);
      if (!toolResult.ok && toolResult.error?.code === 'ACCESS_DENIED') {
        terminalState = 'needs_human';
        stoppedBy = 'policy';
        riskLevel = 'medium';
        const deniedMessage =
          toolResult.error?.message ||
          'Worker tool access was denied by the project safety policy.';
        finalReportText = [
          '外部パスまたは制限されたパスへのアクセス許可が必要です。',
          deniedMessage,
          'コピー元テンプレートなどプロジェクト外のフォルダを使う場合は、そのパスを明示的に許可してから再実行してください。',
        ].join('\n');
        summary = finalReportText.slice(0, 200);
        await emitAgentEvent('run.needs_human', {
          reason: 'path_access_denied',
          toolName: workerToolName,
          arguments: round2.toolCall.arguments,
          message: deniedMessage,
        });
        break;
      }
    }

    if (!finalReportText) {
      terminalState = 'needs_human';
      stoppedBy = 'budget';
      riskLevel = 'high';
      summary = 'Stopped before finalize_answer';
      finalReportText = 'Stopped before finalize_answer.';
      await emitAgentEvent('run.needs_human', {
        reason: 'missing_finalize_answer',
        step,
        toolResultCount: toolResults.length,
      });
    }
  } catch (err) {
    terminalState = 'needs_human';
    stoppedBy = 'llm_error';
    riskLevel = 'high';
    finalReportText = err instanceof Error ? err.message : String(err);
    summary = 'Schema-first supervisor error';
    await emitAgentEvent('run.failed', { error: finalReportText }, 'error');
  }

  await repo.updateTaskRun(runId, {
    finalReport: finalReportText,
    summary,
    status: terminalState,
    contextSnapshot: buildExecutionReviewContextSnapshot({
      existingContextSnapshot: run.contextSnapshot,
      checklist:
        reviewChecklist.length > 0
          ? reviewChecklist
          : buildExecutionReviewChecklist({
              toolResults,
              artifactContextRefs: input.artifactContextRefs,
            }),
      artifactContextRefs: input.artifactContextRefs,
    }),
  });
  await repo.updateTaskStatus(run.taskId, terminalState);
  appendSupervisorTrace('schema_first_loop_finished', {
    runId,
    terminalState,
    stoppedBy,
    summary,
    riskLevel,
    step,
    toolResultCount: toolResults.length,
    finalReportLength: finalReportText.length,
  });
  logger.info(
    {
      runId,
      terminalState,
      stoppedBy,
      riskLevel,
      step,
      toolResultCount: toolResults.length,
      finalReportLength: finalReportText.length,
    },
    'Schema-first supervisor loop finished'
  );
  return { finalReport: finalReportText, terminalState, summary, stoppedBy, riskLevel };
}

async function readWorkspaceSnapshot(repoRoot: string) {
  const entries = await fs.readdir(repoRoot, { withFileTypes: true }).catch((error: any) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  const visible = entries.filter((entry) => entry.name !== '.DS_Store' && entry.name !== '.git');
  const topLevelDirs = visible
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .slice(0, 20);
  const topLevelFiles = visible
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .slice(0, 20);
  return {
    isEmpty: visible.length === 0,
    topLevelDirs,
    topLevelFiles,
    truncated: visible.length > topLevelDirs.length + topLevelFiles.length,
  };
}
