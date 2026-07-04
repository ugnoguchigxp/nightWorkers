import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ensureNightWorkersSchema } from '../db/bootstrap';
import * as repo from '../modules/nightworkers/nightworkers.repository';
import {
  checkOntologyBoundary,
  classifyOntologyGoal,
  compileOntologyModuleContext,
  getModuleOntology,
  getOntologyVerificationPlan,
  listOntologyModules,
} from '../services/agent-ontology/agent-ontology.service';
import { projectWorkerResultToNativeApiToolResult } from '../services/agent-runtime/native-api-runner/native-api-tool-result-projector';
import { importProjectTool } from '../services/worker-tools/import-project';
import {
  listRecentSpecificationsTool,
  readCurrentSpecificationTool,
} from '../services/worker-tools/read-current-specification';
import { todoListTool } from '../services/worker-tools/todo-list';
import type { WorkerToolResult } from '../services/worker-tools/types';
import {
  isNightWorkersCodexToolAllowedForMode,
  type NightWorkersCodexToolName,
  nightWorkersCodexToolManifest,
} from './nightworkers-tool-manifest';

type NightWorkersMcpRequestContext = {
  taskId?: string;
  runId?: string;
  executionMode?: string;
};

export function createNightWorkersCodexMcpServer(context: NightWorkersMcpRequestContext = {}) {
  const server = new McpServer({
    name: 'nightworkers',
    version: '0.1.0',
  });

  server.registerTool(
    'read_current_specification',
    {
      ...nightWorkersCodexToolManifest.read_current_specification,
    },
    async ({ taskId, view }) =>
      toolResultToMcp(
        await readCurrentSpecificationTool({
          taskId: firstNonEmpty(taskId, context.taskId, process.env.NIGHTWORKERS_TASK_ID),
          view,
        })
      )
  );

  server.registerTool(
    'list_recent_specifications',
    {
      ...nightWorkersCodexToolManifest.list_recent_specifications,
    },
    async ({ limit }) => toolResultToMcp(await listRecentSpecificationsTool({ limit }))
  );

  server.registerTool(
    'todo_list',
    {
      ...nightWorkersCodexToolManifest.todo_list,
    },
    async ({ runId, operation, seq, todos, startFirst, todoListReplaceReason }) => {
      if (isToolDisabledForExecutionMode('todo_list', context)) {
        return toolResultToMcp(disabledToolResult('todo_list'));
      }
      return toolResultToMcp(
        await todoListTool({
          runId: firstNonEmpty(runId, context.runId, process.env.NIGHTWORKERS_RUN_ID),
          operation,
          seq,
          todos,
          startFirst,
          todoListReplaceReason,
        })
      );
    }
  );

  server.registerTool(
    'import_project',
    {
      ...nightWorkersCodexToolManifest.import_project,
    },
    async ({
      taskId,
      runId,
      source,
      stack,
      repoUrl,
      variant,
      overlays,
      targetPath,
      overwrite,
      exclude,
      ref,
      depth,
      stripGitDir,
      initialize,
    }) => {
      if (isToolDisabledForExecutionMode('import_project', context)) {
        return toolResultToMcp(disabledToolResult('import_project'));
      }
      const resolved = await resolveTaskRepository({
        taskId: firstNonEmpty(taskId, context.taskId, process.env.NIGHTWORKERS_TASK_ID),
        runId: firstNonEmpty(runId, context.runId, process.env.NIGHTWORKERS_RUN_ID),
      });
      const { task, repository } = resolved;
      if (!task || !repository) {
        return toolResultToMcp({
          ok: false,
          toolName: 'import_project',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          payload: { mode: '', template: null, git: null, postImport: null },
          error: {
            code: 'TASK_REPOSITORY_NOT_FOUND',
            message: 'Cannot resolve the current NightWorkers task repository.',
          },
        });
      }
      return toolResultToMcp(
        await importProjectTool({
          source,
          stack,
          repoUrl,
          variant,
          overlays,
          targetPath,
          overwrite,
          exclude,
          ref,
          depth,
          stripGitDir,
          initialize,
          repoRoot: repository.localPath,
          allowedPaths: repository.safetyPolicy?.allowedPaths,
          deniedPaths: repository.safetyPolicy?.deniedPaths,
        })
      );
    }
  );

  server.registerTool(
    'list_modules',
    {
      ...nightWorkersCodexToolManifest.list_modules,
    },
    async ({ repoPath }) =>
      toolResultToMcp(
        await readOnlyOntologyTool('list_modules', async () =>
          listOntologyModules({
            repoPath: await resolveOntologyRepoPath(repoPath, context),
          })
        )
      )
  );

  server.registerTool(
    'get_module_ontology',
    {
      ...nightWorkersCodexToolManifest.get_module_ontology,
    },
    async ({ repoPath, module }) =>
      toolResultToMcp(
        await readOnlyOntologyTool('get_module_ontology', async () =>
          getModuleOntology({
            repoPath: await resolveOntologyRepoPath(repoPath, context),
            module,
          })
        )
      )
  );

  server.registerTool(
    'classify_goal',
    {
      ...nightWorkersCodexToolManifest.classify_goal,
    },
    async ({ repoPath, goal }) =>
      toolResultToMcp(
        await readOnlyOntologyTool('classify_goal', async () =>
          classifyOntologyGoal({
            repoPath: await resolveOntologyRepoPath(repoPath, context),
            goal,
          })
        )
      )
  );

  server.registerTool(
    'compile_module_context',
    {
      ...nightWorkersCodexToolManifest.compile_module_context,
    },
    async ({
      repoPath,
      goal,
      primaryModule,
      secondaryModules,
      taskGenerationEvidence,
      memoryEvidence,
      summaryType,
    }) =>
      toolResultToMcp(
        await readOnlyOntologyTool('compile_module_context', async () =>
          compileOntologyModuleContext({
            repoPath: await resolveOntologyRepoPath(repoPath, context),
            goal,
            primaryModule,
            secondaryModules,
            taskGenerationEvidence,
            memoryEvidence,
            summaryType,
          })
        )
      )
  );

  server.registerTool(
    'check_boundary',
    {
      ...nightWorkersCodexToolManifest.check_boundary,
    },
    async ({ repoPath, primaryModule, secondaryModules, plannedFiles }) =>
      toolResultToMcp(
        await readOnlyOntologyTool('check_boundary', async () =>
          checkOntologyBoundary({
            repoPath: await resolveOntologyRepoPath(repoPath, context),
            primaryModule,
            secondaryModules,
            plannedFiles,
          })
        )
      )
  );

  server.registerTool(
    'get_verification_plan',
    {
      ...nightWorkersCodexToolManifest.get_verification_plan,
    },
    async ({ repoPath, primaryModule, secondaryModules }) =>
      toolResultToMcp(
        await readOnlyOntologyTool('get_verification_plan', async () =>
          getOntologyVerificationPlan({
            repoPath: await resolveOntologyRepoPath(repoPath, context),
            primaryModule,
            secondaryModules,
          })
        )
      )
  );

  return server;
}

