import { z } from 'zod';
import {
  type BlueprintSpecificationWorkspace,
  type DesignQuestionnaireAnswer,
  designQuestionnaireAnswerSchema,
} from '../../../shared/schemas/design-questionnaire.schema';
import { AppError, NotFoundError } from '../../lib/errors';
import { generateBlueprintDataDesignDraft } from '../../services/blueprints/data-design';
import { renderBlueprintMarkdown } from '../../services/blueprints/draft';
import {
  BlueprintDraftGenerationError,
  generatePlanModeBlueprintDraft,
} from '../../services/blueprints/llm-draft';
import { validateAppBlueprint } from '../../services/blueprints/validation';
import { callStructuredJsonLLM } from '../../services/supervisor/llm-provider';
import {
  buildDesignQuestionnaireSessionView,
  designDecisionReviewJsonSchema,
  designQuestionnaireFollowUpDecisionJsonSchema,
  getAnswerableSessionQuestions,
  getSessionQuestions,
  parseDesignDecisionReviewRaw,
  parseDesignQuestionnaireFollowUpDecisionRaw,
  parseDesignQuestionnaireRaw,
  questionnaireChoiceFormJsonSchema,
  renderDesignDecisionReviewMarkdown,
} from './nightworkers.design-questionnaire-parser.service';
import {
  isDesignQuestionnaireAnswerComplete,
  removeDuplicateFollowUpQuestions,
  validateDesignQuestionnaireAnswerForQuestion,
} from './nightworkers.design-questionnaire-validation';
import { isAppBlueprintMessage } from './nightworkers.planning-helpers.service';
import * as repo from './nightworkers.repository';
import {
  buildSpecificationDocumentContext,
  renderQuestionnaireAnswerMarkdown,
} from './nightworkers.spec-document-renderer';

type TaskMessageRow = Awaited<ReturnType<typeof repo.listTaskMessages>>[number];

const specificationDocumentDraftSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
});

const MAX_DESIGN_QUESTIONNAIRE_PAGES = 4;

export async function createDesignQuestionnaire(
  taskId: string,
  sourceBlueprintMessageId?: string | null,
  sourcePrompt?: string
) {
  const task = await repo.getTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  const sourceBlueprintMessage = sourceBlueprintMessageId
    ? (await getQuestionnaireTaskAndBlueprint(taskId, sourceBlueprintMessageId))
        .sourceBlueprintMessage
    : null;
  const rawOutput = await generateDesignQuestionnaireRawOutput({
    taskId,
    repositoryId: task.repositoryId,
    sourceBlueprintMessage,
    taskPrompt: sourcePrompt || task.objective || task.description || task.title,
  }).catch(async (error) => {
    const rawContent = (error as Error & { rawContent?: string }).rawContent;
    if (rawContent?.trim()) return rawContent;
    throw error;
  });
  const parsed = parseDesignQuestionnaireRaw(rawOutput, {
    taskId,
    repositoryId: task.repositoryId,
    sourceBlueprintMessageId: sourceBlueprintMessage?.id ?? null,
    sourceKind: sourceBlueprintMessage ? 'blueprint' : 'plan_mode_intake',
  });
  const session = await repo.createDesignQuestionnaireSession({
    taskId,
    repositoryId: task.repositoryId,
    sourceBlueprintMessageId: sourceBlueprintMessageId || null,
    status: 'draft',
  });
  if (parsed.ok) {
    await repo.createDesignQuestionnaireQuestionSet({
      sessionId: session.id,
      sequence: 1,
      questionnaireJson: parsed.value,
      rawOutput,
      validationStatus: 'valid',
    });
    await repo.updateDesignQuestionnaireSessionStatus(session.id, 'answering');
  } else {
    await repo.createDesignQuestionnaireQuestionSet({
      sessionId: session.id,
      sequence: 1,
      rawOutput,
      validationStatus: 'invalid',
    });
    await repo.updateDesignQuestionnaireSessionStatus(session.id, 'needs_edit');
  }
  return getDesignQuestionnaireSession(taskId, session.id);
}

export async function listDesignQuestionnaires(taskId: string) {
  const task = await repo.getTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  const sessions = await repo.listDesignQuestionnaireSessionsForTask(taskId);
  return Promise.all(sessions.map((session) => buildDesignQuestionnaireSessionView(session.id)));
}

