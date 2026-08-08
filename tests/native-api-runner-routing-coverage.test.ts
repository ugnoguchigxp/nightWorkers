import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	readSettings: vi.fn(),
	getHealth: vi.fn(),
}));

vi.mock("../api/services/structured-llm/settings", async () => ({
	...(await vi.importActual("../api/services/structured-llm/settings")),
	readStructuredLlmProviderSettings: mocks.readSettings,
}));
vi.mock("../api/services/structured-llm/provider-health", async () => ({
	...(await vi.importActual("../api/services/structured-llm/provider-health")),
	getCachedStructuredLlmProviderHealth: mocks.getHealth,
}));

import {
	buildNativeApiRoutePolicy,
	classifyNativeApiProviderError,
	emitNativeApiRouteFallback,
	firstLine,
	readNativeApiCompletedTurnModel,
	readRuntimeLlmRouteOverride,
	readString,
	summarizeNativeApiRoute,
	toRecord,
	validateNativeApiRouteSnapshot,
} from "../api/modules/codingAgent/runtime/native-api-runner/native-api-runner-routing";
import { StructuredProviderError } from "../api/services/structured-llm/provider-failure";

function request(overrides: Record<string, unknown> = {}) {
	return {
		provider: "openai",
		options: {
			normalizedRequest: {
				providerId: "openai",
				providerEndpointId: "endpoint-1",
				routeSource: "role_primary",
				modelOrDeployment: "gpt-5",
				thinkingDepth: "high",
				...overrides,
			},
		},
	} as never;
}

