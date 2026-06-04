import { appendSupervisorTrace, logger } from '../../lib/logger';
import * as repo from '../../modules/nightworkers/nightworkers.repository';
import { runAgentHooks } from '../hooks/hooks-runner';
import type { AgentHookInput, AgentHookRunEvent } from '../hooks/types';
import { mcpClientManager } from '../mcp/mcp-client-manager';
import { RunBudgetController } from '../run-control/run-budget-controller';
import type { BudgetDecision, SupervisorLoopResult } from '../run-control/types';
import type { RunEventActor, RunEventSeverity, RunEventType } from '../run-events/types';
import { buildBlockedToolResult } from '../tool-policy/blocked-result';
import { DefaultToolPolicyGate } from '../tool-policy/tool-policy-gate';
import type { ToolCallRequest, WorkerToolName } from '../tool-policy/types';
import { executeWorkerTool } from '../worker-tools/dispatcher';
import { callSupervisorLLM, type SupervisorLlmDebugEvent } from './llm-provider';
import {
  buildRound1SystemPrompt,
  buildRound2SystemPrompt,
  buildSupervisorTurnInput,
  type ExternalSupervisorToolCatalogEntry,
  type SupervisorRoutingHypothesis,
  type SupervisorWorkflow,
} from './prompt';
import { defaultSupervisorRoutingHypothesis } from './skills/types';

export interface SupervisorLoopInput {
  runId: string;
  taskId?: string;
  repositoryId?: string;
  repoRoot: string;
  prompt: string;
  timeoutSeconds: number;
  latestUserMessage?: string;
  todoPlan?: SupervisorTodoContext[];
  currentTodo?: SupervisorTodoContext;
  maxIterations?: number;
  maxToolCalls?: number;
  maxRepeatedToolPattern?: number;
  deadlineAt?: string;
  safetyPolicy?: {
    allowedPaths?: string[];
    deniedPaths?: string[];
    blockedCommands?: string[];
    maxCommandSeconds?: number;
    requireReadBeforeEdit?: boolean;
  };
}

async function loadExternalSupervisorTools(): Promise<ExternalSupervisorToolCatalogEntry[]> {
  try {
    const tools = await mcpClientManager.listAvailableTools();
    return tools.map((tool) => ({
      namespacedName: tool.namespacedName,
      serverId: tool.serverId,
      toolName: tool.name,
      description: tool.description,
    }));
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'MCP tool catalog unavailable'
    );
    return [];
  }
}

export type SupervisorTodoContext = {
  id: string;
  seq: number;
  title: string;
  description?: string | null;
  taskType: string;
  status: string;
  procedureId?: string | null;
  procedureDigest?: string | null;
  contextDigest?: string | null;
};

function normalizeTodoPlan(value: unknown): SupervisorTodoContext[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 8)
    .map((item) => normalizeTodoContext(item))
    .filter((item): item is SupervisorTodoContext => Boolean(item));
}

function normalizeTodoContext(value: unknown): SupervisorTodoContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = stringValue(record.id);
  const seq = numberValue(record.seq);
  const title = stringValue(record.title);
  const taskType = stringValue(record.taskType);
  const status = stringValue(record.status);
  if (!id || !seq || !title || !taskType || !status) return null;
  return {
    id,
    seq,
    title: title.slice(0, 120),
    description: nullableString(record.description)?.slice(0, 500) ?? null,
    taskType,
    status,
    procedureId: nullableString(record.procedureId),
    procedureDigest: nullableString(record.procedureDigest),
    contextDigest: nullableString(record.contextDigest),
  };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

function todoEventData(todo: SupervisorTodoContext | null): Record<string, unknown> {
  if (!todo) return {};
  return {
    todoId: todo.id,
    todoSeq: todo.seq,
    todoTitle: todo.title,
    taskType: todo.taskType,
    procedureId: todo.procedureId,
  };
}

async function createSupervisorLlmRunEvent(input: {
  runId: string;
  taskId: string;
  iteration: number;
  event: SupervisorLlmDebugEvent;
  currentTodo?: SupervisorTodoContext | null;
}) {
  await repo.createRunEvent({
    version: 1,
    runId: input.runId,
    taskId: input.taskId,
    timestamp: new Date().toISOString(),
    type: input.event.type,
    severity: input.event.severity,
    actor: 'supervisor',
    message: input.event.message,
    data: {
      iteration: input.iteration,
      ...todoEventData(input.currentTodo ?? null),
      ...(input.event.data || {}),
    },
  });
}

async function createSupervisorRunEvent(input: {
  runId: string;
  taskId?: string;
  iteration?: number;
  type: RunEventType;
  severity: RunEventSeverity;
  actor: RunEventActor;
  message: string;
  data?: Record<string, unknown>;
  payloadJson?: Record<string, unknown>;
  currentTodo?: SupervisorTodoContext | null;
}) {
  const todoData = todoEventData(input.currentTodo ?? null);
  const data =
    input.iteration === undefined
      ? { ...todoData, ...(input.data || {}) }
      : { iteration: input.iteration, ...todoData, ...(input.data || {}) };
  await repo.createRunEvent(
    {
      version: 1,
      runId: input.runId,
      taskId: input.taskId,
      timestamp: new Date().toISOString(),
      type: input.type,
      severity: input.severity,
      actor: input.actor,
      message: input.message,
      ...(data ? { data } : {}),
    },
    { payloadJson: input.payloadJson || {} }
  );
}