export async function getDesignQuestionnaireSession(taskId: string, sessionId: string) {
  const session = await buildDesignQuestionnaireSessionView(sessionId);
  if (session.taskId !== taskId) throw new NotFoundError('Questionnaire session not found');
  return session;
}

export async function saveDesignQuestionnaireAnswers(
  taskId: string,
  sessionId: string,
  answers: DesignQuestionnaireAnswer[]
) {
  const session = await getDesignQuestionnaireSession(taskId, sessionId);
  if (session.status === 'review_ready' || session.status === 'accepted') {
    return session;
  }
  const questionById = new Map(
    getSessionQuestions(session).map((question: any) => [String(question.id), question])
  );
  for (const answer of answers) {
    const parsed = designQuestionnaireAnswerSchema.parse(answer);
    const question = questionById.get(parsed.questionId);
    if (!question) {
      throw new AppError(422, 'UNKNOWN_QUESTION', `Unknown question id: ${parsed.questionId}`);
    }
    validateDesignQuestionnaireAnswerForQuestion(parsed, question);
    await repo.upsertDesignQuestionnaireAnswer({
      sessionId,
      questionId: parsed.questionId,
      answerJson: parsed,
    });
  }
  const updatedAnswers = await repo.listDesignQuestionnaireAnswers(sessionId);
  const updatedAnswerViews = updatedAnswers.map((answer) => ({
    questionId: answer.questionId,
    answer: designQuestionnaireAnswerSchema.parse(answer.answerJson),
  }));
  const requiredQuestions = getAnswerableSessionQuestions(session, updatedAnswerViews);
  const answerByQuestionId = new Map(
    updatedAnswerViews.map((answer) => [answer.questionId, answer.answer])
  );
  const nextStatus =
    requiredQuestions.length > 0 &&
    requiredQuestions.every((question: any) =>
      isDesignQuestionnaireAnswerComplete(question, answerByQuestionId.get(String(question.id)))
    )
      ? 'review_ready'
      : 'answering';
  if (nextStatus === 'answering') {
    await repo.updateDesignQuestionnaireSessionStatus(sessionId, nextStatus);
    return getDesignQuestionnaireSession(taskId, sessionId);
  }
  const completedSession = await getDesignQuestionnaireSession(taskId, sessionId);
  return assessDesignQuestionnaireNextStep(taskId, completedSession);
}

export async function generateDesignQuestionnaireFollowUp(taskId: string, sessionId: string) {
  const session = await getDesignQuestionnaireSession(taskId, sessionId);
  if (session.questionSets.length >= MAX_DESIGN_QUESTIONNAIRE_PAGES) {
    await repo.updateDesignQuestionnaireSessionStatus(sessionId, 'review_ready');
    return getDesignQuestionnaireSession(taskId, sessionId);
  }
  const rawOutput = await generateDesignQuestionnaireFollowUpRawOutput(session);
  const parsed = parseDesignQuestionnaireRaw(rawOutput, {
    taskId: session.taskId,
    repositoryId: session.repositoryId,
    sourceBlueprintMessageId: session.sourceBlueprintMessageId,
    sourceKind: session.sourceBlueprintMessageId ? 'blueprint' : 'plan_mode_intake',
  });
  const nextSequence =
    session.questionSets.reduce((max, set) => Math.max(max, set.sequence), 0) + 1;
  await repo.createDesignQuestionnaireQuestionSet({
    sessionId,
    sequence: nextSequence,
    questionnaireJson: parsed.ok ? parsed.value : undefined,
    rawOutput,
    validationStatus: parsed.ok ? 'valid' : 'invalid',
  });
  await repo.updateDesignQuestionnaireSessionStatus(
    sessionId,
    parsed.ok ? 'answering' : 'needs_edit'
  );
  return getDesignQuestionnaireSession(taskId, sessionId);
}

