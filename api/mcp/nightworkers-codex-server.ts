import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ensureNightWorkersSchema } from '../db/bootstrap';
import * as repo from '../modules/nightworkers/nightworkers.repository';
import { importProjectTool } from '../services/worker-tools/import-project';
import {
  listRecentSpecificationsTool,
  readCurrentSpecificationTool,
} from '../services/worker-tools/read-current-specification';
import { todoListTool } from '../services/worker-tools/todo-list';
import type { WorkerToolResult } from '../services/worker-tools/types';
import { nightWorkersCodexToolManifest } from './nightworkers-tool-manifest';

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
  async ({ runId, operation, seq, todos, startFirst }) =>
    toolResultToMcp(
      await todoListTool({
        runId: runId || process.env.NIGHTWORKERS_RUN_ID || '',
        operation,
        seq,
        todos,
        startFirst,
      })
    )
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
  }) => {
    const resolvedTaskId = taskId || process.env.NIGHTWORKERS_TASK_ID || '';
    const task = resolvedTaskId ? await repo.getTask(resolvedTaskId) : null;
    const repository = task ? await repo.getRepository(task.repositoryId) : null;
    if (!task || !repository) {
      return toolResultToMcp({
        ok: false,
        toolName: 'import_project',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        payload: { mode: '', template: null, git: null },
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
        repoRoot: repository.localPath,
        allowedPaths: repository.safetyPolicy?.allowedPaths,
        deniedPaths: repository.safetyPolicy?.deniedPaths,
      })
    );
  }
);

export async function startNightWorkersCodexMcpServer() {
  await ensureNightWorkersSchema();
  await server.connect(new StdioServerTransport());
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startNightWorkersCodexMcpServer().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