export async function runSupervisorLoop(input: SupervisorLoopInput): Promise<SupervisorLoopResult> {
  const { runId, repoRoot, prompt, latestUserMessage } = input;
  let finalReportText = 'Task execution completed.';
  let terminalState: SupervisorLoopResult['terminalState'] = 'completed';
  let summary = 'Task execution completed.';
  let stoppedBy: SupervisorLoopResult['stoppedBy'] = 'decision';
  let riskLevel: SupervisorLoopResult['riskLevel'] = 'low';
  const maxIterations = input.maxIterations ?? 30;
  const maxToolCalls = input.maxToolCalls ?? 80;
  const maxRepeatedToolPattern = input.maxRepeatedToolPattern ?? 3;
  let activeWorkflow: SupervisorWorkflow = 'general';
  let activeRoutingHypothesis: SupervisorRoutingHypothesis = defaultSupervisorRoutingHypothesis;
  let workflowSelected = false;
  let workflowSelectionDecision: Awaited<ReturnType<typeof callSupervisorLLM>> | null = null;
  const budget = new RunBudgetController({
    maxIterations,
    maxToolCalls,
    maxRepeatedAction: maxRepeatedToolPattern,
    maxMissingToolCalls: 3,
    maxSchemaFallbacks: 3,
    timeoutSeconds: input.timeoutSeconds,
  });
  let iteration = 0;
  let supervisorToolCalls = 0;
  let editToolCalls = 0;
  const todoPlan = normalizeTodoPlan(input.todoPlan);
  const currentTodo = normalizeTodoContext(input.currentTodo) ?? null;
  const emitSupervisorRunEvent = (
    event: Omit<Parameters<typeof createSupervisorRunEvent>[0], 'currentTodo'>
  ) => createSupervisorRunEvent({ ...event, currentTodo });

  // Maintain list of read files for read-before-edit policy validation
  const readFiles: string[] = [];
  const toolContext = { readFileCache: new Map() };
  const toolObservations: string[] = [];
  const toolPolicyGate = new DefaultToolPolicyGate();
  let hookBlockedToolCalls = 0;
  let stopHookBlocks = 0;

  const readBackEditedFiles = async (
    taskId: string,
    sourceToolName: string,
    sourceToolResult: any
  ) => {
    const editedFiles = getEditedFilePathsForReadBack(sourceToolName, sourceToolResult);
    if (editedFiles.length === 0) return;

    for (const filePath of editedFiles.slice(0, 5)) {
      const readArgs = { filePath, fresh: true };
      appendSupervisorTrace('post_edit_readback_started', {
        runId,
        iteration,
        sourceToolName,
        filePath,
      });
      await emitSupervisorRunEvent({
        runId,
        taskId,
        iteration,
        type: 'tool.call_started',
        severity: 'info',
        actor: 'worker',
        message: `[Worker Tool Call] Invoking tool read_file after ${sourceToolName}...`,
        data: { toolName: 'read_file', arguments: readArgs, sourceToolName, automatic: true },
        payloadJson: {
          iteration,
          toolName: 'read_file',
          arguments: readArgs,
          sourceToolName,
          automatic: true,
        },
      });

      const dispatch = await executeWorkerTool({
        toolName: 'read_file',
        args: readArgs,
        repoRoot,
        safetyPolicy: input.safetyPolicy,
        readFiles,
        toolContext,
      });
      const readResult = dispatch.result;
      if (dispatch.readFilesChanged) {
        readFiles.splice(0, readFiles.length, ...dispatch.readFilesChanged);
      }
      toolObservations.push(
        `[Post-edit readback]\n${formatToolObservation('read_file', readResult)}`
      );
      await emitSupervisorRunEvent({
        runId,
        taskId,
        iteration,
        type: 'tool.call_finished',
        severity: readResult.ok ? 'info' : 'error',
        actor: 'worker',
        message: `[Worker Tool Result] Tool read_file post-edit readback ${readResult.ok ? 'SUCCESS' : 'FAILED'}.`,
        data: { toolName: 'read_file', result: readResult, sourceToolName, automatic: true },
        payloadJson: {
          iteration,
          ...readResult,
          sourceToolName,
          automatic: true,
        },
      });
      appendSupervisorTrace('post_edit_readback_finished', {
        runId,
        iteration,
        sourceToolName,
        filePath,
        ok: readResult.ok,
        error: readResult.error,
      });
    }

    if (editedFiles.length > 5) {
      appendSupervisorTrace('post_edit_readback_truncated', {
        runId,
        iteration,
        sourceToolName,
        readBackFiles: 5,
        changedFiles: editedFiles.length,
      });
    }
  };

  appendSupervisorTrace('supervisor_loop_started', {
    runId,
    repoRoot,
    maxIterations,
    maxToolCalls,
    maxRepeatedToolPattern,
    timeoutSeconds: input.timeoutSeconds,
    activeWorkflow,
    activeRoutingHypothesis,
  });

  while (true) {
    const iterationBudget = budget.onIterationStart();
    iteration += 1;
    if (!iterationBudget.allowed) {
      finalReportText = `Supervisor loop stopped by budget. reason=${iterationBudget.reason}`;
      terminalState = iterationBudget.reason === 'deadline' ? 'timed_out' : 'needs_human';
      summary =
        iterationBudget.reason === 'deadline'
          ? 'Stopped by timeout budget'
          : 'Stopped by iteration budget';
      stoppedBy = 'budget';
      await emitSupervisorRunEvent({
        runId,
        type: 'safety.budget_reached',
        severity: 'error',
        actor: 'system',
        message:
          iterationBudget.reason === 'deadline'
            ? '[Budget Stop] Supervisor timeout reached.'
            : '[Budget Stop] maxIterations reached.',
        data: { reason: iterationBudget.reason, ...(iterationBudget.detail || {}) },
        payloadJson: { reason: iterationBudget.reason, ...(iterationBudget.detail || {}) },
      });
      break;
    }
    logger.info({ runId, iteration }, 'Supervisor loop iteration start');

    // 1. Fetch current run and task details
    const run = await repo.getTaskRun(runId);
    if (!run) {
      throw new Error(`Run context not found: ${runId}`);
    }

    const task = await repo.getTask(run.taskId);
    if (!task) {
      throw new Error(`Task context not found: ${run.taskId}`);
    }

    const userInput = latestUserMessage?.trim()
      ? [latestUserMessage.trim(), '', '[Runtime Context]', prompt.trim() || '(empty)'].join('\n')
      : (prompt || '').trim();
    const schemaFallbackBudget: { stop: BudgetDecision | null; seen: boolean } = {
      stop: null,
      seen: false,
    };
    const emitLlmDebugEvent = async (event: SupervisorLlmDebugEvent) => {
      await createSupervisorLlmRunEvent({ runId, taskId: task.id, iteration, event, currentTodo });
      if (
        event.type === 'model.response_parse_failed' ||
        event.type === 'model.response_repaired' ||
        (event.type === 'model.retry_scheduled' &&
          typeof event.message === 'string' &&
          event.message.includes('json_schema'))
      ) {
        schemaFallbackBudget.seen = true;
        const decision = budget.onSchemaFallback(event.type);
        if (!decision.allowed) schemaFallbackBudget.stop = decision;
      }
    };

    const emitHookRunEvent = (event: AgentHookRunEvent) =>
      emitSupervisorRunEvent({
        runId,
        taskId: task.id,
        iteration,
        type: event.type,
        severity: event.severity,
        actor: 'system',
        message: event.message,
        data: event.data,
        payloadJson: event.data,
      });

    const buildHookBaseInput = (
      event: AgentHookInput['hook_event_name']
    ): Omit<AgentHookInput, 'hook_event_name'> & {
      hook_event_name: AgentHookInput['hook_event_name'];
    } =>
      ({
        hook_event_name: event,
        session_id: task.id,
        run_id: runId,
        task_id: task.id,
        repository_id: run.repositoryId ?? input.repositoryId,
        cwd: repoRoot,
        timestamp: new Date().toISOString(),
      }) as AgentHookInput;

    // 3. Prompt building
    const userPrompt = buildSupervisorTurnInput(userInput, toolObservations);

    // 4. Invoke the Supervisor LLM
    let decision: Awaited<ReturnType<typeof callSupervisorLLM>>;
    try {
      if (!workflowSelected) {
        const round1 = await callSupervisorLLM(buildRound1SystemPrompt(repoRoot), userPrompt, {
          tolerateSchemaFailure: false,
          round: 1,
          emitEvent: emitLlmDebugEvent,
          workingDirectory: repoRoot,
        });
        logger.info(
          {
            runId,
            iteration,
            round: 1,
            phase: round1.phase,
            hasToolCall: Boolean(round1.toolCall),
          },
          'Supervisor round decision'
        );
        logger.info({ runId, iteration, round: 1, output: round1 }, 'Supervisor round output');
        appendSupervisorTrace('round1_output', {
          runId,
          iteration,
          phase: round1.phase,
          workflow: round1.workflow,
          routingHypothesis: round1.routingHypothesis,
          hasToolCall: Boolean(round1.toolCall),
          toolName: round1.toolCall?.name ?? null,
        });
        await emitSupervisorRunEvent({
          runId,
          taskId: task.id,
          iteration,
          type: 'supervisor.decision',
          severity: 'info',
          actor: 'supervisor',
          message: `[Supervisor Round] round=1 phase=${round1.phase} hasToolCall=${Boolean(round1.toolCall)}`,
          data: { round: 1, decision: round1 },
          payloadJson: { round: 1, iteration, decision: round1 },
        });

        workflowSelected = true;
        workflowSelectionDecision = round1;
        activeWorkflow = round1.workflow || activeWorkflow;
        activeRoutingHypothesis = round1.routingHypothesis || activeRoutingHypothesis;
        if (round1.phase === 'stop' && !requiresWorkflowEvidence(activeWorkflow)) {
          decision = round1;
        } else {
          const round2Input = JSON.stringify({
            latestUserMessage: userInput,
            round1Decision: workflowSelectionDecision,
            todoPlan,
            observations: toolObservations.slice(-6),
          });
          const round2 = await callSupervisorLLM(
            buildRound2SystemPrompt(activeRoutingHypothesis, {
              projectRoot: repoRoot,
              externalTools: await loadExternalSupervisorTools(),
            }),
            round2Input,
            {
              round: 2,
              emitEvent: emitLlmDebugEvent,
              workingDirectory: repoRoot,
            }
          );
          logger.info(
            {
              runId,
              iteration,
              round: 2,
              phase: round2.phase,
              hasToolCall: Boolean(round2.toolCall),
            },
            'Supervisor round decision'
          );
          logger.info({ runId, iteration, round: 2, output: round2 }, 'Supervisor round output');
          appendSupervisorTrace('round2_output', {
            runId,
            iteration,
            phase: round2.phase,
            workflow: round2.workflow,
            routingHypothesis: round2.routingHypothesis,
            hasToolCall: Boolean(round2.toolCall),
            toolName: round2.toolCall?.name ?? null,
          });
          await emitSupervisorRunEvent({
            runId,
            taskId: task.id,
            iteration,
            type: 'supervisor.decision',
            severity: 'info',
            actor: 'supervisor',
            message: `[Supervisor Round] round=2 phase=${round2.phase} hasToolCall=${Boolean(round2.toolCall)}`,
            data: { round: 2, decision: round2 },
            payloadJson: { round: 2, iteration, decision: round2 },
          });
          decision = round2;
          activeWorkflow = round2.workflow || activeWorkflow;
          activeRoutingHypothesis = round2.routingHypothesis || activeRoutingHypothesis;
        }
      } else {
        if (!workflowSelectionDecision) {
          throw new Error('Round 1 workflow decision is missing.');
        }
        const round1Decision = {
          ...workflowSelectionDecision,
          workflow: activeWorkflow,
          routingHypothesis: activeRoutingHypothesis,
        };
        appendSupervisorTrace('round1_reused', {
          runId,
          iteration,
          workflow: activeWorkflow,
          routingHypothesis: activeRoutingHypothesis,
          observations: toolObservations.length,
        });
        const round2Input = JSON.stringify({
          latestUserMessage: userInput,
          round1Decision,
          todoPlan,
          observations: toolObservations.slice(-6),
        });
        const round2 = await callSupervisorLLM(
          buildRound2SystemPrompt(activeRoutingHypothesis, {
            projectRoot: repoRoot,
            externalTools: await loadExternalSupervisorTools(),
          }),
          round2Input,
          {
            round: 2,
            emitEvent: emitLlmDebugEvent,
            workingDirectory: repoRoot,
          }
        );
        logger.info(
          {
            runId,
            iteration,
            round: 2,
            phase: round2.phase,
            hasToolCall: Boolean(round2.toolCall),
          },
          'Supervisor round decision'
        );
        logger.info({ runId, iteration, round: 2, output: round2 }, 'Supervisor round output');
        appendSupervisorTrace('round2_output', {
          runId,
          iteration,
          phase: round2.phase,
          workflow: round2.workflow,
          routingHypothesis: round2.routingHypothesis,
          hasToolCall: Boolean(round2.toolCall),
          toolName: round2.toolCall?.name ?? null,
        });
        await emitSupervisorRunEvent({
          runId,
          taskId: task.id,
          iteration,
          type: 'supervisor.decision',
          severity: 'info',
          actor: 'supervisor',
          message: `[Supervisor Round] round=2 phase=${round2.phase} hasToolCall=${Boolean(round2.toolCall)}`,
          data: { round: 2, decision: round2 },
          payloadJson: { round: 2, iteration, decision: round2 },
        });
        decision = round2;
        activeWorkflow = round2.workflow || activeWorkflow;
        activeRoutingHypothesis = round2.routingHypothesis || activeRoutingHypothesis;
      }
      const schemaFallbackStop = schemaFallbackBudget.stop;
      if (schemaFallbackStop) {
        finalReportText = `Supervisor loop stopped by budget. reason=${schemaFallbackStop.reason}`;
        terminalState = 'needs_human';
        summary = 'Stopped by repeated schema fallback';
        stoppedBy = 'budget';
        await emitSupervisorRunEvent({
          runId,
          taskId: task.id,
          iteration,
          type: 'safety.budget_reached',
          severity: 'error',
          actor: 'system',
          message: '[Budget Stop] supervisor schema fallback repeated.',
          data: { reason: 'schema_fallback', ...(schemaFallbackStop.detail || {}) },
          payloadJson: { reason: 'schema_fallback', ...(schemaFallbackStop.detail || {}) },
        });
        break;
      }
      if (!schemaFallbackBudget.seen) {
        budget.onSchemaDecisionAccepted();
      }
      logger.info(
        {
          runId,
          iteration,
          phase: decision.phase,
          terminalState: decision.terminalState,
          hasToolCall: Boolean(decision.toolCall),
        },
        'Supervisor decision received'
      );
    } catch (err: any) {
      logger.error(
        {
          runId,
          iteration,
          errorMessage: err?.message,
          errorStack: err?.stack,
        },
        'Supervisor LLM call failed'
      );
      appendSupervisorTrace('supervisor_call_failed', {
        runId,
        iteration,
        errorMessage: err?.message,
      });
      await emitSupervisorRunEvent({
        runId,
        taskId: task.id,
        iteration,
        type: 'system.error',
        severity: 'error',
        actor: 'system',
        message: `Supervisor Loop encountered LLM parsing/connection error: ${err.message}`,
        data: { errorMessage: err.message },
      });
      finalReportText = `Supervisor LLM call failed: ${err.message}`;
      terminalState = 'needs_human';
      summary = 'Supervisor LLM error';
      stoppedBy = 'llm_error';
      break;
    }

    // 5. Log supervisor decision in the DB ledger
    await emitSupervisorRunEvent({
      runId,
      taskId: task.id,
      iteration,
      type: 'supervisor.decision',
      severity: 'info',
      actor: 'supervisor',
      message: `[Supervisor Decision] Phase: ${decision.phase}. Instruction: ${decision.instruction}`,
      data: { decision },
      payloadJson: { iteration, decision },
    });

    // 6. Handle terminal/report decisions
    const evidenceRequired = requiresWorkflowEvidence(decision.workflow || activeWorkflow);
    const editRequired = requiresWorkflowEdit(decision.workflow || activeWorkflow);
    if (
      editRequired &&
      editToolCalls === 0 &&
      (decision.phase === 'stop' || decision.phase === 'report')
    ) {
      const missingToolBudget = budget.onMissingToolCall();
      const detail = {
        iteration,
        reason:
          decision.phase === 'stop' ? 'stop_without_edit_attempt' : 'report_without_edit_attempt',
        phase: decision.phase,
        instruction: decision.instruction,
        rationale: decision.rationale,
        finalResponseLength: decision.finalResponse?.length ?? 0,
        expectedEvidence: decision.expectedEvidence ?? [],
        supervisorToolCalls,
        editToolCalls,
        ...(missingToolBudget.detail || {}),
      };
      appendSupervisorTrace(
        decision.phase === 'stop' ? 'stop_without_edit_attempt' : 'report_without_edit_attempt',
        { runId, ...detail }
      );
      await emitSupervisorRunEvent({
        runId,
        taskId: task.id,
        iteration,
        type: missingToolBudget.allowed ? 'system.warning' : 'safety.repeated_failure',
        severity: missingToolBudget.allowed ? 'warning' : 'error',
        actor: 'system',
        message: missingToolBudget.allowed
          ? `[Supervisor Guard] code_change ${decision.phase} was ignored because no edit tool was attempted.`
          : `[Budget Stop] supervisor repeatedly returned ${decision.phase} for a code_change without attempting an edit tool.`,
        data: detail,
        payloadJson: detail,
      });
      if (!missingToolBudget.allowed) {
        finalReportText =
          'code_change workflow で、replace_content または apply_patch を一度も実行せずに report/stop を繰り返したため停止しました。read-only という自己判断ではなく、編集ツールの実行結果を根拠にする必要があります。';
        terminalState = 'needs_human';
        summary = 'Stopped because supervisor reported completion without attempting an edit tool';
        stoppedBy = 'missing_tool_call';
        riskLevel = 'high';
        break;
      }
      continue;
    }

    if (decision.phase === 'stop') {
      if (evidenceRequired && supervisorToolCalls === 0) {
        const missingToolBudget = budget.onMissingToolCall();
        const detail = {
          iteration,
          reason: 'stop_without_evidence',
          phase: decision.phase,
          instruction: decision.instruction,
          rationale: decision.rationale,
          finalResponseLength: decision.finalResponse?.length ?? 0,
          expectedEvidence: decision.expectedEvidence ?? [],
          supervisorToolCalls,
          ...(missingToolBudget.detail || {}),
        };
        appendSupervisorTrace('stop_without_evidence', { runId, ...detail });
        await emitSupervisorRunEvent({
          runId,
          taskId: task.id,
          iteration,
          type: missingToolBudget.allowed ? 'system.warning' : 'safety.repeated_failure',
          severity: missingToolBudget.allowed ? 'warning' : 'error',
          actor: 'system',
          message: missingToolBudget.allowed
            ? '[Supervisor Guard] stop was ignored because repository evidence has not been collected yet.'
            : '[Budget Stop] supervisor repeatedly stopped before collecting repository evidence.',
          data: detail,
          payloadJson: detail,
        });
        if (!missingToolBudget.allowed) {
          finalReportText =
            '証拠取得が必要なタスクで、Supervisor が対象ファイルやログを確認する前に stop を繰り返したため停止しました。';
          terminalState = 'needs_human';
          summary = 'Stopped because supervisor stopped before collecting required evidence';
          stoppedBy = 'missing_tool_call';
          riskLevel = 'high';
          break;
        }
        continue;
      }

      const qualityFailure = evaluateStopDecisionQuality({
        decision,
        evidenceRequired,
        supervisorToolCalls,
      });
      if (qualityFailure) {
        const missingToolBudget = budget.onMissingToolCall();
        const detail = {
          iteration,
          reason: qualityFailure.reason,
          phase: decision.phase,
          instruction: decision.instruction,
          rationale: decision.rationale,
          finalResponseLength: decision.finalResponse?.trim().length ?? 0,
          expectedEvidence: decision.expectedEvidence ?? [],
          supervisorToolCalls,
          ...(missingToolBudget.detail || {}),
        };
        appendSupervisorTrace('stop_quality_rejected', { runId, ...detail });
        await emitSupervisorRunEvent({
          runId,
          taskId: task.id,
          iteration,
          type: missingToolBudget.allowed ? 'system.warning' : 'safety.repeated_failure',
          severity: missingToolBudget.allowed ? 'warning' : 'error',
          actor: 'system',
          message: missingToolBudget.allowed
            ? `[Supervisor Guard] ${qualityFailure.message}`
            : '[Budget Stop] supervisor repeatedly returned an incomplete final response.',
          data: detail,
          payloadJson: detail,
        });
        if (!missingToolBudget.allowed) {
          finalReportText =
            '証拠取得後の最終回答がレビュー本文として不十分なまま繰り返されたため停止しました。';
          terminalState = 'needs_human';
          summary = 'Stopped because final response quality was insufficient';
          stoppedBy = 'missing_tool_call';
          riskLevel = 'high';
          break;
        }
        continue;
      }

      const stopHook = await runAgentHooks({
        input: {
          ...buildHookBaseInput('Stop'),
          hook_event_name: 'Stop',
          stop_reason:
            (decision.terminalState as
              | 'completed'
              | 'needs_review'
              | 'needs_human'
              | 'failed'
              | 'blocked'
              | undefined) || 'end_turn',
          last_assistant_message:
            decision.finalResponse?.trim() || decision.instruction?.trim() || decision.rationale,
        },
        repoRoot,
        onEvent: emitHookRunEvent,
      });
      if (stopHook.additionalContext) {
        toolObservations.push(`[Hook Context] ${stopHook.additionalContext}`);
      }
      if (stopHook.decision === 'block') {
        stopHookBlocks += 1;
        const reason = stopHook.reason || 'Stop blocked by agent hook.';
        toolObservations.push(`[Hook Blocked Stop] ${reason}`);
        if (stopHookBlocks >= 2) {
          finalReportText = reason;
          terminalState = 'blocked';
          summary = 'Stopped because Stop hook blocked repeatedly';
          stoppedBy = 'hook';
          riskLevel = 'medium';
          break;
        }
        continue;
      }

      finalReportText =
        decision.finalResponse?.trim() || decision.instruction?.trim() || decision.rationale;
      terminalState =
        (decision.terminalState as SupervisorLoopResult['terminalState']) || 'completed';
      summary = decision.instruction || 'Stopped by supervisor decision';
      stoppedBy = 'decision';
      riskLevel = decision.riskLevel || 'low';

      await repo.updateTaskRun(runId, {
        finalReport: finalReportText,
        summary,
        status: terminalState,
      });

      await repo.updateTaskStatus(task.id, terminalState);
      logger.info(
        { runId, iteration, terminalState, finalReportLength: finalReportText.length },
        'Supervisor loop stopped'
      );
      break;
    }

    // 7. Dispatch worker tool executions
    if (decision.toolCall) {
      const { name, arguments: toolArgs } = decision.toolCall;
      const toolBudget = budget.onToolCall(name, toolArgs || {});
      if (!toolBudget.allowed) {
        finalReportText = `Supervisor loop stopped by budget. reason=${toolBudget.reason}`;
        terminalState = 'needs_human';
        summary =
          toolBudget.reason === 'tool_limit'
            ? 'Stopped by tool-call budget'
            : 'Stopped by repeated tool pattern';
        stoppedBy = 'budget';
        await emitSupervisorRunEvent({
          runId,
          taskId: task.id,
          iteration,
          type: 'safety.budget_reached',
          severity: 'error',
          actor: 'system',
          message:
            toolBudget.reason === 'tool_limit'
              ? '[Budget Stop] maxToolCalls reached.'
              : '[Budget Stop] repeated tool pattern detected.',
          data: { reason: toolBudget.reason, ...(toolBudget.detail || {}) },
          payloadJson: { reason: toolBudget.reason, ...(toolBudget.detail || {}) },
        });
        break;
      }
      supervisorToolCalls += 1;
      if (isEditTool(name)) editToolCalls += 1;
      logger.info({ runId, iteration, toolName: name, toolArgs }, 'Worker tool call start');
      // Log tool call start
      await emitSupervisorRunEvent({
        runId,
        taskId: task.id,
        iteration,
        type: name === 'run_verification' ? 'verification.started' : 'tool.call_started',
        severity: 'info',
        actor: name === 'run_verification' ? 'verifier' : 'worker',
        message: `[Worker Tool Call] Invoking tool ${name}...`,
        data: { toolName: name, arguments: toolArgs },
        payloadJson: {
          iteration,
          toolName: name,
          arguments: toolArgs,
        },
      });

      let toolResult: any;
      let policyViolationDetected = false;
      let hookBlockedToolCall = false;
      let postHookRequest: ToolCallRequest | null = null;
      let postHookArgs: Record<string, unknown> | null = null;

      try {
        const request: ToolCallRequest = {
          runId,
          iteration,
          toolName: name as WorkerToolName,
          args: (toolArgs && typeof toolArgs === 'object' ? toolArgs : {}) as Record<
            string,
            unknown
          >,
          repoRoot,
          safetyPolicy: input.safetyPolicy,
          readFiles,
        };
        const beforeDecision = await toolPolicyGate.beforeToolCall(request);
        if (!beforeDecision.allowed) {
          toolResult = buildBlockedToolResult(request, beforeDecision);
          policyViolationDetected = true;
          await emitSupervisorRunEvent({
            runId,
            taskId: task.id,
            iteration,
            type: 'tool.policy_blocked',
            severity: 'error',
            actor: 'system',
            message: `[Tool Policy Blocked] ${name}: ${beforeDecision.message}`,
            data: { toolName: name, policy: beforeDecision },
            payloadJson: {
              iteration,
              toolName: name,
              policy: beforeDecision,
            },
          });

          finalReportText = `Tool policy blocked execution. tool=${name} code=${beforeDecision.code}`;
          terminalState = 'needs_human';
          summary = 'Stopped by policy block';
          stoppedBy = 'policy';
        } else {
          const preHook = await runAgentHooks({
            input: {
              ...buildHookBaseInput('PreToolUse'),
              hook_event_name: 'PreToolUse',
              tool_name: request.toolName,
              tool_input: beforeDecision.normalizedArgs,
              tool_use_id: `${runId}:${iteration}:${request.toolName}`,
            },
            repoRoot,
            onEvent: emitHookRunEvent,
          });
          if (preHook.additionalContext) {
            toolObservations.push(`[Hook Context] ${preHook.additionalContext}`);
          }
          if (preHook.modifiedArgs) {
            await emitSupervisorRunEvent({
              runId,
              taskId: task.id,
              iteration,
              type: 'system.warning',
              severity: 'warning',
              actor: 'system',
              message: `[Agent Hook] ${name}: modifiedArgs ignored in first slice.`,
              data: { toolName: name, modifiedArgs: preHook.modifiedArgs },
              payloadJson: { iteration, toolName: name, modifiedArgs: preHook.modifiedArgs },
            });
          }
          if (preHook.decision === 'deny' || preHook.decision === 'block') {
            hookBlockedToolCall = true;
            hookBlockedToolCalls += 1;
            toolResult = buildBlockedToolResult(request, {
              allowed: false,
              code: 'HOOK_BLOCKED',
              message: preHook.reason || 'Tool call blocked by agent hook.',
            });
          } else {
            postHookRequest = request;
            postHookArgs = beforeDecision.normalizedArgs;
            const dispatch = await executeWorkerTool({
              toolName: request.toolName,
              args: beforeDecision.normalizedArgs,
              repoRoot,
              safetyPolicy: input.safetyPolicy,
              readFiles,
              toolContext,
            });
            toolResult = dispatch.result;
            if (dispatch.readFilesChanged) {
              readFiles.splice(0, readFiles.length, ...dispatch.readFilesChanged);
            }
            const postDecision = await toolPolicyGate.afterToolCall(
              request,
              dispatch.result,
              beforeDecision.preflight
            );
            toolResult = postDecision.result;
            if (postDecision.policyViolation && !postDecision.policyViolation.allowed) {
              policyViolationDetected = true;
              finalReportText = `Tool policy violation detected after execution. tool=${name} code=${postDecision.policyViolation.code}`;
              terminalState = 'needs_human';
              summary = 'Stopped by postflight policy violation';
              stoppedBy = 'policy';
              await emitSupervisorRunEvent({
                runId,
                taskId: task.id,
                iteration,
                type: 'safety.policy_violation',
                severity: 'error',
                actor: 'system',
                message: `[Tool Policy Violation] ${name}: ${postDecision.policyViolation.message}`,
                data: { toolName: name, policy: postDecision.policyViolation },
                payloadJson: {
                  iteration,
                  toolName: name,
                  policy: postDecision.policyViolation,
                },
              });
            }
            if (postDecision.warnings?.length) {
              await emitSupervisorRunEvent({
                runId,
                taskId: task.id,
                iteration,
                type: 'system.warning',
                severity: 'warning',
                actor: 'system',
                message: `[Tool Policy Warning] ${name}`,
                data: { toolName: name, warnings: postDecision.warnings },
                payloadJson: { iteration, toolName: name, warnings: postDecision.warnings },
              });
            }
            if (!policyViolationDetected) {
              const postHook = await runAgentHooks({
                input: {
                  ...buildHookBaseInput(toolResult.ok ? 'PostToolUse' : 'PostToolUseFailure'),
                  hook_event_name: toolResult.ok ? 'PostToolUse' : 'PostToolUseFailure',
                  tool_name: request.toolName,
                  tool_input: beforeDecision.normalizedArgs,
                  tool_use_id: `${runId}:${iteration}:${request.toolName}`,
                  ...(toolResult.ok
                    ? { tool_result: toolResult }
                    : { error: toolResult.error?.message || 'Tool execution failed' }),
                },
                repoRoot,
                onEvent: emitHookRunEvent,
              });
              if (postHook.additionalContext) {
                toolObservations.push(`[Hook Context] ${postHook.additionalContext}`);
              }
            }
          }
        }
      } catch (toolErr: any) {
        toolResult = {
          ok: false,
          toolName: name,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          payload: {},
          error: {
            code: 'TOOL_EXECUTION_ERROR',
            message: toolErr.message,
          },
        };
        if (postHookRequest && postHookArgs && !hookBlockedToolCall && !policyViolationDetected) {
          const failureHook = await runAgentHooks({
            input: {
              ...buildHookBaseInput('PostToolUseFailure'),
              hook_event_name: 'PostToolUseFailure',
              tool_name: postHookRequest.toolName,
              tool_input: postHookArgs,
              tool_use_id: `${runId}:${iteration}:${postHookRequest.toolName}`,
              error: toolResult.error?.message || 'Tool execution failed',
            },
            repoRoot,
            onEvent: emitHookRunEvent,
          });
          if (failureHook.additionalContext) {
            toolObservations.push(`[Hook Context] ${failureHook.additionalContext}`);
          }
        }
      }

      logger.info(
        {
          runId,
          iteration,
          toolName: name,
          ok: toolResult.ok,
          error: toolResult.error,
          payloadKeys: Object.keys(toolResult.payload || {}),
          payloadPreview: JSON.stringify(toolResult.payload || {}).slice(0, 500),
        },
        'Worker tool call completed'
      );

      const failureBudget = hookBlockedToolCall
        ? ({ allowed: true } as BudgetDecision)
        : budget.onToolResult(toolResult.ok);
      toolObservations.push(formatToolObservation(name, toolResult));

      // Log tool execution result in ledger
      await emitSupervisorRunEvent({
        runId,
        taskId: task.id,
        iteration,
        type: name === 'run_verification' ? 'verification.finished' : 'tool.call_finished',
        severity: toolResult.ok ? 'info' : 'error',
        actor: name === 'run_verification' ? 'verifier' : 'worker',
        message: `[Worker Tool Result] Tool ${name} execution ${toolResult.ok ? 'SUCCESS' : 'FAILED'}.`,
        data: { toolName: name, result: toolResult },
        payloadJson: {
          iteration,
          ...toolResult,
        },
      });

      if (toolResult.ok && isEditTool(name)) {
        await readBackEditedFiles(task.id, name, toolResult);
      }

      if (policyViolationDetected && stoppedBy === 'policy') {
        await repo.updateTaskRun(runId, {
          finalReport: finalReportText,
          summary,
          status: 'needs_human',
        });
        await repo.updateTaskStatus(task.id, 'needs_human');
        break;
      }

      if (hookBlockedToolCall) {
        const reason = toolResult.error?.message || 'Tool call blocked by agent hook.';
        toolObservations.push(`[Hook Blocked Tool] ${reason}`);
        if (hookBlockedToolCalls >= maxRepeatedToolPattern) {
          finalReportText = reason;
          terminalState = 'blocked';
          summary = 'Stopped because agent hook blocked tool calls repeatedly';
          stoppedBy = 'hook';
          riskLevel = 'medium';
          await repo.updateTaskRun(runId, {
            finalReport: finalReportText,
            summary,
            status: terminalState,
          });
          await repo.updateTaskStatus(task.id, terminalState);
          break;
        }
        continue;
      }

      if (!failureBudget.allowed && failureBudget.reason === 'tool_failure') {
        const failureSummary = toolResult.error?.message || 'Unknown tool failure';
        finalReportText = `同一ラン内でツール実行失敗が3回連続したため中断しました。lastTool=${name} error=${failureSummary}`;
        await emitSupervisorRunEvent({
          runId,
          taskId: task.id,
          iteration,
          type: 'safety.repeated_failure',
          severity: 'error',
          actor: 'system',
          message: '[Safety Stop] Aborted after 3 consecutive tool failures.',
          data: {
            ...(failureBudget.detail || {}),
            lastToolName: name,
            lastError: toolResult.error ?? null,
          },
          payloadJson: {
            iteration,
            ...(failureBudget.detail || {}),
            lastToolName: name,
            lastError: toolResult.error ?? null,
          },
        });
        await repo.updateTaskRun(runId, {
          finalReport: finalReportText,
          summary: 'Stopped by safety policy after repeated tool failures',
          status: 'needs_human',
        });
        await repo.updateTaskStatus(task.id, 'needs_human');
        terminalState = 'needs_human';
        summary = 'Stopped by safety policy after repeated tool failures';
        stoppedBy = 'tool_failure';
        break;
      }

      const multimodalType = detectMessageType(toolResult);
      if (multimodalType) {
        await repo.createTaskMessage({
          taskId: run.taskId,
          runId,
          role: 'tool',
          content: `[${name}] returned ${multimodalType} payload`,
          messageType: multimodalType,
          payloadJson: extractMultimodalPayload(multimodalType, toolResult),
        });
      }

      // Track raw output as artifacts if relevant
      if (
        toolResult.ok &&
        (name === 'git_diff' || name === 'run_command') &&
        toolResult.payload.diff
      ) {
        await repo.createArtifact({
          runId,
          kind: 'diff',
          path: 'git_diff.patch',
          metadataJson: { bytes: toolResult.payload.diff.length },
        });
      }
      if (toolResult.payload?.logArtifactPath) {
        await repo.createArtifact({
          runId,
          kind: name === 'run_verification' ? 'verification_log' : 'command_log',
          path: toolResult.payload.logArtifactPath,
          metadataJson: {
            toolName: name,
            command: toolResult.payload.command,
            exitCode: toolResult.payload.exitCode,
            classification: toolResult.payload.classification,
            truncated: toolResult.payload.truncated,
          },
        });
      }
    } else {
      const missingToolBudget = budget.onMissingToolCall();
      if (!missingToolBudget.allowed) {
        finalReportText = 'toolCall が連続で欠落したため停止しました。';
        terminalState = 'needs_human';
        summary = 'Stopped by missing toolCall pattern';
        stoppedBy = 'missing_tool_call';
      }
      await emitSupervisorRunEvent({
        runId,
        taskId: task.id,
        iteration,
        type: 'system.warning',
        severity: 'warning',
        actor: 'system',
        message:
          'Supervisor did not specify any worker tool action. continuing until missing_tool_call threshold.',
        data: { reason: 'missing_tool_call', ...(missingToolBudget.detail || {}) },
      });
      if (!missingToolBudget.allowed) {
        await emitSupervisorRunEvent({
          runId,
          taskId: task.id,
          iteration,
          type: 'safety.repeated_failure',
          severity: 'error',
          actor: 'system',
          message: '[Budget Stop] missing toolCall repeated.',
          data: { reason: 'missing_tool_call', ...(missingToolBudget.detail || {}) },
          payloadJson: { reason: 'missing_tool_call', ...(missingToolBudget.detail || {}) },
        });
      }
      if (!missingToolBudget.allowed) {
        break;
      }
    }
  }

  const run = await repo.getTaskRun(runId);
  if (run) {
    await repo.updateTaskRun(runId, {
      finalReport: finalReportText,
      summary,
      status: terminalState,
    });
    await repo.updateTaskStatus(run.taskId, terminalState);
  }
  const evidenceRequired = requiresWorkflowEvidence(activeWorkflow);
  appendSupervisorTrace('supervisor_loop_finished', {
    runId,
    terminalState,
    stoppedBy,
    summary,
    riskLevel,
    iterations: iteration,
    supervisorToolCalls,
    editToolCalls,
    activeWorkflow,
    evidenceRequired,
    finalReportLength: finalReportText.length,
  });
  logger.info(
    {
      runId,
      terminalState,
      stoppedBy,
      riskLevel,
      iterations: iteration,
      supervisorToolCalls,
      editToolCalls,
      activeWorkflow,
      evidenceRequired,
      finalReportLength: finalReportText.length,
    },
    'Supervisor loop finished'
  );
  return {
    finalReport: finalReportText,
    terminalState,
    summary,
    stoppedBy,
    riskLevel,
  };
}

