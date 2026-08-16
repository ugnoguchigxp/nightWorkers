import { afterEach, describe, expect, it, vi } from "vitest";
import {
	fetchRepositories,
	repositoriesQueryOptions,
	repositoryQueryKeys,
} from "../src/modules/nightworkers/queries/repository-queries";

describe("repository query identity", () => {
	it("uses one canonical collection key and stable detail keys", () => {
		expect(repositoryQueryKeys.all).toEqual(["repositories"]);
		expect(repositoryQueryKeys.detail("repo-1")).toEqual([
			"repositories",
			"repo-1",
		]);
		expect(repositoriesQueryOptions().queryKey).toBe(repositoryQueryKeys.all);
		expect(repositoriesQueryOptions().queryFn).toBe(fetchRepositories);
	});

	it("fetches the repository list and rejects non-2xx responses", async () => {
		const repositories = [
			{
				id: "repo-1",
				name: "nightWorkers",
				localPath: "/workspace/nightWorkers",
				branch: "main",
				allowed: true,
				queueEnabled: true,
				maxConcurrentSessions: 1,
				createdAt: "2026-08-16T00:00:00.000Z",
				updatedAt: "2026-08-16T00:00:00.000Z",
			},
		];
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(JSON.stringify(repositories), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(fetchRepositories()).resolves.toEqual(repositories);
		await expect(fetchRepositories()).rejects.toMatchObject({
			code: "INVALID_JSON_RESPONSE",
			status: 503,
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/repositories");
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});
