import { describe, expect, it } from "vitest";
import {
	resolveStructuredLlmRoleRoute,
	structuredLlmRouteKey,
	validateStructuredLlmRoleRoutes,
} from "../../api/services/structured-llm/role-routing";
import type { StructuredLlmProviderSettings } from "../../api/services/structured-llm/settings";

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
