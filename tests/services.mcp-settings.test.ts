import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../api/app';
import { readEffectiveMcpServerSettings } from '../api/services/mcp/mcp-effective-settings';
import {
  createMcpServer,
  deleteMcpServer,
  importMcpServersFromText,
  listMcpServers,
  updateMcpServer,
} from '../api/services/mcp/mcp-settings';

let tempDir: string;
let codexHome: string;
const originalCodexHome = process.env.NIGHTWORKERS_CODEX_HOME;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-mcp-settings-'));
  codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-codex-home-'));
  process.env.NIGHTWORKERS_MCP_SETTINGS_PATH = path.join(tempDir, 'mcp-servers.json');
  process.env.NIGHTWORKERS_CODEX_HOME = codexHome;
});

afterEach(() => {
  delete process.env.NIGHTWORKERS_MCP_SETTINGS_PATH;
  if (originalCodexHome === undefined) delete process.env.NIGHTWORKERS_CODEX_HOME;
  else process.env.NIGHTWORKERS_CODEX_HOME = originalCodexHome;
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.rmSync(codexHome, { recursive: true, force: true });
});

describe('MCP server settings', () => {
  it('persists independent non-auth server configs', () => {
    const first = createMcpServer({
      name: 'Local docs',
      enabled: true,
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { NODE_ENV: 'test' },
      toolPrefix: 'local_docs',
    });
    const second = createMcpServer({
      name: 'HTTP docs',
      enabled: false,
      transport: 'streamable_http',
      url: 'http://localhost:8787/mcp',
      toolPrefix: 'http_docs',
    });

    expect(listMcpServers()).toMatchObject([
      { id: first.id, name: 'Local docs', toolPrefix: 'local_docs' },
      { id: second.id, name: 'HTTP docs', toolPrefix: 'http_docs' },
    ]);
  });

  it('rejects secret-like env settings in the first implementation slice', () => {
    expect(() =>
      createMcpServer({
        name: 'Secret server',
        enabled: true,
        transport: 'stdio',
        command: 'node',
        env: { API_KEY: 'abc123' },
        toolPrefix: 'secret_server',
      })
    ).toThrow(/secret-like/i);
  });

  it('keeps authenticated MCP rejection messages user-readable', () => {
    expect(() =>
      createMcpServer({
        name: 'Auth server',
        enabled: true,
        transport: 'streamable_http',
        url: 'https://example.com/mcp',
        toolPrefix: 'auth_server',
        authorization: 'Bearer should-not-save',
      } as never)
    ).toThrow(/Authenticated MCP server settings are not supported yet/i);
  });

  it('rejects duplicate tool prefixes and non-local plain HTTP URLs', () => {
    createMcpServer({
      name: 'First',
      enabled: true,
      transport: 'stdio',
      command: 'node',
      toolPrefix: 'duplicate',
    });

    expect(() =>
      createMcpServer({
        name: 'Second',
        enabled: true,
        transport: 'stdio',
        command: 'node',
        toolPrefix: 'duplicate',
      })
    ).toThrow(/already exists/i);

    expect(() =>
      createMcpServer({
        name: 'Plain remote',
        enabled: true,
        transport: 'streamable_http',
        url: 'http://example.com/mcp',
        toolPrefix: 'plain_remote',
      })
    ).toThrow(/https/i);
  });

  it('updates and deletes a server config', () => {
    const server = createMcpServer({
      name: 'Editable',
      enabled: false,
      transport: 'sse',
      url: 'http://localhost:3010/sse',
      toolPrefix: 'editable',
    });

    const updated = updateMcpServer(server.id, { enabled: true, name: 'Edited' });
    expect(updated).toMatchObject({ id: server.id, enabled: true, name: 'Edited' });

    const removed = deleteMcpServer(server.id);
    expect(removed?.id).toBe(server.id);
    expect(listMcpServers()).toEqual([]);
  });

  it('imports common pasted mcpServers JSON atomically', () => {
    const imported = importMcpServersFromText(
      JSON.stringify({
        mcpServers: {
          docs: {
            command: 'node',
            args: ['server.js'],
            env: { NODE_ENV: 'test' },
          },
          local_http: {
            transport: 'streamable_http',
            url: 'http://localhost:8787/mcp',
          },
        },
      })
    );

    expect(imported).toHaveLength(2);
    expect(imported[0]).toMatchObject({
      name: 'docs',
      transport: 'stdio',
      command: 'node',
      toolPrefix: 'docs',
    });
    expect(imported[1]).toMatchObject({
      name: 'local_http',
      transport: 'streamable_http',
      url: 'http://localhost:8787/mcp',
      toolPrefix: 'local_http',
    });
  });

  it('exposes Codex global MCP servers through the effective settings list', () => {
    fs.writeFileSync(
      path.join(codexHome, 'config.toml'),
      [
        '[mcp_servers.context-still]',
        `command = "${process.execPath}"`,
        'args = ["server.js"]',
        'cwd = "/tmp"',
        '',
        '[mcp_servers.local-http]',
        'url = "http://localhost:8787/mcp"',
        '',
      ].join('\n')
    );

    const settings = readEffectiveMcpServerSettings(process.cwd());

    expect(settings.diagnostics).toEqual([]);
    expect(settings.servers).toMatchObject([
      {
        name: 'context-still',
        source: 'codex_global',
        transport: 'stdio',
        command: process.execPath,
        toolPrefix: 'context_still',
      },
      {
        name: 'local-http',
        source: 'codex_global',
        transport: 'streamable_http',
        url: 'http://localhost:8787/mcp',
        toolPrefix: 'local_http',
      },
    ]);
  });

  it('prefers NightWorkers MCP settings over Codex global toolPrefix conflicts', () => {
    createMcpServer({
      name: 'Local context',
      enabled: true,
      transport: 'stdio',
      command: 'node',
      toolPrefix: 'context_still',
    });
    fs.writeFileSync(
      path.join(codexHome, 'config.toml'),
      ['[mcp_servers.context-still]', `command = "${process.execPath}"`].join('\n')
    );

    const settings = readEffectiveMcpServerSettings(process.cwd());

    expect(settings.servers).toHaveLength(1);
    expect(settings.servers[0]).toMatchObject({
      name: 'Local context',
      source: 'nightworkers_settings',
    });
    expect(settings.diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toMatch(
      /conflicts with NightWorkers settings/i
    );
  });

  it('reports unsupported authenticated Codex global MCP servers without leaking secrets', () => {
    fs.writeFileSync(
      path.join(codexHome, 'config.toml'),
      [
        '[mcp_servers.secret-docs]',
        'url = "https://example.com/mcp"',
        'headers = { Authorization = "Bearer should-not-leak" }',
        '',
      ].join('\n')
    );

    const settings = readEffectiveMcpServerSettings(process.cwd());

    expect(settings.servers).toEqual([]);
    const diagnosticsText = JSON.stringify(settings.diagnostics);
    expect(diagnosticsText).toMatch(/authenticated|unsupported|not supported/i);
    expect(diagnosticsText).not.toContain('should-not-leak');
  });

  it('does not persist partial pasted config when a later server is invalid', () => {
    expect(() =>
      importMcpServersFromText(
        JSON.stringify({
          mcpServers: {
            valid: { command: 'node', args: ['server.js'] },
            invalid_secret: { command: 'node', env: { API_KEY: 'abc123' } },
          },
        })
      )
    ).toThrow(/secret-like/i);

    expect(listMcpServers()).toEqual([]);
  });

  it('rejects pasted authenticated MCP config instead of silently dropping auth fields', () => {
    expect(() =>
      importMcpServersFromText(
        JSON.stringify({
          mcpServers: {
            auth_server: {
              url: 'https://example.com/mcp',
              headers: { Authorization: 'Bearer token' },
            },
          },
        })
      )
    ).toThrow(/authenticated/i);

    expect(listMcpServers()).toEqual([]);
  });

  it('returns diagnostics for invalid persisted settings without erasing the file', async () => {
    fs.writeFileSync(
      process.env.NIGHTWORKERS_MCP_SETTINGS_PATH as string,
      JSON.stringify({ servers: [{ id: 'not-a-uuid', name: 'broken' }] }),
      'utf-8'
    );

    const listRes = await app.request('http://localhost/api/settings/mcp/servers');
    expect(listRes.status).toBe(200);
    await expect(listRes.json()).resolves.toMatchObject({
      servers: [],
      diagnostics: [{ level: 'error', path: 'servers', index: 0 }],
    });
    expect(
      fs.readFileSync(process.env.NIGHTWORKERS_MCP_SETTINGS_PATH as string, 'utf-8')
    ).toContain('not-a-uuid');
  });

  it('exposes CRUD routes under settings/mcp', async () => {
    const createRes = await app.request('http://localhost/api/settings/mcp/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Route server',
        enabled: false,
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        toolPrefix: 'route_server',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const listRes = await app.request('http://localhost/api/settings/mcp/servers');
    expect(listRes.status).toBe(200);
    await expect(listRes.json()).resolves.toMatchObject({
      servers: [{ id: created.id, name: 'Route server' }],
    });

    const updateRes = await app.request(`http://localhost/api/settings/mcp/servers/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(updateRes.status).toBe(200);
    await expect(updateRes.json()).resolves.toMatchObject({ id: created.id, enabled: true });

    const deleteRes = await app.request(`http://localhost/api/settings/mcp/servers/${created.id}`, {
      method: 'DELETE',
      headers: { Origin: 'http://localhost:39174' },
    });
    expect(deleteRes.status).toBe(200);
  });

  it('imports pasted MCP config through the settings route without test launch when requested', async () => {
    const importRes = await app.request('http://localhost/api/settings/mcp/servers/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: JSON.stringify({
          mcpServers: {
            route_docs: {
              command: 'node',
              args: ['server.js'],
              env: { NODE_ENV: 'test' },
            },
          },
        }),
        testAfterImport: false,
      }),
    });

    expect(importRes.status).toBe(201);
    await expect(importRes.json()).resolves.toMatchObject({
      servers: [{ name: 'route_docs', command: 'node', toolPrefix: 'route_docs' }],
      results: [],
    });
  });

  it('turns imported servers off when immediate connection test fails', async () => {
    const importRes = await app.request('http://localhost/api/settings/mcp/servers/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: JSON.stringify({
          mcpServers: {
            missing_binary: {
              command: 'nightworkers-missing-mcp-binary',
            },
          },
        }),
        testAfterImport: true,
      }),
    });

    expect(importRes.status).toBe(201);
    await expect(importRes.json()).resolves.toMatchObject({
      servers: [{ name: 'missing_binary', enabled: false, toolPrefix: 'missing_binary' }],
      results: [{ ok: false }],
    });
  });

  it('records actionable MCP connection failures without leaking secret-like values', async () => {
    const createRes = await app.request('http://localhost/api/settings/mcp/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Failing server',
        enabled: true,
        transport: 'stdio',
        command: process.execPath,
        args: ['-e', 'console.error("api_key=should-not-leak"); process.exit(1)'],
        toolPrefix: 'failing_server',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const testRes = await app.request(
      `http://localhost/api/settings/mcp/servers/${created.id}/test`,
      {
        method: 'POST',
        headers: { Origin: 'http://localhost:39174' },
      }
    );

    expect(testRes.status).toBe(200);
    const body = await testRes.json();
    expect(body.ok).toBe(false);
    expect(body.message).not.toContain('should-not-leak');
  });

  it('returns 404 for non-existent server operations', async () => {
    const nonexistentId = '00000000-0000-0000-0000-000000000000';

    const updateRes = await app.request(
      `http://localhost/api/settings/mcp/servers/${nonexistentId}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }
    );
    expect(updateRes.status).toBe(404);

    const testRes = await app.request(
      `http://localhost/api/settings/mcp/servers/${nonexistentId}/test`,
      {
        method: 'POST',
        headers: { Origin: 'http://localhost:39174' },
      }
    );
    expect(testRes.status).toBe(404);

    const deleteRes = await app.request(
      `http://localhost/api/settings/mcp/servers/${nonexistentId}`,
      {
        method: 'DELETE',
        headers: { Origin: 'http://localhost:39174' },
      }
    );
    expect(deleteRes.status).toBe(404);
  });
});
