import { appendSupervisorTrace, logger } from '../../lib/logger';
import * as repo from '../../modules/nightworkers/nightworkers.repository';
import { mcpClientManager } from '../mcp/mcp-client-manager';
import type { SupervisorLoopResult } from '../run-control/types';
import type { RunEventActor, RunEventSeverity, RunEventType } from '../run-events/types';
import type { WorkerToolName } from '../tool-policy/types';
import { executeWorkerTool } from '../worker-tools/dispatcher';
import { callSupervisorLLM, type SupervisorLlmDebugEvent } from './llm-provider';
import {
  buildFinalizeSystemPrompt,
  buildRound1SystemPrompt,
  buildRound2SystemPrompt,
  buildSupervisorTurnInput,
  type ExternalSupervisorToolCatalogEntry,
  type SupervisorRoutingHypothesis,
  type SupervisorWorkflow,
} from './prompt';
import {
  compactSessionMemoryForPrompt,
  createInitialSessionMemory,
  digestSessionMemory,
  mergeDecisionIntoSessionMemory,
  mergeToolResultIntoSessionMemory,
  type SupervisorSessionMemory,
} from './session-memory';
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
  const maxIterations = input.maxIterations ?? 8;
  const maxToolCalls = input.maxToolCalls ?? 20;
  const todoPlan = normalizeTodoPlan(input.todoPlan);
  const currentTodo = normalizeTodoContext(input.currentTodo) ?? null;
  const readFiles: string[] = [];
  const toolContext = { readFileCache: new Map() };
  const toolObservations: string[] = [];
  const sessionMemory = createInitialSessionMemory(latestUserMessage || prompt);

  let finalReportText = 'Task execution completed.';
  let terminalState: SupervisorLoopResult['terminalState'] = 'completed';
  let summary = 'Task execution completed.';
  let stoppedBy: SupervisorLoopResult['stoppedBy'] = 'decision';
  let riskLevel: SupervisorLoopResult['riskLevel'] = 'low';
  let iteration = 0;
  let toolCalls = 0;
  let activeWorkflow: SupervisorWorkflow = 'general';
  let activeRoutingHypothesis: SupervisorRoutingHypothesis = defaultSupervisorRoutingHypothesis;
  let round1Decision: Awaited<ReturnType<typeof callSupervisorLLM>> | null = null;
  let memory: SupervisorSessionMemory = sessionMemory;

  const emitSupervisorRunEvent = (
    event: Omit<Parameters<typeof createSupervisorRunEvent>[0], 'currentTodo'>
  ) => createSupervisorRunEvent({ ...event, currentTodo });

  const run = await repo.getTaskRun(runId);
  if (!run) throw new Error(`Run context not found: ${runId}`);
  const task = await repo.getTask(run.taskId);
  if (!task) throw new Error(`Task context not found: ${run.taskId}`);

  const userInput = latestUserMessage?.trim()
    ? [latestUserMessage.trim(), '', '[Runtime Context]', prompt.trim() || '(empty)'].join('\n')
    : (prompt || '').trim();

  appendSupervisorTrace('supervisor_loop_started', {
    runId,
    repoRoot,
    maxIterations,
    maxToolCalls,
  });

  try {
    for (iteration = 1; iteration <= maxIterations; iteration += 1) {
      logger.info({ runId, iteration }, 'Supervisor loop iteration start');
      const emitLlmDebugEvent = async (event: SupervisorLlmDebugEvent) => {
        await createSupervisorLlmRunEvent({
          runId,
          taskId: task.id,
          iteration,
          event,
          currentTodo,
        });
      };

      let decision: Awaited<ReturnType<typeof callSupervisorLLM>>;
      if (!round1Decision) {
        const userPrompt = buildSupervisorTurnInput(userInput, toolObservations);
        round1Decision = await callSupervisorLLM(buildRound1SystemPrompt(repoRoot), userPrompt, {
          tolerateSchemaFailure: false,
          round: 1,
          emitEvent: emitLlmDebugEvent,
          workingDirectory: repoRoot,
        });
        activeWorkflow = round1Decision.workflow || activeWorkflow;
        activeRoutingHypothesis = round1Decision.routingHypothesis || activeRoutingHypothesis;
        memory = mergeDecisionIntoSessionMemory(memory, round1Decision, {
          iteration,
          source: 'round1',
        });
        await emitSessionMemoryEvent({
          runId,
          taskId: task.id,
          iteration,
          reason: 'round1_decision',
          memory,
          emitSupervisorRunEvent,
        });
        await emitDecisionEvent({
          runId,
          taskId: task.id,
          iteration,
          round: 1,
          decision: round1Decision,
          emitSupervisorRunEvent,
        });
        appendSupervisorTrace('round1_output', {
          runId,
          iteration,
          phase: round1Decision.phase,
          workflow: round1Decision.workflow,
          routingHypothesis: round1Decision.routingHypothesis,
          hasToolCall: Boolean(round1Decision.toolCall),
          toolName: round1Decision.toolCall?.name ?? null,
        });
        if (round1Decision.phase === 'stop' || round1Decision.phase === 'report') {
          decision = round1Decision;
        } else {
          decision = await requestRound2({
            runId,
            taskId: task.id,
            iteration,
            userInput,
            round1Decision,
            todoPlan,
            toolObservations,
            sessionMemory: memory,
            activeRoutingHypothesis,
            repoRoot,
            emitLlmDebugEvent,
            emitSupervisorRunEvent,
          });
        }
      } else {
        decision = await requestRound2({
          runId,
          taskId: task.id,
          iteration,
          userInput,
          round1Decision: {
            ...round1Decision,
            workflow: activeWorkflow,
            routingHypothesis: activeRoutingHypothesis,
          },
          todoPlan,
          toolObservations,
          sessionMemory: memory,
          activeRoutingHypothesis,
          repoRoot,
          emitLlmDebugEvent,
          emitSupervisorRunEvent,
        });
      }

      activeWorkflow = decision.workflow || activeWorkflow;
      activeRoutingHypothesis = decision.routingHypothesis || activeRoutingHypothesis;
      memory = mergeDecisionIntoSessionMemory(memory, decision, {
        iteration,
        source: 'round2',
      });
      await emitSessionMemoryEvent({
        runId,
        taskId: task.id,
        iteration,
        reason: `round_${decision.phase === 'report' ? 'stop' : decision.phase}_decision`,
        memory,
        emitSupervisorRunEvent,
      });
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

      if (isTerminalDecision(decision)) {
        const finalized = await requestFinalizeAnswer({
          runId,
          taskId: task.id,
          iteration,
          userInput,
          decision,
          todoPlan,
          currentTodo,
          toolObservations,
          sessionMemory: memory,
          repoRoot,
          activeWorkflow,
          emitLlmDebugEvent,
          emitSupervisorRunEvent,
        });
        finalReportText = finalized.finalReportText;
        terminalState = finalized.terminalState;
        summary = finalized.summary;
        riskLevel = finalized.riskLevel;
        stoppedBy = 'decision';
        memory = finalized.sessionMemory;
        break;
      }

      if (!decision.toolCall) {
        if (memory.changedFiles.length > 0) {
          const finalized = await requestFinalizeAnswer({
            runId,
            taskId: task.id,
            iteration,
            userInput,
            decision: {
              ...decision,
              phase: 'stop',
              terminalState: decision.terminalState || 'needs_review',
            },
            todoPlan,
            currentTodo,
            toolObservations,
            sessionMemory: memory,
            repoRoot,
            activeWorkflow,
            emitLlmDebugEvent,
            emitSupervisorRunEvent,
          });
          finalReportText = finalized.finalReportText;
          terminalState = finalized.terminalState;
          summary = finalized.summary;
          riskLevel = finalized.riskLevel;
          stoppedBy = 'decision';
          memory = finalized.sessionMemory;
        } else {
          finalReportText = 'Supervisor decision did not include a worker toolCall.';
          terminalState = 'needs_human';
          summary = 'Stopped because supervisor did not provide a toolCall';
          stoppedBy = 'missing_tool_call';
          riskLevel = 'high';
        }
        break;
      }

      if (toolCalls >= maxToolCalls) {
        finalReportText = 'Supervisor loop stopped by maxToolCalls.';
        terminalState = 'needs_human';
        summary = 'Stopped by tool-call budget';
        stoppedBy = 'budget';
        riskLevel = 'high';
        break;
      }

      const { name, arguments: toolArgs } = decision.toolCall;
      toolCalls += 1;
      await emitSupervisorRunEvent({
        runId,
        taskId: task.id,
        iteration,
        type: name === 'run_verification' ? 'verification.started' : 'tool.call_started',
        severity: 'info',
        actor: name === 'run_verification' ? 'verifier' : 'worker',
        message: `[Worker Tool Call] Invoking tool ${name}...`,
        data: { toolName: name, arguments: toolArgs },
        payloadJson: { iteration, toolName: name, arguments: toolArgs },
      });

      const dispatch = await executeWorkerTool({
        toolName: name as WorkerToolName,
        args: (toolArgs && typeof toolArgs === 'object' ? toolArgs : {}) as Record<string, unknown>,
        repoRoot,
        safetyPolicy: input.safetyPolicy,
        readFiles,
        toolContext,
      });
      if (dispatch.readFilesChanged) {
        readFiles.splice(0, readFiles.length, ...dispatch.readFilesChanged);
      }
      const toolResult = dispatch.result;
      const observation = formatToolObservation(name, toolResult);
      toolObservations.push(observation);
      const changedFiles = getEditedFilePaths(name, toolResult);
      memory = mergeToolResultIntoSessionMemory(memory, {
        iteration,
        toolName: name as WorkerToolName,
        toolResult,
        observation,
        changedFiles,
      });
      await emitSessionMemoryEvent({
        runId,
        taskId: task.id,
        iteration,
        reason: `${name}_result`,
        memory,
        emitSupervisorRunEvent,
      });
      await emitSupervisorRunEvent({
        runId,
        taskId: task.id,
        iteration,
        type: name === 'run_verification' ? 'verification.finished' : 'tool.call_finished',
        severity: toolResult.ok ? 'info' : 'error',
        actor: name === 'run_verification' ? 'verifier' : 'worker',
        message: `[Worker Tool Result] Tool ${name} execution ${toolResult.ok ? 'SUCCESS' : 'FAILED'}.`,
        data: { toolName: name, result: toolResult },
        payloadJson: { iteration, ...toolResult },
      });

      if (isEditTool(name) && toolResult.ok) {
        appendSupervisorTrace('edit_tool_completed_continue', {
          runId,
          iteration,
          toolName: name,
          changedFiles,
        });
      }

      if (!toolResult.ok) {
        finalReportText = toolResult.error?.message || `Tool ${name} failed.`;
        terminalState = 'needs_human';
        summary = `Stopped because tool ${name} failed`;
        stoppedBy = 'tool_failure';
        riskLevel = 'high';
        break;
      }
    }

    if (iteration > maxIterations) {
      finalReportText = 'Supervisor loop stopped by maxIterations.';
      terminalState = 'needs_human';
      summary = 'Stopped by iteration budget';
      stoppedBy = 'budget';
      riskLevel = 'high';
    }
  } catch (err: any) {
    finalReportText = `Supervisor LLM call failed: ${err.message}`;
    terminalState = 'needs_human';
    summary = 'Supervisor LLM error';
    stoppedBy = 'llm_error';
    riskLevel = 'high';
  }

  await repo.updateTaskRun(runId, {
    finalReport: finalReportText,
    summary,
    status: terminalState,
  });
  await repo.updateTaskStatus(run.taskId, terminalState);
  appendSupervisorTrace('supervisor_loop_finished', {
    runId,
    terminalState,
    stoppedBy,
    summary,
    riskLevel,
    iterations: iteration,
    toolCalls,
    activeWorkflow,
    finalReportLength: finalReportText.length,
  });
  logger.info(
    {
      runId,
      terminalState,
      stoppedBy,
      riskLevel,
      iterations: iteration,
      toolCalls,
      activeWorkflow,
      finalReportLength: finalReportText.length,
    },
    'Supervisor loop finished'
  );
  return { finalReport: finalReportText, terminalState, summary, stoppedBy, riskLevel };
}

