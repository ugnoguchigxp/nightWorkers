import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexAgentRuntime } from "../../api/modules/codingAgent/runtime/CodexAgentRuntime";
import { createCodexRuntimeThread } from "../../api/modules/codingAgent/runtime/codex-sdk/codex-sdk-client";
import {
	buildCodexRuntimeSdkOptions,
	buildCodexRuntimeThreadOptions,
} from "../../api/modules/codingAgent/runtime/codex-sdk/codex-sdk-runtime-config";
import {
	buildCodexRuntimeDeveloperInstructions,
	buildCodexRuntimePromptParts,
} from "../../api/modules/codingAgent/runtime/codex-sdk/codex-sdk-runtime-prompt";
import type { AgentRunContext } from "../../api/modules/codingAgent/runtime/types";

afterEach(() => vi.useRealTimers());

function context(executionMode = "implementation"): AgentRunContext {
	return {
		runId: "run-codex-contract",
		taskId: "task-codex-contract",
		repositoryId: "repo-codex-contract",
		repoRoot: "/tmp/codex-llm-owned",
		compiledPrompt: "fallback request",
		latestUserMessage: "ユーザーの実装依頼",
		timeoutSeconds: 30,
		contextSnapshot: {
			compiledPrompt: "fallback request",
			source: "task_prompt",
			executionMode,
		},
		runtimeOptions: { executionMode },
	};
}

function completedTextEvents(text: string): AsyncIterable<unknown> {
	return (async function* () {
		yield {
			type: "item.completed",
			item: { id: "message-1", type: "agent_message", text },
		};
		yield {
			type: "turn.completed",
			usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 10 },
		};
	})();
}

function failedEvents(message: string): AsyncIterable<unknown> {
	return (async function* () {
		yield { type: "turn.failed", error: { message } };
	})();
}

function rejectedEvents(error: Error): AsyncIterable<unknown> {
	return {
		[Symbol.asyncIterator]() {
			return {
				async next() {
					throw error;
				},
			};
		},
	};
}

