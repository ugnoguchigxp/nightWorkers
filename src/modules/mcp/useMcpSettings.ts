import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  McpServerConfig,
  McpServerImportResult,
  McpServerInput,
  McpServerTestResult,
} from '../nightworkers/types';
import {
  createMcpServer,
  deleteMcpServer,
  fetchMcpServers,
  importMcpServers,
  testMcpServer,
  updateMcpServer,
} from './mcpCommands';

export function useMcpSettings() {
  const queryClient = useQueryClient();
  const { data: mcpServers = [] } = useQuery({
    queryKey: ['mcpServers'],
    queryFn: async () => {
      const res = await fetchMcpServers();
      if (!res.ok) throw new Error('Failed to fetch MCP servers');
      const data = (await res.json()) as { servers: McpServerConfig[] };
      return data.servers;
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return {
    mcpServers,
    createMcpServer: async (input: McpServerInput) => {
      const res = await createMcpServer(input);
      if (!res.ok) throw new Error(await res.text());
      const server = (await res.json()) as McpServerConfig;
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
      return server;
    },
    importMcpServers: async (text: string, testAfterImport = true) => {
      const res = await importMcpServers({ text, testAfterImport });
      if (!res.ok) throw new Error(await res.text());
      const result = (await res.json()) as McpServerImportResult;
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
      return result;
    },
    updateMcpServer: async (id: string, input: Partial<McpServerInput>) => {
      const res = await updateMcpServer(id, input);
      if (!res.ok) throw new Error(await res.text());
      const server = (await res.json()) as McpServerConfig;
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
      return server;
    },
    deleteMcpServer: async (id: string) => {
      const res = await deleteMcpServer(id);
      if (!res.ok) throw new Error(await res.text());
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
    },
    testMcpServer: async (id: string) => {
      const res = await testMcpServer(id);
      if (!res.ok) throw new Error(await res.text());
      const result = (await res.json()) as McpServerTestResult;
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
      return result;
    },
  };
}
