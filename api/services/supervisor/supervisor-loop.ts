import fs from 'node:fs/promises';
import { toDeepRecord } from '../../../shared/json-record';
import { appendSupervisorTrace, logger } from '../../lib/logger';
import * as repo from '../../modules/nightworkers/nightworkers.repository';
import { estimateTokens } from '../conversation-context/token-budget';
import { type McpToolSummary, mcpClientManager } from '../mcp/mcp-client-manager';
import type { SupervisorLoopResult } from '../run-control/types';
import type { RunEventSeverity } from '../run-events/types';
import { callSupervisorLLM, type SupervisorLlmDebugEvent } from '../structured-llm';
import { resolveStructuredLlmModelCapability } from '../structured-llm/model-capability';
import { buildStandardImplementationTodoList } from '../todo-runtime';
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
import { buildPromptBudget } from './prompt-budget-manager';
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
  buildProgressContext,
  buildUserInput,
  findTodoByToolArguments,
  formatErrorMessage,
  formatToolObservation,
  getBootstrapTodoGap,
  getRedundantTodoReplaceGap,
  getTemplateImportVerificationGap,
  getTodoDoneEvidenceGap,
  isRecord,
  normalizeJobType,
  normalizeTodoListInput,
  resolveCurrentTodo,
  toSupervisorTodoContext,
} from './supervisor-loop-helpers';
import type { CompactToolResult, SupervisorLoopInput } from './supervisor-loop-types';
import { renderRound2UserContext } from './user-context';

export type { SupervisorLoopInput, SupervisorTodoContext } from './supervisor-loop-types';

const DEFAULT_MAX_ITERATIONS = 20;
const DEFAULT_MAX_TOOL_CALLS = 20;
const MAJOR_CODE_EDIT_MAX_ITERATIONS = 50;
const MAJOR_CODE_EDIT_MAX_TOOL_CALLS = 50;
const CLOSEOUT_TOOL_CALL_RESERVE = 2;

