import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppError, NotFoundError } from '../../lib/errors';
import { createLedgerSink } from '../../services/agent-runtime/ledger-sink';
import { resolveAgentRuntime } from '../../services/agent-runtime/registry';
import type { AgentRuntimeResult } from '../../services/agent-runtime/types';
import {
  BlueprintDataDesignGenerationError,
  generateBlueprintDataDesignDraft,
  parseBlueprintDbDesignRequestPrompt,
} from '../../services/blueprints/data-design';
import { renderBlueprintMarkdown } from '../../services/blueprints/draft';
import {
  BlueprintDraftGenerationError,
  generatePlanModeBlueprintDraft,
} from '../../services/blueprints/llm-draft';
import { validateAppBlueprint } from '../../services/blueprints/validation';
import {
  buildPromptWithStateCard,
  getLatestConversationContextForTask,
  type RefreshConversationContextInput,
  refreshConversationContextSnapshot,
} from '../../services/conversation-context';
import {
  isConversationContextBuildOnIdleEnabled,
  isConversationContextStateCardEnabled,
} from '../../services/conversation-context/flags';
import { nightWorkersRealtimeBroker } from '../../services/realtime/nightworkers-ws';
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
import { nativeLocalRunner } from '../../services/runner/NativeLocalRunner';
import {
  callSupervisorLLM,
  type SupervisorLlmDebugEvent,
} from '../../services/supervisor/llm-provider';
import { buildRound1JobTypePrompt, type JobType } from '../../services/supervisor/prompt';
import type { JobTypeSelection } from '../../services/supervisor/schema-first';
import type { SupervisorRoutingHypothesis } from '../../services/supervisor/skills/types';
import { digestText } from '../../services/text-digest';
import type { RuntimePromptSnapshot } from '../../services/todo-context';
import * as repo from './nightworkers.repository';

type TaskMessageRow = Awaited<ReturnType<typeof repo.listTaskMessages>>[number];

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

async function maybeLoadConversationStateCard(taskId: string) {
  if (!isConversationContextStateCardEnabled()) return null;
  try {
    return await getLatestConversationContextForTask(taskId);
  } catch (error) {
    console.warn('conversation context load failed', { error, taskId });
    return null;
  }
}

export type BlueprintPlanningReadiness = {
  source: 'adopted' | 'latest_generated' | 'none';
  diagnostic: 'adopted_blueprint' | 'using_latest_generated_blueprint' | 'no_adopted_blueprint';
  messageId: string | null;
  blueprint: unknown;
  summary: string;
};

function outcomeFromRuntimeResult(runtimeResult: AgentRuntimeResult) {
  const status = runtimeResult.terminalState;
  const reason =
    runtimeResult.stoppedBy === 'policy'
      ? 'policy_violation'
      : runtimeResult.stoppedBy === 'budget'
        ? 'budget_exceeded'
        : runtimeResult.stoppedBy === 'tool_failure'
          ? 'tool_failure_limit'
          : runtimeResult.stoppedBy;
  return {
    status,
    reason,
    summary: runtimeResult.finalReport || runtimeResult.summary || `Runtime finished: ${status}`,
  };
}

