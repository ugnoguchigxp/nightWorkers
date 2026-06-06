import { appendSupervisorTrace, logger } from '../../lib/logger';
import * as repo from '../../modules/nightworkers/nightworkers.repository';
import { estimateTokens } from '../conversation-context/token-budget';
import type { LlmPromptPartTokenEstimates } from '../llm-usage';
import type { SupervisorLoopResult } from '../run-control/types';
import type { RunEventActor, RunEventSeverity, RunEventType } from '../run-events/types';
import { executeWorkerTool } from '../worker-tools/dispatcher';
import type { SupervisorArtifactContextRef } from './artifact-contract';
import {
  buildExecutionReviewChecklist,
  checklistItemCanProveWorkerEvidence,
  type ExecutionReviewChecklistItem,
} from './execution-review';
import { callSupervisorLLM, type SupervisorLlmDebugEvent } from './llm-provider';
import {
  buildRound1JobTypePrompt,
  buildRound2ToolCallPrompt,
  getAllowedToolsForJobType,
  getExecutableWorkerToolName,
  type JobType,
  jobTypes,
  validateToolCallForJobType,
} from './prompt';
import type { AgentToolCallEnvelope } from './schema-first';
import {
  type LoadedSkillSummary,
  readSupervisorSkill,
  searchSupervisorSkills,
} from './skill-tools';
import { renderRound2UserContext } from './user-context';

