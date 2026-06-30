import { z } from 'zod';
import { toDeepRecord } from '../../../shared/json-record';
import { AppError, NotFoundError } from '../../lib/errors';
import {
  BlueprintDataDesignGenerationError,
  generateBlueprintDataDesignDraft,
  parseBlueprintDbDesignRequestPrompt,
} from '../../services/blueprints/data-design';
import { renderBlueprintMarkdown } from '../../services/blueprints/draft';
import { validateAppBlueprint } from '../../services/blueprints/validation';
import { nightWorkersRealtimeBroker } from '../../services/realtime/nightworkers-ws';
import { shouldWaitForWorkbenchIntakeInTests } from '../../services/runtime-env';
import {
  buildPlanModeSettingsSnapshot,
  readGeneralSettings,
} from '../../services/settings/general-settings';
import { callStructuredJsonLLM, type SupervisorLlmDebugEvent } from '../../services/structured-llm';
import { normalizeStructuredLlmModelTarget } from '../../services/structured-llm/selection';
import { createDesignQuestionnaire } from '../questionnaire/questionnaire.service';
import { assertRunnableWorkbenchTask } from './nightworkers.planning-helpers.service';
import { queueTask } from './nightworkers.queue-management.service';
import * as repo from './nightworkers.repository';
import { startTaskRun } from './nightworkers.run-orchestration.service';
import type { WorkbenchArtifactContext } from './nightworkers.workbench-routing';

export async function createPlanningArtifactMessageIfNeeded(input: {
  taskId: string;
  runId: string;
  finalReport: string;
}) {
  const messages = await repo.listTaskMessages(input.taskId);
  const runStartedMessage = [...messages].reverse().find((message) => {
    const metadata = (message.metadataJson || {}) as Record<string, unknown>;
    return (
      message.role === 'system' &&
      metadata.intent === 'run_started' &&
      metadata.source === 'workbench'
    );
  });
  const runStartedMetadata = (runStartedMessage?.metadataJson || {}) as Record<string, unknown>;
  const intakeJobSelection = toDeepRecord(runStartedMetadata.intakeJobSelection);
  if (String(intakeJobSelection.jobType) !== 'planning') {
    const run = await repo.getTaskRun(input.runId);
    const runContext =
      run?.contextSnapshot &&
      typeof run.contextSnapshot === 'object' &&
      !Array.isArray(run.contextSnapshot)
        ? (run.contextSnapshot as Record<string, unknown>)
        : {};
    if (runContext.executionMode !== 'planning') return;
  }
  const alreadyPublished = messages.some((message) => {
    const metadata = (message.metadataJson || {}) as Record<string, unknown>;
    return (
      message.messageType === 'markdown_document' &&
      metadata.intent === 'implementation_plan' &&
      metadata.sourceRunId === input.runId
    );
  });
  if (alreadyPublished) return;
  await repo.createTaskMessage({
    taskId: input.taskId,
    runId: input.runId,
    role: 'assistant',
    content: input.finalReport,
    messageType: 'markdown_document',
    payloadJson: {
      intent: 'implementation_plan',
      title: 'Implementation Plan',
      source: 'workbench-planning-run',
      sourceRunId: input.runId,
      routingHypothesis: runStartedMetadata.routingHypothesis,
      intakeJobSelection,
      markdownDocumentData: {
        title: 'Implementation Plan',
        content: input.finalReport,
      },
    },
  });
}

