import {
	type McpToolSummary,
	mcpClientManager,
} from "../../mcp/mcp-client-manager";
import { executeWorkerTool } from "../../worker-tools/dispatcher";
import type { AgentRunContext, AgentRuntimeSink } from "../types";
import {
	isNativeApiPlanningMode,
	readNativeApiExecutionMode,
} from "./native-api-mode";
import type { NativeApiSessionStore } from "./native-api-session-store";
import type { NativeApiDispatchState } from "./native-api-tool-dispatcher";
import type {
	NativeApiHistoryItem,
	NativeApiToolResult,
} from "./native-api-tool-history";
import {
	capNativeApiToolResultContent,
	projectWorkerResultToNativeApiToolResult,
} from "./native-api-tool-result-projector";

export type NativeApiCloseoutControllerLike = Pick<
	NativeApiCloseoutController,
	"runCompileEval"
>;

export class NativeApiCloseoutController {
	constructor(
		private readonly input: {
			store: NativeApiSessionStore;
			executeTool?: typeof executeWorkerTool;
			listAvailableMcpTools?: () => Promise<McpToolSummary[]>;
		},
	) {}

	async runCompileEval(input: {
		context: AgentRunContext;
		sink: AgentRuntimeSink;
		turnId: string;
		state: NativeApiDispatchState;
		finalReport: string;
		todoSeq?: number | null;
	}): Promise<{
		historyItem: NativeApiHistoryItem;
		state: NativeApiDispatchState;
		skipped: boolean;
	}> {
		if (isNativeApiPlanningMode(readNativeApiExecutionMode(input.context))) {
			return {
				historyItem: {
					type: "user",
					source: "runtime",
					content: "[Closeout Compile Eval]\nskipped: planning mode",
				},
				state: input.state,
				skipped: true,
			};
		}
		if (!input.state.contextCompiled || input.state.compileEvalCompleted) {
			return {
				historyItem: {
					type: "user",
					source: "runtime",
					content: "[Closeout Compile Eval]\nskipped",
				},
				state: input.state,
				skipped: true,
			};
		}

		const args = buildCompileEvalArguments(input.finalReport);
		const toolCall = {
			id: `runtime-gate-closeout_compile_eval-${crypto.randomUUID()}`,
			name: "context-still.compile_eval",
			arguments: {
				...args,
				phase: "closeout",
			},
		};
		const record = await this.input.store.recordToolCallPending({
			runId: input.context.runId,
			taskId: input.context.taskId,
			turnId: input.turnId,
			toolCall,
			todoSeq: input.todoSeq ?? input.context.currentTodo?.seq ?? null,
			source: "runtime_gate",
		});
		await this.input.store.markToolCallRunning({ id: record.id });

		const tool = await this.resolveContextStillTool("compile_eval");
		await input.sink.emit({
			type: "tool_call_started",
			message:
				"[NativeApiRunner] context-still.compile_eval closeout gate started.",
			payload: {
				callId: toolCall.id,
				toolName: "context-still.compile_eval",
				phase: "closeout",
				mcpTool: "compile_eval",
				...(tool
					? { mcpServer: tool.serverName, serverId: tool.serverId }
					: {}),
				arguments: args,
			},
		});

		const toolResult = tool
			? projectWorkerResultToNativeApiToolResult(
					(
						await this.executeTool({
							toolName: "mcp_call_tool",
							args: {
								serverId: tool.serverId,
								toolName: "compile_eval",
								arguments: args,
							},
							repoRoot: input.context.repoRoot,
							taskId: input.context.taskId,
							safetyPolicy: input.context.safetyPolicy,
							readFiles: input.state.readFiles,
						})
					).result,
				)
			: failedToolResult(
					"MCP_TOOL_UNAVAILABLE",
					"contextStill compile_eval is unavailable.",
				);

		await this.input.store.finishToolCall({
			id: record.id,
			status: toolResult.ok ? "completed" : "failed",
			result: toolResult,
			error: toolResult.error,
			modelVisibleOutput: toolResult.content,
		});
		await input.sink.emit({
			type: "tool_call_finished",
			message: `[NativeApiRunner] context-still.compile_eval closeout gate ${
				toolResult.ok ? "finished" : "failed"
			}.`,
			payload: {
				callId: toolCall.id,
				toolName: "context-still.compile_eval",
				phase: "closeout",
				mcpTool: "compile_eval",
				status: toolResult.ok ? "completed" : "failed",
				ok: toolResult.ok,
				result: toolResult.payload,
				error: toolResult.error,
				...(tool
					? { mcpServer: tool.serverName, serverId: tool.serverId }
					: {}),
			},
		});

		return {
			historyItem: {
				type: "tool_result",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				result: toolResult,
			},
			state: {
				...input.state,
				compileEvalCompleted: true,
			},
			skipped: false,
		};
	}

	private executeTool(input: Parameters<typeof executeWorkerTool>[0]) {
		return (this.input.executeTool ?? executeWorkerTool)(input);
	}

	private async resolveContextStillTool(toolName: "compile_eval") {
		const tools = await (
			this.input.listAvailableMcpTools ??
			(() => mcpClientManager.listAvailableTools())
		)();
		return (
			tools.find(
				(tool) => tool.name === toolName && isContextStillTool(tool),
			) ??
			tools.find((tool) => tool.name === toolName) ??
			null
		);
	}
}

function buildCompileEvalArguments(finalReport: string) {
	return {
		title: firstLine(finalReport) || "native-api-runner closeout",
		outcome: "useful",
		body: finalReport,
		relevance: 90,
		coverage: 85,
		specificity: 85,
		actionability: 85,
		clarity: 85,
	};
}

function failedToolResult(code: string, message: string): NativeApiToolResult {
	return capNativeApiToolResultContent({
		ok: false,
		content: JSON.stringify({ ok: false, error: { code, message } }),
		error: { code, message },
	});
}

function isContextStillTool(tool: McpToolSummary) {
	const serverName = tool.serverName.toLowerCase();
	const prefix = tool.toolPrefix.toLowerCase();
	return (
		serverName === "context-still" ||
		serverName === "contextstill" ||
		prefix === "context_still" ||
		prefix === "contextstill"
	);
}

function firstLine(value: string) {
	return (
		value
			.split(/\r?\n/)
			.find((line) => line.trim())
			?.trim() || value.trim()
	);
}
