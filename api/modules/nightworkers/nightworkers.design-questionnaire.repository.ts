import { asc, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  designQuestionnaireAnswers,
  designQuestionnaireQuestionSets,
  designQuestionnaireReviews,
  designQuestionnaireSessions,
} from '../../db/design-questionnaire-schema';
import { taskMessages } from '../../db/schema';

function _isAppBlueprintDocumentMessage(messageType: string | null | undefined, payloadJson: any) {
  return Boolean(
    messageType === 'markdown_document' &&
      payloadJson &&
      typeof payloadJson === 'object' &&
      payloadJson.intent === 'app_blueprint' &&
      payloadJson.appBlueprint
  );
}

export async function getTaskMessage(id: string) {
  const [message] = await db.select().from(taskMessages).where(eq(taskMessages.id, id));
  return message;
}

export async function createDesignQuestionnaireSession(data: {
  taskId: string;
  repositoryId: string;
  sourceBlueprintMessageId?: string | null;
  status?: string;
}) {
  const [session] = await db
    .insert(designQuestionnaireSessions)
    .values({
      ...data,
      status: data.status ?? 'draft',
    })
    .returning();
  return session;
}

export async function updateDesignQuestionnaireSessionStatus(id: string, status: string) {
  const [session] = await db
    .update(designQuestionnaireSessions)
    .set({ status, updatedAt: new Date() })
    .where(eq(designQuestionnaireSessions.id, id))
    .returning();
  return session;
}

export async function listDesignQuestionnaireSessionsForTask(taskId: string) {
  return db
    .select()
    .from(designQuestionnaireSessions)
    .where(eq(designQuestionnaireSessions.taskId, taskId))
    .orderBy(desc(designQuestionnaireSessions.createdAt));
}

export async function getDesignQuestionnaireSession(id: string) {
  const [session] = await db
    .select()
    .from(designQuestionnaireSessions)
    .where(eq(designQuestionnaireSessions.id, id));
  return session;
}

export async function createDesignQuestionnaireQuestionSet(data: {
  sessionId: string;
  sequence: number;
  questionnaireJson?: any;
  rawOutput?: string | null;
  validationStatus: 'valid' | 'invalid';
}) {
  const [questionSet] = await db
    .insert(designQuestionnaireQuestionSets)
    .values({
      sessionId: data.sessionId,
      sequence: data.sequence,
      questionnaireJson: data.questionnaireJson ?? null,
      rawOutput: data.rawOutput ?? null,
      validationStatus: data.validationStatus,
    })
    .returning();
  return questionSet;
}

export async function listDesignQuestionnaireQuestionSets(sessionId: string) {
  return db
    .select()
    .from(designQuestionnaireQuestionSets)
    .where(eq(designQuestionnaireQuestionSets.sessionId, sessionId))
    .orderBy(asc(designQuestionnaireQuestionSets.sequence));
}

export async function upsertDesignQuestionnaireAnswer(data: {
  sessionId: string;
  questionId: string;
  answerJson: any;
}) {
  const now = new Date();
  const [answer] = await db
    .insert(designQuestionnaireAnswers)
    .values({
      sessionId: data.sessionId,
      questionId: data.questionId,
      answerJson: data.answerJson,
      answeredAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [designQuestionnaireAnswers.sessionId, designQuestionnaireAnswers.questionId],
      set: {
        answerJson: data.answerJson,
        answeredAt: now,
        updatedAt: now,
      },
    })
    .returning();
  return answer;
}

export async function listDesignQuestionnaireAnswers(sessionId: string) {
  return db
    .select()
    .from(designQuestionnaireAnswers)
    .where(eq(designQuestionnaireAnswers.sessionId, sessionId))
    .orderBy(asc(designQuestionnaireAnswers.createdAt));
}

export async function createDesignQuestionnaireReview(data: {
  sessionId: string;
  reviewJson?: any;
  publishedMessageId?: string | null;
  status?: string;
}) {
  const [review] = await db
    .insert(designQuestionnaireReviews)
    .values({
      sessionId: data.sessionId,
      reviewJson: data.reviewJson ?? null,
      publishedMessageId: data.publishedMessageId ?? null,
      status: data.status ?? 'draft',
    })
    .returning();
  return review;
}

export async function updateDesignQuestionnaireReview(
  id: string,
  data: { status?: string; publishedMessageId?: string | null; reviewJson?: any }
) {
  const [review] = await db
    .update(designQuestionnaireReviews)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(designQuestionnaireReviews.id, id))
    .returning();
  return review;
}

export async function listDesignQuestionnaireReviews(sessionId: string) {
  return db
    .select()
    .from(designQuestionnaireReviews)
    .where(eq(designQuestionnaireReviews.sessionId, sessionId))
    .orderBy(desc(designQuestionnaireReviews.createdAt));
}

export async function getDesignQuestionnaireReview(id: string) {
  const [review] = await db
    .select()
    .from(designQuestionnaireReviews)
    .where(eq(designQuestionnaireReviews.id, id));
  return review;
}
