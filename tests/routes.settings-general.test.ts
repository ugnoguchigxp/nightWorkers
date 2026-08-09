import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../api/lib/types";
import { errorHandler } from "../api/middleware/error-handler";

const generalSettingsMocks = vi.hoisted(() => ({
	readGeneralSettings: vi.fn(),
	writeGeneralSettings: vi.fn(),
	readFxRateCache: vi.fn(),
	refreshEcbFxRates: vi.fn(),
}));

vi.mock("../api/services/settings/general-settings", () => ({
	readGeneralSettings: generalSettingsMocks.readGeneralSettings,
	writeGeneralSettings: generalSettingsMocks.writeGeneralSettings,
	readFxRateCache: generalSettingsMocks.readFxRateCache,
	refreshEcbFxRates: generalSettingsMocks.refreshEcbFxRates,
	validateTimezone: () => true,
	SUPPORTED_LANGUAGES: ["ja", "en"],
	SUPPORTED_CURRENCIES: ["JPY", "USD", "EUR"],
}));

const defaultPlanModeSettings = {
	capabilities: {
		feature_plan: true,
		questionnaire: true,
		user_flow: true,
		blueprint: true,
		data_model: true,
		api_io_contract: true,
		activity_flow: true,
		sequence_flow: true,
		zod_schema_design: true,
	},
};

const defaultLlmUsageSettings = {
	promptPartObservabilityEnabled: true,
};

const pricingMocks = vi.hoisted(() => ({
	listPricingRowsPage: vi.fn(),
	upsertPricingRow: vi.fn(),
	seedCodexPricingRows: vi.fn(),
	importPublicPricingRows: vi.fn(),
}));

vi.mock("../api/services/pricing", () => ({
	listPricingRowsPage: pricingMocks.listPricingRowsPage,
	upsertPricingRow: pricingMocks.upsertPricingRow,
	seedCodexPricingRows: pricingMocks.seedCodexPricingRows,
	importPublicPricingRows: pricingMocks.importPublicPricingRows,
}));

const llmMocks = vi.hoisted(() => ({
	callSupervisorLLM: vi.fn(),
}));

vi.mock("../api/services/structured-llm", () => ({
	callSupervisorLLM: llmMocks.callSupervisorLLM,
}));

const providerHealthMocks = vi.hoisted(() => ({
	checkStructuredLlmProviderExecutionReadiness: vi.fn(),
}));

vi.mock("../api/services/structured-llm/provider-health", () => ({
	checkStructuredLlmProviderExecutionReadiness:
		providerHealthMocks.checkStructuredLlmProviderExecutionReadiness,
}));

const codexStatusMocks = vi.hoisted(() => ({
	mergeCodexModelOptionsIntoEndpoints: vi
		.fn()
		.mockImplementation((endpoints) => endpoints),
	readCodexSdkStatus: vi.fn(),
	readCodexModelOptions: vi
		.fn()
		.mockReturnValue([{ value: "gpt-5.4-mini", label: "GPT-5.4-Mini" }]),
}));

vi.mock("../api/services/codex-global-config/status", () => ({
	mergeCodexModelOptionsIntoEndpoints:
		codexStatusMocks.mergeCodexModelOptionsIntoEndpoints,
	readCodexSdkStatus: codexStatusMocks.readCodexSdkStatus,
	readCodexModelOptions: codexStatusMocks.readCodexModelOptions,
}));

const runtimeSettingsMocks = vi.hoisted(() => ({
	getCurrentSettings: vi.fn().mockReturnValue({
		ACTIVE_LLM_PROVIDER: "openai",
		OPENAI_API_KEY: "sk-mock",
	}),
	writeRuntimeSettings: vi.fn(),
	applySettingsToProcessEnv: vi.fn(),
	maskLlmSettings: vi.fn().mockImplementation((s) => s),
	mergeMaskedSecrets: vi.fn().mockImplementation((input) => input),
}));

vi.mock("../api/routes/settings-runtime", async (importOriginal) => {
	const actual = (await importOriginal()) as never;
	return {
		...actual,
		getCurrentSettings: runtimeSettingsMocks.getCurrentSettings,
		writeRuntimeSettings: runtimeSettingsMocks.writeRuntimeSettings,
		applySettingsToProcessEnv: runtimeSettingsMocks.applySettingsToProcessEnv,
		maskLlmSettings: runtimeSettingsMocks.maskLlmSettings,
		mergeMaskedSecrets: runtimeSettingsMocks.mergeMaskedSecrets,
		providerModelOptions: {
			openai: ["gpt-4o", "gpt-4o-mini"],
		},
	};
});

