import { apiFetch } from '../../lib/api-base';
import { jsonRequest } from '../../lib/api-request';
import type { McpServerInput } from '../nightworkers/types';

export function fetchMcpServers() {
  return apiFetch('/api/settings/mcp/servers');
}

export function createMcpServer(input: McpServerInput) {
  return apiFetch('/api/settings/mcp/servers', jsonRequest('POST', input));
}

export function importMcpServers(input: { text: string; testAfterImport: boolean }) {
  return apiFetch('/api/settings/mcp/servers/import', jsonRequest('POST', input));
}

export function updateMcpServer(id: string, input: Partial<McpServerInput>) {
  return apiFetch(`/api/settings/mcp/servers/${id}`, jsonRequest('PUT', input));
}

export function deleteMcpServer(id: string) {
  return apiFetch(`/api/settings/mcp/servers/${id}`, { method: 'DELETE' });
}

export function testMcpServer(id: string) {
  return apiFetch(`/api/settings/mcp/servers/${id}/test`, { method: 'POST' });
}
