import type { DesignQuestionnaireAnswer } from "../../../shared/schemas/design-questionnaire.schema";
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
export function fetchMissionPilotQuestionnaireDraft(
	taskId: string,
	signal?: AbortSignal,
) {
	return apiFetch(`/api/mission-pilot/tasks/${taskId}/questionnaire-draft`, {
		signal,
	});
}
export function fetchMissionPilotPlanProgress(taskId: string) {
	return apiFetch(`/api/mission-pilot/tasks/${taskId}/plan-progress`);
}
export function fetchMissionPilotExecutionTrace(taskId: string) {
	return apiFetch(`/api/mission-pilot/tasks/${taskId}/execution`);
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
