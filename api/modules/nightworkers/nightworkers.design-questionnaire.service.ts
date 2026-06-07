import {
  type BlueprintSpecificationWorkspace,
  type DesignQuestionnaireAnswer,
  designQuestionnaireAnswerSchema,
} from '../../../shared/schemas/design-questionnaire.schema';
import { AppError, NotFoundError } from '../../lib/errors';
import { callStructuredJsonLLM } from '../../services/supervisor/llm-provider';
import { isAppBlueprintMessage } from './nightworkers.planning-helpers.service';
import * as repo from './nightworkers.repository';

type TaskMessageRow = Awaited<ReturnType<typeof repo.listTaskMessages>>[number];

import {
  buildDesignQuestionnaireSessionView,
  designDecisionReviewJsonSchema,
  getAnswerableSessionQuestions,
  getSessionQuestions,
  parseDesignDecisionReviewRaw,
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
  const requiredQuestionIds = getAnswerableSessionQuestions(session, updatedAnswerViews).map(
    (question: any) => question.id
  );
  const answeredQuestionIds = new Set(updatedAnswerViews.map((answer) => answer.questionId));
  const nextStatus =
    requiredQuestionIds.length > 0 &&
    requiredQuestionIds.every((questionId: string) => answeredQuestionIds.has(questionId))
      ? 'review_ready'
      : 'answering';
  await repo.updateDesignQuestionnaireSessionStatus(sessionId, nextStatus);
  return getDesignQuestionnaireSession(taskId, sessionId);
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
    'JSON root は {title, questions} のみです。',
    '回答は JSON のみで返してください。',
  ].join('\n');
}
