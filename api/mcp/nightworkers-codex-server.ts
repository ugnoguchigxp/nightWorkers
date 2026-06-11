import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ensureNightWorkersSchema } from '../db/bootstrap';
import {
  listRecentSpecificationsTool,
  readCurrentSpecificationTool,
} from '../services/worker-tools/read-current-specification';
import { replaceTodoListTool } from '../services/worker-tools/replace-todo-list';
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
  'replace_todo_list',
  {
    title: 'Replace Todo List',
    description:
      'Replace the current run TodoList. Pass only the implementation Todos decomposed by the LLM; NightWorkers automatically adds initial_instructions, context_compile, code review, verify, and knowledge-capture gates.',
    inputSchema: z.object({
      runId: z
        .string()
        .trim()
        .optional()
        .describe('NightWorkers run id. Defaults to NIGHTWORKERS_RUN_ID when available.'),
      todos: z
        .array(
          z.object({
            seq: z.number().int().positive().optional(),
            title: z.string().trim().min(1),
            description: z.string().optional(),
            taskType: z.string().trim().min(1),
            procedureId: z.string().trim().optional(),
            dependsOn: z.array(z.union([z.string(), z.number()])).optional(),
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
  async ({ runId, todos, startFirst }) =>
    toolResultToMcp(
      await replaceTodoListTool({
        runId: runId || process.env.NIGHTWORKERS_RUN_ID || '',
        todos,
        startFirst,
      })
    )
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
