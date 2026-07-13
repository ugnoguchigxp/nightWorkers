import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	GeneralSettings,
	LlmProviderEndpoint,
	LlmSettings,
} from "../src/modules/nightworkers/types";
import {
	fetchCodexSdkStatus,
	fetchFxRates,
	fetchGeneralSettings,
	fetchLlmModelOptions,
	fetchLlmSettings,
	fetchPricingRows,
	importPublicPricingRows,
	refreshFxRates,
	runLlmSmokeTest,
	saveGeneralSettings,
	saveLlmSettings,
	testLlmProviderHealth,
} from "../src/modules/settings/settingsCommands";

function stubFetch() {
	const fetchMock = vi.fn<typeof fetch>(() =>
		Promise.resolve(new Response("{}")),
	);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

describe("settingsCommands", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("routes read commands through the expected settings endpoints", async () => {
		const fetchMock = stubFetch();
		const init = { signal: AbortSignal.timeout(1000) };

		await fetchLlmSettings();
		await fetchGeneralSettings(init);
		await fetchFxRates();
		await fetchPricingRows({
			provider: "openai",
			model: "gpt 5",
			limit: 100,
			cursor: "200",
		});
		await fetchLlmModelOptions();
		await fetchCodexSdkStatus();

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"/api/settings/llm",
			undefined,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/settings/general", init);
		expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/settings/fx", undefined);
		expect(fetchMock).toHaveBeenNthCalledWith(
			4,
			"/api/settings/pricing?provider=openai&model=gpt+5&limit=100&cursor=200",
			undefined,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			5,
			"/api/settings/llm/models",
			undefined,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			6,
			"/api/settings/codex/status",
			undefined,
		);
	});

	it("sends settings mutations with the expected method and JSON body", async () => {
		const fetchMock = stubFetch();
		const llmSettings = {
			ACTIVE_LLM_PROVIDER: "openai",
		} as unknown as LlmSettings;
		const generalSettings = {
			WORKSPACE_APPEARANCE: "system",
		} as unknown as GeneralSettings;
		await saveLlmSettings(llmSettings);
		await saveGeneralSettings(generalSettings);
		await refreshFxRates();
		await importPublicPricingRows();
		await runLlmSmokeTest();

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"/api/settings/llm",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify(llmSettings),
			}),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"/api/settings/general",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify(generalSettings),
			}),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/settings/fx/refresh", {
			method: "POST",
		});
		expect(fetchMock).toHaveBeenNthCalledWith(
			4,
			"/api/settings/pricing/import-public",
			{ method: "POST" },
		);
		expect(fetchMock).toHaveBeenNthCalledWith(5, "/api/settings/llm/smoke", {
			method: "POST",
		});
	});

	it("encodes provider health ids and includes endpoint override payloads", async () => {
		const fetchMock = stubFetch();
		const endpoint = {
			id: "provider one",
			kind: "openai",
			name: "Provider One",
			enabled: true,
			models: ["gpt-test"],
			createdAt: "2026-07-08T00:00:00Z",
			updatedAt: "2026-07-08T00:00:00Z",
		} satisfies LlmProviderEndpoint;

		await testLlmProviderHealth("provider one", endpoint);
		await testLlmProviderHealth("codex");

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"/api/settings/llm/providers/provider%20one/health",
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ endpoint }),
			}),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"/api/settings/llm/providers/codex/health",
			{ method: "POST" },
		);
	});
});
