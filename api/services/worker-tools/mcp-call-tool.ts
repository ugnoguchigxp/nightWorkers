import { mcpClientManager } from "../mcp/mcp-client-manager";
import type { WorkerToolResult } from "./types";

export type McpCallToolPayload = {
	serverId: string;
	toolName: string;
	result?: unknown;
};

function isMcpToolExecutionError(result: unknown): boolean {
	return Boolean(
		result &&
			typeof result === "object" &&
			(result as { isError?: unknown }).isError,
	);
}

function summarizeMcpToolError(result: unknown): string {
	if (!result || typeof result !== "object")
		return "MCP tool returned an execution error.";
	const content = (result as { content?: unknown }).content;
	if (!Array.isArray(content)) return "MCP tool returned an execution error.";
	const text = content
		.flatMap((item) =>
			item &&
			typeof item === "object" &&
			typeof (item as { text?: unknown }).text === "string"
				? [(item as { text: string }).text]
				: [],
		)
		.join("\n")
		.trim();
	return text || "MCP tool returned an execution error.";
}

export async function mcpCallTool(input: {
	serverId: string;
	toolName: string;
	arguments?: Record<string, unknown>;
}): Promise<WorkerToolResult<McpCallToolPayload>> {
	const startedAt = new Date().toISOString();
	try {
		if (!input.serverId || !input.toolName) {
			throw new Error("mcp_call_tool requires serverId and toolName.");
		}
		const execution = await mcpClientManager.callToolGuarded(
			input.serverId,
			input.toolName,
			input.arguments || {},
			(tool) => tool.annotations?.readOnlyHint !== false,
		);
		if (!execution.allowed) {
			return {
				ok: false,
				toolName: "mcp_call_tool",
				startedAt,
				finishedAt: new Date().toISOString(),
				payload: {
					serverId: input.serverId,
					toolName: input.toolName,
				},
				error: {
					code: "MCP_MUTATING_TOOL_BLOCKED",
					message:
						"Mutating MCP tools cannot be called through the model-facing generic bridge.",
				},
			};
		}
		const { result } = execution;
		if (isMcpToolExecutionError(result)) {
			return {
				ok: false,
				toolName: "mcp_call_tool",
				startedAt,
				finishedAt: new Date().toISOString(),
				payload: {
					serverId: input.serverId,
					toolName: input.toolName,
					result,
				},
				error: {
					code: "MCP_TOOL_EXECUTION_ERROR",
					message: summarizeMcpToolError(result),
				},
			};
		}
		return {
			ok: true,
			toolName: "mcp_call_tool",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: {
				serverId: input.serverId,
				toolName: input.toolName,
				result,
			},
		};
	} catch (err) {
		return {
			ok: false,
			toolName: "mcp_call_tool",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: {
				serverId: input.serverId,
				toolName: input.toolName,
			},
			error: {
				code: "MCP_TOOL_CALL_FAILED",
				message: err instanceof Error ? err.message : String(err),
			},
		};
	}
}
