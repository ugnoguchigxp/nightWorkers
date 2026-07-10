import type { CreateCoverageImprovementTaskRequest } from "../../../../shared/schemas/quality.schema";
import { apiFetch } from "../../../lib/api-base";
import { jsonRequest } from "../../../lib/api-request";

export function fetchProjectQuality(repositoryId: string) {
	return apiFetch(`/api/repositories/${repositoryId}/quality`);
}

export function createProjectQualityRun(
	repositoryId: string,
	input: { runType: "unit" | "e2e" | "all" },
) {
	return apiFetch(
		`/api/repositories/${repositoryId}/quality/runs`,
		jsonRequest("POST", input),
	);
}

export function createCoverageImprovementTask(
	repositoryId: string,
	runId: string,
	input: CreateCoverageImprovementTaskRequest,
) {
	return apiFetch(
		`/api/repositories/${repositoryId}/quality/runs/${runId}/coverage-task`,
		jsonRequest("POST", input),
	);
}
