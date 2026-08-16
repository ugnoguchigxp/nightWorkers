import { queryOptions } from "@tanstack/react-query";
import { client } from "../../../lib/api";
import { readJsonResponse } from "../../../lib/api-error";
import type { Repository } from "../types";

export const repositoryQueryKeys = {
	all: ["repositories"] as const,
	detail: (id: string) => ["repositories", id] as const,
};

export async function fetchRepositories(): Promise<Repository[]> {
	const response = await client.repositories.$get();
	return readJsonResponse<Repository[]>(response);
}

export function repositoriesQueryOptions() {
	return queryOptions({
		queryKey: repositoryQueryKeys.all,
		queryFn: fetchRepositories,
	});
}
