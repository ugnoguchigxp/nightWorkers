import { apiFetch } from "../../../lib/api-base";
import { jsonRequest } from "../../../lib/api-request";
import type {
	ProjectExplorationCatalogPilotSettings,
	ProjectSecurityIntelligenceSettings,
} from "../types";

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

export function fetchProjectExplorationSettings(repositoryId: string) {
	return apiFetch(
		`/api/repositories/${repositoryId}/settings/project-exploration`,
	);
}

export function saveProjectExplorationSettings(
	repositoryId: string,
	settings: ProjectExplorationCatalogPilotSettings,
) {
	return apiFetch(
		`/api/repositories/${repositoryId}/settings/project-exploration`,
		jsonRequest("PUT", settings),
	);
}
