import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	readSettings: vi.fn(),
}));

vi.mock("../api/services/structured-llm/settings", async () => ({
	...(await vi.importActual("../api/services/structured-llm/settings")),
	readStructuredLlmProviderSettings: mocks.readSettings,
}));

import { buildNativeApiProviderRequests } from "../api/modules/codingAgent/runtime/native-api-runner/native-api-request-adapter";
import { validateNativeApiRouteSnapshot } from "../api/modules/codingAgent/runtime/native-api-runner/native-api-runner-routing";
import { buildRuntimeLaneOptions } from "../api/modules/codingAgent/runtime/registry";

const settings = {
	settingsRevision: "settings-rev-1",
	providerEndpoints: [
		{
			id: "plan-api",
			name: "Plan API",
			kind: "local",
			enabled: true,
			baseUrl: "http://127.0.0.1:11434/v1",
			models: ["plan-model"],
		},
		{
			id: "implementation-codex",
			name: "Implementation Codex",
			kind: "codex",
			enabled: true,
			models: ["implementation-model"],
		},
	],
	roleRoutes: [
		{
			role: "plan",
			primary: { providerEndpointId: "plan-api", model: "plan-model" },
			fallbacks: [],
		},
		{
			role: "implementation",
			primary: {
				providerEndpointId: "implementation-codex",
				model: "implementation-model",
			},
			fallbacks: [],
		},
	],
};

function context() {
	return {
		runId: "run-1",
		taskId: "task-1",
		repositoryId: "repo-1",
		repoRoot: "/repo",
		compiledPrompt: "prompt",
		latestUserMessage: "request",
		timeoutSeconds: 60,
		runtimeOptions: {
			llmRouting: { activeRole: "plan" },
		},
		contextSnapshot: {
			compiledPrompt: "prompt",
			source: "task_prompt",
			effectiveLlmRouting: {
				activeRole: "plan",
				settingsRevision: "settings-rev-1",
				roles: {
					plan: {
						candidates: [{ routeKey: "plan-api::plan-model::openai" }],
					},
					implementation: {
						candidates: [
							{
								routeKey: "implementation-codex::implementation-model::codex",
							},
						],
					},
				},
			},
		},
	};
}

describe("Native API active role routing", () => {
	beforeEach(() => {
		mocks.readSettings.mockReturnValue(settings);
	});

	it("builds Plan requests from the persisted active role", () => {
		const requests = buildNativeApiProviderRequests({
			context: context() as never,
			history: [
				{ type: "system", content: "system" },
				{ type: "user", content: "request" },
			] as never,
			routePolicy: { disallowedProviderIds: ["codex"] },
		});

		expect(requests).toHaveLength(1);
		expect(requests[0]?.options.role).toBe("plan");
		expect(requests[0]?.options.normalizedRequest).toMatchObject({
			role: "plan",
			providerEndpointId: "plan-api",
			modelOrDeployment: "plan-model",
		});
	});

	it("keeps the Plan role in runtime options even when no route resolved", () => {
		expect(
			buildRuntimeLaneOptions({
				compiledPromptText: "prompt",
				activeRole: "plan",
				activeLlmRoute: null,
			}),
		).toMatchObject({
			llmRouting: { activeRole: "plan", active: null },
		});
	});

	it("keeps the persisted Plan role when transient runtime options disagree", () => {
		const persistedContext = context();
		persistedContext.runtimeOptions.llmRouting.activeRole = "implementation";

		const requests = buildNativeApiProviderRequests({
			context: persistedContext as never,
			history: [
				{ type: "system", content: "system" },
				{ type: "user", content: "request" },
			] as never,
			routePolicy: { disallowedProviderIds: ["codex"] },
		});

		expect(requests).toHaveLength(1);
		expect(requests[0]?.options.role).toBe("plan");
		expect(requests[0]?.options.normalizedRequest).toMatchObject({
			role: "plan",
			providerEndpointId: "plan-api",
			modelOrDeployment: "plan-model",
		});
	});

	it("rejects a route that belongs only to a non-active role", () => {
		const implementationRequest = {
			provider: "codex",
			options: {
				normalizedRequest: {
					providerId: "codex",
					providerEndpointId: "implementation-codex",
					modelOrDeployment: "implementation-model",
				},
			},
		};

		expect(
			validateNativeApiRouteSnapshot(
				[implementationRequest] as never,
				context() as never,
			),
		).toMatchObject({ ok: false });
	});

	it("blocks provider execution when settings changed after Run start", () => {
		mocks.readSettings.mockReturnValue({
			...settings,
			settingsRevision: "settings-rev-2",
		});
		const planRequest = {
			provider: "openai",
			options: {
				normalizedRequest: {
					providerId: "openai",
					providerEndpointId: "plan-api",
					modelOrDeployment: "plan-model",
				},
			},
		};

		expect(
			validateNativeApiRouteSnapshot(
				[planRequest] as never,
				context() as never,
			),
		).toEqual({
			ok: false,
			reason: "settings_revision_mismatch",
			expectedSettingsRevision: "settings-rev-1",
			actualSettingsRevision: "settings-rev-2",
		});
	});

	it("blocks provider execution when the current settings revision is missing", () => {
		mocks.readSettings.mockReturnValue({
			...settings,
			settingsRevision: undefined,
		});
		const planRequest = {
			provider: "openai",
			options: {
				normalizedRequest: {
					providerId: "openai",
					providerEndpointId: "plan-api",
					modelOrDeployment: "plan-model",
				},
			},
		};

		expect(
			validateNativeApiRouteSnapshot(
				[planRequest] as never,
				context() as never,
			),
		).toEqual({
			ok: false,
			reason: "settings_revision_mismatch",
			expectedSettingsRevision: "settings-rev-1",
			actualSettingsRevision: null,
		});
	});

	it("rejects every route when the persisted active-role plan is missing", () => {
		const missingPlanContext = context();
		missingPlanContext.contextSnapshot.effectiveLlmRouting.roles = {
			implementation: {
				candidates: [
					{
						routeKey: "implementation-codex::implementation-model::codex",
					},
				],
			},
		} as never;
		const planRequest = {
			provider: "openai",
			options: {
				normalizedRequest: {
					providerId: "openai",
					providerEndpointId: "plan-api",
					modelOrDeployment: "plan-model",
				},
			},
		};

		expect(
			validateNativeApiRouteSnapshot(
				[planRequest] as never,
				missingPlanContext as never,
			),
		).toMatchObject({
			ok: false,
			reason: "route_candidate_outside_snapshot",
		});
	});
});
