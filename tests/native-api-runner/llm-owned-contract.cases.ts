import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createRepository,
	createTask,
	createTaskRun,
	deleteRepository,
	getTaskRun,
	listTaskRunTodosForRun,
	updateTaskRun,
} from "../../api/modules/nightworkers/nightworkers.repository";
import { activateTaskRunResume } from "../../api/modules/nightworkers/run-orchestration/resume-task-run-activation";
import {
	buildRuntimePauseSnapshot,
	carryRuntimePauseSnapshot,
	readRuntimePauseSnapshot,
} from "../../api/modules/nightworkers/run-orchestration/runtime-outcome-guard";
import { compactNativeApiHistoryToBaseline } from "../../api/services/agent-runtime/native-api-runner/native-api-context-compaction";
import type { NativeApiToolTurnProvider } from "../../api/services/agent-runtime/native-api-runner/native-api-runner";
import { NativeApiRunner } from "../../api/services/agent-runtime/native-api-runner/native-api-runner";
import { classifyNativeApiProviderError } from "../../api/services/agent-runtime/native-api-runner/native-api-runner-routing";
import {
	dispatchNativeApiToolCall,
	readProjectExplorationCatalogAccess,
} from "../../api/services/agent-runtime/native-api-runner/native-api-tool-dispatcher";
import { buildInitialNativeApiHistory } from "../../api/services/agent-runtime/native-api-runner/native-api-tool-history";
import { getNativeApiToolDefinitions } from "../../api/services/agent-runtime/native-api-runner/native-api-tool-registry";
import type { AgentRunContext } from "../../api/services/agent-runtime/types";
import { buildCodingAgentSystemContext } from "../../api/services/coding-agent-context";
import { registerFixtureProviderToolTurns } from "../../api/services/structured-llm/fixture-tool-provider";
import { StructuredProviderError } from "../../api/services/structured-llm/provider-failure";
import { TodoMutationService } from "../../api/services/todo-mutation";

const repositoryIds: string[] = [];

afterEach(async () => {
	for (const id of repositoryIds.splice(0)) await deleteRepository(id);
	delete process.env.NIGHTWORKERS_E2E_ISOLATED;
});

function context(overrides: Partial<AgentRunContext> = {}): AgentRunContext {
	const systemContext = buildCodingAgentSystemContext({
		taskGoal: "単一Coding Agentとして実装する。",
		registeredRepositoryRoot: "/tmp/native-llm-owned",
	});
	return {
		runId: "run-native-contract",
		taskId: "task-native-contract",
		repositoryId: "repo-native-contract",
		repoRoot: "/tmp/native-llm-owned",
		compiledPrompt: systemContext.taskGoal,
		latestUserMessage: systemContext.taskGoal,
		timeoutSeconds: 30,
		contextSnapshot: {
			compiledPrompt: systemContext.taskGoal,
			source: "task_prompt",
		},
		codingAgentSystemContext: systemContext,
		...overrides,
	};
}