async function assessDesignQuestionnaireNextStep(taskId: string, session: any) {
  if (session.questionSets.length >= MAX_DESIGN_QUESTIONNAIRE_PAGES) {
    await repo.updateDesignQuestionnaireSessionStatus(session.id, 'review_ready');
    return getDesignQuestionnaireSession(taskId, session.id);
  }
  const nextSequence =
    session.questionSets.reduce((max: number, set: any) => Math.max(max, set.sequence), 0) + 1;
  const rawOutput = await generateDesignQuestionnaireFollowUpDecisionRawOutput(session);
  const parsed = parseDesignQuestionnaireFollowUpDecisionRaw(
    rawOutput,
    {
      taskId: session.taskId,
      repositoryId: session.repositoryId,
      sourceBlueprintMessageId: session.sourceBlueprintMessageId,
      sourceKind: session.sourceBlueprintMessageId ? 'blueprint' : 'plan_mode_intake',
    },
    nextSequence
  );
  if (!parsed.ok) {
    await repo.createDesignQuestionnaireQuestionSet({
      sessionId: session.id,
      sequence: nextSequence,
      rawOutput,
      validationStatus: 'invalid',
    });
    await repo.updateDesignQuestionnaireSessionStatus(session.id, 'needs_edit');
    return getDesignQuestionnaireSession(taskId, session.id);
  }
  if (parsed.value.action === 'ready_for_design_assembly') {
    await repo.updateDesignQuestionnaireSessionStatus(session.id, 'review_ready');
    return getDesignQuestionnaireSession(taskId, session.id);
  }
  if (!parsed.value.questionnaire) {
    await repo.createDesignQuestionnaireQuestionSet({
      sessionId: session.id,
      sequence: nextSequence,
      rawOutput,
      validationStatus: 'invalid',
    });
    await repo.updateDesignQuestionnaireSessionStatus(session.id, 'needs_edit');
    return getDesignQuestionnaireSession(taskId, session.id);
  }
  const dedupedQuestionnaire = removeDuplicateFollowUpQuestions(
    session,
    parsed.value.questionnaire
  );
  if (!dedupedQuestionnaire) {
    await repo.updateDesignQuestionnaireSessionStatus(session.id, 'review_ready');
    return getDesignQuestionnaireSession(taskId, session.id);
  }
  await repo.createDesignQuestionnaireQuestionSet({
    sessionId: session.id,
    sequence: nextSequence,
    questionnaireJson: dedupedQuestionnaire,
    rawOutput,
    validationStatus: 'valid',
  });
  await repo.updateDesignQuestionnaireSessionStatus(session.id, 'answering');
  return getDesignQuestionnaireSession(taskId, session.id);
}

export async function generateDesignQuestionnaireReview(taskId: string, sessionId: string) {
  const session = await getDesignQuestionnaireSession(taskId, sessionId);
  const rawOutput = await generateDesignQuestionnaireReviewRawOutput(session);
  const parsed = parseDesignDecisionReviewRaw(rawOutput);
  const review = await repo.createDesignQuestionnaireReview({
    sessionId,
    reviewJson: parsed.ok ? parsed.value : null,
    status: parsed.ok ? 'draft' : 'needs_edit',
  });
  await repo.updateDesignQuestionnaireSessionStatus(
    sessionId,
    parsed.ok ? 'review_ready' : 'needs_edit'
  );
  return {
    session: await getDesignQuestionnaireSession(taskId, sessionId),
    reviewId: review.id,
    rawOutput,
    validationStatus: parsed.ok ? 'valid' : 'invalid',
  };
}

export async function acceptDesignQuestionnaireReview(taskId: string, sessionId: string) {
  const session = await getDesignQuestionnaireSession(taskId, sessionId);
  const latestDraft = session.reviews.find((review) => review.status === 'draft' && review.review);
  if (!latestDraft?.review) {
    throw new AppError(422, 'NO_REVIEW_DRAFT', 'A draft Decision Review is required.');
  }
  const message = await repo.createTaskMessage({
    taskId,
    role: 'assistant',
    content: renderDesignDecisionReviewMarkdown(latestDraft.review),
    messageType: 'markdown_document',
    payloadJson: {
      intent: 'design_decision_review',
      title: latestDraft.review.title,
      designDecisionReview: latestDraft.review,
      source: 'design-questionnaire',
      sourceBlueprintMessageId: session.sourceBlueprintMessageId,
      questionnaireSessionId: session.id,
    },
  });
  await repo.updateDesignQuestionnaireReview(latestDraft.id, {
    status: 'accepted',
    publishedMessageId: message.id,
  });
  await repo.updateDesignQuestionnaireSessionStatus(sessionId, 'accepted');
  return getDesignQuestionnaireSession(taskId, sessionId);
}

export async function leaveDesignQuestionnaireReviewUnadopted(taskId: string, sessionId: string) {
  const session = await getDesignQuestionnaireSession(taskId, sessionId);
  const latestReview = session.reviews[0];
  if (latestReview) {
    await repo.updateDesignQuestionnaireReview(latestReview.id, { status: 'left_unadopted' });
  }
  await repo.updateDesignQuestionnaireSessionStatus(sessionId, 'needs_edit');
  return getDesignQuestionnaireSession(taskId, sessionId);
}

