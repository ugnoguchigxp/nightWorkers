import { apiFetch } from "../../../lib/api-base";
import { jsonRequest } from "../../../lib/api-request";
import type { ProjectSecurityIntelligenceSettings } from "../types";

export function fetchProjectSecurityIntelligenceSettings(repositoryId: string) {
	return apiFetch(
		`/api/repositories/${repositoryId}/settings/security-intelligence`,
	);
}

export function saveProjectSecurityIntelligenceSettings(
	repositoryId: string,
	settings: ProjectSecurityIntelligenceSettings,
) {
	return apiFetch(
		`/api/repositories/${repositoryId}/settings/security-intelligence`,
		jsonRequest("PUT", settings),
	);
}
