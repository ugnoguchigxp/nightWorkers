import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ValidationError } from '../../lib/errors';
import {
  type McpServerConfig,
  type McpServerInput,
  type McpServerTransport,
  mcpServerConfigSchema,
  mcpServerInputSchema,
} from './mcp-config-schema';

const RUNTIME_SETTINGS_DIR = path.resolve(process.cwd(), 'api/.runtime');
const DEFAULT_MCP_SETTINGS_PATH = path.join(RUNTIME_SETTINGS_DIR, 'mcp-servers.json');

type PersistedMcpSettings = {
  servers: McpServerConfig[];
};

function getMcpSettingsPath() {
  return process.env.NIGHTWORKERS_MCP_SETTINGS_PATH || DEFAULT_MCP_SETTINGS_PATH;
}

function parsePersistedSettings(value: unknown): PersistedMcpSettings {
  if (!value || typeof value !== 'object') return { servers: [] };
  const rawServers = Array.isArray((value as { servers?: unknown }).servers)
    ? (value as { servers: unknown[] }).servers
    : [];
  const servers = rawServers.flatMap((server) => {
    const parsed = mcpServerConfigSchema.safeParse(server);
    return parsed.success ? [parsed.data] : [];
  });
  return { servers };
}

export function readMcpServerSettings(): PersistedMcpSettings {
  try {
    const settingsPath = getMcpSettingsPath();
    if (!fs.existsSync(settingsPath)) return { servers: [] };
    return parsePersistedSettings(JSON.parse(fs.readFileSync(settingsPath, 'utf-8')));
  } catch {
    return { servers: [] };
  }
}

function writeMcpServerSettings(settings: PersistedMcpSettings) {
  const settingsPath = getMcpSettingsPath();
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
}

export function listMcpServers(): McpServerConfig[] {
  return readMcpServerSettings().servers;
}

export function getMcpServer(id: string): McpServerConfig | null {
  return listMcpServers().find((server) => server.id === id) ?? null;
}

export function createMcpServer(input: McpServerInput): McpServerConfig {
  const parsed = mcpServerInputSchema.parse(input);
  const settings = readMcpServerSettings();
  if (settings.servers.some((server) => server.toolPrefix === parsed.toolPrefix)) {
    throw new ValidationError(`MCP toolPrefix already exists: ${parsed.toolPrefix}`);
  }
  const now = new Date().toISOString();
  const server = mcpServerConfigSchema.parse({
    ...parsed,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  });
  settings.servers.push(server);
  writeMcpServerSettings(settings);
  return server;
}