function requiresWorkflowEvidence(workflow: SupervisorWorkflow): boolean {
  return workflow === 'evidence_review' || workflow === 'code_change' || workflow === 'research';
}

function requiresWorkflowEdit(workflow: SupervisorWorkflow): boolean {
  return workflow === 'code_change';
}

function isEditTool(toolName: string): boolean {
  return toolName === 'apply_patch' || toolName === 'replace_content';
}

function getEditedFilePathsForReadBack(toolName: string, toolResult: any): string[] {
  if (!toolResult?.ok || !toolResult.payload?.applied) return [];
  if (toolName === 'apply_patch') {
    const changedFiles: string[] = Array.isArray(toolResult.payload.changedFiles)
      ? (toolResult.payload.changedFiles as unknown[]).filter(
          (filePath: unknown): filePath is string => typeof filePath === 'string'
        )
      : [];
    return [...new Set(changedFiles)];
  }
  if (toolName === 'replace_content') {
    const filePath = toolResult.payload.filePath;
    return typeof filePath === 'string' && filePath.trim() ? [filePath] : [];
  }
  return [];
}

function evaluateStopDecisionQuality(input: {
  decision: Awaited<ReturnType<typeof callSupervisorLLM>>;
  evidenceRequired: boolean;
  supervisorToolCalls: number;
}): { reason: string; message: string } | null {
  const { decision, evidenceRequired, supervisorToolCalls } = input;
  if (!evidenceRequired || supervisorToolCalls === 0) return null;

  const finalResponse = decision.finalResponse?.trim() || '';
  if (!finalResponse) {
    return {
      reason: 'empty_final_response_after_evidence',
      message:
        'stop was ignored because finalResponse was empty after repository evidence was collected.',
    };
  }

  if (finalResponse.length < 120) {
    return {
      reason: 'too_short_final_response_after_evidence',
      message:
        'stop was ignored because finalResponse was too short to be a substantive review result.',
    };
  }

  return null;
}

