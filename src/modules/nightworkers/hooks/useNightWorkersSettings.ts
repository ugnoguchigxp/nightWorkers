import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api-base';
import type {
  AgentHookConfig,
  AgentHookInput,
  AgentHookTestResult,
  LlmProvider,
  LlmSettings,
  McpServerConfig,
  McpServerImportResult,
  McpServerInput,
  McpServerTestResult,
} from '../types';

export function useNightWorkersSettings() {
  const queryClient = useQueryClient();
  const { data: llmSettings = null } = useQuery({
    queryKey: ['llmSettings'],
    queryFn: async () => {
      const res = await apiFetch('/api/settings/llm');
      if (!res.ok) throw new Error('Failed to fetch llm settings');
      return (await res.json()) as LlmSettings;
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const activeProvider = (llmSettings?.ACTIVE_LLM_PROVIDER || 'azure') as LlmProvider;
  const { data: providerModelOptions = [] } = useQuery({
    queryKey: ['llmModelOptions', activeProvider],
    queryFn: async () => {
      const res = await apiFetch('/api/settings/llm/models');
      if (!res.ok) throw new Error('Failed to fetch model options');
      const data = (await res.json()) as { options: Array<{ value: string; label: string }> };
      return data.options;
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const { data: mcpServers = [] } = useQuery({
    queryKey: ['mcpServers'],
    queryFn: async () => {
      const res = await apiFetch('/api/settings/mcp/servers');
      if (!res.ok) throw new Error('Failed to fetch MCP servers');
      const data = (await res.json()) as { servers: McpServerConfig[] };
      return data.servers;
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const { data: agentHooks = [] } = useQuery({
    queryKey: ['agentHooks'],
    queryFn: async () => {
      const res = await apiFetch('/api/settings/hooks');
      if (!res.ok) throw new Error('Failed to fetch Agent Hooks');
      const data = (await res.json()) as { hooks: AgentHookConfig[] };
      return data.hooks;
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return {
    llmSettings,
    activeProvider,
    providerModelOptions,
    mcpServers,
    agentHooks,
    createMcpServer: async (input: McpServerInput) => {
      const res = await apiFetch('/api/settings/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(await res.text());
      const server = (await res.json()) as McpServerConfig;
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
      return server;
    },
    importMcpServers: async (text: string, testAfterImport = true) => {
      const res = await apiFetch('/api/settings/mcp/servers/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, testAfterImport }),
      });
      if (!res.ok) throw new Error(await res.text());
      const result = (await res.json()) as McpServerImportResult;
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
      return result;
    },
    updateMcpServer: async (id: string, input: Partial<McpServerInput>) => {
      const res = await apiFetch(`/api/settings/mcp/servers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(await res.text());
      const server = (await res.json()) as McpServerConfig;
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
      return server;
    },
    deleteMcpServer: async (id: string) => {
      const res = await apiFetch(`/api/settings/mcp/servers/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
    },
    testMcpServer: async (id: string) => {
      const res = await apiFetch(`/api/settings/mcp/servers/${id}/test`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const result = (await res.json()) as McpServerTestResult;
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
      return result;
    },
    createAgentHook: async (input: AgentHookInput) => {
      const res = await apiFetch('/api/settings/hooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(await res.text());
      const hook = (await res.json()) as AgentHookConfig;
      queryClient.invalidateQueries({ queryKey: ['agentHooks'] });
      return hook;
    },
    updateAgentHook: async (id: string, input: Partial<AgentHookInput>) => {
      const res = await apiFetch(`/api/settings/hooks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(await res.text());
      const hook = (await res.json()) as AgentHookConfig;
      queryClient.invalidateQueries({ queryKey: ['agentHooks'] });
      return hook;
    },
    deleteAgentHook: async (id: string) => {
      const res = await apiFetch(`/api/settings/hooks/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      queryClient.invalidateQueries({ queryKey: ['agentHooks'] });
    },
    testAgentHook: async (id: string) => {
      const res = await apiFetch(`/api/settings/hooks/${id}/test`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const result = (await res.json()) as AgentHookTestResult;
      queryClient.invalidateQueries({ queryKey: ['agentHooks'] });
      return result;
    },
    setActiveProvider: async (provider: LlmProvider) => {
      const merged = { ...(llmSettings || {}), ACTIVE_LLM_PROVIDER: provider } as LlmSettings;
      const res = await apiFetch('/api/settings/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      });
      if (!res.ok) throw new Error('Failed to save llm settings');
      queryClient.invalidateQueries({ queryKey: ['llmSettings'] });
      queryClient.invalidateQueries({ queryKey: ['llmModelOptions'] });
    },
    toggleProviderEnabled: async (provider: LlmProvider, enabled: boolean) => {
      if (!llmSettings) return;
      const flagKey: Record<LlmProvider, keyof LlmSettings> = {
        openai: 'OPENAI_ENABLED',
        azure: 'AZURE_OPENAI_ENABLED',
        bedrock: 'AWS_BEDROCK_ENABLED',
        codex: 'CODEX_ENABLED',
      };
      const merged = { ...llmSettings, [flagKey[provider]]: enabled };
      const res = await apiFetch('/api/settings/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      });
      if (!res.ok) throw new Error('Failed to save llm settings');
      queryClient.invalidateQueries({ queryKey: ['llmSettings'] });
    },
    updateProviderModel: async (model: string) => {
      if (!llmSettings) return;
      const modelKey: Record<LlmProvider, keyof LlmSettings> = {
        openai: 'OPENAI_MODEL',
        azure: 'AZURE_OPENAI_DEPLOYMENT_NAME',
        bedrock: 'AWS_BEDROCK_MODEL',
        codex: 'CODEX_MODEL',
      };
      const merged = { ...llmSettings, [modelKey[activeProvider]]: model };
      const res = await apiFetch('/api/settings/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      });
      if (!res.ok) throw new Error('Failed to save model settings');
      queryClient.invalidateQueries({ queryKey: ['llmSettings'] });
      queryClient.invalidateQueries({ queryKey: ['llmModelOptions'] });
    },
    runLlmSmokeTest: async () => {
      const res = await apiFetch('/api/settings/llm/smoke', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to run smoke');
      return (await res.json()) as { ok: boolean; provider: string; message: string };
    },
  };
}
