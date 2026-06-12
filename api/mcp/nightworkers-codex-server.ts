import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ensureNightWorkersSchema } from '../db/bootstrap';
import * as repo from '../modules/nightworkers/nightworkers.repository';
import { importProjectTool } from '../services/worker-tools/import-project';
import {
  listRecentSpecificationsTool,
  readCurrentSpecificationTool,
} from '../services/worker-tools/read-current-specification';
import { todoListTool } from '../services/worker-tools/todo-list';
import type { WorkerToolResult } from '../services/worker-tools/types';

const server = new McpServer({
  name: 'nightworkers',
  version: '0.1.0',
});

server.registerTool(
  'read_current_specification',
  {
    title: 'Read Current Specification',
    description:
      'Read the latest NightWorkers draft specification markdown for a task. This is read-only and does not edit project files.',
    inputSchema: z.object({
      taskId: z
        .string()
        .trim()
        .optional()
        .describe('NightWorkers task id. Defaults to NIGHTWORKERS_TASK_ID when available.'),
    }),
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
    title: 'List Recent Specifications',
    description:
      'List recent NightWorkers draft specifications with task ids so Codex can choose the right task before reading the full specification.',
    inputSchema: z.object({
      limit: z.number().int().min(1).max(50).optional().describe('Maximum results. Default: 10.'),
    }),
  },
  async ({ limit }) => toolResultToMcp(await listRecentSpecificationsTool({ limit }))
);

server.registerTool(
  'todo_list',
  {
    title: 'Todo List',
    description:
      'Maintain the current run TodoList with one JSON operation. Use operation=list, replace, start, done, block, or fail. done automatically starts the next pending Todo.',
    inputSchema: z.object({
      runId: z
        .string()
        .trim()
        .optional()
        .describe('NightWorkers run id. Defaults to NIGHTWORKERS_RUN_ID when available.'),
      operation: z
        .enum(['list', 'replace', 'start', 'done', 'block', 'fail'])
        .describe('Todo operation to perform.'),
      seq: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Todo seq for start/done/block/fail. done may omit seq to complete the current running Todo.'
        ),
      todos: z
        .array(
          z.object({
            seq: z.number().int().positive(),
            title: z.string().trim().min(1),
            description: z.string().optional(),
          })
        )
        .optional()
        .describe(
          'Implementation Todos decomposed by the LLM. Fixed quality gates are added automatically.'
        ),
      startFirst: z
        .boolean()
        .optional()
        .describe('Whether the first fixed gate starts as running. Default: true.'),
    }),
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
    title: 'Import Project',
    description:
      'Single import entrypoint for NightWorkers projects. Pass templateId for registered standard templates such as hono-standard, or repoUrl for arbitrary Git repositories.',
    inputSchema: z.object({
      taskId: z
        .string()
        .trim()
        .optional()
        .describe('NightWorkers task id. Defaults to NIGHTWORKERS_TASK_ID when available.'),
      templateId: z
        .enum(['hono-standard', 'python-standard'])
        .optional()
        .describe('Registered standard template id.'),
      repoUrl: z.string().trim().optional().describe('Git repository URL or local git path.'),
      variant: z.string().trim().optional().describe('Template variant, e.g. sqlite or postgres.'),
      overlays: z
        .array(z.string().trim().min(1))
        .optional()
        .describe('Optional overlay refs such as ssr or ssg.'),
      targetPath: z
        .string()
        .trim()
        .optional()
        .describe('Project-root-relative target path. Defaults to the Project root.'),
      overwrite: z
        .boolean()
        .optional()
        .describe('Allow writing into a non-empty target only when replacement is intended.'),
      exclude: z.array(z.string().trim().min(1)).optional().describe('Extra paths to exclude.'),
      ref: z
        .string()
        .trim()
        .optional()
        .describe('Optional Git branch, tag, or commit when repoUrl is used.'),
      depth: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Shallow clone depth when repoUrl is used and ref is omitted.'),
      stripGitDir: z
        .boolean()
        .optional()
        .describe('Remove nested .git metadata when repoUrl is used. Default: true.'),
    }),
  },
  async ({
    taskId,
    templateId,
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
        templateId,
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
