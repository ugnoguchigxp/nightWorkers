import { describe, expect, it } from "vitest";
import { buildProviderEndpointKindPatch } from "../src/modules/settings/llmProviderEndpointKind";

describe("LLM endpoint kind changes", () => {
	it("clears hidden Azure fields when changing to local", () => {
		expect(
			buildProviderEndpointKindPatch(
				{
					id: "endpoint-1",
					name: "Endpoint",
					kind: "azure",
					enabled: true,
					endpoint: "https://azure.example.test",
					apiVersion: "2025-04-01-preview",
					models: ["model"],
				},
				"local",
			),
		).toEqual({
			kind: "local",
			baseUrl: "",
			endpoint: "",
			apiVersion: "",
			region: "",
		});
	});

	it("preserves baseUrl across OpenAI-compatible kinds", () => {
		expect(
			buildProviderEndpointKindPatch(
				{
					id: "endpoint-1",
					name: "Endpoint",
					kind: "local",
					enabled: true,
					baseUrl: "http://localhost:11434/v1",
					models: ["model"],
				},
				"openai-compatible",
			),
		).toMatchObject({
			kind: "openai-compatible",
			baseUrl: "http://localhost:11434/v1",
			endpoint: "",
		});
	});
});