function firstNonEmpty(...values: Array<string | undefined | null>) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() ?? '';
}

async function resolveTaskRepository(input: { taskId: string; runId: string }) {
  const task = input.taskId ? await repo.getTask(input.taskId) : null;
  if (task) {
    return {
      task,
      repository: await repo.getRepository(task.repositoryId),
    };
  }

  const run = input.runId ? await repo.getTaskRun(input.runId) : null;
  if (!run) {
    return { task: null, repository: null };
  }
  const runTask = await repo.getTask(run.taskId);
  const repositoryId = run.repositoryId || runTask?.repositoryId || '';
  return {
    task: runTask ?? null,
    repository: repositoryId ? await repo.getRepository(repositoryId) : null,
  };
}

async function resolveOntologyRepoPath(
  explicitRepoPath: string | undefined,
  context: NightWorkersMcpRequestContext
) {
  if (explicitRepoPath?.trim()) return explicitRepoPath.trim();
  const resolved = await resolveTaskRepository({
    taskId: firstNonEmpty(context.taskId, process.env.NIGHTWORKERS_TASK_ID),
    runId: firstNonEmpty(context.runId, process.env.NIGHTWORKERS_RUN_ID),
  });
  return resolved.repository?.localPath;
}

async function readOnlyOntologyTool<TPayload>(
  toolName: string,
  callback: () => Promise<TPayload>
): Promise<WorkerToolResult<TPayload | null>> {
  const startedAt = new Date().toISOString();
  try {
    const payload = await callback();
    return {
      ok: true,
      toolName,
      startedAt,
      finishedAt: new Date().toISOString(),
      payload,
    };
  } catch (error) {
    return {
      ok: false,
      toolName,
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: null,
      error: {
        code: 'ONTOLOGY_TOOL_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function isToolDisabledForExecutionMode(
  toolName: NightWorkersCodexToolName,
  context: NightWorkersMcpRequestContext
) {
  const executionMode = firstNonEmpty(
    context.executionMode,
    process.env.NIGHTWORKERS_EXECUTION_MODE
  );
  return !isNightWorkersCodexToolAllowedForMode(toolName, executionMode);
}

function disabledToolResult(toolName: NightWorkersCodexToolName): WorkerToolResult<unknown> {
  const now = new Date().toISOString();
  return {
    ok: false,
    toolName,
    startedAt: now,
    finishedAt: now,
    payload: null,
    error: {
      code: 'PLAN_MODE_TOOL_DISABLED',
      message: `${toolName} is disabled in NightWorkers planning mode.`,
    },
  };
}

export async function handleNightWorkersCodexMcpRequest(request: Request): Promise<Response> {
  if (!isLoopbackNightWorkersMcpRequest(request)) {
    return Response.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32000,
          message: 'NightWorkers MCP is only available from loopback hosts.',
        },
      },
      { status: 403 }
    );
  }
  await ensureNightWorkersSchema();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = createNightWorkersCodexMcpServer(readNightWorkersMcpRequestContext(request));
  await server.connect(transport);
  return transport.handleRequest(request);
}

export function isLoopbackNightWorkersMcpRequest(request: Request) {
  try {
    return isLoopbackHostname(new URL(request.url).hostname);
  } catch {
    return false;
  }
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function readNightWorkersMcpRequestContext(request: Request): NightWorkersMcpRequestContext {
  try {
    const url = new URL(request.url);
    return {
      taskId: readSearchParam(url, 'taskId'),
      runId: readSearchParam(url, 'runId'),
      executionMode: readSearchParam(url, 'executionMode'),
    };
  } catch {
    return {};
  }
}

function readSearchParam(url: URL, key: keyof NightWorkersMcpRequestContext) {
  const value = url.searchParams.get(key);
  return value?.trim() || undefined;
}

function toolResultToMcp(result: WorkerToolResult<unknown>) {
  const text = projectWorkerResultToNativeApiToolResult(result).content;
  return {
    isError: !result.ok,
    structuredContent: result.ok ? { payload: result.payload } : { error: result.error },
    content: [{ type: 'text' as const, text }],
  };
}
