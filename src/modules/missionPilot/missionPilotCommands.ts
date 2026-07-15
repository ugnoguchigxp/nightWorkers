import type { DesignQuestionnaireAnswer } from "../../../shared/schemas/design-questionnaire.schema";
import type { MissionPilotActionConfirmation } from "../../../shared/schemas/mission-pilot-agent.schema";
import { apiFetch } from "../../lib/api-base";
import { jsonRequest } from "../../lib/api-request";
export function playMissionPilotTask(taskId: string, expectedVersion: number) {
	return apiFetch(
		`/api/mission-pilot/tasks/${taskId}/play`,
		jsonRequest("POST", { expectedVersion }),
	);
}
export function stopMissionPilotTask(taskId: string, expectedVersion: number) {
	return apiFetch(
		`/api/mission-pilot/tasks/${taskId}/stop`,
		jsonRequest("POST", { expectedVersion }),
	);
}
export function fetchMissionPilotQuestionnaireDraft(taskId: string) {
	return apiFetch(`/api/mission-pilot/tasks/${taskId}/questionnaire-draft`);
}
export function fetchMissionPilotPlanProgress(taskId: string) {
	return apiFetch(`/api/mission-pilot/tasks/${taskId}/plan-progress`);
}
export function fetchMissionPilotExecutionTrace(taskId: string) {
	return apiFetch(`/api/mission-pilot/tasks/${taskId}/execution`);
}
export function fetchMissionPilotActionConfirmations(taskId: string) {
	return apiFetch(`/api/mission-pilot/tasks/${taskId}/action-confirmations`);
}
export function resolveMissionPilotActionConfirmation(
	confirmation: Pick<MissionPilotActionConfirmation, "id" | "version">,
	decision: "approved" | "denied",
) {
	return apiFetch(
		`/api/mission-pilot/action-confirmations/${confirmation.id}/resolve`,
		jsonRequest("POST", {
			expectedVersion: confirmation.version,
			decision,
		}),
	);
}
export function updateMissionPilotQuestionnaireDraft(
	taskId: string,
	expectedVersion: number,
	answers: DesignQuestionnaireAnswer[],
) {
	return apiFetch(
		`/api/mission-pilot/tasks/${taskId}/questionnaire-draft`,
		jsonRequest("PATCH", { expectedVersion, answers }),
	);
}
export function submitMissionPilotQuestionnaireDraft(
	taskId: string,
	expectedVersion: number,
	answers: DesignQuestionnaireAnswer[],
) {
	return apiFetch(
		`/api/mission-pilot/tasks/${taskId}/questionnaire-draft/submit`,
		jsonRequest("POST", { expectedVersion, answers }),
	);
}
