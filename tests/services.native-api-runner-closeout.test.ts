import { describe, expect, it, vi } from "vitest";
import { NativeApiCloseoutController } from "../api/services/agent-runtime/native-api-runner/native-api-closeout-controller";
import type { NativeApiSessionStore } from "../api/services/agent-runtime/native-api-runner/native-api-session-store";
import type { NativeApiDispatchState } from "../api/services/agent-runtime/native-api-runner/native-api-tool-dispatcher";
import type {
	AgentRunContext,
	AgentRuntimeEvent,
} from "../api/services/agent-runtime/types";

describe("NativeApiCloseoutController", () => {
	it("records compile_eval as a runtime gate during closeout", async () => {
		const store = createFakeStore();
		const events: AgentRuntimeEvent[] = [];
		const executeTool = vi.fn(async () => ({
			result: {
				ok: true,
				toolName: "mcp_call_tool",
				startedAt: "2026-06-17T00:00:00.000Z",
				finishedAt: "2026-06-17T00:00:01.000Z",
				payload: {
					serverId: "context-still",
					toolName: "compile_eval",
					result: { content: [{ type: "text", text: "recorded" }] },
				},
			},
		}));
		const controller = new NativeApiCloseoutController({
			store: store.instance,
			executeTool: executeTool as never,
			listAvailableMcpTools: async () => [
				{
					serverId: "context-still",
					serverName: "context-still",
					toolPrefix: "context_still",
					name: "compile_eval",
					description: "",
					inputSchema: {},
				},
			],
		});

		const result = await controller.runCompileEval({
			context: buildContext({
				currentTodo: {
					id: "todo-1",
					seq: 1,
					title: "initial_instructions を実行する",
					taskType: "initial_instructions",
					status: "running",
					procedureId: "contextstill.initial_instructions",
				},
			}),
			sink: createSink(events),
			turnId: "turn-1",
			state: initialState(),
			finalReport: "Implemented fixed startup flow.\nVerified with tests.",
			todoSeq: 3,
		});

		expect(result.skipped).toBe(false);
		expect(result.state.compileEvalCompleted).toBe(true);
		expect(store.toolCalls[0]).toMatchObject({
			source: "runtime_gate",
			toolName: "context-still.compile_eval",
			todoSeq: 3,
		});
		expect(store.finishedToolCalls[0]).toMatchObject({
			status: "completed",
			result: expect.objectContaining({ ok: true }),
		});
		expect(executeTool).toHaveBeenCalledWith(
			expect.objectContaining({
				toolName: "mcp_call_tool",
				args: expect.objectContaining({
					toolName: "compile_eval",
					arguments: expect.objectContaining({
						outcome: "useful",
						body: expect.stringContaining("Implemented fixed startup flow."),
					}),
				}),
			}),
		);
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "tool_call_finished",
					payload: expect.objectContaining({
						toolName: "context-still.compile_eval",
						mcpTool: "compile_eval",
						status: "completed",
					}),
				}),
			]),
		);
	});

	it("skips compile_eval for planning mode", async () => {
		const store = createFakeStore();
		const executeTool = vi.fn();
		const controller = new NativeApiCloseoutController({
			store: store.instance,
			executeTool: executeTool as never,
			listAvailableMcpTools: async () => [],
		});

		const result = await controller.runCompileEval({
			context: buildContext({ runtimeOptions: { executionMode: "planning" } }),
			sink: createSink(),
			turnId: "turn-1",
			state: initialState(),
			finalReport: "Plan only.",
		});

		expect(result.skipped).toBe(true);
		expect(executeTool).not.toHaveBeenCalled();
		expect(store.toolCalls).toHaveLength(0);
	});
});

function createFakeStore() {
	const toolCalls: Array<Record<string, unknown>> = [];
	const runningToolCalls: string[] = [];
	const finishedToolCalls: Array<Record<string, unknown>> = [];
	const instance = {
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
	return { instance, toolCalls, runningToolCalls, finishedToolCalls };
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

function initialState(): NativeApiDispatchState {
	return {
		readFiles: [],
		specificationRead: true,
		contextCompiled: true,
		compileEvalCompleted: false,
	};
}