function formatToolObservation(toolName: string, toolResult: any): string {
  const status = toolResult.ok ? 'ok' : 'failed';
  const header = `tool=${toolName} status=${status}`;
  if (!toolResult.ok) {
    return `${header}\nerror=${toolResult.error?.code || 'UNKNOWN'}: ${
      toolResult.error?.message || 'Unknown tool error'
    }`;
  }

  if (toolName === 'read_file') {
    const payload = toolResult.payload || {};
    const content = typeof payload.content === 'string' ? payload.content : '';
    const maxChars = 24_000;
    return [
      header,
      `lines=${payload.startLine ?? '?'}-${payload.endLine ?? '?'} total=${payload.totalLines ?? '?'}`,
      content.slice(0, maxChars),
      content.length > maxChars ? '[truncated]' : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (toolName === 'inspect_structure') {
    const payload = toolResult.payload || {};
    return `${header}\n${JSON.stringify(payload).slice(0, 12_000)}`;
  }

  if (toolName === 'search_files') {
    const matches = Array.isArray(toolResult.payload?.matches) ? toolResult.payload.matches : [];
    return `${header}\nmatches=${matches.length}\n${JSON.stringify(matches.slice(0, 10)).slice(0, 3000)}`;
  }

  if (toolName === 'git_status') {
    return `${header}\n${toolResult.payload?.shortStatus || 'Clean worktree'}`;
  }

  if (toolName === 'git_diff') {
    return `${header}\n${toolResult.payload?.diffStat || 'No changes'}`;
  }

  return `${header}\npayload=${JSON.stringify(toolResult.payload || {}).slice(0, 3000)}`;
}

function detectMessageType(
  toolResult: any
): 'chart' | 'browser' | 'playwright' | 'flow' | 'markdown_document' | null {
  const payload = toolResult?.payload;
  if (!payload || typeof payload !== 'object') return null;
  if (payload.chartData) return 'chart';
  if (payload.browserFrameData) return 'browser';
  if (payload.playwrightResult) return 'playwright';
  if (payload.flowData) return 'flow';
  if (payload.markdownDocumentData) return 'markdown_document';
  return null;
}

function extractMultimodalPayload(messageType: string, toolResult: any) {
  const payload = toolResult?.payload || {};
  if (messageType === 'chart') return { chartData: payload.chartData };
  if (messageType === 'browser') return { browserFrameData: payload.browserFrameData };
  if (messageType === 'playwright') return { playwrightResult: payload.playwrightResult };
  if (messageType === 'flow') return { flowData: payload.flowData };
  if (messageType === 'markdown_document')
    return { markdownDocumentData: payload.markdownDocumentData };
  return {};
}