export async function getBlueprintSpecificationWorkspace(
  taskId: string
): Promise<BlueprintSpecificationWorkspace> {
  const task = await repo.getTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  const messages = await repo.listTaskMessages(taskId);
  const sessions = await Promise.all(
    (await repo.listDesignQuestionnaireSessionsForTask(taskId)).map((session) =>
      buildDesignQuestionnaireSessionView(session.id)
    )
  );
  const blueprintArtifacts = [];
  const dbDesignArtifacts = [];
  const decisionReviews = [];
  const implementationReferences = [];
  for (const message of messages) {
    if (message.messageType !== 'markdown_document') continue;
    const metadata = (message.metadataJson || {}) as Record<string, any>;
    if (metadata.intent === 'app_blueprint' && metadata.appBlueprint) {
      const isDbDesign = Boolean(
        metadata.source === 'blueprint-db-design' || metadata.dbDesignTarget
      );
      const adoption = isDbDesign
        ? await repo.getBlueprintDbDesignAdoption(taskId, message.id)
        : await repo.getBlueprintArtifactAdoption(taskId, message.id);
      const artifact = {
        id: `${isDbDesign ? 'db-design' : 'blueprint'}-${message.id}`,
        kind: isDbDesign ? ('db-design' as const) : ('blueprint' as const),
        title: String(metadata.title || metadata.appBlueprint?.name || 'App Blueprint'),
        sourceMessageId: message.id,
        createdAt: message.createdAt,
        adoptionState: adoption
          ? adoption.adopted
            ? ('adopted' as const)
            : ('not_adopted' as const)
          : ('unknown' as const),
        sourceBlueprintMessageId:
          typeof metadata.sourceBlueprintMessageId === 'string'
            ? metadata.sourceBlueprintMessageId
            : typeof metadata.dbDesignTarget?.sourceBlueprintMessageId === 'string'
              ? metadata.dbDesignTarget.sourceBlueprintMessageId
              : undefined,
      };
      if (isDbDesign) dbDesignArtifacts.push(artifact);
      else blueprintArtifacts.push(artifact);
    }
    if (metadata.intent === 'design_decision_review' && metadata.designDecisionReview) {
      decisionReviews.push({
        id: `decision-review-${message.id}`,
        kind: 'decision-review' as const,
        title: String(metadata.title || 'Decision Review'),
        sourceMessageId: message.id,
        createdAt: message.createdAt,
        sourceBlueprintMessageId: metadata.sourceBlueprintMessageId,
      });
    }
    if (metadata.intent === 'implementation_plan' || metadata.intent === 'draft_spec') {
      implementationReferences.push({
        id: `implementation-reference-${message.id}`,
        kind: 'implementation-plan' as const,
        title: String(metadata.title || 'Implementation Plan'),
        sourceMessageId: message.id,
        taskId,
      });
    }
  }
  return {
    taskId,
    repositoryId: task.repositoryId,
    generatedAt: new Date().toISOString(),
    blueprintArtifacts,
    dbDesignArtifacts,
    questionnaireSessions: sessions.map((session) => ({
      id: session.id,
      sourceBlueprintMessageId: session.sourceBlueprintMessageId,
      status: session.status,
      answeredCount: session.answers.length,
      totalQuestionCount: getAnswerableSessionQuestions(session, session.answers).length,
      latestReviewId: session.reviews[0]?.id,
    })),
    decisionReviews,
    implementationReferences,
  };
}

export async function getSpecificationWorkspace(taskId: string) {
  return getBlueprintSpecificationWorkspace(taskId);
}

