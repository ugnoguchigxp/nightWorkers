import { describe, expect, it, vi } from "vitest";
import {
	buildProviderHealthUrl,
	checkStructuredLlmProviderHealth,
} from "../../api/services/structured-llm/provider-health";
import type { StructuredLlmProviderEndpoint } from "../../api/services/structured-llm/settings";

describe("structured LLM provider health", () => {
	it("builds local /health URL from an OpenAI-compatible /v1 base URL", () => {
		const result = buildProviderHealthUrl({
			kind: "local",
			baseUrl: "http://localhost:11434/v1",
			models: [],
		});

		expect(result).toEqual({ ok: true, url: "http://localhost:11434/health" });
	});

	it("builds Azure deployment probe URL from the configured endpoint", () => {
		const result = buildProviderHealthUrl({
			kind: "azure",
			endpoint: "https://example.openai.azure.com/",
			apiVersion: "2025-04-01-preview",
			models: ["gpt-5-4-mini"],
		});

		expect(result).toEqual({
			ok: true,
			url: "https://example.openai.azure.com/openai/deployments/gpt-5-4-mini/chat/completions?api-version=2025-04-01-preview",
		});
	});

	it("uses a minimal Azure POST as a healthy deployment probe", async () => {
		const fetchImpl = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
		} as Response);
		const endpoint: StructuredLlmProviderEndpoint = {
			id: "azure-default",
			name: "Azure OpenAI",
			kind: "azure",
			enabled: true,
			apiKey: "azure-secret",
			endpoint: "https://example.openai.azure.com/",
			apiVersion: "2025-04-01-preview",
			models: ["gpt-5-4-mini"],
		};

		const result = await checkStructuredLlmProviderHealth(endpoint, {
			fetchImpl,
		});

		expect(fetchImpl).toHaveBeenCalledWith(
			"https://example.openai.azure.com/openai/deployments/gpt-5-4-mini/chat/completions?api-version=2025-04-01-preview",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					"api-key": "azure-secret",
					"Content-Type": "application/json",
				}),
				body: JSON.stringify({
					messages: [{ role: "user", content: "Reply OK." }],
					max_completion_tokens: 16,
				}),
			}),
		);
		expect(result).toMatchObject({
			ok: true,
			reachable: true,
			providerEndpointId: "azure-default",
			providerKind: "azure",
			status: 200,
			message: "HTTP 200",
		});
	});

	it("reports HTTP response status separately from network reachability", async () => {
		const fetchImpl = vi.fn().mockResolvedValue({
			ok: false,
			status: 404,
			statusText: "Not Found",
		} as Response);
		const endpoint: StructuredLlmProviderEndpoint = {
			id: "local-qwen",
			name: "Local Qwen",
			kind: "local",
			enabled: true,
			baseUrl: "http://localhost:11434/v1",
			models: ["qwen3-coder"],
		};

		const result = await checkStructuredLlmProviderHealth(endpoint, {
			fetchImpl,
		});

		expect(fetchImpl).toHaveBeenCalledWith(
			"http://localhost:11434/health",
			expect.objectContaining({ method: "GET" }),
		);
		expect(result).toMatchObject({
			ok: false,
			reachable: true,
			providerEndpointId: "local-qwen",
			providerKind: "local",
			url: "http://localhost:11434/health",
			status: 404,
			message: "HTTP 404: Not Found",
		});
	});

	it("returns unreachable when the health request cannot connect", async () => {
		const fetchImpl = vi
			.fn()
			.mockRejectedValue(new Error("connect ECONNREFUSED"));
		const endpoint: StructuredLlmProviderEndpoint = {
			id: "local-qwen",
			name: "Local Qwen",
			kind: "local",
			enabled: true,
			baseUrl: "http://localhost:11434/v1",
			models: ["qwen3-coder"],
		};

		const result = await checkStructuredLlmProviderHealth(endpoint, {
			fetchImpl,
		});

		expect(result).toMatchObject({
			ok: false,
			reachable: false,
			providerEndpointId: "local-qwen",
			status: null,
			message: "connect ECONNREFUSED",
		});
	});
});
