import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createRepository,
	createTask,
	createTaskRun,
	deleteRepository,
} from "../../api/modules/nightworkers/nightworkers.repository";
import { CodexAgentRuntime } from "../../api/services/agent-runtime/CodexAgentRuntime";
import { createCodexRuntimeThread } from "../../api/services/agent-runtime/codex-sdk/codex-sdk-client";
import { buildCodexRuntimePromptParts } from "../../api/services/agent-runtime/codex-sdk/codex-sdk-runtime-prompt";
import type { AgentRunContext } from "../../api/services/agent-runtime/types";
import { buildCodingAgentSystemContext } from "../../api/services/coding-agent-context";
import { TodoMutationService } from "../../api/services/todo-mutation";

const repositoryIds: string[] = [];

afterEach(async () => {
	vi.useRealTimers();
	for (const id of repositoryIds.splice(0)) await deleteRepository(id);
});

function context(executionMode: string): AgentRunContext {
	const systemContext = buildCodingAgentSystemContext({
		taskGoal: "同じTaskを単一Coding Agentで処理する。",
		registeredRepositoryRoot: "/tmp/codex-llm-owned",
	});
	return {
		runId: "run-codex-contract",
		taskId: "task-codex-contract",
		repositoryId: "repo-codex-contract",
		repoRoot: "/tmp/codex-llm-owned",
		compiledPrompt: systemContext.taskGoal,
		latestUserMessage: systemContext.taskGoal,
		timeoutSeconds: 30,
		contextSnapshot: {
			compiledPrompt: systemContext.taskGoal,
			source: "task_prompt",
			executionMode,
		},
		runtimeOptions: { executionMode },
		codingAgentSystemContext: systemContext,
	};
}

async function createRuntimeRun(title: string) {
	const repository = await createRepository({
		name: `${title}-${crypto.randomUUID()}`,
		localPath: "/tmp/codex-llm-owned",
		branch: "main",
		allowed: true,
	});
	repositoryIds.push(repository.id);
	const task = await createTask({
		repositoryId: repository.id,
		title,
		status: "running",
	});
	const run = await createTaskRun({
		taskId: task.id,
		repositoryId: repository.id,
		status: "running",
	});
	return { repository, task, run };
}

