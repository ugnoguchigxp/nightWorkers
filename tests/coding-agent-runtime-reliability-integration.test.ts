import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildCodingAgentSystemContext } from "../api/modules/codingAgent/context";
import {
	requestContextMismatchToMcp,
	resolveRequestScopedIdentity,
} from "../api/modules/codingAgent/mcp/nightworkers-codex-mcp-support";
import { CodexAgentRuntime } from "../api/modules/codingAgent/runtime/CodexAgentRuntime";
import { createCodexRuntimeThread } from "../api/modules/codingAgent/runtime/codex-sdk/codex-sdk-client";
import { buildCodexRuntimePromptParts } from "../api/modules/codingAgent/runtime/codex-sdk/codex-sdk-runtime-prompt";
import type { AgentRunContext } from "../api/modules/codingAgent/runtime/types";
import { TodoMutationService } from "../api/modules/codingAgent/todo";
import {
	createRepository,
	createTask,
	createTaskRun,
	deleteRepository,
} from "../api/modules/nightworkers/nightworkers.repository";
import { runCommandTool } from "../api/services/worker-tools";

describe("Coding Agent runtime reliability integration", () => {
	it("recovers the incident chain without losing authority, evidence, or the final candidate", async () => {
		const repoRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "nightworkers-runtime-reliability-"),
		);
		const repository = await createRepository({
			name: `TEST: runtime-reliability-${crypto.randomUUID()}`,
			localPath: repoRoot,
			branch: "main",
			allowed: true,
		});
		try {
			const task = await createTask({
				repositoryId: repository.id,
				title: "Todo APIのexact path障害を復旧する",
				status: "running",
			});
			const [firstRun, recoveryRun] = await Promise.all([
				createTaskRun({
					taskId: task.id,
					repositoryId: repository.id,
					status: "running",
				}),
				createTaskRun({
					taskId: task.id,
					repositoryId: repository.id,
					status: "running",
				}),
			]);
			const systemContext = buildCodingAgentSystemContext({
				taskGoal: "Todo APIのexact path障害を復旧する。",
				registeredRepositoryRoot: repoRoot,
			});
			const todoService = new TodoMutationService(systemContext, "agent");
			const planCommand = {
				op: "replace_plan" as const,
				expectedPlanRevision: 0,
				todos: ["inspect", "api", "verify"].map((todoKey) => ({
					todoKey,
					title: `${todoKey}を実行する`,
					systemContext: "失敗結果を保持し、正本repositoryで検証する。",
				})),
			};
			const [firstPlan, recoveryPlan] = await Promise.all([
				todoService.execute(firstRun.id, planCommand),
				todoService.execute(recoveryRun.id, planCommand),
			]);
			expect(firstPlan.ok).toBe(true);
			expect(recoveryPlan.ok).toBe(true);
			if (!firstPlan.ok || !recoveryPlan.ok) return;
			expect(firstPlan.todos.map((todo) => todo.todoKey)).toEqual([
				"inspect",
				"api",
				"verify",
			]);
			expect(recoveryPlan.todos[0]?.id).not.toBe(firstPlan.todos[0]?.id);

			const authority = resolveRequestScopedIdentity({
				context: { taskId: task.id, runId: recoveryRun.id },
				suppliedTaskId: task.id,
				suppliedRunId: firstRun.id,
			});
			const retryArguments = {
				runId: recoveryRun.id,
				command: {
					op: "start",
					todoId: recoveryPlan.todos[0]?.id,
					expectedTodoRevision: recoveryPlan.todos[0]?.revision,
				},
			};
			const mismatch = await requestContextMismatchToMcp({
				toolName: "todo_list",
				resolution: authority,
				retryArguments,
			});
			expect(mismatch.structuredContent).toMatchObject({
				error: { code: "REQUEST_CONTEXT_MISMATCH" },
				payload: {
					intentStatus: "not_executed",
					guidance: {
						authoritativeContext: { runId: recoveryRun.id },
						retryArguments,
					},
				},
			});
			expect(firstPlan.todos.every((todo) => todo.status === "pending")).toBe(
				true,
			);
			const corrected = await todoService.execute(recoveryRun.id, {
				op: "start",
				todoId: recoveryPlan.todos[0]?.id ?? "",
				expectedTodoRevision: recoveryPlan.todos[0]?.revision ?? -1,
			});
			expect(corrected.currentTodo).toMatchObject({
				todoKey: "inspect",
				status: "running",
			});

			const runtimeContext = context({
				runId: recoveryRun.id,
				taskId: task.id,
				repositoryId: repository.id,
				repoRoot,
			});
			const promptParts = buildCodexRuntimePromptParts(runtimeContext);
			expect(promptParts.prompt).toContain("<PROJECT_STATE_CARD>");
			expect(promptParts.prompt).toContain("JSON parse error");
			expect(promptParts.prompt).toContain("prior final candidate");

			const resumeEvents: unknown[] = [];
			const freshInputs: unknown[] = [];
			const thread = await createCodexRuntimeThread({
				context: runtimeContext,
				codexClient: {
					resumeThread: () => {
						throw new Error("no rollout found for thread id thread-missing");
					},
					startThread: () => ({
						runStreamed: async (prompt) => {
							freshInputs.push(prompt);
							return { events: completedEvents("fresh fallback restored") };
						},
					}),
				},
				onResumeEvent: (event) => {
					resumeEvents.push(event);
				},
			});
			const fallbackTurn = await thread.runStreamed(promptParts.prompt, {
				signal: new AbortController().signal,
			});
			for await (const _event of fallbackTurn.events) void _event;
			expect(freshInputs).toEqual([
				expect.stringContaining("JSON parse error"),
			]);
			expect(resumeEvents).toEqual([
				expect.objectContaining({
					status: "resume_failed",
					error: "no rollout found for thread id thread-missing",
				}),
				expect.objectContaining({ status: "fallback_started" }),
			]);

			const failedCheck = await runCommandTool({
				command: "echo '404 GET /api/todos/' | grep '200' | head -1",
				repoRoot,
			});
			expect(failedCheck).toMatchObject({
				ok: false,
				error: { code: "COMMAND_FAILED" },
				payload: {
					exitCode: 1,
					cwd: repoRoot,
					repositoryRoot: repoRoot,
					command: expect.stringContaining("/api/todos/"),
				},
			});
			const successfulCheck = await runCommandTool({
				command: "echo '200 GET /api/todos/' | grep '200' | head -1",
				repoRoot,
			});
			expect(successfulCheck).toMatchObject({
				ok: true,
				payload: {
					exitCode: 0,
					stdout: "200 GET /api/todos/\n",
				},
			});

			const candidateInputs: unknown[] = [];
			const runStreamed = vi
				.fn()
				.mockImplementationOnce(async (prompt) => {
					candidateInputs.push(prompt);
					return { events: completedEvents("元Taskの最初の完了候補") };
				})
				.mockImplementationOnce(async (prompt) => {
					candidateInputs.push(prompt);
					return {
						events: completedEvents("Todo APIのexact path復旧と検証が完了"),
					};
				});
			const runtime = new CodexAgentRuntime({
				threadFactory: () => ({ runStreamed }),
				evaluateCompletionCandidate: vi
					.fn()
					.mockResolvedValueOnce({
						allowFinalize: false,
						code: "FINALIZE_RECONCILIATION_REQUIRED",
						message: "verification evidence is missing",
						missingConditions: ["exact-path-evidence"],
						snapshot: { planRevision: 1, todos: corrected.todos },
						idempotent: false,
					})
					.mockResolvedValueOnce({
						allowFinalize: true,
						code: "FINALIZE_ALLOWED",
						message: "ready",
						missingConditions: [],
						snapshot: { planRevision: 1, todos: [] },
						idempotent: false,
					}),
			});
			const result = await runtime.start(runtimeContext, {
				emit: async () => {},
			});
			expect(result).toMatchObject({
				terminalState: "completed",
				finalReport: "Todo APIのexact path復旧と検証が完了",
				testResults: {
					reconciliation: { count: 1, resolved: true },
				},
			});
			expect(candidateInputs[1]).toEqual(
				expect.stringContaining("元Taskの最初の完了候補"),
			);
		} finally {
			await deleteRepository(repository.id);
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	});
});

function context(input: {
	runId: string;
	taskId: string;
	repositoryId: string;
	repoRoot: string;
}): AgentRunContext {
	return {
		...input,
		compiledPrompt: "Todo APIのexact path障害を復旧する。",
		latestUserMessage: "JSON parse errorを解消して再検証してください。",
		timeoutSeconds: 30,
		contextSnapshot: {
			compiledPrompt: "Todo APIのexact path障害を復旧する。",
			source: "task_prompt",
			codexPrompt: {
				request: "JSON parse errorを解消して再検証してください。",
				stateCardText: [
					"過去error 1: JSON parse error",
					"過去error 2: SQLite table missing",
					"過去error 3: GET /api/todos/ returned 404",
					"実行済み操作: migrationとfocused test",
					"prior final candidate: API修正候補",
				].join("\n"),
			},
			runtimeResume: {
				kind: "codex_thread",
				providerThreadId: "thread-missing",
			},
		},
		runtimeOptions: {
			runtimeResume: {
				kind: "codex_thread",
				providerThreadId: "thread-missing",
			},
		},
	};
}

async function* completedEvents(finalText: string) {
	yield { type: "thread.started", thread_id: "thread-fresh" };
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
