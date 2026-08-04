import { describe, expect, it } from "vitest";
import { resolveReviewCodexRoleRoute } from "../api/modules/nightworkers/run-orchestration/start-task-run-runtime-context";
import type { StructuredLlmProviderSettings } from "../api/services/structured-llm/settings";

const settings: StructuredLlmProviderSettings = {
	providerEndpoints: [
		{
			id: "openai-endpoint",
			name: "OpenAI",
			kind: "openai",
			enabled: true,
			models: ["openai-model"],
		},
		{
			id: "codex-endpoint",
			name: "Codex",
			kind: "codex",
			enabled: true,
			models: ["codex-model"],
		},
	],
	roleRoutes: [
		{
			role: "review",
			primary: {
				providerEndpointId: "openai-endpoint",
				model: "openai-model",
			},
			fallbacks: [
				{
					providerEndpointId: "codex-endpoint",
					model: "codex-model",
				},
			],
		},
	],
};

describe("Review runtime routing", () => {
	it("selects only a Codex candidate from the Review role route", () => {
		expect(resolveReviewCodexRoleRoute({ settings })).toMatchObject({
			providerId: "codex",
			providerEndpointId: "codex-endpoint",
			model: "codex-model",
		});
	});

	it("ignores a non-Codex override and falls back to the configured Codex route", () => {
		expect(
			resolveReviewCodexRoleRoute({
				settings,
				override: {
					providerEndpointId: "openai-endpoint",
					model: "openai-model",
				},
			}),
		).toMatchObject({
			providerId: "codex",
			providerEndpointId: "codex-endpoint",
		});
	});

	it("uses the default Codex SDK configuration when no Codex route exists", () => {
		expect(
			resolveReviewCodexRoleRoute({
				settings: {
					...settings,
					providerEndpoints: settings.providerEndpoints?.slice(0, 1),
				},
			}),
		).toBeNull();
	});
});
