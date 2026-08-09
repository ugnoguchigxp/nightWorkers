import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

function isolatedSettingsPath() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nightworkers-settings-"));
	return path.join(dir, "llm-settings.json");
}

async function importSettingsRoute() {
	vi.resetModules();
	vi.stubEnv("NIGHTWORKERS_LLM_SETTINGS_PATH", isolatedSettingsPath());
	return import("../api/routes/settings");
}

async function importSettingsRuntimeWithPath(settingsPath: string) {
	vi.resetModules();
	vi.stubEnv("NIGHTWORKERS_LLM_SETTINGS_PATH", settingsPath);
	return import("../api/routes/settings-runtime");
}

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe("LLM settings secret hardening", () => {
	it("exposes fresh Codex cache models to runtime routing without a settings GET", async () => {
		const settingsPath = isolatedSettingsPath();
		const codexHome = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-runtime-codex-models-"),
		);
		fs.writeFileSync(
			path.join(codexHome, "models_cache.json"),
			JSON.stringify({
				models: [{ slug: "gpt-5.6-sol", display_name: "GPT-5.6-Sol" }],
			}),
		);
		fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
		fs.writeFileSync(
			settingsPath,
			JSON.stringify({
				CODEX_MODEL: "gpt-5.4-mini",
				providerEndpoints: [
					{
						id: "codex-default",
						name: "Codex SDK",
						kind: "codex",
						enabled: true,
						models: ["gpt-5.4-mini"],
					},
				],
			}),
		);
		vi.stubEnv("NIGHTWORKERS_LLM_SETTINGS_PATH", settingsPath);
		vi.stubEnv("NIGHTWORKERS_CODEX_HOME", codexHome);
		const { readStructuredLlmProviderSettings } = await import(
			"../api/services/structured-llm/settings"
		);

		const runtimeSettings = readStructuredLlmProviderSettings();
		const codexEndpoint = runtimeSettings.providerEndpoints?.find(
			(endpoint) => endpoint.kind === "codex",
		);
		expect(codexEndpoint?.models).toContain("gpt-5.6-sol");
		expect(codexEndpoint?.modelDisplayNames?.["gpt-5.6-sol"]).toBe(
			"GPT-5.6-Sol",
		);
	});

	it("merges fresh Codex cache models into persisted Codex endpoints", async () => {
		const settingsPath = isolatedSettingsPath();
		const codexHome = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-codex-models-"),
		);
		fs.writeFileSync(
			path.join(codexHome, "models_cache.json"),
			JSON.stringify({
				models: [{ slug: "gpt-5.6-sol", display_name: "GPT-5.6-Sol" }],
			}),
		);
		fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
		fs.writeFileSync(
			settingsPath,
			JSON.stringify({
				ACTIVE_LLM_PROVIDER: "codex",
				CODEX_ENABLED: true,
				CODEX_MODEL: "gpt-5.4-mini",
				providerEndpoints: [
					{
						id: "codex-default",
						name: "Codex SDK",
						kind: "codex",
						enabled: true,
						models: ["gpt-5.4-mini"],
						modelDisplayNames: {},
					},
				],
				roleRoutes: [
					{
						role: "implementation",
						primary: {
							providerEndpointId: "codex-default",
							model: "gpt-5.6-sol",
						},
						fallbacks: [],
					},
				],
			}),
		);
		vi.stubEnv("NIGHTWORKERS_CODEX_HOME", codexHome);
		const { getCurrentSettings } =
			await importSettingsRuntimeWithPath(settingsPath);

		const settings = getCurrentSettings();
		const codexEndpoint = settings.providerEndpoints.find(
			(endpoint) => endpoint.kind === "codex",
		);
		const implementationRoute = settings.roleRoutes.find(
			(route) => route.role === "implementation",
		);

		expect(codexEndpoint?.models).toContain("gpt-5.6-sol");
		expect(codexEndpoint?.modelDisplayNames?.["gpt-5.6-sol"]).toBe(
			"GPT-5.6-Sol",
		);
		expect(implementationRoute?.primary.model).toBe("gpt-5.6-sol");
		expect(implementationRoute?.primary.providerEndpointId).toBe(
			codexEndpoint?.id,
		);
		const persistedSettings = JSON.parse(
			fs.readFileSync(settingsPath, "utf8"),
		) as {
			providerEndpoints?: Array<{ kind?: string; models?: string[] }>;
		};
		expect(
			persistedSettings.providerEndpoints?.find(
				(endpoint) => endpoint.kind === "codex",
			)?.models,
		).toContain("gpt-5.6-sol");
		const { readStructuredLlmProviderSettings } = await import(
			"../api/services/structured-llm/settings"
		);
		expect(
			readStructuredLlmProviderSettings().providerEndpoints?.find(
				(endpoint) => endpoint.kind === "codex",
			)?.models,
		).toContain("gpt-5.6-sol");
	});

	it("persists endpoint id migration when an existing settings file is loaded", async () => {
		const settingsPath = isolatedSettingsPath();
		fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
		fs.writeFileSync(
			settingsPath,
			JSON.stringify({
				ACTIVE_LLM_PROVIDER: "openai",
				OPENAI_ENABLED: true,
				OPENAI_API_KEY: "existing-openai-secret",
				providerEndpoints: [
					{
						id: "bedrock-default",
						name: "Qwen Local",
						kind: "local",
						enabled: true,
						apiKey: "",
						baseUrl: "http://localhost:11434/v1",
						endpoint: "",
						apiVersion: "",
						region: "",
						models: ["qwen3-coder"],
						modelDisplayNames: {},
					},
				],
				roleRoutes: [
					{
						role: "implementation",
						primary: {
							providerEndpointId: "bedrock-default",
							model: "qwen3-coder",
						},
						fallbacks: [],
					},
				],
			}),
		);
		const { getCurrentSettings } =
			await importSettingsRuntimeWithPath(settingsPath);

		const settings = getCurrentSettings();
		const persisted = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as {
			OPENAI_API_KEY?: string;
			providerEndpoints: Array<{ id: string }>;
			roleRoutes: Array<{ primary: { providerEndpointId: string } }>;
		};

		const migratedRouteEndpointId =
			persisted.roleRoutes[0]?.primary.providerEndpointId;
		expect(migratedRouteEndpointId).toMatch(/^ep_[0-9a-f]{16}$/);
		expect(
			persisted.providerEndpoints.some(
				(endpoint) => endpoint.id === migratedRouteEndpointId,
			),
		).toBe(true);
		expect(
			settings.providerEndpoints.some(
				(endpoint) => endpoint.id === migratedRouteEndpointId,
			),
		).toBe(true);
		expect(persisted.OPENAI_API_KEY).toBe("existing-openai-secret");
	});

	it("does not append migrated legacy default endpoints on repeated settings reads", async () => {
		const settingsPath = isolatedSettingsPath();
		fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
		fs.writeFileSync(
			settingsPath,
			JSON.stringify({
				ACTIVE_LLM_PROVIDER: "codex",
				CODEX_ENABLED: true,
				CODEX_MODEL: "gpt-5.4-mini",
				providerEndpoints: [
					{
						id: "codex-default",
						name: "Codex SDK",
						kind: "codex",
						enabled: true,
						apiKey: "",
						baseUrl: "",
						endpoint: "",
						apiVersion: "",
						region: "",
						models: [
							"gpt-5.4-mini",
							"gpt-5.5",
							"gpt-5.4",
							"gpt-5.3-codex-spark",
							"codex-auto-review",
							"gpt-5-mini",
						],
						modelDisplayNames: {},
					},
				],
				roleRoutes: [
					{
						role: "implementation",
						primary: {
							providerEndpointId: "codex-default",
							model: "gpt-5.4-mini",
						},
						fallbacks: [],
					},
				],
			}),
		);
		const { getCurrentSettings } =
			await importSettingsRuntimeWithPath(settingsPath);

		const first = getCurrentSettings();
		const firstPersisted = JSON.parse(
			fs.readFileSync(settingsPath, "utf-8"),
		) as {
			providerEndpoints: Array<{
				id: string;
				name: string;
				kind: string;
				models: string[];
			}>;
		};
		const second = getCurrentSettings();
		const secondPersisted = JSON.parse(
			fs.readFileSync(settingsPath, "utf-8"),
		) as {
			providerEndpoints: Array<{
				id: string;
				name: string;
				kind: string;
				models: string[];
			}>;
		};

		const endpointKey = (endpoint: { name: string; kind: string }) =>
			`${endpoint.kind}\u0000${endpoint.name}`;

		expect(second.providerEndpoints).toHaveLength(
			first.providerEndpoints.length,
		);
		expect(secondPersisted.providerEndpoints).toHaveLength(
			firstPersisted.providerEndpoints.length,
		);
		expect(
			new Set(secondPersisted.providerEndpoints.map(endpointKey)).size,
		).toBe(secondPersisted.providerEndpoints.length);
	});

	it("heals persisted role routes that point at removed endpoints", async () => {
		const settingsPath = isolatedSettingsPath();
		fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
		fs.writeFileSync(
			settingsPath,
			JSON.stringify({
				ACTIVE_LLM_PROVIDER: "codex",
				CODEX_ENABLED: true,
				CODEX_MODEL: "gpt-5.4-mini",
				providerEndpoints: [
					{
						id: "codex-main",
						name: "Codex SDK",
						kind: "codex",
						enabled: true,
						apiKey: "",
						baseUrl: "",
						endpoint: "",
						apiVersion: "",
						region: "",
						models: ["gpt-5.4-mini"],
						modelDisplayNames: {},
					},
				],
				roleRoutes: [
					{
						role: "evaluation",
						primary: {
							providerEndpointId: "deleted-evaluation-endpoint",
							model: "gpt-5.4-mini",
						},
						fallbacks: [],
					},
				],
			}),
		);
		const { getCurrentSettings } =
			await importSettingsRuntimeWithPath(settingsPath);

		const settings = getCurrentSettings();
		const persisted = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as {
			roleRoutes: Array<{
				role: string;
				primary: { providerEndpointId: string; model: string };
			}>;
		};
		const evaluationRoute = settings.roleRoutes.find(
			(route) => route.role === "evaluation",
		);
		const persistedEvaluationRoute = persisted.roleRoutes.find(
			(route) => route.role === "evaluation",
		);

		expect(evaluationRoute?.primary).toEqual({
			providerEndpointId: "codex-main",
			model: "gpt-5.4-mini",
			thinkingDepth: "",
		});
		expect(persistedEvaluationRoute?.primary.providerEndpointId).toBe(
			"codex-main",
		);
	});

	it("masks configured secrets before returning settings to clients", async () => {
		const { maskLlmSettings } = await importSettingsRoute();

		const masked = maskLlmSettings({
			ACTIVE_LLM_PROVIDER: "openai",
			OPENAI_ENABLED: true,
			AZURE_OPENAI_ENABLED: true,
			AZURE_OPENAI_API_KEY: "azure-secret",
			AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com/",
			AZURE_OPENAI_DEPLOYMENT_NAME: "gpt-5-mini",
			AZURE_OPENAI_API_VERSION: "2024-05-01-preview",
			AWS_BEDROCK_ENABLED: true,
			AWS_ACCESS_KEY_ID: "aws-key-id",
			AWS_SECRET_ACCESS_KEY: "aws-secret",
			AWS_REGION: "us-east-1",
			AWS_BEDROCK_MODEL: "anthropic.claude-3-5-sonnet-20241022-v2:0",
			OPENAI_API_KEY: "openai-secret",
			OPENAI_BASE_URL: "https://api.openai.com/v1",
			OPENAI_MODEL: "gpt-5-mini",
			CODEX_ENABLED: true,
			CODEX_ACCESS_TOKEN: "codex-secret",
			CODEX_MODEL: "gpt-5.3-codex",
			SESSION_QUEUE_MAX_CONCURRENCY: 2,
		});

		expect(masked.AZURE_OPENAI_API_KEY).toBe("********");
		expect(masked.AWS_SECRET_ACCESS_KEY).toBe("********");
		expect(masked.OPENAI_API_KEY).toBe("********");
		expect(masked.CODEX_ACCESS_TOKEN).toBe("********");
		expect(masked.AWS_ACCESS_KEY_ID).toBe("aws-key-id");
	}, 15_000);

	it("preserves existing secrets when clients save masked values", async () => {
		const { mergeMaskedSecrets } = await importSettingsRoute();
		const current = {
			ACTIVE_LLM_PROVIDER: "openai",
			OPENAI_ENABLED: true,
			AZURE_OPENAI_ENABLED: true,
			AZURE_OPENAI_API_KEY: "existing-azure-secret",
			AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com/",
			AZURE_OPENAI_DEPLOYMENT_NAME: "gpt-5-mini",
			AZURE_OPENAI_API_VERSION: "2024-05-01-preview",
			AWS_BEDROCK_ENABLED: true,
			AWS_ACCESS_KEY_ID: "aws-key-id",
			AWS_SECRET_ACCESS_KEY: "existing-aws-secret",
			AWS_REGION: "us-east-1",
			AWS_BEDROCK_MODEL: "anthropic.claude-3-5-sonnet-20241022-v2:0",
			OPENAI_API_KEY: "existing-openai-secret",
			OPENAI_BASE_URL: "https://api.openai.com/v1",
			OPENAI_MODEL: "gpt-5-mini",
			CODEX_ENABLED: true,
			CODEX_ACCESS_TOKEN: "existing-codex-secret",
			CODEX_MODEL: "gpt-5.3-codex",
			SESSION_QUEUE_MAX_CONCURRENCY: 2,
			providerEndpoints: [
				{
					id: "local-endpoint",
					name: "Local LLM",
					kind: "local" as const,
					enabled: true,
					apiKey: "existing-local-secret",
					baseUrl: "http://localhost:8080/v1",
					models: ["local-model"],
				},
			],
		};

		const merged = mergeMaskedSecrets(
			{
				...current,
				OPENAI_MODEL: "gpt-5.4-mini",
				AZURE_OPENAI_API_KEY: "********",
				AWS_SECRET_ACCESS_KEY: "********",
				OPENAI_API_KEY: "new-openai-secret",
				CODEX_ACCESS_TOKEN: "********",
				providerEndpoints: current.providerEndpoints.map((endpoint) => ({
					...endpoint,
					apiKey: "********",
				})),
			},
			current,
		);

		expect(merged.AZURE_OPENAI_API_KEY).toBe("existing-azure-secret");
		expect(merged.AWS_SECRET_ACCESS_KEY).toBe("existing-aws-secret");
		expect(merged.OPENAI_API_KEY).toBe("new-openai-secret");
		expect(merged.CODEX_ACCESS_TOKEN).toBe("existing-codex-secret");
		expect(merged.OPENAI_MODEL).toBe("gpt-5.4-mini");
		expect(merged.providerEndpoints[0]?.apiKey).toBe("existing-local-secret");
	});
});