export interface SupervisorLoopInput {
  runId: string;
  taskId?: string;
  repositoryId?: string;
  repoRoot: string;
  prompt: string;
  timeoutSeconds: number;
  latestUserMessage?: string;
  promptPartTokenEstimates?: LlmPromptPartTokenEstimates;
  todoPlan?: SupervisorTodoContext[];
  currentTodo?: SupervisorTodoContext;
  maxIterations?: number;
  maxToolCalls?: number;
  maxRepeatedToolPattern?: number;
  deadlineAt?: string;
  safetyPolicy?: {
    allowedPaths?: string[];
    externalAllowedPaths?: string[];
    deniedPaths?: string[];
    blockedCommands?: string[];
    maxCommandSeconds?: number;
  };
  artifactContextRefs?: SupervisorArtifactContextRef[];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function buildExecutionReviewContextSnapshot(input: {
  existingContextSnapshot: unknown;
  checklist: ExecutionReviewChecklistItem[];
  artifactContextRefs?: SupervisorArtifactContextRef[];
}) {
  const base = isRecord(input.existingContextSnapshot) ? { ...input.existingContextSnapshot } : {};
  return {
    ...base,
    executionReview: {
      checklist: input.checklist,
      artifactContextRefs: input.artifactContextRefs || [],
      workerEvidenceItemCount: input.checklist.filter(checklistItemCanProveWorkerEvidence).length,
    },
  };
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
  const loadedSkillSummaries = new Map<JobType, LoadedSkillSummary>();
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
    await emitAgentEvent('round1.parsed', round1);

    for (step = 1; step <= maxIterations && toolResults.length < maxToolCalls; step += 1) {
      const allowedTools = getAllowedToolsForJobType(currentJobType);

      const round2SystemPrompt = buildRound2ToolCallPrompt({
        projectRoot: repoRoot,
        jobType: currentJobType,
        tools: allowedTools,
        externalAllowedPaths: input.safetyPolicy?.externalAllowedPaths,
      });
      const loadedSkillSummaryContext = [...loadedSkillSummaries.values()].map((skill) => ({
        jobType: skill.jobType,
        path: skill.path,
        digest: skill.digest,
        useWhen: skill.summary.useWhen,
        procedure: skill.summary.procedure,
        requiredRules: skill.summary.requiredRules,
        loadedAtStep: skill.loadedAtStep,
      }));
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
        loadedSkillSummaries: loadedSkillSummaryContext,
        artifactContextRefs: input.artifactContextRefs || [],
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

      if (round2.toolCall.name === 'read_skill') {
        const requestedJobType = normalizeJobType(round2.toolCall.arguments.jobType);
        if (!requestedJobType) {
          const result = {
            step,
            toolName: 'read_skill',
            ok: false,
            arguments: round2.toolCall.arguments,
            summary: `Invalid jobType for read_skill: ${String(round2.toolCall.arguments.jobType)}`,
          };
          toolResults.push(result);
          await emitAgentEvent('tool.validation_failed', result, 'warning');
          continue;
        }
        try {
          const skill = readSupervisorSkill({ jobType: requestedJobType, loadedAtStep: step });
          loadedSkillSummaries.set(requestedJobType, skill);
          const result = {
            step,
            toolName: 'read_skill',
            ok: true,
            arguments: round2.toolCall.arguments,
            summary: `tool=read_skill status=ok\njobType=${requestedJobType} digest=${skill.digest}`,
            payload: skill,
          };
          toolResults.push(result);
          await emitAgentEvent('skill.loaded', {
            source: 'read_skill',
            jobType: requestedJobType,
            skillPath: skill.path,
            digest: skill.digest,
            summary: skill.summary,
          });
          await emitAgentEvent('tool.finished', result);
        } catch (err) {
          const result = {
            step,
            toolName: 'read_skill',
            ok: false,
            arguments: round2.toolCall.arguments,
            summary: `tool=read_skill status=failed\nerror=${formatErrorMessage(err)}`,
            error: formatErrorMessage(err),
          };
          toolResults.push(result);
          await emitAgentEvent('tool.failed', result, 'warning');
        }
        continue;
      }

      if (round2.toolCall.name === 'search_skill') {
        const query = String(round2.toolCall.arguments.query || '').trim();
        const maxResults =
          typeof round2.toolCall.arguments.maxResults === 'number'
            ? round2.toolCall.arguments.maxResults
            : undefined;
        try {
          const matches = searchSupervisorSkills({ query, maxResults });
          const result = {
            step,
            toolName: 'search_skill',
            ok: true,
            arguments: round2.toolCall.arguments,
            summary: `tool=search_skill status=ok\nmatches=${matches.matches.length}`,
            payload: matches,
          };
          toolResults.push(result);
          await emitAgentEvent('tool.finished', result);
        } catch (err) {
          const result = {
            step,
            toolName: 'search_skill',
            ok: false,
            arguments: round2.toolCall.arguments,
            summary: `tool=search_skill status=failed\nerror=${formatErrorMessage(err)}`,
            error: formatErrorMessage(err),
          };
          toolResults.push(result);
          await emitAgentEvent('tool.failed', result, 'warning');
        }
        continue;
      }

      if (round2.toolCall.name === 'replace_todo_list') {
        try {
          const todos = normalizeTodoListInput(round2.toolCall.arguments);
          const startFirst = round2.toolCall.arguments.startFirst !== false;
          const now = new Date();
          currentTodos = await repo.replaceTaskRunTodosForRun(
            runId,
            todos.map((todo, index) => ({
              ...todo,
              status: startFirst && index === 0 ? 'running' : 'pending',
              startedAt: startFirst && index === 0 ? now : null,
            }))
          );
          const result = {
            step,
            toolName: 'replace_todo_list',
            ok: true,
            arguments: round2.toolCall.arguments,
            summary: `tool=replace_todo_list status=ok\ntodos=${currentTodos.length}`,
            payload: { todos: currentTodos.map(toSupervisorTodoContext) },
          };
          toolResults.push(result);
          await emitAgentEvent('tool.finished', result);
        } catch (err) {
          const result = {
            step,
            toolName: 'replace_todo_list',
            ok: false,
            arguments: round2.toolCall.arguments,
            summary: `tool=replace_todo_list status=failed\nerror=${formatErrorMessage(err)}`,
            error: formatErrorMessage(err),
          };
          toolResults.push(result);
          await emitAgentEvent('tool.failed', result, 'warning');
        }
        continue;
      }

      if (round2.toolCall.name === 'start_todo') {
        const todo = findTodoByToolArguments(currentTodos, round2.toolCall.arguments);
        if (!todo) {
          const result = {
            step,
            toolName: 'start_todo',
            ok: false,
            arguments: round2.toolCall.arguments,
            summary: 'Todo not found for start_todo.',
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
          toolName: 'start_todo',
          ok: true,
          arguments: round2.toolCall.arguments,
          summary: `tool=start_todo status=ok\nseq=${todo.seq}`,
          payload: { todos: currentTodos.map(toSupervisorTodoContext) },
        };
        toolResults.push(result);
        await emitAgentEvent('tool.finished', result);
        continue;
      }

      if (round2.toolCall.name === 'complete_todo') {
        const todo = findTodoByToolArguments(currentTodos, round2.toolCall.arguments);
        const status = normalizeCompletionStatus(round2.toolCall.arguments.status);
        if (!todo || !status) {
          const result = {
            step,
            toolName: 'complete_todo',
            ok: false,
            arguments: round2.toolCall.arguments,
            summary: !todo ? 'Todo not found for complete_todo.' : 'Invalid completion status.',
          };
          toolResults.push(result);
          await emitAgentEvent('tool.validation_failed', result, 'warning');
          continue;
        }
        const now = new Date();
        await repo.updateTaskRunTodo(todo.id, {
          status,
          statusReason:
            typeof round2.toolCall.arguments.statusReason === 'string'
              ? round2.toolCall.arguments.statusReason
              : `Marked ${status} by Supervisor.`,
          completedAt: now,
          startedAt: todo.startedAt ? new Date(todo.startedAt as any) : now,
        });
        currentTodos = await repo.listTaskRunTodosForRun(runId);
        if (round2.toolCall.arguments.autoStartNext !== false) {
          const nextTodo = currentTodos.find((candidate) => candidate.status === 'pending');
          if (nextTodo) {
            await repo.updateTaskRunTodo(nextTodo.id, { status: 'running', startedAt: new Date() });
            currentTodos = await repo.listTaskRunTodosForRun(runId);
          }
        }
        const result = {
          step,
          toolName: 'complete_todo',
          ok: true,
          arguments: round2.toolCall.arguments,
          summary: `tool=complete_todo status=ok\nseq=${todo.seq} todoStatus=${status}`,
          payload: { todos: currentTodos.map(toSupervisorTodoContext) },
        };
        toolResults.push(result);
        await emitAgentEvent('tool.finished', result);
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
              .join(', ')}. Use complete_todo first.`,
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
        terminalState = 'completed';
        stoppedBy = 'decision';
        riskLevel = 'low';
        reviewChecklist = buildExecutionReviewChecklist({
          toolResults,
          artifactContextRefs: input.artifactContextRefs,
        });
        await emitAgentEvent('finalize.received', { message: finalReportText });
        await emitAgentEvent('run.completed', { finalReport: finalReportText, reviewChecklist });
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

function toSupervisorTodoContext(todo: {
  id: string;
  seq: number;
  title: string;
  description?: string | null;
  taskType: string;
  status: string;
  procedureId?: string | null;
  procedureSnapshot?: any;
  contextSnapshot?: any;
}): SupervisorTodoContext {
  const procedureSnapshot = todo.procedureSnapshot as any;
  const contextSnapshot = todo.contextSnapshot as any;
  return {
    id: todo.id,
    seq: todo.seq,
    title: todo.title,
    description: todo.description,
    taskType: todo.taskType,
    status: todo.status,
    procedureId: todo.procedureId,
    procedureDigest:
      typeof procedureSnapshot?.digest === 'string' ? procedureSnapshot.digest : undefined,
    contextDigest: typeof contextSnapshot?.digest === 'string' ? contextSnapshot.digest : undefined,
  };
}

function normalizeTodoListInput(args: Record<string, unknown>) {
  if (!Array.isArray(args.todos) || args.todos.length === 0) {
    throw new Error('replace_todo_list requires a non-empty todos array.');
  }
  return args.todos.map((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`Todo #${index + 1} must be an object.`);
    }
    const todo = raw as Record<string, unknown>;
    const seq = typeof todo.seq === 'number' ? todo.seq : index + 1;
    const title = typeof todo.title === 'string' ? todo.title.trim() : '';
    const taskType = typeof todo.taskType === 'string' ? todo.taskType.trim() : '';
    if (!title) throw new Error(`Todo #${seq} requires title.`);
    if (!taskType) throw new Error(`Todo #${seq} requires taskType.`);
    const dependsOn = Array.isArray(todo.dependsOn)
      ? todo.dependsOn.filter(
          (value): value is string | number =>
            typeof value === 'string' || typeof value === 'number'
        )
      : [];
    return {
      seq,
      title,
      description: typeof todo.description === 'string' ? todo.description : null,
      taskType,
      procedureId: typeof todo.procedureId === 'string' ? todo.procedureId : null,
      dependsOn,
    };
  });
}

