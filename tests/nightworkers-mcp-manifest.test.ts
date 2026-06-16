import { describe, expect, it } from 'vitest';
import {
  buildNightWorkersCodexToolApprovalConfig,
  buildNightWorkersCodexToolConfigLines,
  nightWorkersImportProjectInputSchema,
  nightWorkersReadCurrentSpecificationInputSchema,
  nightWorkersTodoListInputSchema,
  toNightWorkersJsonSchema,
} from '../api/mcp/nightworkers-tool-manifest';
import { buildCodexRuntimeSdkOptions } from '../api/services/agent-runtime/codex-runtime-config';
import { getAllowedToolsForJobType } from '../api/services/supervisor/prompt-tool-registry';

describe('nightworkers MCP manifest', () => {
  it('drives the runtime tool approval config', () => {
    const options = buildCodexRuntimeSdkOptions({
      env: {
        PATH: '/usr/bin',
        NIGHTWORKERS_CODEX_MCP_COMMAND: '/bin/nightworkers-mcp',
        NIGHTWORKERS_CODEX_MCP_ARGS: '--stdio',
      } as never,
    });

    expect(options.config).toMatchObject({
      mcp_servers: {
        nightworkers: {
          tools: buildNightWorkersCodexToolApprovalConfig(),
        },
      },
    });
  });

  it('drives the installer tool config lines', () => {
    const lines = buildNightWorkersCodexToolConfigLines().join('\n');

    expect(lines).toContain('[mcp_servers.nightworkers.tools.read_current_specification]');
    expect(lines).toContain('[mcp_servers.nightworkers.tools.list_recent_specifications]');
    expect(lines).toContain('[mcp_servers.nightworkers.tools.todo_list]');
    expect(lines).toContain('[mcp_servers.nightworkers.tools.import_project]');
    expect(lines).not.toContain('replace_todo_list');
  });

  it('drives the supervisor prompt schemas for shared NightWorkers tools', () => {
    const majorTools = getAllowedToolsForJobType('major_code_edit');
    const readCurrentSpecification = majorTools.find(
      (tool) => tool.name === 'read_current_specification'
    );
    const importProject = majorTools.find((tool) => tool.name === 'import_project');
    const todoList = majorTools.find((tool) => tool.name === 'todo_list');

    expect(readCurrentSpecification?.inputSchema).toEqual(
      toNightWorkersJsonSchema(nightWorkersReadCurrentSpecificationInputSchema)
    );
    expect(importProject?.inputSchema).toEqual(
      toNightWorkersJsonSchema(nightWorkersImportProjectInputSchema)
    );
    const sharedTodoSchema = toNightWorkersJsonSchema(nightWorkersTodoListInputSchema);
    expect(
      (
        (todoList?.inputSchema.properties as Record<string, unknown> | undefined)?.operation as
          | { enum?: unknown[] }
          | undefined
      )?.enum ?? []
    ).toEqual(['replace', 'start', 'done', 'block', 'fail']);
    expect(
      (
        (sharedTodoSchema.properties as Record<string, unknown> | undefined)?.operation as
          | { enum?: unknown[] }
          | undefined
      )?.enum ?? []
    ).toContain('list');
  });
});
