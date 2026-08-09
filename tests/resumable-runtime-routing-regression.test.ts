import { describe, expect, it } from "vitest";
import {
	assertResumableLlmRoutingUnchanged,
	carryResumableRuntimeContext,
} from "../api/modules/nightworkers/run-orchestration/resumable-runtime-context";

function routing(overrides: Record<string, unknown> = {}) {
	return {
		activeRole: "plan",
		settingsRevision: "settings-rev-1",
		routePolicyDigest: "native-api:no-codex:explicit-only",
		active: {
			routeKey: "plan-endpoint::plan-model::openai",
			providerId: "openai",
			providerEndpointId: "plan-endpoint",
			model: "plan-model",
			thinkingDepth: "high",
		},
		...overrides,
	};
}

describe("resumable runtime routing snapshot", () => {
	it("accepts an unchanged role, route, revision, and lane", () => {
		expect(() =>
			assertResumableLlmRoutingUnchanged({
				previousContext: {
					runtimeLane: "native-api-runner",
					effectiveLlmRouting: routing(),
				},
				currentEffectiveLlmRouting: routing(),
				currentRuntimeLane: "native-api-runner",
			}),
		).not.toThrow();
	});

	it("keeps legacy snapshots resumable when newer identity fields were absent", () => {
		expect(() =>
			assertResumableLlmRoutingUnchanged({
				previousContext: {
					effectiveLlmRouting: { activeRole: "plan" },
				},
				currentEffectiveLlmRouting: routing(),
				currentRuntimeLane: "native-api-runner",
			}),
		).not.toThrow();
	});

	it.each([
		{
			name: "settings revision",
			current: routing({ settingsRevision: "settings-rev-2" }),
			lane: "native-api-runner",
		},
		{
			name: "active role",
			current: routing({ activeRole: "implementation" }),
			lane: "native-api-runner",
		},
		{
			name: "active route",
			current: routing({
				active: {
					routeKey: "other::model::openai",
					providerId: "openai",
					providerEndpointId: "other",
					model: "model",
					thinkingDepth: "high",
				},
			}),
			lane: "native-api-runner",
		},
		{
			name: "runtime lane",
			current: routing(),
			lane: "codex-sdk",
		},
	])("rejects a changed $name", ({ current, lane }) => {
		expect(() =>
			assertResumableLlmRoutingUnchanged({
				previousContext: {
					runtimeLane: "native-api-runner",
					effectiveLlmRouting: routing(),
				},
				currentEffectiveLlmRouting: current,
				currentRuntimeLane: lane,
			}),
		).toThrowError(
			expect.objectContaining({
				statusCode: 409,
				code: "RUN_LLM_ROUTING_SNAPSHOT_CONFLICT",
			}),
		);
	});

	it("preserves the persisted routing fields when carrying resume context", () => {
		const previousRouting = routing();
		const result = carryResumableRuntimeContext({
			context: {
				compiledPrompt: "new prompt",
				source: "task_prompt",
				runtimeLane: "codex-sdk",
				effectiveLlmRouting: routing({ activeRole: "implementation" }),
			} as never,
			previousContext: {
				runtimeLane: "native-api-runner",
				runtimeLaneResolution: { source: "role_route" },
				effectiveLlmRouting: previousRouting,
			},
			resumeKind: "runtime_pause",
		});

		expect(result).toMatchObject({
			compiledPrompt: "new prompt",
			runtimeLane: "native-api-runner",
			runtimeLaneResolution: { source: "role_route" },
			effectiveLlmRouting: previousRouting,
		});
	});
});