describe("Desktop security configuration", () => {
	function stubDesktopEnv() {
		const runtimeDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-desktop-security-"),
		);
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("NIGHTWORKERS_DATABASE_ACCESS_SCOPE", "operational");
		vi.stubEnv("NIGHTWORKERS_DESKTOP", "1");
		vi.stubEnv("NIGHTWORKERS_RUNTIME_DIR", runtimeDir);
		vi.stubEnv("NIGHTWORKERS_API_ORIGIN", "http://127.0.0.1:41234");
		vi.stubEnv("DATABASE_URL", undefined);
		vi.stubEnv("CORS_ORIGIN", "");
		return runtimeDir;
	}

	it("derives explicit desktop origins during first-run bootstrap", async () => {
		stubDesktopEnv();
		vi.resetModules();

		const { config } = await import("../api/config");

		expect(config.CORS_ORIGINS).toEqual([
			"http://127.0.0.1:41234",
			"http://tauri.localhost",
			"tauri://localhost",
		]);
		expect(config.DATABASE_URL).toContain("/sqlite.db");
	});

	it("allows desktop REST and WebSocket origins in production CSP", async () => {
		stubDesktopEnv();
		vi.resetModules();

		const { default: app } = await import("../api/app");
		const response = await app.request("/api/health/live", {
			headers: { Origin: "http://tauri.localhost" },
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("access-control-allow-origin")).toBe(
			"http://tauri.localhost",
		);
		const csp = response.headers.get("content-security-policy") || "";
		expect(csp).toContain("http://127.0.0.1:41234");
		expect(csp).toContain("ws://127.0.0.1:41234");
		expect(csp).toContain("http://tauri.localhost");
		expect(csp).toContain("tauri:");
	}, 15_000);
});
