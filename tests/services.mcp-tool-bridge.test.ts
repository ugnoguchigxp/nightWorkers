import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mcpClientManager } from "../api/services/mcp/mcp-client-manager";
import { createMcpServer } from "../api/services/mcp/mcp-settings";
import { executeWorkerTool } from "../api/services/worker-tools/dispatcher";

let tempDir: string;

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nightworkers-mcp-tool-"));
	process.env.NIGHTWORKERS_MCP_SETTINGS_PATH = path.join(
		tempDir,
		"mcp-servers.json",
	);
});

afterEach(async () => {
	await mcpClientManager.disconnectAll();
	delete process.env.NIGHTWORKERS_MCP_SETTINGS_PATH;
	fs.rmSync(tempDir, { recursive: true, force: true });
});

function writeFakeMcpServer() {
	const serverPath = path.join(tempDir, "fake-mcp-server.mjs");
	fs.writeFileSync(
		serverPath,
		`
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });

function send(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
}

rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    send(msg.id, {
      protocolVersion: msg.params?.protocolVersion || '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'fake-nightworkers-mcp', version: '0.1.0' }
    });
    return;
  }
  if (msg.method === 'notifications/initialized') return;
  if (msg.method === 'tools/list') {
    if (msg.params?.cursor === 'page-2') {
      send(msg.id, {
        tools: [{
          name: 'second_tool',
          description: 'Second page tool',
          inputSchema: { type: 'object', properties: {} }
        }]
      });
      return;
    }
    send(msg.id, {
      tools: [{
        name: 'lookup',
        description: 'Lookup tool',
        annotations: { readOnlyHint: true },
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } }
      }, {
        name: 'mutate',
        description: 'Mutating tool',
        annotations: { readOnlyHint: false },
        inputSchema: { type: 'object', properties: {} }
      }],
      nextCursor: 'page-2'
    });
    return;
  }
  if (msg.method === 'tools/call') {
    if (msg.params.arguments.query === 'error') {
      send(msg.id, {
        content: [{ type: 'text', text: 'lookup failed' }],
        isError: true
      });
      return;
    }
    send(msg.id, {
      content: [{ type: 'text', text: 'lookup:' + msg.params.arguments.query }]
    });
  }
});
`,
		"utf-8",
	);
	return serverPath;
}

describe("MCP worker tool bridge", () => {
	it("rejects invalid mcp_call_tool arguments through the worker dispatcher", async () => {
		const dispatch = await executeWorkerTool({
			toolName: "mcp_call_tool",
			args: { serverId: "", toolName: "lookup" },
			repoRoot: process.cwd(),
			readFiles: [],
		});

		expect(dispatch.result).toMatchObject({
			ok: false,
			error: {
				code: "MCP_TOOL_CALL_FAILED",
				message: "mcp_call_tool requires serverId and toolName.",
			},
		});
	});

	it("returns a normal failed tool result when the MCP server is not configured", async () => {
		const dispatch = await executeWorkerTool({
			toolName: "mcp_call_tool",
			args: {
				serverId: "00000000-0000-4000-8000-000000000000",
				toolName: "lookup",
				arguments: {},
			},
			repoRoot: process.cwd(),
			readFiles: [],
		});

		expect(dispatch.result).toMatchObject({
			ok: false,
			toolName: "mcp_call_tool",
			error: { code: "MCP_TOOL_CALL_FAILED" },
		});
	});

	it("lists paginated tools and calls a stdio MCP tool through the SDK transport", async () => {
		const serverPath = writeFakeMcpServer();
		const server = await createMcpServer({
			name: "Fake MCP",
			enabled: true,
			transport: "stdio",
			command: process.execPath,
			args: [serverPath],
			toolPrefix: "fake",
		});

		const tools = await mcpClientManager.listToolsForServer(server);
		expect(tools.map((tool) => tool.name)).toEqual([
			"lookup",
			"mutate",
			"second_tool",
		]);
		expect(tools.find((tool) => tool.name === "mutate")?.annotations).toEqual({
			readOnlyHint: false,
		});

		const dispatch = await executeWorkerTool({
			toolName: "mcp_call_tool",
			args: {
				serverId: server.id,
				toolName: "lookup",
				arguments: { query: "nightworkers" },
			},
			repoRoot: process.cwd(),
			readFiles: [],
		});

		expect(dispatch.result.ok).toBe(true);
		expect(JSON.stringify(dispatch.result.payload)).toContain(
			"lookup:nightworkers",
		);
	});

	it("blocks explicitly mutating MCP tools in the model-facing generic bridge", async () => {
		const serverPath = writeFakeMcpServer();
		const server = await createMcpServer({
			name: "Fake MCP",
			enabled: true,
			transport: "stdio",
			command: process.execPath,
			args: [serverPath],
			toolPrefix: "fake",
		});

		const dispatch = await executeWorkerTool({
			toolName: "mcp_call_tool",
			args: { serverId: server.id, toolName: "mutate", arguments: {} },
			repoRoot: process.cwd(),
			readFiles: [],
		});
		expect(dispatch.result).toMatchObject({
			ok: false,
			error: { code: "MCP_MUTATING_TOOL_BLOCKED" },
		});
	});

	it("blocks dedicated Project Intelligence tools in the generic MCP bridge", async () => {
		for (const toolName of [
			"vuln_prepare_project_intelligence",
			"vuln_get_project_intelligence_status",
			"vuln_get_project_exploration_catalog",
		]) {
			const dispatch = await executeWorkerTool({
				toolName: "mcp_call_tool",
				args: { serverId: "any-server", toolName, arguments: {} },
				repoRoot: process.cwd(),
				readFiles: [],
			});
			expect(dispatch.result).toMatchObject({
				ok: false,
				error: { code: "MCP_DEDICATED_TOOL_BLOCKED" },
			});
		}
	});

	it("maps MCP isError tool results to failed worker tool results", async () => {
		const serverPath = writeFakeMcpServer();
		const server = await createMcpServer({
			name: "Fake MCP",
			enabled: true,
			transport: "stdio",
			command: process.execPath,
			args: [serverPath],
			toolPrefix: "fake",
		});

		const dispatch = await executeWorkerTool({
			toolName: "mcp_call_tool",
			args: {
				serverId: server.id,
				toolName: "lookup",
				arguments: { query: "error" },
			},
			repoRoot: process.cwd(),
			readFiles: [],
		});

		expect(dispatch.result).toMatchObject({
			ok: false,
			toolName: "mcp_call_tool",
			error: { code: "MCP_TOOL_EXECUTION_ERROR", message: "lookup failed" },
		});
	});
});
