import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

let tempDir = '';

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('Codex NightWorkers MCP setup script', () => {
  it('installs and removes only the NightWorkers MCP config sections', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-codex-mcp-'));
    const configPath = path.join(tempDir, 'config.toml');
    fs.writeFileSync(
      configPath,
      [
        'model = "gpt-5.5"',
        '',
        '[mcp_servers.context-still]',
        'command = "/bin/context-still"',
        '',
      ].join('\n')
    );

    await execFileAsync(process.execPath, ['scripts/setup-codex-nightworkers-mcp.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, CODEX_CONFIG_PATH: configPath },
    });
    const installed = fs.readFileSync(configPath, 'utf8');
    expect(installed).toContain('[mcp_servers.context-still]');
    expect(installed).toContain('[mcp_servers.nightworkers]');
    expect(installed).toContain('args = ["run", "codex:mcp"]');
    expect(installed).toContain('[mcp_servers.nightworkers.tools.read_current_specification]');
    expect(installed).toContain('[mcp_servers.nightworkers.tools.list_recent_specifications]');
    expect(installed).toContain('[mcp_servers.nightworkers.tools.todo_list]');
    expect(installed).toContain('[mcp_servers.nightworkers.tools.import_project]');
    expect(installed).not.toContain('[mcp_servers.nightworkers.tools.replace_todo_list]');
    expect(installed).not.toContain('apply_patch');

    await execFileAsync(
      process.execPath,
      ['scripts/setup-codex-nightworkers-mcp.mjs', '--remove'],
      {
        cwd: process.cwd(),
        env: { ...process.env, CODEX_CONFIG_PATH: configPath },
      }
    );
    const removed = fs.readFileSync(configPath, 'utf8');
    expect(removed).toContain('[mcp_servers.context-still]');
    expect(removed).not.toContain('[mcp_servers.nightworkers]');
    expect(removed).not.toContain('args = ["run", "codex:mcp"]');
  });
});
