import { apiFetch } from "../../../lib/api-base";
import { jsonRequest } from "../../../lib/api-request";

export function measureProjectCodeSize(repositoryId: string) {
	return apiFetch(
		`/api/repositories/${repositoryId}/tech-stack/code-size/measure`,
		jsonRequest("POST", {}),
	);
}

export function refreshProjectDependencyAudit(repositoryId: string) {
	return apiFetch(
		`/api/repositories/${repositoryId}/tech-stack/dependency-audit`,
		jsonRequest("POST", {}),
	);
}
