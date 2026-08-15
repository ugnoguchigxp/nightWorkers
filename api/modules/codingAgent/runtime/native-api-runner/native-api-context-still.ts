import {
	type McpToolSummary,
	mcpClientManager,
} from "../../../../services/mcp/mcp-client-manager";
import type { ProviderToolCall } from "../../../../services/structured-llm/tool-calls";
import { executeWorkerTool } from "../../../../services/worker-tools/dispatcher";
import { proposeSecurityKnowledgeFeedbackBatch } from "../../../securityIntelligence/security-knowledge-outbox.service";
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
	const effectiveArguments =
		mcpToolName === "context_compile"
			? withSecurityIntelligenceShadow(input.toolCall.arguments, input.context)
			: input.toolCall.arguments;
	const validation = validateContextStillArguments(
		mcpToolName,
		effectiveArguments,
	);
	if (validation) {
		return continueWith(
			failedToolResult(validation.code, validation.message),
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
			arguments: effectiveArguments,
		},
	});
	const result = await executeWorkerTool({
		toolName: "mcp_call_tool",
		args: {
			serverId: tool.serverId,
			toolName: mcpToolName,
			arguments: effectiveArguments,
		},
		repoRoot: input.context.repoRoot,
		taskId: input.context.taskId,
		safetyPolicy: input.context.safetyPolicy,
		readFiles: input.state.readFiles,
	});
	const toolResult = projectWorkerResultToNativeApiToolResult(result.result);
	if (mcpToolName === "context_compile" && toolResult.ok) {
		await recordShadowRetrievalFeedback(input, result.result.payload);
	}
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
			arguments: effectiveArguments,
			ok: toolResult.ok,
			status: toolResult.ok ? "completed" : "failed",
			result: result.result.payload,
			error: toolResult.error ?? result.result.error,
		},
	});
	return continueWith(toolResult, input.state);
}

export function withSecurityIntelligenceShadow(
	args: Record<string, unknown>,
	context: AgentRunContext,
) {
	const securityContext = asRecord(
		asRecord(context.contextSnapshot)?.securityContractContext,
	);
	const contract = asRecord(securityContext?.securityContract);
	const projectRef = contract?.projectRef;
	if (typeof projectRef !== "string" || !projectRef.startsWith("project:")) {
		return args;
	}
	return {
		...args,
		securityIntelligenceShadow: {
			enabled: true,
			taskRef: `task:${context.taskId}`,
			runRef: `run:${context.runId}`,
			projectRef,
		},
	};
}

async function recordShadowRetrievalFeedback(
	input: { context: AgentRunContext; sink: AgentRuntimeSink },
	payload: unknown,
) {
	const mcpResult = asRecord(asRecord(payload)?.result);
	const shadow = asRecord(
		asRecord(mcpResult?._meta)?.securityIntelligenceShadow,
	);
	const compileRunRef = shadow?.compileRunRef;
	const occurredAt = shadow?.occurredAt;
	const items = Array.isArray(shadow?.items) ? shadow.items : [];
	if (
		typeof compileRunRef !== "string" ||
		typeof occurredAt !== "string" ||
		items.length === 0
	) {
		return;
	}
	const events = items.flatMap((rawItem) => {
		const item = asRecord(rawItem);
		return typeof item?.knowledgeRef === "string" &&
			Number.isInteger(item.knowledgeRevision)
			? [
					{
						eventType: "retrieved" as const,
						occurredAt,
						correlation: {
							taskRef: `task:${input.context.taskId}`,
							runRef: `run:${input.context.runId}`,
							compileRunRef,
						},
						knowledgeRef: item.knowledgeRef,
						knowledgeRevision: item.knowledgeRevision as number,
						evidenceRefs: [] as string[],
					},
				]
			: [];
	});
	if (events.length === 0) return;
	try {
		await proposeSecurityKnowledgeFeedbackBatch(
			{
				version: 1,
				runId: input.context.runId,
				commandRef: `shadow-retrieval:${compileRunRef}`,
				events,
			},
			{ producerPrincipalRef: `coding-agent-run:${input.context.runId}` },
		);
	} catch (error) {
		await input.sink.emit({
			type: "runtime_warning",
			message: "Security Intelligence shadow feedback could not be queued.",
			payload: {
				code: "SECURITY_INTELLIGENCE_SHADOW_FEEDBACK_FAILED",
				retryable: true,
				error: error instanceof Error ? error.message : String(error),
			},
		});
	}
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
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
