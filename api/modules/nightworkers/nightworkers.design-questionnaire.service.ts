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
    const message = await repo.createTaskMessage({
      taskId,
      role: 'assistant',
      content: renderBlueprintMarkdown(blueprint),
      messageType: 'markdown_document',
      payloadJson: {
        intent: 'app_blueprint',
        title: blueprint.name || task.title || 'App Blueprint',
        appBlueprint: blueprint,
        validation,
        generation,
        source: 'specification-status',
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
          source: 'specification-status',
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
  const content = renderSpecificationDesignDocument({
    task,
    session,
    workspace,
    messages,
  });
  const message = await repo.createTaskMessage({
    taskId,
    role: 'assistant',
    content,
    messageType: 'markdown_document',
    payloadJson: {
      intent: 'draft_spec',
      title: 'Specification',
      source: 'specification-status',
      questionnaireSessionId: session.id,
      markdownDocumentData: {
        title: 'Specification',
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
    '- databaseSchema と dataBindings を具体化する。',
    '- SQL、DDL、migration、Drizzle schema は作らない。',
    '- UI の screen/section と data binding が整合するようにする。',
  ].join('\n');
}

function renderSpecificationDesignDocument(input: {
  task: any;
  session: any;
  workspace: BlueprintSpecificationWorkspace;
  messages: TaskMessageRow[];
}) {
  const latestBlueprint = [...input.messages].reverse().find((message) => {
    const metadata = (message.metadataJson || {}) as Record<string, any>;
    return (
      metadata.intent === 'app_blueprint' &&
      metadata.appBlueprint &&
      metadata.source !== 'blueprint-db-design' &&
      !metadata.dbDesignTarget
    );
  });
  const latestDbDesign = [...input.messages].reverse().find((message) => {
    const metadata = (message.metadataJson || {}) as Record<string, any>;
    return (
      metadata.intent === 'app_blueprint' &&
      metadata.appBlueprint &&
      (metadata.source === 'blueprint-db-design' || metadata.dbDesignTarget)
    );
  });
  return [
    `# ${input.task.title || 'Specification'}`,
    '',
    '## Status',
    `- Questionnaire: ${input.session.answers.length}/${getAnswerableSessionQuestions(input.session, input.session.answers).length}`,
    `- Blueprint artifacts: ${input.workspace.blueprintArtifacts.length}`,
    `- DB Design artifacts: ${input.workspace.dbDesignArtifacts.length}`,
    '',
    '## Questionnaire Decisions',
    renderQuestionnaireAnswerMarkdown(input.session),
    '',
    '## Blueprint',
    latestBlueprint
      ? `- Source message: ${latestBlueprint.id}\n- Title: ${
          ((latestBlueprint.metadataJson || {}) as Record<string, any>).title || 'App Blueprint'
        }`
      : '- Not generated yet.',
    '',
    '## DB Design',
    latestDbDesign
      ? `- Source message: ${latestDbDesign.id}\n- Title: ${
          ((latestDbDesign.metadataJson || {}) as Record<string, any>).title || 'DB Design'
        }`
      : '- Not generated yet.',
    '',
    '## Next Step',
    '- この設計書を確認し、必要なら Blueprint または DB Design を再生成してから実装計画に進む。',
  ].join('\n');
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

function buildDesignQuestionnaireSystemPrompt() {
  return [
    'あなたは NightWorkers の Design Questionnaire generator です。',
    'あなたは実装前の確認フォームを作ります。',
    'ユーザーが Radio button または Checkbox で選べる質問だけを作ってください。',
    '自由記述、説明文、DB設計、分岐条件、id は作らないでください。',
    '質問は 3-8 件、各 options は 2-6 件にしてください。',
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
    'ユーザー回答を読み、Design Assembly に進むだけの仕様判断が揃ったか判定してください。',
    '不足がある場合だけ action=follow_up にし、既存質問と重複しない追加質問を questionnaire に返してください。',
    '既存質問と同じ質問文、同じ意味、または同じ選択肢セットの質問は絶対に返さないでください。',
    'checkbox が未選択で回答されている場合、それは「どれも不要 / 今回は含めない」という仕様判断として扱ってください。',
    '追加質問はユーザーが Radio button または Checkbox で選べるものだけにしてください。',
    '自由記述、説明文、DB設計、分岐条件、id は作らないでください。',
    '追加質問は 1-5 件、各 options は 2-6 件にしてください。',
    'すでに回答から十分に判断できる内容を繰り返さないでください。',
    '十分であれば action=ready_for_design_assembly とし、questionnaire は null にしてください。',
    '回答は JSON のみで返してください。',
  ].join('\n');
}
