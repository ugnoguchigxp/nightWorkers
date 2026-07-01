import { z } from 'zod';
import {
  type DataModelArtifact,
  dataModelArtifactSchema,
} from '../../../shared/schemas/plan-mode-artifact.schema';
import { AppError, NotFoundError } from '../../lib/errors';
import {
  buildDataModelSystemPrompt,
  buildDataModelUserPrompt,
  DATA_MODEL_PROMPT_VERSION,
  renderDataModelArtifactMarkdown,
} from '../../services/structured-generation/prompts/data-model';
import { callStructuredJsonLLM } from '../../services/structured-llm';
import { parseRepairedJsonWithSchema } from '../../services/structured-llm/json';
import {
  createPlanModeTaskMessage,
  getPlanModeTask,
  listPlanModeTaskMessages,
  type PlanModeTaskMessage,
} from '../nightworkers/nightworkers.plan-mode-core.port';
import { assertPlanModeCapabilityEnabled } from '../nightworkers/nightworkers.plan-mode-settings.service';
import {
  getDesignQuestionnaireSession,
  listDesignQuestionnaires,
} from '../questionnaire/questionnaire.service';
import { getPlanModeWorkspace } from '../specification/plan-mode-workspace.service';
import { renderQuestionnaireAnswerMarkdown } from '../specification/specification-document-renderer';
import { assertPlanModeMutable } from '../specification/specification-mutability';

export type DataModelGenerationInput = {
  prompt?: string;
  questionnaireSessionId?: string | null;
  featurePlanMessageId?: string | null;
  sourceBlueprintMessageId?: string | null;
  reviewAfterGenerate?: boolean;
};

export class DataModelGenerationError extends Error {
  rawOutput?: string;

  constructor(message: string, rawOutput?: string) {
    super(message);
    this.name = 'DataModelGenerationError';
    this.rawOutput = rawOutput;
  }
}

export async function generateDataModelArtifact(
  taskId: string,
  input: DataModelGenerationInput = {}
) {
  const task = await getPlanModeTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  assertPlanModeCapabilityEnabled('data_model');
  assertPlanModeMutable(task);

  const [messages, session] = await Promise.all([
    listPlanModeTaskMessages(taskId),
    resolveQuestionnaireSession(taskId, input.questionnaireSessionId),
  ]);
  const featurePlanMessage = resolveSourceMessage(
    messages,
    input.featurePlanMessageId,
    'feature_plan'
  );
  const sourceBlueprintMessage = resolveSourceMessage(
    messages,
    input.sourceBlueprintMessageId,
    'blueprint'
  );
  const prompt =
    input.prompt?.trim() ||
    task.objective ||
    task.description ||
    task.title ||
    'No additional prompt.';
  const artifact = await generateArtifactFromLlm({
    taskId,
    task: renderTaskContext(task),
    featurePlan: featurePlanMessage?.content || 'Feature Plan は未生成です。',
    questionnaire: session
      ? renderQuestionnaireAnswerMarkdown(session)
      : 'Questionnaire は未生成です。',
    blueprint: sourceBlueprintMessage?.content || 'Blueprint は未生成です。',
    prompt,
  });
  const message = await createPlanModeTaskMessage({
    taskId,
    role: 'assistant',
    content: renderDataModelArtifactMarkdown(artifact),
    messageType: 'markdown_document',
    payloadJson: {
      artifactKind: 'plan_mode_dedicated_view',
      view: 'data_model',
      source: 'data-model',
      title: artifact.title,
      intent: 'plan_mode_dedicated_view',
      artifactType: 'data_model',
      dataModelArtifact: artifact,
      featurePlanMessageId: featurePlanMessage?.id ?? null,
      questionnaireSessionId: session?.id ?? null,
      sourceBlueprintMessageId: sourceBlueprintMessage?.id ?? null,
      sourceMessageIds: [featurePlanMessage?.id, sourceBlueprintMessage?.id].filter(
        (id): id is string => Boolean(id)
      ),
      generation: {
        promptVersion: DATA_MODEL_PROMPT_VERSION,
      },
    },
  });
  return { message, workspace: await getPlanModeWorkspace(taskId) };
}

export function parseDataModelOutput(rawOutput: string): DataModelArtifact {
  const parsed = parseRepairedJsonWithSchema(rawOutput, dataModelArtifactSchema);
  if (!parsed.ok)
    throw new DataModelGenerationError(
      'Data Model LLM output did not contain valid JSON.',
      rawOutput
    );
  if (parsed.value.canonicalSource === 'ddl' && !parsed.value.ddl?.trim()) {
    throw new DataModelGenerationError('DDL-backed Data Model output must include ddl.', rawOutput);
  }
  return parsed.value;
}

export function buildDataModelResponseJsonSchema() {
  return normalizeStructuredOutputJsonSchema(z.toJSONSchema(dataModelArtifactSchema));
}

function normalizeStructuredOutputJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeStructuredOutputJsonSchema(item));
  if (!value || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    if (key === '$schema' || key === 'default') continue;
    normalized[key] = normalizeStructuredOutputJsonSchema(child);
  }

  if (normalized.type === 'object' && isRecord(normalized.properties)) {
    normalized.required = Object.keys(normalized.properties);
    normalized.additionalProperties = false;
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function resolveQuestionnaireSession(taskId: string, sessionId?: string | null) {
  if (sessionId) return getDesignQuestionnaireSession(taskId, sessionId);
  const sessions = await listDesignQuestionnaires(taskId);
  return (
    sessions.find((session) => session.status === 'accepted') ||
    sessions.find((session) => session.status === 'review_ready') ||
    null
  );
}

function resolveSourceMessage(
  messages: PlanModeTaskMessage[],
  messageId: string | null | undefined,
  kind: 'feature_plan' | 'blueprint'
) {
  if (messageId) {
    return (
      messages.find((message) => message.id === messageId && isMessageKind(message, kind)) || null
    );
  }
  return [...messages].reverse().find((message) => isMessageKind(message, kind)) || null;
}

async function generateArtifactFromLlm(input: {
  taskId: string;
  task: string;
  featurePlan: string;
  questionnaire: string;
  blueprint: string;
  prompt: string;
}) {
  try {
    const schema = buildDataModelResponseJsonSchema();
    const rawOutput = await callStructuredJsonLLM(
      buildDataModelSystemPrompt(JSON.stringify(schema, null, 2)),
      buildDataModelUserPrompt(input),
      {
        schemaName: 'plan_mode_data_model',
        schema,
        taskId: input.taskId,
        runId: null,
        role: 'plan',
      }
    );
    return parseDataModelOutput(rawOutput);
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Data Model generation failed.';
    throw new AppError(502, 'DATA_MODEL_GENERATION_FAILED', message);
  }
}

function isMessageKind(message: PlanModeTaskMessage, kind: 'feature_plan' | 'blueprint') {
  if (message.messageType !== 'markdown_document') return false;
  const metadata = (message.metadataJson || {}) as Record<string, unknown>;
  if (kind === 'feature_plan') return metadata.intent === 'feature_plan';
  return (
    (metadata.intent === 'app_blueprint' && Boolean(metadata.appBlueprint)) ||
    (metadata.intent === 'mock_blueprint' && Boolean(metadata.mockBlueprint))
  );
}

function renderTaskContext(task: {
  title?: string | null;
  description?: string | null;
  objective?: string | null;
}) {
  return [
    `Title: ${task.title || 'Untitled'}`,
    task.description ? `Description: ${task.description}` : '',
    task.objective ? `Objective: ${task.objective}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
