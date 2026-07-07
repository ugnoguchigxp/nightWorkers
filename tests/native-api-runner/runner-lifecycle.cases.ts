import { describe, expect, it, vi } from "vitest";
import * as repo from "../../api/modules/nightworkers/nightworkers.repository";
import { NativeApiRunner } from "../../api/services/agent-runtime/native-api-runner/native-api-runner";
import {
	buildInitialNativeApiHistory,
	sanitizeNativeApiResumeHistory,
} from "../../api/services/agent-runtime/native-api-runner/native-api-tool-history";
import type { AgentRuntimeEvent } from "../../api/services/agent-runtime/types";
import {
	buildContext,
	buildContextWithNativeApiRoute,
	buildRoleContextSnapshot,
	createFakeStore,
	createNoopStartup,
	createProvider,
	createSink,
	usage,
} from "./helpers";
import "./setup";

describe("NativeApiRunner lifecycle", () => {
	it("stops with needs_human when implementation provider returns text but no native tool calls", async () => {
		const store = createFakeStore();
		const providerTurn = createProvider([
			{
				type: "supported",
				content: "I will explain instead of using tools.",
				toolCalls: [],
				usage: usage(),
				model: "api-model",
			},
		]);
		const usageRecorder = vi.fn(async () => undefined);
		const runner = new NativeApiRunner({
			store: store.instance,
			startupController: createNoopStartup(),
			providerTurn,
			usageRecorder,
		});

		const result = await runner.run(buildContext(), createSink());

		expect(result).toMatchObject({
			terminalState: "needs_human",
			stoppedBy: "missing_tool_call",
			riskLevel: "high",
		});
		expect(result.finalReport).toContain("requires tool calls/finalize_answer");
		expect(store.turns).toHaveLength(1);
		expect(store.finishedTurns[0]).toMatchObject({ status: "failed" });
		expect(store.toolCalls).toHaveLength(0);
		expect(usageRecorder).toHaveBeenCalledOnce();
		expect(usageRecorder).toHaveBeenCalledWith(
			expect.objectContaining({
				promptPartTokenEstimates: expect.objectContaining({
					systemPromptTokens: expect.any(Number),
					userPromptTokens: expect.any(Number),
				}),
				promptPartObservabilityEnabled: true,
				metadataJson: expect.objectContaining({
					nonCachedInputTokens: null,
					contextBudget: expect.objectContaining({
						estimatedPromptTokens: expect.any(Number),
						largestModelVisibleMessageChars: expect.any(Number),
						compactedToolResultCount: expect.any(Number),
					}),
				}),
			}),
		);
	});

	it("records provider usage without prompt estimates when prompt observability is disabled", async () => {
		const store = createFakeStore();
		const providerTurn = createProvider([
			{
				type: "supported",
				content: "I will explain instead of using tools.",
				toolCalls: [],
				usage: usage(),
				model: "api-model",
			},
		]);
		const usageRecorder = vi.fn(async () => undefined);
		const runner = new NativeApiRunner({
			store: store.instance,
			startupController: createNoopStartup(),
			providerTurn,
			usageRecorder,
		});

		await runner.run(
			buildContext({
				runtimeOptions: {
					executionMode: "implementation",
					llmUsage: { promptPartObservabilityEnabled: false },
				},
			}),
			createSink(),
		);

		expect(usageRecorder).toHaveBeenCalledWith(
			expect.objectContaining({
				usage: expect.objectContaining({
					inputTokens: 10,
					outputTokens: 5,
					mode: "measured",
				}),
				promptPartTokenEstimates: undefined,
				promptPartObservabilityEnabled: false,
				metadataJson: expect.objectContaining({
					promptPartSource: null,
					promptPartObservabilityEnabled: false,
				}),
			}),
		);
	});

	it("allows text-only completion for general answers", async () => {
		const store = createFakeStore();
		const providerTurn = createProvider([
			{
				type: "supported",
				content: "Here is the answer.",
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

		const result = await runner.run(
			buildContext({ runtimeOptions: { executionMode: "general_answer" } }),
			createSink(),
		);

		expect(result).toMatchObject({
			terminalState: "completed",
			stoppedBy: "decision",
		});
		expect(result.finalReport).toBe("Here is the answer.");
		expect(store.finishedTurns[0]).toMatchObject({ status: "completed" });
	});

	it("does not re-add the initial current Todo context on the first provider turn", async () => {
		vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([
			{
				id: "todo-1",
				runId: "run-1",
				taskId: "task-1",
				seq: 1,
				title: "Implement the requested change",
				taskType: "implementation",
				status: "running",
				procedureId: "contextstill.context_compile",
			} as never,
		]);
		const store = createFakeStore();
		const providerTurn = vi.fn(async () => ({
			type: "supported" as const,
			content: "I will explain instead of using tools.",
			toolCalls: [],
			usage: usage(),
			model: "api-model",
		}));
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
					title: "Implement the requested change",
					taskType: "implementation",
					status: "running",
					procedureId: "contextstill.context_compile",
				},
			}),
			createSink(),
		);

		const request = providerTurn.mock.calls[0]?.[0];
		const serializedMessages = JSON.stringify(request?.messages ?? []);
		expect(
			serializedMessages.match(/\[Current Native API Runner Todo\]/g) ?? [],
		).toHaveLength(1);
		expect(
			serializedMessages.match(/\[Native API Runner Todo Snapshot\]/g) ?? [],
		).toHaveLength(1);
	});

	it("does not run fixed startup gates for review mode", async () => {
		const store = createFakeStore();
		const startupController = createNoopStartup();
		const providerTurn = createProvider([
			{
				type: "supported",
				content: "Review needs tool calls.",
				toolCalls: [],
				usage: usage(),
				model: "api-model",
			},
		]);
		const runner = new NativeApiRunner({
			store: store.instance,
			startupController,
			providerTurn,
			usageRecorder: vi.fn(async () => undefined),
		});

		await runner.run(
			buildContext({
				runtimeOptions: { executionMode: "review" },
				contextSnapshot: {
					compiledPrompt: "review the completed task",
					source: "fallback",
					executionMode: "review",
				},
			}),
			createSink(),
		);

		expect(startupController.runStartup).not.toHaveBeenCalled();
		expect(providerTurn).toHaveBeenCalledOnce();
	});

	it("persists provider-native tool lifecycle and completes on finalize_answer", async () => {
		const store = createFakeStore();
		const providerTurn = createProvider([
			{
				type: "supported",
				content: "ready to finalize",
				toolCalls: [
					{
						id: "call-final",
						name: "finalize_answer",
						arguments: {
							summary: "done",
							finalReport: "All requested native/API runner work is complete.",
						},
					},
				],
				usage: usage(),
			},
		]);
		const runner = new NativeApiRunner({
			store: store.instance,
			startupController: createNoopStartup(),
			providerTurn,
			usageRecorder: vi.fn(async () => undefined),
		});
		const events: AgentRuntimeEvent[] = [];

		const result = await runner.run(buildContext(), createSink(events));

		expect(result).toMatchObject({
			terminalState: "completed",
			summary: "done",
			stoppedBy: "decision",
		});
		expect(result.finalReport).toBe(
			"All requested native/API runner work is complete.",
		);
		expect(repo.listTaskRunTodosForRun).toHaveBeenCalledWith("run-1");
		expect(store.toolCalls).toEqual([
			expect.objectContaining({
				id: "tool-1",
				toolName: "finalize_answer",
				status: "pending",
			}),
		]);
		expect(store.runningToolCalls).toEqual(["tool-1"]);
		expect(store.finishedToolCalls[0]).toMatchObject({
			id: "tool-1",
			status: "completed",
			result: expect.objectContaining({ ok: true }),
		});
		expect(store.finishedTurns[0]).toMatchObject({ status: "completed" });
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "turn_started",
					payload: expect.objectContaining({
						runtime: "native_api_runner",
						toolCount: expect.any(Number),
					}),
				}),
			]),
		);
		expect(store.finishedTurns[0]).toMatchObject({
			status: "completed",
			model: "test-model",
		});
	});

	it("continues past the previous 20 provider-native turn ceiling", async () => {
		const store = createFakeStore();
		const providerTurn = createProvider([
			...Array.from({ length: 20 }, (_, index) => ({
				type: "supported" as const,
				content: `continue turn ${index + 1}`,
				toolCalls: [
					{
						id: `call-unknown-${index + 1}`,
						name: "unknown_tool",
						arguments: {},
					},
				],
				usage: usage(),
				model: "api-model",
			})),
			{
				type: "supported",
				content: "finalize after old ceiling",
				toolCalls: [
					{
						id: "call-final",
						name: "finalize_answer",
						arguments: { finalReport: "completed after turn 20" },
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
			terminalState: "completed",
			stoppedBy: "decision",
			finalReport: "completed after turn 20",
		});
		expect(providerTurn).toHaveBeenCalledTimes(21);
		expect(store.turns.at(-1)).toMatchObject({ turnIndex: 21 });
	});

	it("passes the resolved runtime route override into provider turns", async () => {
		const store = createFakeStore();
		const providerTurn = createProvider([
			{
				type: "supported",
				content: "ready to finalize",
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

		await runner.run(
			buildContext({
				runtimeOptions: {
					llmRouting: {
						override: {
							providerEndpointId: "local-api",
							model: "qwen-coder",
							thinkingDepth: "medium",
						},
					},
				},
			}),
			createSink(),
		);

		expect(providerTurn).toHaveBeenCalledWith(
			expect.objectContaining({
				options: expect.objectContaining({
					routeOverride: {
						providerEndpointId: "local-api",
						model: "qwen-coder",
						thinkingDepth: "medium",
					},
				}),
			}),
		);
	});

	it("adds role working context to initial history after user request and current Todo", () => {
		const history = buildInitialNativeApiHistory(
			buildContext({
				currentTodo: {
					id: "todo-1",
					seq: 1,
					title: "Implement role context",
					taskType: "implementation",
					status: "running",
					procedureId: "context.role",
				},
				contextSnapshot: {
					compiledPrompt: "implement",
					source: "fallback",
					roleContext: buildRoleContextSnapshot(),
				},
			}),
		);

		expect(
			history.map((item) => (item.type === "user" ? item.source : item.type)),
		).toEqual(["system", "user", "todo", "runtime"]);
		expect(history.at(-1)).toMatchObject({
			type: "user",
			source: "runtime",
			content: expect.stringContaining('<ROLE_WORKING_CONTEXT version="1"'),
		});
	});

	it("adds TodoList progress contract to native/API system prompt", () => {
		const history = buildInitialNativeApiHistory(buildContext());
		const system =
			history.find((item) => item.type === "system")?.content ?? "";

		expect(system).toContain(
			"TodoList pane がユーザーに見える進捗の source of truth",
		);
		expect(system).toContain("todo_list operation=list は診断専用");
		expect(system).toContain(
			"finalReport / finalize_answer の前に open Todo を確認",
		);
		expect(system).toContain(
			"ユーザーへ保存可否を Yes / No で質問せず、常に保存許可として扱ってください",
		);
		expect(system).toContain(
			"NightWorkers-managed gate の Todo に紐づく場合も",
		);
		expect(system).toContain("DB schema / migration / 永続化テーブル変更では");
		expect(system).toContain("DB migration を実行する");
		expect(system).toContain("data_migration.apply_migration");
		expect(system).toContain("ユーザー依頼にない独立検証 Todo を追加しない");
		expect(system).toContain(
			"migration ファイル、DB schema、DB bootstrap / seed / persistence table 定義を作成・更新する必要が分かった時点",
		);
		expect(system).toContain("todoListReplaceReason=newly_required_work");
		expect(system).toContain("隔離 DB の smoke だけ");
		expect(system).not.toContain("classify_goal と compile_module_context");
		expect(system).not.toContain("check_boundary");
	});

	it("includes ontology runtime snapshot in native/API system prompt", () => {
		const history = buildInitialNativeApiHistory(
			buildContext({
				contextSnapshot: {
					compiledPrompt: "implement the requested change",
					source: "fallback",
					ontologyMcp: { enabled: true, source: "project_meta_file_scale" },
					ontologyContext: {
						version: 1,
						available: true,
						primaryModule: "project-detail",
						secondaryModules: ["mission-planner"],
						summaryType: "task_scoped",
						taskGenerationEvidence: true,
						ownedPaths: ["api/modules/project-detail/**"],
						invariants: ["candidate-routing"],
						focusedVerification: [
							"bunx vitest run tests/project-detail-backend.test.ts",
						],
						boundaryWarnings: [],
						warnings: [],
					},
				},
			}),
		);
		const system =
			history.find((item) => item.type === "system")?.content ?? "";

		expect(system).toContain("Ontology runtime snapshot:");
		expect(system).toContain("primary module: project-detail");
		expect(system).toContain("task generation evidence: present");
		expect(system).toContain("Ontology closeout requirements:");
	});

	it("sanitizes native/API resume history without stale runtime context", () => {
		const sanitized = sanitizeNativeApiResumeHistory([
			{ type: "system", content: "stale system" },
			{ type: "user", source: "user", content: "previous user request" },
			{ type: "user", source: "todo", content: "stale todo" },
			{
				type: "assistant",
				content: "I will read the spec.",
				toolCalls: [
					{
						id: "call-read",
						name: "read_current_specification",
						arguments: {},
					},
				],
			},
			{
				type: "tool_result",
				toolCallId: "call-read",
				toolName: "read_current_specification",
				result: { ok: true, content: '{"ok":true}' },
			},
			{ type: "user", source: "runtime", content: "stale role context" },
			{ type: "assistant", content: "Previous turn completed." },
		]);

		expect(sanitized).toEqual([
			{ type: "user", source: "user", content: "previous user request" },
			{
				type: "assistant",
				content: "I will read the spec.",
				toolCalls: [
					{
						id: "call-read",
						name: "read_current_specification",
						arguments: {},
					},
				],
			},
			{
				type: "tool_result",
				toolCallId: "call-read",
				toolName: "read_current_specification",
				result: { ok: true, content: '{"ok":true}' },
			},
			{ type: "assistant", content: "Previous turn completed." },
		]);
		expect(
			sanitizeNativeApiResumeHistory([
				{
					type: "tool_result",
					toolCallId: "missing-call",
					toolName: "read_current_specification",
					result: { ok: true, content: "{}" },
				},
			]),
		).toBeNull();
		expect(
			sanitizeNativeApiResumeHistory([
				{
					type: "assistant",
					content: "incomplete",
					toolCalls: [{ id: "call-open", name: "read_file", arguments: {} }],
				},
			]),
		).toBeNull();
		expect(
			sanitizeNativeApiResumeHistory([
				{
					type: "assistant",
					content: "invalid tool calls",
					toolCalls: [{ name: "read_file", arguments: {} }],
				},
			]),
		).toBeNull();
	});

	it("trims native/API resume history to 16 valid items by default", () => {
		const sanitized = sanitizeNativeApiResumeHistory(
			Array.from({ length: 20 }, (_, index) => ({
				type: "user",
				source: "user",
				content: `previous user request ${index + 1}`,
			})),
		);

		expect(sanitized).toHaveLength(16);
		expect(sanitized?.[0]).toMatchObject({
			type: "user",
			content: "previous user request 5",
		});
	});

	it("trims native/API resume history to empty when maxItems is zero", () => {
		const sanitized = sanitizeNativeApiResumeHistory(
			[
				{
					type: "user",
					source: "user",
					content: "previous user request",
				},
			],
			{ maxItems: 0 },
		);

		expect(sanitized).toEqual([]);
	});

	it("does not retain orphan tool results when trimming native/API resume history", () => {
		const sanitized = sanitizeNativeApiResumeHistory(
			[
				{ type: "user", source: "user", content: "previous user request" },
				{
					type: "assistant",
					content: "I will read the spec.",
					toolCalls: [
						{
							id: "call-read",
							name: "read_current_specification",
							arguments: {},
						},
					],
				},
				{
					type: "tool_result",
					toolCallId: "call-read",
					toolName: "read_current_specification",
					result: { ok: true, content: '{"ok":true}' },
				},
			],
			{ maxItems: 1 },
		);

		expect(sanitized).toEqual([]);
	});

	it("restores sanitized completed native/API history before the fresh user request", async () => {
		const store = createFakeStore();
		const getLatestCompletedTurnForPreviousRun = vi.fn(async () => ({
			id: "turn-previous",
			runId: "run-previous",
			historyJson: [
				{ type: "system", content: "stale system prompt" },
				{ type: "user", source: "user", content: "previous request" },
				{ type: "user", source: "todo", content: "stale todo context" },
				{ type: "assistant", content: "previous assistant response" },
			],
		}));
		(
			store.instance as unknown as {
				getLatestCompletedTurnForPreviousRun: typeof getLatestCompletedTurnForPreviousRun;
			}
		).getLatestCompletedTurnForPreviousRun =
			getLatestCompletedTurnForPreviousRun;
		const providerTurn = createProvider([
			{
				type: "supported",
				content: "ready to finalize",
				toolCalls: [
					{
						id: "call-final",
						name: "finalize_answer",
						arguments: { finalReport: "resumed done" },
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
			buildContextWithNativeApiRoute(),
			createSink(events),
		);

		expect(result).toMatchObject({
			terminalState: "completed",
			finalReport: "resumed done",
		});
		expect(getLatestCompletedTurnForPreviousRun).toHaveBeenCalledWith({
			taskId: "task-1",
			runId: "run-1",
			provider: "openai",
			model: "test-model",
			executionMode: "implementation",
		});
		const providerMessages =
			vi.mocked(providerTurn).mock.calls[0]?.[0].messages ?? [];
		expect(providerMessages.map((message) => message.role)).toEqual([
			"system",
			"user",
			"assistant",
			"user",
		]);
		expect(providerMessages.map((message) => message.content)).toEqual(
			expect.arrayContaining([
				"previous request",
				"previous assistant response",
				"implement the requested change",
			]),
		);
		expect(
			providerMessages.map((message) => message.content).join("\n"),
		).not.toContain("stale todo context");
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "runtime_started",
					payload: expect.objectContaining({
						action: "runtime.resume_state_reused",
						runtimeResume: expect.objectContaining({
							kind: "native_api_history",
							sourceRunId: "run-previous",
							sourceTurnId: "turn-previous",
							restoredItemCount: 2,
						}),
					}),
				}),
			]),
		);
	});
});
