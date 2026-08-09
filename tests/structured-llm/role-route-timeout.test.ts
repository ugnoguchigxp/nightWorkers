import { describe, expect, it } from "vitest";
import {
	llmSettingsSchema,
	normalizeRawLlmSettings,
} from "../../api/modules/settings";
import { resolveStructuredLlmTimeout } from "../../api/services/structured-llm/json";
import { buildNormalizedSupervisorLlmRequestCandidates } from "../../api/services/structured-llm/request";

const providerEndpoints = [
	{
		id: "local-qwen",
		name: "Local Qwen",
		kind: "local" as const,
		enabled: true,
		models: ["qwen-plan", "qwen-fallback"],
	},
];

function roleRoutes(primaryTimeout?: number, fallbackTimeout?: number) {
	return [
		{
			role: "plan" as const,
			primary: {
				providerEndpointId: "local-qwen",
				model: "qwen-plan",
				...(primaryTimeout === undefined
					? {}
					: { requestTimeoutSeconds: primaryTimeout }),
			},
			fallbacks: [
				{
					providerEndpointId: "local-qwen",
					model: "qwen-fallback",
					...(fallbackTimeout === undefined
						? {}
						: { requestTimeoutSeconds: fallbackTimeout }),
				},
			],
		},
	];
}

describe("structured LLM role route request timeout", () => {
	it("accepts 30 to 1200 seconds and preserves primary and fallback values", () => {
		const parsed = llmSettingsSchema.parse({
			providerEndpoints,
			roleRoutes: roleRoutes(1200, 30),
		});
		const normalized = normalizeRawLlmSettings(parsed);
		const plan = normalized.roleRoutes.find((route) => route.role === "plan");

		expect(plan?.primary.requestTimeoutSeconds).toBe(1200);
		expect(plan?.fallbacks[0]?.requestTimeoutSeconds).toBe(30);
	});

	it.each([
		29, 30.5, 1201,
	])("rejects an out-of-range timeout value: %s", (requestTimeoutSeconds) => {
		const result = llmSettingsSchema.safeParse({
			providerEndpoints,
			roleRoutes: roleRoutes(requestTimeoutSeconds, 300),
		});

		expect(result.success).toBe(false);
	});

	it("resolves an independent timeout for each selected route candidate", () => {
		const requests = buildNormalizedSupervisorLlmRequestCandidates({
			systemPrompt: "system",
			userPrompt: "user",
			label: "feature_plan_markdown",
			role: "plan",
			settings: {
				providerEndpoints,
				roleRoutes: roleRoutes(1200, 45),
			},
		});

		expect(requests.map((request) => request.requestTimeoutMs)).toEqual([
			1_200_000, 45_000,
		]);
		expect(
			resolveStructuredLlmTimeout(
				{ timeoutMs: 300_000 },
				requests[0]?.requestTimeoutMs,
			),
		).toEqual({ timeoutMs: 1_200_000, timeoutSource: "role_route" });
		expect(
			resolveStructuredLlmTimeout(
				{ timeoutMs: 300_000 },
				requests[1]?.requestTimeoutMs,
			),
		).toEqual({ timeoutMs: 45_000, timeoutSource: "role_route" });
	});

	it("keeps the existing call timeout when the route setting is absent", () => {
		const [request] = buildNormalizedSupervisorLlmRequestCandidates({
			systemPrompt: "system",
			userPrompt: "user",
			label: "feature_plan_markdown",
			role: "plan",
			settings: {
				providerEndpoints,
				roleRoutes: roleRoutes(),
			},
		});

		expect(request?.requestTimeoutMs).toBeNull();
		expect(
			resolveStructuredLlmTimeout(
				{ timeoutMs: 300_000 },
				request?.requestTimeoutMs,
			),
		).toEqual({ timeoutMs: 300_000, timeoutSource: "call_option" });
	});

	it("keeps routes without timeout stable across persistence round trips", () => {
		const normalized = normalizeRawLlmSettings(
			llmSettingsSchema.parse({
				providerEndpoints,
				roleRoutes: roleRoutes(),
			}),
		);
		const persisted = JSON.parse(JSON.stringify(normalized));
		const normalizedAgain = normalizeRawLlmSettings(
			llmSettingsSchema.parse(persisted),
		);

		expect(normalized.roleRoutes).toStrictEqual(persisted.roleRoutes);
		expect(normalizedAgain.roleRoutes).toStrictEqual(persisted.roleRoutes);
		expect(normalizedAgain.roleRoutes[0]?.primary).not.toHaveProperty(
			"requestTimeoutSeconds",
		);
		expect(normalizedAgain.roleRoutes[0]?.fallbacks[0]).not.toHaveProperty(
			"requestTimeoutSeconds",
		);
	});
});
