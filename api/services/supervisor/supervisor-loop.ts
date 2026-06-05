import { appendSupervisorTrace, logger } from '../../lib/logger';
import * as repo from '../../modules/nightworkers/nightworkers.repository';
import type { SupervisorLoopResult } from '../run-control/types';
import type { RunEventActor, RunEventSeverity, RunEventType } from '../run-events/types';
import { executeWorkerTool } from '../worker-tools/dispatcher';
import { callSupervisorLLM, type SupervisorLlmDebugEvent } from './llm-provider';
import {
  type AgentToolCallEnvelope,
  buildRound1JobTypePrompt,
  buildRound2ToolCallPrompt,
  getAllowedToolsForJobType,
  getExecutableWorkerToolName,
  type JobType,
  loadFlatSkill,
  validateToolCallForJobType,
} from './schema-first';

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

type CompactToolResult = {
  step: number;
  toolName: string;
  ok: boolean;
  arguments: Record<string, unknown>;
  summary: string;
  payload?: unknown;
  error?: unknown;
};

type AgentEventType =
  | 'run.started'
  | 'round1.prompt_built'
  | 'round1.parsed'
  | 'skill.loaded'
  | 'round2.prompt_built'
  | 'round2.parsed'
  | 'round2.invalid'
  | 'tool.validation_failed'
  | 'tool.started'
  | 'tool.finished'
  | 'tool.failed'
  | 'job.switched'
  | 'finalize.received'
  | 'run.completed'
  | 'run.needs_human'
  | 'run.failed';

function mapAgentEventToRunEventType(type: AgentEventType): RunEventType {
  if (type === 'tool.started') return 'tool.call_started';
  if (type === 'tool.finished' || type === 'tool.failed') return 'tool.call_finished';
  if (type === 'round1.parsed' || type === 'round2.parsed') return 'supervisor.decision';
  if (type === 'run.failed') return 'system.error';
  if (type === 'run.needs_human') return 'system.warning';
  return 'system.info';
}

function eventActor(type: AgentEventType): RunEventActor {
  if (type.startsWith('tool.')) return 'worker';
  if (type.startsWith('round')) return 'supervisor';
  return 'runtime';
}

function eventMessage(type: AgentEventType): string {
  return `[SchemaFirstAgent] ${type}`;
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
}) {
  const data =
    input.iteration === undefined
      ? input.data || {}
      : { iteration: input.iteration, ...(input.data || {}) };
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
      data,
    },
    { payloadJson: input.payloadJson || {} }
  );
}

async function createSupervisorLlmRunEvent(input: {
  runId: string;
  taskId: string;
  iteration: number;
  event: SupervisorLlmDebugEvent;
}) {
  await createSupervisorRunEvent({
    runId: input.runId,
    taskId: input.taskId,
    iteration: input.iteration,
    type: input.event.type,
    severity: input.event.severity,
    actor: 'supervisor',
    message: input.event.message,
    data: input.event.data || {},
    payloadJson: {
      agentEventType: input.event.type,
      ...(input.event.data || {}),
    },
  });
}

function buildUserInput(input: SupervisorLoopInput): string {
  const latest = input.latestUserMessage?.trim();
  if (latest) return latest;
  return (input.prompt || '').trim();
}

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
  let step = 0;
  let currentJobType: JobType = 'minor_code_edit';
  let goal = userInput;
  let loadedSkillJobType: JobType | null = null;
  let finalReportText = '';
  let terminalState: SupervisorLoopResult['terminalState'] = 'completed';
  let summary = '';
  let stoppedBy: SupervisorLoopResult['stoppedBy'] = 'decision';
  let riskLevel: SupervisorLoopResult['riskLevel'] = 'low';

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
      emitEvent: emitLlmDebugEvent,
      workingDirectory: repoRoot,
    })) as { jobType: JobType; goal: string };
    currentJobType = round1.jobType;
    goal = round1.goal.trim() || userInput;
    await emitAgentEvent('round1.parsed', round1);

    for (step = 1; step <= maxIterations && toolResults.length < maxToolCalls; step += 1) {
      const skill = loadFlatSkill(currentJobType);
      const allowedTools = getAllowedToolsForJobType(currentJobType);
      if (loadedSkillJobType !== currentJobType) {
        loadedSkillJobType = currentJobType;
        await emitAgentEvent('skill.loaded', {
          skillPath: `skills/${currentJobType}.md`,
          skill,
        });
      }

      const round2SystemPrompt = buildRound2ToolCallPrompt({
        projectRoot: repoRoot,
        jobType: currentJobType,
        skill,
        tools: allowedTools,
      });
      const round2UserPrompt = JSON.stringify({
        goal,
        currentJobType,
        toolResults: toolResults.slice(-8),
      });
      await emitAgentEvent('round2.prompt_built', {
        systemPrompt: round2SystemPrompt,
        userPrompt: round2UserPrompt,
      });
      const round2 = (await callSupervisorLLM(round2SystemPrompt, round2UserPrompt, {
        round: 2,
        schemaFirst: true,
        emitEvent: emitLlmDebugEvent,
        workingDirectory: repoRoot,
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

      if (round2.toolCall.name === 'finalize_answer') {
        const message = String(round2.toolCall.arguments.message || '').trim();
        finalReportText = message || '';
        summary = finalReportText.slice(0, 200) || 'Completed';
        terminalState = 'completed';
        stoppedBy = 'decision';
        riskLevel = 'low';
        await emitAgentEvent('finalize.received', { message: finalReportText });
        await emitAgentEvent('run.completed', { finalReport: finalReportText });
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
