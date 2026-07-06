import { describe, expect, it, vi } from "vitest";
import * as repo from "../../api/modules/nightworkers/nightworkers.repository";
import {
	NativeApiRunner,
	type NativeApiToolTurnProvider,
} from "../../api/services/agent-runtime/native-api-runner/native-api-runner";
import type { AgentRuntimeEvent } from "../../api/services/agent-runtime/types";
import type { ProviderToolTurnResult } from "../../api/services/structured-llm/tool-calls";
import {
	buildContext,
	createFakeStore,
	createNoopStartup,
	createProvider,
	createSink,
	installRuntimeLlmSettings,
	usage,
} from "./helpers";
import "./setup";

describe("NativeApiRunner context windows and Todo refresh", () => {
	it("compacts again before calling an explicit fallback with a smaller context window", async () => {
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
				{
					id: "azure-small",
					name: "Azure Small",
					kind: "azure",
					enabled: true,
					endpoint: "https://example.openai.azure.com",
					apiVersion: "2024-05-01-preview",
					models: ["gpt-5-mini"],
					defaultModelCapability: {
						contextWindowTokens: 8192,
						safePromptBudgetTokens: 8192,
						reservedOutputTokens: 1024,
					},
				},
			],
			roleRoutes: [
				{
					role: "implementation",
					primary: {
						providerEndpointId: "local-qwen",
						model: "qwen3-coder",
					},
					fallbacks: [
						{
							providerEndpointId: "azure-small",
							model: "gpt-5-mini",
						},
					],
				},
			],
		});
		try {
			const largePriorAssistantContent = `large prior turn ${"x".repeat(24_000)}`;
			const store = createFakeStore();
			const providerTurn = vi
				.fn()
				.mockResolvedValueOnce({
					type: "supported",
					content: largePriorAssistantContent,
					toolCalls: [
						{ id: "call-unknown", name: "unknown_tool", arguments: {} },
					],
					usage: usage(),
					model: "qwen3-coder",
				} satisfies ProviderToolTurnResult)
				.mockRejectedValueOnce(
					new Error(
						'OpenAI native tool call failed with status 400: {"error":{"code":"required_tool_call_missing"}}',
					),
				)
				.mockResolvedValueOnce({
					type: "supported",
					content: "ready after fallback compaction",
					toolCalls: [
						{
							id: "call-final",
							name: "finalize_answer",
							arguments: { finalReport: "fallback done after compaction" },
						},
					],
					usage: usage(),
					model: "gpt-5-mini",
				} satisfies ProviderToolTurnResult);
			const events: AgentRuntimeEvent[] = [];
			const runner = new NativeApiRunner({
				store: store.instance,
				startupController: createNoopStartup(),
				providerTurn: providerTurn as unknown as NativeApiToolTurnProvider,
				usageRecorder: vi.fn(async () => undefined),
			});

			const result = await runner.run(
				buildContext({ timeoutSeconds: 360 }),
				createSink(events),
			);

			expect(result).toMatchObject({
				terminalState: "completed",
				finalReport: "fallback done after compaction",
			});
			expect(providerTurn).toHaveBeenCalledTimes(3);
			expect(
				providerTurn.mock.calls.map((call) => ({
					providerEndpointId:
						call[0].options.normalizedRequest.providerEndpointId,
					messageText: JSON.stringify(call[0].messages),
				})),
			).toEqual([
				expect.objectContaining({
					providerEndpointId: "local-qwen",
					messageText: expect.not.stringContaining("large prior turn"),
				}),
				expect.objectContaining({
					providerEndpointId: "local-qwen",
					messageText: expect.stringContaining("large prior turn"),
				}),
				expect.objectContaining({
					providerEndpointId: "azure-small",
					messageText: expect.not.stringContaining("large prior turn"),
				}),
			]);
			expect(events).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						type: "tool_call_progress",
						payload: expect.objectContaining({
							action: "provider_route_fallback_started",
							to: expect.objectContaining({
								providerEndpointId: "azure-small",
							}),
						}),
					}),
					expect.objectContaining({
						type: "tool_call_progress",
						payload: expect.objectContaining({
							action: "context_compaction_finished",
							contextCompaction: expect.objectContaining({
								previousHistoryItems: expect.any(Number),
							}),
						}),
					}),
				]),
			);
			expect(store.finishedTurns.at(-1)?.providerDebug).toMatchObject({
				contextCompaction: expect.objectContaining({
					reason: "hard_limit_exceeded_before_provider_call",
				}),
			});
		} finally {
			restoreSettings();
		}
	});

	it("starts a fresh provider history after new_context without summarizing prior turns", async () => {
		const store = createFakeStore();
		const providerTurn = createProvider([
			{
				type: "supported",
				content: "the current window is too large",
				toolCalls: [
					{ id: "call-new-context", name: "new_context", arguments: {} },
				],
				usage: usage(),
				model: "api-model",
			},
			{
				type: "supported",
				content: "ready after fresh context",
				toolCalls: [
					{
						id: "call-final",
						name: "finalize_answer",
						arguments: { finalReport: "done after new context" },
					},
				],
				usage: usage(),
				model: "api-model",
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
				compiledPrompt: "raw compiled prompt",
				latestUserMessage:
					"<USER_REQUEST>\nimplement the requested change\n</USER_REQUEST>",
				contextSnapshot: {
					compiledPrompt: "raw compiled prompt",
					source: "fallback",
				},
			}),
			createSink(events),
		);

		expect(result).toMatchObject({
			terminalState: "completed",
			finalReport: "done after new context",
		});
		expect(providerTurn).toHaveBeenCalledTimes(2);
		const firstMessages = vi.mocked(providerTurn).mock.calls[0][0].messages;
		const secondMessages = vi.mocked(providerTurn).mock.calls[1][0].messages;
		expect(firstMessages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					role: "user",
					content:
						"<USER_REQUEST>\nimplement the requested change\n</USER_REQUEST>",
				}),
			]),
		);
		expect(secondMessages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					role: "user",
					content:
						"<USER_REQUEST>\nimplement the requested change\n</USER_REQUEST>",
				}),
			]),
		);
		expect(JSON.stringify(secondMessages)).not.toContain(
			"the current window is too large",
		);
		expect(JSON.stringify(secondMessages)).not.toContain("call-new-context");
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "tool_call_progress",
					payload: expect.objectContaining({
						action: "context_window_started",
						runtime: "native_api_runner",
					}),
				}),
			]),
		);
	});

	it("refreshes Todo state from the database before each provider turn", async () => {
		(repo.listTaskRunTodosForRun as never)
			.mockResolvedValueOnce([
				{
					seq: 1,
					title: "Implement runner",
					taskType: "implementation",
					status: "running",
					procedureId: null,
				},
			])
			.mockResolvedValueOnce([
				{
					seq: 1,
					title: "Implement runner",
					taskType: "implementation",
					status: "passed",
					procedureId: null,
				},
			])
			.mockResolvedValueOnce([]);
		const store = createFakeStore();
		const providerTurn = createProvider([
			{
				type: "supported",
				content: "need another turn",
				toolCalls: [
					{ id: "call-unknown", name: "unknown_tool", arguments: {} },
				],
				usage: usage(),
				model: "api-model",
			},
			{
				type: "supported",
				content: "finalize",
				toolCalls: [
					{
						id: "call-final",
						name: "finalize_answer",
						arguments: { finalReport: "done" },
					},
				],
				usage: usage(),
				model: "api-model",
			},
		]);
		const runner = new NativeApiRunner({
			store: store.instance,
			startupController: createNoopStartup(),
			providerTurn,
			usageRecorder: vi.fn(async () => undefined),
		});

		const result = await runner.run(buildContext(), createSink());

		expect(result.terminalState).toBe("completed");
		expect(providerTurn).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				messages: expect.arrayContaining([
					expect.objectContaining({
						role: "user",
						content: expect.stringContaining("seq=1 status=passed"),
					}),
				]),
			}),
		);
	});

	it("records provider tool calls against the latest running Todo instead of stale startup context", async () => {
		(repo.listTaskRunTodosForRun as never).mockResolvedValue([
			{
				seq: 1,
				title: "initial_instructions を実行する",
				taskType: "initial_instructions",
				status: "passed",
				procedureId: "contextstill.initial_instructions",
			},
			{
				seq: 2,
				title: "context_compile を実行する",
				taskType: "context_compile",
				status: "passed",
				procedureId: "contextstill.context_compile",
			},
			{
				seq: 3,
				title: "Implement Todo list UI",
				taskType: "implementation",
				status: "running",
				procedureId: null,
			},
		]);
		const store = createFakeStore();
		const providerTurn = createProvider([
			{
				type: "supported",
				content: "inspect unknown path",
				toolCalls: [
					{ id: "call-unknown", name: "unknown_tool", arguments: {} },
				],
				usage: usage(),
				model: "api-model",
			},
		]);
		const runner = new NativeApiRunner({
			store: store.instance,
			startupController: createNoopStartup(),
			providerTurn,
			usageRecorder: vi.fn(async () => undefined),
		});

		await runner.run(
			buildContext({
				currentTodo: {
					id: "todo-1",
					seq: 1,
					title: "initial_instructions を実行する",
					taskType: "initial_instructions",
					status: "running",
					procedureId: "contextstill.initial_instructions",
				},
			}),
			createSink(),
		);

		expect(store.toolCalls[0]).toMatchObject({
			toolName: "unknown_tool",
			todoSeq: 3,
		});
		expect(providerTurn).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: expect.arrayContaining([
					expect.objectContaining({
						role: "user",
						content: expect.stringContaining("title=Implement Todo list UI"),
					}),
				]),
			}),
		);
	});

	it("records dispatcher exceptions as failed tool results instead of leaving running records", async () => {
		(repo.listTaskRunTodosForRun as never)
			.mockResolvedValueOnce([])
			.mockRejectedValueOnce(new Error("database is locked"));
		const store = createFakeStore();
		const providerTurn = createProvider([
			{
				type: "supported",
				content: "try finalize",
				toolCalls: [
					{
						id: "call-final",
						name: "finalize_answer",
						arguments: { finalReport: "done" },
					},
				],
				usage: usage(),
				model: "api-model",
			},
			{
				type: "supported",
				content: "dispatcher failed before completion",
				toolCalls: [],
				usage: usage(),
				model: "api-model",
			},
		]);
		const runner = new NativeApiRunner({
			store: store.instance,
			startupController: createNoopStartup(),
			providerTurn,
			usageRecorder: vi.fn(async () => undefined),
		});

		const result = await runner.run(buildContext(), createSink());

		expect(result).toMatchObject({
			terminalState: "needs_human",
			stoppedBy: "missing_tool_call",
		});
		expect(store.finishedToolCalls[0]).toMatchObject({
			id: "tool-1",
			status: "failed",
			error: {
				code: "TOOL_DISPATCH_EXCEPTION",
				message: "database is locked",
			},
		});
		expect(store.finishedTurns[0]).toMatchObject({ status: "completed" });
	});

	it("aborts the active provider turn and does not execute returned tools after stop", async () => {
		const store = createFakeStore();
		let providerStarted!: () => void;
		const providerStartedPromise = new Promise<void>((resolve) => {
			providerStarted = resolve;
		});
		let observedSignal: AbortSignal | undefined;
		const providerTurn = vi.fn(
			async (
				input: Parameters<NativeApiToolTurnProvider>[0],
			): Promise<ProviderToolTurnResult> => {
				observedSignal = input.signal;
				providerStarted();
				await new Promise((_resolve, reject) => {
					input.signal?.addEventListener(
						"abort",
						() => reject(new Error("provider request aborted")),
						{ once: true },
					);
				});
				throw new Error("unreachable");
			},
		) as unknown as NativeApiToolTurnProvider;
		const runner = new NativeApiRunner({
			store: store.instance,
			startupController: createNoopStartup(),
			providerTurn,
			usageRecorder: vi.fn(async () => undefined),
		});

		const resultPromise = runner.run(buildContext(), createSink());
		await providerStartedPromise;
		await runner.stop("run-1");
		const result = await resultPromise;

		expect(observedSignal?.aborted).toBe(true);
		expect(result).toMatchObject({
			terminalState: "cancelled",
			stoppedBy: "cancelled",
		});
		expect(store.toolCalls).toHaveLength(0);
		expect(store.finishedTurns[0]).toMatchObject({ status: "cancelled" });
	});

	it("does not execute provider-returned tools when run status was cancelled after provider turn", async () => {
		(repo.getTaskRun as never)
			.mockResolvedValueOnce({ id: "run-1", status: "running" })
			.mockResolvedValueOnce({ id: "run-1", status: "cancelled" });
		const store = createFakeStore();
		const providerTurn = createProvider([
			{
				type: "supported",
				content: "attempting to continue after stop",
				toolCalls: [
					{
						id: "call-final",
						name: "finalize_answer",
						arguments: { finalReport: "This should not finalize." },
					},
				],
				usage: usage(),
				model: "api-model",
			},
		]);
		const runner = new NativeApiRunner({
			store: store.instance,
			startupController: createNoopStartup(),
			providerTurn,
			usageRecorder: vi.fn(async () => undefined),
		});

		const result = await runner.run(buildContext(), createSink());

		expect(result).toMatchObject({
			terminalState: "cancelled",
			stoppedBy: "cancelled",
		});
		expect(store.toolCalls).toHaveLength(0);
		expect(store.finishedTurns[0]).toMatchObject({ status: "cancelled" });
		expect(repo.listTaskRunTodosForRun).toHaveBeenCalledOnce();
	});
});
