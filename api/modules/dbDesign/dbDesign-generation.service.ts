import {
  type AppBlueprint,
  appBlueprintSchema,
} from '../../../shared/schemas/app-blueprint.schema';
import type { DesignQuestionnaireSession } from '../../../shared/schemas/design-questionnaire.schema';
import { AppError, NotFoundError } from '../../lib/errors';
import { generateBlueprintDataDesignDraft } from '../../services/blueprints/data-design';
import { renderBlueprintMarkdown } from '../../services/blueprints/draft';
import { validateAppBlueprint } from '../../services/blueprints/validation';
import {
  createPlanModeTaskMessage,
  getPlanModeTask,
  listPlanModeTaskMessages,
  type PlanModeTaskMessage,
} from '../nightworkers/nightworkers.plan-mode-core.port';
import { assertPlanModeCapabilityEnabled } from '../nightworkers/nightworkers.plan-mode-settings.service';
import { renderQuestionnaireAnswerMarkdown } from '../specification/specification-document-renderer';
import { assertPlanModeMutable } from '../specification/specification-mutability';
import { resolveReadyQuestionnaireSession } from '../specification/specification-questionnaire-session';
import { getSpecificationWorkspace } from '../specification/specification-workspace.service';

export async function generateDbDesignArtifact(
  taskId: string,
  input: { questionnaireSessionId?: string | null; sourceBlueprintMessageId?: string | null } = {}
) {
  const task = await getPlanModeTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  assertPlanModeCapabilityEnabled('dbDesign');
  assertPlanModeMutable(task);
  const session = await resolveReadyQuestionnaireSession(taskId, input.questionnaireSessionId);
  const sourceBlueprintMessage = await resolveSourceBlueprintMessage(
    taskId,
    input.sourceBlueprintMessageId
  );
  if (!sourceBlueprintMessage) {
    throw new AppError(422, 'BLUEPRINT_REQUIRED', 'Blueprint generation is required first.');
  }
  const metadata = (sourceBlueprintMessage.metadataJson || {}) as Record<string, unknown>;
  const currentBlueprint = appBlueprintSchema.parse(metadata.appBlueprint);
  const validation = validateAppBlueprint(currentBlueprint);
  const request = {
    blueprintId: String(currentBlueprint.id || sourceBlueprintMessage.id),
    target: { kind: 'schema' as const },
    prompt: renderQuestionnaireDbDesignPrompt(session, currentBlueprint),
    currentBlueprint,
    validationIssues: validation.issues,
  };
  const {
    blueprint,
    validation: nextValidation,
    generation,
  } = await generateBlueprintDataDesignDraft({
    taskId,
    request,
  });
  const message = await createPlanModeTaskMessage({
    taskId,
    role: 'assistant',
    content: renderBlueprintMarkdown(blueprint),
    messageType: 'markdown_document',
    payloadJson: {
      intent: 'app_blueprint',
      title: blueprint.name || `${task.title} DB Design`,
      artifactType: 'blueprint_db_design',
      appBlueprint: blueprint,
      validation: nextValidation,
      generation,
      source: 'blueprint-db-design',
      parentBlueprintId: request.blueprintId,
      sourceBlueprintMessageId: sourceBlueprintMessage.id,
      questionnaireSessionId: session.id,
      dbDesignTarget: request.target,
    },
  });
  return { message, workspace: await getSpecificationWorkspace(taskId) };
}

async function resolveSourceBlueprintMessage(taskId: string, messageId?: string | null) {
  const messages = await listPlanModeTaskMessages(taskId);
  if (messageId) {
    const message = messages.find((item) => item.id === messageId);
    return message && isAppBlueprintMessage(message) ? message : null;
  }
  return (
    [...messages].reverse().find((message) => {
      const metadata = (message.metadataJson || {}) as Record<string, unknown>;
      return (
        isAppBlueprintMessage(message) &&
        metadata.source !== 'blueprint-db-design' &&
        !metadata.dbDesignTarget
      );
    }) ||
    [...messages].reverse().find((message) => {
      const metadata = (message.metadataJson || {}) as Record<string, unknown>;
      return isAppBlueprintMessage(message) && metadata.source !== 'blueprint-db-design';
    }) ||
    null
  );
}

function renderQuestionnaireDbDesignPrompt(
  session: DesignQuestionnaireSession,
  currentBlueprint: AppBlueprint
) {
  return [
    'Design Questionnaire の回答と現在の App Blueprint をもとに DB Design を提案してください。',
    '',
    '## Questionnaire Answers',
    renderQuestionnaireAnswerMarkdown(session),
    '',
    '## Current Blueprint',
    `Blueprint: ${currentBlueprint?.name || currentBlueprint?.id || 'current blueprint'}`,
    '',
    '## Output Focus',
    '- databaseSchema の table / column / relation を具体化する。',
    '- SQL、DDL、migration、Drizzle schema は作らない。',
    '- dataBindings や screen.sections[].dataBindingId は扱わない。',
  ].join('\n');
}

function isAppBlueprintMessage(message: PlanModeTaskMessage) {
  if (message.messageType !== 'markdown_document') return false;
  const metadata = (message.metadataJson || {}) as Record<string, unknown>;
  return metadata.intent === 'app_blueprint' && Boolean(metadata.appBlueprint);
}
