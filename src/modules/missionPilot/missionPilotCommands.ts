import type { DesignQuestionnaireAnswer } from "../../../shared/schemas/design-questionnaire.schema";
import type { MissionPilotSourceRef } from "../../../shared/schemas/mission-pilot.schema";
import { apiFetch } from "../../lib/api-base";
import { jsonRequest } from "../../lib/api-request";
export function createMissionPilotTask(input: {
	repositoryId: string;
	sourceRef: MissionPilotSourceRef;
}) {
	return apiFetch("/api/mission-pilot/tasks", jsonRequest("POST", input));
}
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
