import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "../src/i18n/setup";
import type { LlmSettings } from "../src/modules/nightworkers/types";
import { SettingsLlmPanel } from "../src/modules/settings/SettingsLlmPanel";

function createDummySettings(): LlmSettings {
	return {
		ACTIVE_LLM_PROVIDER: "openai",
		AZURE_OPENAI_ENABLED: false,
		AZURE_OPENAI_API_KEY: "",
		AZURE_OPENAI_ENDPOINT: "",
		AZURE_OPENAI_DEPLOYMENT_NAME: "",
		AZURE_OPENAI_API_VERSION: "",
		OPENAI_ENABLED: true,
		OPENAI_API_KEY: "test-key",
		OPENAI_BASE_URL: "",
		OPENAI_MODEL: "gpt-4",
		AWS_BEDROCK_ENABLED: false,
		AWS_ACCESS_KEY_ID: "",
		AWS_SECRET_ACCESS_KEY: "",
		AWS_REGION: "",
		AWS_BEDROCK_MODEL: "",
		CODEX_ENABLED: false,
		CODEX_ACCESS_TOKEN: "",
		CODEX_MODEL: "",
		IMPLEMENTATION_RUNTIME_LANE: "codex-agent",
		SESSION_QUEUE_MAX_CONCURRENCY: 1,
		providerEndpoints: [
			{
				id: "openai-endpoint",
				kind: "openai",
				name: "OpenAI",
				enabled: true,
				models: ["gpt-4", "gpt-3.5-turbo"],
				createdAt: "2026-07-08T00:00:00Z",
				updatedAt: "2026-07-08T00:00:00Z",
			},
			{
				id: "codex-endpoint",
				kind: "codex",
				name: "Codex",
				enabled: true,
				models: ["codex-model"],
				createdAt: "2026-07-08T00:00:00Z",
				updatedAt: "2026-07-08T00:00:00Z",
			},
		],
		roleRoutes: [
			{
				role: "plan",
				primary: { providerEndpointId: "openai-endpoint", model: "gpt-4" },
				fallbacks: [],
			},
			{
				role: "implementation",
				primary: { providerEndpointId: "openai-endpoint", model: "gpt-4" },
				fallbacks: [],
			},
		],
	};
}

describe("SettingsLlmPanel", () => {
	it("renders providers section and lists LLM provider endpoints", () => {
		const settings = createDummySettings();
		const markup = renderToStaticMarkup(
			<SettingsLlmPanel
				section="providers"
				settings={settings}
				isSaving={false}
				saveStatus="idle"
				saveMessage=""
				onChange={() => undefined}
				handleSave={async () => undefined}
			/>,
		);

		expect(markup).toContain("OpenAI");
		expect(markup).toContain("Codex");
	});

	it("renders routing section and displays role route selectors", () => {
		const settings = createDummySettings();
		const markup = renderToStaticMarkup(
			<SettingsLlmPanel
				section="routing"
				settings={settings}
				isSaving={false}
				saveStatus="idle"
				saveMessage=""
				onChange={() => undefined}
				handleSave={async () => undefined}
			/>,
		);

		expect(markup).toContain("plan");
		expect(markup).toContain("implementation");
	});
});
