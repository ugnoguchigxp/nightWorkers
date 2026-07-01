import type { DesignQuestionnaireSession } from '../../../shared/schemas/design-questionnaire.schema';
import { AppError, NotFoundError } from '../../lib/errors';
import { renderBlueprintMarkdown } from '../../services/blueprints/draft';
import {
  BlueprintDraftGenerationError,
  generatePlanModeBlueprintDraft,
} from '../../services/blueprints/llm-draft';
import {
  createPlanModeBlueprintActivityArtifact,
  createPlanModeTaskMessage,
  getPlanModeTask,
  type PlanModeTask,
  updatePlanModeTask,
} from '../nightworkers/nightworkers.plan-mode-core.port';
import { assertPlanModeCapabilityEnabled } from '../nightworkers/nightworkers.plan-mode-settings.service';
import { getPlanModeWorkspace } from '../specification/plan-mode-workspace.service';
import { renderQuestionnaireAnswerMarkdown } from '../specification/specification-document-renderer';
import { assertPlanModeMutable } from '../specification/specification-mutability';
import { resolveOptionalReadyQuestionnaireSession } from '../specification/specification-questionnaire-session';

export async function generateBlueprintArtifact(
  taskId: string,
  input: { questionnaireSessionId?: string | null } = {}
) {
  const task = await getPlanModeTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  assertPlanModeCapabilityEnabled('blueprint');
  assertPlanModeMutable(task);
  const session = await resolveOptionalReadyQuestionnaireSession(
    taskId,
    input.questionnaireSessionId
  );
  const prompt = renderQuestionnaireBlueprintPrompt(task, session);
  try {
    const { blueprint, validation, generation } = await generatePlanModeBlueprintDraft({
      taskId,
      title: task.title || 'App Blueprint',
      prompt,
    });
    const artifact = await createPlanModeBlueprintActivityArtifact({
      taskId,
      title: blueprint.name || task.title || 'App Blueprint',
      appBlueprint: blueprint,
      validation,
      generation,
      source: 'status',
      metadataJson: {
        questionnaireSessionId: session?.id ?? null,
      },
    });
    if (!artifact) throw new Error('Blueprint artifact persistence failed.');
    const renderedBlueprint = renderBlueprintMarkdown(blueprint);
    const message = await createPlanModeTaskMessage({
      taskId,
      role: 'assistant',
      content: renderedBlueprint,
      messageType: 'markdown_document',
      payloadJson: {
        intent: 'app_blueprint',
        title: blueprint.name || task.title || 'App Blueprint',
        artifactType: 'app_blueprint',
        artifactRef: {
          artifactId: artifact.id,
          kind: 'app_blueprint',
          version: 1,
        },
        display: {
          title: blueprint.name || task.title || 'App Blueprint',
          summary: blueprint.description || renderedBlueprint.slice(0, 160),
          cardKind: 'app_blueprint',
        },
        appBlueprint: blueprint,
        validation,
        generation,
        source: 'status',
        questionnaireSessionId: session?.id ?? null,
      },
    });
    await updatePlanModeTask(taskId, {
      objective: task.objective || prompt,
      status: task.status === 'draft' ? 'ready' : task.status,
    });
    return { message, workspace: await getPlanModeWorkspace(taskId) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof BlueprintDraftGenerationError && error.rawOutput?.trim()) {
      await createPlanModeTaskMessage({
        taskId,
        role: 'assistant',
        content: error.rawOutput.trim(),
        messageType: 'text',
        payloadJson: {
          intent: 'blueprint_raw_output',
          source: 'status',
          validationStatus: 'failed',
          error: message,
          questionnaireSessionId: session?.id ?? null,
          promptDiagnostics: error.promptDiagnostics,
        },
      });
    }
    throw new AppError(502, 'SPECIFICATION_BLUEPRINT_FAILED', message);
  }
}

function renderQuestionnaireBlueprintPrompt(
  task: PlanModeTask,
  session: DesignQuestionnaireSession | null
) {
  return [
    session
      ? 'Design Questionnaire の回答から App Blueprint を生成してください。'
      : 'Task context から App Blueprint を生成してください。',
    '',
    '## Task',
    `Title: ${task.title}`,
    task.description ? `Description: ${task.description}` : '',
    task.objective ? `Objective: ${task.objective}` : '',
    '',
    '## Questionnaire Answers',
    session ? renderQuestionnaireAnswerMarkdown(session) : '- Questionnaire は未生成です。',
    '',
    '## Output Focus',
    '- UI/UX と画面構成を優先する。',
    '- DB table/column/relation は作らず、Data Model へ渡す論点として残す。',
    '- ユーザーが回答した仕様判断を画面・セクション・サンプルデータに反映する。',
  ]
    .filter(Boolean)
    .join('\n');
}
