import { beforeEach, describe, expect, it, vi } from "vitest";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import type { NativeApiSessionStore } from "../api/services/agent-runtime/native-api-runner/native-api-session-store";
import { NativeApiStartupController } from "../api/services/agent-runtime/native-api-runner/native-api-startup-controller";
import type { NativeApiDispatchState } from "../api/services/agent-runtime/native-api-runner/native-api-tool-dispatcher";
import type { NativeApiHistoryItem } from "../api/services/agent-runtime/native-api-runner/native-api-tool-history";
import type {
	AgentRunContext,
	AgentRuntimeEvent,
} from "../api/services/agent-runtime/types";
import type { WorkerToolResult } from "../api/services/worker-tools/types";

vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	listTaskRunTodosForRun: vi.fn(),
}));

describe("NativeApiStartupController", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("runs fixed startup gates before provider work and records them as runtime gates", async () => {
		const store = createFakeStore();
		const events: AgentRuntimeEvent[] = [];
		const executeTool = vi
			.fn()
			.mockResolvedValueOnce({
				result: okWorkerResult("read_current_specification", {
					taskId: "task-1",
					found: true,
					messageId: "message-1",
					title: "Todo List Specification",
					content:
						"# Todo List Specification\nImplement persisted Todo filtering and keyboard flow.",
					generatedAt: "2026-06-17T00:00:00.000Z",
					digest: "sha256:todo-list",
					sources: {},
				}),
			})
			.mockResolvedValueOnce({
				result: okWorkerResult("mcp_call_tool", {
					serverId: "context-still",
					toolName: "initial_instructions",
					result: {
						content: [{ type: "text", text: "Use context_compile first." }],
					},
				}),
			})
			.mockResolvedValueOnce({
				result: okWorkerResult("mcp_call_tool", {
					serverId: "context-still",
					toolName: "context_compile",
					result: { content: [{ type: "text", text: "Compiled context." }] },
				}),
			});
		const mutateTodos = vi
			.fn()
			.mockResolvedValueOnce(
				okWorkerResult("todo_list", { operation: "done", todos: [] }),
			)
			.mockResolvedValueOnce(
				okWorkerResult("todo_list", { operation: "done", todos: [] }),
			)
			.mockResolvedValueOnce(
				okWorkerResult("todo_list", {
					operation: "start",
					transition: { nextCurrentSeq: 3 },
					todos: [],
				}),
			);
		vi.mocked(repo.listTaskRunTodosForRun)
			.mockResolvedValueOnce([
				todo(
					1,
					"running",
					"contextstill.initial_instructions",
					"initial_instructions",
				),
				todo(2, "pending", "contextstill.context_compile", "context_compile"),
				{
					...todo(3, "pending", null, "implementation"),
					title: "Implement Todo list UI",
				},
			] as never)
			.mockResolvedValueOnce([
				todo(
					1,
					"passed",
					"contextstill.initial_instructions",
					"initial_instructions",
				),
				todo(2, "running", "contextstill.context_compile", "context_compile"),
				{
					...todo(3, "pending", null, "verification"),
					title: "Pending follow-up check",
				},
				{
					...todo(4, "running", null, "implementation"),
					title: "Continue active Todo list implementation",
				},
			] as never)
			.mockResolvedValueOnce([
				todo(
					1,
					"passed",
					"contextstill.initial_instructions",
					"initial_instructions",
				),
				todo(2, "running", "contextstill.context_compile", "context_compile"),
				{
					...todo(3, "pending", null, "implementation"),
					title: "Implement Todo list UI",
				},
			] as never)
			.mockResolvedValueOnce([
				todo(
					1,
					"passed",
					"contextstill.initial_instructions",
					"initial_instructions",
				),
				todo(2, "passed", "contextstill.context_compile", "context_compile"),
				{
					...todo(3, "pending", null, "implementation"),
					title: "Implement Todo list UI",
				},
			] as never)
			.mockResolvedValueOnce([
				todo(
					1,
					"passed",
					"contextstill.initial_instructions",
					"initial_instructions",
				),
				todo(2, "passed", "contextstill.context_compile", "context_compile"),
				{
					...todo(3, "running", null, "implementation"),
					title: "Implement Todo list UI",
				},
			] as never);

		const controller = new NativeApiStartupController({
			store: store.instance,
			executeTool,
			mutateTodos,
			listAvailableMcpTools: async () => [
				{
					serverId: "context-still",
					serverName: "context-still",
					toolPrefix: "context_still",
					name: "initial_instructions",
					description: "",
					inputSchema: {},
				},
				{
					serverId: "context-still",
					serverName: "context-still",
					toolPrefix: "context_still",
					name: "context_compile",
					description: "",
					inputSchema: {},
				},
			],
		});

		const result = await controller.runStartup({
			context: buildContext(),
			sink: createSink(events),
			history: initialHistory(),
			state: initialState(),
		});

		expect(result.ok).toBe(true);
		expect(result.state).toMatchObject({
			specificationRead: true,
			initialInstructionsCompleted: true,
			contextCompiled: true,
			todoAligned: true,
			startupCompleted: true,
		});
		expect(executeTool).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				toolName: "read_current_specification",
				args: expect.objectContaining({ includeDesignContext: true }),
			}),
		);
		expect(executeTool).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				toolName: "mcp_call_tool",
				args: expect.objectContaining({
					toolName: "initial_instructions",
					arguments: {},
				}),
			}),
		);
		expect(executeTool).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				toolName: "mcp_call_tool",
				args: expect.objectContaining({
					toolName: "context_compile",
					arguments: expect.objectContaining({
						goal: expect.stringContaining("Todo List Specification"),
					}),
				}),
			}),
		);
		const contextCompileArgs = executeTool.mock.calls[2][0].args
			.arguments as Record<string, unknown>;
		expect(contextCompileArgs.goal).toContain(
			"Continue active Todo list implementation",
		);
		expect(contextCompileArgs.goal).not.toContain("Pending follow-up check");
		expect(contextCompileArgs.goal).toContain("persisted Todo filtering");
		expect(contextCompileArgs.goal).not.toContain(
			"Native/API runner の fixed startup flow",
		);
		expect(contextCompileArgs.goal).not.toContain(
			"initial_instructions を実行する",
		);
		expect(contextCompileArgs).toMatchObject({
			domains: ["nightWorkers"],
			technologies: ["typescript", "bun"],
			changeTypes: ["implementation", "verification"],
		});
		expect(mutateTodos).toHaveBeenLastCalledWith({
			runId: "run-1",
			operation: "start",
			seq: 3,
		});
		expect(store.toolCalls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					source: "runtime_gate",
					toolName: "read_current_specification",
					status: "pending",
				}),
				expect.objectContaining({
					source: "runtime_gate",
					toolName: "context-still.initial_instructions",
					status: "pending",
				}),
				expect.objectContaining({
					source: "runtime_gate",
					toolName: "context-still.context_compile",
					status: "pending",
				}),
				expect.objectContaining({
					source: "runtime_gate",
					toolName: "todo_list",
					status: "pending",
				}),
			]),
		);
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "tool_call_finished",
					payload: expect.objectContaining({
						toolName: "context-still.initial_instructions",
						mcpTool: "initial_instructions",
						status: "completed",
					}),
				}),
				expect.objectContaining({
					type: "tool_call_finished",
					payload: expect.objectContaining({
						toolName: "context-still.context_compile",
						mcpTool: "context_compile",
						status: "completed",
					}),
				}),
			]),
		);
		expect(store.finishedTurns[0]).toMatchObject({ status: "completed" });
	});

	it("fails startup before provider work when the current specification is missing", async () => {
		const store = createFakeStore();
		const executeTool = vi.fn().mockResolvedValueOnce({
			result: okWorkerResult("read_current_specification", {
				taskId: "task-1",
				found: false,
				messageId: null,
				title: null,
				content: "",
				generatedAt: null,
				digest: null,
				sources: {},
			}),
		});
		const controller = new NativeApiStartupController({
			store: store.instance,
			executeTool,
			listAvailableMcpTools: async () => [],
			mutateTodos: vi.fn(),
		});

		const result = await controller.runStartup({
			context: buildContext(),
			sink: createSink(),
			history: initialHistory(),
			state: initialState(),
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.result).toMatchObject({
				terminalState: "needs_human",
				stoppedBy: "tool_failure",
			});
			expect(result.result.finalReport).toContain("Draft specification");
		}
		expect(executeTool).toHaveBeenCalledOnce();
		expect(store.finishedTurns[0]).toMatchObject({ status: "failed" });
		expect(store.finishedToolCalls[0]).toMatchObject({
			status: "failed",
			error: { code: "SPECIFICATION_NOT_FOUND" },
		});
	});

	it("continues startup on missing specification when native/API resume history was restored", async () => {
		const store = createFakeStore();
		const events: AgentRuntimeEvent[] = [];
		const executeTool = vi
			.fn()
			.mockResolvedValueOnce({
				result: okWorkerResult("read_current_specification", {
					taskId: "task-1",
					found: false,
					messageId: null,
					title: null,
					content: "",
					generatedAt: null,
					digest: null,
					sources: {},
				}),
			})
			.mockResolvedValueOnce({
				result: okWorkerResult("mcp_call_tool", {
					serverId: "context-still",
					toolName: "initial_instructions",
					result: {
						content: [{ type: "text", text: "Use context_compile first." }],
					},
				}),
			})
			.mockResolvedValueOnce({
				result: okWorkerResult("mcp_call_tool", {
					serverId: "context-still",
					toolName: "context_compile",
					result: {
						content: [{ type: "text", text: "Compiled resume context." }],
					},
				}),
			});
		vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([] as never);
		const controller = new NativeApiStartupController({
			store: store.instance,
			executeTool,
			listAvailableMcpTools: async () => [
				{
					serverId: "context-still",
					serverName: "context-still",
					toolPrefix: "context_still",
					name: "initial_instructions",
					description: "",
					inputSchema: {},
				},
				{
					serverId: "context-still",
					serverName: "context-still",
					toolPrefix: "context_still",
					name: "context_compile",
					description: "",
					inputSchema: {},
				},
			],
			mutateTodos: vi.fn(),
		});

		const result = await controller.runStartup({
			context: buildContext(),
			sink: createSink(events),
			history: initialHistory(),
			state: initialState(),
			resumeHistoryRestored: true,
		});

		expect(result.ok).toBe(true);
		expect(result.state).toMatchObject({
			specificationRead: true,
			specificationReadFromResumeFallback: true,
			initialInstructionsCompleted: true,
			contextCompiled: true,
			startupCompleted: true,
		});
		expect(executeTool).toHaveBeenCalledTimes(3);
		const contextCompileArgs = executeTool.mock.calls[2][0].args
			.arguments as Record<string, unknown>;
		expect(contextCompileArgs.goal).toContain("現行仕様書は見つからなかった");
		expect(store.finishedToolCalls[0]).toMatchObject({
			status: "failed",
			error: { code: "SPECIFICATION_NOT_FOUND" },
		});
		expect(store.finishedTurns[0]).toMatchObject({ status: "completed" });
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "runtime_started",
					payload: expect.objectContaining({
						action: "runtime.resume_specification_missing_waived",
					}),
				}),
			]),
		);
	});

	it("records unavailable contextStill startup gates as durable runtime failures", async () => {
		const store = createFakeStore();
		const events: AgentRuntimeEvent[] = [];
		const executeTool = vi.fn().mockResolvedValueOnce({
			result: okWorkerResult("read_current_specification", {
				taskId: "task-1",
				found: true,
				messageId: "message-1",
				title: "Todo List Specification",
				content:
					"# Todo List Specification\nImplement persisted Todo filtering.",
				generatedAt: "2026-06-17T00:00:00.000Z",
				digest: "sha256:spec",
				sources: {},
			}),
		});
		const controller = new NativeApiStartupController({
			store: store.instance,
			executeTool,
			listAvailableMcpTools: async () => [],
			mutateTodos: vi.fn(),
		});

		const result = await controller.runStartup({
			context: buildContext(),
			sink: createSink(events),
			history: initialHistory(),
			state: initialState(),
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.result).toMatchObject({
				terminalState: "needs_human",
				stoppedBy: "tool_failure",
				finalReport: expect.stringContaining("initial_instructions"),
			});
		}
		expect(executeTool).toHaveBeenCalledOnce();
		expect(store.toolCalls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					source: "runtime_gate",
					toolName: "context-still.initial_instructions",
				}),
			]),
		);
		expect(store.finishedToolCalls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "failed",
					error: expect.objectContaining({ code: "MCP_TOOL_UNAVAILABLE" }),
				}),
			]),
		);
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "tool_call_finished",
					payload: expect.objectContaining({
						toolName: "context-still.initial_instructions",
						mcpTool: "initial_instructions",
						status: "failed",
					}),
				}),
			]),
		);
	});
});

