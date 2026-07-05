import { z } from 'zod';
import { AppError, NotFoundError } from '../../lib/errors';
import {
  buildSpecificationDocumentSystemPrompt,
  buildSpecificationDocumentUserPrompt,
} from '../../services/structured-generation/prompts/design-questionnaire';
import { callStructuredJsonLLM } from '../../services/structured-llm';
import {
  createPlanModeTaskMessage,
  getPlanModeTask,
  listPlanModeTaskMessages,
} from '../nightworkers/nightworkers.plan-mode-core.port';
import { assertPlanModeCapabilityEnabled } from '../nightworkers/nightworkers.plan-mode-settings.service';
import { resolvePlanModeProjectStackContext } from './plan-mode-project-stack-context';
import { getPlanModeWorkspace } from './plan-mode-workspace.service';
import {
  buildSpecificationDocumentContext,
  sanitizeSpecificationTargetNaming,
} from './specification-document-renderer';
import { assertPlanModeMutable } from './specification-mutability';
import { resolveOptionalReadyQuestionnaireSession } from './specification-questionnaire-session';

const specificationDocumentDraftSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
});
const DEFAULT_FEATURE_PLAN_TITLE = 'Feature Plan';
export const FEATURE_PLAN_LLM_TIMEOUT_MS = 240_000;

export async function generateFeaturePlanArtifact(
  taskId: string,
  input: { questionnaireSessionId?: string | null } = {}
) {
  const task = await getPlanModeTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  assertPlanModeCapabilityEnabled('feature_plan');
  assertPlanModeMutable(task);
  const session = await resolveOptionalReadyQuestionnaireSession(
    taskId,
    input.questionnaireSessionId
  );
  const projectStackContext = await resolvePlanModeProjectStackContext(task.repositoryId);
  const workspace = await getPlanModeWorkspace(taskId);
  const messages = await listPlanModeTaskMessages(taskId);
  const context = buildSpecificationDocumentContext({
    task,
    session,
    workspace,
    messages,
    projectStackContext,
  });
  const rawOutput = await generateSpecificationDesignDocumentRawOutput(taskId, context);
  const parsed = specificationDocumentDraftSchema.parse(JSON.parse(rawOutput));
  const content = sanitizeSpecificationTargetNaming(
    ensureSpecificationDdlSection(parsed.content, context.dataModelDdl),
    context.projectStackContext
  );
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
          planViewReferencesIncluded: Boolean(context.planViewReferences.trim()),
          planModeReferencesIncluded: Boolean(context.planModeReferences.trim()),
        },
      },
      markdownDocumentData: {
        title: parsed.title || DEFAULT_FEATURE_PLAN_TITLE,
        content,
      },
    },
  });
  return { message, workspace: await getPlanModeWorkspace(taskId) };
}

async function generateSpecificationDesignDocumentRawOutput(
  taskId: string,
  context: ReturnType<typeof buildSpecificationDocumentContext>
) {
  try {
    return await callStructuredJsonLLM(
      buildSpecificationDocumentSystemPrompt(),
      buildSpecificationDocumentUserPrompt(context),
      {
        schemaName: 'specification_document',
        schema: z.toJSONSchema(specificationDocumentDraftSchema),
        taskId,
        role: 'plan',
        timeoutMs: FEATURE_PLAN_LLM_TIMEOUT_MS,
      }
    );
  } catch (error) {
    if (isStructuredLlmAbortError(error)) {
      throw new AppError(
        504,
        'SPECIFICATION_DOCUMENT_TIMEOUT',
        `Feature Plan generation timed out after ${Math.round(FEATURE_PLAN_LLM_TIMEOUT_MS / 1000)} seconds.`
      );
    }
    throw error;
  }
}

function isStructuredLlmAbortError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'AbortError' || error.message.toLowerCase().includes('operation was aborted')
  );
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
