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
import {
  getDesignQuestionnaireSession,
  listDesignQuestionnaires,
} from '../questionnaire/questionnaire.service';
import { listUnansweredBlockingQuestions } from '../questionnaire/questionnaire-validation';
import { resolvePlanModeProjectStackContext } from './plan-mode-project-stack-context';
import { getPlanModeWorkspace } from './plan-mode-workspace.service';
import {
  buildSpecificationDocumentContext,
  sanitizeSpecificationTargetNaming,
} from './specification-document-renderer';
import { assertPlanModeMutable } from './specification-mutability';

const specificationDocumentDraftSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
});
const DEFAULT_FEATURE_PLAN_TITLE = 'Feature Plan';
export const FEATURE_PLAN_LLM_TIMEOUT_MS = 240_000;

export async function generateFeaturePlanArtifact(
  taskId: string,
  input: { questionnaireSessionId?: string | null; proceedWithUnansweredBlocking?: boolean } = {}
) {
  const task = await getPlanModeTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  assertPlanModeCapabilityEnabled('feature_plan');
  assertPlanModeMutable(task);
  const { session, unansweredBlockingQuestions } = await resolveFeaturePlanQuestionnaireGate(
    taskId,
    input.questionnaireSessionId
  );
  if (unansweredBlockingQuestions.length > 0 && !input.proceedWithUnansweredBlocking) {
    throw new AppError(
      409,
      'BLOCKING_QUESTIONNAIRE_ANSWERS_REQUIRED',
      'Blocking questionnaire answers are required before generating Feature Plan.',
      { blockingQuestions: unansweredBlockingQuestions }
    );
  }
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
  if (unansweredBlockingQuestions.length > 0 && input.proceedWithUnansweredBlocking) {
    context.questionnaireDecisions = [
      context.questionnaireDecisions,
      '',
      '## Unanswered Blocking Assumptions',
      ...unansweredBlockingQuestions.map(
        (question) =>
          `- ${question.question} (decisionKey: ${question.decisionKey}; unanswered and explicitly proceeded without an answer)`
      ),
    ].join('\n');
  }
  const rawOutput = await generateSpecificationDesignDocumentRawOutput(taskId, context);
  const parsed = specificationDocumentDraftSchema.parse(JSON.parse(rawOutput));
  const content = sanitizeSpecificationTargetNaming(
    parsed.content.trimEnd(),
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
          contractDetailsStoredInAssembledDesignContext: true,
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

async function resolveFeaturePlanQuestionnaireGate(
  taskId: string,
  questionnaireSessionId?: string | null
) {
  const session = questionnaireSessionId
    ? await getDesignQuestionnaireSession(taskId, questionnaireSessionId)
    : await resolveLatestQuestionnaireSession(taskId);
  const unansweredBlockingQuestions = session ? listUnansweredBlockingQuestions(session) : [];
  return { session, unansweredBlockingQuestions };
}

async function resolveLatestQuestionnaireSession(taskId: string) {
  const sessions = await listDesignQuestionnaires(taskId);
  return (
    sessions.find((session) => session.status !== 'abandoned' && hasValidQuestions(session)) || null
  );
}

function hasValidQuestions(session: Awaited<ReturnType<typeof listDesignQuestionnaires>>[number]) {
  return session.questionSets.some((set) =>
    (set.questionnaire?.questionSets || []).some((questionSet) => questionSet.questions.length > 0)
  );
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