function createFakeStore() {
	const turns: Array<Record<string, unknown>> = [];
	const finishedTurns: Array<Record<string, unknown>> = [];
	const toolCalls: Array<Record<string, unknown>> = [];
	const runningToolCalls: string[] = [];
	const finishedToolCalls: Array<Record<string, unknown>> = [];
	const instance = {
		createTurn: vi.fn(async (input) => {
			const turn = { ...input, id: `turn-${turns.length}` };
			turns.push(turn);
			return turn;
		}),
		finishTurn: vi.fn(async (input) => {
			finishedTurns.push(input);
			return input;
		}),
		recordToolCallPending: vi.fn(async (input) => {
			const record = {
				...input,
				id: `tool-${toolCalls.length + 1}`,
				toolName: input.toolCall.name,
				status: "pending",
			};
			toolCalls.push(record);
			return record;
		}),
		markToolCallRunning: vi.fn(async ({ id }) => {
			runningToolCalls.push(id);
			return { id, status: "running" };
		}),
		finishToolCall: vi.fn(async (input) => {
			finishedToolCalls.push(input);
			return input;
		}),
	} as unknown as NativeApiSessionStore;
	return {
		instance,
		turns,
		finishedTurns,
		toolCalls,
		runningToolCalls,
		finishedToolCalls,
	};
}