async function requestRound2(input: {
  runId: string;
  taskId: string;
  iteration: number;
  userInput: string;
  round1Decision: Awaited<ReturnType<typeof callSupervisorLLM>>;
  todoPlan: SupervisorTodoContext[];
  toolObservations: string[];
  sessionMemory: SupervisorSessionMemory;
  activeRoutingHypothesis: SupervisorRoutingHypothesis;
  repoRoot: string;
  emitLlmDebugEvent: (event: SupervisorLlmDebugEvent) => Promise<void>;
  emitSupervisorRunEvent: (
    event: Omit<Parameters<typeof createSupervisorRunEvent>[0], 'currentTodo'>
  ) => Promise<void>;
}): Promise<Awaited<ReturnType<typeof callSupervisorLLM>>> {
  const round2Input = JSON.stringify({
    latestUserMessage: input.userInput,
    round1Decision: input.round1Decision,
    sessionMemory: compactSessionMemoryForPrompt(input.sessionMemory),
    todoPlan: input.todoPlan,
    observations: input.toolObservations.slice(-6),
  });
  const decision = await callSupervisorLLM(
    buildRound2SystemPrompt(input.activeRoutingHypothesis, {
      projectRoot: input.repoRoot,
      externalTools: await loadExternalSupervisorTools(),
    }),
    round2Input,
    {
      round: 2,
      emitEvent: input.emitLlmDebugEvent,
      workingDirectory: input.repoRoot,
    }
  );
  await emitDecisionEvent({
    runId: input.runId,
    taskId: input.taskId,
    iteration: input.iteration,
    round: 2,
    decision,
    emitSupervisorRunEvent: input.emitSupervisorRunEvent,
  });
  appendSupervisorTrace('round2_output', {
    runId: input.runId,
    iteration: input.iteration,
    phase: decision.phase,
    workflow: decision.workflow,
    routingHypothesis: decision.routingHypothesis,
    hasToolCall: Boolean(decision.toolCall),
    toolName: decision.toolCall?.name ?? null,
  });
  return decision;
}

