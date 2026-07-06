import { createOpenApiRouter } from "../lib/openapi";
import { mcpClientManager } from "../services/mcp/mcp-client-manager";
import {
	getEffectiveMcpServer,
	readEffectiveMcpServerSettings,
} from "../services/mcp/mcp-effective-settings";
import {
	createMcpServer,
	deleteMcpServer,
	importMcpServersFromText,
	updateMcpServer,
} from "../services/mcp/mcp-settings";
import {
	createMcpServerRoute,
	deleteMcpServerRoute,
	getMcpServersRoute,
	importMcpServersRoute,
	testMcpServerRoute,
	updateMcpServerRoute,
} from "./settings-route-definitions";

export const mcpSettingsRouter = createOpenApiRouter()
	.openapi(getMcpServersRoute, (c) => {
		const settings = readEffectiveMcpServerSettings();
		return c.json(
			{ servers: settings.servers, diagnostics: settings.diagnostics || [] },
			200,
		);
	})
	.openapi(createMcpServerRoute, (c) => {
		const server = createMcpServer(c.req.valid("json"));
		return c.json(server, 201);
	})
	.openapi(importMcpServersRoute, async (c) => {
		const input = c.req.valid("json");
		const servers = importMcpServersFromText(input.text);
		const updatedServers = new Map(
			servers.map((server) => [server.id, server]),
		);
		const results = input.testAfterImport
			? await Promise.all(
					servers.map(async (server) => {
						const status = await mcpClientManager.testServer(server);
						if (!status.ok) {
							const updated = updateMcpServer(server.id, { enabled: false });
							if (updated) updatedServers.set(updated.id, updated);
						}
						return {
							serverId: server.id,
							ok: status.ok,
							message: status.message,
							toolCount: status.toolCount,
						};
					}),
				)
			: [];
		return c.json(
			{
				servers: servers.map(
					(server) => updatedServers.get(server.id) ?? server,
				),
				results,
			},
			201,
		);
	})
	.openapi(updateMcpServerRoute, async (c) => {
		const server = updateMcpServer(c.req.param("id"), c.req.valid("json"));
		if (!server)
			return c.json(
				{ error: { code: "NOT_FOUND", message: "MCP server not found" } },
				404,
			);
		await mcpClientManager.disconnect(server.id);
		return c.json(server, 200);
	})
	.openapi(deleteMcpServerRoute, async (c) => {
		const removed = deleteMcpServer(c.req.param("id"));
		if (!removed)
			return c.json(
				{ error: { code: "NOT_FOUND", message: "MCP server not found" } },
				404,
			);
		await mcpClientManager.disconnect(removed.id);
		return c.json(removed, 200);
	})
	.openapi(testMcpServerRoute, async (c) => {
		const server = getEffectiveMcpServer(c.req.param("id"));
		if (!server)
			return c.json(
				{ error: { code: "NOT_FOUND", message: "MCP server not found" } },
				404,
			);
		const status = await mcpClientManager.testServer(server);
		return c.json(
			{
				ok: status.ok,
				message: status.message,
				toolCount: status.toolCount,
			},
			200,
		);
	});
