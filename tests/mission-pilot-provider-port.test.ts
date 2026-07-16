import { describe, expect, it, vi } from "vitest";
import { callMissionPilotProviderCandidates } from "../api/modules/missionPilot/agent/mission-pilot-provider.port";
import { buildNormalizedSupervisorLlmRequestCandidates } from "../api/services/structured-llm/public";

describe("Mission Pilot provider route fallback", () => {
	it("continues to the next configured candidate when native tools are unsupported", async () => {
		const candidates = buildNormalizedSupervisorLlmRequestCandidates({
			systemPrompt: "system",
			userPrompt: "user",
			label: "mission_pilot_agent",
			role: "mission_pilot",
			settings: {
				providerEndpoints: [
					{
						id: "codex",
						name: "Codex SDK",
						kind: "codex",
						enabled: true,
						models: ["codex-model"],
					},
					{
						id: "azure",
						name: "Azure OpenAI",
						kind: "azure",
						enabled: true,
						endpoint: "https://example.openai.azure.com",
						models: ["azure-model"],
					},
				],
				roleRoutes: [
					{
						role: "mission_pilot",
						primary: {
							providerEndpointId: "codex",
							model: "codex-model",
						},
						fallbacks: [
							{
								providerEndpointId: "azure",
								model: "azure-model",
							},
						],
					},
				],
			},
		});
		const calls: string[] = [];
		const result = await callMissionPilotProviderCandidates({
			candidates,
			signal: new AbortController().signal,
			callCandidate: vi.fn(async (candidate) => {
				calls.push(candidate.providerId);
				return candidate.providerId === "codex"
					? {
							type: "unsupported" as const,
							reason: "Codex native tools are unsupported",
						}
					: {
							type: "supported" as const,
							content: "Task Factを読みます。",
							toolCalls: [
								{
									id: "read-1",
									name: "read_task_workspace",
									arguments: {},
								},
							],
							usage: usage(),
						};
			}),
		});

		expect(calls).toEqual(["codex", "azure-openai"]);
		expect(result).toMatchObject({
			type: "supported",
			toolCalls: [{ name: "read_task_workspace" }],
		});
	});

	it("returns a typed unsupported result when no route candidate is configured", async () => {
		const callCandidate = vi.fn();
		const result = await callMissionPilotProviderCandidates({
			candidates: [],
			signal: new AbortController().signal,
			callCandidate,
		});

		expect(callCandidate).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			type: "unsupported",
			providerDebug: { candidateCount: 0 },
		});
	});
});

function usage() {
	return {
		inputTokens: 1,
		outputTokens: 1,
		cachedInputTokens: 0,
		reasoningOutputTokens: 0,
		totalTokens: 2,
		mode: "provider_reported" as const,
	};
}
