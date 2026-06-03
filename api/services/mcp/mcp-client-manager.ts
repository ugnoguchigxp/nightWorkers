import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServerConfig } from './mcp-config-schema';
import { getMcpServer, listMcpServers, updateMcpServerStatus } from './mcp-settings';

export type McpToolSummary = {
  serverId: string;
  serverName: string;
  toolPrefix: string;
  name: string;
  namespacedName: string;
  description?: string;
  inputSchema?: unknown;
};

type ClientEntry = {
  client: Client;
  transport: Transport;
  server: McpServerConfig;
};

const LIST_TOOLS_TIMEOUT_MS = 30_000;
const CALL_TOOL_TIMEOUT_MS = 60_000;

function createTransport(server: McpServerConfig): Transport {
  if (server.transport === 'stdio') {
    return new StdioClientTransport({
      command: server.command || '',
      args: server.args,
      cwd: server.cwd,
      env:
        Object.keys(server.env).length > 0
          ? { ...getDefaultEnvironment(), ...server.env }
          : undefined,
      stderr: 'pipe',
    });
  }

  if (server.transport === 'sse') {
    return new SSEClientTransport(new URL(server.url || ''));
  }

  return new StreamableHTTPClientTransport(new URL(server.url || ''));
}

function namespaceToolName(server: McpServerConfig, toolName: string) {
  return `mcp__${server.toolPrefix}__${toolName}`;
}

class McpClientManager {
  private clients = new Map<string, ClientEntry>();

  async getClient(server: McpServerConfig): Promise<Client> {
    const existing = this.clients.get(server.id);
    if (existing && existing.server.updatedAt === server.updatedAt && server.enabled) {
      return existing.client;
    }
    await this.disconnect(server.id);

    const client = new Client(
      { name: 'nightworkers-mcp-bridge', version: '0.1.0' },
      { capabilities: {} }
    );
    const transport = createTransport(server);
    await client.connect(transport);
    this.clients.set(server.id, { client, transport, server });
    return client;
  }

  async listToolsForServer(server: McpServerConfig): Promise<McpToolSummary[]> {
    if (!server.enabled) return [];
    const client = await this.getClient(server);
    const tools: McpToolSummary[] = [];
    let cursor: string | undefined;
    do {
      const result = await client.listTools(cursor ? { cursor } : undefined, {
        timeout: LIST_TOOLS_TIMEOUT_MS,
      });
      tools.push(
        ...result.tools.map((tool) => ({
          serverId: server.id,
          serverName: server.name,
          toolPrefix: server.toolPrefix,
          name: tool.name,
          namespacedName: namespaceToolName(server, tool.name),
          description: tool.description,
          inputSchema: tool.inputSchema,
        }))
      );
      cursor = result.nextCursor;
    } while (cursor);
    return tools;
  }

  async listAvailableTools(): Promise<McpToolSummary[]> {
    const enabledServers = listMcpServers().filter((server) => server.enabled);
    const toolLists = await Promise.allSettled(
      enabledServers.map((server) => this.listToolsForServer(server))
    );
    return toolLists.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  }

  async testServer(server: McpServerConfig) {
    try {
      const tools = await this.listToolsForServer({ ...server, enabled: true });
      const status = {
        ok: true,
        checkedAt: new Date().toISOString(),
        message: `Connected. ${tools.length} tools available.`,
        toolCount: tools.length,
      };
      updateMcpServerStatus(server.id, status);
      await this.disconnect(server.id);
      return status;
    } catch (err) {
      const status = {
        ok: false,
        checkedAt: new Date().toISOString(),
        message: err instanceof Error ? err.message : String(err),
        toolCount: 0,
      };
      updateMcpServerStatus(server.id, status);
      await this.disconnect(server.id);
      return status;
    }
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>) {
    const server = getMcpServer(serverId);
    if (!server) throw new Error(`MCP server is not configured: ${serverId}`);
    if (!server.enabled) throw new Error(`MCP server is disabled: ${server.name}`);
    const tools = await this.listToolsForServer(server);
    if (!tools.some((tool) => tool.name === toolName)) {
      throw new Error(`MCP tool is not available on server ${server.name}: ${toolName}`);
    }
    const client = await this.getClient(server);
    return await client.callTool(
      {
        name: toolName,
        arguments: args,
      },
      undefined,
      { timeout: CALL_TOOL_TIMEOUT_MS }
    );
  }

  async disconnect(serverId: string) {
    const existing = this.clients.get(serverId);
    if (!existing) return;
    try {
      if (existing.transport instanceof StreamableHTTPClientTransport) {
        try {
          await existing.transport.terminateSession();
        } catch {
          // Some servers legitimately respond 405 for session termination.
        }
      }
      await existing.client.close();
    } finally {
      this.clients.delete(serverId);
    }
  }

  async disconnectAll() {
    await Promise.all([...this.clients.keys()].map((serverId) => this.disconnect(serverId)));
  }
}

export const mcpClientManager = new McpClientManager();