async function requestFinalizeAnswer(input: {
  runId: string;
  taskId: string;
  iteration: number;
  userInput: string;
  decision: Awaited<ReturnType<typeof callSupervisorLLM>>;
  todoPlan: SupervisorTodoContext[];
  currentTodo: SupervisorTodoContext | null;
  toolObservations: string[];
  sessionMemory: SupervisorSessionMemory;
  repoRoot: string;
  activeWorkflow: SupervisorWorkflow;
  emitLlmDebugEvent: (event: SupervisorLlmDebugEvent) => Promise<void>;
  emitSupervisorRunEvent: (
    event: Omit<Parameters<typeof createSupervisorRunEvent>[0], 'currentTodo'>
  ) => Promise<void>;
}): Promise<{
  finalReportText: string;
  terminalState: SupervisorLoopResult['terminalState'];
  summary: string;
  riskLevel: SupervisorLoopResult['riskLevel'];
  sessionMemory: SupervisorSessionMemory;
}> {
  let finalizeDecision: Awaited<ReturnType<typeof callSupervisorLLM>> | null = null;
  try {
    finalizeDecision = await callSupervisorLLM(
      buildFinalizeSystemPrompt(input.repoRoot),
      JSON.stringify({
        latestUserMessage: input.userInput,
        sessionMemory: compactSessionMemoryForPrompt(input.sessionMemory),
        observations: input.toolObservations.slice(-8),
        finalDecision: {
          ...input.decision,
          phase: 'stop',
        },
        todoPlan: input.todoPlan,
        currentTodo: input.currentTodo,
      }),
      {
        round: 3,
        tolerateSchemaFailure: true,
        emitEvent: input.emitLlmDebugEvent,
        workingDirectory: input.repoRoot,
      }
    );
    if (finalizeDecision.phase !== 'stop' || finalizeDecision.toolCall) {
      appendSupervisorTrace('finalize_answer_rejected', {
        runId: input.runId,
        iteration: input.iteration,
        phase: finalizeDecision.phase,
        toolName: finalizeDecision.toolCall?.name ?? null,
      });
      finalizeDecision = null;
    }
    await emitDecisionEvent({
      runId: input.runId,
      taskId: input.taskId,
      iteration: input.iteration,
      round: 3,
      decision: finalizeDecision || {
        ...input.decision,
        phase: 'stop',
        toolCall: null,
      },
      emitSupervisorRunEvent: input.emitSupervisorRunEvent,
    });
  } catch (err) {
    appendSupervisorTrace('finalize_answer_failed', {
      runId: input.runId,
      iteration: input.iteration,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const fallbackText =
    input.decision.finalResponse?.trim() ||
    input.decision.instruction?.trim() ||
    input.decision.rationale?.trim() ||
    'Task complete.';
  const finalReportText = finalizeDecision?.finalResponse?.trim() || fallbackText;
  const terminalState =
    normalizeTerminalState(finalizeDecision?.terminalState) ||
    normalizeTerminalState(input.decision.terminalState) ||
    (input.activeWorkflow === 'code_change' || input.sessionMemory.changedFiles.length > 0
      ? 'needs_review'
      : 'completed');
  const summary =
    finalizeDecision?.instruction?.trim() ||
    input.decision.instruction?.trim() ||
    finalReportText.slice(0, 200);
  const riskLevel = finalizeDecision?.riskLevel || input.decision.riskLevel || 'low';
  const sessionMemory = finalizeDecision
    ? mergeDecisionIntoSessionMemory(input.sessionMemory, finalizeDecision, {
        iteration: input.iteration,
        source: 'finalize',
      })
    : input.sessionMemory;

  await emitSessionMemoryEvent({
    runId: input.runId,
    taskId: input.taskId,
    iteration: input.iteration,
    reason: 'finalize_answer',
    memory: sessionMemory,
    emitSupervisorRunEvent: input.emitSupervisorRunEvent,
  });

  return { finalReportText, terminalState, summary, riskLevel, sessionMemory };
}

async function emitDecisionEvent(input: {
  runId: string;
  taskId: string;
  iteration: number;
  round: number;
  decision: Awaited<ReturnType<typeof callSupervisorLLM>>;
  emitSupervisorRunEvent: (
    event: Omit<Parameters<typeof createSupervisorRunEvent>[0], 'currentTodo'>
  ) => Promise<void>;
}) {
  await input.emitSupervisorRunEvent({
    runId: input.runId,
    taskId: input.taskId,
    iteration: input.iteration,
    type: 'supervisor.decision',
    severity: 'info',
    actor: 'supervisor',
    message: `[Supervisor Round] round=${input.round} phase=${input.decision.phase} hasToolCall=${Boolean(input.decision.toolCall)}`,
    data: { round: input.round, decision: input.decision },
    payloadJson: { round: input.round, iteration: input.iteration, decision: input.decision },
  });
}

function isEditTool(toolName: string): boolean {
  return toolName === 'apply_patch' || toolName === 'replace_content';
}

function isTerminalDecision(decision: Awaited<ReturnType<typeof callSupervisorLLM>>): boolean {
  return decision.phase === 'stop' || decision.phase === 'report';
}

async function emitSessionMemoryEvent(input: {
  runId: string;
  taskId: string;
  iteration: number;
  reason: string;
  memory: SupervisorSessionMemory;
  emitSupervisorRunEvent: (
    event: Omit<Parameters<typeof createSupervisorRunEvent>[0], 'currentTodo'>
  ) => Promise<void>;
}) {
  const promptSnapshot = compactSessionMemoryForPrompt(input.memory);
  await input.emitSupervisorRunEvent({
    runId: input.runId,
    taskId: input.taskId,
    iteration: input.iteration,
    type: 'system.info',
    severity: 'info',
    actor: 'supervisor',
    message: `[SessionMemory] Updated: ${input.reason}.`,
    data: {
      reason: input.reason,
      sessionMemoryDigest: digestSessionMemory(input.memory),
      changedFiles: input.memory.changedFiles,
      evidenceCount: input.memory.evidence.length,
      verificationCount: input.memory.verification.length,
      blockerCount: input.memory.blockers.length,
    },
    payloadJson: {
      iteration: input.iteration,
      reason: input.reason,
      sessionMemory: promptSnapshot,
    },
  });
}

function normalizeTerminalState(value: unknown): SupervisorLoopResult['terminalState'] | null {
  if (
    value === 'completed' ||
    value === 'needs_review' ||
    value === 'needs_human' ||
    value === 'failed' ||
    value === 'timed_out' ||
    value === 'blocked'
  ) {
    return value;
  }
  return null;
}

function getEditedFilePaths(toolName: string, toolResult: any): string[] {
  if (toolName === 'apply_patch') {
    const changedFiles = Array.isArray(toolResult.payload?.changedFiles)
      ? toolResult.payload.changedFiles
      : [];
    return changedFiles.filter(
      (filePath: unknown): filePath is string => typeof filePath === 'string'
    );
  }
  if (toolName === 'replace_content') {
    const filePath = toolResult.payload?.filePath;
    return typeof filePath === 'string' && filePath.trim() ? [filePath] : [];
  }
  return [];
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
    return [
      header,
      `lines=${payload.startLine ?? '?'}-${payload.endLine ?? '?'} total=${payload.totalLines ?? '?'}`,
      content.slice(0, 12_000),
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (toolName === 'git_status')
    return `${header}\n${toolResult.payload?.shortStatus || 'Clean worktree'}`;
  if (toolName === 'git_diff') return `${header}\n${toolResult.payload?.diffStat || 'No changes'}`;
  return `${header}\npayload=${JSON.stringify(toolResult.payload || {}).slice(0, 3000)}`;
}
