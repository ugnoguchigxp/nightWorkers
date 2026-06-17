import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getProviderNativeToolDefinition,
  getProviderNativeToolDefinitions,
  isNativeToolRuntimeToolName,
} from '../api/services/agent-runtime/native-tool-runtime/native-tool-definitions';
import { executeNativeToolCall } from '../api/services/agent-runtime/native-tool-runtime/native-tool-executor';
import { mcpClientManager } from '../api/services/mcp/mcp-client-manager';
import { executeWorkerTool } from '../api/services/worker-tools/dispatcher';

vi.mock('../api/services/worker-tools/dispatcher', () => ({
  executeWorkerTool: vi.fn(),
}));

vi.mock('../api/services/mcp/mcp-client-manager', () => ({
  mcpClientManager: {
    listAvailableTools: vi.fn(),
  },
}));

describe('native tool runtime R1/R2 bridge', () => {
  let previousRuntimeLane: string | undefined;

  beforeEach(() => {
    previousRuntimeLane = process.env.NIGHTWORKERS_RUNTIME_LANE;
    process.env.NIGHTWORKERS_RUNTIME_LANE = 'native-supervisor';
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (previousRuntimeLane === undefined) {
      delete process.env.NIGHTWORKERS_RUNTIME_LANE;
      return;
    }
    process.env.NIGHTWORKERS_RUNTIME_LANE = previousRuntimeLane;
  });

  it('builds provider-native tool definitions from the supervisor tool registry', () => {
    const definitions = getProviderNativeToolDefinitions();

    expect(definitions.map((definition) => definition.name)).toEqual([
      'list_dir',
      'read_current_specification',
      'context_compile',
      'read_file',
      'search_files',
      'apply_patch',
      'replace_content',
      'run_verification',
      'todo_list',
      'finalize_answer',
    ]);
    expect(definitions.find((definition) => definition.name === 'read_file')).toMatchObject({
      kind: 'worker',
      workerToolName: 'read_file',
      inputSchema: expect.objectContaining({
        required: ['filePath'],
      }),
    });
    expect(definitions.find((definition) => definition.name === 'finalize_answer')).toMatchObject({
      kind: 'terminal',
    });
    expect(definitions.find((definition) => definition.name === 'todo_list')).toMatchObject({
      kind: 'todo_control',
    });
    expect(definitions.find((definition) => definition.name === 'context_compile')).toMatchObject({
      kind: 'context_still',
      inputSchema: expect.objectContaining({
        required: ['goal'],
      }),
    });
    expect(
      definitions.find((definition) => definition.name === 'context_compile')?.description
    ).toContain('空オブジェクト');
    expect(
      definitions.find((definition) => definition.name === 'apply_patch')?.description
    ).toContain('*** Add File');
    expect(
      definitions.find((definition) => definition.name === 'run_verification')?.description
    ).toContain('検証専用');

    const todoSchema = definitions.find((definition) => definition.name === 'todo_list')
      ?.inputSchema as { properties?: { operation?: { enum?: string[] } } };
    expect(todoSchema.properties?.operation?.enum).not.toContain('list');
    expect(isNativeToolRuntimeToolName('read_procedure')).toBe(false);
  });

  it('returns cloned schemas so adapter callers cannot mutate the registry source', () => {
    const first = getProviderNativeToolDefinition('read_file');
    const second = getProviderNativeToolDefinition('read_file');

    expect(first.inputSchema).not.toBe(second.inputSchema);
    (first.inputSchema.properties as Record<string, unknown>).mutated = true;

    expect(second.inputSchema.properties).not.toHaveProperty('mutated');
  });

  it('executes worker tool calls through executeWorkerTool and emits runtime events', async () => {
    vi.mocked(executeWorkerTool).mockResolvedValue({
      result: {
        ok: true,
        toolName: 'read_file',
        startedAt: '2026-06-17T00:00:00.000Z',
        finishedAt: '2026-06-17T00:00:01.000Z',
        payload: { content: 'hello', totalLines: 1 },
      },
      readFilesChanged: ['README.md'],
    });
    const events: unknown[] = [];

    const result = await executeNativeToolCall({
      toolCall: {
        id: 'call-1',
        name: 'read_file',
        arguments: { filePath: 'README.md' },
      },
      context: {
        repoRoot: '/repo',
        taskId: 'task-1',
        readFiles: [],
        safetyPolicy: { allowedPaths: ['/repo'] },
        sink: {
          emit: async (event) => {
            events.push(event);
          },
        },
      },
    });

    expect(executeWorkerTool).toHaveBeenCalledWith({
      toolName: 'read_file',
      args: { filePath: 'README.md' },
      repoRoot: '/repo',
      taskId: 'task-1',
      safetyPolicy: { allowedPaths: ['/repo'] },
      readFiles: [],
      toolContext: undefined,
    });
    expect(result).toMatchObject({
      kind: 'worker',
      callId: 'call-1',
      toolName: 'read_file',
      dispatch: {
        readFilesChanged: ['README.md'],
      },
    });
    expect(result.providerOutput).toContain('"ok":true');
    expect(events).toEqual([
      expect.objectContaining({
        type: 'tool_call_started',
        payload: expect.objectContaining({ callId: 'call-1', toolName: 'read_file' }),
      }),
      expect.objectContaining({
        type: 'tool_call_finished',
        payload: expect.objectContaining({
          callId: 'call-1',
          toolName: 'read_file',
          status: 'completed',
          readFilesChanged: ['README.md'],
        }),
      }),
    ]);
  });

  it('keeps todo_list and finalize_answer out of the worker dispatcher bridge', async () => {
    const todo = await executeNativeToolCall({
      toolCall: {
        id: 'call-todo',
        name: 'todo_list',
        arguments: { operation: 'done', seq: 1 },
      },
      context: {
        repoRoot: '/repo',
        taskId: 'task-1',
        readFiles: [],
      },
    });
    const final = await executeNativeToolCall({
      toolCall: {
        id: 'call-final',
        name: 'finalize_answer',
        arguments: { message: 'done' },
      },
      context: {
        repoRoot: '/repo',
        taskId: 'task-1',
        readFiles: [],
      },
    });

    expect(executeWorkerTool).not.toHaveBeenCalled();
    expect(todo).toMatchObject({
      kind: 'todo_control',
      callId: 'call-todo',
      arguments: { operation: 'done', seq: 1 },
    });
    expect(final).toMatchObject({
      kind: 'terminal',
      callId: 'call-final',
      message: 'done',
      providerOutput: 'done',
    });
  });

  it('executes context_compile through contextStill MCP only with a concrete goal', async () => {
    vi.mocked(mcpClientManager.listAvailableTools).mockResolvedValue([
      {
        serverId: 'context-still-server',
        serverName: 'context-still',
        toolPrefix: 'context_still',
        name: 'context_compile',
        namespacedName: 'mcp__context_still__context_compile',
      },
    ]);
    vi.mocked(executeWorkerTool).mockResolvedValue({
      result: {
        ok: true,
        toolName: 'mcp_call_tool',
        startedAt: '2026-06-17T00:00:00.000Z',
        finishedAt: '2026-06-17T00:00:01.000Z',
        payload: {
          serverId: 'context-still-server',
          toolName: 'context_compile',
          result: { content: [{ type: 'text', text: 'compiled' }] },
        },
      },
      readFilesChanged: [],
    });
    const events: unknown[] = [];

    const result = await executeNativeToolCall({
      toolCall: {
        id: 'call-context',
        name: 'context_compile',
        arguments: {
          goal: 'Todo List Specification を読み、画面内一時データの実装方針を確認する。',
          changeTypes: ['implementation'],
        },
      },
      context: {
        repoRoot: '/repo',
        taskId: 'task-1',
        readFiles: [],
        sink: {
          emit: async (event) => {
            events.push(event);
          },
        },
      },
    });

    expect(executeWorkerTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'mcp_call_tool',
        args: {
          serverId: 'context-still-server',
          toolName: 'context_compile',
          arguments: expect.objectContaining({
            goal: expect.stringContaining('Todo List Specification'),
          }),
        },
      })
    );
    expect(result).toMatchObject({
      kind: 'worker',
      toolName: 'context_compile',
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: 'tool_call_started',
        payload: expect.objectContaining({
          toolName: 'context-still.context_compile',
          mcpTool: 'context_compile',
        }),
      }),
      expect.objectContaining({
        type: 'tool_call_finished',
        payload: expect.objectContaining({
          toolName: 'context-still.context_compile',
          status: 'completed',
        }),
      }),
    ]);
  });

  it('rejects empty context_compile input before calling MCP', async () => {
    const result = await executeNativeToolCall({
      toolCall: {
        id: 'call-empty-context',
        name: 'context_compile',
        arguments: {},
      },
      context: {
        repoRoot: '/repo',
        taskId: 'task-1',
        readFiles: [],
      },
    });

    expect(executeWorkerTool).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      kind: 'worker',
      toolName: 'context_compile',
      dispatch: {
        result: {
          ok: false,
          error: expect.objectContaining({
            code: 'INVALID_TOOL_ARGS',
          }),
        },
      },
    });
  });

  it('rejects tools outside the native tool runtime allowlist', async () => {
    await expect(
      executeNativeToolCall({
        toolCall: {
          id: 'call-bad',
          name: 'read_procedure',
          arguments: { jobType: 'major_code_edit' },
        },
        context: {
          repoRoot: '/repo',
          taskId: 'task-1',
          readFiles: [],
        },
      })
    ).rejects.toThrow('Unsupported native tool runtime tool: read_procedure');
  });
});
