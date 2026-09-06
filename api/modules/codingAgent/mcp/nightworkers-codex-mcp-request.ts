import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ensureNightWorkersSchema } from "../../../db/bootstrap";
import { createNightWorkersCodexMcpServer } from "./nightworkers-codex-mcp-server";
import {
	isLoopbackNightWorkersMcpRequest,
	readNightWorkersMcpRequestContext,
} from "./nightworkers-codex-mcp-support";

export async function handleNightWorkersCodexMcpRequest(
	request: Request,
): Promise<Response> {
	if (!isLoopbackNightWorkersMcpRequest(request)) {
		return Response.json(
			{
				jsonrpc: "2.0",
				id: null,
				error: {
					code: -32000,
					message: "NightWorkers MCP is only available from loopback hosts.",
				},
			},
			{ status: 403 },
		);
	}
	await ensureNightWorkersSchema();
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
	});
	const server = createNightWorkersCodexMcpServer(
		readNightWorkersMcpRequestContext(request),
	);
	await server.connect(transport);
	return transport.handleRequest(request);
}
