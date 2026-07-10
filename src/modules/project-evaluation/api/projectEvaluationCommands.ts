import type {
	CreateTasksFromProjectImprovementsRequest,
	GenerateProjectImprovementsRequest,
} from "../../../../shared/schemas/project-evaluation.schema";
import { apiFetch } from "../../../lib/api-base";
import { jsonRequest } from "../../../lib/api-request";

export function fetchProjectEvaluationHistory(repositoryId: string) {
	return apiFetch(`/api/repositories/${repositoryId}/evaluations`);
}

export function fetchLatestProjectEvaluation(repositoryId: string) {
	return apiFetch(`/api/repositories/${repositoryId}/evaluations/latest`);
}

export function fetchProjectEvaluationDetail(evaluationId: string) {
	return apiFetch(`/api/project-evaluations/${evaluationId}`);
}

export function runProjectEvaluation(repositoryId: string) {
	return apiFetch(
		`/api/repositories/${repositoryId}/evaluations`,
		jsonRequest("POST", {}),
	);
}

export function startProjectEvaluation(repositoryId: string) {
	return apiFetch(
		`/api/repositories/${repositoryId}/evaluations/start`,
		jsonRequest("POST", {}),
	);
}

export function fetchProjectEvaluationActivityEvents(
	evaluationId: string,
	afterSeq?: number,
) {
	const params = typeof afterSeq === "number" ? `?afterSeq=${afterSeq}` : "";
	return apiFetch(
		`/api/project-evaluations/${evaluationId}/activity-events${params}`,
	);
}

export function generateProjectImprovements(
	evaluationId: string,
	input: GenerateProjectImprovementsRequest,
) {
	return apiFetch(
		`/api/project-evaluations/${evaluationId}/improvements`,
		jsonRequest("POST", input),
	);
}

export function createProjectEvaluationTasks(
	evaluationId: string,
	input: CreateTasksFromProjectImprovementsRequest,
) {
	return apiFetch(
		`/api/project-evaluations/${evaluationId}/tasks`,
		jsonRequest("POST", input),
	);
}
