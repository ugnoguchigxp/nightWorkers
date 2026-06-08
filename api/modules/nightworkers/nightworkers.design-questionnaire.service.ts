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
import { isAppBlueprintMessage } from './nightworkers.planning-helpers.service';
import * as repo from './nightworkers.repository';

type TaskMessageRow = Awaited<ReturnType<typeof repo.listTaskMessages>>[number];

type SpecificationDecision = {
  question: string;
  answer: string;
  why: string;
  section: string;
  deferred: boolean;
};

const specificationDocumentDraftSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
});

const MAX_DESIGN_QUESTIONNAIRE_PAGES = 4;

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

function validateDesignQuestionnaireAnswerForQuestion(
  answer: DesignQuestionnaireAnswer,
  question: any
) {
  if (question.answerType === 'single_choice' && answer.selectedOptionIds.length > 1) {
    throw new AppError(
      422,
      'MULTIPLE_OPTIONS_FOR_SINGLE_CHOICE',
      `Question ${answer.questionId} accepts only one selected option.`
    );
  }

  const optionIds = new Set(
    (Array.isArray(question.options) ? question.options : [])
      .map((option: any) => String(option.id || ''))
      .filter(Boolean)
  );
  const submittedOptionIds = [...answer.selectedOptionIds, ...answer.rankedOptionIds];
  const unknownOptionId = submittedOptionIds.find((optionId) => !optionIds.has(optionId));
  if (unknownOptionId) {
    throw new AppError(
      422,
      'UNKNOWN_OPTION',
      `Unknown option id for question ${answer.questionId}: ${unknownOptionId}`
    );
  }
}

function isDesignQuestionnaireAnswerComplete(
  question: any,
  answer: DesignQuestionnaireAnswer | undefined
) {
  if (!answer) return false;
  if (answer.deferred) return true;
  if (question.answerType === 'multi_choice') return true;
  if (question.answerType === 'boolean') return answer.booleanValue !== undefined;
  if (question.answerType === 'free_text') return Boolean(answer.freeText?.trim());
  if (question.answerType === 'ranked') return answer.rankedOptionIds.length > 0;
  return answer.selectedOptionIds.length > 0;
}

function removeDuplicateFollowUpQuestions(session: any, questionnaire: any) {
  const existingQuestions = getSessionQuestions(session);
  const next = structuredClone(questionnaire);
  let keptCount = 0;
  next.questionSets = (next.questionSets || [])
    .map((set: any) => {
      const questions = (Array.isArray(set.questions) ? set.questions : []).filter(
        (question: any) =>
          !existingQuestions.some((existing: any) => isDuplicateQuestion(existing, question))
      );
      keptCount += questions.length;
      return { ...set, questions };
    })
    .filter((set: any) => set.questions.length > 0);
  return keptCount > 0 ? next : null;
}

function isDuplicateQuestion(existing: any, candidate: any) {
  const existingQuestion = normalizeQuestionText(existing.question || existing.topic || '');
  const candidateQuestion = normalizeQuestionText(candidate.question || candidate.topic || '');
  if (existingQuestion && candidateQuestion && existingQuestion === candidateQuestion) return true;

  const existingOptions = optionSignature(existing);
  const candidateOptions = optionSignature(candidate);
  if (existingOptions && candidateOptions && existingOptions === candidateOptions) return true;

  return false;
}

function optionSignature(question: any) {
  return (Array.isArray(question.options) ? question.options : [])
    .map((option: any) => normalizeQuestionText(option.label || option.id || ''))
    .filter(Boolean)
    .sort()
    .join('|');
}

function normalizeQuestionText(value: unknown) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[？?。．.、,\s]/g, '')
    .replace(/ください/g, '')
    .replace(/どれですか/g, '')
    .replace(/選んで/g, '')
    .replace(/含めたい/g, '含める')
    .replace(/含める/g, '含める')
    .trim();
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
  input: { questionnaireSessionId?: string | null } = {}
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
  const content = parsed.content;
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
  return { message, workspace: await getSpecificationWorkspace(taskId) };
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

