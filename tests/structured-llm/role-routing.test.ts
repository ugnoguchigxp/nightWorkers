import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	readApplicationSettingSecrets,
	writeApplicationSettingBundle,
} from "../../api/services/settings/application-settings-store";
import {
	resolveStructuredLlmRoleRoute,
	structuredLlmRouteKey,
	validateStructuredLlmRoleRoutes,
} from "../../api/services/structured-llm/role-routing";
import {
	readStructuredLlmProviderSettings,
	type StructuredLlmProviderSettings,
} from "../../api/services/structured-llm/settings";

function createDummySettings(): StructuredLlmProviderSettings {
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
				name: "OpenAI Endpoint",
				enabled: true,
				models: ["gpt-4"],
				createdAt: "2026-07-08T00:00:00Z",
				updatedAt: "2026-07-08T00:00:00Z",
			},
			{
				id: "azure-endpoint",
				kind: "azure",
				name: "Azure Endpoint",
				enabled: true,
				models: ["gpt-4-azure"],
				createdAt: "2026-07-08T00:00:00Z",
				updatedAt: "2026-07-08T00:00:00Z",
			},
		],
		roleRoutes: [
			{
				role: "plan",
				primary: { providerEndpointId: "openai-endpoint", model: "gpt-4" },
				fallbacks: [
					{ providerEndpointId: "azure-endpoint", model: "gpt-4-azure" },
				],
			},
		],
	};
}

describe("Structured LLM Role Routing", () => {
	it("restores top-level and endpoint secrets from SQLite", async () => {
		await writeApplicationSettingBundle(
			"llm",
			{
				OPENAI_ENABLED: true,
				providerEndpoints: [
					{
						id: "secret-endpoint",
						name: "Secret endpoint",
						kind: "openai",
						enabled: true,
						apiKey: "",
						models: ["gpt-test"],
					},
				],
			},
			{
				OPENAI_API_KEY: "top-level-secret",
				providerEndpointApiKeys: {
					"secret-endpoint": "endpoint-secret",
				},
			},
		);
		expect(readApplicationSettingSecrets("llm")).toMatchObject({
			OPENAI_API_KEY: "top-level-secret",
		});

		const settings = readStructuredLlmProviderSettings();

		expect(settings.OPENAI_API_KEY).toBe("top-level-secret");
		expect(settings.providerEndpoints?.[0]?.apiKey).toBe("endpoint-secret");
		expect(settings).not.toHaveProperty("providerEndpointApiKeys");
	});

	it("structuredLlmRouteKey returns correctly formatted key string", () => {
		const key = structuredLlmRouteKey({
			providerEndpointId: "ep-1",
			model: "gpt-4",
			providerId: "openai",
		});
		expect(key).toBe("ep-1::gpt-4::openai");
	});

	it("resolveStructuredLlmRoleRoute finds primary candidate when allowed by policy", () => {
		const settings = createDummySettings();
		const result = resolveStructuredLlmRoleRoute({
			role: "plan",
			settings,
		});

		expect(result).not.toBeNull();
		expect(result?.model).toBe("gpt-4");
		expect(result?.providerEndpointId).toBe("openai-endpoint");
		expect(result?.providerId).toBe("openai");
	});

	it("resolves the dedicated Mission Pilot route", () => {
		const settings = createDummySettings();
		settings.roleRoutes?.push({
			role: "mission_pilot",
			primary: { providerEndpointId: "azure-endpoint", model: "gpt-4-azure" },
			fallbacks: [],
		});

		const result = resolveStructuredLlmRoleRoute({
			role: "mission_pilot",
			settings,
		});

		expect(result?.providerEndpointId).toBe("azure-endpoint");
		expect(result?.role).toBe("mission_pilot");
	});

	it("canonicalizes persisted legacy roles for direct structured LLM reads", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-role-routing-"));
		const settingsPath = path.join(tempDir, "llm-settings.json");
		const previousPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
		try {
			fs.writeFileSync(
				settingsPath,
				JSON.stringify({
					providerEndpoints: [
						{
							id: "test-endpoint",
							name: "Test",
							kind: "openai",
							enabled: true,
							models: ["test-model"],
						},
						{
							id: "quality-endpoint",
							name: "Quality",
							kind: "openai",
							enabled: true,
							models: ["quality-model"],
						},
					],
					roleRoutes: [
						{
							role: "test",
							primary: {
								providerEndpointId: "test-endpoint",
								model: "test-model",
							},
							fallbacks: [],
						},
						{
							role: "quality_gate",
							primary: {
								providerEndpointId: "quality-endpoint",
								model: "quality-model",
							},
							fallbacks: [],
						},
					],
				}),
			);
			process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = settingsPath;

			const settings = readStructuredLlmProviderSettings();
			const testRoute = settings.roleRoutes?.find(
				(route) => route.role === "test",
			);

			expect(testRoute).toMatchObject({
				primary: {
					providerEndpointId: "test-endpoint",
					model: "test-model",
				},
				fallbacks: [
					{
						providerEndpointId: "quality-endpoint",
						model: "quality-model",
					},
				],
			});
			expect(settings.roleRoutes?.map((route) => route.role)).not.toContain(
				"quality_gate",
			);
		} finally {
			if (previousPath === undefined) {
				delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
			} else {
				process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = previousPath;
			}
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("resolveStructuredLlmRoleRoute returns fallback when primary is disallowed by policy", () => {
		const settings = createDummySettings();
		const result = resolveStructuredLlmRoleRoute({
			role: "plan",
			settings,
			policy: {
				disallowedProviderIds: ["openai"],
			},
		});

		expect(result).not.toBeNull();
		expect(result?.model).toBe("gpt-4-azure");
		expect(result?.providerId).toBe("azure-openai");
	});

	it("resolveStructuredLlmRoleRoute returns override target immediately", () => {
		const settings = createDummySettings();
		const result = resolveStructuredLlmRoleRoute({
			role: "plan",
			settings,
			override: {
				providerEndpointId: "openai-endpoint",
				model: "gpt-4",
			},
		});

		expect(result).not.toBeNull();
		expect(result?.model).toBe("gpt-4");
	});

	it("validateStructuredLlmRoleRoutes detects configuration issues", () => {
		const settings = createDummySettings();
		// Add broken route
		settings.roleRoutes.push({
			role: "implementation",
			primary: { providerEndpointId: "missing-endpoint", model: "gpt-4" },
			fallbacks: [],
		});

		const issues = validateStructuredLlmRoleRoutes({ settings });
		expect(issues).toHaveLength(1);
		expect(issues[0].reason).toBe("missing_endpoint");
		expect(issues[0].providerEndpointId).toBe("missing-endpoint");
	});
});
