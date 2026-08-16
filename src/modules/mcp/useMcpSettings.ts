import { useQuery, useQueryClient } from "@tanstack/react-query";
import { readJsonResponse } from "../../lib/api-error";
import type {
	McpServerConfig,
	McpServerImportResult,
	McpServerInput,
	McpServerTestResult,
} from "../nightworkers/types";
import {
	createMcpServer,
	deleteMcpServer,
	fetchMcpServers,
	importMcpServers,
	testMcpServer,
	updateMcpServer,
} from "./mcpCommands";

export function useMcpSettings() {
	const queryClient = useQueryClient();
	const { data: mcpServers = [] } = useQuery({
		queryKey: ["mcpServers"],
		queryFn: async () => {
			const data = await readJsonResponse<{ servers: McpServerConfig[] }>(
				await fetchMcpServers(),
			);
			return data.servers;
		},
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	return {
		mcpServers,
		createMcpServer: async (input: McpServerInput) => {
			const server = await readJsonResponse<McpServerConfig>(
				await createMcpServer(input),
			);
			queryClient.invalidateQueries({ queryKey: ["mcpServers"] });
			return server;
		},
		importMcpServers: async (text: string, testAfterImport = true) => {
			const result = await readJsonResponse<McpServerImportResult>(
				await importMcpServers({ text, testAfterImport }),
			);
			queryClient.invalidateQueries({ queryKey: ["mcpServers"] });
			return result;
		},
		updateMcpServer: async (id: string, input: Partial<McpServerInput>) => {
			const server = await readJsonResponse<McpServerConfig>(
				await updateMcpServer(id, input),
			);
			queryClient.invalidateQueries({ queryKey: ["mcpServers"] });
			return server;
		},
		deleteMcpServer: async (id: string) => {
			await readJsonResponse(await deleteMcpServer(id));
			queryClient.invalidateQueries({ queryKey: ["mcpServers"] });
		},
		testMcpServer: async (id: string) => {
			const result = await readJsonResponse<McpServerTestResult>(
				await testMcpServer(id),
			);
			queryClient.invalidateQueries({ queryKey: ["mcpServers"] });
			return result;
		},
	};
}