export async function appendTaskMessage(
  id: string,
  prompt: string,
  metadata?: Record<string, unknown>
) {
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
    payloadJson: metadata,
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
  input: {
    prompt: string;
    intent?: WorkbenchChatIntent;
    waitForIntake?: boolean;
    artifactContext?: WorkbenchArtifactContext | null;
    providerEndpointId?: string;
    model?: string;
    thinkingDepth?: 'low' | 'medium' | 'high' | 'very_high';
  }
) {
  const intent = input.intent || 'intake';
  const task = await repo.getTask(id);
  if (!task) throw new NotFoundError('Task not found');
  const prompt = input.prompt.trim();
  if (!prompt) throw new AppError(400, 'EMPTY_PROMPT', 'Prompt must not be empty');
  const artifactContext = input.artifactContext || null;
  const llmSelection =
    input.model || input.providerEndpointId || input.thinkingDepth
      ? {
          model: input.model || null,
          providerEndpointId: input.providerEndpointId || null,
          thinkingDepth: input.thinkingDepth || null,
        }
      : null;
  const llmRouteOverride = normalizeStructuredLlmModelTarget(llmSelection);
  const existingMessages = await repo.listTaskMessages(id);
  const messageMetadata =
    artifactContext || llmSelection
      ? {
          ...(artifactContext ? { intent: 'artifact_context_instruction', artifactContext } : {}),
          source: 'workbench',
          ...(llmSelection ? { llmSelection } : {}),
        }
      : undefined;

  if (intent === 'run_task') {
    assertRunnableWorkbenchTask(task, existingMessages);
    await appendTaskMessage(id, prompt, messageMetadata);
    const run = await startTaskRun(id, {
      executionMode: 'implementation',
      executionModeSource: 'workbench_run_task',
    });
    return {
      task: await repo.getTask(id),
      run,
      messages: await repo.listTaskMessages(id),
    };
  }

  if (intent === 'design_blueprint_data') {
    return handleBlueprintDataDesignMessage(id, task, prompt);
  }

  await appendTaskMessage(id, prompt, messageMetadata);

  if (intent === 'queue' || intent === 'create_task') {
    const queued = await queueTask(id);
    return { task: queued, run: null, messages: await repo.listTaskMessages(id) };
  }

  const waitForIntake = input.waitForIntake ?? shouldWaitForWorkbenchIntakeInTests();
  if (waitForIntake) {
    return handleWorkbenchIntakeMessage(id, task, prompt, {
      failureMode: 'throw',
      intent,
      artifactContext,
      llmRouteOverride,
    });
  }

  const updated = await prepareWorkbenchIntakeTask(id, task, prompt);
  void handleWorkbenchIntakeMessage(id, task, prompt, {
    failureMode: 'record',
    intent,
    artifactContext,
    llmRouteOverride,
  });
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
      taskId,
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
  return `Relation ${target.relationId}`;
}

function renderArtifactContextualPrompt(
  prompt: string,
  artifactContext: WorkbenchArtifactContext | null
) {
  if (!artifactContext) return prompt;
  const metadata = artifactContext.metadata || {};
  const sourceParts = [
    artifactContext.source?.type ? `sourceType=${artifactContext.source.type}` : null,
    artifactContext.source?.messageId ? `messageId=${artifactContext.source.messageId}` : null,
    artifactContext.source?.artifactId ? `artifactId=${artifactContext.source.artifactId}` : null,
  ].filter(Boolean);
  return [
    '[Current Artifact Context]',
    'ユーザーは現在この Artifact を見ながら左側のチャット欄で指示しています。',
    '指示が「この画面」「これ」「今の artifact」を参照する場合は、この Artifact への修正指示として扱ってください。',
    'ただし、ユーザー本文で別対象が明示された場合はユーザー本文を優先してください。',
    `Artifact: ${artifactContext.title}`,
    `Kind: ${artifactContext.kind}`,
    sourceParts.length ? `Source: ${sourceParts.join(', ')}` : null,
    metadata.intent ? `Intent: ${metadata.intent}` : null,
    metadata.artifactType ? `Artifact type: ${metadata.artifactType}` : null,
    metadata.appBlueprintName ? `Blueprint: ${metadata.appBlueprintName}` : null,
    metadata.initialTab ? `Workspace tab: ${metadata.initialTab}` : null,
    metadata.screenNames?.length ? `Screens: ${metadata.screenNames.join(', ')}` : null,
    metadata.sectionNames?.length ? `Sections: ${metadata.sectionNames.join(', ')}` : null,
    metadata.tableNames?.length ? `Tables: ${metadata.tableNames.join(', ')}` : null,
    artifactContext.summary ? `Summary: ${artifactContext.summary}` : null,
    '',
    '[User Instruction]',
    prompt,
  ]
    .filter((line): line is string => line !== null && line !== undefined)
    .join('\n');
}

