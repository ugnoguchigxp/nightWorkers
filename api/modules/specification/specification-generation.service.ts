import { z } from 'zod';
import { NotFoundError } from '../../lib/errors';
import {
  buildSpecificationDocumentSystemPrompt,
  buildSpecificationDocumentUserPrompt,
  buildSpecificationReviewSystemPrompt,
  buildSpecificationReviewUserPrompt,
} from '../../services/structured-generation/prompts/design-questionnaire';
import { callStructuredJsonLLM } from '../../services/structured-llm';
import {
  createPlanModeTaskMessage,
  getPlanModeTask,
  listPlanModeTaskMessages,
} from '../nightworkers/nightworkers.plan-mode-core.port';
import { assertPlanModeCapabilityEnabled } from '../nightworkers/nightworkers.plan-mode-settings.service';
import { getPlanModeWorkspace } from './plan-mode-workspace.service';
import { buildSpecificationDocumentContext } from './specification-document-renderer';
import { assertPlanModeMutable } from './specification-mutability';
import { resolveOptionalReadyQuestionnaireSession } from './specification-questionnaire-session';

const specificationDocumentDraftSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
});
const DEFAULT_FEATURE_PLAN_TITLE = 'Feature Plan';

export async function generateFeaturePlanArtifact(
  taskId: string,
  input: { questionnaireSessionId?: string | null; reviewAfterGenerate?: boolean } = {}
) {
  const task = await getPlanModeTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  assertPlanModeCapabilityEnabled('feature_plan');
  assertPlanModeMutable(task);
  const session = await resolveOptionalReadyQuestionnaireSession(
    taskId,
    input.questionnaireSessionId
  );
  const workspace = await getPlanModeWorkspace(taskId);
  const messages = await listPlanModeTaskMessages(taskId);
  const context = buildSpecificationDocumentContext({
    task,
    session,
    workspace,
    messages,
  });
  const rawOutput = await generateSpecificationDesignDocumentRawOutput(taskId, context);
  const parsed = specificationDocumentDraftSchema.parse(JSON.parse(rawOutput));
  const content = ensureSpecificationDdlSection(parsed.content, context.dataModelDdl);
  const message = await createPlanModeTaskMessage({
    taskId,
    role: 'assistant',
    content,
    messageType: 'markdown_document',
    payloadJson: {
      intent: 'feature_plan',
      title: parsed.title || DEFAULT_FEATURE_PLAN_TITLE,
      source: 'status',
      questionnaireSessionId: session?.id ?? null,
      generation: {
        source: 'llm',
        context: {
          blueprintSummaryIncluded: Boolean(context.blueprintSummary.trim()),
          dataModelReferenceIncluded: Boolean(context.dataModelDdl.trim()),
        },
      },
      markdownDocumentData: {
        title: parsed.title || DEFAULT_FEATURE_PLAN_TITLE,
        content,
      },
    },
  });
  if (input.reviewAfterGenerate === false) {
    return { message, workspace: await getPlanModeWorkspace(taskId) };
  }
  const reviewedMessage = await reviewAndImproveSpecificationDocument({
    taskId,
    sourceMessageId: message.id,
    title: parsed.title || DEFAULT_FEATURE_PLAN_TITLE,
    content,
    context,
    questionnaireSessionId: session?.id ?? null,
  });
  return { message, reviewedMessage, workspace: await getPlanModeWorkspace(taskId) };
}

async function generateSpecificationDesignDocumentRawOutput(
  taskId: string,
  context: ReturnType<typeof buildSpecificationDocumentContext>
) {
  return callStructuredJsonLLM(
    buildSpecificationDocumentSystemPrompt(),
    buildSpecificationDocumentUserPrompt(context),
    {
      schemaName: 'specification_document',
      schema: z.toJSONSchema(specificationDocumentDraftSchema),
      taskId,
      role: 'plan',
    }
  );
}

async function reviewAndImproveSpecificationDocument(input: {
  taskId: string;
  sourceMessageId: string;
  title: string;
  content: string;
  context: ReturnType<typeof buildSpecificationDocumentContext>;
  questionnaireSessionId: string | null;
}) {
  const rawOutput = await callStructuredJsonLLM(
    buildSpecificationReviewSystemPrompt(),
    buildSpecificationReviewUserPrompt(input),
    {
      schemaName: 'specification_document_review',
      schema: z.toJSONSchema(specificationDocumentDraftSchema),
      taskId: input.taskId,
      role: 'review',
    }
  );
  const parsed = specificationDocumentDraftSchema.parse(JSON.parse(rawOutput));
  const title = parsed.title || input.title;
  const content = ensureSpecificationDdlSection(parsed.content, input.context.dataModelDdl);
  return createPlanModeTaskMessage({
    taskId: input.taskId,
    role: 'assistant',
    content,
    messageType: 'markdown_document',
    payloadJson: {
      intent: 'feature_plan',
      title,
      source: 'status_document_review',
      reviewedSourceMessageId: input.sourceMessageId,
      questionnaireSessionId: input.questionnaireSessionId,
      generation: {
        source: 'llm',
        reviewPrompt:
          'ドキュメントレビューをしてください。改善するべき点が無くなるまで改善してください',
        context: {
          blueprintSummaryIncluded: Boolean(input.context.blueprintSummary.trim()),
          dataModelReferenceIncluded: Boolean(input.context.dataModelDdl.trim()),
        },
      },
      markdownDocumentData: {
        title,
        content,
      },
    },
  });
}

function ensureSpecificationDdlSection(content: string, dataModelDdl: string) {
  const trimmedContent = content.trimEnd();
  if (/^##\s+DDL\b/im.test(trimmedContent)) return trimmedContent;
  const ddl = dataModelDdl.trim();
  const ddlBody = ddl
    ? ['```sql', ddl, '```'].join('\n')
    : 'Data Model DDL reference は未生成です。';
  return [trimmedContent, '', '## DDL', ddlBody].join('\n');
}
