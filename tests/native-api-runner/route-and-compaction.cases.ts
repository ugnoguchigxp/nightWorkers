import { describe, expect, it, vi } from "vitest";
import {
	NativeApiRunner,
	type NativeApiToolTurnProvider,
} from "../../api/services/agent-runtime/native-api-runner/native-api-runner";
import type { AgentRuntimeEvent } from "../../api/services/agent-runtime/types";
import type { ProviderToolTurnResult } from "../../api/services/structured-llm/tool-calls";
import {
	buildContext,
	buildRoleContextSnapshot,
	createFakeStore,
	createNoopStartup,
	createProvider,
	createSink,
	installRuntimeLlmSettings,
	usage,
} from "./helpers";
import "./setup";

describe("NativeApiRunner route fallback and compaction", () => {
	it("classifies required tool-call failures and falls back to the next native/API route", async () => {
		const restoreSettings = installRuntimeLlmSettings({
			ACTIVE_LLM_PROVIDER: "azure",
			providerEndpoints: [
				{
					id: "local-gemma",
					name: "Local Gemma",
					kind: "local",
					enabled: true,
					baseUrl: "http://localhost:11434/v1",
					models: ["gemma-4-12b-it-4bit"],
				},
				{
					id: "azure-implementation",
					name: "Azure Implementation",
					kind: "azure",
					enabled: true,
					endpoint: "https://example.openai.azure.com",
					apiVersion: "2024-05-01-preview",
					models: ["gpt-5-mini"],
				},
			],
			roleRoutes: [
				{
					role: "implementation",
					primary: {
						providerEndpointId: "local-gemma",
						model: "gemma-4-12b-it-4bit",
					},
					fallbacks: [
						{
							providerEndpointId: "local-gemma",
							model: "gemma-4-12b-it-4bit",
						},
						{
							providerEndpointId: "azure-implementation",
							model: "gpt-5-mini",
						},
					],
				},
			],
		});
		try {
			const store = createFakeStore();
			const providerTurn = vi
				.fn()
				.mockRejectedValueOnce(
					new Error(
						'OpenAI native tool call failed with status 400: {"error":{"code":"required_tool_call_missing"}}',
					),
				)
				.mockResolvedValueOnce({
					type: "supported",
					content: "ready to finalize",
					toolCalls: [
						{
							id: "call-final",
							name: "finalize_answer",
							arguments: { finalReport: "fallback done" },
						},
					],
					usage: usage(),
					model: "gpt-5-mini",
					providerDebug: { provider: "azure-openai" },
				} satisfies ProviderToolTurnResult);
			const events: AgentRuntimeEvent[] = [];
			const runner = new NativeApiRunner({
				store: store.instance,
				startupController: createNoopStartup(),
				providerTurn: providerTurn as unknown as NativeApiToolTurnProvider,
				usageRecorder: vi.fn(async () => undefined),
			});

			const result = await runner.run(
				buildContext({ timeoutSeconds: 1_900 }),
				createSink(events),
			);

			expect(result).toMatchObject({
				terminalState: "completed",
				finalReport: "fallback done",
			});
			expect(providerTurn).toHaveBeenCalledTimes(2);
			expect(
				providerTurn.mock.calls.map((call) => ({
					providerEndpointId:
						call[0].options.normalizedRequest.providerEndpointId,
					attemptTimeoutMs: call[0].options.attemptTimeoutMs,
				})),
			).toEqual([
				{ providerEndpointId: "local-gemma", attemptTimeoutMs: 1800000 },
				{
					providerEndpointId: "azure-implementation",
					attemptTimeoutMs: 120000,
				},
			]);
			expect(events).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						type: "tool_call_progress",
						payload: expect.objectContaining({
							action: "provider_route_fallback_started",
							reason: "tool_required_missing",
						}),
					}),
				]),
			);
			expect(store.finishedTurns[0].providerDebug).toMatchObject({
				routeAttempts: [
					expect.objectContaining({
						ok: false,
						reason: "tool_required_missing",
						route: expect.objectContaining({
							providerEndpointId: "local-gemma",
						}),
					}),
					expect.objectContaining({
						ok: true,
						reason: "accepted",
						route: expect.objectContaining({
							providerEndpointId: "azure-implementation",
						}),
					}),
				],
			});
		} finally {
			restoreSettings();
		}
	});

	it("does not synthesize enabled endpoints outside explicit Role Routing fallbacks", async () => {
		const restoreSettings = installRuntimeLlmSettings({
			ACTIVE_LLM_PROVIDER: "azure",
			providerEndpoints: [
				{
					id: "codex-implementation",
					name: "Codex Implementation",
					kind: "codex",
					enabled: true,
					models: ["gpt-5.4-mini"],
				},
				{
					id: "local-qwen",
					name: "Local Qwen",
					kind: "local",
					enabled: true,
					baseUrl: "http://localhost:11434/v1",
					models: ["qwen3-coder"],
				},
				{
					id: "azure-implementation",
					name: "Azure Implementation",
					kind: "azure",
					enabled: true,
					endpoint: "https://example.openai.azure.com",
					apiVersion: "2024-05-01-preview",
					models: ["gpt-5-mini"],
				},
			],
			roleRoutes: [
				{
					role: "implementation",
					primary: {
						providerEndpointId: "codex-implementation",
						model: "gpt-5.4-mini",
					},
					fallbacks: [],
				},
			],
		});
		try {
			const store = createFakeStore();
			const providerTurn = createProvider([]);
			const events: AgentRuntimeEvent[] = [];
			const runner = new NativeApiRunner({
				store: store.instance,
				startupController: createNoopStartup(),
				providerTurn,
				usageRecorder: vi.fn(async () => undefined),
			});

			const result = await runner.run(buildContext(), createSink(events));

			expect(result).toMatchObject({
				terminalState: "needs_human",
				stoppedBy: "llm_error",
			});
			expect(result.finalReport).toContain(
				"No native/API provider route candidates",
			);
			expect(providerTurn).not.toHaveBeenCalled();
			expect(store.turns).toHaveLength(0);
			expect(events).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						type: "runtime_error",
						payload: expect.objectContaining({
							reason: "no_native_api_provider_route_candidates",
						}),
					}),
				]),
			);
		} finally {
			restoreSettings();
		}
	});

	it("blocks provider routes that are outside the run route snapshot", async () => {
		const restoreSettings = installRuntimeLlmSettings({
			ACTIVE_LLM_PROVIDER: "azure",
			providerEndpoints: [
				{
					id: "local-qwen",
					name: "Local Qwen",
					kind: "local",
					enabled: true,
					baseUrl: "http://localhost:11434/v1",
					models: ["qwen3-coder"],
				},
			],
			roleRoutes: [
				{
					role: "implementation",
					primary: {
						providerEndpointId: "local-qwen",
						model: "qwen3-coder",
					},
					fallbacks: [],
				},
			],
		});
		try {
			const store = createFakeStore();
			const providerTurn = createProvider([
				{
					type: "supported",
					content: "should not run",
					toolCalls: [],
					usage: usage(),
					model: "qwen3-coder",
				},
			]);
			const events: AgentRuntimeEvent[] = [];
			const runner = new NativeApiRunner({
				store: store.instance,
				startupController: createNoopStartup(),
				providerTurn,
				usageRecorder: vi.fn(async () => undefined),
			});

			const result = await runner.run(
				buildContext({
					contextSnapshot: {
						compiledPrompt: "implement",
						source: "test",
						effectiveLlmRouting: {
							roles: {
								implementation: {
									primary: {
										providerEndpointId: "other-local",
										providerId: "openai",
										model: "qwen3-coder",
										routeKey: "other-local::qwen3-coder::openai",
									},
									fallbacks: [],
									candidates: [],
								},
							},
						},
					},
				}),
				createSink(events),
			);

			expect(result).toMatchObject({
				terminalState: "needs_human",
				stoppedBy: "llm_error",
			});
			expect(result.finalReport).toContain("outside the run snapshot");
			expect(providerTurn).not.toHaveBeenCalled();
			expect(store.turns).toHaveLength(0);
			expect(events).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						type: "runtime_error",
						payload: expect.objectContaining({
							reason: "route_candidate_outside_snapshot",
						}),
					}),
				]),
			);
		} finally {
			restoreSettings();
		}
	});

	it("runs baseline context compaction before provider call without waiting for new_context", async () => {
		const restoreSettings = installRuntimeLlmSettings({
			ACTIVE_LLM_PROVIDER: "azure",
			providerEndpoints: [
				{
					id: "local-qwen",
					name: "Local Qwen",
					kind: "local",
					enabled: true,
					baseUrl: "http://localhost:11434/v1",
					models: ["qwen3-coder"],
				},
			],
			roleRoutes: [
				{
					role: "implementation",
					primary: {
						providerEndpointId: "local-qwen",
						model: "qwen3-coder",
					},
					fallbacks: [],
				},
			],
		});
		try {
			const hugeAssistantContent = `large prior turn ${"x".repeat(540_000)}`;
			const store = createFakeStore();
			const providerTurn = createProvider([
				{
					type: "supported",
					content: hugeAssistantContent,
					toolCalls: [
						{ id: "call-unknown", name: "unknown_tool", arguments: {} },
					],
					usage: usage(),
					model: "qwen3-coder",
				},
				{
					type: "supported",
					content: "ready after runtime compaction",
					toolCalls: [
						{
							id: "call-final",
							name: "finalize_answer",
							arguments: { finalReport: "done after runtime compaction" },
						},
					],
					usage: usage(),
					model: "qwen3-coder",
				},
			]);
			const events: AgentRuntimeEvent[] = [];
			const runner = new NativeApiRunner({
				store: store.instance,
				startupController: createNoopStartup(),
				providerTurn,
				usageRecorder: vi.fn(async () => undefined),
			});

			const result = await runner.run(
				buildContext({ timeoutSeconds: 360 }),
				createSink(events),
			);

			expect(result).toMatchObject({
				terminalState: "completed",
				finalReport: "done after runtime compaction",
			});
			expect(providerTurn).toHaveBeenCalledTimes(2);
			const secondMessages = vi.mocked(providerTurn).mock.calls[1][0].messages;
			expect(JSON.stringify(secondMessages)).not.toContain("large prior turn");
			expect(events).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						type: "tool_call_progress",
						payload: expect.objectContaining({
							action: "context_compaction_started",
						}),
					}),
					expect.objectContaining({
						type: "tool_call_progress",
						payload: expect.objectContaining({
							action: "context_compaction_finished",
						}),
					}),
				]),
			);
			expect(store.finishedTurns[1].providerDebug).toMatchObject({
				contextCompaction: expect.objectContaining({
					reason: "hard_limit_exceeded_before_provider_call",
					retainedHistoryItems: 2,
				}),
			});
		} finally {
			restoreSettings();
		}
	});

	it("keeps role working context after baseline compaction drops prior provider turns", async () => {
		const restoreSettings = installRuntimeLlmSettings({
			ACTIVE_LLM_PROVIDER: "azure",
			providerEndpoints: [
				{
					id: "local-qwen",
					name: "Local Qwen",
					kind: "local",
					enabled: true,
					baseUrl: "http://localhost:11434/v1",
					models: ["qwen3-coder"],
				},
			],
			roleRoutes: [
				{
					role: "implementation",
					primary: {
						providerEndpointId: "local-qwen",
						model: "qwen3-coder",
					},
					fallbacks: [],
				},
			],
		});
		try {
			const hugeAssistantContent = `large prior raw tool payload ${"x".repeat(540_000)}`;
			const store = createFakeStore();
			const providerTurn = createProvider([
				{
					type: "supported",
					content: hugeAssistantContent,
					toolCalls: [
						{ id: "call-unknown", name: "unknown_tool", arguments: {} },
					],
					usage: usage(),
					model: "qwen3-coder",
				},
				{
					type: "supported",
					content: "ready after role context compaction",
					toolCalls: [
						{
							id: "call-final",
							name: "finalize_answer",
							arguments: { finalReport: "done with role context" },
						},
					],
					usage: usage(),
					model: "qwen3-coder",
				},
			]);
			const runner = new NativeApiRunner({
				store: store.instance,
				startupController: createNoopStartup(),
				providerTurn,
				usageRecorder: vi.fn(async () => undefined),
			});

			const result = await runner.run(
				buildContext({
					timeoutSeconds: 360,
					contextSnapshot: {
						compiledPrompt: "implement",
						source: "fallback",
						roleContext: buildRoleContextSnapshot(),
					},
				}),
				createSink(),
			);

			expect(result).toMatchObject({
				terminalState: "completed",
				finalReport: "done with role context",
			});
			const secondMessages = vi.mocked(providerTurn).mock.calls[1][0].messages;
			const messageText = secondMessages
				.map((message) => message.content)
				.join("\n\n");
			expect(messageText).toContain('<ROLE_WORKING_CONTEXT version="1"');
			expect(messageText).toContain("currentTodo=#1 Implement role context");
			expect(messageText).not.toContain("large prior raw tool payload");
			expect(store.finishedTurns[1].providerDebug).toMatchObject({
				contextCompaction: expect.objectContaining({
					retainedHistoryItems: 3,
				}),
			});
		} finally {
			restoreSettings();
		}
	});
});
