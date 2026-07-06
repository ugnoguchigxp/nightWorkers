import { apiFetch } from "../../lib/api-base";
import { jsonRequest } from "../../lib/api-request";

type SpecificationGenerationInput = {
	prompt?: string;
	questionnaireSessionId?: string | null;
	sourceBlueprintMessageId?: string | null;
	proceedWithUnansweredBlocking?: boolean;
};

export function fetchPlanModeWorkspace(sessionId: string, init?: RequestInit) {
	return apiFetch(`/api/tasks/${sessionId}/plan-mode/workspace`, init);
}

export function generateFeaturePlanArtifact(
	sessionId: string,
	input: SpecificationGenerationInput,
) {
	return apiFetch(
		`/api/tasks/${sessionId}/plan-mode/feature-plan`,
		jsonRequest("POST", input),
	);
}