function normalizeToolPrefix(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  if (/^[a-z]/.test(normalized)) return normalized.slice(0, 64);
  return `mcp_${normalized || 'server'}`.slice(0, 64);
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new ValidationError('MCP config paste must be valid JSON.', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function transportFromRaw(raw: Record<string, unknown>): McpServerTransport {
  const value = String(raw.transport || raw.type || '').toLowerCase();
  if (value === 'stdio') return 'stdio';
  if (value === 'sse') return 'sse';
  if (
    value === 'streamable_http' ||
    value === 'streamable-http' ||
    value === 'http' ||
    value === 'https'
  ) {
    return 'streamable_http';
  }
  if (typeof raw.command === 'string') return 'stdio';
  if (typeof raw.url === 'string') return 'streamable_http';
  throw new ValidationError('MCP server transport could not be inferred.');
}

function inputFromRawServer(nameHint: string, rawValue: unknown): McpServerInput {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    throw new ValidationError(`Invalid MCP server config for ${nameHint}.`);
  }
  const raw = rawValue as Record<string, unknown>;
  const name =
    typeof raw.name === 'string' && raw.name.trim().length > 0 ? raw.name.trim() : nameHint;
  const transport = transportFromRaw(raw);
  const args = Array.isArray(raw.args) ? raw.args.map((arg) => String(arg)) : [];
  const env =
    raw.env && typeof raw.env === 'object' && !Array.isArray(raw.env)
      ? Object.fromEntries(
          Object.entries(raw.env as Record<string, unknown>).map(([key, value]) => [
            key,
            String(value),
          ])
        )
      : {};
  return mcpServerInputSchema.parse({
    name,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    transport,
    command: typeof raw.command === 'string' ? raw.command : undefined,
    args,
    url: typeof raw.url === 'string' ? raw.url : undefined,
    cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
    env,
    toolPrefix:
      typeof raw.toolPrefix === 'string' && raw.toolPrefix.trim().length > 0
        ? raw.toolPrefix
        : normalizeToolPrefix(nameHint),
  });
}

export function parseMcpServerPaste(text: string): McpServerInput[] {
  const parsed = parseJsonText(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new ValidationError('MCP config paste must be a JSON object or array.');
  }

  if (Array.isArray(parsed)) {
    return parsed.map((item, index) => inputFromRawServer(`server_${index + 1}`, item));
  }

  const root = parsed as Record<string, unknown>;
  if (root.mcpServers && typeof root.mcpServers === 'object' && !Array.isArray(root.mcpServers)) {
    return Object.entries(root.mcpServers as Record<string, unknown>).map(([name, value]) =>
      inputFromRawServer(name, value)
    );
  }
  if (Array.isArray(root.servers)) {
    return root.servers.map((item, index) => inputFromRawServer(`server_${index + 1}`, item));
  }
  if (root.server && typeof root.server === 'object' && !Array.isArray(root.server)) {
    return [inputFromRawServer('server', root.server)];
  }
  return [inputFromRawServer('server', root)];
}

export function importMcpServersFromText(text: string): McpServerConfig[] {
  const inputs = parseMcpServerPaste(text);
  if (inputs.length === 0) {
    throw new ValidationError('No MCP servers found in pasted config.');
  }
  const settings = readMcpServerSettings();
  const seen = new Set<string>();
  for (const input of inputs) {
    if (seen.has(input.toolPrefix)) {
      throw new ValidationError(`Duplicate MCP toolPrefix in pasted config: ${input.toolPrefix}`);
    }
    if (settings.servers.some((server) => server.toolPrefix === input.toolPrefix)) {
      throw new ValidationError(`MCP toolPrefix already exists: ${input.toolPrefix}`);
    }
    seen.add(input.toolPrefix);
  }
  const now = new Date().toISOString();
  const servers = inputs.map((input) =>
    mcpServerConfigSchema.parse({
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    })
  );
  settings.servers.push(...servers);
  writeMcpServerSettings(settings);
  return servers;
}

export function updateMcpServer(
  id: string,
  input: Partial<McpServerInput>
): McpServerConfig | null {
  const settings = readMcpServerSettings();
  const index = settings.servers.findIndex((server) => server.id === id);
  if (index === -1) return null;

  const current = settings.servers[index];
  const parsed = mcpServerInputSchema.parse({
    name: input.name ?? current.name,
    enabled: input.enabled ?? current.enabled,
    transport: input.transport ?? current.transport,
    command: input.command ?? current.command,
    args: input.args ?? current.args,
    url: input.url ?? current.url,
    cwd: input.cwd ?? current.cwd,
    env: input.env ?? current.env,
    toolPrefix: input.toolPrefix ?? current.toolPrefix,
  });
  if (
    settings.servers.some((server) => server.id !== id && server.toolPrefix === parsed.toolPrefix)
  ) {
    throw new ValidationError(`MCP toolPrefix already exists: ${parsed.toolPrefix}`);
  }
  const updated = mcpServerConfigSchema.parse({
    ...current,
    ...parsed,
    updatedAt: new Date().toISOString(),
  });
  settings.servers[index] = updated;
  writeMcpServerSettings(settings);
  return updated;
}

export function deleteMcpServer(id: string): McpServerConfig | null {
  const settings = readMcpServerSettings();
  const index = settings.servers.findIndex((server) => server.id === id);
  if (index === -1) return null;
  const [removed] = settings.servers.splice(index, 1);
  writeMcpServerSettings(settings);
  return removed ?? null;
}

export function updateMcpServerStatus(
  id: string,
  status: McpServerConfig['lastStatus']
): McpServerConfig | null {
  const settings = readMcpServerSettings();
  const index = settings.servers.findIndex((server) => server.id === id);
  if (index === -1) return null;
  const updated = mcpServerConfigSchema.parse({
    ...settings.servers[index],
    lastStatus: status,
    updatedAt: new Date().toISOString(),
  });
  settings.servers[index] = updated;
  writeMcpServerSettings(settings);
  return updated;
}
