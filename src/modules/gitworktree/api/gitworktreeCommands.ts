import { apiFetch } from "../../../lib/api-base";
import { jsonRequest } from "../../../lib/api-request";

export async function readGitworktreeResponse<T>(
	response: Response,
): Promise<T> {
	const payload = (await response.json().catch(() => null)) as unknown;
	if (!response.ok) {
		const errorValue =
			payload && typeof payload === "object" && "error" in payload
				? payload.error
				: null;
		const message =
			typeof errorValue === "string"
				? errorValue
				: errorValue &&
						typeof errorValue === "object" &&
						"message" in errorValue &&
						typeof errorValue.message === "string"
					? errorValue.message
					: `Request failed: ${response.status}`;
		throw new Error(message);
	}
	return payload as T;
}

export function fetchRepositoryWorktrees(repositoryId: string) {
	return apiFetch(`/api/repositories/${repositoryId}/worktrees`);
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
	input: { worktreeId: string; expectedHead: string },
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

export function adviseRepositoryWorktrees(
	repositoryId: string,
	input: unknown,
) {
	return apiFetch(
		`/api/repositories/${repositoryId}/worktrees/advice`,
		jsonRequest("POST", input),
	);
}
