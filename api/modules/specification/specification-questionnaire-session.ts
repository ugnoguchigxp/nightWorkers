import type { DesignQuestionnaireSession } from '../../../shared/schemas/design-questionnaire.schema';
import { AppError } from '../../lib/errors';
import {
  getDesignQuestionnaireSession,
  listDesignQuestionnaires,
} from '../questionnaire/questionnaire.service';

export async function resolveReadyQuestionnaireSession(
  taskId: string,
  sessionId?: string | null
): Promise<DesignQuestionnaireSession> {
  const session = sessionId
    ? await getDesignQuestionnaireSession(taskId, sessionId)
    : (await listDesignQuestionnaires(taskId)).find(
        (item) => item.status === 'review_ready' || item.status === 'accepted'
      );
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

export async function resolveOptionalReadyQuestionnaireSession(
  taskId: string,
  sessionId?: string | null
): Promise<DesignQuestionnaireSession | null> {
  if (sessionId) return resolveReadyQuestionnaireSession(taskId, sessionId);
  const session = (await listDesignQuestionnaires(taskId)).find(
    (item) => item.status === 'review_ready' || item.status === 'accepted'
  );
  return session || null;
}
