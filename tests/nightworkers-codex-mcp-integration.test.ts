import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type CallToolResult,
  Client,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../api/app';
import {
  buildNightWorkersCodexToolApprovalConfig,
  nightWorkersCodexToolManifest,
} from '../api/mcp/nightworkers-tool-manifest';
import {
  createRepository,
  createTask,
  createTaskRun,
  deleteRepository,
  deleteTask,
} from '../api/modules/nightworkers/nightworkers.repository';
import * as projectDetailRepo from '../api/modules/project-detail/project-detail.repository';

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
  it('rejects non-loopback hosts', async () => {
    const response = await app.fetch(
      new Request('http://example.com/mcp/nightworkers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: 'NightWorkers MCP is only available from loopback hosts.',
      },
    });
  });

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
      client = new Client(
        { name: 'nightworkers-codex-mcp-integration-test', version: '0.1.0' },
        { capabilities: {} }
      );
      const transport = new StreamableHTTPClientTransport(
        new URL('http://127.0.0.1/mcp/nightworkers'),
        {
          fetch: async (input, init) => {
            const request = input instanceof Request ? input : new Request(input, init);
            return app.fetch(request);
          },
        }
      );
      try {
        await client.connect(transport);
      } catch (error) {
        throw new Error(
          `Failed to connect to NightWorkers MCP server: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      let listResult: ListToolsResult;
      try {
        listResult = await client.listTools(undefined, { timeout: 30_000 });
      } catch (error) {
        throw new Error(
          `Failed to list NightWorkers MCP tools: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      expect(listResult.tools.map((tool) => tool.name).sort()).toEqual(
        Object.keys(nightWorkersCodexToolManifest).sort()
      );

      const ontologyResult = await client.callTool(
        {
          name: 'list_modules',
          arguments: {},
        },
        undefined,
        { timeout: 30_000 }
      );
      expect(ontologyResult.isError).toBeFalsy();
      expect(ontologyResult.structuredContent).toMatchObject({
        payload: {
          modules: expect.arrayContaining([
            expect.objectContaining({
              id: 'project-detail',
              manifestDigest: expect.stringMatching(/^sha256:/),
            }),
          ]),
        },
      });

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
          `Failed to call import_project over MCP: ${error instanceof Error ? error.message : String(error)}`
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
      expect(fs.existsSync(path.join(repoRoot, 'api'))).toBe(true);
      expect(fs.existsSync(path.join(repoRoot, 'web', 'src'))).toBe(true);
      expect(buildNightWorkersCodexToolApprovalConfig()).toMatchObject({
        import_project: { approval_mode: 'approve' },
      });
    } finally {
      if (client) await client.close().catch(() => undefined);
      await deleteTask(task.id);
      await deleteRepository(repository.id);
    }
  }, 120_000);

  it('imports a starter project from request-scoped task context when taskId is omitted', async () => {
    const repoRoot = path.join(tempDir, 'request-context-repo');
    fs.mkdirSync(repoRoot, { recursive: true });

    const repository = await createRepository({
      name: `request-context-${Date.now()}`,
      localPath: repoRoot,
      branch: 'main',
      allowed: true,
    });

    const task = await createTask({
      repositoryId: repository.id,
      title: 'NightWorkers MCP request context import',
      status: 'queued',
    });

    let client: Client | null = null;
    try {
      client = new Client(
        { name: 'nightworkers-codex-mcp-request-context-test', version: '0.1.0' },
        { capabilities: {} }
      );
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1/mcp/nightworkers?taskId=${task.id}`),
        {
          fetch: async (input, init) => {
            const request = input instanceof Request ? input : new Request(input, init);
            return app.fetch(request);
          },
        }
      );
      await client.connect(transport);

      const contextResult = await client.callTool(
        {
          name: 'compile_module_context',
          arguments: {
            goal: 'todolist を作る',
          },
        },
        undefined,
        { timeout: 30_000 }
      );
      expect(contextResult.isError).toBeFalsy();
      expect(contextResult.structuredContent).toMatchObject({
        payload: {
          evidenceSources: {
            taskGenerationEvidence: false,
          },
        },
      });

      const callResult = await client.callTool(
        {
          name: 'import_project',
          arguments: {
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

      expect(callResult.isError).toBeFalsy();
      expect(callResult.structuredContent).toMatchObject({
        payload: {
          mode: 'template',
          template: expect.objectContaining({
            templateId: 'hono-standard',
          }),
        },
      });
      expect(fs.existsSync(path.join(repoRoot, 'package.json'))).toBe(true);
    } finally {
      if (client) await client.close().catch(() => undefined);
      await deleteTask(task.id);
      await deleteRepository(repository.id);
    }
  }, 120_000);

  it('imports a starter project from request-scoped run context when taskId is omitted', async () => {
    const repoRoot = path.join(tempDir, 'run-context-repo');
    fs.mkdirSync(repoRoot, { recursive: true });

    const repository = await createRepository({
      name: `run-context-${Date.now()}`,
      localPath: repoRoot,
      branch: 'main',
      allowed: true,
    });

    const task = await createTask({
      repositoryId: repository.id,
      title: 'NightWorkers MCP run context import',
      status: 'queued',
    });
    const run = await createTaskRun({
      taskId: task.id,
      repositoryId: repository.id,
      status: 'running',
      workerKind: 'codex-agent',
      startedAt: new Date(),
    });

    let client: Client | null = null;
    try {
      client = new Client(
        { name: 'nightworkers-codex-mcp-run-context-test', version: '0.1.0' },
        { capabilities: {} }
      );
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1/mcp/nightworkers?runId=${run.id}`),
        {
          fetch: async (input, init) => {
            const request = input instanceof Request ? input : new Request(input, init);
            return app.fetch(request);
          },
        }
      );
      await client.connect(transport);

      const callResult = await client.callTool(
        {
          name: 'import_project',
          arguments: {
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

      expect(callResult.isError).toBeFalsy();
      expect(callResult.structuredContent).toMatchObject({
        payload: {
          mode: 'template',
          template: expect.objectContaining({
            templateId: 'hono-standard',
          }),
        },
      });
      expect(fs.existsSync(path.join(repoRoot, 'package.json'))).toBe(true);
    } finally {
      if (client) await client.close().catch(() => undefined);
      await deleteTask(task.id);
      await deleteRepository(repository.id);
    }
  }, 120_000);

  it('loads task generation evidence from request-scoped run context', async () => {
    const repoRoot = path.join(tempDir, 'run-context-task-evidence-repo');
    fs.mkdirSync(repoRoot, { recursive: true });

    const repository = await createRepository({
      name: `run-context-evidence-${Date.now()}`,
      localPath: repoRoot,
      branch: 'main',
      allowed: true,
    });

    const task = await createTask({
      repositoryId: repository.id,
      title: 'TaskCandidate backed task',
      status: 'queued',
      createdBy: 'mission-task-candidate',
    });
    const run = await createTaskRun({
      taskId: task.id,
      repositoryId: repository.id,
      status: 'running',
      workerKind: 'codex-agent',
      startedAt: new Date(),
    });
    const batch = await projectDetailRepo.createRunningMissionBatch({
      repositoryId: repository.id,
      requestedGoalIds: [],
      signalSnapshot: {
        repository: {
          id: repository.id,
          name: repository.name,
          localPath: repository.localPath,
          branch: repository.branch,
        },
        activeGoals: [],
        latestEvaluation: null,
        latestQuality: {
          coverage: null,
          e2e: null,
        },
        qualityCapabilities: {
          projectType: 'typescript',
          commands: [],
          missingCapabilities: ['unit', 'coverage', 'e2e'],
        },
        recentTokenSpendTasks: [],
        recentRuns: {
          completed: 0,
          failed: 0,
          running: 1,
        },
      },
    });
    const [candidate] = await projectDetailRepo.createMissionCandidates([
      {
        batchId: batch.id,
        repositoryId: repository.id,
        goalId: null,
        candidateKind: 'feature_entrypoint',
        primaryModule: 'project-detail',
        secondaryModulesJson: [],
        routingConfidencePercent: 92,
        routingReason: 'integration fixture',
        constraintGoalIdsJson: [],
        planModeOpenQuestionsJson: ['保存方式を確認する。'],
        title: 'TaskCandidate backed task',
        summary: 'TaskCandidate evidence should reach ontology context.',
        rationale: 'The run context only carries runId.',
        evidenceJson: [],
        evaluationContribution: null,
        importancePercent: 90,
        confidencePercent: 88,
        tokenSize: 'small',
        complexity: 'simple',
        taskPrompt: 'Plan the feature entrypoint.',
        acceptanceCriteria: 'Evidence is present.',
        verificationPlan: 'Call compile_module_context.',
        status: 'task_created',
        taskId: task.id,
      },
    ]);

    let client: Client | null = null;
    try {
      client = new Client(
        { name: 'nightworkers-codex-mcp-run-context-evidence-test', version: '0.1.0' },
        { capabilities: {} }
      );
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1/mcp/nightworkers?runId=${run.id}`),
        {
          fetch: async (input, init) => {
            const request = input instanceof Request ? input : new Request(input, init);
            return app.fetch(request);
          },
        }
      );
      await client.connect(transport);

      const contextResult = await client.callTool(
        {
          name: 'compile_module_context',
          arguments: {
            goal: 'Project Detail Mission task candidate UI',
          },
        },
        undefined,
        { timeout: 30_000 }
      );

      expect(contextResult.isError).toBeFalsy();
      expect(contextResult.structuredContent).toMatchObject({
        payload: {
          evidenceSources: {
            taskGenerationEvidence: true,
          },
          taskGenerationEvidence: {
            taskCandidate: {
              id: candidate.id,
              kind: 'feature_entrypoint',
            },
          },
        },
      });
    } finally {
      if (client) await client.close().catch(() => undefined);
      await deleteTask(task.id);
      await deleteRepository(repository.id);
    }
  });

  it('blocks mutating NightWorkers MCP tools in planning execution mode', async () => {
    const originalExecutionMode = process.env.NIGHTWORKERS_EXECUTION_MODE;
    process.env.NIGHTWORKERS_EXECUTION_MODE = 'planning';
    let client: Client | null = null;
    try {
      client = new Client(
        { name: 'nightworkers-codex-mcp-planning-test', version: '0.1.0' },
        { capabilities: {} }
      );
      const transport = new StreamableHTTPClientTransport(
        new URL('http://127.0.0.1/mcp/nightworkers'),
        {
          fetch: async (input, init) => {
            const request = input instanceof Request ? input : new Request(input, init);
            return app.fetch(request);
          },
        }
      );
      await client.connect(transport);

      const callResult = await client.callTool(
        {
          name: 'import_project',
          arguments: {
            taskId: crypto.randomUUID(),
            source: 'starter',
            stack: 'hono',
          },
        },
        undefined,
        { timeout: 30_000 }
      );

      expect(callResult.isError).toBe(true);
      expect(callResult.structuredContent).toMatchObject({
        error: {
          code: 'PLAN_MODE_TOOL_DISABLED',
        },
      });
    } finally {
      if (client) await client.close().catch(() => undefined);
      if (originalExecutionMode === undefined) delete process.env.NIGHTWORKERS_EXECUTION_MODE;
      else process.env.NIGHTWORKERS_EXECUTION_MODE = originalExecutionMode;
    }
  });
});