const workbenchPlanModeGateSchema = z
  .object({
    shouldStartPlanMode: z.boolean(),
    action: z
      .enum(['plan_mode', 'general_answer', 'implementation', 'review', 'runtime_debug'])
      .optional(),
    reason: z.string().min(1),
  })
  .strict();

type WorkbenchPlanModeGate = z.infer<typeof workbenchPlanModeGateSchema> & {
  action: 'plan_mode' | 'general_answer' | 'implementation' | 'review' | 'runtime_debug';
};

async function decideWorkbenchPlanModeGate(input: {
  projectRoot: string;
  prompt: string;
  task: NonNullable<Awaited<ReturnType<typeof repo.getTask>>>;
  messages: Awaited<ReturnType<typeof repo.listTaskMessages>>;
  runs: Awaited<ReturnType<typeof repo.listTaskRunsForTask>>;
  routeOverride: ReturnType<typeof normalizeStructuredLlmModelTarget> | null;
  emitEvent: (event: SupervisorLlmDebugEvent) => void | Promise<void>;
  taskId: string;
}): Promise<WorkbenchPlanModeGate> {
  const raw = await callStructuredJsonLLM(
    buildWorkbenchPlanModeGatePrompt(input.projectRoot),
    buildWorkbenchPlanModeGateUserPrompt(input),
    {
      schemaName: 'workbench_plan_mode_gate',
      schema: {
        type: 'object',
        required: ['shouldStartPlanMode', 'action', 'reason'],
        additionalProperties: false,
        properties: {
          shouldStartPlanMode: { type: 'boolean' },
          action: {
            type: 'string',
            enum: ['plan_mode', 'general_answer', 'implementation', 'review', 'runtime_debug'],
          },
          reason: { type: 'string' },
        },
      },
      routeOverride: input.routeOverride,
      tolerateSchemaFailure: false,
      emitEvent: input.emitEvent,
      workingDirectory: input.projectRoot,
      taskId: input.taskId,
      runId: null,
    }
  );
  const parsed = workbenchPlanModeGateSchema.parse(JSON.parse(raw));
  return {
    ...parsed,
    action: parsed.shouldStartPlanMode ? 'plan_mode' : (parsed.action ?? 'implementation'),
  };
}

function buildWorkbenchPlanModeGatePrompt(projectRoot: string) {
  return [
    'Workbench intake で次の処理を1つだけ判定してください。',
    '現在のユーザー文だけでなく、提示された Task context / Recent conversation / Latest non-general run を判断材料にしてください。',
    'jobType、作業種別、難易度、実装規模、レビュー種別、調査種別は分類しないでください。',
    'shouldStartPlanMode は、ユーザーが計画、実装計画、設計方針、仕様策定、質問票化、Blueprint など、実装前の計画作成を明示的に依頼した場合だけ true にしてください。',
    '質問、確認、説明依頼、状態確認は shouldStartPlanMode=false かつ action="general_answer" にしてください。',
    'ただし、直前の可否回答や状態確認に続いてユーザーが作業の続行、再開、実行を求めている場合は状態確認ではありません。Latest non-general run があればその executionMode を優先し、なければ action="implementation" にしてください。',
    '修正、実装、設定変更、依存更新、リファクタは shouldStartPlanMode=false かつ action="implementation" にしてください。',
    'コードレビュー、差分レビュー、品質レビューは shouldStartPlanMode=false かつ action="review" にしてください。',
    'ログ確認、原因調査、実行時状態の確認、テスト実行や検証依頼は shouldStartPlanMode=false かつ action="runtime_debug" にしてください。',
    '完了済みの Plan Mode artifact は証跡として扱い、後続の質問や変更依頼で再編集対象にしないでください。',
    '判断に迷う場合は shouldStartPlanMode=false かつ action="general_answer" にしてください。',
    'JSON のみを返してください。',
    '',
    `プロジェクトルート: ${projectRoot}`,
    '',
    '[Output Schema]',
    '{ "shouldStartPlanMode": boolean, "action": "plan_mode" | "general_answer" | "implementation" | "review" | "runtime_debug", "reason": "short reason" }',
  ].join('\n');
}