export async function generateSpecificationStatusBlueprint(
  taskId: string,
  input: { questionnaireSessionId?: string | null } = {}
) {
  const task = await repo.getTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  const session = await resolveReadyQuestionnaireSession(taskId, input.questionnaireSessionId);
  const prompt = renderQuestionnaireBlueprintPrompt(task, session);
  try {
    const { blueprint, validation, generation } = await generatePlanModeBlueprintDraft({
      taskId,
      title: task.title || 'App Blueprint',
      prompt,
    });
    const artifact = await repo.createBlueprintActivityArtifact({
      taskId,
      title: blueprint.name || task.title || 'App Blueprint',
      appBlueprint: blueprint,
      validation,
      generation,
      source: 'status',
      metadataJson: {
        questionnaireSessionId: session.id,
      },
    });
    if (!artifact) throw new Error('Blueprint artifact persistence failed.');
    const message = await repo.createTaskMessage({
      taskId,
      role: 'assistant',
      content: renderBlueprintMarkdown(blueprint),
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
          summary: blueprint.description || renderBlueprintMarkdown(blueprint).slice(0, 160),
          cardKind: 'app_blueprint',
        },
        appBlueprint: blueprint,
        validation,
        generation,
        source: 'status',
        questionnaireSessionId: session.id,
      },
    });
    await repo.updateTask(taskId, {
      objective: task.objective || prompt,
      status: task.status === 'draft' ? 'ready' : task.status,
    });
    return { message, workspace: await getSpecificationWorkspace(taskId) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof BlueprintDraftGenerationError && error.rawOutput?.trim()) {
      await repo.createTaskMessage({
        taskId,
        role: 'assistant',
        content: error.rawOutput.trim(),
        messageType: 'text',
        payloadJson: {
          intent: 'blueprint_raw_output',
          source: 'status',
          validationStatus: 'failed',
          error: message,
          questionnaireSessionId: session.id,
          promptDiagnostics: error.promptDiagnostics,
        },
      });
    }
    throw new AppError(502, 'SPECIFICATION_BLUEPRINT_FAILED', message);
  }
}

