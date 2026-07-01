import type { DesignQuestionnaireSession } from '../../../shared/schemas/design-questionnaire.schema';
import { AppError, NotFoundError } from '../../lib/errors';
import { renderMockBlueprintMarkdown } from '../../services/blueprints/mock-draft';
import {
  generatePlanModeMockBlueprintDraft,
  MockBlueprintDraftGenerationError,
} from '../../services/blueprints/mock-llm-draft';
import {
  createPlanModeMockBlueprintActivityArtifact,
  createPlanModeTaskMessage,
  getPlanModeTask,
  listPlanModeTaskMessages,
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
  const prompt = renderQuestionnaireBlueprintPrompt(session);
  const featurePlanSummary = await resolveLatestFeaturePlanSummary(taskId);
  try {
    const { mockBlueprint, generation } = await generatePlanModeMockBlueprintDraft({
      taskId,
      title: task.title || 'Mock Blueprint',
      prompt,
      description: task.description,
      objective: task.objective,
      questionnaireMarkdown: session ? renderQuestionnaireAnswerMarkdown(session) : null,
      featurePlanSummary,
    });
    const artifact = await createPlanModeMockBlueprintActivityArtifact({
      taskId,
      title: mockBlueprint.name || task.title || 'Mock Blueprint',
      mockBlueprint,
      generation,
      source: 'status',
      metadataJson: {
        questionnaireSessionId: session?.id ?? null,
      },
    });
    if (!artifact) throw new Error('Blueprint artifact persistence failed.');
    const renderedBlueprint = renderMockBlueprintMarkdown(mockBlueprint);
    const message = await createPlanModeTaskMessage({
      taskId,
      role: 'assistant',
      content: renderedBlueprint,
      messageType: 'markdown_document',
      payloadJson: {
        intent: 'mock_blueprint',
        title: mockBlueprint.name || task.title || 'Mock Blueprint',
        artifactType: 'mock_blueprint',
        artifactRef: {
          artifactId: artifact.id,
          kind: 'app_blueprint',
          version: 1,
        },
        display: {
          title: mockBlueprint.name || task.title || 'Mock Blueprint',
          summary: mockBlueprint.summary || renderedBlueprint.slice(0, 160),
          cardKind: 'app_blueprint',
        },
        mockBlueprint,
        generation,
        source: 'status',
        questionnaireSessionId: session?.id ?? null,
      },
    });
    await updatePlanModeTask(taskId, {
      objective: task.objective || task.description || task.title || prompt,
      status: task.status === 'draft' ? 'ready' : task.status,
    });
    return { message, workspace: await getPlanModeWorkspace(taskId) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof MockBlueprintDraftGenerationError && error.rawOutput?.trim()) {
      await createPlanModeTaskMessage({
        taskId,
        role: 'assistant',
        content: error.rawOutput.trim(),
        messageType: 'text',
        payloadJson: {
          intent: 'mock_blueprint_raw_output',
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

function renderQuestionnaireBlueprintPrompt(session: DesignQuestionnaireSession | null) {
  return [
    session
      ? 'Design Questionnaire の回答から Mock Blueprint を生成してください。'
      : 'Task context から Mock Blueprint を生成してください。',
    '## Output Focus',
    '- UI/UX と画面構成を優先する。',
    '- DB table/column/relation や詳細実装情報は作らず、表示用の Section 選択と Mock dataset に集中する。',
    '- ユーザーが回答した仕様判断を画面・セクション・サンプルデータに反映する。',
  ]
    .filter(Boolean)
    .join('\n');
}

async function resolveLatestFeaturePlanSummary(taskId: string) {
  const messages = await listPlanModeTaskMessages(taskId);
  const latest = [...messages].reverse().find((message) => {
    const metadata = (message.metadataJson || {}) as Record<string, unknown>;
    return message.messageType === 'markdown_document' && metadata.intent === 'feature_plan';
  });
  return latest?.content.slice(0, 4_000) || null;
}