function buildWorkbenchPlanModeGateUserPrompt(input: {
  prompt: string;
  task: NonNullable<Awaited<ReturnType<typeof repo.getTask>>>;
  messages: Awaited<ReturnType<typeof repo.listTaskMessages>>;
  runs: Awaited<ReturnType<typeof repo.listTaskRunsForTask>>;
}) {
  const recentMessages = input.messages.slice(-6).map((message) => {
    const metadata = toRecord(message.metadataJson);
    const intent = typeof metadata?.intent === 'string' ? ` intent=${metadata.intent}` : '';
    return `- ${message.role}${intent}: ${compactForGatePrompt(message.content, 360)}`;
  });
  const latestNonGeneralRun = input.runs.find((run) => {
    const executionMode = readRunExecutionMode(run.contextSnapshot);
    return executionMode && executionMode !== 'general_answer';
  });
  const latestRun = input.runs[0];
  const latestRunExecutionMode = latestRun ? readRunExecutionMode(latestRun.contextSnapshot) : null;
  const latestNonGeneralRunExecutionMode = latestNonGeneralRun
    ? readRunExecutionMode(latestNonGeneralRun.contextSnapshot)
    : null;
  const latestRunLines = latestRun
    ? [
        `Latest run: status=${latestRun.status}`,
        latestRunExecutionMode ? `Latest run executionMode=${latestRunExecutionMode}` : null,
        latestRun.summary
          ? `Latest run summary=${compactForGatePrompt(latestRun.summary, 180)}`
          : null,
      ].filter((line): line is string => Boolean(line))
    : ['Latest run: none'];
  const latestNonGeneralRunLines = latestNonGeneralRun
    ? [
        `Latest non-general run: status=${latestNonGeneralRun.status}`,
        `Latest non-general run executionMode=${latestNonGeneralRunExecutionMode}`,
        latestNonGeneralRun.summary
          ? `Latest non-general run summary=${compactForGatePrompt(
              latestNonGeneralRun.summary,
              180
            )}`
          : null,
      ].filter((line): line is string => Boolean(line))
    : ['Latest non-general run: none'];

  return [
    '[Task Context]',
    `Task status: ${input.task.status}`,
    `Task title: ${compactForGatePrompt(input.task.title, 180)}`,
    input.task.objective
      ? `Task objective: ${compactForGatePrompt(input.task.objective, 240)}`
      : null,
    ...latestRunLines,
    ...latestNonGeneralRunLines,
    '',
    '[Recent Conversation]',
    recentMessages.length ? recentMessages.join('\n') : '- none',
    '',
    '[Current User Message]',
    input.prompt,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function readRunExecutionMode(value: unknown) {
  const context = toRecord(value);
  const executionMode = context?.executionMode;
  return typeof executionMode === 'string' && executionMode.trim().length > 0
    ? executionMode.trim()
    : null;
}

function compactForGatePrompt(value: string, maxLength: number) {
  const compacted = value.replace(/\s+/g, ' ').trim();
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, maxLength - 1)}…`;
}

function toRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function handleWorkbenchIntakeMessage(
  taskId: string,
  task: NonNullable<Awaited<ReturnType<typeof repo.getTask>>>,
  prompt: string,
  options: {
    failureMode: 'throw' | 'record';
    intent?: WorkbenchChatIntent;
    artifactContext?: WorkbenchArtifactContext | null;
    llmRouteOverride?: ReturnType<typeof normalizeStructuredLlmModelTarget>;
  } = {
    failureMode: 'throw',
  }
) {
  const title =
    task.title === 'New Session' ? prompt.replace(/\s+/g, ' ').slice(0, 60) : task.title;
  const repository = await repo.getRepository(task.repositoryId);
  const projectRoot = repository?.localPath || process.cwd();
  const emitWorkbenchLlmDebugEvent = createWorkbenchLlmDebugEventEmitter(taskId);
  const llmPrompt = renderArtifactContextualPrompt(prompt, options.artifactContext || null);

  try {
    const planModeGate = await decideWorkbenchPlanModeGate({
      projectRoot,
      prompt: llmPrompt,
      task,
      messages: await repo.listTaskMessages(taskId),
      runs: await repo.listTaskRunsForTask(taskId),
      routeOverride: options.llmRouteOverride || null,
      emitEvent: emitWorkbenchLlmDebugEvent,
      taskId,
    });
    const planModeSettingsSnapshot = buildPlanModeSettingsSnapshot(readGeneralSettings());
    if (planModeGate.shouldStartPlanMode || planModeGate.action === 'plan_mode') {
      if (!planModeSettingsSnapshot.capabilities.questionnaire) {
        const runnable = await repo.updateTask(taskId, {
          title,
          objective: task.objective || prompt,
          acceptanceCriteria: task.acceptanceCriteria || prompt,
          status: 'ready',
        });
        await repo.createTaskMessage({
          taskId,
          role: 'system',
          content: 'Planning run started from Workbench intake because Questionnaire is disabled.',
          messageType: 'text',
          payloadJson: {
            intent: 'run_started',
            source: 'workbench',
            executionMode: 'planning',
            planModeGate,
            planModeSettingsSnapshot,
          },
        });
        const run = await startTaskRun(taskId, {
          executionMode: 'planning',
          executionModeSource: 'workbench_intake',
        });
        return {
          task: (await repo.getTask(taskId)) || runnable,
          run,
          messages: await repo.listTaskMessages(taskId),
        };
      }
      const questionnaireSession = await createDesignQuestionnaire(taskId, null, llmPrompt, {
        routeOverride: options.llmRouteOverride || null,
      });
      const totalQuestionCount = questionnaireSession.questionSets.reduce(
        (total, set) =>
          total +
          (set.questionnaire?.questionSets || []).reduce(
            (setTotal, questionSet) => setTotal + questionSet.questions.length,
            0
          ),
        0
      );
      await repo.createTaskMessage({
        taskId,
        role: 'system',
        content: `Design Questionnaire を生成しました。${totalQuestionCount} 件の質問に回答できます。`,
        messageType: 'text',
        payloadJson: {
          intent: 'design_questionnaire_ready',
          source: 'workbench',
          questionnaireSessionId: questionnaireSession.id,
          questionnaireStatus: questionnaireSession.status,
          totalQuestionCount,
          planModeGate,
          planModeSettingsSnapshot,
        },
      });
    } else if ((options.intent || 'intake') === 'intake') {
      const executionMode = planModeGate.action;
      const runnable = await repo.updateTask(taskId, {
        title,
        objective: task.objective || prompt,
        acceptanceCriteria: task.acceptanceCriteria || prompt,
        status: 'ready',
      });
      await repo.createTaskMessage({
        taskId,
        role: 'system',
        content: workbenchRunStartedMessage(executionMode),
        messageType: 'text',
        payloadJson: {
          intent: 'run_started',
          source: 'workbench',
          executionMode,
          planModeGate,
          planModeSettingsSnapshot,
        },
      });
      const run = await startTaskRun(taskId, {
        executionMode,
        executionModeSource: 'workbench_intake',
      });
      return {
        task: (await repo.getTask(taskId)) || runnable,
        run,
        messages: await repo.listTaskMessages(taskId),
      };
    }
    const updated = await repo.updateTask(taskId, {
      title,
      objective: task.objective || prompt,
      acceptanceCriteria: task.acceptanceCriteria,
      status: task.status,
    });
    return { task: updated, run: null, messages: await repo.listTaskMessages(taskId) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const updated = await repo.updateTask(taskId, {
      title,
      objective: task.objective || prompt,
    });
    if (options.failureMode === 'record') {
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
      return { task: updated, run: null, messages: await repo.listTaskMessages(taskId) };
    }
    if (error instanceof AppError) throw error;
    throw new AppError(
      502,
      'LLM_RESPONSE_REQUIRED',
      `LLM response is required but generation failed: ${message}`,
      { task: updated }
    );
  }
}

function workbenchRunStartedMessage(
  executionMode: 'general_answer' | 'implementation' | 'review' | 'runtime_debug'
) {
  if (executionMode === 'general_answer')
    return 'General answer run started from Workbench intake.';
  if (executionMode === 'review') return 'Review run started from Workbench intake.';
  if (executionMode === 'runtime_debug') {
    return 'Runtime debug run started from Workbench intake.';
  }
  return 'Implementation run started from Workbench intake.';
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