// --- Repositories ---
export async function createRepository(data: {
  name: string;
  localPath: string;
  branch?: string;
  allowed?: boolean;
  queueEnabled?: boolean;
  maxConcurrentSessions?: number;
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

export async function updateRepository(
  id: string,
  data: {
    queueEnabled?: boolean;
    maxConcurrentSessions?: number;
  }
) {
  const normalized = {
    ...data,
    maxConcurrentSessions:
      data.maxConcurrentSessions === undefined
        ? undefined
        : Math.max(1, Math.floor(data.maxConcurrentSessions)),
  };
  const updated = await repo.updateRepository(id, normalized);
  if (!updated) throw new NotFoundError('Repository not found');
  if (updated.queueEnabled) {
    void runSessionQueueForRepository(updated.id);
  }
  return updated;
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

export async function listTaskActivityEvents(taskId: string, options?: { afterSeq?: number }) {
  const task = await repo.getTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  const events = await repo.listActivityEventsForTask(taskId, { afterSeq: options?.afterSeq });
  const artifacts = await listReferencedActivityArtifacts(taskId, events);
  return { events, artifacts };
}

export async function resolveBlueprintPlanningReadiness(
  taskId: string
): Promise<BlueprintPlanningReadiness> {
  const messages = await repo.listTaskMessages(taskId);
  const blueprintMessages = messages.filter(isAppBlueprintMessage);
  for (const message of [...blueprintMessages].reverse()) {
    const adoption = await repo.getBlueprintArtifactAdoption(taskId, message.id);
    if (adoption?.adopted) {
      return buildBlueprintPlanningReadiness('adopted', message);
    }
  }
  const latestGenerated = blueprintMessages.at(-1);
  if (latestGenerated) {
    return buildBlueprintPlanningReadiness('latest_generated', latestGenerated);
  }
  return {
    source: 'none',
    diagnostic: 'no_adopted_blueprint',
    messageId: null,
    blueprint: null,
    summary: 'No adopted Blueprint artifact is available for task planning.',
  };
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
  const updated = await repo.updateTask(id, data);
  if (updated?.status === 'ready') {
    void runSessionQueueForRepository(updated.repositoryId);
  }
  return updated;
}

export async function getBlueprintDesignSettings(taskId: string) {
  const task = await repo.getTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  const row = await repo.getBlueprintDesignSettings(taskId);
  return {
    sessionId: taskId,
    settings: row?.settingsJson ?? null,
    createdAt: row?.createdAt,
    updatedAt: row?.updatedAt,
  };
}

export async function saveBlueprintDesignSettings(taskId: string, settings: any) {
  const task = await repo.getTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  const row = await repo.upsertBlueprintDesignSettings(taskId, settings);
  return {
    sessionId: taskId,
    settings: row.settingsJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type BlueprintAdoptionKind = 'blueprint' | 'dbDesign' | 'designTokens';

function serializeBlueprintAdoption(input: {
  taskId: string;
  messageId: string;
  adopted: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    sessionId: input.taskId,
    messageId: input.messageId,
    adopted: input.adopted,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

async function assertTaskMessageBelongsToTask(taskId: string, messageId: string) {
  const task = await repo.getTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  const message = await repo.getTaskMessage(messageId);
  if (!message || message.taskId !== taskId) {
    throw new NotFoundError('Task message not found');
  }
}

async function getBlueprintAdoption(
  kind: BlueprintAdoptionKind,
  taskId: string,
  messageId: string
) {
  await assertTaskMessageBelongsToTask(taskId, messageId);
  const row =
    kind === 'blueprint'
      ? await repo.getBlueprintArtifactAdoption(taskId, messageId)
      : kind === 'dbDesign'
        ? await repo.getBlueprintDbDesignAdoption(taskId, messageId)
        : await repo.getBlueprintDesignTokenAdoption(taskId, messageId);
  return serializeBlueprintAdoption({
    taskId,
    messageId,
    adopted: row?.adopted ?? false,
    createdAt: row?.createdAt,
    updatedAt: row?.updatedAt,
  });
}

async function saveBlueprintAdoption(
  kind: BlueprintAdoptionKind,
  taskId: string,
  messageId: string,
  adopted: boolean
) {
  await assertTaskMessageBelongsToTask(taskId, messageId);
  const row =
    kind === 'blueprint'
      ? await repo.upsertBlueprintArtifactAdoption(taskId, messageId, adopted)
      : kind === 'dbDesign'
        ? await repo.upsertBlueprintDbDesignAdoption(taskId, messageId, adopted)
        : await repo.upsertBlueprintDesignTokenAdoption(taskId, messageId, adopted);
  return serializeBlueprintAdoption({
    taskId,
    messageId,
    adopted: row.adopted,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export async function getBlueprintArtifactAdoption(taskId: string, messageId: string) {
  return getBlueprintAdoption('blueprint', taskId, messageId);
}

export async function saveBlueprintArtifactAdoption(
  taskId: string,
  messageId: string,
  adopted: boolean
) {
  return saveBlueprintAdoption('blueprint', taskId, messageId, adopted);
}

export async function getBlueprintDbDesignAdoption(taskId: string, messageId: string) {
  return getBlueprintAdoption('dbDesign', taskId, messageId);
}

export async function saveBlueprintDbDesignAdoption(
  taskId: string,
  messageId: string,
  adopted: boolean
) {
  return saveBlueprintAdoption('dbDesign', taskId, messageId, adopted);
}

export async function getBlueprintDesignTokenAdoption(taskId: string, messageId: string) {
  return getBlueprintAdoption('designTokens', taskId, messageId);
}

export async function saveBlueprintDesignTokenAdoption(
  taskId: string,
  messageId: string,
  adopted: boolean
) {
  return saveBlueprintAdoption('designTokens', taskId, messageId, adopted);
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
  | 'intake'
  | 'draft'
  | 'draft_spec'
  | 'create_task'
  | 'queue'
  | 'run_task'
  | 'adjust_running'
  | 'review_followup'
  | 'learning_capture'
  | 'design_component'
  | 'design_blueprint_data';

export async function appendWorkbenchMessage(
  id: string,
  input: { prompt: string; intent?: WorkbenchChatIntent; waitForIntake?: boolean }
) {
  const intent = input.intent || 'intake';
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

  if (intent === 'design_blueprint_data') {
    return handleBlueprintDataDesignMessage(id, task, prompt);
  }

  await appendTaskMessage(id, prompt);

  if (intent === 'queue' || intent === 'create_task') {
    const queued = await queueTask(id);
    return { task: queued, run: null, messages: await repo.listTaskMessages(id) };
  }

  const waitForIntake = input.waitForIntake ?? process.env.NODE_ENV === 'test';
  if (waitForIntake) {
    return handleWorkbenchIntakeMessage(id, task, prompt, { failureMode: 'throw', intent });
  }

  const updated = await prepareWorkbenchIntakeTask(id, task, prompt);
  void handleWorkbenchIntakeMessage(id, task, prompt, { failureMode: 'record', intent });
  return { task: updated, run: null, messages: await repo.listTaskMessages(id) };
}

async function handleBlueprintDataDesignMessage(
  taskId: string,
  task: NonNullable<Awaited<ReturnType<typeof repo.getTask>>>,
  prompt: string
) {
  const emitWorkbenchLlmDebugEvent = createWorkbenchLlmDebugEventEmitter(taskId);
  try {
    const parsedRequest = parseBlueprintDbDesignRequestPrompt(prompt);
    const currentValidation = validateAppBlueprint(parsedRequest.currentBlueprint);
    const request = {
      ...parsedRequest,
      validationIssues: currentValidation.issues,
    };
    await repo.createTaskMessage({
      taskId,
      role: 'user',
      content: renderBlueprintDataDesignRequestContent(request),
      messageType: 'text',
      payloadJson: {
        intent: 'design_blueprint_data',
        source: 'blueprint-preview',
        blueprintId: request.blueprintId,
        dbDesignTarget: request.target,
        prompt: request.prompt,
        validation: currentValidation,
      },
    });
    const { blueprint, validation, generation } = await generateBlueprintDataDesignDraft({
      request,
      emitEvent: emitWorkbenchLlmDebugEvent,
    });
    await repo.createTaskMessage({
      taskId,
      role: 'assistant',
      content: renderBlueprintMarkdown(blueprint),
      messageType: 'markdown_document',
      payloadJson: {
        intent: 'app_blueprint',
        title: blueprint.name || task.title,
        appBlueprint: blueprint,
        validation,
        generation,
        source: 'blueprint-db-design',
        parentBlueprintId: request.blueprintId,
        dbDesignTarget: request.target,
      },
    });
    const updated = await repo.updateTask(taskId, {
      objective: task.objective || request.prompt,
      status: task.status === 'draft' ? 'ready' : task.status,
    });
    return { task: updated, run: null, messages: await repo.listTaskMessages(taskId) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof BlueprintDataDesignGenerationError && error.rawOutput?.trim()) {
      await repo.createTaskMessage({
        taskId,
        role: 'assistant',
        content: error.rawOutput.trim(),
        messageType: 'text',
        payloadJson: {
          intent: 'blueprint_db_design_raw_output',
          source: 'blueprint-db-design',
          validationStatus: 'failed',
          error: message,
          promptDiagnostics: error.promptDiagnostics,
        },
      });
    }
    await repo.createTaskMessage({
      taskId,
      role: 'system',
      content: `Blueprint DB Design generation failed: ${message}`,
      messageType: 'text',
      payloadJson: {
        intent: 'blueprint_db_design_failed',
        source: 'blueprint-db-design',
        error: message,
        rawOutputRecorded:
          error instanceof BlueprintDataDesignGenerationError && Boolean(error.rawOutput?.trim()),
        promptDiagnostics:
          error instanceof BlueprintDataDesignGenerationError ? error.promptDiagnostics : undefined,
      },
    });
    throw new AppError(
      502,
      'BLUEPRINT_DB_DESIGN_FAILED',
      `Blueprint DB Design generation failed: ${message}`
    );
  }
}

function renderBlueprintDataDesignRequestContent(
  request: ReturnType<typeof parseBlueprintDbDesignRequestPrompt>
) {
  return [
    'Blueprint DB Design request',
    `Target: ${blueprintDataDesignTargetLabel(request.target)}`,
    `Instruction: ${request.prompt}`,
  ].join('\n');
}

function blueprintDataDesignTargetLabel(
  target: ReturnType<typeof parseBlueprintDbDesignRequestPrompt>['target']
) {
  if (target.kind === 'schema') return 'Schema';
  if (target.kind === 'table') return `Table ${target.tableName}`;
  if (target.kind === 'relation') return `Relation ${target.relationId}`;
  if (target.kind === 'binding') return `Binding ${target.bindingId}`;
  if (target.sectionId) return `Screen ${target.screenId} / section ${target.sectionId}`;
  return `Screen ${target.screenId}`;
}

async function handleWorkbenchIntakeMessage(
  taskId: string,
  task: NonNullable<Awaited<ReturnType<typeof repo.getTask>>>,
  prompt: string,
  options: { failureMode: 'throw' | 'record'; intent?: WorkbenchChatIntent } = {
    failureMode: 'throw',
  }
) {
  const title =
    task.title === 'New Session' ? prompt.replace(/\s+/g, ' ').slice(0, 60) : task.title;
  const repository = await repo.getRepository(task.repositoryId);
  const projectRoot = repository?.localPath || process.cwd();
  const emitWorkbenchLlmDebugEvent = createWorkbenchLlmDebugEventEmitter(taskId);

  try {
    const jobSelection = (await callSupervisorLLM(buildRound1JobTypePrompt(projectRoot), prompt, {
      round: 1,
      schemaFirst: true,
      tolerateSchemaFailure: false,
      emitEvent: emitWorkbenchLlmDebugEvent,
      workingDirectory: projectRoot,
    })) as JobTypeSelection;
    const routing = routingForWorkbenchJobType(jobSelection.jobType);
    const startsImmediateRun = shouldStartImmediateWorkbenchRun(
      jobSelection,
      options.intent || 'intake'
    );
    if (isBlueprintRouting(routing)) {
      try {
        const { blueprint, validation, generation } = await generatePlanModeBlueprintDraft({
          taskId,
          title,
          prompt,
          routing,
          emitEvent: emitWorkbenchLlmDebugEvent,
        });
        await repo.createTaskMessage({
          taskId,
          role: 'assistant',
          content: renderBlueprintMarkdown(blueprint),
          messageType: 'markdown_document',
          payloadJson: {
            intent: 'app_blueprint',
            title,
            appBlueprint: blueprint,
            validation,
            generation,
            source: 'workbench',
            routingHypothesis: routing,
            intakeJobSelection: jobSelection,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof BlueprintDraftGenerationError && error.rawOutput?.trim()) {
          await repo.createTaskMessage({
            taskId,
            role: 'assistant',
            content: error.rawOutput.trim(),
            messageType: 'text',
            payloadJson: {
              intent: 'blueprint_raw_output',
              source: 'llm',
              validationStatus: 'failed',
              error: message,
              promptDiagnostics: error.promptDiagnostics,
              routingHypothesis: routing,
              intakeJobSelection: jobSelection,
            },
          });
        }
        await repo.createTaskMessage({
          taskId,
          role: 'system',
          content: `Blueprint artifact generation failed: ${message}`,
          messageType: 'text',
          payloadJson: {
            intent: 'blueprint_generation_failed',
            source: 'workbench',
            routingHypothesis: routing,
            intakeJobSelection: jobSelection,
            error: message,
            rawOutputRecorded:
              error instanceof BlueprintDraftGenerationError && Boolean(error.rawOutput?.trim()),
            promptDiagnostics:
              error instanceof BlueprintDraftGenerationError ? error.promptDiagnostics : undefined,
          },
        });
        throw new BlueprintArtifactGenerationError(message);
      }
    } else if (!startsImmediateRun) {
      await repo.createTaskMessage({
        taskId,
        role: 'assistant',
        content:
          renderLlmIntakeContent(jobSelection) ||
          '依頼内容を受け取りました。実行が必要な場合は作業を開始します。',
        messageType: 'text',
        payloadJson: {
          intent: 'intake',
          source: 'llm',
          jobSelection,
        },
      });
    }
    if (startsImmediateRun) {
      const runnable = await repo.updateTask(taskId, {
        title,
        objective: task.objective || prompt,
        acceptanceCriteria:
          task.acceptanceCriteria || buildAcceptanceCriteriaFromDecision(jobSelection) || prompt,
        status: 'ready',
      });
      await repo.createTaskMessage({
        taskId,
        role: 'system',
        content: 'Implementation run started from Workbench intake.',
        messageType: 'text',
        payloadJson: {
          intent: 'run_started',
          source: 'workbench',
          routingHypothesis: routing,
          intakeJobSelection: jobSelection,
        },
      });
      await safelyRefreshConversationContext({ taskId, reason: 'intake_idle' });
      const run = await startTaskRun(taskId);
      return {
        task: (await repo.getTask(taskId)) || runnable,
        run,
        messages: await repo.listTaskMessages(taskId),
      };
    }
    const updated = await repo.updateTask(taskId, {
      title,
      objective: task.objective || prompt,
      acceptanceCriteria: isBlueprintRouting(routing)
        ? task.acceptanceCriteria || buildAcceptanceCriteriaFromDecision(jobSelection)
        : task.acceptanceCriteria,
      status: isBlueprintRouting(routing) && task.status === 'draft' ? 'ready' : task.status,
    });
    void safelyRefreshConversationContext({ taskId, reason: 'intake_idle' });
    return { task: updated, run: null, messages: await repo.listTaskMessages(taskId) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const updated = await repo.updateTask(taskId, {
      title,
      objective: task.objective || prompt,
    });
    if (options.failureMode === 'record' && !(error instanceof BlueprintArtifactGenerationError)) {
      await repo.createTaskMessage({
        taskId,
        role: 'system',
        content: `LLM intake failed: ${message}`,
        messageType: 'text',
        payloadJson: {
          intent: 'intake_failed',
          source: 'workbench',
          error: message,
        },
      });
      void safelyRefreshConversationContext({ taskId, reason: 'intake_idle' });
      return { task: updated, run: null, messages: await repo.listTaskMessages(taskId) };
    }
    if (options.failureMode === 'record') {
      return { task: updated, run: null, messages: await repo.listTaskMessages(taskId) };
    }
    throw new AppError(
      502,
      'LLM_RESPONSE_REQUIRED',
      `LLM response is required but generation failed: ${message}`,
      { task: updated }
    );
  }
}

class BlueprintArtifactGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlueprintArtifactGenerationError';
  }
}

function createWorkbenchLlmDebugEventEmitter(taskId: string) {
  return async (event: SupervisorLlmDebugEvent) => {
    if (event.type !== 'model.response_delta') return;
    const text = typeof event.data?.text === 'string' ? event.data.text : event.message;
    if (!text) return;
    nightWorkersRealtimeBroker.publish(taskId, {
      type: 'task_llm_delta',
      payload: {
        text,
        event,
      },
    });
  };
}

async function prepareWorkbenchIntakeTask(
  taskId: string,
  task: NonNullable<Awaited<ReturnType<typeof repo.getTask>>>,
  prompt: string
) {
  const title =
    task.title === 'New Session' ? prompt.replace(/\s+/g, ' ').slice(0, 60) : task.title;
  const updated = await repo.updateTask(taskId, {
    title,
    objective: task.objective || prompt,
  });
  return updated;
}

function renderLlmIntakeContent(jobSelection: JobTypeSelection): string {
  if (jobSelection.jobType === 'minor_code_edit') return '';
  return [`jobType: ${jobSelection.jobType}`, jobSelection.goal]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join('\n\n');
}

function shouldStartImmediateWorkbenchRun(
  jobSelection: JobTypeSelection,
  intent: WorkbenchChatIntent
) {
  if (intent !== 'intake') return false;
  return jobSelection.jobType === 'minor_code_edit';
}

function buildAcceptanceCriteriaFromDecision(jobSelection: JobTypeSelection): string {
  return jobSelection.goal.trim();
}

function routingForWorkbenchJobType(jobType: JobType): SupervisorRoutingHypothesis {
  if (jobType === 'minor_code_edit') {
    return {
      primaryMode: 'code_edit',
      secondaryModes: [],
      phase: 'execute',
      workKinds: ['code'],
      overlays: [],
      requiredEvidence: [],
      nextSkillFiles: [],
      confidence: 1,
    };
  }
  if (jobType === 'blueprint' || jobType === 'ui_ux') {
    return {
      primaryMode: 'planning',
      secondaryModes: [],
      phase: 'plan',
      workKinds: ['blueprint', 'ui_ux'],
      overlays: ['user_facing_change'],
      subtype: 'app_blueprint',
      requiredEvidence: [],
      nextSkillFiles: ['references/work_kinds/blueprint.md'],
      confidence: 1,
    };
  }
  return {
    primaryMode: jobType === 'general_answer' ? 'general_answer' : 'planning',
    secondaryModes: [],
    phase: jobType === 'general_answer' ? 'answer' : 'plan',
    workKinds: [],
    overlays: [],
    requiredEvidence: [],
    nextSkillFiles: [],
    confidence: 1,
  };
}

function isAppBlueprintMessage(message: TaskMessageRow): boolean {
  const metadata = message.metadataJson;
  return Boolean(
    metadata &&
      typeof metadata === 'object' &&
      !Array.isArray(metadata) &&
      (metadata as { intent?: unknown; appBlueprint?: unknown }).intent === 'app_blueprint' &&
      (metadata as { appBlueprint?: unknown }).appBlueprint
  );
}

function buildBlueprintPlanningReadiness(
  source: 'adopted' | 'latest_generated',
  message: TaskMessageRow
): BlueprintPlanningReadiness {
  const metadata = message.metadataJson as { appBlueprint?: unknown };
  const blueprint = metadata.appBlueprint;
  return {
    source,
    diagnostic: source === 'adopted' ? 'adopted_blueprint' : 'using_latest_generated_blueprint',
    messageId: message.id,
    blueprint,
    summary: summarizePlanningBlueprint(source, blueprint),
  };
}

function summarizePlanningBlueprint(
  source: 'adopted' | 'latest_generated',
  blueprint: unknown
): string {
  const prefix =
    source === 'adopted'
      ? 'Adopted Blueprint artifact is available for task planning.'
      : 'No adopted Blueprint artifact is available; using the latest generated Blueprint.';
  if (!blueprint || typeof blueprint !== 'object' || Array.isArray(blueprint)) return prefix;
  const value = blueprint as {
    id?: unknown;
    name?: unknown;
    screens?: unknown;
    implementationTasks?: unknown;
  };
  const screens = Array.isArray(value.screens) ? value.screens.length : 0;
  const implementationTasks = Array.isArray(value.implementationTasks)
    ? value.implementationTasks.length
    : 0;
  return [
    prefix,
    `Blueprint id: ${String(value.id || 'unknown')}`,
    `Blueprint name: ${String(value.name || 'Untitled Blueprint')}`,
    `Screens: ${screens}`,
    `Implementation tasks: ${implementationTasks}`,
  ].join('\n');
}

function isBlueprintRouting(routing: SupervisorRoutingHypothesis | undefined): boolean {
  if (!routing) return false;
  return (
    routing.subtype === 'app_blueprint' ||
    routing.workKinds.includes('blueprint') ||
    routing.nextSkillFiles.includes('references/work_kinds/blueprint.md')
  );
}

function assertRunnableWorkbenchTask(task: Awaited<ReturnType<typeof repo.getTask>>) {
  if (!task) throw new NotFoundError('Task not found');
  if (!['queued', 'ready'].includes(task.status)) {
    throw new AppError(
      409,
      'TASK_NOT_READY_TO_RUN',
      'Workbench runs require a ready or queued task. Draft the task first, then queue or run it.'
    );
  }
  assertTaskDraftComplete(task);
}

function assertTaskDraftComplete(task: Awaited<ReturnType<typeof repo.getTask>>) {
  if (!task) throw new NotFoundError('Task not found');
  const missing = getTaskDraftMissingFields(task);
  if (missing.length > 0) {
    throw new AppError(422, 'TASK_DRAFT_INCOMPLETE', `Missing draft fields: ${missing.join(', ')}`);
  }
}

function getTaskDraftMissingFields(task: Awaited<ReturnType<typeof repo.getTask>>) {
  if (!task) return ['task'];
  const missing = [
    !task.title?.trim() || task.title === 'New Session' ? 'title' : null,
    !task.objective?.trim() ? 'objective' : null,
    !task.acceptanceCriteria?.trim() ? 'acceptanceCriteria' : null,
  ].filter(Boolean);
  return missing;
}

function hasImplementationPlanEvidence(messages: TaskMessageRow[]) {
  return messages.some((message) => {
    if (message.messageType !== 'markdown_document') return false;
    const metadata = (message.metadataJson || {}) as { intent?: unknown; title?: unknown };
    const intent = String(metadata.intent || '').toLowerCase();
    const title = String(metadata.title || '').toLowerCase();
    return (
      intent === 'implementation_plan' ||
      intent === 'draft_spec' ||
      title.includes('implementation plan') ||
      title.includes('plan')
    );
  });
}

export async function queueTask(id: string) {
  await createImplementationQueueEntry(id);
  const task = await repo.getTask(id);
  if (!task) throw new NotFoundError('Task not found');
  return task;
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

export async function listImplementationQueueDashboard() {
  const [settings, rows, tasks, repositories, activeQueueEntries] = await Promise.all([
    repo.getImplementationQueueSettings(),
    repo.listImplementationQueueEntries(),
    repo.listTasks(),
    repo.listRepositories(),
    repo.listActiveImplementationQueueEntries(),
  ]);
  const entries = rows.map(({ entry, task, repository }) => ({ ...entry, task, repository }));
  const activeQueuedTaskIds = new Set(activeQueueEntries.map((entry) => entry.taskId));
  const repositoryById = new Map(repositories.map((repository) => [repository.id, repository]));
  const notQueued = [];
  for (const task of tasks) {
    if (activeQueuedTaskIds.has(task.id)) continue;
    if (['completed', 'cancelled', 'failed', 'timed_out'].includes(task.status)) continue;
    if (getTaskDraftMissingFields(task).length > 0) continue;
    const messages = await repo.listTaskMessages(task.id);
    const hasPlanEvidence = hasImplementationPlanEvidence(messages);
    if (!hasPlanEvidence && !['ready', 'queued'].includes(task.status)) continue;
    const repository = repositoryById.get(task.repositoryId);
    if (!repository) continue;
    notQueued.push({ task, repository });
  }
  const occupiedEntries = entries.filter((entry) =>
    ['claimed', 'processing', 'needs_human', 'awaiting_commit_decision'].includes(entry.status)
  );
  const processors = Array.from({ length: settings.processorCount }, (_value, index) => {
    const slot = index + 1;
    return {
      slot,
      entry: occupiedEntries.find((entry) => entry.processorSlot === slot) || null,
    };
  });
  return {
    settings: { processorCount: settings.processorCount },
    processors,
    queued: entries.filter((entry) => entry.status === 'queued'),
    completed: entries.filter((entry) =>
      ['execution_completed', 'failed', 'cancelled'].includes(entry.status)
    ),
    notQueued,
  };
}

export async function updateImplementationQueueSettings(data: { processorCount: number }) {
  const settings = await repo.updateImplementationQueueSettings(data);
  void runImplementationQueue();
  return { processorCount: settings.processorCount };
}

export async function getTodoWorkflowSettings() {
  return repo.getTodoWorkflowSettings();
}

export async function updateTodoWorkflowSettings(
  data: Parameters<typeof repo.updateTodoWorkflowSettings>[0]
) {
  return repo.updateTodoWorkflowSettings(data);
}

export async function createImplementationQueueEntry(taskId: string) {
  const task = await repo.getTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  if (['completed', 'cancelled', 'failed', 'timed_out'].includes(task.status)) {
    throw new AppError(
      409,
      'TASK_TERMINAL',
      'Terminal sessions cannot enter the Implementation Queue.'
    );
  }
  assertTaskDraftComplete(task);
  if (await repo.hasActiveImplementationQueueEntry(taskId)) {
    throw new AppError(
      409,
      'QUEUE_ENTRY_EXISTS',
      'This session already has an active Queue Entry.'
    );
  }
  const messages = await repo.listTaskMessages(taskId);
  if (!hasImplementationPlanEvidence(messages) && !['ready', 'queued'].includes(task.status)) {
    throw new AppError(
      422,
      'IMPLEMENTATION_PLAN_REQUIRED',
      'Create or mark an implementation plan before adding this session to the Queue.'
    );
  }
  const queuedTask =
    task.status === 'queued' ? task : await repo.updateTask(taskId, { status: 'queued' });
  if (!queuedTask) throw new NotFoundError('Task not found');
  const entry = await repo.createImplementationQueueEntry({
    taskId,
    repositoryId: queuedTask.repositoryId,
    priority: queuedTask.priority,
  });
  await repo.createTaskMessage({
    taskId,
    role: 'system',
    content: 'Implementation Queue entry created.',
    messageType: 'text',
    payloadJson: { source: 'implementation_queue', status: 'queued', queueEntryId: entry.id },
  });
  void runImplementationQueue();
  return entry;
}

export async function patchImplementationQueueEntry(
  id: string,
  input: { action?: 'cancel' | 'resume'; priority?: number; queuePosition?: number | null }
) {
  const entry = await repo.getImplementationQueueEntry(id);
  if (!entry) throw new NotFoundError('Queue Entry not found');
  if (input.action === 'cancel') {
    return repo.updateImplementationQueueEntry(id, {
      status: 'cancelled',
      statusReason: 'Cancelled by user.',
      processorSlot: null,
    });
  }
  if (input.action === 'resume') {
    if (entry.status !== 'needs_human') {
      throw new AppError(409, 'QUEUE_ENTRY_NOT_RESUMABLE', 'Only needs_human entries can resume.');
    }
    const resumed = await repo.updateImplementationQueueEntry(id, {
      status: 'processing',
      statusReason: null,
    });
    void runImplementationQueue();
    return resumed;
  }
  if (entry.status !== 'queued') {
    throw new AppError(409, 'QUEUE_ENTRY_NOT_REORDERABLE', 'Only queued entries can be reordered.');
  }
  return repo.updateImplementationQueueEntry(id, {
    priority: input.priority ?? entry.priority,
    queuePosition: input.queuePosition ?? entry.queuePosition,
  });
}

export async function archiveImplementationQueueEntry(id: string) {
  const entry = await repo.getImplementationQueueEntry(id);
  if (!entry) throw new NotFoundError('Queue Entry not found');
  if (!['execution_completed', 'failed', 'cancelled'].includes(entry.status)) {
    throw new AppError(
      409,
      'QUEUE_ENTRY_NOT_ARCHIVABLE',
      'Only completed Queue executions can archive.'
    );
  }
  const archived = await repo.updateImplementationQueueEntry(id, {
    status: 'execution_archived',
    processorSlot: null,
    archivedAt: new Date(),
  });
  void runImplementationQueue();
  return archived;
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
  const run = await repo.createTaskRun({
    taskId,
    repositoryId: task.repositoryId,
    status: 'running',
    workerKind: 'native-local',
    timeoutSeconds: task.timeoutSeconds,
    contextSnapshot: { compiledPrompt: compiledPromptText, blueprintPlanning: blueprintReadiness },
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
    data: { contextSource: 'task_prompt', blueprintPlanning: blueprintReadiness },
  });

  const contextSnapshot: RuntimePromptSnapshot = {
    compiledPrompt: compiledPromptText,
    source: 'task_prompt',
    degraded: false,
    blueprintPlanning: blueprintReadiness,
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
  const conversationContext = await maybeLoadConversationStateCard(taskId);
  const runtimeLatestUserMessage = buildPromptWithStateCard({
    latestUserMessage: rawLatestUserMessage,
    stateCardText: conversationContext?.stateCardText,
  });
  const runtimeContextSnapshot: RuntimePromptSnapshot = {
    ...contextSnapshot,
    conversationContext: conversationContext
      ? {
          snapshotId: conversationContext.id,
          version: conversationContext.version,
          tokenEstimate: conversationContext.tokenEstimate,
          stateCardIncluded: true,
        }
      : { stateCardIncluded: false },
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
    },
  });

  // Track logs in memory and create database event entries
  const runtime = resolveAgentRuntime('native-local');
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
        },
        sink
      );

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
      await repo.updateTaskStatus(taskId, outcome.status);
      await completeImplementationQueueEntryForRun(run.id, outcome.status);
      if (shouldContinueSessionQueue(outcome.status)) {
        void runSessionQueueForRepository(task.repositoryId);
      }

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

function getSessionQueueMaxConcurrency() {
  const parsed = Number(process.env.SESSION_QUEUE_MAX_CONCURRENCY || 2);
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(1, Math.floor(parsed));
}

function shouldContinueSessionQueue(status: string) {
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

async function completeImplementationQueueEntryForRun(runId: string, status: string) {
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
      finalJudgment: null,
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
      role: 'system',
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

export async function listTaskRunEvents(runId: string, options?: { afterSeq?: number }) {
  const run = await repo.getTaskRun(runId);
  if (!run) throw new NotFoundError('Run not found');
  return repo.listTaskEventsForRun(runId, { afterSeq: options?.afterSeq });
}

export async function listTaskRunActivityEvents(runId: string, options?: { afterSeq?: number }) {
  const run = await repo.getTaskRun(runId);
  if (!run) throw new NotFoundError('Run not found');
  const events = await repo.listActivityEventsForRun(runId, { afterSeq: options?.afterSeq });
  const artifacts = await listReferencedActivityArtifacts(run.taskId, events);
  return { events, artifacts };
}

async function listReferencedActivityArtifacts(
  taskId: string,
  events: Array<{ artifactId?: string | null }>
) {
  const artifactIds = new Set(events.map((event) => event.artifactId).filter(Boolean));
  if (artifactIds.size === 0) return [];
  const artifacts = await repo.listActivityArtifactsForTask(taskId);
  return artifacts.filter((artifact) => artifactIds.has(artifact.id));
}

export async function listTaskRunEventsForReplay(input: {
  taskId: string;
  runId: string;
  afterSeq?: number;
}) {
  const run = await repo.getTaskRun(input.runId);
  if (!run || run.taskId !== input.taskId) {
    throw new NotFoundError('Run not found for task');
  }
  return repo.listTaskEventsForRun(input.runId, { afterSeq: input.afterSeq });
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
  await completeImplementationQueueEntryForRun(runId, finalTaskStatus);
  if (shouldContinueSessionQueue(finalTaskStatus)) {
    const reviewedTask = run.repositoryId ? null : await repo.getTask(run.taskId);
    const repositoryId = run.repositoryId || reviewedTask?.repositoryId;
    if (repositoryId) void runSessionQueueForRepository(repositoryId);
  }

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
