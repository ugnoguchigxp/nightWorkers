import { describe, expect, it, vi } from "vitest";
import {
	type CodingAgentPlanModeRuntimeThreadHandoff,
	loadPersistedCodingAgentPlanModeGateResult,
	readCodingAgentPlanModeRuntimeThreadHandoff,
	resolveCodexIntakeRuntimeHandoff,
	resolveCodingAgentRuntimeRole,
	updateCodingAgentPlanModeRuntimeThreadHandoff,
} from "../api/modules/codingAgent";
import { persistCodexProviderThreadIfPresent } from "../api/modules/codingAgent/runtime/codex-runtime-support";
import { createCodexRuntimeThread } from "../api/modules/codingAgent/runtime/codex-sdk/codex-sdk-client";
import type { AgentRunContext } from "../api/modules/codingAgent/runtime/types";
import type { RuntimeSessionStateStore } from "../api/services/runtime-session-state";
import {
	resolveCodexAuthScopeFingerprint,
	resolveCodexEndpointAccessToken,
} from "../api/services/structured-llm/codex-auth-scope";
import { digestText } from "../api/services/text-digest";

describe("Coding Agent Plan Mode Codex thread handoff", () => {
	it("keeps Plan Role Routing for Yes and switches to Implementation for No", () => {
		expect(resolveCodingAgentRuntimeRole(true)).toBe("plan");
		expect(resolveCodingAgentRuntimeRole(false)).toBe("implementation");
	});

	it("captures the Codex thread created by the successful gate response", () => {
		const handoff = readCodingAgentPlanModeRuntimeThreadHandoff(
			{
				type: "model.response_finished",
				severity: "info",
				message: "done",
				data: {
					providerDebug: {
						provider: "codex",
						providerThreadId: "thread-plan-gate",
						providerEndpointId: "endpoint-codex",
						model: "gpt-test-codex",
					},
				},
			},
			{ resolveAuthScopeFingerprint: () => "scope-codex" },
		);

		expect(handoff).toEqual({
			kind: "codex_thread",
			provider: "codex",
			providerThreadId: "thread-plan-gate",
			providerEndpointId: "endpoint-codex",
			model: "gpt-test-codex",
			authScopeFingerprint: "scope-codex",
			source: "plan_mode_gate",
		});
	});

	it("keeps the latest successful repair thread for handoff", () => {
		const event = (providerThreadId: string) => ({
			type: "model.response_finished" as const,
			severity: "info" as const,
			message: "done",
			data: {
				providerDebug: {
					provider: "codex",
					providerThreadId,
					providerEndpointId: "endpoint-codex",
					model: "gpt-test-codex",
				},
			},
		});
		const initial = updateCodingAgentPlanModeRuntimeThreadHandoff(
			null,
			event("thread-initial"),
		);
		const repaired = updateCodingAgentPlanModeRuntimeThreadHandoff(
			initial,
			event("thread-repair"),
		);

		expect(repaired?.providerThreadId).toBe("thread-repair");
	});

	it("hands the thread to a matching Codex implementation route", () => {
		const handoff: CodingAgentPlanModeRuntimeThreadHandoff = {
			kind: "codex_thread",
			provider: "codex",
			providerThreadId: "thread-plan-gate",
			providerEndpointId: "endpoint-codex",
			model: "gpt-test-codex",
			authScopeFingerprint: "scope-codex",
			source: "plan_mode_gate",
		};
		const runtimeRoute = {
			providerId: "codex",
			providerEndpointId: "endpoint-codex",
			model: "gpt-test-codex",
		} as Parameters<typeof resolveCodexIntakeRuntimeHandoff>[0]["runtimeRoute"];

		expect(
			resolveCodexIntakeRuntimeHandoff({
				handoff,
				executionMode: "implementation",
				runtimeRoute,
				resolveAuthScopeFingerprint: () => "scope-codex",
			}),
		).toEqual({
			kind: "codex_thread",
			status: "available",
			stateId: null,
			providerThreadId: "thread-plan-gate",
			executionMode: "implementation",
			model: "gpt-test-codex",
			source: "intake_gate_handoff",
		});
	});

	it("switches Codex Role Routing without starting a new thread", () => {
		const handoff: CodingAgentPlanModeRuntimeThreadHandoff = {
			kind: "codex_thread",
			provider: "codex",
			providerThreadId: "thread-plan-gate",
			providerEndpointId: "plan-endpoint",
			model: "plan-model",
			authScopeFingerprint: "shared-scope",
			source: "plan_mode_gate",
		};
		const runtimeRoute = {
			providerId: "codex",
			providerEndpointId: "implementation-endpoint",
			model: "implementation-model",
		} as Parameters<typeof resolveCodexIntakeRuntimeHandoff>[0]["runtimeRoute"];

		expect(
			resolveCodexIntakeRuntimeHandoff({
				handoff,
				executionMode: "implementation",
				runtimeRoute,
				resolveAuthScopeFingerprint: () => "shared-scope",
			}),
		).toEqual(
			expect.objectContaining({
				providerThreadId: "thread-plan-gate",
				model: "implementation-model",
			}),
		);
	});

	it("starts a fresh implementation thread for a different Codex auth scope", () => {
		const handoff: CodingAgentPlanModeRuntimeThreadHandoff = {
			kind: "codex_thread",
			provider: "codex",
			providerThreadId: "thread-plan-gate",
			providerEndpointId: "plan-endpoint",
			model: "plan-model",
			authScopeFingerprint: "plan-scope",
			source: "plan_mode_gate",
		};
		const runtimeRoute = {
			providerId: "codex",
			providerEndpointId: "implementation-endpoint",
			model: "implementation-model",
		} as Parameters<typeof resolveCodexIntakeRuntimeHandoff>[0]["runtimeRoute"];

		expect(
			resolveCodexIntakeRuntimeHandoff({
				handoff,
				executionMode: "implementation",
				runtimeRoute,
				resolveAuthScopeFingerprint: () => "implementation-scope",
			}),
		).toBeNull();
	});

	it("starts a fresh implementation thread for a non-Codex Role Route", () => {
		const handoff: CodingAgentPlanModeRuntimeThreadHandoff = {
			kind: "codex_thread",
			provider: "codex",
			providerThreadId: "thread-plan-gate",
			providerEndpointId: "plan-endpoint",
			model: "plan-model",
			authScopeFingerprint: "plan-scope",
			source: "plan_mode_gate",
		};
		const runtimeRoute = {
			providerId: "openai",
			providerEndpointId: "implementation-endpoint",
			model: "implementation-model",
		} as Parameters<typeof resolveCodexIntakeRuntimeHandoff>[0]["runtimeRoute"];

		expect(
			resolveCodexIntakeRuntimeHandoff({
				handoff,
				executionMode: "implementation",
				runtimeRoute,
			}),
		).toBeNull();
	});

	it("resolves endpoint credentials without exposing them in the handoff", () => {
		const settings = {
			CODEX_ACCESS_TOKEN: "fallback-token",
			providerEndpoints: [
				{
					id: "codex-endpoint",
					name: "Codex",
					kind: "codex" as const,
					enabled: true,
					apiKey: "endpoint-token",
					models: ["gpt-test-codex"],
				},
			],
		};

		expect(resolveCodexEndpointAccessToken("codex-endpoint", settings)).toBe(
			"endpoint-token",
		);
		expect(resolveCodexAuthScopeFingerprint("codex-endpoint", settings)).toBe(
			resolveCodexAuthScopeFingerprint("codex-endpoint", settings),
		);
		expect(
			resolveCodexAuthScopeFingerprint("codex-endpoint", settings),
		).not.toContain("endpoint-token");
	});

	it("restores a persisted gate decision for the same prompt", async () => {
		const store = {
			getLatestRuntimeSessionStateForTask: vi.fn(async () => ({
				id: "state-intake",
				providerSessionId: "thread-plan-gate",
				model: "plan-model",
				metadataJson: {
					promptDigest: digestText("same prompt"),
					decision: {
						shouldStartPlanMode: true,
						action: "plan_mode",
						reason: "plan first",
					},
					providerEndpointId: "plan-endpoint",
					authScopeFingerprint: "plan-scope",
				},
			})),
		} as unknown as RuntimeSessionStateStore;

		await expect(
			loadPersistedCodingAgentPlanModeGateResult({
				taskId: "task-intake",
				repositoryId: "repository-intake",
				prompt: "same prompt",
				store,
			}),
		).resolves.toEqual(
			expect.objectContaining({
				action: "plan_mode",
				runtimeThreadHandoff: expect.objectContaining({
					stateId: "state-intake",
					providerThreadId: "thread-plan-gate",
				}),
			}),
		);
	});

	it("consumes the persisted intake state only after thread.started", async () => {
		const store = {
			upsertRuntimeSessionState: vi.fn(async () => ({ id: "runtime-state" })),
			markRuntimeSessionStateSuperseded: vi.fn(async () => null),
		} as unknown as RuntimeSessionStateStore;
		const context = {
			runId: "run-intake-handoff",
			taskId: "task-intake-handoff",
			repositoryId: "repository-intake-handoff",
			repoRoot: "/tmp/intake-handoff",
			compiledPrompt: "request",
			latestUserMessage: "request",
			timeoutSeconds: 30,
			contextSnapshot: { compiledPrompt: "request" },
			runtimeOptions: {
				runtimeResume: {
					source: "intake_gate_handoff",
					stateId: "state-intake",
				},
			},
		} satisfies AgentRunContext;

		await persistCodexProviderThreadIfPresent(store, context, {
			type: "runtime_started",
			message: "thread started",
			payload: { providerThreadId: "thread-plan-gate" },
		});

		expect(store.markRuntimeSessionStateSuperseded).toHaveBeenCalledWith({
			id: "state-intake",
		});
	});

	it("resumes the gate thread with the selected Role Routing options", async () => {
		const resumedThread = {
			runStreamed: vi.fn(async () => ({
				events: (async function* () {
					yield { type: "thread.started", thread_id: "thread-plan-gate" };
				})(),
			})),
		};
		const resumeThread = vi.fn(() => resumedThread);
		const startThread = vi.fn();
		const context = {
			runId: "run-intake-handoff",
			taskId: "task-intake-handoff",
			repositoryId: "repository-intake-handoff",
			repoRoot: "/tmp/intake-handoff",
			compiledPrompt: "request",
			latestUserMessage: "request",
			timeoutSeconds: 30,
			contextSnapshot: {
				compiledPrompt: "request",
				runtimeResume: {
					kind: "codex_thread",
					status: "available",
					providerThreadId: "thread-plan-gate",
				},
			},
			runtimeOptions: {
				codex: { model: "implementation-model" },
			},
		} satisfies AgentRunContext;

		const thread = await createCodexRuntimeThread({
			context,
			codexClient: { resumeThread, startThread },
		});
		expect(resumeThread).toHaveBeenCalledWith(
			"thread-plan-gate",
			expect.objectContaining({ model: "implementation-model" }),
		);
		expect(startThread).not.toHaveBeenCalled();
		const turn = await thread.runStreamed("request", {
			signal: new AbortController().signal,
		});
		for await (const _event of turn.events) {
			// Resume is lazy in the Codex SDK and starts when events are consumed.
		}
		expect(resumedThread.runStreamed).toHaveBeenCalledWith(
			"request",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
	});
});
