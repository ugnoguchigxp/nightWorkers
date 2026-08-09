import { verifyRenderedHash } from "s11tnext";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../../api/db/client";
import { verificationDocuments } from "../../api/db/verification-schema";
import {
	buildCodingAgentSystemContext,
	CODING_AGENT_SYSTEM_CONTEXT_VERSION,
} from "../../api/modules/codingAgent/context";
import { compactNativeApiHistoryToBaseline } from "../../api/modules/codingAgent/runtime/native-api-runner/native-api-context-compaction";
import type { NativeApiToolTurnProvider } from "../../api/modules/codingAgent/runtime/native-api-runner/native-api-runner";
import { NativeApiRunner } from "../../api/modules/codingAgent/runtime/native-api-runner/native-api-runner";
import { classifyNativeApiProviderError } from "../../api/modules/codingAgent/runtime/native-api-runner/native-api-runner-routing";
import {
	dispatchNativeApiToolCall,
	readProjectExplorationCatalogAccess,
} from "../../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-dispatcher";
import { buildInitialNativeApiHistory } from "../../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-history";
import { getNativeApiToolDefinitions } from "../../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-registry";
import type { AgentRunContext } from "../../api/modules/codingAgent/runtime/types";
import { TodoMutationService } from "../../api/modules/codingAgent/todo";
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
import { registerFixtureProviderToolTurns } from "../../api/services/structured-llm/fixture-tool-provider";
import { StructuredProviderError } from "../../api/services/structured-llm/provider-failure";

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
	const normalizedCommand =
		command.op === "replace_plan" && Array.isArray(command.todos)
			? {
					...command,
					todos: command.todos.map((todo) => ({
						...(todo as Record<string, unknown>),
						systemContext:
							(todo as Record<string, unknown>).systemContext ??
							"このTodoの目的と受け入れ条件を優先する。",
					})),
				}
			: command;
	return { id, name: "todo_list", arguments: { command: normalizedCommand } };
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
		expect(system?.content).toContain(
			"あなたはユーザーTaskを自動化するCoding Agentです",
		);
		expect(system?.content).toContain(
			`version="${CODING_AGENT_SYSTEM_CONTEXT_VERSION}"`,
		);
		expect(system?.content).toContain(
			"Todoはユーザーへ現在工程を表示し、あなたへ現在工程の局所指示を渡す外部作業記憶",
		);
		expect(system?.content).toContain("workspaceを変更する前にtodo_list");
		expect(system?.content).toContain("key、id、covers、constraints、doneWhen");
		expect(system?.content).toContain("Plan Modeで採用済みimplementationPlan");
		expect(system?.content).toContain("modules/[domain]");
		expect(system?.content).toContain("src/modules/[domain]");
		expect(system?.content).toContain(
			"route、service、repository、schema、typeなどを責務別に分けてdomain内",
		);
		expect(system?.content).toContain("確定Specを優先");
		expect(system?.content).toContain("既存domainは既存moduleを拡張");
		expect(system?.content).toContain('"availability":"unavailable"');
		expect(system?.content).toContain("project_exploration_catalogを呼ばず");
		expect(system?.content).not.toContain("executionMode:");
		expect(system?.systemContextAudit).toEqual([
			expect.objectContaining({
				promptPart: "system",
				manifest: expect.objectContaining({
					key: "codingAgent.native-runtime",
					renderedHash: expect.stringMatching(/^sha256:/),
				}),
			}),
		]);
		expect(
			verifyRenderedHash(
				system?.content ?? "",
				system?.systemContextAudit?.[0]?.manifest.renderedHash ?? "",
			),
		).toBe(true);
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
		expect(system?.content).toContain('"availability":"available"');
		expect(system?.content).toContain(
			"最初のTodo計画、read_current_specification、list_dir、search_files、read_fileより前にproject_exploration_catalog",
		);
		expect(system?.content).toContain("既知の候補fileがあっても");
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

	it("bounds a large structured completion recovery during compaction", () => {
		const recovery = JSON.stringify({
			ok: false,
			error: {
				code: "FINALIZE_RECONCILIATION_REQUIRED",
				message: "readiness reconciliation required",
			},
			currentSnapshot: {
				readiness: {
					authority: { taskId: "task-1", runId: "run-1" },
					workspace: { sourceStateHash: "a".repeat(64) },
					verification: {
						applicability: "active",
						result: { ok: false, reason: "quality_gate_incomplete" },
					},
					discrepancies: Array.from({ length: 100 }, (_, index) => ({
						code: `missing-${index}`,
						summary: "x".repeat(1_000),
					})),
					satisfactionConditions: Array.from(
						{ length: 100 },
						(_, index) => `condition-${index}-${"y".repeat(1_000)}`,
					),
				},
			},
			currentSnapshotDigest: "sha256:snapshot",
			currentSnapshotRef: "runFinalizeController.currentSnapshot",
			finalCandidate: "candidate".repeat(20_000),
			currentRecoveryContext: {
				authoritativeContext: { taskId: "task-1", runId: "run-1" },
				recoveryRefs: [],
			},
		});
		const result = compactNativeApiHistoryToBaseline({
			baselineHistory: [{ type: "system", content: "system" }],
			previousHistory: [{ type: "user", source: "runtime", content: recovery }],
			reason: "budget",
		});
		const summary = result.history.find(
			(item) =>
				item.type === "user" && item.content.includes("Conversation Summary"),
		);

		expect(summary?.type).toBe("user");
		expect(summary?.content.length).toBeLessThan(6_000);
		expect(summary?.content).toContain("FINALIZE_RECONCILIATION_REQUIRED");
		expect(summary?.content).toContain("sha256:");
	});

	it("allows a simple Run without Todo and requires current Todo after a plan is adopted", async () => {
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
		const directResult = await dispatchNativeApiToolCall({
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
		expect(directResult.toolResult.error?.code).not.toBe(
			"CURRENT_TODO_REQUIRED",
		);

		await new TodoMutationService(
			buildCodingAgentSystemContext({
				taskGoal: "単一Coding Agentとして実装する。",
				registeredRepositoryRoot: repository.localPath,
			}),
			"agent",
		).execute(run.id, {
			op: "replace_plan",
			expectedPlanRevision: 0,
			todos: [
				{
					title: "実装する",
					systemContext: "この工程では既存契約を維持する。",
					nextAction: "対象を確認する。",
				},
			],
		});
		const plannedResult = await dispatchNativeApiToolCall({
			toolCall: {
				id: "call-read-after-plan",
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
		expect(plannedResult.toolResult).toMatchObject({
			ok: false,
			error: { code: "CURRENT_TODO_REQUIRED" },
		});
	});

	it("records Todo side effects in the run ledger", async () => {
		const { repository, task, run } = await createRuntimeRun("todo-ledger");
		const sink = { emit: vi.fn(async () => {}) };
		const result = await dispatchNativeApiToolCall({
			toolCall: todoCall("todo-ledger-call", {
				op: "plan",
				steps: [
					{
						title: "実装する",
						systemContext: "対象を確認して実装する。",
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
						command: expect.objectContaining({ op: "plan" }),
					}),
				}),
			}),
		);
	});

	it("runs the real Native loop and stops when the LLM pauses its Todo", async () => {
		process.env.NIGHTWORKERS_E2E_ISOLATED = "1";
		const { repository, task, run } = await createRuntimeRun("native-pause");
		registerFixtureProviderToolTurns(task.id, [
			{
				content: "計画を作成します。",
				toolCalls: [
					todoCall("plan", {
						op: "plan",
						steps: [
							{
								title: "確認して実装する",
								systemContext:
									"ユーザー確認が必要か調べ、判断が確定してから実装する。",
							},
						],
					}),
				],
			},
			{
				content: "選択肢についてユーザーの判断が必要です。",
				toolCalls: [
					todoCall("pause", {
						op: "block_current",
						humanBlocker: {
							question: "A案とB案のどちらを採用しますか？",
							requiredInput: "decision",
							basis: { kind: "task_context" },
						},
					}),
				],
			},
			{
				content: "A案とB案のどちらを採用しますか？",
				toolCalls: [],
			},
		]);

		const emit = vi.fn(async () => {});
		const result = await new NativeApiRunner({
			usageRecorder: async () => {},
		}).run(
			context({
				runId: run.id,
				taskId: task.id,
				repositoryId: repository.id,
			}),
			{ emit },
		);

		expect(result).toMatchObject({
			terminalState: "needs_human",
			stoppedBy: "decision",
			humanActionRequired: true,
			finalReport: "A案とB案のどちらを採用しますか？",
		});
		expect(await listTaskRunTodosForRun(run.id)).toMatchObject([
			{ todoKey: "step-1", status: "needs_human" },
		]);
	});

	it("stops on an empty assistant turn without retrying it as a new turn", async () => {
		process.env.NIGHTWORKERS_E2E_ISOLATED = "1";
		const { repository, task, run } = await createRuntimeRun("native-empty");
		registerFixtureProviderToolTurns(task.id, [
			{
				content: "",
				toolCalls: [
					todoCall("plan", {
						op: "plan",
						steps: [
							{
								title: "完了させる",
								systemContext: "実装と検証を完了させる。",
							},
						],
					}),
				],
			},
			{ content: "", toolCalls: [] },
			{
				content: "完了状態へ更新します。",
				toolCalls: [
					todoCall("pass", {
						op: "complete_current",
						note: "検証済み",
					}),
				],
			},
			{ content: "実装と検証が完了しました。", toolCalls: [] },
		]);

		const emit = vi.fn(async () => {});
		const result = await new NativeApiRunner({
			usageRecorder: async () => {},
		}).run(
			context({
				runId: run.id,
				taskId: task.id,
				repositoryId: repository.id,
			}),
			{ emit },
		);

		expect(result).toMatchObject({
			terminalState: "failed",
			finalReport: "Provider returned no native tool calls or content.",
			stoppedBy: "llm_error",
		});
		expect(await listTaskRunTodosForRun(run.id)).toMatchObject([
			{ todoKey: "step-1", status: "running" },
		]);
		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "model_response_failed",
				payload: expect.objectContaining({
					failureKind: "empty_no_tool_calls",
					retryable: false,
				}),
			}),
		);
		const terminalTurnEvents = emit.mock.calls.filter(
			([event]) =>
				event.type === "turn_finished" && event.payload?.turnIndex === 2,
		);
		expect(terminalTurnEvents).toHaveLength(1);
		expect(terminalTurnEvents[0]?.[0]).toMatchObject({
			payload: { status: "failed" },
		});
	});

	it("returns the same verification readiness differences in the Native loop", async () => {
		process.env.NIGHTWORKERS_E2E_ISOLATED = "1";
		const { repository, task, run } = await createRuntimeRun(
			"native-readiness-reconciliation",
		);
		await db.insert(verificationDocuments).values({
			taskId: task.id,
			runId: run.id,
			sourceSpecPath: "spec/docs/native-readiness.md",
			documentJson: {},
			generatedAt: new Date(),
			status: "active",
		});
		const inputs: Parameters<NativeApiToolTurnProvider>[0][] = [];
		const turns = [
			{
				content: "計画を作成します。",
				toolCalls: [
					todoCall("plan", {
						op: "plan",
						steps: [
							{
								title: "実装する",
								systemContext: "実装して検証する。",
							},
						],
					}),
				],
			},
			{
				content: "Todoを完了します。",
				toolCalls: [
					todoCall("pass", {
						op: "complete_current",
						note: "Todo上は完了した。",
					}),
				],
			},
			{ content: "実装と検証が完了しました。", toolCalls: [] },
		];
		const providerTurn: NativeApiToolTurnProvider = async (input) => {
			inputs.push(input);
			const turn = turns.shift();
			if (!turn) {
				throw new StructuredProviderError({
					kind: "authentication",
					retryable: false,
					message: "stop after readiness feedback",
				});
			}
			return {
				type: "supported",
				...turn,
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
				repoRoot: process.cwd(),
			}),
			{ emit: vi.fn(async () => {}) },
		);

		expect(inputs).toHaveLength(4);
		expect(inputs[0].options.systemContextAudit).toEqual([
			expect.objectContaining({
				promptPart: "system",
				manifest: expect.objectContaining({
					key: "codingAgent.native-runtime",
				}),
			}),
		]);
		const feedback = inputs[3].messages.find(
			(message) =>
				message.role === "user" &&
				typeof message.content === "string" &&
				message.content.includes("FINALIZE_RECONCILIATION_REQUIRED"),
		);
		expect(feedback).toMatchObject({ role: "user" });
		expect(JSON.stringify(feedback)).toContain("project_verify_not_run");
		expect(JSON.stringify(feedback)).toContain("finalCandidate");
		expect(JSON.stringify(feedback)).toContain("実装と検証が完了しました。");
		expect(result).toMatchObject({
			terminalState: "failed",
			finalReport: "実装と検証が完了しました。",
		});
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
						systemContext: "再開前の目的と完了条件を維持する。",
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
			{ todoKey: todoId, status: "running", revision: 1 },
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
						op: "plan",
						steps: [
							{
								title: "変更する",
								systemContext: "対象を実装する。",
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

	it("retries a retryable failure on the same route before failing over", async () => {
		process.env.NIGHTWORKERS_E2E_ISOLATED = "1";
		const { repository, task, run } = await createRuntimeRun(
			"native-same-route-retry",
		);
		let callCount = 0;
		const emit = vi.fn(async () => {});
		const providerTurn: NativeApiToolTurnProvider = async () => {
			callCount += 1;
			if (callCount === 1) {
				throw new StructuredProviderError({
					kind: "provider_capacity",
					retryable: true,
					message: "provider is temporarily busy",
				});
			}
			if (callCount > 2) {
				throw new StructuredProviderError({
					kind: "authentication",
					retryable: false,
					message: "stop after retry proof",
				});
			}
			return {
				type: "supported",
				content: "同一routeの再試行後に応答しました。",
				toolCalls: [
					todoCall("plan-after-retry", {
						op: "plan",
						steps: [
							{
								title: "変更する",
								systemContext: "対象を実装する。",
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
			{ emit },
		);

		expect(callCount).toBe(3);
		expect(result).toMatchObject({
			terminalState: "failed",
			finalReport: "同一routeの再試行後に応答しました。",
		});
		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "tool_call_progress",
				payload: expect.objectContaining({
					action: "provider_same_route_retry_started",
					attemptIndex: 0,
					sameRouteAttemptIndex: 0,
					nextSameRouteAttemptIndex: 1,
				}),
			}),
		);
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