export async function runSupervisorLoop(input: SupervisorLoopInput): Promise<SupervisorLoopResult> {
  const { runId, repoRoot } = input;
  let maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  let maxToolCalls = input.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
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
    const preRound1Specification = await readCurrentSpecificationBeforeRound1({
      repoRoot,
      taskId: task.id,
      safetyPolicy: input.safetyPolicy,
      readFiles,
      emitAgentEvent,
    });
    const preRound1SpecificationPayload = specificationFound(preRound1Specification?.payload)
      ? preRound1Specification?.payload
      : undefined;
    if (preRound1Specification && preRound1SpecificationPayload) {
      toolResults.push(preRound1Specification);
    }
    const round1UserInput = buildRound1UserInput(userInput, preRound1SpecificationPayload);
    const round1SystemPrompt = buildRound1JobTypePrompt(repoRoot);
    await emitAgentEvent('round1.prompt_built', { systemPrompt: round1SystemPrompt });
    const round1 = (await callSupervisorLLM(round1SystemPrompt, round1UserInput, {
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
          input.promptPartTokenEstimates?.userPromptTokens ?? estimateTokens(round1UserInput),
      },
    })) as { jobType: JobType; goal: string };
    currentJobType = round1.jobType;
    goal = round1.goal.trim() || userInput;
    const hasOpenRunTodos = currentTodos.some((todo) =>
      ['pending', 'running'].includes(todo.status)
    );
    const jobTypeCanManageTodos = getAllowedToolsForJobType(currentJobType).some(
      (tool) => tool.name === 'todo_list'
    );
    if (hasOpenRunTodos && !jobTypeCanManageTodos) {
      currentJobType = 'major_code_edit';
      await emitAgentEvent('job.switched', {
        source: 'todo_contract',
        fromJobType: round1.jobType,
        nextJobType: currentJobType,
        reason: 'open_todos_require_todo_list_tool',
      });
    }
    if (!input.maxToolCalls && currentJobType === 'major_code_edit') {
      maxToolCalls = MAJOR_CODE_EDIT_MAX_TOOL_CALLS;
    }
    if (!input.maxIterations && currentJobType === 'major_code_edit') {
      maxIterations = MAJOR_CODE_EDIT_MAX_ITERATIONS;
    }
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

    const contextCompileGateResult = await runContextCompileAfterRound1({
      runId,
      repoRoot,
      taskId: task.id,
      safetyPolicy: input.safetyPolicy,
      readFiles,
      currentJobType,
      goal,
      userInput,
      specification: preRound1SpecificationPayload,
      emitAgentEvent,
    });
    if (contextCompileGateResult?.toolResult) {
      toolResults.push(contextCompileGateResult.toolResult);
    }
    if (contextCompileGateResult?.failure) {
      terminalState = 'needs_human';
      stoppedBy = 'tool_failure';
      riskLevel = 'high';
      summary = contextCompileGateResult.failure.summary;
      finalReportText = contextCompileGateResult.failure.finalReport;
      await emitAgentEvent(
        'run.needs_human',
        {
          reason: 'context_compile_failed',
          summary,
        },
        'error'
      );
    }
    currentTodos = await repo.listTaskRunTodosForRun(runId);

    for (
      step = 1;
      !finalReportText && step <= maxIterations && toolResults.length < maxToolCalls;
      step += 1
    ) {
      const cancelledBeforeStep = await getCancelledRunResult(runId);
      if (cancelledBeforeStep) {
        terminalState = 'cancelled';
        stoppedBy = 'cancelled';
        riskLevel = 'medium';
        summary = cancelledBeforeStep.summary;
        finalReportText = cancelledBeforeStep.finalReport;
        break;
      }
      const remainingToolCalls = maxToolCalls - toolResults.length;
      if (remainingToolCalls <= CLOSEOUT_TOOL_CALL_RESERVE) {
        currentTodos = await repo.listTaskRunTodosForRun(runId);
        const reserveReason = `tool_budget_closeout_reserved: ${toolResults.length}/${maxToolCalls} tool results were consumed before finalize_answer.`;
        await markOpenTodosTerminalForBudget(runId, currentTodos, reserveReason);
        currentTodos = await repo.listTaskRunTodosForRun(runId);
        terminalState = 'needs_human';
        stoppedBy = 'budget';
        riskLevel = 'high';
        summary = 'Tool call budget exhausted before finalize_answer';
        finalReportText = buildToolBudgetFinalReport({
          reason: reserveReason,
          currentTodos,
          toolResults,
        });
        await emitAgentEvent(
          'run.needs_human',
          {
            reason: 'tool_budget_closeout_reserved',
            toolResultCount: toolResults.length,
            maxToolCalls,
            todos: currentTodos.map(toSupervisorTodoContext),
          },
          'warning'
        );
        break;
      }
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
      const runningTodo = currentTodos.find((todo) => todo.status === 'running');
      const progressContext = buildProgressContext({
        currentJobType,
        workspaceSnapshot,
        currentTodos,
        toolResults,
      });
      const round2UserPrompt = renderRound2UserContext({
        latestUserMessage: userInput,
        goal,
        currentJobType,
        workflow: currentJobType,
        safetyPolicy: input.safetyPolicy || null,
        todoPlan: currentTodos.map(toSupervisorTodoContext),
        currentTodo: runningTodo ? toSupervisorTodoContext(runningTodo) : null,
        toolResults: toolResults.slice(-8),
        loadedProcedureSummaries: loadedProcedureSummaryContext,
        artifactContextRefs: input.artifactContextRefs || [],
        workspaceSnapshot,
        progressContext,
      });
      const round2Prompt = buildPromptBudget({
        systemPrompt: round2SystemPrompt,
        userPrompt: round2UserPrompt,
        modelCapability: resolveStructuredLlmModelCapability({
          role: 'implementation',
          routeOverride: input.llmRouteOverride || null,
        }),
      });
      await emitAgentEvent('round2.prompt_built', {
        systemPrompt: round2Prompt.systemPrompt,
        userPrompt: round2Prompt.userPrompt,
        promptBudget: round2Prompt.metadata,
      });
      if (round2Prompt.metadata.budgetExceeded) {
        terminalState = 'needs_human';
        stoppedBy = 'budget';
        riskLevel = 'high';
        summary = 'Round 2 prompt budget exceeded before provider call';
        finalReportText =
          'Round 2 prompt budget exceeded before LLM provider call. The run stopped without sending an oversized request.';
        await markOpenTodosTerminalForBudget(
          runId,
          currentTodos,
          'budget_exceeded: Round 2 prompt exceeded the configured safe prompt budget.'
        );
        currentTodos = await repo.listTaskRunTodosForRun(runId);
        await emitAgentEvent(
          'run.needs_human',
          {
            reason: 'budget_exceeded',
            promptBudget: round2Prompt.metadata,
            todos: currentTodos.map(toSupervisorTodoContext),
          },
          'error'
        );
        break;
      }

      const round2 = (await callSupervisorLLM(round2Prompt.systemPrompt, round2Prompt.userPrompt, {
        round: 2,
        schemaFirst: true,
        role: 'implementation',
        routeOverride: input.llmRouteOverride || null,
        emitEvent: emitLlmDebugEvent,
        workingDirectory: repoRoot,
        taskId: task.id,
        runId,
        promptBudgetMetadata: round2Prompt.metadata,
        promptPartTokenEstimates: {
          systemPromptTokens: estimateTokens(round2Prompt.systemPrompt),
          userPromptTokens: estimateTokens(round2Prompt.userPrompt),
          stateCardTokens: 0,
        },
      })) as AgentToolCallEnvelope;
      const cancelledAfterProvider = await getCancelledRunResult(runId);
      if (cancelledAfterProvider) {
        terminalState = 'cancelled';
        stoppedBy = 'cancelled';
        riskLevel = 'medium';
        summary = cancelledAfterProvider.summary;
        finalReportText = cancelledAfterProvider.finalReport;
        break;
      }
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
        currentTodos = await repo.listTaskRunTodosForRun(runId);
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
            const redundantReplaceGap = getRedundantTodoReplaceGap({
              currentTodos,
              toolResults,
            });
            if (redundantReplaceGap) {
              const result = {
                step,
                toolName: 'todo_list',
                ok: false,
                arguments: round2.toolCall.arguments,
                summary: `tool=todo_list operation=replace status=failed\nerror=${redundantReplaceGap}`,
                error: redundantReplaceGap,
                payload: { todos: currentTodos.map(toSupervisorTodoContext) },
              };
              toolResults.push(result);
              await emitAgentEvent('tool.validation_failed', result, 'warning');
              continue;
            }
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
            currentTodos = await repo.replaceTaskRunTodosForRun(
              runId,
              buildStandardImplementationTodoList({
                todos: todos.map((todo) => ({
                  ...todo,
                  taskType: 'implementation',
                  procedureId: null,
                  dependsOn: [],
                })),
                startFirst,
              })
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
          if (isFinalCloseoutTodo(todo)) {
            const result = {
              step,
              toolName: 'todo_list',
              ok: true,
              arguments: round2.toolCall.arguments,
              summary: `tool=todo_list operation=start status=ok\nseq=${todo.seq} closeoutTodo=noop`,
              payload: { todos: currentTodos.map(toSupervisorTodoContext) },
            };
            toolResults.push(result);
            await emitAgentEvent('tool.finished', result);
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
          if (operation === 'done') {
            const evidenceGap = getTodoDoneEvidenceGap({ todo, toolResults });
            if (evidenceGap) {
              const result = {
                step,
                toolName: 'todo_list',
                ok: false,
                arguments: round2.toolCall.arguments,
                summary: `tool=todo_list operation=done status=failed\nerror=${evidenceGap}`,
                error: evidenceGap,
                payload: { todos: currentTodos.map(toSupervisorTodoContext) },
              };
              toolResults.push(result);
              await emitAgentEvent('tool.validation_failed', result, 'warning');
              continue;
            }
          }
          const now = new Date();
          await repo.updateTaskRunTodo(todo.id, {
            status,
            completedAt: now,
            startedAt: todo.startedAt ? new Date(todo.startedAt as string | number | Date) : now,
          });
          currentTodos = await repo.listTaskRunTodosForRun(runId);
          if (operation === 'done') {
            const nextTodo = currentTodos.find(
              (candidate) =>
                candidate.status === 'pending' &&
                candidate.seq > todo.seq &&
                !isFinalCloseoutTodo(candidate)
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
        const openTodos = currentTodos.filter(
          (todo) => ['pending', 'running'].includes(todo.status) && !isFinalCloseoutTodo(todo)
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
        await closeOpenCloseoutTodosForFinalize(runId, currentTodos);
        currentTodos = await repo.listTaskRunTodosForRun(runId);
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

      if (workerToolName === 'read_current_specification' && preRound1SpecificationPayload) {
        const result: CompactToolResult = {
          step,
          toolName: 'read_current_specification',
          ok: true,
          arguments: round2.toolCall.arguments,
          summary:
            'tool=read_current_specification status=ok cached=true\nSpecification was already read before Round 1; continue with the current Todo instead of re-reading it.',
          payload: preRound1SpecificationPayload,
        };
        toolResults.push(result);
        await emitAgentEvent('tool.finished', result);
        continue;
      }

      const executableArguments = buildExecutableWorkerToolArguments(
        workerToolName,
        round2.toolCall.arguments,
        toolResults
      );
      await emitAgentEvent('tool.started', {
        toolName: workerToolName,
        arguments: executableArguments,
      });
      const dispatch = await executeWorkerTool({
        toolName: workerToolName,
        args: executableArguments,
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
        arguments: executableArguments,
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
      summary = 'Tool call budget exhausted before finalize_answer';
      currentTodos = await repo.listTaskRunTodosForRun(runId);
      finalReportText = buildToolBudgetFinalReport({
        reason: `missing_finalize_answer: step=${step}, toolResults=${toolResults.length}/${maxToolCalls}`,
        currentTodos,
        toolResults,
      });
      await emitAgentEvent('run.needs_human', {
        reason: 'missing_finalize_answer',
        step,
        toolResultCount: toolResults.length,
        maxToolCalls,
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

type EmitAgentEvent = (
  type: AgentEventType,
  payload?: Record<string, unknown>,
  severity?: RunEventSeverity
) => Promise<void>;

type CurrentSpecificationPayload = {
  taskId?: string;
  found: boolean;
  messageId?: string | null;
  title?: string | null;
  generatedAt?: string | null;
  digest?: string | null;
  sources?: unknown;
  content?: string;
};

async function readCurrentSpecificationBeforeRound1(input: {
  repoRoot: string;
  taskId: string;
  safetyPolicy: SupervisorLoopInput['safetyPolicy'];
  readFiles: string[];
  emitAgentEvent: EmitAgentEvent;
}): Promise<CompactToolResult | null> {
  const args = { taskId: input.taskId };
  await input.emitAgentEvent('tool.started', {
    toolName: 'read_current_specification',
    arguments: args,
    phase: 'pre_round1_specification',
  });
  const dispatch = await executeWorkerTool({
    toolName: 'read_current_specification',
    args,
    repoRoot: input.repoRoot,
    taskId: input.taskId,
    safetyPolicy: input.safetyPolicy,
    readFiles: input.readFiles,
  });
  const payload = dispatch.result.payload;
  const result: CompactToolResult = {
    step: 0,
    toolName: 'read_current_specification',
    ok: dispatch.result.ok,
    arguments: args,
    summary: formatToolObservation('read_current_specification', dispatch.result),
    payload,
    error: dispatch.result.error,
  };
  await input.emitAgentEvent(dispatch.result.ok ? 'tool.finished' : 'tool.failed', result);
  return result;
}

function buildRound1UserInput(userInput: string, specification: unknown | undefined): string {
  if (!specification) return userInput;
  return [userInput, '', '[Current Specification]', JSON.stringify(specification, null, 2)].join(
    '\n'
  );
}

function specificationFound(payload: unknown): payload is CurrentSpecificationPayload {
  return isRecord(payload) && payload.found === true;
}

async function runContextCompileAfterRound1(input: {
  runId: string;
  repoRoot: string;
  taskId: string;
  safetyPolicy: SupervisorLoopInput['safetyPolicy'];
  readFiles: string[];
  currentJobType: JobType;
  goal: string;
  userInput: string;
  specification: unknown | undefined;
  emitAgentEvent: EmitAgentEvent;
}): Promise<{
  toolResult?: CompactToolResult;
  failure?: { summary: string; finalReport: string };
} | null> {
  const todos = await repo.listTaskRunTodosForRun(input.runId);
  const currentTodo = todos
    .filter((todo) => todo.status === 'running')
    .sort((a, b) => a.seq - b.seq)[0];
  if (!currentTodo || currentTodo.procedureId !== 'contextstill.context_compile') return null;

  const tool = await resolveContextStillTool('context_compile');
  const args = buildContextCompileArguments(input);
  if (!tool) {
    const summary = 'contextStill MCP tool is not available: context_compile';
    await markCurrentTodoTerminal(input.runId, currentTodo, 'failed', summary);
    return {
      failure: {
        summary,
        finalReport: `contextStill MCP gate を実行できません。MCP server に context_compile が見つかりません。`,
      },
    };
  }

  await input.emitAgentEvent('tool.started', {
    toolName: 'context-still.context_compile',
    mcpServer: tool.serverName,
    mcpTool: 'context_compile',
    serverId: tool.serverId,
    arguments: args,
    todoId: currentTodo.id,
    todoSeq: currentTodo.seq,
  });
  const dispatch = await executeWorkerTool({
    toolName: 'mcp_call_tool',
    args: {
      serverId: tool.serverId,
      toolName: 'context_compile',
      arguments: args,
    },
    repoRoot: input.repoRoot,
    taskId: input.taskId,
    safetyPolicy: input.safetyPolicy,
    readFiles: input.readFiles,
  });
  const toolResult: CompactToolResult = {
    step: 0,
    toolName: 'context-still.context_compile',
    ok: dispatch.result.ok,
    arguments: args,
    summary: formatToolObservation('context-still.context_compile', dispatch.result),
    payload: dispatch.result.payload,
    error: dispatch.result.error,
  };
  await input.emitAgentEvent(dispatch.result.ok ? 'tool.finished' : 'tool.failed', {
    ...toolResult,
    mcpServer: tool.serverName,
    mcpTool: 'context_compile',
    serverId: tool.serverId,
    status: dispatch.result.ok ? 'completed' : 'failed',
    todoId: currentTodo.id,
    todoSeq: currentTodo.seq,
  });

  if (!dispatch.result.ok) {
    const message =
      dispatch.result.error?.message || 'contextStill MCP tool failed: context_compile';
    await markCurrentTodoTerminal(input.runId, currentTodo, 'failed', message);
    return {
      toolResult,
      failure: {
        summary: message,
        finalReport: `contextStill MCP gate の実行に失敗しました: ${message}`,
      },
    };
  }

  await markCurrentTodoPassedAndAdvance(input.runId, currentTodo);
  return { toolResult };
}

function buildContextCompileArguments(input: {
  currentJobType: JobType;
  goal: string;
  userInput: string;
  specification: unknown | undefined;
}) {
  const spec = isRecord(input.specification) ? input.specification : {};
  const title = typeof spec.title === 'string' ? spec.title : null;
  const digest = typeof spec.digest === 'string' ? spec.digest : null;
  const specLine =
    title || digest
      ? `仕様書 ${title ? `「${title}」` : ''}${digest ? ` (${digest})` : ''} を前提にする。`
      : '仕様書が見つからない場合は、ユーザー依頼とリポジトリ状態を前提にする。';
  return {
    goal: [
      `NightWorkers ${input.currentJobType} run: ${input.goal}`,
      specLine,
      '設計書読み込みと Round1 判定後に、TODO 分解と実装開始に必要な最小コンテキストを取得する。',
    ].join(' '),
    changeTypes: ['implementation', 'verification'],
    technologies: ['typescript', 'bun', 'sqlite'],
    domains: ['nightWorkers'],
  };
}

async function resolveContextStillTool(toolName: 'context_compile') {
  const tools = await mcpClientManager.listAvailableTools();
  return (
    tools.find((tool) => tool.name === toolName && isContextStillTool(tool)) ??
    tools.find((tool) => tool.name === toolName) ??
    null
  );
}

function isContextStillTool(tool: McpToolSummary) {
  const serverName = tool.serverName.toLowerCase();
  const prefix = tool.toolPrefix.toLowerCase();
  return (
    serverName === 'context-still' ||
    serverName === 'contextstill' ||
    prefix === 'context_still' ||
    prefix === 'contextstill'
  );
}

async function markCurrentTodoPassedAndAdvance(
  runId: string,
  todo: { id: string; seq: number; startedAt?: unknown }
) {
  const run = await repo.getTaskRun(runId);
  if (!run) return;
  const now = new Date();
  await repo.updateTaskRunTodo(
    todo.id,
    {
      status: 'passed',
      completedAt: now,
      startedAt: todo.startedAt ? new Date(String(todo.startedAt)) : now,
    },
    { notifyTaskId: run.taskId, notifyRunId: run.id }
  );
  const refreshedTodos = await repo.listTaskRunTodosForRun(runId);
  const nextTodo = refreshedTodos
    .filter(
      (candidate) =>
        candidate.status === 'pending' &&
        candidate.seq > todo.seq &&
        !isFinalCloseoutTodo(candidate)
    )
    .sort((a, b) => a.seq - b.seq)[0];
  if (!nextTodo) return;
  await repo.startTaskRunTodoIfStillPendingAndNoEarlierOpen(
    {
      id: nextTodo.id,
      runId,
      afterSeq: todo.seq,
      startedAt: now,
    },
    { notifyTaskId: run.taskId, notifyRunId: run.id }
  );
}

function isFinalCloseoutTodo(todo: {
  taskType: string;
  procedureId?: string | null;
}) {
  return (
    (todo.taskType === 'knowledge_capture' &&
      todo.procedureId === 'contextstill.register_candidates') ||
    (todo.taskType === 'completion_report' && todo.procedureId === 'final_completion_report') ||
    todo.procedureId === 'contextstill_closeout'
  );
}

async function closeOpenCloseoutTodosForFinalize(
  runId: string,
  todos: Array<{
    id: string;
    taskType: string;
    procedureId?: string | null;
    status: string;
    startedAt?: unknown;
  }>
) {
  const run = await repo.getTaskRun(runId);
  if (!run) return;
  const now = new Date();
  const closeoutTodos = todos.filter(
    (todo) => ['pending', 'running'].includes(todo.status) && isFinalCloseoutTodo(todo)
  );
  for (const todo of closeoutTodos) {
    const isCompletionReport =
      todo.taskType === 'completion_report' && todo.procedureId === 'final_completion_report';
    await repo.updateTaskRunTodo(
      todo.id,
      {
        status: isCompletionReport ? 'passed' : 'skipped',
        statusReason: isCompletionReport
          ? 'finalize_answer received.'
          : 'No explicit knowledge registration was needed before finalize_answer.',
        completedAt: now,
        startedAt: todo.startedAt ? new Date(String(todo.startedAt)) : now,
      },
      { notifyTaskId: run.taskId, notifyRunId: run.id }
    );
  }
}

async function markCurrentTodoTerminal(
  runId: string,
  todo: { id: string; startedAt?: unknown },
  status: 'failed' | 'needs_human',
  reason: string
) {
  const run = await repo.getTaskRun(runId);
  if (!run) return;
  const now = new Date();
  await repo.updateTaskRunTodo(
    todo.id,
    {
      status,
      statusReason: reason,
      completedAt: now,
      startedAt: todo.startedAt ? new Date(String(todo.startedAt)) : now,
    },
    { notifyTaskId: run.taskId, notifyRunId: run.id }
  );
}

async function markOpenTodosTerminalForBudget(
  runId: string,
  todos: Array<{ id: string; status: string; startedAt?: unknown }>,
  reason: string
) {
  const run = await repo.getTaskRun(runId);
  if (!run) return;
  const now = new Date();
  const openTodos = todos.filter((todo) => ['pending', 'running'].includes(todo.status));
  for (const todo of openTodos) {
    await repo.updateTaskRunTodo(
      todo.id,
      {
        status: 'needs_human',
        statusReason: reason,
        completedAt: now,
        startedAt: todo.startedAt ? new Date(String(todo.startedAt)) : now,
      },
      { notifyTaskId: run.taskId, notifyRunId: run.id }
    );
  }
}

function buildToolBudgetFinalReport(input: {
  reason: string;
  currentTodos: Array<{
    seq: number;
    title: string;
    status: string;
    statusReason?: string | null;
  }>;
  toolResults: CompactToolResult[];
}) {
  const lastTool = [...input.toolResults].reverse()[0];
  const unresolved = input.currentTodos
    .filter((todo) => ['pending', 'running', 'needs_human', 'failed'].includes(todo.status))
    .map((todo) => `#${todo.seq} ${todo.status}: ${todo.title}`)
    .slice(0, 8);
  return [
    'Supervisor の tool call 予算を使い切る前に実行を停止しました。',
    `理由: ${input.reason}`,
    lastTool
      ? `最後の tool: ${lastTool.toolName} (${lastTool.ok ? 'ok' : 'failed'})`
      : '最後の tool: なし',
    unresolved.length > 0 ? `未完了 Todo: ${unresolved.join('; ')}` : '未完了 Todo: なし',
    '次の再実行では、現在 Todo に対応する具体的な worker tool から再開してください。',
  ].join('\n');
}

async function readWorkspaceSnapshot(repoRoot: string) {
  const entries = await fs.readdir(repoRoot, { withFileTypes: true }).catch((error: unknown) => {
    if (String(toDeepRecord(error).code) === 'ENOENT') return [];
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

async function getCancelledRunResult(runId: string): Promise<{
  summary: string;
  finalReport: string;
} | null> {
  const latestRun = await repo.getTaskRun(runId);
  if (latestRun?.status !== 'cancelled') return null;
  return {
    summary: latestRun.summary || 'Run stop requested by user.',
    finalReport: latestRun.finalReport || latestRun.summary || 'Run stop requested by user.',
  };
}

function buildExecutableWorkerToolArguments(
  toolName: string,
  arguments_: Record<string, unknown>,
  toolResults: CompactToolResult[]
): Record<string, unknown> {
  if (toolName !== 'read_file') return arguments_;
  if (arguments_.fresh === true || arguments_.compressionMode === 'off') return arguments_;
  if (arguments_.startLine !== undefined || arguments_.endLine !== undefined) return arguments_;
  if (!hasCachedReadFileResultForSameArguments(arguments_, toolResults)) return arguments_;
  return { ...arguments_, fresh: true };
}

function hasCachedReadFileResultForSameArguments(
  arguments_: Record<string, unknown>,
  toolResults: CompactToolResult[]
) {
  const filePath = arguments_.filePath;
  if (typeof filePath !== 'string') return false;
  return toolResults.some((result) => {
    if (result.toolName !== 'read_file' || !result.ok) return false;
    if (result.arguments.filePath !== filePath) return false;
    const payload = isRecord(result.payload) ? result.payload : {};
    return payload.cached === true;
  });
}
