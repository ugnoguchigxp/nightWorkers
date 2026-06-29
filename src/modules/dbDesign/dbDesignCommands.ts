import { apiFetch } from '../../lib/api-base';
import { jsonRequest } from '../../lib/api-request';

type DbDesignGenerationInput = {
  questionnaireSessionId: string;
  sourceBlueprintMessageId: string | null;
};

export function generateDbDesignArtifact(sessionId: string, input: DbDesignGenerationInput) {
  return apiFetch(
    `/api/tasks/${sessionId}/specification-workspace/db-design`,
    jsonRequest('POST', input)
  );
}

export function fetchDbDesignAdoption(sessionId: string, messageId: string, init?: RequestInit) {
  return apiFetch(
    `/api/tasks/${sessionId}/blueprint-db-design-adoption?messageId=${encodeURIComponent(
      messageId
    )}`,
    init
  );
}

export function saveDbDesignAdoption(
  sessionId: string,
  input: { messageId: string; adopted: boolean }
) {
  return apiFetch(
    `/api/tasks/${sessionId}/blueprint-db-design-adoption`,
    jsonRequest('PUT', input)
  );
}
