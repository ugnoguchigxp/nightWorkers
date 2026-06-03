import { mcpClientManager } from '../mcp/mcp-client-manager';
import type { WorkerToolResult } from './types';

export type McpCallToolPayload = {
  serverId: string;
  toolName: string;
  result?: unknown;
};

export async function mcpCallTool(input: {
  serverId: string;
  toolName: string;
  arguments?: Record<string, unknown>;
}): Promise<WorkerToolResult<McpCallToolPayload>> {
  const startedAt = new Date().toISOString();
  try {
    if (!input.serverId || !input.toolName) {
      throw new Error('mcp_call_tool requires serverId and toolName.');
    }
    const result = await mcpClientManager.callTool(
      input.serverId,
      input.toolName,
      input.arguments || {}
    );
    return {
      ok: true,
      toolName: 'mcp_call_tool',
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
      toolName: 'mcp_call_tool',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        serverId: input.serverId,
        toolName: input.toolName,
      },
      error: {
        code: 'MCP_TOOL_CALL_FAILED',
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