export async function generateSpecificationStatusDbDesign(
  taskId: string,
  input: { questionnaireSessionId?: string | null; sourceBlueprintMessageId?: string | null } = {}
) {
  const task = await repo.getTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  const session = await resolveReadyQuestionnaireSession(taskId, input.questionnaireSessionId);
  const sourceBlueprintMessage = await resolveSourceBlueprintMessage(
    taskId,
    input.sourceBlueprintMessageId
  );
  if (!sourceBlueprintMessage) {
    throw new AppError(422, 'BLUEPRINT_REQUIRED', 'Blueprint generation is required first.');
  }
  const metadata = (sourceBlueprintMessage.metadataJson || {}) as Record<string, any>;
  const currentBlueprint = metadata.appBlueprint;
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
  const message = await repo.createTaskMessage({
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

export async function generateSpecificationStatusDesignDocument(
  taskId: string,
  input: { questionnaireSessionId?: string | null; reviewAfterGenerate?: boolean } = {}
) {
  const task = await repo.getTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  const session = await resolveReadyQuestionnaireSession(taskId, input.questionnaireSessionId);
  const workspace = await getSpecificationWorkspace(taskId);
  const messages = await repo.listTaskMessages(taskId);
  const context = buildSpecificationDocumentContext({
    task,
    session,
    workspace,
    messages,
  });
  const rawOutput = await generateSpecificationDesignDocumentRawOutput(taskId, context);
  const parsed = specificationDocumentDraftSchema.parse(JSON.parse(rawOutput));
  const content = ensureSpecificationDdlSection(parsed.content, context.dbDesignDdl);
  const message = await repo.createTaskMessage({
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

async function resolveReadyQuestionnaireSession(taskId: string, sessionId?: string | null) {
  const session = sessionId
    ? await getDesignQuestionnaireSession(taskId, sessionId)
    : (
        await Promise.all(
          (
            await repo.listDesignQuestionnaireSessionsForTask(taskId)
          ).map((item) => buildDesignQuestionnaireSessionView(item.id))
        )
      ).find((item) => item.status === 'review_ready' || item.status === 'accepted');
  if (!session) {
    throw new AppError(
      422,
      'QUESTIONNAIRE_NOT_READY',
      'A completed Design Questionnaire is required.'
    );
  }
  if (session.status !== 'review_ready' && session.status !== 'accepted') {
    throw new AppError(
      422,
      'QUESTIONNAIRE_NOT_READY',
      'Design Questionnaire must be ready before generating specification artifacts.'
    );
  }
  return session;
}

async function resolveSourceBlueprintMessage(taskId: string, messageId?: string | null) {
  const messages = await repo.listTaskMessages(taskId);
  if (messageId) {
    const message = messages.find((item) => item.id === messageId);
    return message && isAppBlueprintMessage(message) ? message : null;
  }
  return (
    [...messages].reverse().find((message) => {
      const metadata = (message.metadataJson || {}) as Record<string, any>;
      return (
        isAppBlueprintMessage(message) &&
        metadata.source !== 'blueprint-db-design' &&
        !metadata.dbDesignTarget
      );
    }) ||
    [...messages].reverse().find((message) => {
      const metadata = (message.metadataJson || {}) as Record<string, any>;
      return isAppBlueprintMessage(message) && metadata.source !== 'blueprint-db-design';
    }) ||
    null
  );
}

function renderQuestionnaireBlueprintPrompt(task: any, session: any) {
  return [
    'Design Questionnaire の回答から App Blueprint を生成してください。',
    '',
    '## Task',
    `Title: ${task.title}`,
    task.description ? `Description: ${task.description}` : '',
    task.objective ? `Objective: ${task.objective}` : '',
    '',
    '## Questionnaire Answers',
    renderQuestionnaireAnswerMarkdown(session),
    '',
    '## Output Focus',
    '- UI/UX と画面構成を優先する。',
    '- DB table/column/relation は作らず、DB Design へ渡す論点として残す。',
    '- ユーザーが回答した仕様判断を画面・セクション・サンプルデータに反映する。',
  ]
    .filter(Boolean)
    .join('\n');
}

function renderQuestionnaireDbDesignPrompt(session: any, currentBlueprint: any) {
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

async function getQuestionnaireTaskAndBlueprint(taskId: string, sourceBlueprintMessageId: string) {
  const task = await repo.getTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  const sourceBlueprintMessage = await repo.getTaskMessage(sourceBlueprintMessageId);
  if (!sourceBlueprintMessage || sourceBlueprintMessage.taskId !== taskId) {
    throw new AppError(422, 'SOURCE_BLUEPRINT_NOT_FOUND', 'Source Blueprint message not found.');
  }
  if (!isAppBlueprintMessage(sourceBlueprintMessage)) {
    throw new AppError(
      422,
      'SOURCE_BLUEPRINT_REQUIRED',
      'Source message must be an App Blueprint.'
    );
  }
  return { task, sourceBlueprintMessage };
}

async function generateDesignQuestionnaireRawOutput(input: {
  taskId: string;
  repositoryId: string;
  sourceBlueprintMessage: TaskMessageRow | null;
  taskPrompt: string;
}) {
  const metadata = (input.sourceBlueprintMessage?.metadataJson || {}) as { appBlueprint?: unknown };
  const source = input.sourceBlueprintMessage
    ? {
        sourceKind: 'blueprint',
        blueprintMessageId: input.sourceBlueprintMessage.id,
        blueprint: metadata.appBlueprint,
      }
    : {
        sourceKind: 'plan_mode_intake',
        prompt: input.taskPrompt,
      };
  return callStructuredJsonLLM(
    buildDesignQuestionnaireSystemPrompt(),
    [
      input.sourceBlueprintMessage
        ? '次の App Blueprint artifact を入力に、実装前に決めたい質問フォームを生成してください。'
        : '次の Plan mode intake を入力に、実装前に決めたい質問フォームを生成してください。',
      '',
      JSON.stringify(source, null, 2),
    ].join('\n'),
    {
      schemaName: 'design_questionnaire',
      schema: questionnaireChoiceFormJsonSchema,
      taskId: input.taskId,
    }
  );
}

async function generateDesignQuestionnaireFollowUpRawOutput(session: any) {
  return callStructuredJsonLLM(
    buildDesignQuestionnaireSystemPrompt(),
    [
      '次の質問票と回答をもとに、追加確認が必要な質問だけを follow-up question set として返してください。',
      '既に十分に回答された質問を繰り返さないでください。',
      JSON.stringify(
        {
          sessionId: session.id,
          taskId: session.taskId,
          repositoryId: session.repositoryId,
          sourceBlueprintMessageId: session.sourceBlueprintMessageId,
          questionSets: session.questionSets.map((set: any) => set.questionnaire),
          answers: session.answers.map((answer: any) => answer.answer),
        },
        null,
        2
      ),
    ].join('\n'),
    {
      schemaName: 'design_questionnaire_follow_up',
      schema: questionnaireChoiceFormJsonSchema,
      taskId: session.taskId,
    }
  );
}

async function generateDesignQuestionnaireFollowUpDecisionRawOutput(session: any) {
  return callStructuredJsonLLM(
    buildDesignQuestionnaireFollowUpDecisionSystemPrompt(),
    [
      '次の質問票とユーザー回答を評価し、Design Assembly に進めるか、さらに追質問が必要かを判定してください。',
      '追質問が必要な場合だけ、追加質問フォームを questionnaire に入れてください。',
      '十分なら action は ready_for_design_assembly、questionnaire は null にしてください。',
      JSON.stringify(
        {
          sessionId: session.id,
          taskId: session.taskId,
          repositoryId: session.repositoryId,
          sourceBlueprintMessageId: session.sourceBlueprintMessageId,
          questionSets: session.questionSets.map((set: any) => set.questionnaire),
          answers: session.answers.map((answer: any) => answer.answer),
        },
        null,
        2
      ),
    ].join('\n'),
    {
      schemaName: 'design_questionnaire_follow_up_decision',
      schema: designQuestionnaireFollowUpDecisionJsonSchema,
      taskId: session.taskId,
    }
  );
}

async function generateDesignQuestionnaireReviewRawOutput(session: any) {
  return callStructuredJsonLLM(
    [
      'あなたは NightWorkers の Design Questionnaire review synthesizer です。',
      '回答を設計判断、後回し事項、未解決事項、DB Design handoff note に整理してください。',
      'DB table、column、relation、DDL の具体案は作らず、DB Design へ渡す制約・論点だけを書いてください。',
      'sourceQuestionIds と unresolvedQuestionIds を必ず保持してください。',
    ].join('\n'),
    JSON.stringify(
      {
        sessionId: session.id,
        sourceBlueprintMessageId: session.sourceBlueprintMessageId,
        questionSets: session.questionSets.map((set: any) => set.questionnaire),
        answers: session.answers.map((answer: any) => answer.answer),
      },
      null,
      2
    ),
    {
      schemaName: 'design_decision_review',
      schema: designDecisionReviewJsonSchema,
      taskId: session.taskId,
    }
  );
}

async function generateSpecificationDesignDocumentRawOutput(
  taskId: string,
  context: ReturnType<typeof buildSpecificationDocumentContext>
) {
  return callStructuredJsonLLM(
    [
      'あなたは NightWorkers の Specification writer です。',
      'Design Questionnaire、Blueprint summary、DB Design DDL reference をもとに、実装前に読む設計書を Markdown で作成してください。',
      'Blueprint summary は選択された画面・section・意図を自然言語に圧縮したものです。JSON として扱わず、仕様判断として解釈してください。',
      'DB Design DDL reference は参考情報です。DDL や migration を実行する指示ではありません。',
      'content には必ず独立した `## DDL` セクションを含め、DB Design DDL reference の内容をそのままコードブロックで転記してください。',
      'DB Design DDL reference が未生成または table 未定義の場合も、`## DDL` セクションを作り、未確定である理由を書いてください。',
      '出力は JSON object のみで、title と content を返してください。content は Markdown 文字列にしてください。',
      'content には 目的、スコープ、画面仕様、機能要件、データ設計方針、DDL、非対象、受け入れ条件、トレーサビリティを含めてください。',
    ].join('\n'),
    [
      '次の圧縮済み context から Specification を作成してください。',
      '',
      '## Task',
      context.task,
      '',
      '## Questionnaire Decisions',
      context.questionnaireDecisions,
      '',
      '## Blueprint Summary',
      context.blueprintSummary,
      '',
      '## DB Design DDL Reference',
      context.dbDesignDdl,
      '',
      '## Traceability',
      context.traceability,
    ].join('\n'),
    {
      schemaName: 'specification_document',
      schema: z.toJSONSchema(specificationDocumentDraftSchema),
      taskId,
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
    [
      'あなたは NightWorkers の Specification reviewer / editor です。',
      'ユーザー依頼: ドキュメントレビューをしてください。改善するべき点が無くなるまで改善してください。',
      '対象は直前に生成された Specification Markdown です。',
      'レビュー結果を別コメントとして返すのではなく、改善済みの最終 Markdown を返してください。',
      '改善点がない場合も、読みやすさと実装着手可能性を確認したうえで同等以上の最終版を返してください。',
      '実装済み事実、今回の仕様、将来候補を混ぜないでください。',
      '非対象、受け入れ条件、未解決事項、トレーサビリティを落とさないでください。',
      '`## DDL` セクションを必ず残し、DB Design DDL Reference の内容をコードブロックとして含めてください。',
      'DB Design DDL Reference は実行指示ではなく仕様上のデータ設計根拠として扱ってください。',
      '出力は JSON object のみで、title と content を返してください。content は Markdown 文字列にしてください。',
    ].join('\n'),
    [
      '次の Specification をレビューし、改善するべき点がなくなるまで改善した最終版を作成してください。',
      '',
      '## Current Specification',
      input.content,
      '',
      '## Task',
      input.context.task,
      '',
      '## Questionnaire Decisions',
      input.context.questionnaireDecisions,
      '',
      '## Blueprint Summary',
      input.context.blueprintSummary,
      '',
      '## DB Design DDL Reference',
      input.context.dbDesignDdl,
      '',
      '## Traceability',
      input.context.traceability,
    ].join('\n'),
    {
      schemaName: 'specification_document_review',
      schema: z.toJSONSchema(specificationDocumentDraftSchema),
      taskId: input.taskId,
    }
  );
  const parsed = specificationDocumentDraftSchema.parse(JSON.parse(rawOutput));
  const title = parsed.title || input.title;
  const content = ensureSpecificationDdlSection(parsed.content, input.context.dbDesignDdl);
  return repo.createTaskMessage({
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

function buildDesignQuestionnaireSystemPrompt() {
  return [
    'あなたは NightWorkers の Design Questionnaire generator です。',
    'あなたは実装前の確認フォームを作ります。目的は、grill-me のように仕様の曖昧さを段階的に潰すことです。',
    'Questionnaire は最大4ページまで続けられます。初回はその1ページ目です。',
    '初回フォームでは、最初に回答できる重要論点を 1 ページ分まとめて聞いてください。',
    '質問ジャンルは task / blueprint / repository context から判断し、必要なものを選んでください。固定分類やキーワード一致で決めないでください。',
    '例として、scope、UI/UX、データ、backend/API、認証、外部連携、Docker、cloud deployment、storage、運用、非対象などが論点になり得ます。',
    'ただし、現時点の回答がないと答えられない下位論点は初回で無理に聞かず、回答後の follow-up に回してください。',
    'コードや入力contextから合理的に推定できることは、ユーザーに聞かず前提として扱ってください。',
    'ユーザーが Radio button または Checkbox で選べる質問だけを作ってください。',
    '自由記述、説明文、DB設計、分岐条件、id は作らないでください。',
    '質問は原則 8-12 件にしてください。明らかに論点が少ない場合だけ少なくして構いません。',
    '各 options は 2-6 件にしてください。',
    'type は単一選択なら radio、複数選択が自然なら checkbox にしてください。',
    'checkbox の質問では、ユーザーが「どれも不要」を表明できる選択肢を必ず1つ含めてください。',
    '選択肢は狭すぎる機能名だけにせず、「最小構成」「後続対応」「今回は含めない」など判断できる粒度を含めてください。',
    'JSON root は {title, questions} のみです。',
    '回答は JSON のみで返してください。',
  ].join('\n');
}

function buildDesignQuestionnaireFollowUpDecisionSystemPrompt() {
  return [
    'あなたは NightWorkers の Design Questionnaire facilitator です。',
    '目的は、実装前の仕様の曖昧さを grill-me のように質問攻めで潰すことです。',
    'ユーザー回答を読み、次に聞かないと答えられない下位論点や、まだ未確認の質問ジャンルが残っているか判定してください。',
    'Questionnaire は最大4ページまでです。4ページ目まで回答済みなら追加質問を出さず ready_for_design_assembly にしてください。',
    '不足がある場合だけ action=follow_up にし、次に回答可能になったジャンルの追加質問を questionnaire に返してください。',
    '既存質問と同じ質問文、同じ意味、または同じ選択肢セットの質問は絶対に返さないでください。',
    'checkbox が未選択で回答されている場合、それは「どれも不要 / 今回は含めない」という仕様判断として扱ってください。',
    '一度の follow-up で全ジャンルを詰め込まず、次に設計判断を進めるために必要な 1 ページ分だけを返してください。',
    'Docker、cloud deployment、storage、認証、外部連携、運用、非対象などは、回答内容から必要性が見えた場合に追加確認してください。',
    'コードや既存回答から合理的に推定できることは、ユーザーに聞かず前提として扱ってください。',
    '追加質問はユーザーが Radio button または Checkbox で選べるものだけにしてください。',
    '自由記述、説明文、DB設計、分岐条件、id は作らないでください。',
    '追加質問は原則 4-10 件、各 options は 2-6 件にしてください。',
    'すでに回答から十分に判断できる内容を繰り返さないでください。',
    '十分であれば action=ready_for_design_assembly とし、questionnaire は null にしてください。',
    '回答は JSON のみで返してください。',
  ].join('\n');
}
