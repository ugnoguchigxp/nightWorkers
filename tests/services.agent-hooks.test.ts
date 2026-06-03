import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../api/app';
import { matcherMatchesTool } from '../api/services/hooks/hooks-matcher';
import { runAgentHooks } from '../api/services/hooks/hooks-runner';
import {
  createAgentHook,
  deleteAgentHook,
  listAgentHooks,
  updateAgentHook,
} from '../api/services/hooks/hooks-settings';
import type { AgentHookInput } from '../api/services/hooks/types';

let tempDir: string;

const baseToolInput: AgentHookInput = {
  hook_event_name: 'PreToolUse',
  session_id: 'task-1',
  run_id: '00000000-0000-4000-8000-000000000001',
  task_id: 'task-1',
  repository_id: 'repo-1',
  cwd: process.cwd(),
  timestamp: new Date().toISOString(),
  tool_name: 'run_command',
  tool_input: { command: 'pnpm test' },
  tool_use_id: 'tool-1',
};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-agent-hooks-'));
  process.env.NIGHTWORKERS_HOOKS_SETTINGS_PATH = path.join(tempDir, 'agent-hooks.json');
});

afterEach(() => {
  delete process.env.NIGHTWORKERS_HOOKS_SETTINGS_PATH;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('Agent Hooks settings', () => {
  it('persists and updates hook configs', () => {
    const hook = createAgentHook({
      name: 'Block command',
      enabled: true,
      event: 'PreToolUse',
      matcher: 'run_command',
      handler: {
        type: 'command',
        command: process.execPath,
        args: ['-e', 'console.log("{}")'],
      },
    });

    expect(listAgentHooks()).toMatchObject([{ id: hook.id, name: 'Block command' }]);
    expect(updateAgentHook(hook.id, { enabled: false })).toMatchObject({
      id: hook.id,
      enabled: false,
    });
    expect(deleteAgentHook(hook.id)?.id).toBe(hook.id);
    expect(listAgentHooks()).toEqual([]);
  });

  it('rejects secret-like hook env and headers', () => {
    expect(() =>
      createAgentHook({
        name: 'Secret env',
        enabled: true,
        event: 'PreToolUse',
        matcher: '*',
        handler: {
          type: 'command',
          command: process.execPath,
          env: { API_KEY: 'abc' },
        },
      })
    ).toThrow(/secret-like/i);

    expect(() =>
      createAgentHook({
        name: 'Secret header',
        enabled: true,
        event: 'PreToolUse',
        matcher: '*',
        handler: {
          type: 'http',
          url: 'http://localhost:8787/hook',
          headers: { Authorization: 'Bearer abc' },
        },
      })
    ).toThrow(/secret-like/i);
  });
});

describe('Agent Hooks matcher', () => {
  it('supports wildcard, exact, alternation, and regex matchers', () => {
    expect(matcherMatchesTool('*', 'run_command')).toBe(true);
    expect(matcherMatchesTool('run_command', 'run_command')).toBe(true);
    expect(matcherMatchesTool('read_file|run_command', 'run_command')).toBe(true);
    expect(matcherMatchesTool('^run_.*', 'run_verification')).toBe(true);
    expect(matcherMatchesTool('read_file', 'run_command')).toBe(false);
  });
});

describe('Agent Hooks runner', () => {
  it('passes JSON on stdin to command hooks and aggregates deny decisions', async () => {
    createAgentHook({
      name: 'Deny run command',
      enabled: true,
      event: 'PreToolUse',
      matcher: 'run_command',
      handler: {
        type: 'command',
        command: process.execPath,
        args: [
          '-e',
          [
            'let data="";',
            'process.stdin.on("data", c => data += c);',
            'process.stdin.on("end", () => {',
            ' const input = JSON.parse(data);',
            ' console.log(JSON.stringify({hookSpecificOutput:{permissionDecision: input.tool_name === "run_command" ? "deny" : "allow", permissionDecisionReason:"blocked by test"}}));',
            '});',
          ].join(''),
        ],
      },
    });

    const result = await runAgentHooks({ input: baseToolInput, repoRoot: process.cwd() });

    expect(result.decision).toBe('deny');
    expect(result.reason).toBe('blocked by test');
    expect(result.runs[0]).toMatchObject({ ok: true, hookName: 'Deny run command' });
  });

  it('defaults command PreToolUse failures to fail-closed', async () => {
    createAgentHook({
      name: 'Crashing pre hook',
      enabled: true,
      event: 'PreToolUse',
      matcher: 'run_command',
      handler: {
        type: 'command',
        command: process.execPath,
        args: ['-e', 'process.exit(9)'],
      },
    });

    const result = await runAgentHooks({ input: baseToolInput, repoRoot: process.cwd() });

    expect(result.decision).toBe('deny');
    expect(result.reason).toMatch(/code 9/i);
  });

  it('posts JSON to HTTP hooks', async () => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += String(chunk);
      });
      req.on('end', () => {
        const input = JSON.parse(body);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ additionalContext: `saw ${input.tool_name}` }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test server port');

    createAgentHook({
      name: 'HTTP context',
      enabled: true,
      event: 'PostToolUse',
      matcher: 'run_command',
      handler: {
        type: 'http',
        url: `http://localhost:${address.port}/hook`,
      },
    });

    const result = await runAgentHooks({
      input: {
        ...baseToolInput,
        hook_event_name: 'PostToolUse',
        tool_result: { ok: true },
      },
      repoRoot: process.cwd(),
    });
    server.close();

    expect(result.additionalContext).toBe('saw run_command');
  });

  it('interpolates only explicitly allowed env vars in HTTP headers', async () => {
    process.env.NIGHTWORKERS_HOOK_HEADER_VALUE = 'allowed-value';
    let receivedAllowed = '';
    let receivedDenied = '';
    const server = http.createServer((req, res) => {
      receivedAllowed = String(req.headers['x-allowed'] || '');
      receivedDenied = String(req.headers['x-denied'] || '');
      req.resume();
      res.setHeader('Content-Type', 'application/json');
      res.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test server port');

    createAgentHook({
      name: 'HTTP headers',
      enabled: true,
      event: 'PostToolUse',
      matcher: 'run_command',
      handler: {
        type: 'http',
        url: `http://localhost:${address.port}/hook`,
        headers: {
          'X-Allowed': '$NIGHTWORKERS_HOOK_HEADER_VALUE',
          'X-Denied': '$NIGHTWORKERS_NOT_ALLOWED',
        },
        allowedEnvVars: ['NIGHTWORKERS_HOOK_HEADER_VALUE'],
      },
    });

    await runAgentHooks({
      input: {
        ...baseToolInput,
        hook_event_name: 'PostToolUse',
        tool_result: { ok: true },
      },
      repoRoot: process.cwd(),
    });
    server.close();
    delete process.env.NIGHTWORKERS_HOOK_HEADER_VALUE;

    expect(receivedAllowed).toBe('allowed-value');
    expect(receivedDenied).toBe('');
  });
});

describe('Agent Hooks settings routes', () => {
  it('exposes CRUD routes under settings/hooks', async () => {
    const createRes = await app.request('http://localhost/api/settings/hooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Route hook',
        enabled: true,
        event: 'PreToolUse',
        matcher: 'run_command',
        handler: {
          type: 'command',
          command: process.execPath,
          args: ['-e', 'console.log("{}")'],
        },
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const listRes = await app.request('http://localhost/api/settings/hooks');
    expect(listRes.status).toBe(200);
    await expect(listRes.json()).resolves.toMatchObject({
      hooks: [{ id: created.id, name: 'Route hook' }],
    });

    const updateRes = await app.request(`http://localhost/api/settings/hooks/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(updateRes.status).toBe(200);
    await expect(updateRes.json()).resolves.toMatchObject({ id: created.id, enabled: false });

    const testRes = await app.request(`http://localhost/api/settings/hooks/${created.id}/test`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:39174' },
    });
    expect(testRes.status).toBe(200);
    await expect(testRes.json()).resolves.toMatchObject({ ok: true });

    const deleteRes = await app.request(`http://localhost/api/settings/hooks/${created.id}`, {
      method: 'DELETE',
      headers: { Origin: 'http://localhost:39174' },
    });
    expect(deleteRes.status).toBe(200);
  });
});
