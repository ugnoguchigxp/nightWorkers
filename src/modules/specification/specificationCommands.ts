import { apiFetch } from '../../lib/api-base';
import { jsonRequest } from '../../lib/api-request';

type SpecificationGenerationInput = {
  questionnaireSessionId?: string | null;
  sourceBlueprintMessageId?: string | null;
};

export function fetchSpecificationWorkspace(sessionId: string, init?: RequestInit) {
  return apiFetch(`/api/tasks/${sessionId}/specification-workspace`, init);
}

export function generateSpecificationArtifact(
  sessionId: string,
  input: SpecificationGenerationInput
) {
  return apiFetch(
    `/api/tasks/${sessionId}/specification-workspace/design-doc`,
    jsonRequest('POST', input)
  );
}
