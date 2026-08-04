import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexAgentRuntime } from "../../api/modules/codingAgent/runtime/CodexAgentRuntime";
import {
	completedTextEvents,
	completionAllowed,
	createCodexRuntimeContext as context,
} from "./codex-runtime-test-fixtures";

afterEach(() => vi.useRealTimers());

describe("Codex SDK runtime deadline and stream closeout", () => {
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

	it("finishes after turn.completed without waiting for the provider stream to close", async () => {
		let index = 0;
		const events: AsyncIterable<unknown> = {
			[Symbol.asyncIterator]() {
				return {
					async next() {
						index += 1;
						if (index === 1) {
							return {
								done: false as const,
								value: {
									type: "item.completed",
									item: {
										id: "message-1",
										type: "agent_message",
										text: "実装完了",
									},
								},
							};
						}
						if (index === 2) {
							return {
								done: false as const,
								value: {
									type: "turn.completed",
									usage: {
										input_tokens: 1,
										cached_input_tokens: 0,
										output_tokens: 1,
									},
								},
							};
						}
						return new Promise<never>(() => {});
					},
					return: () => new Promise<never>(() => {}),
				};
			},
		};

		const result = await new CodexAgentRuntime({
			threadFactory: () => ({ runStreamed: async () => ({ events }) }),
			usageRecorder: async () => {},
			evaluateCompletionCandidate: completionAllowed,
		}).start(context(), { emit: vi.fn(async () => {}) });

		expect(result).toMatchObject({
			terminalState: "completed",
			finalReport: "実装完了",
		});
	});

	it("enforces the host deadline when the provider iterator ignores abort", async () => {
		vi.useFakeTimers();
		const emit = vi.fn(async () => {});
		const runtime = new CodexAgentRuntime({
			threadFactory: () => ({
				runStreamed: async () => ({
					events: {
						[Symbol.asyncIterator]() {
							return {
								next: () => new Promise<never>(() => {}),
								return: () => new Promise<never>(() => {}),
							};
						},
					} as AsyncIterable<unknown>,
				}),
			}),
			usageRecorder: async () => {},
		});
		const resultPromise = runtime.start(
			{ ...context(), timeoutSeconds: 1 },
			{ emit },
		);

		await vi.advanceTimersByTimeAsync(1_000);

		expect(await resultPromise).toMatchObject({
			terminalState: "timed_out",
			stoppedBy: "budget",
		});
		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "runtime_error",
				payload: expect.objectContaining({
					code: "CODEX_STREAM_DEADLINE_EXCEEDED",
				}),
			}),
		);
	});

	it("requires review when turn.completed leaves provider items open", async () => {
		const emit = vi.fn(async () => {});
		const events = (async function* () {
			yield {
				type: "item.started",
				item: {
					id: "command-1",
					type: "command_execution",
					command: "git status --short",
					status: "in_progress",
				},
			};
			yield* completedTextEvents("実装は完了しました。");
		})();
		const result = await new CodexAgentRuntime({
			threadFactory: () => ({ runStreamed: async () => ({ events }) }),
			usageRecorder: async () => {},
		}).start(context(), { emit });

		expect(result).toMatchObject({
			terminalState: "needs_review",
			stoppedBy: "tool_failure",
			riskLevel: "high",
		});
		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "runtime_warning",
				payload: expect.objectContaining({
					code: "PROVIDER_TERMINAL_WITH_OPEN_ITEMS",
					openItems: [{ id: "command-1", type: "command_execution" }],
				}),
			}),
		);
	});
});
