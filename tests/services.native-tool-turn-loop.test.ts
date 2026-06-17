import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import { runNativeToolTurnLoop } from '../api/services/agent-runtime/native-tool-runtime/native-tool-turn-loop';
import { executeWorkerTool } from '../api/services/worker-tools/dispatcher';
import { todoListTool } from '../api/services/worker-tools/todo-list';

vi.mock('../api/modules/nightworkers/nightworkers.repository', () => ({
  getTaskRun: vi.fn(),
  listTaskRunTodosForRun: vi.fn(),
}));

vi.mock('../api/services/llm-usage', () => ({
  recordLlmUsage: vi.fn(),
}));

vi.mock('../api/services/worker-tools/dispatcher', () => ({
  executeWorkerTool: vi.fn(),
}));

vi.mock('../api/services/worker-tools/todo-list', () => ({
  todoListTool: vi.fn(),
}));

describe('NativeToolTurnLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repo.getTaskRun).mockResolvedValue(null);
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
  });

  it('runs provider-native tool calls through worker tools and completes with finalize_answer', async () => {
    vi.mocked(executeWorkerTool).mockResolvedValue({
      result: {
        ok: true,
        toolName: 'read_file',
        startedAt: '2026-06-17T00:00:00.000Z',
        finishedAt: '2026-06-17T00:00:01.000Z',
        payload: { content: 'hello' },
      },
      readFilesChanged: ['README.md'],
    });
    const providerTurn = vi
      .fn()
      .mockResolvedValueOnce({
        type: 'supported',
        content: '',
        toolCalls: [
          {
            id: 'call-read',
            name: 'read_file',
            arguments: { filePath: 'README.md' },
          },
        ],
        usage: zeroUsage(),
      })
      .mockResolvedValueOnce({
        type: 'supported',
        content: '',
        toolCalls: [
          {
            id: 'call-final',
            name: 'finalize_answer',
            arguments: { message: 'done' },
          },
        ],
        usage: zeroUsage(),
      });

    const result = await runNativeToolTurnLoop({
      context: buildContext(),
      sink: { emit: async () => {} },
      providerTurn,
      maxTurns: 4,
    });

    expect(result).toMatchObject({
      type: 'supported',
      result: {
        terminalState: 'completed',
        finalReport: 'done',
      },
    });
    expect(executeWorkerTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'read_file',
        args: { filePath: 'README.md' },
        readFiles: [],
      })
    );
    expect(providerTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'tool', toolCallId: 'call-read' }),
        ]),
      })
    );
  });

  it('applies todo_list control calls through the existing Todo contract', async () => {
    vi.mocked(todoListTool).mockResolvedValue({
      ok: true,
      toolName: 'todo_list',
      startedAt: '2026-06-17T00:00:00.000Z',
      finishedAt: '2026-06-17T00:00:01.000Z',
      payload: {
        runId: 'run-1',
        taskId: 'task-1',
        action: 'todo_list',
        operation: 'done',
        todos: [],
      },
    });
    const providerTurn = vi
      .fn()
      .mockResolvedValueOnce({
        type: 'supported',
        content: '',
        toolCalls: [
          {
            id: 'call-todo',
            name: 'todo_list',
            arguments: { operation: 'done', seq: 1 },
          },
        ],
        usage: zeroUsage(),
      })
      .mockResolvedValueOnce({
        type: 'supported',
        content: '',
        toolCalls: [
          {
            id: 'call-final',
            name: 'finalize_answer',
            arguments: { message: 'closed' },
          },
        ],
        usage: zeroUsage(),
      });

    const result = await runNativeToolTurnLoop({
      context: buildContext(),
      sink: { emit: async () => {} },
      providerTurn,
      maxTurns: 4,
    });

    expect(result).toMatchObject({
      type: 'supported',
      result: { terminalState: 'completed', finalReport: 'closed' },
    });
    expect(todoListTool).toHaveBeenCalledWith({
      runId: 'run-1',
      operation: 'done',
      seq: 1,
      todos: undefined,
      startFirst: undefined,
    });
  });

  it('injects the current running Todo into each provider turn', async () => {
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([
      {
        id: 'todo-3',
        seq: 3,
        title: 'Todo データ型・状態管理の定義',
        taskType: 'implementation',
        status: 'running',
        procedureId: null,
      },
    ] as never);
    const providerTurn = vi.fn().mockResolvedValue({
      type: 'supported',
      content: 'done',
      toolCalls: [],
      usage: zeroUsage(),
    });

    await runNativeToolTurnLoop({
      context: buildContext(),
      sink: { emit: async () => {} },
      providerTurn,
      maxTurns: 2,
    });

    expect(providerTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('seq=3'),
          }),
        ]),
      })
    );
    expect(
      providerTurn.mock.calls[0][0].messages.filter((message) => message.role === 'system')
    ).toHaveLength(1);
    expect(providerTurn.mock.calls[0][0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining('Todo データ型・状態管理の定義'),
        }),
      ])
    );
  });

  it('guides context_compile Todo to read the specification before calling context_compile', async () => {
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([
      {
        id: 'todo-2',
        seq: 2,
        title: 'context_compile を実行する',
        taskType: 'context_compile',
        status: 'running',
        procedureId: 'contextstill.context_compile',
      },
    ] as never);
    const providerTurn = vi.fn().mockResolvedValue({
      type: 'supported',
      content: 'done',
      toolCalls: [],
      usage: zeroUsage(),
    });

    await runNativeToolTurnLoop({
      context: buildContext(),
      sink: { emit: async () => {} },
      providerTurn,
      maxTurns: 2,
    });

    const messages = providerTurn.mock.calls[0][0].messages;
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.not.stringContaining('まず read_current_specification'),
        }),
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('まず read_current_specification'),
        }),
      ])
    );
    expect(providerTurn.mock.calls[0][0].tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining(['read_current_specification', 'context_compile'])
    );
  });

  it('blocks context_compile tool calls until the current specification has been read', async () => {
    const providerTurn = vi
      .fn()
      .mockResolvedValueOnce({
        type: 'supported',
        content: '',
        toolCalls: [
          {
            id: 'call-context-first',
            name: 'context_compile',
            arguments: {
              goal: 'Todo List Specification を確認する。',
            },
          },
        ],
        usage: zeroUsage(),
      })
      .mockResolvedValueOnce({
        type: 'supported',
        content: '',
        toolCalls: [],
        usage: zeroUsage(),
      });

    await runNativeToolTurnLoop({
      context: buildContext(),
      sink: { emit: async () => {} },
      providerTurn,
      maxTurns: 3,
    });

    expect(executeWorkerTool).not.toHaveBeenCalled();
    const secondCallMessages = providerTurn.mock.calls[1][0].messages;
    const toolMessage = secondCallMessages.find(
      (message: { role: string; toolCallId?: string }) =>
        message.role === 'tool' && message.toolCallId === 'call-context-first'
    );
    expect(toolMessage?.content).toContain('SPECIFICATION_REQUIRED');
    expect(toolMessage?.content).toContain('read_current_specification');
  });

  it('stops before another provider turn when the run has been cancelled in the database', async () => {
    vi.mocked(repo.getTaskRun).mockResolvedValue({
      id: 'run-1',
      status: 'cancelled',
    } as never);
    const providerTurn = vi.fn();

    const result = await runNativeToolTurnLoop({
      context: buildContext(),
      sink: { emit: async () => {} },
      providerTurn,
      maxTurns: 2,
    });

    expect(result).toMatchObject({
      type: 'supported',
      result: {
        terminalState: 'cancelled',
        stoppedBy: 'cancelled',
      },
    });
    expect(providerTurn).not.toHaveBeenCalled();
  });

  it('falls back when the first native provider turn does not produce tool calls', async () => {
    const providerTurn = vi.fn().mockResolvedValue({
      type: 'supported',
      content: 'text only',
      toolCalls: [],
      usage: zeroUsage(),
    });

    const result = await runNativeToolTurnLoop({
      context: buildContext(),
      sink: { emit: async () => {} },
      providerTurn,
      maxTurns: 1,
    });

    expect(result).toMatchObject({
      type: 'unsupported',
      reason: expect.stringContaining('no native tool calls'),
    });
  });

  it('projects failed mutation tool results with recovery evidence for the next provider turn', async () => {
    vi.mocked(executeWorkerTool).mockResolvedValue({
      result: {
        ok: false,
        toolName: 'apply_patch',
        startedAt: '2026-06-17T00:00:00.000Z',
        finishedAt: '2026-06-17T00:00:01.000Z',
        payload: {},
        error: {
          code: 'PATCH_DOES_NOT_APPLY',
          message: 'Patch did not match the current file content.',
        },
      },
      readFilesChanged: [],
    });
    const providerTurn = vi
      .fn()
      .mockResolvedValueOnce({
        type: 'supported',
        content: '',
        toolCalls: [
          {
            id: 'call-patch',
            name: 'apply_patch',
            arguments: {
              patchContent:
                'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts',
            },
          },
        ],
        usage: zeroUsage(),
      })
      .mockResolvedValueOnce({
        type: 'supported',
        content: '',
        toolCalls: [
          {
            id: 'call-final',
            name: 'finalize_answer',
            arguments: { message: 'reported failure' },
          },
        ],
        usage: zeroUsage(),
      });

    await runNativeToolTurnLoop({
      context: buildContext(),
      sink: { emit: async () => {} },
      providerTurn,
      maxTurns: 3,
    });

    const secondCallMessages = providerTurn.mock.calls[1][0].messages;
    const toolMessage = secondCallMessages.find(
      (message: { role: string; toolCallId?: string }) =>
        message.role === 'tool' && message.toolCallId === 'call-patch'
    );
    expect(toolMessage?.content).toContain('"failureKind":"patch_mismatch"');
    expect(toolMessage?.content).toContain('"kind":"read_target_once"');
    expect(toolMessage?.content).toContain('"doNotRepeat"');
  });

  it('tells the provider to rebuild malformed apply_patch content instead of using shell writes', async () => {
    vi.mocked(executeWorkerTool).mockResolvedValue({
      result: {
        ok: false,
        toolName: 'apply_patch',
        startedAt: '2026-06-17T00:00:00.000Z',
        finishedAt: '2026-06-17T00:00:01.000Z',
        payload: { stderr: 'error: corrupt patch at line 32' },
        error: {
          code: 'PATCH_FAILED',
          message: 'Failed to apply patch: error: corrupt patch at line 32',
        },
      },
      readFilesChanged: [],
    });
    const providerTurn = vi
      .fn()
      .mockResolvedValueOnce({
        type: 'supported',
        content: '',
        toolCalls: [
          {
            id: 'call-patch',
            name: 'apply_patch',
            arguments: {
              patchContent: '@@ -0,0 +1,1 @@\n+broken',
            },
          },
        ],
        usage: zeroUsage(),
      })
      .mockResolvedValueOnce({
        type: 'supported',
        content: '',
        toolCalls: [],
        usage: zeroUsage(),
      });

    await runNativeToolTurnLoop({
      context: buildContext(),
      sink: { emit: async () => {} },
      providerTurn,
      maxTurns: 3,
    });

    const secondCallMessages = providerTurn.mock.calls[1][0].messages;
    const toolMessage = secondCallMessages.find(
      (message: { role: string; toolCallId?: string }) =>
        message.role === 'tool' && message.toolCallId === 'call-patch'
    );
    expect(toolMessage?.content).toContain('"failureKind":"patch_mismatch"');
    expect(toolMessage?.content).toContain('*** Begin Patch');
    expect(toolMessage?.content).toContain('corrected patch');
  });
});

function buildContext() {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    repositoryId: 'repo-1',
    repoRoot: '/repo',
    compiledPrompt: 'do work',
    latestUserMessage: 'do work',
    timeoutSeconds: 60,
    contextSnapshot: {
      compiledPrompt: 'do work',
      source: 'fallback' as const,
    },
  };
}

function zeroUsage() {
  return {
    mode: 'measured' as const,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    rawUsage: null,
  };
}
