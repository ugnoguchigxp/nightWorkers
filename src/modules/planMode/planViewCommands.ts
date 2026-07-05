import { apiFetch } from '../../lib/api-base';
import { jsonRequest } from '../../lib/api-request';

export type GenericPlanView =
  | 'user_flow'
  | 'api_io_contract'
  | 'activity_flow'
  | 'sequence_flow'
  | 'zod_schema_design';

type PlanViewGenerationInput = {
  prompt?: string;
  questionnaireSessionId?: string | null;
  featurePlanMessageId?: string | null;
  sourceBlueprintMessageId?: string | null;
  sourceDataModelMessageId?: string | null;
};

export function generatePlanViewArtifact(
  sessionId: string,
  view: GenericPlanView,
  input: PlanViewGenerationInput
) {
  return apiFetch(
    `/api/tasks/${sessionId}/plan-mode/views/${view}/generate`,
    jsonRequest('POST', input)
  );
}
