import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
	getDefaultEnvironment,
	StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig } from "./mcp-config-schema";
import {
	getEffectiveMcpServer,
	listEffectiveMcpServers,
} from "./mcp-effective-settings";
import { updateMcpServerStatus } from "./mcp-settings";

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
	if (server.transport === "stdio") {
		return new StdioClientTransport({
			command: server.command || "",
			args: server.args,
			cwd: server.cwd,
			env:
				Object.keys(server.env).length > 0
					? { ...getDefaultEnvironment(), ...server.env }
					: undefined,
			stderr: "pipe",
		});
	}

	if (server.transport === "sse") {
		return new SSEClientTransport(new URL(server.url || ""));
	}

	return new StreamableHTTPClientTransport(new URL(server.url || ""));
}

function namespaceToolName(server: McpServerConfig, toolName: string) {
	return `mcp__${server.toolPrefix}__${toolName}`;
}

async function createClientEntry(
	server: McpServerConfig,
): Promise<ClientEntry> {
	const client = new Client(
		{ name: "nightworkers-mcp-bridge", version: "0.1.0" },
		{ capabilities: {} },
	);
	const transport = createTransport(server);
	await client.connect(transport);
	return { client, transport, server };
}

async function closeClientEntry(entry: ClientEntry) {
	try {
		if (entry.transport instanceof StreamableHTTPClientTransport) {
			try {
				await entry.transport.terminateSession();
			} catch {
				// Some servers legitimately respond 405 for session termination.
			}
		}
		await entry.client.close();
	} catch {
		// Closing a failed transport is best-effort.
	}
}

class McpClientManager {
	private clients = new Map<string, ClientEntry>();

	async getClient(server: McpServerConfig): Promise<Client> {
		const existing = this.clients.get(server.id);
		if (
			existing &&
			existing.server.updatedAt === server.updatedAt &&
			server.enabled
		) {
			return existing.client;
		}
		await this.disconnect(server.id);

		const entry = await createClientEntry(server);
		this.clients.set(server.id, entry);
		return entry.client;
	}

	private async listToolsWithClient(
		server: McpServerConfig,
		client: Client,
	): Promise<McpToolSummary[]> {
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
				})),
			);
			cursor = result.nextCursor;
		} while (cursor);
		return tools;
	}

	async listToolsForServer(server: McpServerConfig): Promise<McpToolSummary[]> {
		if (!server.enabled) return [];
		const client = await this.getClient(server);
		return this.listToolsWithClient(server, client);
	}

	async listAvailableTools(): Promise<McpToolSummary[]> {
		const enabledServers = listEffectiveMcpServers().filter(
			(server) => server.enabled,
		);
		const toolLists = await Promise.allSettled(
			enabledServers.map((server) => this.listToolsForServer(server)),
		);
		return toolLists.flatMap((result) =>
			result.status === "fulfilled" ? result.value : [],
		);
	}

	async testServer(server: McpServerConfig) {
		let entry: ClientEntry | null = null;
		try {
			const testServer = { ...server, enabled: true };
			entry = await createClientEntry(testServer);
			const tools = await this.listToolsWithClient(testServer, entry.client);
			const status = {
				ok: true,
				checkedAt: new Date().toISOString(),
				message: `Connected. ${tools.length} tools available.`,
				toolCount: tools.length,
			};
			await updateMcpServerStatus(server.id, status);
			return status;
		} catch (err) {
			const status = {
				ok: false,
				checkedAt: new Date().toISOString(),
				message: sanitizeMcpStatusMessage(
					err instanceof Error ? err.message : String(err),
				),
				toolCount: 0,
			};
			await updateMcpServerStatus(server.id, status);
			return status;
		} finally {
			if (entry) await closeClientEntry(entry);
		}
	}

	async callTool(
		serverId: string,
		toolName: string,
		args: Record<string, unknown>,
	) {
		const server = getEffectiveMcpServer(serverId);
		if (!server) throw new Error(`MCP server is not configured: ${serverId}`);
		if (!server.enabled)
			throw new Error(`MCP server is disabled: ${server.name}`);
		const tools = await this.listToolsForServer(server);
		if (!tools.some((tool) => tool.name === toolName)) {
			throw new Error(
				`MCP tool is not available on server ${server.name}: ${toolName}`,
			);
		}
		const client = await this.getClient(server);
		return await client.callTool(
			{
				name: toolName,
				arguments: args,
			},
			undefined,
			{ timeout: CALL_TOOL_TIMEOUT_MS },
		);
	}

	async disconnect(serverId: string) {
		const existing = this.clients.get(serverId);
		if (!existing) return;
		try {
			await closeClientEntry(existing);
		} finally {
			this.clients.delete(serverId);
		}
	}

	async disconnectAll() {
		await Promise.all(
			[...this.clients.keys()].map((serverId) => this.disconnect(serverId)),
		);
	}
}

function sanitizeMcpStatusMessage(message: string): string {
	return message.replace(
		/(?:api[_-]?key|token|password|secret|authorization|bearer)\s*[:=]\s*['"]?[^\s'"]+/gi,
		"[redacted]",
	);
}

export const mcpClientManager = new McpClientManager();
