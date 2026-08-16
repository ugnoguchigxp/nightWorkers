import { afterEach, describe, expect, it, vi } from "vitest";
import {
	fetchOverviewDashboard,
	fetchOverviewStartupPreflight,
	overviewDashboardQueryOptions,
	overviewQueryKeys,
	overviewStartupPreflightQueryOptions,
} from "../src/modules/overview/overview-queries";

describe("overview query identity", () => {
	it("uses the dashboard scope as the canonical cache identity", () => {
		const input = { range: "30d" as const, projectFilterId: "repo-1" };
		expect(overviewQueryKeys.dashboard(input)).toEqual([
			"overview",
			{ range: "30d", repositoryId: "repo-1" },
		]);
		expect(overviewDashboardQueryOptions(input).refetchInterval).toBe(15_000);
		expect(overviewStartupPreflightQueryOptions().queryKey).toEqual([
			"overview",
			"startup-preflight",
		]);
	});

	it("validates dashboard and preflight responses through the shared decoder", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({}), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						error: {
							code: "SERVICE_UNAVAILABLE",
							message: "unavailable",
						},
					}),
					{
						status: 503,
						headers: { "content-type": "application/json" },
					},
				),
			);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			fetchOverviewDashboard({ range: "30d", projectFilterId: null }),
		).rejects.toMatchObject({ code: "INVALID_API_ERROR_RESPONSE" });
		await expect(fetchOverviewStartupPreflight()).rejects.toMatchObject({
			code: "SERVICE_UNAVAILABLE",
			status: 503,
		});
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});