describe("native API runner routing coverage", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		mocks.readSettings.mockReturnValue({ providerEndpoints: [] });
		mocks.getHealth.mockResolvedValue({
			reachable: true,
			ok: true,
			checkedAt: "2026-08-08T00:00:00Z",
			message: null,
		});
	});

	afterEach(() => {
		delete process.env.NIGHTWORKERS_NATIVE_API_READINESS_PROBE;
	});

	it("summarizes routes and reads the completed model fallback", () => {
		expect(summarizeNativeApiRoute(request())).toEqual({
			provider: "openai",
			providerId: "openai",
			providerEndpointId: "endpoint-1",
			routeSource: "role_primary",
			model: "gpt-5",
			thinkingDepth: "high",
		});
		expect(
			summarizeNativeApiRoute(
				request({
					providerEndpointId: undefined,
					routeSource: undefined,
					modelOrDeployment: undefined,
					thinkingDepth: undefined,
				}),
			),
		).toMatchObject({
			providerEndpointId: null,
			routeSource: null,
			model: null,
			thinkingDepth: null,
		});
		expect(
			readNativeApiCompletedTurnModel(
				{ type: "supported", model: "response-model" } as never,
				request(),
			),
		).toBe("response-model");
		expect(
			readNativeApiCompletedTurnModel(
				{ type: "supported", model: null } as never,
				request(),
			),
		).toBe("gpt-5");
	});

	it("emits a structured provider route fallback event", async () => {
		const sink = { emit: vi.fn(async () => undefined) };
		await emitNativeApiRouteFallback({
			sink: sink as never,
			turnId: "turn-1",
			attemptIndex: 2,
			from: request(),
			to: request({
				providerEndpointId: "endpoint-2",
				modelOrDeployment: "fallback",
			}),
			reason: "provider_timeout",
			message: "timed out",
		});
		expect(sink.emit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "tool_call_progress",
				payload: expect.objectContaining({
					action: "provider_route_fallback_started",
					attemptIndex: 2,
				}),
			}),
		);
	});

	it("accepts snapshots without role routes or requests", () => {
		expect(validateNativeApiRouteSnapshot([request()], {} as never)).toEqual({
			ok: true,
		});
		expect(
			validateNativeApiRouteSnapshot([], {
				contextSnapshot: {
					effectiveLlmRouting: {
						roles: { coding_agent: { primary: { routeKey: "a" } } },
					},
				},
			} as never),
		).toEqual({ ok: true });
		expect(
			validateNativeApiRouteSnapshot([request()], {
				contextSnapshot: {
					effectiveLlmRouting: {
						roles: { empty: null, primitive: "bad", noRoutes: {} },
					},
				},
			} as never),
		).toEqual({ ok: true });
	});

	it("validates primary, override, fallback, candidate, and composed snapshot route keys", () => {
		const context = {
			contextSnapshot: {
				effectiveLlmRouting: {
					roles: {
						coding_agent: {
							primary: { routeKey: "endpoint-1::gpt-5::openai" },
							override: {
								providerEndpointId: "endpoint-2",
								model: "override",
								providerId: "azure",
							},
							fallbacks: [{ routeKey: "fallback-key" }, null],
							candidates: [
								{
									providerEndpointId: "endpoint-3",
									model: "candidate",
									providerId: "bedrock",
								},
								{ providerEndpointId: "incomplete" },
							],
						},
					},
				},
			},
		};
		expect(
			validateNativeApiRouteSnapshot([request()], context as never),
		).toEqual({ ok: true });
		const invalid = validateNativeApiRouteSnapshot(
			[request({ providerEndpointId: "unknown", modelOrDeployment: "other" })],
			context as never,
		);
		expect(invalid).toMatchObject({
			ok: false,
			route: { providerEndpointId: "unknown", model: "other" },
		});
	});

	it("returns the base policy when readiness probing is disabled in tests", async () => {
		const basePolicy = { role: "coding_agent", targets: [] } as never;
		const result = await buildNativeApiRoutePolicy({
			sink: { emit: vi.fn() } as never,
			runId: "run-1",
			taskId: "task-1",
			basePolicy,
		});
		expect(result).toBe(basePolicy);
		expect(mocks.readSettings).not.toHaveBeenCalled();
	});

	it("probes only enabled native endpoints and emits unreachable skips", async () => {
		process.env.NIGHTWORKERS_NATIVE_API_READINESS_PROBE = "1";
		mocks.readSettings.mockReturnValue({
			providerEndpoints: [
				{
					id: "local",
					kind: "local",
					enabled: true,
					baseUrl: " http://local ",
				},
				{
					id: "compatible",
					kind: "openai-compatible",
					enabled: true,
					baseUrl: "http://compatible",
				},
				{
					id: "disabled",
					kind: "local",
					enabled: false,
					baseUrl: "http://disabled",
				},
				{ id: "empty", kind: "local", enabled: true, baseUrl: " " },
				{
					id: "openai",
					kind: "openai",
					enabled: true,
					baseUrl: "http://openai",
				},
			],
		});
		mocks.getHealth
			.mockResolvedValueOnce({
				reachable: false,
				ok: false,
				checkedAt: "now",
				message: "offline",
			})
			.mockResolvedValueOnce({
				reachable: true,
				ok: true,
				checkedAt: "now",
				message: null,
			});
		const sink = { emit: vi.fn(async () => undefined) };
		const result = await buildNativeApiRoutePolicy({
			sink: sink as never,
			runId: "run-1",
			taskId: "task-1",
			basePolicy: { role: "coding_agent" } as never,
		});
		expect(mocks.getHealth).toHaveBeenCalledTimes(2);
		expect(result).toMatchObject({
			skipUnreachableEndpoints: true,
			endpointReadiness: {
				local: { reachable: false, ok: false, message: "offline" },
				compatible: { reachable: true, ok: true },
			},
		});
		expect(sink.emit).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({
					action: "provider_readiness_skip",
					providerEndpointId: "local",
				}),
			}),
		);
	});

	it("classifies timeouts, structured failures, Error, and primitive failures", () => {
		expect(
			classifyNativeApiProviderError("ignored", {
				attemptTimedOut: true,
				attemptTimeoutMs: 2500,
			}),
		).toEqual({
			reason: "provider_route_attempt_timeout",
			message: "Provider route attempt timed out after 2500ms.",
			retryable: true,
		});
		expect(
			classifyNativeApiProviderError("ignored", { attemptTimedOut: true }),
		).toMatchObject({ message: "Provider route attempt timed out after 0ms." });
		const structured = new StructuredProviderError({
			kind: "rate_limit",
			message: "slow down",
			retryable: true,
		});
		expect(
			classifyNativeApiProviderError(structured, { attemptTimedOut: false }),
		).toEqual({
			reason: "provider_rate_limit",
			message: "slow down",
			retryable: true,
		});
		expect(
			classifyNativeApiProviderError(new Error("boom"), {
				attemptTimedOut: false,
			}),
		).toEqual({
			reason: "provider_error",
			message: "boom",
			retryable: false,
		});
		expect(
			classifyNativeApiProviderError("offline", { attemptTimedOut: false }),
		).toMatchObject({ message: "offline" });
	});

	it("reads runtime overrides and generic value helpers", () => {
		expect(
			readRuntimeLlmRouteOverride({
				runtimeOptions: {
					llmRouting: {
						override: {
							providerEndpointId: " endpoint ",
							model: " model ",
							thinkingDepth: "medium",
						},
					},
				},
			} as never),
		).toEqual({
			providerEndpointId: "endpoint",
			model: "model",
			thinkingDepth: "medium",
		});
		expect(
			readRuntimeLlmRouteOverride({
				runtimeOptions: { llmRouting: [] },
			} as never),
		).toBeNull();
		expect(readRuntimeLlmRouteOverride({} as never)).toBeNull();
		expect(toRecord({ a: 1 })).toEqual({ a: 1 });
		expect(toRecord([])).toBeNull();
		expect(toRecord(null)).toBeNull();
		expect(readString("  value  ")).toBe("value");
		expect(readString(" ")).toBeNull();
		expect(readString(1)).toBeNull();
		expect(firstLine("\n  first  \nsecond")).toBe("first");
		expect(firstLine("  only  ")).toBe("only");
	});
});