function okWorkerResult<T>(toolName: string, payload: T): WorkerToolResult<T> {
	return {
		ok: true,
		toolName,
		startedAt: "2026-06-17T00:00:00.000Z",
		finishedAt: "2026-06-17T00:00:01.000Z",
		payload,
	};
}

function todo(
	seq: number,
	status: string,
	procedureId: string | null,
	taskType: string,
) {
	return {
		id: `todo-${seq}`,
		runId: "run-1",
		seq,
		title: `Todo ${seq}`,
		description: null,
		taskType,
		status,
		procedureId,
		dependsOn: null,
		startedAt: null,
		completedAt: null,
	};
}

function createSink(events: AgentRuntimeEvent[] = []) {
	return {
		emit: vi.fn(async (event: AgentRuntimeEvent) => {
			events.push(event);
		}),
	};
}

function buildContext(
	overrides: Partial<AgentRunContext> = {},
): AgentRunContext {
	return {
		runId: "run-1",
		taskId: "task-1",
		repositoryId: "repo-1",
		repoRoot: "/Users/y.noguchi/Code/nightWorkers",
		compiledPrompt: "implement the requested change",
		latestUserMessage: "implement the requested change",
		timeoutSeconds: 60,
		contextSnapshot: {
			compiledPrompt: "implement the requested change",
			source: "fallback",
		},
		...overrides,
	};
}

function initialHistory(): NativeApiHistoryItem[] {
	return [
		{ type: "system", content: "system" },
		{ type: "user", source: "user", content: "implement the requested change" },
	];
}

function initialState(): NativeApiDispatchState {
	return {
		readFiles: [],
		specificationRead: false,
		initialInstructionsCompleted: false,
		contextCompiled: false,
		todoAligned: false,
		startupCompleted: false,
	};
}
