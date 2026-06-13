import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type CallToolResult,
  Client,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../api/config';
import {
  buildNightWorkersCodexToolApprovalConfig,
  nightWorkersCodexToolManifest,
} from '../api/mcp/nightworkers-tool-manifest';
import {
  createRepository,
  createTask,
  deleteRepository,
  deleteTask,
} from '../api/modules/nightworkers/nightworkers.repository';

let tempDir = '';

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-codex-mcp-integration-'));
  process.env.NIGHTWORKERS_MCP_SETTINGS_PATH = path.join(tempDir, 'mcp-servers.json');
});

afterEach(async () => {
  delete process.env.NIGHTWORKERS_MCP_SETTINGS_PATH;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('NightWorkers Codex MCP integration', () => {
  it('lists the manifest tools and imports a starter project into an empty repository', async () => {
    const repoRoot = path.join(tempDir, 'repo');
    fs.mkdirSync(repoRoot, { recursive: true });

    const repository = await createRepository({
      name: `integration-${Date.now()}`,
      localPath: repoRoot,
      branch: 'main',
      allowed: true,
    });

    const task = await createTask({
      repositoryId: repository.id,
      title: 'NightWorkers MCP import integration',
      status: 'queued',
    });

    let client: Client | null = null;
    try {
      const stderrChunks: string[] = [];
      client = new Client(
        { name: 'nightworkers-codex-mcp-integration-test', version: '0.1.0' },
        { capabilities: {} }
      );
      const transport = new StdioClientTransport({
        command: '/Users/y.noguchi/.bun/bin/bun',
        args: ['api/mcp/nightworkers-codex-server.ts'],
        cwd: process.cwd(),
        env: {
          ...getDefaultEnvironment(),
          DATABASE_URL: config.DATABASE_URL,
          JWT_SECRET: config.JWT_SECRET,
          NODE_ENV: 'test',
        },
        stderr: 'pipe',
      });
      transport.stderr?.on('data', (chunk) => {
        stderrChunks.push(String(chunk));
      });
      try {
        await client.connect(transport);
      } catch (error) {
        throw new Error(
          `Failed to connect to NightWorkers MCP server: ${error instanceof Error ? error.message : String(error)}\n${stderrChunks.join('')}`
        );
      }

      let listResult: ListToolsResult;
      try {
        listResult = await client.listTools(undefined, { timeout: 30_000 });
      } catch (error) {
        throw new Error(
          `Failed to list NightWorkers MCP tools: ${error instanceof Error ? error.message : String(error)}\n${stderrChunks.join('')}`
        );
      }
      expect(listResult.tools.map((tool) => tool.name).sort()).toEqual(
        Object.keys(nightWorkersCodexToolManifest).sort()
      );

      let callResult: CallToolResult;
      try {
        callResult = await client.callTool(
          {
            name: 'import_project',
            arguments: {
              taskId: task.id,
              source: 'starter',
              stack: 'hono',
              targetPath: '.',
              overwrite: false,
              initialize: false,
            },
          },
          undefined,
          { timeout: 120_000 }
        );
      } catch (error) {
        throw new Error(
          `Failed to call import_project over MCP: ${error instanceof Error ? error.message : String(error)}\n${stderrChunks.join('')}`
        );
      }

      expect(callResult.isError).toBeFalsy();
      expect(callResult.structuredContent).toMatchObject({
        payload: {
          mode: 'template',
          template: expect.objectContaining({
            templateId: 'hono-standard',
            variant: 'sqlite',
          }),
          postImport: expect.objectContaining({
            targetPath: repoRoot,
            manifest: expect.objectContaining({
              status: 'found',
            }),
            initialization: expect.objectContaining({
              status: 'skipped',
              skippedReason: 'disabled',
            }),
          }),
        },
      });
      expect(fs.existsSync(path.join(repoRoot, 'package.json'))).toBe(true);
      expect(fs.existsSync(path.join(repoRoot, 'src'))).toBe(true);
      expect(buildNightWorkersCodexToolApprovalConfig()).toMatchObject({
        import_project: { approval_mode: 'approve' },
      });
    } finally {
      if (client) await client.close().catch(() => undefined);
      await deleteTask(task.id);
      await deleteRepository(repository.id);
    }
  }, 120_000);
});