async function createRuntimeRun(title: string) {
	const repository = await createRepository({
		name: `${title}-${crypto.randomUUID()}`,
		localPath: "/tmp/native-llm-owned",
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

function todoCall(id: string, command: Record<string, unknown>) {
	return { id, name: "todo_list", arguments: { command } };
}

describe("Native API LLM-owned Todo contract", () => {
	it("publishes one capability-based catalog independent of legacy mode and Todo metadata", () => {
		const base = getNativeApiToolDefinitions().map((tool) => tool.name);
		const legacyInputs = getNativeApiToolDefinitions({
			ontologyMcpEnabled: false,
		}).map((tool) => tool.name);
		expect(legacyInputs).toEqual(base);
		expect(base).toContain("todo_list");
		expect(base).toContain("apply_patch");
		expect(base).not.toContain("finalize_answer");
		expect(base).not.toContain("new_context");
		expect(base).not.toContain("reviewer_evaluation");
	});

	it("injects the versioned Japanese system context", () => {
		const history = buildInitialNativeApiHistory(context());
		const system = history.find((item) => item.type === "system");
		expect(system?.content).toContain("NightWorkers Coding Agent Runtime");
		expect(system?.content).toContain("current Todo");
		expect(system?.content).toContain("単一Coding Agentとして実装する");
		expect(system?.content).toContain('"version": 3');
		expect(system?.content).toContain("ユーザーPromptから計画要否を判断し");
		expect(system?.content).toContain("局所SystemContext兼リマインダー");
		expect(system?.content).toContain(
			"Task名だけから最終的な実装Todoを作らない",
		);
		expect(system?.content).toContain(
			"quality gate、verify、template/import、安全・権限",
		);
		expect(system?.content).toContain(
			"計画、実装、テスト・証跡確認、変更差分のReviewと修正、完了報告",
		);
		expect(system?.content).toContain(
			"実装後に仕様書や完了条件を後付けして検証を始めず",
		);
		expect(system?.content).toContain('"availability": "unavailable"');
		expect(system?.content).toContain("project_exploration_catalogを呼ばず");
		expect(system?.content).not.toContain("executionMode:");
	});

	it("instructs the LLM to use available Static Intelligence before broad exploration", () => {
		const history = buildInitialNativeApiHistory(
			context({
				contextSnapshot: {
					compiledPrompt: "実装する",
					source: "task_prompt",
					projectExplorationCatalog: {
						version: 2,
						available: true,
						serverId: "server-1",
						toolName: "vuln_get_project_exploration_catalog",
						preparedAt: "2026-07-15T00:00:00.000Z",
						preparationStatus: "ready",
						freshness: {
							status: "current",
							sourceRevisionKind: "git",
							sourceRevisionValue: "abc123",
						},
						readiness: {
							codeStructure: "available",
							reasonCodes: [],
						},
						preparation: {
							reused: true,
							durationMs: 10,
							pollCount: 0,
						},
					},
				},
			}),
		);
		const system = history.find((item) => item.type === "system");
		expect(system?.content).toContain('"availability": "available"');
		expect(system?.content).toContain(
			"広いlist_dirやsearch_filesより先にproject_exploration_catalog",
		);
		expect(system?.content).toContain("候補fileをread_file等で確認");
	});

	it("keeps the registered projectPath separate from the execution worktree", () => {
		const runContext = context({
			repoRoot: "/execution/worktree",
			contextSnapshot: {
				compiledPrompt: "実装する",
				source: "task_prompt",
				request: {
					registeredRepositoryPath: "/registered/repository",
					repositoryPath: "/execution/worktree",
				},
				projectExplorationCatalog: {
					version: 2,
					available: true,
					serverId: "server-1",
					toolName: "vuln_get_project_exploration_catalog",
					preparedAt: "2026-07-15T00:00:00.000Z",
					preparationStatus: "ready",
					freshness: {
						status: "current",
						sourceRevisionKind: "git",
						sourceRevisionValue: "abc123",
					},
					readiness: { codeStructure: "available", reasonCodes: [] },
					preparation: { reused: true, durationMs: 10, pollCount: 0 },
				},
			},
		});
		expect(readProjectExplorationCatalogAccess(runContext)).toEqual({
			serverId: "server-1",
			projectPath: "/registered/repository",
			expectedHead: "abc123",
		});
	});

	it("keeps a conversation summary and Todo context during compaction", () => {
		const result = compactNativeApiHistoryToBaseline({
			baselineHistory: [{ type: "system", content: "system" }],
			previousHistory: [
				{ type: "user", source: "user", content: "request" },
				{ type: "assistant", content: "investigated" },
			],
			reason: "budget",
			todoSnapshotItem: {
				type: "user",
				source: "todo",
				content: "planRevision=2",
			},
			currentTodoItem: {
				type: "user",
				source: "todo",
				content: "nextAction=verify",
			},
		});
		expect(
			result.history.some(
				(item) =>
					item.type === "user" && item.content.includes("Conversation Summary"),
			),
		).toBe(true);
		expect(
			result.history.some(
				(item) => item.type === "user" && item.content === "planRevision=2",
			),
		).toBe(true);
		expect(
			result.history.some(
				(item) => item.type === "user" && item.content === "nextAction=verify",
			),
		).toBe(true);
	});

	it("rejects workspace tools until a current Todo exists", async () => {
		const repository = await createRepository({
			name: `native-contract-${crypto.randomUUID()}`,
			localPath: "/tmp/native-llm-owned",
			branch: "main",
			allowed: true,
		});
		repositoryIds.push(repository.id);
		const task = await createTask({
			repositoryId: repository.id,
			title: "Native contract",
			status: "running",
		});
		const run = await createTaskRun({
			taskId: task.id,
			repositoryId: repository.id,
			status: "running",
		});
		const sink = { emit: vi.fn(async () => {}) };
		const result = await dispatchNativeApiToolCall({
			toolCall: {
				id: "call-read",
				name: "read_file",
				arguments: { filePath: "README.md" },
			},
			context: context({
				runId: run.id,
				taskId: task.id,
				repositoryId: repository.id,
			}),
			sink,
			state: { readFiles: [], postImport: null },
		});
		expect(result.toolResult).toMatchObject({
			ok: false,
			error: { code: "CURRENT_TODO_REQUIRED" },
		});
		expect(sink.emit).not.toHaveBeenCalled();
	});

	it("records Todo side effects in the run ledger", async () => {
		const { repository, task, run } = await createRuntimeRun("todo-ledger");
		const sink = { emit: vi.fn(async () => {}) };
		const result = await dispatchNativeApiToolCall({
			toolCall: todoCall("todo-ledger-call", {
				op: "replace_plan",
				expectedPlanRevision: 0,
				todos: [
					{
						id: crypto.randomUUID(),
						title: "実装する",
						nextAction: "対象を確認する",
					},
				],
			}),
			context: context({
				runId: run.id,
				taskId: task.id,
				repositoryId: repository.id,
			}),
			sink,
			state: { readFiles: [], postImport: null },
		});
		expect(result.toolResult.ok).toBe(true);
		expect(sink.emit).toHaveBeenCalledTimes(2);
		expect(sink.emit).toHaveBeenLastCalledWith(
			expect.objectContaining({
				type: "tool_call_finished",
				payload: expect.objectContaining({
					toolName: "todo_list",
					ok: true,
					arguments: expect.objectContaining({
						command: expect.objectContaining({ op: "replace_plan" }),
					}),
				}),
			}),
		);
	});

	it("runs the real Native loop and stops when the LLM pauses its Todo", async () => {
		process.env.NIGHTWORKERS_E2E_ISOLATED = "1";
		const { repository, task, run } = await createRuntimeRun("native-pause");
		const todoId = crypto.randomUUID();
		registerFixtureProviderToolTurns(task.id, [
			{
				content: "計画を作成します。",
				toolCalls: [
					todoCall("plan", {
						op: "replace_plan",
						expectedPlanRevision: 0,
						todos: [
							{
								id: todoId,
								title: "確認して実装する",
								objective: "確認事項を解消して実装する",
								nextAction: "ユーザー確認が必要か調べる",
								acceptanceCriteria: ["判断が確定している"],
							},
						],
					}),
				],
			},
			{
				content: "Todoを開始します。",
				toolCalls: [
					todoCall("start", {
						op: "start",
						todoId,
						expectedTodoRevision: 0,
					}),
				],
			},
			{
				content: "選択肢についてユーザーの判断が必要です。",
				toolCalls: [
					todoCall("pause", {
						op: "transition",
						todoId,
						expectedTodoRevision: 1,
						status: "needs_human",
						reason: "仕様の選択が必要です",
					}),
				],
			},
			{
				content: "A案とB案のどちらを採用しますか？",
				toolCalls: [],
			},
		]);

		const result = await new NativeApiRunner({
			usageRecorder: async () => {},
		}).run(
			context({
				runId: run.id,
				taskId: task.id,
				repositoryId: repository.id,
			}),
			{ emit: vi.fn(async () => {}) },
		);

		expect(result).toMatchObject({
			terminalState: "needs_human",
			stoppedBy: "decision",
			finalReport: "A案とB案のどちらを採用しますか？",
		});
		expect(await listTaskRunTodosForRun(run.id)).toMatchObject([
			{ id: todoId, status: "needs_human" },
		]);
	});

	it("does not treat an empty assistant turn as completion", async () => {
		process.env.NIGHTWORKERS_E2E_ISOLATED = "1";
		const { repository, task, run } = await createRuntimeRun("native-empty");
		const todoId = crypto.randomUUID();
		registerFixtureProviderToolTurns(task.id, [
			{
				content: "",
				toolCalls: [
					todoCall("plan", {
						op: "replace_plan",
						expectedPlanRevision: 0,
						todos: [
							{
								id: todoId,
								title: "完了させる",
								nextAction: "実行する",
								acceptanceCriteria: [],
							},
						],
					}),
				],
			},
			{
				content: "",
				toolCalls: [
					todoCall("start", {
						op: "start",
						todoId,
						expectedTodoRevision: 0,
					}),
				],
			},
			{ content: "", toolCalls: [] },
			{
				content: "完了状態へ更新します。",
				toolCalls: [
					todoCall("pass", {
						op: "transition",
						todoId,
						expectedTodoRevision: 1,
						status: "passed",
						reason: "検証済み",
					}),
				],
			},
			{ content: "実装と検証が完了しました。", toolCalls: [] },
		]);

		const result = await new NativeApiRunner({
			usageRecorder: async () => {},
		}).run(
			context({
				runId: run.id,
				taskId: task.id,
				repositoryId: repository.id,
			}),
			{ emit: vi.fn(async () => {}) },
		);

		expect(result).toMatchObject({
			terminalState: "completed",
			finalReport: "実装と検証が完了しました。",
		});
		expect(await listTaskRunTodosForRun(run.id)).toMatchObject([
			{ id: todoId, status: "passed" },
		]);
	});

	it("resumes a host-limited run without changing its running Todo", async () => {
		const { task, run } = await createRuntimeRun("native-host-resume");
		const todoId = crypto.randomUUID();
		const mutations = new TodoMutationService(
			context().codingAgentSystemContext,
			"llm",
		);
		expect(
			await mutations.execute(run.id, {
				op: "replace_plan",
				expectedPlanRevision: 0,
				todos: [
					{
						id: todoId,
						title: "処理を継続する",
						nextAction: "残りを実行する",
						acceptanceCriteria: [],
					},
				],
			}),
		).toMatchObject({ ok: true });
		expect(
			await mutations.execute(run.id, {
				op: "start",
				todoId,
				expectedTodoRevision: 0,
			}),
		).toMatchObject({ ok: true });
		const runtimePause = buildRuntimePauseSnapshot({
			terminalState: "needs_human",
			summary: "turn limit",
			finalReport: "途中経過",
			stoppedBy: "budget",
			riskLevel: "high",
		});
		await updateTaskRun(run.id, {
			status: "needs_human",
			endedAt: new Date(),
			finishedAt: new Date(),
			contextSnapshot: carryRuntimePauseSnapshot(
				{ compiledPrompt: "再開用prompt" },
				{ runtimePause },
			),
		});

		const resumed = await activateTaskRunResume({
			kind: "runtime_pause",
			runId: run.id,
			todoId,
			expectedTodoRevision: 1,
			userContext: "続けてください",
		});

		expect(resumed.status).toBe("running");
		expect(resumed.endedAt).toBeNull();
		expect(resumed.finishedAt).toBeNull();
		const storedRun = await getTaskRun(run.id);
		if (!storedRun) throw new Error("resumed run disappeared");
		expect(storedRun.status).toBe("running");
		expect(
			(storedRun.contextSnapshot as Record<string, unknown>).runtimePause,
		).toBeNull();
		expect(await listTaskRunTodosForRun(run.id)).toMatchObject([
			{ id: todoId, status: "running", revision: 1 },
		]);
		expect((await getTaskRun(run.id))?.taskId).toBe(task.id);
	});

	it("accepts only typed budget pauses as resumable host limits", () => {
		const budgetPause = buildRuntimePauseSnapshot({
			terminalState: "needs_human",
			summary: "budget",
			finalReport: "途中経過",
			stoppedBy: "budget",
			riskLevel: "high",
		});
		const toolFailurePause = buildRuntimePauseSnapshot({
			terminalState: "needs_human",
			summary: "tool failure",
			finalReport: "失敗",
			stoppedBy: "tool_failure",
			riskLevel: "high",
		});

		expect(budgetPause).not.toBeNull();
		expect(toolFailurePause).toBeNull();
		expect(
			readRuntimePauseSnapshot({
				runtimePause: {
					version: 1,
					kind: "host_limit",
					stoppedBy: "unexpected_reason",
					resumableRunningTodo: true,
				},
			}),
		).toBeNull();
		expect(
			carryRuntimePauseSnapshot(
				{ compiledPrompt: "next" },
				{ runtimePause: budgetPause },
			),
		).toMatchObject({
			compiledPrompt: "next",
			runtimePause: { stoppedBy: "budget" },
		});
	});

	it("preserves the latest LLM body when a later provider call fails", async () => {
		process.env.NIGHTWORKERS_E2E_ISOLATED = "1";
		const { repository, task, run } = await createRuntimeRun("native-body");
		const todoId = crypto.randomUUID();
		let callCount = 0;
		const providerTurn: NativeApiToolTurnProvider = async () => {
			callCount += 1;
			if (callCount > 1) {
				throw new StructuredProviderError({
					kind: "authentication",
					retryable: false,
					message: "認証設定を確認してください",
				});
			}
			return {
				type: "supported",
				content: "調査した結果、変更対象はここまで特定できました。",
				toolCalls: [
					todoCall("plan", {
						op: "replace_plan",
						expectedPlanRevision: 0,
						todos: [
							{
								id: todoId,
								title: "変更する",
								nextAction: "実装する",
								acceptanceCriteria: [],
							},
						],
					}),
				],
				usage: {
					inputTokens: 10,
					outputTokens: 10,
					cachedInputTokens: 0,
					reasoningOutputTokens: 0,
					totalTokens: 20,
					mode: "measured",
				},
				model: "fixture-native-tools",
			};
		};

		const result = await new NativeApiRunner({
			providerTurn,
			usageRecorder: async () => {},
		}).run(
			context({
				runId: run.id,
				taskId: task.id,
				repositoryId: repository.id,
			}),
			{ emit: vi.fn(async () => {}) },
		);

		expect(callCount).toBe(2);
		expect(result).toMatchObject({
			terminalState: "failed",
			finalReport: "調査した結果、変更対象はここまで特定できました。",
		});
	});

	it("retries only provider failures explicitly marked retryable", () => {
		const authentication = classifyNativeApiProviderError(
			new StructuredProviderError({
				kind: "authentication",
				retryable: false,
				message: "invalid credential",
			}),
			{ attemptTimedOut: false },
		);
		const transport = classifyNativeApiProviderError(
			new StructuredProviderError({
				kind: "transport",
				retryable: true,
				message: "connection reset",
			}),
			{ attemptTimedOut: false },
		);

		expect(authentication).toMatchObject({
			reason: "provider_authentication",
			retryable: false,
		});
		expect(transport).toMatchObject({
			reason: "provider_transport",
			retryable: true,
		});
	});
});
