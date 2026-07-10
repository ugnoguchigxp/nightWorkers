import {
	type McpToolSummary,
	mcpClientManager,
} from "../../mcp/mcp-client-manager";
import type { ProviderToolCall } from "../../structured-llm/tool-calls";
import { executeWorkerTool } from "../../worker-tools/dispatcher";
import type { AgentRunContext, AgentRuntimeSink } from "../types";
import { continueWith, failedToolResult } from "./native-api-dispatch-results";
import type {
	NativeApiDispatchResult,
	NativeApiDispatchState,
} from "./native-api-dispatch-types";
import { projectWorkerResultToNativeApiToolResult } from "./native-api-tool-result-projector";

export async function dispatchContextStillTool(input: {
	toolCall: ProviderToolCall;
	context: AgentRunContext;
	sink: AgentRuntimeSink;
	state: NativeApiDispatchState;
}): Promise<NativeApiDispatchResult> {
	const mcpToolName = contextStillMcpToolName(input.toolCall.name);
	if (!mcpToolName) {
		return continueWith(
			failedToolResult(
				"TOOL_NOT_DISPATCHABLE",
				`${input.toolCall.name} is not dispatchable.`,
			),
			input.state,
		);
	}
	const validation = validateContextStillArguments(
		mcpToolName,
		input.toolCall.arguments,
	);
	if (validation) {
		return continueWith(
			failedToolResult(validation.code, validation.message),
			input.state,
		);
	}
	const prerequisite = validateContextStillPrerequisites(
		mcpToolName,
		input.state,
	);
	if (prerequisite) {
		return continueWith(
			failedToolResult(prerequisite.code, prerequisite.message),
			input.state,
		);
	}
	const tool = await resolveContextStillTool(mcpToolName);
	if (!tool) {
		return continueWith(
			failedToolResult(
				"MCP_TOOL_UNAVAILABLE",
				`contextStill ${mcpToolName} is unavailable.`,
			),
			input.state,
		);
	}
	await input.sink.emit({
		type: "tool_call_started",
		message: `[NativeApiRunner] context-still.${mcpToolName} started.`,
		payload: {
			callId: input.toolCall.id,
			toolName: `context-still.${mcpToolName}`,
			mcpTool: mcpToolName,
			mcpServer: tool.serverName,
			serverId: tool.serverId,
			arguments: input.toolCall.arguments,
		},
	});
	const result = await executeWorkerTool({
		toolName: "mcp_call_tool",
		args: {
			serverId: tool.serverId,
			toolName: mcpToolName,
			arguments: input.toolCall.arguments,
		},
		repoRoot: input.context.repoRoot,
		taskId: input.context.taskId,
		safetyPolicy: input.context.safetyPolicy,
		readFiles: input.state.readFiles,
	});
	const toolResult = projectWorkerResultToNativeApiToolResult(result.result);
	await input.sink.emit({
		type: "tool_call_finished",
		message: `[NativeApiRunner] context-still.${mcpToolName} ${
			toolResult.ok ? "finished" : "failed"
		}.`,
		payload: {
			callId: input.toolCall.id,
			toolName: `context-still.${mcpToolName}`,
			mcpTool: mcpToolName,
			mcpServer: tool.serverName,
			serverId: tool.serverId,
			arguments: input.toolCall.arguments,
			ok: toolResult.ok,
			status: toolResult.ok ? "completed" : "failed",
			result: result.result.payload,
			error: toolResult.error ?? result.result.error,
		},
	});
	const nextState: NativeApiDispatchState = { ...input.state };
	nextStateFromContextStillToolResult(nextState, mcpToolName, toolResult.ok);
	return continueWith(toolResult, nextState);
}

function contextStillMcpToolName(
	toolName: string,
):
	| "initial_instructions"
	| "context_compile"
	| "context_decision"
	| "compile_eval"
	| "register_candidates"
	| null {
	if (toolName === "context_initial_instructions")
		return "initial_instructions";
	if (toolName === "context_compile") return "context_compile";
	if (toolName === "context_decision") return "context_decision";
	if (toolName === "compile_eval") return "compile_eval";
	if (toolName === "register_candidates") return "register_candidates";
	return null;
}

function validateContextStillArguments(
	toolName:
		| "initial_instructions"
		| "context_compile"
		| "context_decision"
		| "compile_eval"
		| "register_candidates",
	args: Record<string, unknown>,
): { code: string; message: string } | null {
	if (toolName === "context_compile") {
		const goal = args.goal;
		if (typeof goal !== "string" || goal.trim().length === 0) {
			return {
				code: "INVALID_TOOL_ARGS",
				message: "context_compile requires a non-empty goal.",
			};
		}
	}
	if (toolName === "context_decision") {
		const decisionPoint = args.decisionPoint;
		if (
			typeof decisionPoint !== "string" ||
			decisionPoint.trim().length === 0
		) {
			return {
				code: "INVALID_TOOL_ARGS",
				message: "context_decision requires a non-empty decisionPoint.",
			};
		}
	}
	if (toolName === "compile_eval") {
		const body = args.body;
		if (typeof body !== "string" || body.trim().length === 0) {
			return {
				code: "INVALID_TOOL_ARGS",
				message: "compile_eval requires a non-empty body.",
			};
		}
		const outcome = args.outcome;
		if (
			outcome !== "useful" &&
			outcome !== "partial" &&
			outcome !== "misleading" &&
			outcome !== "unused"
		) {
			return {
				code: "INVALID_TOOL_ARGS",
				message: "compile_eval requires a valid outcome.",
			};
		}
		for (const key of [
			"actionability",
			"clarity",
			"coverage",
			"relevance",
			"specificity",
		] as const) {
			if (!Number.isInteger(args[key])) {
				return {
					code: "INVALID_TOOL_ARGS",
					message: `compile_eval requires integer ${key}.`,
				};
			}
		}
	}
	if (toolName === "register_candidates" && !Array.isArray(args.items)) {
		return {
			code: "INVALID_TOOL_ARGS",
			message: "register_candidates requires items array.",
		};
	}
	return null;
}

function validateContextStillPrerequisites(
	toolName:
		| "initial_instructions"
		| "context_compile"
		| "context_decision"
		| "compile_eval"
		| "register_candidates",
	state: NativeApiDispatchState,
): { code: string; message: string } | null {
	if (
		(toolName === "initial_instructions" || toolName === "context_compile") &&
		!state.specificationRead
	) {
		return {
			code: "SPECIFICATION_REQUIRED",
			message:
				"read_current_specification must succeed before contextStill initial_instructions or context_compile so the compiled context is grounded in the current task specification.",
		};
	}
	return null;
}

export function nextStateFromContextStillToolResult(
	state: NativeApiDispatchState,
	toolName: unknown,
	ok: boolean,
) {
	if (!ok) return;
	if (toolName === "initial_instructions")
		state.initialInstructionsCompleted = true;
	if (toolName === "context_compile") state.contextCompiled = true;
	if (toolName === "compile_eval") state.compileEvalCompleted = true;
}

async function resolveContextStillTool(
	toolName:
		| "initial_instructions"
		| "context_compile"
		| "context_decision"
		| "compile_eval"
		| "register_candidates",
) {
	const tools = await mcpClientManager.listAvailableTools();
	return (
		tools.find((tool) => tool.name === toolName && isContextStillTool(tool)) ??
		tools.find((tool) => tool.name === toolName) ??
		null
	);
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
