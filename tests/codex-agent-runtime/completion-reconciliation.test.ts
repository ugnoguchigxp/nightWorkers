import { describe, expect, it, vi } from "vitest";
import { CodexAgentRuntime } from "../../api/modules/codingAgent/runtime/CodexAgentRuntime";
import type {
	AgentRunContext,
	AgentRuntimeSink,
} from "../../api/modules/codingAgent/runtime/types";

describe("Codex completion reconciliation", () => {
	it("fails closed when the completion Run cannot be found", async () => {
		const runStreamed = vi.fn(async () => ({ events: events("完了候補") }));
		const evaluateCompletionCandidate = vi.fn().mockResolvedValue({
			allowFinalize: false,
			code: "RUN_NOT_FOUND",
			message: "run not found",
			missingConditions: [],
			snapshot: null,
			idempotent: false,
		});
		const runtime = new CodexAgentRuntime({
			threadFactory: () => ({ runStreamed }),
			evaluateCompletionCandidate,
		});

		const result = await runtime.start(context(), { emit: async () => {} });

		expect(result.terminalState).toBe("needs_review");
		expect(runStreamed).toHaveBeenCalledOnce();
	});

	it("[AC-012] preserves the candidate and continues the same thread", async () => {
		const runStreamed = vi
			.fn()
			.mockImplementationOnce(async () => ({
				events: events("最初の完了候補"),
			}))
			.mockImplementationOnce(async () => ({
				events: events("証跡確認後の完了候補"),
			}));
		const evaluateCompletionCandidate = vi
			.fn()
			.mockResolvedValueOnce({
				allowFinalize: false,
				code: "FINALIZE_RECONCILIATION_REQUIRED",
				message: "required condition evidence is missing",
				missingConditions: ["AC-001"],
				snapshot: { planRevision: 0, todos: [] },
				idempotent: false,
			})
			.mockResolvedValueOnce({
				allowFinalize: true,
				code: "FINALIZE_ALLOWED",
				message: "ready",
				missingConditions: [],
				snapshot: { planRevision: 0, todos: [] },
				idempotent: false,
			});
		const runtime = new CodexAgentRuntime({
			threadFactory: () => ({ runStreamed }),
			evaluateCompletionCandidate,
		});
		const emitted: unknown[] = [];
		const sink: AgentRuntimeSink = {
			emit: async (event) => {
				emitted.push(event);
			},
		};

		const result = await runtime.start(context(), sink);

		expect(result).toMatchObject({
			terminalState: "completed",
			finalReport: "証跡確認後の完了候補",
			testResults: {
				reconciliation: { count: 1, resolved: true },
			},
		});
		expect(runStreamed).toHaveBeenCalledTimes(2);
		const recoveryInput = runStreamed.mock.calls[1]?.[0];
		expect(recoveryInput).toEqual(expect.stringContaining("最初の完了候補"));
		expect(recoveryInput).toEqual(
			expect.stringContaining("FINALIZE_RECONCILIATION_REQUIRED"),
		);
		expect(emitted).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "runtime_warning",
					payload: expect.objectContaining({
						code: "CODEX_COMPLETION_RECONCILIATION_REQUIRED",
					}),
				}),
				expect.objectContaining({
					type: "verification_finished",
					payload: expect.objectContaining({
						code: "CODEX_COMPLETION_ASSURANCE_PASSED",
						reconciliationCount: 1,
						resolvedAfterReconciliation: true,
					}),
				}),
			]),
		);
	});

	it("allows only one recovery turn while Evidence Readiness stays unresolved", async () => {
		const runStreamed = vi.fn(async () => ({ events: events("完了候補") }));
		const unchanged = {
			allowFinalize: false,
			code: "FINALIZE_RECONCILIATION_REQUIRED" as const,
			message: "mapping is missing",
			missingConditions: ["evidence_mapping_missing"],
			snapshot: {
				planRevision: 0,
				todos: [],
				readiness: {
					verification: {
						result: { readinessDigest: "sha256:unchanged" },
					},
				},
			},
			idempotent: false,
		};
		const runtime = new CodexAgentRuntime({
			threadFactory: () => ({ runStreamed }),
			evaluateCompletionCandidate: vi.fn().mockResolvedValue(unchanged),
		});
		const emitted: Array<{ payload?: { code?: string } }> = [];

		const result = await runtime.start(context(), {
			emit: async (event) => emitted.push(event as never),
		});

		expect(result.terminalState).toBe("needs_review");
		expect(runStreamed).toHaveBeenCalledTimes(2);
		expect(emitted).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					payload: expect.objectContaining({
						code: "CODEX_COMPLETION_RECONCILIATION_LIMIT_REACHED",
					}),
				}),
			]),
		);
	});
});

async function* events(finalText: string) {
	yield { type: "thread.started", thread_id: "thread-1" };
	yield { type: "turn.started" };
	yield {
		type: "item.completed",
		item: { id: "message-1", type: "agent_message", text: finalText },
	};
	yield {
		type: "turn.completed",
		usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
	};
}

function context(): AgentRunContext {
	return {
		runId: "run-reconciliation",
		taskId: "task-reconciliation",
		repositoryId: "repository-reconciliation",
		repoRoot: process.cwd(),
		compiledPrompt: "implement",
		latestUserMessage: "implement",
		timeoutSeconds: 30,
		contextSnapshot: {
			compiledPrompt: "implement",
			source: "task_prompt",
		},
	};
}
