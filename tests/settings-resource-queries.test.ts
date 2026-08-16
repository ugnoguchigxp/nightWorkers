import { describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

const generalSettings = {
	timezone: "Asia/Tokyo",
	language: "ja",
	currency: "JPY",
	fx: { source: "ecb", autoRefresh: true, lastRefreshedAt: null },
	planMode: { capabilities: {} },
	llmUsage: { promptPartObservabilityEnabled: true },
	dataRetention: {},
};

async function loadQueries(overrides: Record<string, unknown> = {}) {
	vi.resetModules();
	const commands = {
		fetchGeneralSettings: vi.fn(async () => jsonResponse(generalSettings)),
		fetchFxRates: vi.fn(async () => jsonResponse(null)),
		...overrides,
	};
	vi.doMock("../src/modules/settings/settingsCommands", () => commands);
	return {
		...(await import("../src/modules/settings/settings-resource-queries")),
		commands,
	};
}

describe("settings resource query options", () => {
	it("separates General and FX cache identities and forwards cancellation", async () => {
		const { commands, ...queries } = await loadQueries();
		const general = queries.generalSettingsQueryOptions();
		const fx = queries.fxRateCacheQueryOptions();
		expect(general.queryKey).toEqual(["settings", "general"]);
		expect(fx.queryKey).toEqual(["settings", "fx-rates"]);

		const controller = new AbortController();
		await expect(
			(general.queryFn as (context: { signal: AbortSignal }) => unknown)({
				signal: controller.signal,
			}),
		).resolves.toEqual(expect.objectContaining({ language: "ja" }));
		await expect(
			(fx.queryFn as (context: { signal: AbortSignal }) => unknown)({
				signal: controller.signal,
			}),
		).resolves.toBeNull();
		expect(commands.fetchGeneralSettings).toHaveBeenCalledWith({
			signal: controller.signal,
		});
		expect(commands.fetchFxRates).toHaveBeenCalledWith({
			signal: controller.signal,
		});
	});

	it("preserves typed failures instead of treating a JSON error body as a snapshot", async () => {
		const queries = await loadQueries({
			fetchGeneralSettings: vi.fn(async () =>
				jsonResponse(
					{ error: { code: "SETTINGS_UNAVAILABLE", message: "offline" } },
					503,
				),
			),
		});
		await expect(
			queries.fetchNormalizedGeneralSettings(),
		).rejects.toMatchObject({
			status: 503,
			code: "SETTINGS_UNAVAILABLE",
			message: "offline",
		});
	});
});