describe("Codex SDK thin runtime adapter", () => {
	it("keeps the request clean and promotes adaptive Todo guidance to developer instructions", () => {
		for (const mode of ["implementation", "test", "review"]) {
			const parts = buildCodexRuntimePromptParts(context(mode));
			const developerInstructions = buildCodexRuntimeDeveloperInstructions(
				context(mode),
			);
			expect(parts.prompt).toBe("ユーザーの実装依頼");
			expect(parts.prompt).not.toContain("<CODING_AGENT_SYSTEM_CONTEXT");
			expect(developerInstructions).toContain("<CODING_AGENT_SYSTEM_CONTEXT");
			expect(developerInstructions).toContain('todoPolicy="adaptive"');
			expect(developerInstructions).toContain("nightworkers.todo_list");
			expect(developerInstructions).toContain("modules/[domain]");
			expect(developerInstructions).toContain("src/modules/[domain]");
			expect(developerInstructions).toContain(
				"route、service、repository、schema、typeなどを責務別に分けてdomain内",
			);
			expect(developerInstructions).toContain(
				"画面内だけで使うcomponent、hooks、schema・type、API accessなどをdomain内",
			);
			expect(developerInstructions).toContain(
				"必要な事実確認のためのread-only調査を妨げず",
			);
			expect(developerInstructions).toContain(
				"質問、読み取り、一工程で安全に完結する小変更ではTodoを作らず直接",
			);
			expect(developerInstructions).not.toContain(
				"current Todoなしにworkspaceの読み取り",
			);
			expect(developerInstructions).not.toContain("Task Goal:");
			expect(developerInstructions).not.toContain("ユーザーの実装依頼");
			expect(developerInstructions).not.toContain('"failureRecoveryJa"');
			expect(developerInstructions.length).toBeLessThan(6_000);
			expect(parts.estimates.developerInstructionsTokens).toBeGreaterThan(0);
			expect(parts.request).toBe("ユーザーの実装依頼");
			expect(parts).not.toHaveProperty("runtimeContract");
		}
	});

	it("falls back to the compiled request when the latest message is blank", () => {
		const parts = buildCodexRuntimePromptParts({
			...context(),
			latestUserMessage: "  \n ",
			compiledPrompt: "fallback request",
		});
		expect(parts.prompt).toContain("fallback request");
	});

	it("promotes the current Todo SystemContext into developer instructions", () => {
		const developerInstructions = buildCodexRuntimeDeveloperInstructions({
			...context(),
			todoPlan: [
				{
					id: "todo-1",
					seq: 1,
					title: "migrationを追加する",
					taskType: "data_migration",
					status: "running",
					systemContext: "既存migrationを変更せずadditive migrationを作る。",
					nextAction: "既存DBからの更新を確認する。",
					acceptanceCriteria: ["新規DBと既存DBの両方で成功する"],
				},
			],
			currentTodo: {
				id: "todo-1",
				seq: 1,
				title: "migrationを追加する",
				taskType: "data_migration",
				status: "running",
				systemContext: "既存migrationを変更せずadditive migrationを作る。",
				nextAction: "既存DBからの更新を確認する。",
				acceptanceCriteria: ["新規DBと既存DBの両方で成功する"],
			},
		});

		expect(developerInstructions).toContain("<CURRENT_TODO_SYSTEM_CONTEXT");
		expect(developerInstructions).toContain(
			"SystemContext (highest-priority local instruction):",
		);
		expect(developerInstructions).toContain(
			"既存migrationを変更せずadditive migrationを作る。",
		);
	});

	it("injects a required request-scoped NightWorkers MCP without global config", () => {
		const options = buildCodexRuntimeSdkOptions({
			env: { PORT: "41234" },
			context: context(),
		});
		expect(options.config).toMatchObject({
			developer_instructions: expect.stringContaining("nightworkers.todo_list"),
			mcp_servers: {
				nightworkers: {
					url: "http://127.0.0.1:41234/mcp/nightworkers?taskId=task-codex-contract&runId=run-codex-contract",
					enabled: true,
					required: true,
					tools: {
						todo_list: { approval_mode: "approve" },
						run_check: { approval_mode: "approve" },
					},
				},
			},
		});
		expect(options.env).toEqual({ PORT: "41234" });
	});

	it("preserves a configured MCP endpoint while overriding Run identity", () => {
		const options = buildCodexRuntimeSdkOptions({
			env: {
				NIGHTWORKERS_CODEX_MCP_URL:
					"http://localhost:42000/custom/mcp?taskId=stale&tenant=local",
			},
			context: context(),
		});
		expect(options.config).toMatchObject({
			mcp_servers: {
				nightworkers: {
					url: "http://localhost:42000/custom/mcp?taskId=task-codex-contract&tenant=local&runId=run-codex-contract",
				},
			},
		});
	});

	it("inherits Codex reasoning effort when no route explicitly configures it", () => {
		const previousEffort = process.env.CODEX_MODEL_REASONING_EFFORT;
		delete process.env.CODEX_MODEL_REASONING_EFFORT;
		try {
			expect(buildCodexRuntimeThreadOptions(context())).not.toHaveProperty(
				"modelReasoningEffort",
			);
			expect(
				buildCodexRuntimeThreadOptions({
					...context(),
					runtimeOptions: { codex: { thinkingDepth: "high" } },
				}),
			).toMatchObject({ modelReasoningEffort: "high" });
		} finally {
			if (previousEffort === undefined) {
				delete process.env.CODEX_MODEL_REASONING_EFFORT;
			} else {
				process.env.CODEX_MODEL_REASONING_EFFORT = previousEffort;
			}
		}
	});

	it("starts a fresh thread when resume setup fails", async () => {
		const freshThread = {
			runStreamed: vi.fn(async () => ({
				events: completedTextEvents("fresh"),
			})),
		};
		const startThread = vi.fn(() => freshThread);
		const onResumeEvent = vi.fn();
		const thread = await createCodexRuntimeThread({
			context: {
				...context(),
				runtimeOptions: {
					runtimeResume: {
						kind: "codex_thread",
						providerThreadId: "thread-old",
					},
				},
			},
			codexClient: {
				resumeThread: () => {
					throw new Error("resume rejected");
				},
				startThread,
			},
			onResumeEvent,
		});
		expect(thread).toBe(freshThread);
		expect(startThread).toHaveBeenCalledOnce();
		expect(onResumeEvent).toHaveBeenCalledWith(
			expect.objectContaining({ status: "resume_failed" }),
		);
	});

	it("starts a fresh thread when a resumed stream fails before its first event", async () => {
		const startThread = vi.fn(() => ({
			runStreamed: vi.fn(async () => ({
				events: completedTextEvents("fresh"),
			})),
		}));
		const onResumeEvent = vi.fn();
		const thread = await createCodexRuntimeThread({
			context: {
				...context(),
				runtimeOptions: {
					runtimeResume: {
						kind: "codex_thread",
						providerThreadId: "thread-resumed",
					},
				},
			},
			codexClient: {
				resumeThread: () => ({
					runStreamed: async () => ({
						events: rejectedEvents(new Error("stream failed")),
					}),
				}),
				startThread,
			},
			onResumeEvent,
		});
		const turn = await thread.runStreamed("continue", {
			signal: new AbortController().signal,
		});
		const events = [];
		for await (const event of turn.events) events.push(event);
		expect(events).toHaveLength(2);
		expect(startThread).toHaveBeenCalledOnce();
		expect(onResumeEvent).toHaveBeenLastCalledWith(
			expect.objectContaining({ status: "resume_failed" }),
		);
	});

	it("does not retry a resumed stream after it emitted a provider event", async () => {
		const startThread = vi.fn();
		const thread = await createCodexRuntimeThread({
			context: {
				...context(),
				runtimeOptions: {
					runtimeResume: {
						kind: "codex_thread",
						providerThreadId: "thread-resumed",
					},
				},
			},
			codexClient: {
				resumeThread: () => ({
					runStreamed: async () => ({
						events: (async function* () {
							yield { type: "thread.started", thread_id: "thread-resumed" };
							throw new Error("stream failed after start");
						})(),
					}),
				}),
				startThread,
			},
		});
		const turn = await thread.runStreamed("continue", {
			signal: new AbortController().signal,
		});
		await expect(
			(async () => {
				for await (const _event of turn.events) void _event;
			})(),
		).rejects.toThrow("stream failed after start");
		expect(startThread).not.toHaveBeenCalled();
	});

	it("accepts the Codex final message without inspecting host Todo state", async () => {
		const runStreamed = vi.fn(async () => ({
			events: completedTextEvents("Codexが返した最終本文"),
		}));
		const result = await new CodexAgentRuntime({
			threadFactory: () => ({ runStreamed }),
			usageRecorder: async () => {},
		}).start(
			{
				...context(),
				todoPlan: [
					{
						id: "legacy",
						seq: 1,
						title: "open",
						taskType: "code_change",
						status: "running",
					},
				],
			},
			{ emit: vi.fn(async () => {}) },
		);
		expect(runStreamed).toHaveBeenCalledOnce();
		expect(result).toMatchObject({
			terminalState: "completed",
			finalReport: "Codexが返した最終本文",
		});
	});

	it("projects Codex native todo_list events as trace only", async () => {
		const emit = vi.fn(async () => {});
		const runStreamed = vi.fn(async () => ({
			events: (async function* () {
				yield {
					type: "item.updated",
					item: {
						id: "plan-1",
						type: "todo_list",
						items: [
							{ text: "調査", completed: true },
							{ text: "実装", completed: false },
						],
					},
				};
				yield* completedTextEvents("完了");
			})(),
		}));
		await new CodexAgentRuntime({
			threadFactory: () => ({ runStreamed }),
			usageRecorder: async () => {},
		}).start(context(), { emit });
		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "tool_call_progress",
				payload: expect.objectContaining({
					toolName: "codex.update_plan",
					providerItemType: "todo_list",
				}),
			}),
		);
		expect(runStreamed).toHaveBeenCalledOnce();
	});

	it("does not start a second turn after a file change and final response", async () => {
		const runStreamed = vi.fn(async () => ({
			events: (async function* () {
				yield {
					type: "item.completed",
					item: {
						id: "change-1",
						type: "file_change",
						changes: [{ path: "src/a.ts", kind: "update" }],
						status: "completed",
					},
				};
				yield* completedTextEvents("変更しました。");
			})(),
		}));
		const result = await new CodexAgentRuntime({
			threadFactory: () => ({ runStreamed }),
			usageRecorder: async () => {},
		}).start(context(), { emit: vi.fn(async () => {}) });
		expect(runStreamed).toHaveBeenCalledOnce();
		expect(result.terminalState).toBe("completed");
	});

	it("fails once when the provider completes without a final message", async () => {
		const emit = vi.fn(async () => {});
		const runStreamed = vi.fn(async () => ({
			events: (async function* () {
				yield {
					type: "turn.completed",
					usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 0 },
				};
			})(),
		}));
		const result = await new CodexAgentRuntime({
			threadFactory: () => ({ runStreamed }),
			usageRecorder: async () => {},
		}).start(context(), { emit });
		expect(runStreamed).toHaveBeenCalledOnce();
		expect(result.terminalState).toBe("failed");
		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "runtime_error",
				payload: expect.objectContaining({
					code: "PROVIDER_FINAL_RESPONSE_MISSING",
				}),
			}),
		);
	});

	it("records an explicit failure when the stream ends without a terminal event", async () => {
		const emit = vi.fn(async () => {});
		const result = await new CodexAgentRuntime({
			threadFactory: () => ({
				runStreamed: async () => ({
					events: (async function* () {
						yield {
							type: "item.completed",
							item: {
								id: "message-1",
								type: "agent_message",
								text: "途中の本文",
							},
						};
					})(),
				}),
			}),
			usageRecorder: async () => {},
		}).start(context(), { emit });
		expect(result.terminalState).toBe("failed");
		expect(result.finalReport).toBe("途中の本文");
		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "runtime_error",
				payload: expect.objectContaining({
					code: "PROVIDER_TURN_TERMINAL_EVENT_MISSING",
				}),
			}),
		);
	});

	it("keeps a completed Codex turn successful when usage persistence fails", async () => {
		const emit = vi.fn(async () => {});
		const result = await new CodexAgentRuntime({
			threadFactory: () => ({
				runStreamed: async () => ({
					events: completedTextEvents("実装完了"),
				}),
			}),
			persistRuntimeUsage: true,
			usageRecorder: async () => {
				throw new Error("usage database unavailable");
			},
		}).start(context(), { emit });
		expect(result).toMatchObject({
			terminalState: "completed",
			finalReport: "実装完了",
		});
		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "runtime_warning",
				payload: expect.objectContaining({
					code: "CODEX_USAGE_PERSIST_FAILED",
				}),
			}),
		);
	});

	it("keeps a completed Codex turn successful when post-run diff collection fails", async () => {
		const emit = vi.fn(async () => {});
		const result = await new CodexAgentRuntime({
			threadFactory: () => ({
				runStreamed: async () => ({
					events: completedTextEvents("実装完了"),
				}),
			}),
			collectWorkspaceDiff: true,
			usageRecorder: async () => {},
		}).start({ ...context(), repoRoot: "/dev/null" }, { emit });
		expect(result).toMatchObject({
			terminalState: "completed",
			finalReport: "実装完了",
		});
		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "runtime_warning",
				payload: expect.objectContaining({
					code: "CODEX_WORKSPACE_DIFF_COLLECTION_FAILED",
				}),
			}),
		);
	});

	it("does not retry based on provider error wording", async () => {
		const runStreamed = vi.fn(async () => ({
			events: failedEvents("Selected model is at capacity"),
		}));
		const result = await new CodexAgentRuntime({
			threadFactory: () => ({ runStreamed }),
			usageRecorder: async () => {},
		}).start(context(), { emit: vi.fn(async () => {}) });
		expect(runStreamed).toHaveBeenCalledOnce();
		expect(result).toMatchObject({
			terminalState: "failed",
			stoppedBy: "llm_error",
		});
	});

	it("preserves a startup failure in the final report and runtime log", async () => {
		const result = await new CodexAgentRuntime({
			threadFactory: () => ({
				runStreamed: async () => {
					throw new Error("thread resume state is unavailable");
				},
			}),
			usageRecorder: async () => {},
		}).start(context(), { emit: vi.fn(async () => {}) });

		expect(result).toMatchObject({
			terminalState: "failed",
			finalReport: "[System Error] thread resume state is unavailable",
		});
		expect(result.logContent).toContain(
			"[System Error] thread resume state is unavailable",
		);
	});

	it("keeps a non-fatal Codex item error as trace when the turn completes", async () => {
		const emit = vi.fn(async () => {});
		const runStreamed = vi.fn(async () => ({
			events: (async function* () {
				yield {
					type: "item.completed",
					item: {
						id: "warning-1",
						type: "error",
						message: "optional lookup failed",
					},
				};
				yield* completedTextEvents("別の方法で完了しました。");
			})(),
		}));
		const result = await new CodexAgentRuntime({
			threadFactory: () => ({ runStreamed }),
			usageRecorder: async () => {},
		}).start(context(), { emit });
		expect(result.terminalState).toBe("completed");
		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "runtime_warning",
				payload: expect.objectContaining({ error: "optional lookup failed" }),
			}),
		);
	});

	it("preserves cancellation when the caller aborts", async () => {
		const controller = new AbortController();
		const runtime = new CodexAgentRuntime({
			threadFactory: () => ({
				runStreamed: async () => ({
					events: (async function* () {
						controller.abort();
						yield { type: "turn.failed", error: { message: "aborted" } };
					})(),
				}),
			}),
			usageRecorder: async () => {},
		});
		const result = await runtime.start(
			context(),
			{ emit: vi.fn(async () => {}) },
			controller.signal,
		);
		expect(result.terminalState).toBe("cancelled");
	});

	it("aborts the active Codex stream when stop is requested", async () => {
		let streamStarted!: () => void;
		const started = new Promise<void>((resolve) => (streamStarted = resolve));
		const runtime = new CodexAgentRuntime({
			threadFactory: () => ({
				runStreamed: async (_input, options) => ({
					events: (async function* () {
						streamStarted();
						await new Promise<void>((resolve) =>
							options.signal.addEventListener("abort", () => resolve(), {
								once: true,
							}),
						);
						yield { type: "turn.failed", error: { message: "aborted" } };
					})(),
				}),
			}),
			usageRecorder: async () => {},
		});
		const resultPromise = runtime.start(context(), {
			emit: vi.fn(async () => {}),
		});
		await started;
		await runtime.stop(context().runId);
		expect((await resultPromise).terminalState).toBe("cancelled");
	});

	it("returns timed_out when the Codex stream reaches the host time limit", async () => {
		vi.useFakeTimers();
		const runtime = new CodexAgentRuntime({
			threadFactory: () => ({
				runStreamed: async (_input, options) => ({
					events: (async function* () {
						await new Promise<void>((resolve) =>
							options.signal.addEventListener("abort", () => resolve(), {
								once: true,
							}),
						);
						yield { type: "turn.failed", error: { message: "aborted" } };
					})(),
				}),
			}),
			usageRecorder: async () => {},
		});
		const resultPromise = runtime.start(
			{ ...context(), timeoutSeconds: 1 },
			{ emit: vi.fn(async () => {}) },
		);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(await resultPromise).toMatchObject({
			terminalState: "timed_out",
			stoppedBy: "budget",
		});
	});
});