function findTodoByToolArguments<TTodo extends { id: string; seq: number }>(
  todos: TTodo[],
  args: Record<string, unknown>
): TTodo | null {
  const todoId = typeof args.todoId === 'string' ? args.todoId : null;
  if (todoId) return todos.find((todo) => todo.id === todoId) ?? null;
  const seq = typeof args.seq === 'number' ? args.seq : null;
  if (seq !== null) return todos.find((todo) => todo.seq === seq) ?? null;
  return null;
}

function normalizeCompletionStatus(value: unknown) {
  if (value === 'passed' || value === 'failed' || value === 'skipped' || value === 'needs_human') {
    return value;
  }
  return null;
}

function getTemplateImportVerificationGap(toolResults: CompactToolResult[]): string | null {
  const copiedTemplate = toolResults.some(
    (result) => result.ok && result.toolName === 'copy_directory'
  );
  if (!copiedTemplate) return null;

  const readPackageJson = toolResults.some((result) => {
    if (!result.ok || result.toolName !== 'read_file') return false;
    const filePath = String(result.arguments.filePath || '');
    return filePath === 'package.json' || filePath.endsWith('/package.json');
  });
  if (!readPackageJson) {
    return 'Cannot finalize after copy_directory before reading package.json to identify available verification scripts.';
  }

  const ranVerification = toolResults.some(
    (result) =>
      result.ok &&
      (result.toolName === 'run_verification' ||
        (result.toolName === 'run_command' &&
          /\b(build|lint|typecheck|test|verify)\b/.test(String(result.arguments.command || ''))))
  );
  if (!ranVerification) {
    return 'Cannot finalize after copy_directory before running package.json-based verification such as build, lint, typecheck, test, or verify.';
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

function normalizeJobType(value: unknown): JobType | null {
  return typeof value === 'string' && jobTypes.includes(value as JobType)
    ? (value as JobType)
    : null;
}

function formatErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
