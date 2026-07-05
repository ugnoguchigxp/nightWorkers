import { apiFetch } from '../../lib/api-base';
import { jsonRequest } from '../../lib/api-request';

export function fetchDesignQuestionnaireSessions(sessionId: string, init?: RequestInit) {
  return apiFetch(`/api/tasks/${sessionId}/design-questionnaire`, init);
}

export function fetchDesignQuestionnaireSession(
  sessionId: string,
  questionnaireSessionId: string,
  init?: RequestInit
) {
  return apiFetch(`/api/tasks/${sessionId}/design-questionnaire/${questionnaireSessionId}`, init);
}

export function startDesignQuestionnaire(
  sessionId: string,
  input: { sourceBlueprintMessageId?: string | null }
) {
  return apiFetch(`/api/tasks/${sessionId}/design-questionnaire`, jsonRequest('POST', input));
}

export function generateAdditionalDesignQuestionnaireQuestions(
  sessionId: string,
  input: {
    source: 'user_requested' | 'artifact_triggered' | 'pre_feature_plan_gate';
    reason?: string;
    maxQuestions?: number;
  }
) {
  return apiFetch(
    `/api/tasks/${sessionId}/design-questionnaire/additional`,
    jsonRequest('POST', input)
  );
}

export function submitDesignQuestionnaireAnswers(
  sessionId: string,
  questionnaireSessionId: string,
  input: { answers: unknown[] }
) {
  return apiFetch(
    `/api/tasks/${sessionId}/design-questionnaire/${questionnaireSessionId}/answers`,
    jsonRequest('POST', input)
  );
}
