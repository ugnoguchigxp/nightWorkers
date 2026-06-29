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
import { buildSpecificationDocumentContext } from './specification-document-renderer';
import { assertPlanModeMutable } from './specification-mutability';
import { resolveReadyQuestionnaireSession } from './specification-questionnaire-session';
import { getSpecificationWorkspace } from './specification-workspace.service';

const specificationDocumentDraftSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
});

export async function generateSpecificationArtifact(
  taskId: string,
  input: { questionnaireSessionId?: string | null; reviewAfterGenerate?: boolean } = {}
) {
  const task = await getPlanModeTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  assertPlanModeCapabilityEnabled('specification');
  assertPlanModeMutable(task);
  const session = await resolveReadyQuestionnaireSession(taskId, input.questionnaireSessionId);
  const workspace = await getSpecificationWorkspace(taskId);
  const messages = await listPlanModeTaskMessages(taskId);
  const context = buildSpecificationDocumentContext({
    task,
    session,
    workspace,
    messages,
  });
  const rawOutput = await generateSpecificationDesignDocumentRawOutput(taskId, context);
  const parsed = specificationDocumentDraftSchema.parse(JSON.parse(rawOutput));
  const content = ensureSpecificationDdlSection(parsed.content, context.dbDesignDdl);
  const message = await createPlanModeTaskMessage({
    taskId,
    role: 'assistant',
    content,
    messageType: 'markdown_document',
    payloadJson: {
      intent: 'draft_spec',
      title: parsed.title || 'Specification',
      source: 'status',
      questionnaireSessionId: session.id,
      generation: {
        source: 'llm',
        context: {
          blueprintSummaryIncluded: Boolean(context.blueprintSummary.trim()),
          dbDdlReferenceIncluded: Boolean(context.dbDesignDdl.trim()),
        },
      },
      markdownDocumentData: {
        title: parsed.title || 'Specification',
        content,
      },
    },
  });
  if (input.reviewAfterGenerate === false) {
    return { message, workspace: await getSpecificationWorkspace(taskId) };
  }
  const reviewedMessage = await reviewAndImproveSpecificationDocument({
    taskId,
    sourceMessageId: message.id,
    title: parsed.title || 'Specification',
    content,
    context,
    questionnaireSessionId: session.id,
  });
  return { message, reviewedMessage, workspace: await getSpecificationWorkspace(taskId) };
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
  questionnaireSessionId: string;
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
  const content = ensureSpecificationDdlSection(parsed.content, input.context.dbDesignDdl);
  return createPlanModeTaskMessage({
    taskId: input.taskId,
    role: 'assistant',
    content,
    messageType: 'markdown_document',
    payloadJson: {
      intent: 'draft_spec',
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
          dbDdlReferenceIncluded: Boolean(input.context.dbDesignDdl.trim()),
        },
      },
      markdownDocumentData: {
        title,
        content,
      },
    },
  });
}

function ensureSpecificationDdlSection(content: string, dbDesignDdl: string) {
  const trimmedContent = content.trimEnd();
  if (/^##\s+DDL\b/im.test(trimmedContent)) return trimmedContent;
  const ddl = dbDesignDdl.trim();
  const ddlBody = ddl
    ? ['```sql', ddl, '```'].join('\n')
    : 'DB Design DDL reference は未生成です。';
  return [trimmedContent, '', '## DDL', ddlBody].join('\n');
}