function completedTextEvents(text: string): AsyncIterable<unknown> {
	return (async function* () {
		yield {
			type: "item.completed",
			item: { id: crypto.randomUUID(), type: "agent_message", text },
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

describe("Codex SDK LLM-owned Todo contract", () => {
	it("uses the same runtime contract for every legacy mode value", () => {
		const implementation = buildCodexRuntimePromptParts(
			context("implementation"),
		);
		const test = buildCodexRuntimePromptParts(context("test"));
		const review = buildCodexRuntimePromptParts(context("review"));
		expect(test.runtimeContract).toBe(implementation.runtimeContract);
		expect(review.runtimeContract).toBe(implementation.runtimeContract);
		expect(review.runtimeContract).toContain("Todo");
		expect(review.runtimeContract).toContain(
			"ユーザーPromptから計画要否を判断し",
		);
		expect(review.runtimeContract).toContain(
			"計画、実装、テスト・証跡確認、変更差分のReviewと修正、完了報告",
		);
		expect(review.runtimeContract).toContain(
			"実装後に仕様書や完了条件を後付けして検証を始めず",
		);
		expect(review.runtimeContract).not.toContain("executionMode:");
		expect(review.runtimeContract).not.toContain("reviewer_evaluation");
	});

	it("does not start a fresh thread when resume fails", async () => {
		const resumeThread = vi.fn(() => {
			throw new Error("resume rejected");
		});
		const startThread = vi.fn();
		const onResumeEvent = vi.fn();
		await expect(
			createCodexRuntimeThread({
				context: {
					...context("implementation"),
					runtimeOptions: {
						runtimeResume: {
							kind: "codex_thread",
							providerThreadId: "thread-old",
						},
					},
				},
				codexClient: { resumeThread, startThread },
				onResumeEvent,
			}),
		).rejects.toThrow("resume rejected");
		expect(startThread).not.toHaveBeenCalled();
		expect(onResumeEvent).toHaveBeenCalledWith(
			expect.objectContaining({ status: "resume_failed" }),
		);
	});

	it("returns needs_human when the LLM-owned Todo is paused", async () => {
		const { repository, task, run } = await createRuntimeRun("codex-pause");
		const todoId = crypto.randomUUID();
		const runContext = {
			...context("implementation"),
			runId: run.id,
			taskId: task.id,
			repositoryId: repository.id,
		};
		const mutations = new TodoMutationService(
			runContext.codingAgentSystemContext,
			"llm",
		);
		await mutations.execute(run.id, {
			op: "replace_plan",
			expectedPlanRevision: 0,
			todos: [
				{
					id: todoId,
					title: "仕様を確認する",
					nextAction: "質問する",
					acceptanceCriteria: [],
				},
			],
		});
		await mutations.execute(run.id, {
			op: "start",
			todoId,
			expectedTodoRevision: 0,
		});
		await mutations.execute(run.id, {
			op: "transition",
			todoId,
			expectedTodoRevision: 1,
			status: "needs_human",
			reason: "選択が必要です",
		});
		const runStreamed = vi.fn(async () => ({
			events: completedTextEvents("A案とB案のどちらを採用しますか？"),
		}));
		const runtime = new CodexAgentRuntime({
			threadFactory: () => ({ runStreamed }),
			usageRecorder: async () => {},
		});

		const result = await runtime.start(runContext, {
			emit: vi.fn(async () => {}),
		});

		expect(runStreamed).toHaveBeenCalledOnce();
		expect(result).toMatchObject({
			terminalState: "needs_human",
			stoppedBy: "decision",
			finalReport: "A案とB案のどちらを採用しますか？",
		});
	});

	it("pauses at the model-turn limit while preserving the running Todo", async () => {
		const { repository, task, run } = await createRuntimeRun("codex-budget");
		const todoId = crypto.randomUUID();
		const runContext = {
			...context("implementation"),
			runId: run.id,
			taskId: task.id,
			repositoryId: repository.id,
		};
		const mutations = new TodoMutationService(
			runContext.codingAgentSystemContext,
			"llm",
		);
		await mutations.execute(run.id, {
			op: "replace_plan",
			expectedPlanRevision: 0,
			todos: [
				{
					id: todoId,
					title: "実装を続ける",
					nextAction: "残りを変更する",
					acceptanceCriteria: [],
				},
			],
		});
		await mutations.execute(run.id, {
			op: "start",
			todoId,
			expectedTodoRevision: 0,
		});
		const runtime = new CodexAgentRuntime({
			threadFactory: () => ({
				runStreamed: async () => ({
					events: completedTextEvents("まだ実装途中です。"),
				}),
			}),
			usageRecorder: async () => {},
			maxModelTurns: 1,
		});

		const result = await runtime.start(runContext, {
			emit: vi.fn(async () => {}),
		});

		expect(result).toMatchObject({
			terminalState: "needs_human",
			stoppedBy: "budget",
			finalReport: "まだ実装途中です。",
		});
	});

	it("returns a Todo contract violation to the model before the next turn", async () => {
		const { repository, task, run } = await createRuntimeRun(
			"codex-todo-feedback",
		);
		const runContext = {
			...context("implementation"),
			runId: run.id,
			taskId: task.id,
			repositoryId: repository.id,
		};
		const inputs: unknown[] = [];
		const runStreamed = vi.fn(async (input: unknown) => {
			inputs.push(input);
			if (inputs.length === 1) {
				return {
					events: (async function* () {
						yield {
							type: "item.completed",
							item: {
								id: "file-change-1",
								type: "file_change",
								changes: [{ path: "src/a.ts", kind: "update" }],
								status: "completed",
							},
						};
						yield {
							type: "item.completed",
							item: {
								id: "message-1",
								type: "agent_message",
								text: "変更しました。",
							},
						};
						yield {
							type: "turn.completed",
							usage: {
								input_tokens: 10,
								cached_input_tokens: 0,
								output_tokens: 10,
							},
						};
					})(),
				};
			}
			return { events: failedEvents("stop after feedback") };
		});
		const runtime = new CodexAgentRuntime({
			threadFactory: () => ({ runStreamed }),
			usageRecorder: async () => {},
			maxModelTurns: 2,
		});

		const result = await runtime.start(runContext, {
			emit: vi.fn(async () => {}),
		});

		expect(runStreamed).toHaveBeenCalledTimes(2);
		expect(inputs[1]).toEqual(expect.stringContaining("CURRENT_TODO_REQUIRED"));
		expect(inputs[1]).toEqual(
			expect.stringContaining("codex_file_change_without_current_todo"),
		);
		expect(result.terminalState).toBe("failed");
	});

	it("does not retry from provider error message wording", async () => {
		const runStreamed = vi.fn(async () => ({
			events: failedEvents("Selected model is at capacity"),
		}));
		const threadFactory = vi.fn(() => ({ runStreamed }));
		const runtime = new CodexAgentRuntime({
			threadFactory,
			usageRecorder: async () => {},
		});

		const result = await runtime.start(context("implementation"), {
			emit: vi.fn(async () => {}),
		});

		expect(threadFactory).toHaveBeenCalledOnce();
		expect(runStreamed).toHaveBeenCalledOnce();
		expect(result).toMatchObject({
			terminalState: "failed",
			stoppedBy: "llm_error",
		});
	});

	it("preserves cancellation when the provider reports an error after abort", async () => {
		const controller = new AbortController();
		const runtime = new CodexAgentRuntime({
			threadFactory: () => ({
				runStreamed: async () => ({
					events: (async function* () {
						controller.abort(new Error("user cancelled"));
						yield {
							type: "turn.failed",
							error: { message: "aborted provider turn" },
						};
					})(),
				}),
			}),
			usageRecorder: async () => {},
		});

		const result = await runtime.start(
			context("implementation"),
			{ emit: vi.fn(async () => {}) },
			controller.signal,
		);

		expect(result).toMatchObject({
			terminalState: "cancelled",
			stoppedBy: "cancelled",
		});
	});

	it("preserves a timeout pause when the provider reports an abort error", async () => {
		vi.useFakeTimers();
		const runtime = new CodexAgentRuntime({
			threadFactory: () => ({
				runStreamed: async (
					_input: unknown,
					options: { signal: AbortSignal },
				) => ({
					events: (async function* () {
						await new Promise<void>((resolve) => {
							if (options.signal.aborted) {
								resolve();
								return;
							}
							options.signal.addEventListener("abort", () => resolve(), {
								once: true,
							});
						});
						yield {
							type: "turn.failed",
							error: { message: "aborted provider turn" },
						};
					})(),
				}),
			}),
			usageRecorder: async () => {},
		});
		const resultPromise = runtime.start(
			{ ...context("implementation"), timeoutSeconds: 1 },
			{ emit: vi.fn(async () => {}) },
		);

		await vi.advanceTimersByTimeAsync(1_000);
		const result = await resultPromise;

		expect(result).toMatchObject({
			terminalState: "needs_human",
			stoppedBy: "budget",
		});
	});
});
