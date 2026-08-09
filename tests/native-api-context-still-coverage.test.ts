import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	listAvailableTools: vi.fn(),
	executeWorkerTool: vi.fn(),
	projectResult: vi.fn(),
}));

vi.mock("../api/services/mcp/mcp-client-manager", () => ({
	mcpClientManager: { listAvailableTools: mocks.listAvailableTools },
}));
vi.mock("../api/services/worker-tools/dispatcher", () => ({
	executeWorkerTool: mocks.executeWorkerTool,
}));
vi.mock(
	"../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-result-projector",
	async (importOriginal) => ({
		...(await importOriginal<object>()),
		projectWorkerResultToNativeApiToolResult: mocks.projectResult,
	}),
);

import { dispatchContextStillTool } from "../api/modules/codingAgent/runtime/native-api-runner/native-api-context-still";

function toolCall(name: string, args: Record<string, unknown> = {}) {
	return { id: `call-${name}`, name, arguments: args } as never;
}

function context() {
	return {
		repoRoot: "/repo",
		taskId: "task-1",
		safetyPolicy: { mode: "workspace-write" },
	} as never;
}

function state() {
	return { readFiles: new Set(["README.md"]), iteration: 2 } as never;
}

function availableTool(overrides: Record<string, unknown> = {}) {
	return {
		name: "context_compile",
		serverId: "server-1",
		serverName: "context-still",
		toolPrefix: "context_still",
		...overrides,
	};
}

async function dispatch(name: string, args: Record<string, unknown> = {}) {
	const sink = { emit: vi.fn(async () => undefined) };
	const currentState = state();
	const result = await dispatchContextStillTool({
		toolCall: toolCall(name, args),
		context: context(),
		sink,
		state: currentState,
	});
	return { result, sink, currentState };
}

describe("native API Context Still dispatch coverage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.listAvailableTools.mockResolvedValue([availableTool()]);
		mocks.executeWorkerTool.mockResolvedValue({
			result: { payload: { compiled: true }, error: null },
		});
		mocks.projectResult.mockReturnValue({ ok: true, content: "compiled" });
	});

	it("rejects unknown tools before resolving MCP tools", async () => {
		const { result, sink } = await dispatch("unknown_tool");
		expect(result).toMatchObject({
			kind: "continue",
			toolResult: { ok: false, error: { code: "TOOL_NOT_DISPATCHABLE" } },
		});
		expect(sink.emit).not.toHaveBeenCalled();
	});

	it("validates compile and decision required strings", async () => {
		for (const [name, args, message] of [
			["context_compile", {}, "non-empty goal"],
			["context_compile", { goal: "  " }, "non-empty goal"],
			["context_decision", {}, "non-empty decisionPoint"],
			["context_decision", { decisionPoint: 1 }, "non-empty decisionPoint"],
		] as const) {
			const { result } = await dispatch(name, args);
			expect(result).toMatchObject({
				toolResult: {
					ok: false,
					error: {
						code: "INVALID_TOOL_ARGS",
						message: expect.stringContaining(message),
					},
				},
			});
		}
	});

	it("validates compile_eval body, outcome, and every integer score", async () => {
		const valid = {
			body: "evaluation",
			outcome: "useful",
			actionability: 90,
			clarity: 90,
			coverage: 90,
			relevance: 90,
			specificity: 90,
		};
		for (const args of [
			{ ...valid, body: "" },
			{ ...valid, outcome: "invalid" },
			...(
				[
					"actionability",
					"clarity",
					"coverage",
					"relevance",
					"specificity",
				] as const
			).map((key) => ({ ...valid, [key]: 1.5 })),
		]) {
			const { result } = await dispatch("compile_eval", args);
			expect(result).toMatchObject({
				toolResult: { ok: false, error: { code: "INVALID_TOOL_ARGS" } },
			});
		}
	});

	it("validates register_candidates items", async () => {
		const { result } = await dispatch("register_candidates", { items: null });
		expect(result).toMatchObject({
			toolResult: {
				ok: false,
				error: { message: "register_candidates requires items array." },
			},
		});
	});

	it("reports an unavailable valid tool", async () => {
		mocks.listAvailableTools.mockResolvedValue([]);
		const { result } = await dispatch("context_initial_instructions");
		expect(result).toMatchObject({
			toolResult: { ok: false, error: { code: "MCP_TOOL_UNAVAILABLE" } },
		});
	});

	it("prefers Context Still servers across normalized name and prefix forms", async () => {
		for (const preferred of [
			availableTool({ serverName: "CONTEXTSTILL", toolPrefix: "other" }),
			availableTool({ serverName: "other", toolPrefix: "CONTEXT_STILL" }),
			availableTool({ serverName: "other", toolPrefix: "contextstill" }),
		]) {
			mocks.listAvailableTools.mockResolvedValue([
				availableTool({
					serverId: "fallback",
					serverName: "other",
					toolPrefix: "other",
				}),
				preferred,
			]);
			await dispatch("context_compile", { goal: "Improve coverage" });
			expect(mocks.executeWorkerTool).toHaveBeenLastCalledWith(
				expect.objectContaining({
					args: expect.objectContaining({ serverId: "server-1" }),
				}),
			);
		}
	});

	it("falls back to any matching tool and emits a successful lifecycle", async () => {
		mocks.listAvailableTools.mockResolvedValue([
			availableTool({
				serverId: "fallback",
				serverName: "other",
				toolPrefix: "other",
			}),
		]);
		const { result, sink, currentState } = await dispatch("context_compile", {
			goal: "Improve coverage",
		});
		expect(mocks.executeWorkerTool).toHaveBeenCalledWith({
			toolName: "mcp_call_tool",
			args: {
				serverId: "fallback",
				toolName: "context_compile",
				arguments: { goal: "Improve coverage" },
			},
			repoRoot: "/repo",
			taskId: "task-1",
			safetyPolicy: { mode: "workspace-write" },
			readFiles: currentState.readFiles,
		});
		expect(sink.emit).toHaveBeenCalledTimes(2);
		expect(sink.emit.mock.calls[1]?.[0]).toMatchObject({
			type: "tool_call_finished",
			message: expect.stringContaining("finished"),
			payload: { ok: true, status: "completed" },
		});
		expect(result).toMatchObject({
			kind: "continue",
			toolResult: { ok: true },
		});
	});

	it("dispatches every supported alias and emits projected failures", async () => {
		const cases = [
			["context_initial_instructions", "initial_instructions", {}],
			["context_decision", "context_decision", { decisionPoint: "choose" }],
			[
				"compile_eval",
				"compile_eval",
				{
					body: "body",
					outcome: "partial",
					actionability: 1,
					clarity: 2,
					coverage: 3,
					relevance: 4,
					specificity: 5,
				},
			],
			["register_candidates", "register_candidates", { items: [] }],
		] as const;
		for (const [alias, toolName, args] of cases) {
			mocks.listAvailableTools.mockResolvedValue([
				availableTool({ name: toolName }),
			]);
			mocks.projectResult.mockReturnValueOnce({
				ok: false,
				error: { code: "FAILED", message: "failed" },
			});
			mocks.executeWorkerTool.mockResolvedValueOnce({
				result: { payload: null, error: { message: "worker failed" } },
			});
			const { result, sink } = await dispatch(alias, args);
			expect(result).toMatchObject({ toolResult: { ok: false } });
			expect(sink.emit.mock.calls[1]?.[0]).toMatchObject({
				message: expect.stringContaining("failed"),
				payload: { status: "failed", error: { code: "FAILED" } },
			});
		}
	});
});
