import { z } from 'zod';
import type { DedicatedDesignView } from '../../../shared/schemas/plan-mode-artifact.schema';
import { AppError, NotFoundError } from '../../lib/errors';
import {
  buildPlanDedicatedViewSystemPrompt,
  buildPlanDedicatedViewUserPrompt,
  type GenericDedicatedViewArtifact,
  genericDedicatedViewSchema,
  PLAN_DEDICATED_VIEW_PROMPT_VERSION,
} from '../../services/structured-generation/prompts/plan-dedicated-view';
import { callStructuredJsonLLM } from '../../services/structured-llm';
import { parseRepairedJsonWithSchema } from '../../services/structured-llm/json';
import {
  createPlanModeTaskMessage,
  getPlanModeTask,
  listPlanModeTaskMessages,
  type PlanModeTaskMessage,
} from '../nightworkers/nightworkers.plan-mode-core.port';
import { assertPlanModeCapabilityEnabled } from '../nightworkers/nightworkers.plan-mode-settings.service';
import { getPlanModeWorkspace } from '../specification/plan-mode-workspace.service';
import { assertPlanModeMutable } from '../specification/specification-mutability';

export const genericPlanViewSchema = z.enum([
  'user_flow',
  'api_io_contract',
  'state_model',
  'activity_flow',
  'sequence_flow',
  'zod_schema_design',
]);

export type GenericPlanView = z.infer<typeof genericPlanViewSchema>;

export type PlanViewGenerationInput = {
  prompt?: string;
  questionnaireSessionId?: string | null;
  featurePlanMessageId?: string | null;
  sourceBlueprintMessageId?: string | null;
  sourceDataModelMessageId?: string | null;
  reviewAfterGenerate?: boolean;
};

export async function generatePlanViewArtifact(
  taskId: string,
  view: DedicatedDesignView,
  input: PlanViewGenerationInput = {}
) {
  const parsedView = genericPlanViewSchema.safeParse(view);
  if (!parsedView.success) {
    throw new AppError(422, 'UNSUPPORTED_PLAN_VIEW', `Unsupported generic dedicated view: ${view}`);
  }
  const task = await getPlanModeTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  assertPlanModeCapabilityEnabled(parsedView.data);
  assertPlanModeMutable(task);

  const messages = await listPlanModeTaskMessages(taskId);
  const featurePlanMessage = resolveMessage(messages, input.featurePlanMessageId, 'feature_plan');
  const blueprintMessage = resolveMessage(messages, input.sourceBlueprintMessageId, 'blueprint');
  const dataModelMessage = resolveMessage(messages, input.sourceDataModelMessageId, 'data_model');
  const prompt =
    input.prompt?.trim() ||
    task.objective ||
    task.description ||
    task.title ||
    'No additional prompt.';
  const artifact = await generateArtifactFromLlm({
    view: parsedView.data,
    taskId,
    task: renderTaskContext(task),
    featurePlan: featurePlanMessage?.content || 'Feature Plan は未生成です。',
    questionnaire: input.questionnaireSessionId
      ? `Questionnaire session: ${input.questionnaireSessionId}`
      : 'Questionnaire は指定されていません。',
    blueprint: blueprintMessage?.content || 'Blueprint は未生成です。',
    dataModel: dataModelMessage?.content || 'Data Model は未生成です。',
    prompt,
  });
  const sourceMessageIds = [
    featurePlanMessage?.id,
    blueprintMessage?.id,
    dataModelMessage?.id,
  ].filter((id): id is string => Boolean(id));
  const message = await createPlanModeTaskMessage({
    taskId,
    role: 'assistant',
    content: artifact.markdown,
    messageType: 'markdown_document',
    payloadJson: {
      artifactKind: 'plan_mode_dedicated_view',
      view: artifact.view,
      source: 'dedicated-view-generator',
      title: artifact.title,
      intent: 'plan_mode_dedicated_view',
      artifactType: artifact.view,
      ...(artifact.diagramKind ? { diagramKind: artifact.diagramKind } : {}),
      featurePlanMessageId: featurePlanMessage?.id ?? null,
      questionnaireSessionId: input.questionnaireSessionId ?? null,
      sourceBlueprintMessageId: blueprintMessage?.id ?? null,
      sourceDataModelMessageId: dataModelMessage?.id ?? null,
      sourceMessageIds,
      generation: {
        promptVersion: PLAN_DEDICATED_VIEW_PROMPT_VERSION,
      },
    },
  });
  return { message, workspace: await getPlanModeWorkspace(taskId) };
}

