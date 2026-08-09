import { describe, expect, it } from "vitest";
import { canonicalizeStructuredLlmEndpoint } from "../../api/services/structured-llm/endpoint-target";
import {
	buildProviderHealthUrl,
	buildStructuredLlmProviderTargetMetadata,
} from "../../api/services/structured-llm/provider-health";
import { buildNormalizedSupervisorLlmRequest } from "../../api/services/structured-llm/request";
import type { StructuredLlmProviderSettings } from "../../api/services/structured-llm/settings";

describe("API lane endpoint canonicalization", () => {
	it("migrates legacy fields once according to provider kind", () => {
		const local = canonicalizeStructuredLlmEndpoint({
			kind: "local" as const,
			baseUrl: " http://visible/v1 ",
			endpoint: "http://hidden/v1",
			apiVersion: "legacy",
			region: "legacy",
		});
		expect(local).toEqual({
			kind: "local",
			baseUrl: "http://visible/v1",
			endpoint: "",
			apiVersion: "",
			region: "",
		});
		expect(canonicalizeStructuredLlmEndpoint(local)).toEqual(local);

		expect(
			canonicalizeStructuredLlmEndpoint({
				kind: "openai-compatible" as const,
				baseUrl: "",
				endpoint: "http://legacy/v1",
			}),
		).toMatchObject({
			baseUrl: "http://legacy/v1",
			endpoint: "",
		});
	});

	it("uses the visible local baseUrl for both health and provider execution", () => {
		const endpoint = {
			id: "local-endpoint",
			name: "Local endpoint",
			kind: "local" as const,
			enabled: true,
			baseUrl: "http://127.0.0.1:11434/v1",
			endpoint: "http://127.0.0.1:65530/v1",
			models: ["qwen-test"],
		};
		const settings: StructuredLlmProviderSettings = {
			providerEndpoints: [endpoint],
			roleRoutes: [
				{
					role: "evaluation",
					primary: {
						providerEndpointId: endpoint.id,
						model: "qwen-test",
					},
					fallbacks: [],
				},
			],
		};

		const health = buildProviderHealthUrl(endpoint);
		const request = buildNormalizedSupervisorLlmRequest({
			systemPrompt: "system",
			userPrompt: "user",
			label: "endpoint-regression",
			role: "evaluation",
			settings,
		});

		expect(health).toEqual({
			ok: true,
			url: "http://127.0.0.1:11434/health",
		});
		expect(request.endpoint).toBe("http://127.0.0.1:11434/v1");
		expect(request.targetDigest).toBe(
			buildStructuredLlmProviderTargetMetadata(endpoint).targetDigest,
		);
	});
});
