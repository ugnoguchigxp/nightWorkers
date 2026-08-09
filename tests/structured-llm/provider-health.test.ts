import { describe, expect, it, vi } from "vitest";
import {
	buildProviderExecutionReadinessUrl,
	buildProviderHealthUrl,
	checkStructuredLlmProviderExecutionReadiness,
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

	it("builds the execution probe from the same canonical local base URL", () => {
		expect(
			buildProviderExecutionReadinessUrl({
				kind: "local",
				baseUrl: "http://localhost:11434/v1",
				endpoint: "http://localhost:65530/v1",
				models: ["qwen3-coder"],
			}),
		).toEqual({
			ok: true,
			url: "http://localhost:11434/v1/chat/completions",
		});
	});

	it("uses a provider-native tool-capable request for explicit local readiness", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(
				new Response(
					JSON.stringify({ choices: [{ message: { content: "OK" } }] }),
					{ status: 200 },
				),
			);
		const endpoint: StructuredLlmProviderEndpoint = {
			id: "local-qwen",
			name: "Local Qwen",
			kind: "local",
			enabled: true,
			baseUrl: "http://localhost:11434/v1",
			models: ["qwen3-coder"],
		};

		const result = await checkStructuredLlmProviderExecutionReadiness(
			endpoint,
			{ fetchImpl },
		);

		expect(fetchImpl).toHaveBeenCalledWith(
			"http://localhost:11434/v1/chat/completions",
			expect.objectContaining({
				method: "POST",
				body: expect.stringContaining('"model":"qwen3-coder"'),
			}),
		);
		expect(result).toMatchObject({
			ok: true,
			reachable: true,
			status: 200,
			message: "Execution ready (HTTP 200)",
			probeKind: "execution_readiness",
			model: "qwen3-coder",
			targetDigest: expect.any(String),
		});
	});

	it("does not report execution readiness for an invalid HTTP 200 body", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(new Response("not-json", { status: 200 }));
		const result = await checkStructuredLlmProviderExecutionReadiness(
			{
				id: "local-invalid",
				name: "Local Invalid",
				kind: "local",
				enabled: true,
				baseUrl: "http://localhost:11434/v1",
				models: ["qwen3-coder"],
			},
			{ fetchImpl },
		);

		expect(result).toMatchObject({
			ok: false,
			reachable: true,
			status: 200,
			probeKind: "execution_readiness",
		});
		expect(result.message).toMatch(/valid JSON/i);
	});

	it("does not report execution readiness when the response has no message choice", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ choices: [] }), { status: 200 }),
			);
		const result = await checkStructuredLlmProviderExecutionReadiness(
			{
				id: "local-no-choice",
				name: "Local No Choice",
				kind: "local",
				enabled: true,
				baseUrl: "http://localhost:11434/v1",
				models: ["qwen3-coder"],
			},
			{ fetchImpl },
		);

		expect(result).toMatchObject({
			ok: false,
			reachable: true,
			status: 200,
		});
		expect(result.message).toMatch(/message choice/i);
	});

	it.each([
		"codex",
		"bedrock",
	] as const)("reports %s execution readiness as unsupported without making a request", async (kind) => {
		const fetchImpl = vi.fn();
		const result = await checkStructuredLlmProviderExecutionReadiness(
			{
				id: `${kind}-default`,
				name: kind,
				kind,
				enabled: true,
				region: kind === "bedrock" ? "us-east-1" : undefined,
				models: ["model"],
			},
			{ fetchImpl },
		);

		expect(fetchImpl).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			ok: false,
			reachable: false,
			probeKind: "execution_readiness",
		});
		expect(result.message).toMatch(/does not support/i);
	});

	it("rejects execution readiness before fetch when no model is configured", async () => {
		const fetchImpl = vi.fn();
		const result = await checkStructuredLlmProviderExecutionReadiness(
			{
				id: "local-empty",
				name: "Local Empty",
				kind: "local",
				enabled: true,
				baseUrl: "http://localhost:11434/v1",
				models: [],
			},
			{ fetchImpl },
		);

		expect(fetchImpl).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			ok: false,
			probeKind: "execution_readiness",
			model: null,
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

	it("includes native tools in an explicit Azure execution readiness request", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(
				new Response(
					JSON.stringify({ choices: [{ message: { content: "OK" } }] }),
					{ status: 200 },
				),
			);
		const result = await checkStructuredLlmProviderExecutionReadiness(
			{
				id: "azure-readiness",
				name: "Azure OpenAI",
				kind: "azure",
				enabled: true,
				apiKey: "azure-secret",
				endpoint: "https://user:password@example.openai.azure.com/",
				apiVersion: "2025-04-01-preview",
				models: ["gpt-5-4-mini"],
			},
			{ fetchImpl },
		);

		const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
		expect(requestBody).toMatchObject({
			tools: [
				{
					type: "function",
					function: { name: "nightworkers_readiness_probe" },
				},
			],
			tool_choice: "auto",
		});
		expect(result.url).toBe(
			"https://example.openai.azure.com/openai/deployments/gpt-5-4-mini/chat/completions",
		);
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
