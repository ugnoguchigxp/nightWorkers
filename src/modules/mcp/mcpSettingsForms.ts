import type { McpServerConfig, McpServerInput, McpServerTransport } from '../nightworkers/types';

export type McpServerForm = {
  id?: string;
  name: string;
  enabled: boolean;
  transport: McpServerTransport;
  command: string;
  argsText: string;
  url: string;
  cwd: string;
  envText: string;
  toolPrefix: string;
};

export const emptyMcpForm: McpServerForm = {
  name: '',
  enabled: true,
  transport: 'stdio',
  command: '',
  argsText: '',
  url: '',
  cwd: '',
  envText: '',
  toolPrefix: '',
};

function parseKeyValueText(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [key, ...rest] = line.split('=');
        return [key.trim(), rest.join('=').trim()];
      })
      .filter(([key]) => key)
  );
}

export function formFromMcpServer(server: McpServerConfig): McpServerForm {
  return {
    id: server.id,
    name: server.name,
    enabled: server.enabled,
    transport: server.transport,
    command: server.command || '',
    argsText: server.args.join(' '),
    url: server.url || '',
    cwd: server.cwd || '',
    envText: Object.entries(server.env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
    toolPrefix: server.toolPrefix,
  };
}

export function mcpFormToInput(form: McpServerForm): McpServerInput {
  return {
    name: form.name.trim(),
    enabled: form.enabled,
    transport: form.transport,
    command: form.command.trim() || undefined,
    args: form.argsText.split(/\s+/).filter(Boolean),
    url: form.url.trim() || undefined,
    cwd: form.cwd.trim() || undefined,
    env: parseKeyValueText(form.envText),
    toolPrefix: form.toolPrefix.trim(),
  };
}
