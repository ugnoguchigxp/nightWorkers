import { createRoute, z } from "@hono/zod-openapi";
import {
	mcpServerConfigSchema,
	mcpServerImportRequestSchema,
	mcpServerImportResponseSchema,
	mcpServerInputSchema,
	mcpServersResponseSchema,
	mcpServerTestResponseSchema,
	mcpServerUpdateInputSchema,
} from "../../../services/mcp/mcp-config-schema";

export const getMcpServersRoute = createRoute({
	method: "get",
	path: "/mcp/servers",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: mcpServersResponseSchema,
				},
			},
			description: "List configured MCP servers",
		},
	},
});

export const createMcpServerRoute = createRoute({
	method: "post",
	path: "/mcp/servers",
	request: {
		body: {
			content: {
				"application/json": {
					schema: mcpServerInputSchema,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: mcpServerConfigSchema,
				},
			},
			description: "Create MCP server",
		},
	},
});

export const importMcpServersRoute = createRoute({
	method: "post",
	path: "/mcp/servers/import",
	request: {
		body: {
			content: {
				"application/json": {
					schema: mcpServerImportRequestSchema,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: mcpServerImportResponseSchema,
				},
			},
			description: "Import MCP servers from pasted JSON config",
		},
	},
});

export const updateMcpServerRoute = createRoute({
	method: "put",
	path: "/mcp/servers/{id}",
	request: {
		params: z.object({ id: z.string().uuid() }),
		body: {
			content: {
				"application/json": {
					schema: mcpServerUpdateInputSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: mcpServerConfigSchema,
				},
			},
			description: "Update MCP server",
		},
		404: {
			description: "MCP server not found",
		},
	},
});

export const deleteMcpServerRoute = createRoute({
	method: "delete",
	path: "/mcp/servers/{id}",
	request: {
		params: z.object({ id: z.string().uuid() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: mcpServerConfigSchema,
				},
			},
			description: "Delete MCP server",
		},
		404: {
			description: "MCP server not found",
		},
	},
});

export const testMcpServerRoute = createRoute({
	method: "post",
	path: "/mcp/servers/{id}/test",
	request: {
		params: z.object({ id: z.string().uuid() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: mcpServerTestResponseSchema,
				},
			},
			description: "Test MCP server connection",
		},
		404: {
			description: "MCP server not found",
		},
	},
});