export function parseGenericDedicatedViewOutput(
  rawOutput: string,
  expectedView: GenericPlanView
): GenericDedicatedViewArtifact {
  const parsed = parseRepairedJsonWithSchema(
    rawOutput,
    z.object({
      artifactKind: z.literal('plan_mode_dedicated_view'),
      view: genericPlanViewSchema,
      title: z.string().min(1),
      markdown: z.string().min(1),
      diagramKind: z.enum(['stateDiagram-v2', 'flowchart', 'sequenceDiagram']).optional(),
    })
  );
  if (!parsed.ok) throw new Error('Dedicated view LLM output did not contain valid JSON.');
  if (parsed.value.view !== expectedView) {
    throw new Error(`Dedicated view output used ${parsed.value.view}, expected ${expectedView}.`);
  }
  validateDedicatedViewMarkdown(parsed.value);
  return parsed.value;
}

function validateDedicatedViewMarkdown(artifact: GenericDedicatedViewArtifact) {
  const lower = artifact.markdown.toLowerCase();
  const forbiddenDiagram = 'use' + 'case';
  if (lower.includes(`${forbiddenDiagram}diagram`) || lower.includes(forbiddenDiagram)) {
    throw new Error('Unsupported diagram output is not allowed in Plan Mode dedicated views.');
  }
  const expectedDiagramKind = diagramKindForView(artifact.view);
  if (!expectedDiagramKind) return;
  if (artifact.diagramKind && artifact.diagramKind !== expectedDiagramKind) {
    throw new Error(`${artifact.view} must use ${expectedDiagramKind}.`);
  }
  if (artifact.markdown.includes('```mermaid')) {
    if (!artifact.diagramKind) {
      throw new Error(`${artifact.view} Mermaid output must include diagramKind.`);
    }
    const requiredMarker = expectedDiagramKind === 'flowchart' ? 'flowchart ' : expectedDiagramKind;
    if (!artifact.markdown.includes(requiredMarker)) {
      throw new Error(`${artifact.view} Mermaid output must include ${requiredMarker}.`);
    }
  }
}

function diagramKindForView(view: GenericPlanView) {
  if (view === 'state_model') return 'stateDiagram-v2' as const;
  if (view === 'activity_flow') return 'flowchart' as const;
  if (view === 'sequence_flow') return 'sequenceDiagram' as const;
  return null;
}

function resolveMessage(
  messages: PlanModeTaskMessage[],
  messageId: string | null | undefined,
  kind: 'feature_plan' | 'blueprint' | 'data_model'
) {
  if (messageId)
    return (
      messages.find((message) => message.id === messageId && isMessageKind(message, kind)) || null
    );
  return [...messages].reverse().find((message) => isMessageKind(message, kind)) || null;
}

async function generateArtifactFromLlm(input: {
  view: GenericPlanView;
  taskId: string;
  task: string;
  featurePlan: string;
  questionnaire: string;
  blueprint: string;
  dataModel: string;
  prompt: string;
}) {
  try {
    const rawOutput = await callStructuredJsonLLM(
      buildPlanDedicatedViewSystemPrompt(input.view),
      buildPlanDedicatedViewUserPrompt(input),
      {
        schemaName: 'plan_mode_dedicated_view',
        schema: genericDedicatedViewSchema,
        taskId: input.taskId,
        runId: null,
        role: 'plan',
      }
    );
    return parseGenericDedicatedViewOutput(rawOutput, input.view);
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Dedicated view generation failed.';
    throw new AppError(502, 'PLAN_VIEW_GENERATION_FAILED', message);
  }
}

function isMessageKind(
  message: PlanModeTaskMessage,
  kind: 'feature_plan' | 'blueprint' | 'data_model'
) {
  if (message.messageType !== 'markdown_document') return false;
  const metadata = (message.metadataJson || {}) as Record<string, unknown>;
  if (kind === 'feature_plan') return metadata.intent === 'feature_plan';
  if (kind === 'blueprint')
    return metadata.intent === 'app_blueprint' && Boolean(metadata.appBlueprint);
  return metadata.artifactKind === 'plan_mode_dedicated_view' && metadata.view === 'data_model';
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
