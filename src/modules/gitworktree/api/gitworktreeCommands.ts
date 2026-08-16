import type { RemoveWorktreeRequest } from "../../../../shared/schemas/gitworktree.schema";
import { apiFetch } from "../../../lib/api-base";
import { readJsonResponse } from "../../../lib/api-error";
import { jsonRequest } from "../../../lib/api-request";

export async function readGitworktreeResponse<T>(
	response: Response,
): Promise<T> {
	return readJsonResponse<T>(response);
}

export function fetchRepositoryWorktrees(repositoryId: string) {
	return apiFetch(`/api/repositories/${repositoryId}/worktrees`, {
		cache: "no-store",
	});
}

export function fetchRepositoryGitIntegration(repositoryId: string) {
	return apiFetch(`/api/repositories/${repositoryId}`);
}

export function updateRepositoryGitIntegration(
	repositoryId: string,
	input: unknown,
) {
	return apiFetch(
		`/api/repositories/${repositoryId}`,
		jsonRequest("PATCH", input),
	);
}

export function createRepositoryWorktree(repositoryId: string, input: unknown) {
	return apiFetch(
		`/api/repositories/${repositoryId}/worktrees`,
		jsonRequest("POST", input),
	);
}

export function fetchRepositoryWorktreeDiff(
	repositoryId: string,
	worktreeId: string,
) {
	return apiFetch(
		`/api/repositories/${repositoryId}/worktrees/diff`,
		jsonRequest("POST", { worktreeId }),
	);
}

export function removeRepositoryWorktree(
	repositoryId: string,
	input: RemoveWorktreeRequest,
) {
	return apiFetch(`/api/repositories/${repositoryId}/worktrees`, {
		method: "DELETE",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
}

export function previewRepositoryWorktreePrune(repositoryId: string) {
	return apiFetch(`/api/repositories/${repositoryId}/worktrees/prune-preview`);
}

export function pruneRepositoryWorktrees(repositoryId: string) {
	return apiFetch(`/api/repositories/${repositoryId}/worktrees/prune`, {
		method: "POST",
	});
}