function buildSpecificationDocumentContext(input: {
  task: any;
  session: any;
  workspace: BlueprintSpecificationWorkspace;
  messages: TaskMessageRow[];
}) {
  const latestBlueprint = findLatestBlueprintMessage(input.messages, 'blueprint');
  const latestDbDesign = findLatestBlueprintMessage(input.messages, 'db-design');
  const blueprint = getMessageBlueprint(latestBlueprint);
  const dbDesignBlueprint = getMessageBlueprint(latestDbDesign);
  return {
    task: [
      `Title: ${input.task.title || 'Untitled'}`,
      input.task.description ? `Description: ${input.task.description}` : null,
      input.task.objective ? `Objective: ${input.task.objective}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    questionnaireDecisions: renderQuestionnaireAnswerMarkdown(input.session),
    blueprintSummary: renderCompressedBlueprintNaturalLanguage(blueprint),
    dbDesignDdl: renderDbDesignDdlReference(dbDesignBlueprint),
    traceability: [
      `Questionnaire session: ${input.session.id}`,
      latestBlueprint
        ? `Blueprint message: ${latestBlueprint.id}`
        : 'Blueprint message: not generated',
      latestDbDesign
        ? `DB Design message: ${latestDbDesign.id}`
        : 'DB Design message: not generated',
      `Workspace counts: blueprint=${input.workspace.blueprintArtifacts.length}, dbDesign=${input.workspace.dbDesignArtifacts.length}`,
    ].join('\n'),
  };
}

function renderCompressedBlueprintNaturalLanguage(blueprint: Record<string, any> | null) {
  if (!blueprint) return 'Blueprint は未生成です。';
  const lines = [
    `Blueprint "${String(blueprint.name || blueprint.id || 'App Blueprint')}" を採用しています。`,
  ];
  if (blueprint.description) {
    lines.push(`全体方針: ${compactText(String(blueprint.description), 280)}`);
  }
  const screens = toRecordArray(blueprint.screens).slice(0, 4);
  for (const screen of screens) {
    const screenName = String(screen.name || screen.id || 'Unnamed screen');
    const path = screen.path ? ` (${String(screen.path)})` : '';
    lines.push(
      `画面: ${screenName}${path}。画面種別は ${String(screen.componentName || 'Page')}。`
    );
    const sections = toRecordArray(screen.sections).slice(0, 8);
    for (const section of sections) {
      const props = isRecord(section.props) ? section.props : {};
      const label = String(section.name || props.title || section.id || 'Unnamed section');
      const component = String(section.componentName || 'Section');
      const description = compactText(
        String(props.description || section.visualIntent || section.intent || '').trim(),
        220
      );
      const details = summarizeSectionProps(section);
      lines.push(
        `- 採用 section: ${label}。component は ${component}。${description || 'この画面の主要確認対象です。'}${details ? ` ${details}` : ''}`
      );
    }
  }
  const tasks = toRecordArray(blueprint.implementationTasks).slice(0, 6);
  if (tasks.length > 0) {
    lines.push('実装時に意識する作業:');
    for (const task of tasks) {
      lines.push(
        `- ${compactText(String(task.title || task.id || ''), 90)}: ${compactText(String(task.description || ''), 180)}`
      );
    }
  }
  return lines.join('\n');
}

function summarizeSectionProps(section: Record<string, any>) {
  const props = isRecord(section.props) ? section.props : {};
  const parts: string[] = [];
  if (Array.isArray(props.columns)) {
    const columns = props.columns
      .map((column: unknown) =>
        isRecord(column) ? String(column.title || column.name || column.id || '') : ''
      )
      .filter(Boolean)
      .slice(0, 5);
    if (columns.length) parts.push(`列は ${columns.join(' / ')}。`);
  }
  if (Array.isArray(props.items)) {
    const items = props.items
      .map((item: unknown) =>
        isRecord(item) ? String(item.label || item.title || item.name || '') : ''
      )
      .filter(Boolean)
      .slice(0, 5);
    if (items.length) parts.push(`表示項目は ${items.join(' / ')}。`);
  }
  if (Array.isArray(props.tabs)) {
    const tabs = props.tabs
      .map((item: unknown) =>
        isRecord(item) ? String(item.label || item.title || item.id || '') : String(item)
      )
      .filter(Boolean)
      .slice(0, 5);
    if (tabs.length) parts.push(`タブは ${tabs.join(' / ')}。`);
  }
  if (Array.isArray(props.filters)) {
    const filters = props.filters
      .map((item: unknown) =>
        isRecord(item) ? String(item.label || item.name || item.id || '') : String(item)
      )
      .filter(Boolean)
      .slice(0, 5);
    if (filters.length) parts.push(`フィルターは ${filters.join(' / ')}。`);
  }
  return parts.join(' ');
}

function renderDbDesignDdlReference(blueprint: Record<string, any> | null) {
  if (!blueprint) return 'DB Design は未生成です。';
  const schema = isRecord(blueprint.databaseSchema) ? blueprint.databaseSchema : {};
  const tables = toRecordArray(schema.tables);
  const relations = toRecordArray(schema.relations);
  if (tables.length === 0) return 'DB Design には table が定義されていません。';
  const lines: string[] = [];
  for (const table of tables) {
    const tableName = safeSqlIdentifier(String(table.name || table.id || 'table'));
    const columns = toRecordArray(table.columns);
    lines.push(`CREATE TABLE ${tableName} (`);
    if (columns.length === 0) {
      lines.push('  -- columns are not defined');
    } else {
      columns.forEach((column, index) => {
        const columnName = safeSqlIdentifier(
          String(column.name || column.id || `column_${index + 1}`)
        );
        const type = ddlType(column.type);
        const constraints = [
          column.primaryKey ? 'PRIMARY KEY' : null,
          column.nullable === false ? 'NOT NULL' : null,
          column.unique ? 'UNIQUE' : null,
        ].filter(Boolean);
        const suffix = index === columns.length - 1 ? '' : ',';
        lines.push(
          `  ${columnName} ${type}${constraints.length ? ` ${constraints.join(' ')}` : ''}${suffix}`
        );
      });
    }
    lines.push(');');
    if (Array.isArray(table.indexes)) {
      for (const index of table.indexes.slice(0, 4)) {
        const fields = Array.isArray(index)
          ? index.map((field) => safeSqlIdentifier(String(field)))
          : [];
        if (fields.length > 0) {
          lines.push(
            `CREATE INDEX idx_${tableName}_${fields.join('_')} ON ${tableName} (${fields.join(', ')});`
          );
        }
      }
    }
    lines.push('');
  }
  for (const relation of relations) {
    const fromTable = safeSqlIdentifier(String(relation.fromTable || ''));
    const fromColumn = safeSqlIdentifier(String(relation.fromColumn || ''));
    const toTable = safeSqlIdentifier(String(relation.toTable || ''));
    const toColumn = safeSqlIdentifier(String(relation.toColumn || ''));
    if (fromTable && fromColumn && toTable && toColumn) {
      lines.push(
        `ALTER TABLE ${fromTable} ADD FOREIGN KEY (${fromColumn}) REFERENCES ${toTable} (${toColumn});`
      );
    }
  }
  return lines.join('\n').trim();
}

function ddlType(value: unknown) {
  if (value === 'number' || value === 'integer') return 'INTEGER';
  if (value === 'boolean') return 'BOOLEAN';
  if (value === 'date' || value === 'datetime' || value === 'timestamp') return 'DATETIME';
  if (value === 'json') return 'JSON';
  return 'TEXT';
}

function safeSqlIdentifier(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function compactText(value: string, limit: number) {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function _renderSpecificationDesignDocument(input: {
  task: any;
  session: any;
  workspace: BlueprintSpecificationWorkspace;
  messages: TaskMessageRow[];
}) {
  const latestBlueprint = findLatestBlueprintMessage(input.messages, 'blueprint');
  const latestDbDesign = findLatestBlueprintMessage(input.messages, 'db-design');
  const blueprint = getMessageBlueprint(latestBlueprint);
  const dbDesignBlueprint = getMessageBlueprint(latestDbDesign);
  const decisionRows = collectQuestionnaireDecisions(input.session);
  const screens = toRecordArray(blueprint?.screens);
  const implementationTasks = toRecordArray(blueprint?.implementationTasks);
  const dataSource = dbDesignBlueprint || blueprint;
  const tables = toRecordArray(dataSource?.databaseSchema?.tables);
  const relations = toRecordArray(dataSource?.databaseSchema?.relations);
  const bindings = toRecordArray(dataSource?.dataBindings);
  return [
    `# ${input.task.title || 'Specification'}`,
    '',
    '## 1. 目的',
    renderSpecificationPurpose(input.task, blueprint),
    '',
    '## 2. 決定済みスコープ',
    renderDecisionSummary(decisionRows),
    '',
    '## 3. 画面仕様',
    renderScreenSpecification(screens),
    '',
    '## 4. 機能要件',
    renderFunctionalRequirements(screens, implementationTasks),
    '',
    '## 5. データ/API 方針',
    renderDataSpecification({
      tables,
      relations,
      bindings,
      hasDbDesign: Boolean(latestDbDesign),
    }),
    '',
    '## 6. 非対象・後続判断',
    renderOutOfScope(decisionRows, Boolean(latestDbDesign)),
    '',
    '## 7. 受け入れ条件',
    renderAcceptanceCriteria(screens, decisionRows),
    '',
    '## 8. トレーサビリティ',
    renderTraceability({
      session: input.session,
      workspace: input.workspace,
      latestBlueprint,
      latestDbDesign,
    }),
    '',
    '## Appendix. Questionnaire Decisions',
    renderQuestionnaireAnswerMarkdown(input.session),
  ].join('\n');
}

function findLatestBlueprintMessage(messages: TaskMessageRow[], kind: 'blueprint' | 'db-design') {
  return [...messages].reverse().find((message) => {
    const metadata = (message.metadataJson || {}) as Record<string, any>;
    if (metadata.intent !== 'app_blueprint' || !metadata.appBlueprint) return false;
    const isDbDesign = Boolean(
      metadata.source === 'blueprint-db-design' || metadata.dbDesignTarget
    );
    return kind === 'db-design' ? isDbDesign : !isDbDesign;
  });
}

function getMessageBlueprint(message: TaskMessageRow | undefined): Record<string, any> | null {
  const metadata = (message?.metadataJson || {}) as Record<string, any>;
  const blueprint = metadata.appBlueprint;
  return isRecord(blueprint) ? blueprint : null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toRecordArray(value: unknown): Array<Record<string, any>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function collectQuestionnaireDecisions(session: any): SpecificationDecision[] {
  const answerByQuestionId = new Map(session.answers.map((item: any) => [item.questionId, item]));
  return getSessionQuestions(session).map((question: any) => {
    const answer = answerByQuestionId.get(String(question.id)) as any;
    return {
      question: String(question.question || question.text || question.id),
      answer: renderQuestionnaireAnswer(question, answer?.answer),
      why: typeof question.why === 'string' ? question.why : '',
      section: typeof question.outputSection === 'string' ? question.outputSection : '',
      deferred: Boolean(answer?.answer?.deferred),
    };
  });
}

function renderSpecificationPurpose(task: any, blueprint: Record<string, any> | null) {
  const lines = [
    task.description ? `- 背景: ${task.description}` : null,
    task.objective ? `- 目的: ${task.objective}` : null,
    blueprint?.description ? `- 画面方針: ${blueprint.description}` : null,
    blueprint?.name ? `- 対象 Blueprint: ${blueprint.name}` : null,
  ].filter(Boolean);
  return lines.length > 0
    ? lines.join('\n')
    : '- 実装前に確定した質問回答と Blueprint をもとに、初期実装の仕様を定義する。';
}

function renderDecisionSummary(decisions: SpecificationDecision[]) {
  const answered = decisions.filter((decision) => decision.answer !== '未回答');
  if (answered.length === 0) return '- まだ仕様判断は記録されていない。';
  return answered
    .flatMap((decision, index) => [
      `### 2.${index + 1}. ${decision.question}`,
      `- 決定: ${decision.answer}`,
      decision.deferred ? '- 状態: 後続判断' : '- 状態: 確定',
    ])
    .join('\n');
}

function renderScreenSpecification(screens: Array<Record<string, any>>) {
  if (screens.length === 0) return '- Blueprint が未生成のため、画面仕様は未定義。';
  return screens
    .map((screen, screenIndex) => {
      const sections = toRecordArray(screen.sections);
      return [
        `### 3.${screenIndex + 1}. ${String(screen.name || screen.id || `Screen ${screenIndex + 1}`)}`,
        `- パス: ${String(screen.path || '/')}`,
        `- 画面種別: ${String(screen.componentName || 'Page')}`,
        sections.length > 0 ? '- セクション:' : '- セクション: 未定義',
        ...sections.map((section, sectionIndex) => {
          const props = isRecord(section.props) ? section.props : {};
          const label = String(
            section.name || section.title || section.id || `Section ${sectionIndex + 1}`
          );
          const component = String(section.componentName || 'Section');
          const description = String(
            props.description || section.visualIntent || section.intent || ''
          ).trim();
          return `  - ${label}: ${component}${description ? `。${description}` : ''}`;
        }),
      ].join('\n');
    })
    .join('\n\n');
}

function renderFunctionalRequirements(
  screens: Array<Record<string, any>>,
  implementationTasks: Array<Record<string, any>>
) {
  const sectionRequirements = screens.flatMap((screen) =>
    toRecordArray(screen.sections).map((section) => {
      const props = isRecord(section.props) ? section.props : {};
      const title = String(section.name || props.title || section.id || 'Section');
      const component = String(section.componentName || 'Section');
      const description = String(
        props.description || section.intent || section.visualIntent || ''
      ).trim();
      return `- ${title} を ${component} として実装し、${description || '画面目的に沿った表示と操作を提供する。'}`;
    })
  );
  const taskRequirements = implementationTasks.map((task) => {
    const title = String(task.title || task.id || 'Implementation task');
    const description = String(task.description || '').trim();
    return `- ${title}${description ? `: ${description}` : ''}`;
  });
  const requirements = [...sectionRequirements, ...taskRequirements];
  return requirements.length > 0 ? requirements.join('\n') : '- Blueprint の機能要件は未生成。';
}

function renderDataSpecification(input: {
  tables: Array<Record<string, any>>;
  relations: Array<Record<string, any>>;
  bindings: Array<Record<string, any>>;
  hasDbDesign: boolean;
}) {
  if (input.tables.length === 0 && input.bindings.length === 0) {
    return input.hasDbDesign
      ? '- DB Design は生成済みだが、table / binding はまだ定義されていない。'
      : '- DB Design は未生成。現時点では Blueprint の画面仕様を優先し、物理 DB / DDL / migration は確定しない。';
  }
  const lines = [
    input.hasDbDesign
      ? '- DB Design artifact の内容をデータ方針として採用する。'
      : '- Blueprint 内の暫定 data schema を参考情報として扱う。DB Design で確定する。',
  ];
  if (input.tables.length > 0) {
    lines.push('- Tables:');
    lines.push(
      ...input.tables.map((table) => {
        const columns = toRecordArray(table.columns)
          .map((column) => String(column.name || column.key || column.label || '').trim())
          .filter(Boolean);
        return `  - ${String(table.label || table.name || 'table')}${columns.length ? `: ${columns.join(', ')}` : ''}`;
      })
    );
  }
  if (input.relations.length > 0) lines.push(`- Relations: ${input.relations.length} 件`);
  if (input.bindings.length > 0) {
    lines.push('- UI Bindings:');
    lines.push(
      ...input.bindings.map((binding) => {
        const fields = Array.isArray(binding.fields) ? binding.fields.join(', ') : '';
        return `  - ${String(binding.name || binding.id || 'binding')}${fields ? `: ${fields}` : ''}`;
      })
    );
  }
  return lines.join('\n');
}

function renderOutOfScope(decisions: SpecificationDecision[], hasDbDesign: boolean) {
  const deferred = decisions.filter((decision) => decision.deferred);
  const lines = [
    hasDbDesign
      ? null
      : '- DB の物理設計、DDL、migration、詳細な relation 設計は DB Design 生成後に確定する。',
    ...deferred.map((decision) => `- 後続判断: ${decision.question}`),
  ].filter(Boolean);
  return lines.length > 0 ? lines.join('\n') : '- 現時点で明示的な非対象事項はない。';
}

function renderAcceptanceCriteria(
  screens: Array<Record<string, any>>,
  decisions: SpecificationDecision[]
) {
  const criteria = [
    decisions.length > 0
      ? '- Questionnaire の回答内容が画面構成と機能範囲に反映されていること。'
      : null,
    screens.length > 0
      ? '- Blueprint に定義された主要画面とセクションが実装計画に落とせる粒度で説明されていること。'
      : null,
    '- 仕様書だけを読んで、初期実装の対象・非対象・後続判断が区別できること。',
  ].filter(Boolean);
  return criteria.join('\n');
}

function renderTraceability(input: {
  session: any;
  workspace: BlueprintSpecificationWorkspace;
  latestBlueprint: TaskMessageRow | undefined;
  latestDbDesign: TaskMessageRow | undefined;
}) {
  return [
    `- Questionnaire session: ${input.session.id}`,
    `- Questionnaire: ${input.session.answers.length}/${getAnswerableSessionQuestions(input.session, input.session.answers).length}`,
    `- Blueprint artifacts: ${input.workspace.blueprintArtifacts.length}`,
    input.latestBlueprint
      ? `- Blueprint source message: ${input.latestBlueprint.id}`
      : '- Blueprint source message: 未生成',
    `- DB Design artifacts: ${input.workspace.dbDesignArtifacts.length}`,
    input.latestDbDesign
      ? `- DB Design source message: ${input.latestDbDesign.id}`
      : '- DB Design source message: 未生成',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function renderQuestionnaireAnswerMarkdown(session: any) {
  const answerByQuestionId = new Map(session.answers.map((item: any) => [item.questionId, item]));
  const lines: string[] = [];
  for (const question of getSessionQuestions(session)) {
    const answer = answerByQuestionId.get(String(question.id)) as any;
    lines.push(`- ${question.question}`);
    lines.push(`  - Answer: ${renderQuestionnaireAnswer(question, answer?.answer)}`);
    if (question.why) lines.push(`  - Why: ${question.why}`);
    if (question.outputSection) lines.push(`  - Section: ${question.outputSection}`);
  }
  return lines.length > 0 ? lines.join('\n') : '- No questionnaire answers.';
}

function renderQuestionnaireAnswer(question: any, answer: DesignQuestionnaireAnswer | undefined) {
  if (!answer) return '未回答';
  if (answer.deferred) return '後で決める';
  if (typeof answer.booleanValue === 'boolean') return answer.booleanValue ? 'はい' : 'いいえ';
  if (answer.freeText?.trim()) return answer.freeText.trim();
  const options = new Map(
    (Array.isArray(question.options) ? question.options : []).map((option: any) => [
      String(option.id),
      String(option.label || option.id),
    ])
  );
  const selected = [...answer.selectedOptionIds, ...answer.rankedOptionIds]
    .map((id) => options.get(id) || id)
    .filter(Boolean);
  return selected.length > 0 ? selected.join(', ') : '未回答';
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
      '出力は JSON object のみで、title と content を返してください。content は Markdown 文字列にしてください。',
      'content には 目的、スコープ、画面仕様、機能要件、データ設計方針、非対象、受け入れ条件、トレーサビリティを含めてください。',
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