import { settingsRouter } from "../api/routes/settings";

describe("general and LLM settings routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		codexStatusMocks.readCodexSdkStatus.mockReturnValue({
			loggedIn: true,
			authSource: "codex-auth-json",
			codexHome: "/tmp/codex-home",
			models: [{ value: "gpt-5.4-mini", label: "GPT-5.4-Mini" }],
			modelSource: "codex-models-cache",
			checkedAt: "2026-06-14T00:00:00.000Z",
		});
		codexStatusMocks.readCodexModelOptions.mockReturnValue([
			{ value: "gpt-5.4-mini", label: "GPT-5.4-Mini" },
		]);
		providerHealthMocks.checkStructuredLlmProviderExecutionReadiness.mockResolvedValue(
			{
				ok: true,
				reachable: true,
				providerEndpointId: "local-qwen",
				providerKind: "local",
				url: "http://localhost:11434/health",
				status: 200,
				durationMs: 12,
				checkedAt: "2026-06-16T00:00:00.000Z",
				message: "HTTP 200",
			},
		);
	});

	it("GET /api/settings/llm gets masked settings", async () => {
		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/settings", settingsRouter);

		const res = await app.request("/api/settings/llm", { method: "GET" });
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual({
			ACTIVE_LLM_PROVIDER: "openai",
			OPENAI_API_KEY: "sk-mock",
		});
	});

	it("POST /api/settings/llm saves settings", async () => {
		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/settings", settingsRouter);

		const res = await app.request("/api/settings/llm", {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify({
				ACTIVE_LLM_PROVIDER: "openai",
				OPENAI_ENABLED: true,
				AZURE_OPENAI_API_KEY: "",
				AZURE_OPENAI_ENABLED: false,
				AZURE_OPENAI_ENDPOINT: "",
				AZURE_OPENAI_DEPLOYMENT_NAME: "",
				AZURE_OPENAI_API_VERSION: "",
				AWS_BEDROCK_ENABLED: false,
				AWS_ACCESS_KEY_ID: "",
				AWS_SECRET_ACCESS_KEY: "",
				AWS_REGION: "",
				AWS_BEDROCK_MODEL: "",
				OPENAI_API_KEY: "new-key",
				OPENAI_BASE_URL: "",
				OPENAI_MODEL: "",
				CODEX_ENABLED: false,
				CODEX_ACCESS_TOKEN: "",
				CODEX_MODEL: "",
				IMPLEMENTATION_RUNTIME_LANE: "",
				SESSION_QUEUE_MAX_CONCURRENCY: 2,
				providerEndpoints: [
					{
						id: "local-qwen",
						name: "Local Qwen",
						kind: "local",
						enabled: true,
						apiKey: "",
						baseUrl: "http://localhost:11434/v1",
						endpoint: "",
						apiVersion: "",
						region: "",
						models: ["qwen3-coder-176k"],
						modelDisplayNames: {
							"qwen3-coder-176k": "Qwen Coder 176K",
						},
						defaultModelCapability: {
							contextWindowTokens: 180000,
							safePromptBudgetTokens: 176000,
							reservedOutputTokens: 4000,
							supportsProviderSideCompression: true,
							compressionProfile: "balanced",
						},
						modelCapabilities: {
							"qwen3-coder-176k": {
								contextWindowTokens: 180000,
								safePromptBudgetTokens: 176000,
								reservedOutputTokens: 4000,
								supportsProviderSideCompression: true,
								compressionProfile: "balanced",
							},
						},
					},
				],
				roleRoutes: [
					{
						role: "plan",
						primary: {
							providerEndpointId: "local-qwen",
							model: "qwen3-coder-176k",
							requestTimeoutSeconds: 1200,
						},
						fallbacks: [],
					},
				],
			}),
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual({ success: true });
		expect(runtimeSettingsMocks.writeRuntimeSettings).toHaveBeenCalled();
		expect(runtimeSettingsMocks.writeRuntimeSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				providerEndpoints: [
					expect.objectContaining({
						id: "local-qwen",
						defaultModelCapability: expect.objectContaining({
							contextWindowTokens: 180000,
							safePromptBudgetTokens: 176000,
						}),
						modelCapabilities: {
							"qwen3-coder-176k": expect.objectContaining({
								contextWindowTokens: 180000,
								safePromptBudgetTokens: 176000,
							}),
						},
					}),
				],
				roleRoutes: [
					expect.objectContaining({
						role: "plan",
						primary: expect.objectContaining({
							requestTimeoutSeconds: 1200,
						}),
					}),
				],
			}),
		);
		expect(runtimeSettingsMocks.applySettingsToProcessEnv).toHaveBeenCalled();
	});

	it("rejects role request timeouts above twenty minutes", async () => {
		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/settings", settingsRouter);

		const res = await app.request("/api/settings/llm", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				providerEndpoints: [
					{
						id: "local-qwen",
						name: "Local Qwen",
						kind: "local",
						enabled: true,
						models: ["qwen3-coder"],
					},
				],
				roleRoutes: [
					{
						role: "plan",
						primary: {
							providerEndpointId: "local-qwen",
							model: "qwen3-coder",
							requestTimeoutSeconds: 1201,
						},
						fallbacks: [],
					},
				],
			}),
		});

		expect(res.status).toBe(400);
		expect(runtimeSettingsMocks.writeRuntimeSettings).not.toHaveBeenCalled();
	});

	it("GET /api/settings/llm/models returns provider options", async () => {
		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/settings", settingsRouter);

		const res = await app.request("/api/settings/llm/models", {
			method: "GET",
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual({
			activeProvider: "openai",
			options: [
				{ value: "gpt-4o", label: "gpt-4o" },
				{ value: "gpt-4o-mini", label: "gpt-4o-mini" },
			],
		});
	});

	it("GET /api/settings/codex/status returns Codex SDK status", async () => {
		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/settings", settingsRouter);

		const res = await app.request("/api/settings/codex/status", {
			method: "GET",
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual({
			loggedIn: true,
			authSource: "codex-auth-json",
			codexHome: "/tmp/codex-home",
			models: [{ value: "gpt-5.4-mini", label: "GPT-5.4-Mini" }],
			modelSource: "codex-models-cache",
			checkedAt: "2026-06-14T00:00:00.000Z",
		});
		expect(codexStatusMocks.readCodexSdkStatus).toHaveBeenCalledWith({
			accessToken: undefined,
			configuredModel: undefined,
		});
	});

	it("GET /api/settings/general gets general settings", async () => {
		generalSettingsMocks.readGeneralSettings.mockReturnValue({
			timezone: "UTC",
			language: "en",
			currency: "USD",
			fx: {
				source: "ecb",
				autoRefresh: true,
				lastRefreshedAt: null,
			},
			planMode: defaultPlanModeSettings,
			llmUsage: defaultLlmUsageSettings,
		});

		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/settings", settingsRouter);

		const res = await app.request("/api/settings/general", { method: "GET" });
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual({
			timezone: "UTC",
			language: "en",
			currency: "USD",
			fx: {
				source: "ecb",
				autoRefresh: true,
				lastRefreshedAt: null,
			},
			planMode: defaultPlanModeSettings,
			llmUsage: defaultLlmUsageSettings,
		});
	});

	it("POST /api/settings/general saves general settings", async () => {
		generalSettingsMocks.writeGeneralSettings.mockReturnValue({
			timezone: "Asia/Tokyo",
			language: "ja",
			currency: "JPY",
			fx: {
				source: "ecb",
				autoRefresh: true,
				lastRefreshedAt: null,
			},
			planMode: {
				capabilities: {
					...defaultPlanModeSettings.capabilities,
					blueprint: false,
				},
			},
			llmUsage: {
				promptPartObservabilityEnabled: false,
			},
		});

		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/settings", settingsRouter);

		const res = await app.request("/api/settings/general", {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify({
				timezone: "Asia/Tokyo",
				language: "ja",
				currency: "JPY",
				fx: {
					source: "ecb",
					autoRefresh: true,
					lastRefreshedAt: null,
				},
				planMode: {
					capabilities: {
						...defaultPlanModeSettings.capabilities,
						blueprint: false,
					},
				},
				llmUsage: {
					promptPartObservabilityEnabled: false,
				},
			}),
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual({
			timezone: "Asia/Tokyo",
			language: "ja",
			currency: "JPY",
			fx: {
				source: "ecb",
				autoRefresh: true,
				lastRefreshedAt: null,
			},
			planMode: {
				capabilities: {
					...defaultPlanModeSettings.capabilities,
					blueprint: false,
				},
			},
			llmUsage: {
				promptPartObservabilityEnabled: false,
			},
		});
		expect(generalSettingsMocks.writeGeneralSettings).toHaveBeenCalledWith({
			timezone: "Asia/Tokyo",
			language: "ja",
			currency: "JPY",
			fx: {
				source: "ecb",
				autoRefresh: true,
				lastRefreshedAt: null,
			},
			planMode: {
				capabilities: {
					...defaultPlanModeSettings.capabilities,
					blueprint: false,
				},
			},
			llmUsage: {
				promptPartObservabilityEnabled: false,
			},
		});
	});

	it("POST /api/settings/general accepts settings without llmUsage for compatibility", async () => {
		generalSettingsMocks.writeGeneralSettings.mockReturnValue({
			timezone: "Asia/Tokyo",
			language: "ja",
			currency: "JPY",
			fx: {
				source: "ecb",
				autoRefresh: true,
				lastRefreshedAt: null,
			},
			planMode: defaultPlanModeSettings,
			llmUsage: defaultLlmUsageSettings,
		});

		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/settings", settingsRouter);

		const res = await app.request("/api/settings/general", {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify({
				timezone: "Asia/Tokyo",
				language: "ja",
				currency: "JPY",
				fx: {
					source: "ecb",
					autoRefresh: true,
					lastRefreshedAt: null,
				},
				planMode: defaultPlanModeSettings,
			}),
		});

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({
			llmUsage: defaultLlmUsageSettings,
		});
		expect(generalSettingsMocks.writeGeneralSettings).toHaveBeenCalledWith({
			timezone: "Asia/Tokyo",
			language: "ja",
			currency: "JPY",
			fx: {
				source: "ecb",
				autoRefresh: true,
				lastRefreshedAt: null,
			},
			planMode: defaultPlanModeSettings,
		});
	});

	it("GET /api/settings/fx gets cache", async () => {
		generalSettingsMocks.readFxRateCache.mockReturnValue({ EUR: 1, USD: 1.1 });

		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/settings", settingsRouter);

		const res = await app.request("/api/settings/fx", { method: "GET" });
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual({ EUR: 1, USD: 1.1 });
	});

	it("POST /api/settings/fx/refresh refreshes rates successfully", async () => {
		generalSettingsMocks.refreshEcbFxRates.mockResolvedValue({
			refreshed: true,
		});

		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/settings", settingsRouter);

		const res = await app.request("/api/settings/fx/refresh", {
			method: "POST",
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual({ refreshed: true });
	});

	it("POST /api/settings/fx/refresh handles ECB errors", async () => {
		generalSettingsMocks.refreshEcbFxRates.mockRejectedValue(
			new Error("ECB Down"),
		);

		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/settings", settingsRouter);

		const res = await app.request("/api/settings/fx/refresh", {
			method: "POST",
		});
		expect(res.status).toBe(500);
		const json = await res.json();
		expect(json).toEqual({ error: "ECB Down" });
	});

	it("GET /api/settings/pricing lists pricing rows", async () => {
		pricingMocks.listPricingRowsPage.mockResolvedValue({
			rows: [{ model: "gpt-4o" }],
			totalCount: 1,
			nextCursor: null,
		});

		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/settings", settingsRouter);

		const res = await app.request("/api/settings/pricing", { method: "GET" });
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual({
			rows: [{ model: "gpt-4o" }],
			totalCount: 1,
			nextCursor: null,
		});
		expect(pricingMocks.listPricingRowsPage).toHaveBeenCalledWith({
			provider: undefined,
			model: undefined,
			limit: 50,
			offset: 0,
		});
	});

	it("POST /api/settings/pricing saves pricing row", async () => {
		pricingMocks.upsertPricingRow.mockResolvedValue({
			model: "gpt-4o",
			saved: true,
		});

		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/settings", settingsRouter);

		const res = await app.request("/api/settings/pricing", {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify({ provider: "openai", model: "gpt-4o" }),
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual({ model: "gpt-4o", saved: true });
	});

	it("POST /api/settings/pricing/seed-codex seeds rows", async () => {
		pricingMocks.seedCodexPricingRows.mockResolvedValue({ seeded: 5 });

		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/settings", settingsRouter);

		const res = await app.request("/api/settings/pricing/seed-codex", {
			method: "POST",
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual({ seeded: 5 });
	});

	it("POST /api/settings/pricing/import-public imports public pricing rows", async () => {
		pricingMocks.importPublicPricingRows.mockResolvedValue({
			imported: 3,
			skipped: 1,
			providers: ["anthropic", "openai", "qwen"],
			rows: [{ provider: "openai", model: "gpt-5" }],
			fetchedAt: "2026-07-04T00:00:00.000Z",
			sourceUrl:
				"https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
		});

		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/settings", settingsRouter);

		const res = await app.request("/api/settings/pricing/import-public", {
			method: "POST",
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual({
			imported: 3,
			skipped: 1,
			providers: ["anthropic", "openai", "qwen"],
			rows: [{ provider: "openai", model: "gpt-5" }],
			fetchedAt: "2026-07-04T00:00:00.000Z",
			sourceUrl:
				"https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
		});
	});

	it("POST /api/settings/llm/smoke does smoke check (success)", async () => {
		llmMocks.callSupervisorLLM.mockResolvedValue("success message");

		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/settings", settingsRouter);

		const res = await app.request("/api/settings/llm/smoke", {
			method: "POST",
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual({
			ok: true,
			provider: "openai",
			message: "smoke ok",
		});
	});

	it("POST /api/settings/llm/smoke does smoke check (failure)", async () => {
		llmMocks.callSupervisorLLM.mockRejectedValue(new Error("API failure"));

		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/settings", settingsRouter);

		const res = await app.request("/api/settings/llm/smoke", {
			method: "POST",
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual({
			ok: false,
			provider: "openai",
			message: "API failure",
		});
	});

	it("POST /api/settings/llm/providers/:id/health checks provider endpoint health", async () => {
		runtimeSettingsMocks.getCurrentSettings.mockReturnValueOnce({
			ACTIVE_LLM_PROVIDER: "openai",
			providerEndpoints: [
				{
					id: "local-qwen",
					name: "Local Qwen",
					kind: "local",
					enabled: true,
					baseUrl: "http://localhost:11434/v1",
					models: ["qwen3-coder"],
				},
			],
		});

		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/settings", settingsRouter);

		const res = await app.request(
			"/api/settings/llm/providers/local-qwen/health",
			{
				method: "POST",
			},
		);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toMatchObject({
			ok: true,
			reachable: true,
			providerEndpointId: "local-qwen",
			providerKind: "local",
			status: 200,
		});
		expect(
			providerHealthMocks.checkStructuredLlmProviderExecutionReadiness,
		).toHaveBeenCalledWith(
			expect.objectContaining({ id: "local-qwen", kind: "local" }),
		);
	});

	it("POST /api/settings/llm/providers/:id/health can check request body endpoint values", async () => {
		runtimeSettingsMocks.getCurrentSettings.mockReturnValueOnce({
			ACTIVE_LLM_PROVIDER: "openai",
			providerEndpoints: [],
		});

		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/settings", settingsRouter);

		const res = await app.request(
			"/api/settings/llm/providers/unsaved-local/health",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					endpoint: {
						id: "unsaved-local",
						name: "Unsaved Local",
						kind: "local",
						enabled: true,
						baseUrl: "http://localhost:11434/v1",
						models: ["qwen3-coder"],
					},
				}),
			},
		);
		expect(res.status).toBe(200);
		expect(
			providerHealthMocks.checkStructuredLlmProviderExecutionReadiness,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "unsaved-local",
				baseUrl: "http://localhost:11434/v1",
			}),
		);
	});

	it("POST /api/settings/llm/providers/:id/health preserves masked saved endpoint API keys", async () => {
		runtimeSettingsMocks.getCurrentSettings.mockReturnValueOnce({
			ACTIVE_LLM_PROVIDER: "openai",
			providerEndpoints: [
				{
					id: "azure-default",
					name: "Azure OpenAI",
					kind: "azure",
					enabled: true,
					apiKey: "real-azure-key",
					endpoint: "https://example.openai.azure.com/",
					apiVersion: "2025-04-01-preview",
					models: ["gpt-5-4-mini"],
				},
			],
		});

		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/settings", settingsRouter);

		const res = await app.request(
			"/api/settings/llm/providers/azure-default/health",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					endpoint: {
						id: "azure-default",
						name: "Azure OpenAI",
						kind: "azure",
						enabled: true,
						apiKey: "********",
						endpoint: "https://example.openai.azure.com/",
						apiVersion: "2025-04-01-preview",
						models: ["gpt-5-4-mini"],
					},
				}),
			},
		);

		expect(res.status).toBe(200);
		expect(
			providerHealthMocks.checkStructuredLlmProviderExecutionReadiness,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "azure-default",
				apiKey: "real-azure-key",
				apiVersion: "2025-04-01-preview",
			}),
		);
	});

	it("POST /api/settings/llm/providers/:id/health returns 404 for unknown endpoint", async () => {
		runtimeSettingsMocks.getCurrentSettings.mockReturnValueOnce({
			ACTIVE_LLM_PROVIDER: "openai",
			providerEndpoints: [],
		});

		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/settings", settingsRouter);

		const res = await app.request(
			"/api/settings/llm/providers/missing/health",
			{
				method: "POST",
			},
		);
		expect(res.status).toBe(404);
		expect(
			providerHealthMocks.checkStructuredLlmProviderExecutionReadiness,
		).not.toHaveBeenCalled();
	});
});
