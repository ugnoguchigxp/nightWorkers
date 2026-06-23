import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ensureNightWorkersSchema } from '../db/bootstrap';
import * as repo from '../modules/nightworkers/nightworkers.repository';
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

export function createNightWorkersCodexMcpServer() {
  const server = new McpServer({
    name: 'nightworkers',
    version: '0.1.0',
  });

  server.registerTool(
    'read_current_specification',
    {
      ...nightWorkersCodexToolManifest.read_current_specification,
    },
    async ({ taskId }) =>
      toolResultToMcp(
        await readCurrentSpecificationTool({
          taskId: taskId || process.env.NIGHTWORKERS_TASK_ID || '',
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
      if (isToolDisabledForExecutionMode('todo_list')) {
        return toolResultToMcp(disabledToolResult('todo_list'));
      }
      return toolResultToMcp(
        await todoListTool({
          runId: runId || process.env.NIGHTWORKERS_RUN_ID || '',
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
      if (isToolDisabledForExecutionMode('import_project')) {
        return toolResultToMcp(disabledToolResult('import_project'));
      }
      const resolvedTaskId = taskId || process.env.NIGHTWORKERS_TASK_ID || '';
      const task = resolvedTaskId ? await repo.getTask(resolvedTaskId) : null;
      const repository = task ? await repo.getRepository(task.repositoryId) : null;
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

  return server;
}

function isToolDisabledForExecutionMode(toolName: NightWorkersCodexToolName) {
  return !isNightWorkersCodexToolAllowedForMode(toolName, process.env.NIGHTWORKERS_EXECUTION_MODE);
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
  const server = createNightWorkersCodexMcpServer();
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

function toolResultToMcp(result: WorkerToolResult<unknown>) {
  const text = JSON.stringify(
    result.ok
      ? result.payload
      : {
          error: result.error ?? {
            code: 'NIGHTWORKERS_TOOL_FAILED',
            message: 'NightWorkers MCP tool failed.',
          },
          payload: result.payload,
        },
    null,
    2
  );
  return {
    isError: !result.ok,
    structuredContent: result.ok ? { payload: result.payload } : { error: result.error },
    content: [{ type: 'text' as const, text }],
  };
}
