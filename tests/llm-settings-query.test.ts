import { afterEach, describe, expect, it, vi } from "vitest";
import {
	fetchNormalizedLlmSettings,
	llmProviderModelOptionsQueryOptions,
	llmSettingsQueryKeys,
	llmSettingsQueryOptions,
	saveNormalizedLlmSettings,
} from "../src/modules/settings/llm-settings-query";

function response(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("LLM settings query contract", () => {
	it("uses one settings cache key and provider-scoped model option keys", () => {
		expect(llmSettingsQueryOptions().queryKey).toBe(
			llmSettingsQueryKeys.settings,
		);
		expect(llmProviderModelOptionsQueryOptions("codex").queryKey).toEqual([
			"llmSettings",
			"modelOptions",
			"codex",
		]);
	});

	it("normalizes partial settings and consumes the save snapshot", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				response({ ACTIVE_LLM_PROVIDER: "openai", OPENAI_MODEL: "gpt-test" }),
			)
			.mockResolvedValueOnce(
				response({ ACTIVE_LLM_PROVIDER: "codex", CODEX_MODEL: "codex-test" }),
			);
		vi.stubGlobal("fetch", fetchMock);

		await expect(fetchNormalizedLlmSettings()).resolves.toMatchObject({
			ACTIVE_LLM_PROVIDER: "openai",
			OPENAI_MODEL: "gpt-test",
			AZURE_OPENAI_DEPLOYMENT_NAME: "gpt-5-mini",
		});
		await expect(
			saveNormalizedLlmSettings({
				ACTIVE_LLM_PROVIDER: "azure",
			} as never),
		).resolves.toMatchObject({
			ACTIVE_LLM_PROVIDER: "codex",
			CODEX_MODEL: "codex-test",
		});
		expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});
