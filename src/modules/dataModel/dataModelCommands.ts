import { apiFetch } from '../../lib/api-base';
import { jsonRequest } from '../../lib/api-request';

type DataModelGenerationInput = {
  prompt?: string;
  questionnaireSessionId?: string | null;
  featurePlanMessageId?: string | null;
  sourceBlueprintMessageId?: string | null;
};

export function generateDataModelArtifact(sessionId: string, input: DataModelGenerationInput) {
  return apiFetch(`/api/tasks/${sessionId}/plan-mode/data-model`, jsonRequest('POST', input));
}
