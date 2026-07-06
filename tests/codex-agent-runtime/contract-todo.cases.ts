import { describe, expect, it, vi } from "vitest";
import * as repo from "../../api/modules/nightworkers/nightworkers.repository";
import { CodexAgentRuntime } from "../../api/services/agent-runtime/CodexAgentRuntime";
import { buildContext, fakeThread } from "./helpers";

describe("CodexAgentRuntime Todo contract warnings", () => {
	it("maps a fake assistant turn into runtime ledger events", async () => {
		const runtime = new CodexAgentRuntime({
			threadFactory: () =>
				fakeThread([
					{ type: "thread.started", thread_id: "codex-thread-1" },
					{ type: "turn.started" },
					{
						type: "item.updated",
						item: { id: "item-1", type: "agent_message", text: "hello" },
					},
					{
						type: "item.completed",
						item: { id: "item-1", type: "agent_message", text: "hello world" },
					},
					{
						type: "turn.completed",
						usage: {
							input_tokens: 10,
							cached_input_tokens: 2,
							output_tokens: 3,
							reasoning_output_tokens: 1,
						},
					},
				]),
		});
		const events: unknown[] = [];

		const result = await runtime.start(buildContext(), {
			emit: async (event) => {
				events.push(event);
			},
		});

		expect(result.terminalState).toBe("completed");
		expect(result.finalReport).toBe("hello world");
		expect(events.map((event) => event.type)).toEqual(
			expect.arrayContaining([
				"runtime_started",
				"turn_started",
				"model_response_delta",
				"model_response_finished",
				"runtime_finished",
			]),
		);
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "runtime_started",
					payload: expect.objectContaining({
						runtimeContract: expect.objectContaining({
							lane: "codex-sdk",
							mcp: expect.objectContaining({
								configSource: expect.any(String),
								expectedTools: expect.arrayContaining([
									"nightworkers.import_project",
								]),
							}),
						}),
					}),
				}),
			]),
		);
	});

	it("emits Todo evidence and read warning without requiring Todo replace", async () => {
		const runtime = new CodexAgentRuntime({
			threadFactory: () =>
				fakeThread([
					{
						type: "item.completed",
						item: {
							id: "file-before-todo",
							type: "file_change",
							status: "completed",
							changes: [{ path: "src/app.ts" }],
						},
					},
					{
						type: "item.completed",
						item: { id: "msg-1", type: "agent_message", text: "done" },
					},
				] as never),
		});
		const events: unknown[] = [];

		const result = await runtime.start(
			buildContext({
				currentTodo: {
					id: "todo-1",
					seq: 1,
					title: "実装する",
					taskType: "implementation",
					status: "running",
					procedureId: "implementation",
				},
			}),
			{
				emit: async (event) => {
					events.push(event);
				},
			},
		);

		expect(result.contractWarnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "codex_file_change_without_prior_read",
					providerItemId: "file-before-todo",
					changedFiles: ["src/app.ts"],
				}),
			]),
		);
		expect(result.contractWarnings ?? []).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "codex_file_change_before_todo_replace",
				}),
			]),
		);
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "runtime_warning",
					payload: expect.objectContaining({
						code: "codex_file_change_without_prior_read",
					}),
				}),
				expect.objectContaining({
					type: "diff_collected",
					payload: expect.objectContaining({
						changedFiles: ["src/app.ts"],
						todoId: "todo-1",
						todoSeq: 1,
						todoTitle: "実装する",
					}),
				}),
			]),
		);
	});

	it("aggregates repeated contract warnings while preserving first occurrence metadata", async () => {
		const runtime = new CodexAgentRuntime({
			threadFactory: () =>
				fakeThread([
					{
						type: "item.completed",
						item: {
							id: "file-repeat",
							type: "file_change",
							status: "completed",
							changes: [{ path: "src/app.ts" }],
						},
					},
					{
						type: "item.completed",
						item: {
							id: "file-repeat",
							type: "file_change",
							status: "completed",
							changes: [{ path: "src/app.ts" }],
						},
					},
					{
						type: "item.completed",
						item: { id: "msg-1", type: "agent_message", text: "done" },
					},
				] as never),
		});

		const result = await runtime.start(
			buildContext({
				currentTodo: {
					id: "todo-1",
					seq: 1,
					title: "実装する",
					taskType: "implementation",
					status: "running",
					procedureId: "implementation",
				},
			}),
			{ emit: async () => {} },
		);

		const warning = result.contractWarnings?.find(
			(item) => item.code === "codex_file_change_without_prior_read",
		);
		expect(warning).toEqual(
			expect.objectContaining({
				providerItemId: "file-repeat",
				changedFiles: ["src/app.ts"],
				sequence: expect.any(Number),
				occurredAt: expect.any(String),
				count: 2,
			}),
		);
	});

	it("keeps repeated contract warnings separate when changed files differ", async () => {
		const runtime = new CodexAgentRuntime({
			threadFactory: () =>
				fakeThread([
					{
						type: "item.completed",
						item: {
							id: "file-repeat",
							type: "file_change",
							status: "completed",
							changes: [{ path: "src/app.ts" }],
						},
					},
					{
						type: "item.completed",
						item: {
							id: "file-repeat",
							type: "file_change",
							status: "completed",
							changes: [{ path: "src/other.ts" }],
						},
					},
					{
						type: "item.completed",
						item: { id: "msg-1", type: "agent_message", text: "done" },
					},
				] as never),
		});

		const result = await runtime.start(
			buildContext({
				currentTodo: {
					id: "todo-1",
					seq: 1,
					title: "実装する",
					taskType: "implementation",
					status: "running",
					procedureId: "implementation",
				},
			}),
			{ emit: async () => {} },
		);

		const warnings =
			result.contractWarnings?.filter(
				(item) => item.code === "codex_file_change_without_prior_read",
			) ?? [];
		expect(warnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ changedFiles: ["src/app.ts"], count: 1 }),
				expect.objectContaining({ changedFiles: ["src/other.ts"], count: 1 }),
			]),
		);
	});

	it("prefers DB running Todo evidence over stale runtime context for file_change", async () => {
		vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([
			{
				id: "todo-1",
				runId: "run-codex",
				seq: 1,
				title: "古い Todo",
				taskType: "implementation",
				status: "passed",
			},
			{
				id: "todo-2",
				runId: "run-codex",
				seq: 2,
				title: "現在の Todo",
				taskType: "implementation",
				status: "running",
				procedureId: "implementation",
			},
		] as never);
		const runtime = new CodexAgentRuntime({
			threadFactory: () =>
				fakeThread([
					{
						type: "item.completed",
						item: {
							id: "file-db-todo",
							type: "file_change",
							status: "completed",
							changes: [{ path: "src/app.ts" }],
						},
					},
					{
						type: "item.completed",
						item: { id: "msg-1", type: "agent_message", text: "done" },
					},
				] as never),
		});
		const events: unknown[] = [];

		const result = await runtime.start(
			buildContext({
				currentTodo: {
					id: "todo-1",
					seq: 1,
					title: "古い Todo",
					taskType: "implementation",
					status: "running",
				},
			}),
			{
				emit: async (event) => {
					events.push(event);
				},
			},
		);

		expect(result.contractWarnings ?? []).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "codex_todo_evidence_db_read_failed" }),
			]),
		);
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "diff_collected",
					payload: expect.objectContaining({
						providerItemId: "file-db-todo",
						todoId: "todo-2",
						todoSeq: 2,
						todoTitle: "現在の Todo",
					}),
				}),
			]),
		);
	});

	it("does not fall back to stale context when DB has no running Todo", async () => {
		vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
		const runtime = new CodexAgentRuntime({
			threadFactory: () =>
				fakeThread([
					{
						type: "item.completed",
						item: {
							id: "file-no-db-todo",
							type: "file_change",
							status: "completed",
							changes: [{ path: "src/app.ts" }],
						},
					},
					{
						type: "item.completed",
						item: { id: "msg-1", type: "agent_message", text: "done" },
					},
				] as never),
		});

		const result = await runtime.start(
			buildContext({
				currentTodo: {
					id: "todo-1",
					seq: 1,
					title: "古い Todo",
					taskType: "implementation",
					status: "running",
				},
			}),
			{ emit: async () => {} },
		);

		expect(result.contractWarnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "codex_file_change_without_current_todo",
					providerItemId: "file-no-db-todo",
				}),
			]),
		);
		expect(result.contractWarnings ?? []).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "codex_todo_evidence_db_read_failed" }),
			]),
		);
	});

	it("falls back to runtime Todo context only when DB Todo evidence cannot be read", async () => {
		vi.mocked(repo.listTaskRunTodosForRun).mockRejectedValue(
			new Error("SQLITE_BUSY"),
		);
		const runtime = new CodexAgentRuntime({
			threadFactory: () =>
				fakeThread([
					{
						type: "item.completed",
						item: {
							id: "file-db-throw",
							type: "file_change",
							status: "completed",
							changes: [{ path: "src/app.ts" }],
						},
					},
					{
						type: "item.completed",
						item: { id: "msg-1", type: "agent_message", text: "done" },
					},
				] as never),
		});
		const events: unknown[] = [];

		const result = await runtime.start(
			buildContext({
				currentTodo: {
					id: "todo-fallback",
					seq: 3,
					title: "fallback Todo",
					taskType: "implementation",
					status: "running",
				},
			}),
			{
				emit: async (event) => {
					events.push(event);
				},
			},
		);

		expect(result.contractWarnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "codex_todo_evidence_db_read_failed",
					providerItemId: "file-db-throw",
					todoId: "todo-fallback",
					todoSeq: 3,
					todoEvidenceSource: "context",
				}),
			]),
		);
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "diff_collected",
					payload: expect.objectContaining({
						providerItemId: "file-db-throw",
						todoId: "todo-fallback",
						todoSeq: 3,
					}),
				}),
			]),
		);
	});

	it("does not emit the pre-replace file_change warning after todo_list replace", async () => {
		const runtime = new CodexAgentRuntime({
			threadFactory: () =>
				fakeThread([
					{
						type: "item.completed",
						item: {
							id: "todo-replace",
							type: "mcp_tool_call",
							server: "nightworkers",
							tool: "todo_list",
							arguments: {
								operation: "replace",
								todos: [{ seq: 1, title: "実装" }],
							},
							status: "completed",
							result: { ok: true },
						},
					},
					{
						type: "item.completed",
						item: {
							id: "file-after-todo",
							type: "file_change",
							status: "completed",
							changes: [{ path: "src/app.ts" }],
						},
					},
					{
						type: "item.completed",
						item: { id: "msg-1", type: "agent_message", text: "done" },
					},
				] as never),
		});

		const result = await runtime.start(
			buildContext({
				currentTodo: {
					id: "todo-1",
					seq: 1,
					title: "実装",
					taskType: "implementation",
					status: "running",
				},
			}),
			{ emit: async () => {} },
		);

		expect(result.contractWarnings ?? []).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "codex_file_change_before_todo_replace",
				}),
			]),
		);
	});

	it("records a Todo progress warning when file changes happen without a todo_list mutation", async () => {
		const runtime = new CodexAgentRuntime({
			threadFactory: () =>
				fakeThread([
					{
						type: "item.completed",
						item: {
							id: "file-without-todo-progress",
							type: "file_change",
							status: "completed",
							changes: [{ path: "src/app.ts" }],
						},
					},
					{
						type: "item.completed",
						item: { id: "msg-1", type: "agent_message", text: "done" },
					},
				] as never),
		});

		const result = await runtime.start(
			buildContext({
				currentTodo: {
					id: "todo-1",
					seq: 1,
					title: "実装",
					taskType: "implementation",
					status: "running",
				},
			}),
			{ emit: async () => {} },
		);

		expect(result.contractWarnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "codex_todo_progress_missing",
					providerItemId: "file-without-todo-progress",
					toolName: "nightworkers.todo_list",
					changedFiles: ["src/app.ts"],
				}),
			]),
		);
	});

	it("treats todo_list list as diagnostics instead of progress evidence", async () => {
		const runtime = new CodexAgentRuntime({
			threadFactory: () =>
				fakeThread([
					{
						type: "item.completed",
						item: {
							id: "todo-list-only",
							type: "mcp_tool_call",
							server: "nightworkers",
							tool: "todo_list",
							arguments: { operation: "list" },
							status: "completed",
							result: { ok: true },
						},
					},
					{
						type: "item.completed",
						item: {
							id: "file-after-list",
							type: "file_change",
							status: "completed",
							changes: [{ path: "src/app.ts" }],
						},
					},
					{
						type: "item.completed",
						item: { id: "msg-1", type: "agent_message", text: "done" },
					},
				] as never),
		});

		const result = await runtime.start(
			buildContext({
				currentTodo: {
					id: "todo-1",
					seq: 1,
					title: "実装",
					taskType: "implementation",
					status: "running",
				},
			}),
			{ emit: async () => {} },
		);

		expect(result.contractWarnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "codex_todo_progress_list_only",
					providerItemId: "file-after-list",
					changedFiles: ["src/app.ts"],
				}),
			]),
		);
		expect(result.contractWarnings ?? []).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "codex_todo_progress_missing" }),
			]),
		);
	});

	it("does not record a Todo progress warning when replace happens before file changes", async () => {
		const runtime = new CodexAgentRuntime({
			threadFactory: () =>
				fakeThread([
					{
						type: "item.completed",
						item: {
							id: "todo-replace",
							type: "mcp_tool_call",
							server: "nightworkers",
							tool: "todo_list",
							arguments: {
								operation: "replace",
								todos: [{ seq: 1, title: "実装" }],
							},
							status: "completed",
							result: { ok: true },
						},
					},
					{
						type: "item.completed",
						item: {
							id: "file-after-replace",
							type: "file_change",
							status: "completed",
							changes: [{ path: "src/app.ts" }],
						},
					},
					{
						type: "item.completed",
						item: { id: "msg-1", type: "agent_message", text: "done" },
					},
				] as never),
		});

		const result = await runtime.start(buildContext(), {
			emit: async () => {},
		});

		expect(result.contractWarnings ?? []).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "codex_todo_progress_missing" }),
				expect.objectContaining({ code: "codex_todo_progress_list_only" }),
			]),
		);
	});

	it("records replace-specific warning only when structural replan evidence exists", async () => {
		const runtime = new CodexAgentRuntime({
			threadFactory: () =>
				fakeThread([
					{
						type: "item.completed",
						item: {
							id: "todo-replace-failed",
							type: "mcp_tool_call",
							server: "nightworkers",
							tool: "todo_list",
							arguments: {
								operation: "replace",
								todos: [{ seq: 1, title: "実装" }],
							},
							status: "failed",
							result: { ok: false, errorCode: "TODO_REPLACE_REASON_REQUIRED" },
						},
					},
					{
						type: "item.completed",
						item: {
							id: "file-after-failed-replace",
							type: "file_change",
							status: "completed",
							changes: [{ path: "src/app.ts" }],
						},
					},
					{
						type: "item.completed",
						item: { id: "msg-1", type: "agent_message", text: "done" },
					},
				] as never),
		});

		const result = await runtime.start(
			buildContext({
				currentTodo: {
					id: "todo-1",
					seq: 1,
					title: "実装",
					taskType: "implementation",
					status: "running",
				},
			}),
			{ emit: async () => {} },
		);

		expect(result.contractWarnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "codex_file_change_before_todo_replace",
					providerItemId: "file-after-failed-replace",
					changedFiles: ["src/app.ts"],
				}),
			]),
		);
	});
});
