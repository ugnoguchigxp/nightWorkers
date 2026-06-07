import type { ThreadEvent } from '@openai/codex-sdk';
import { describe, expect, it, vi } from 'vitest';
import { CodexAgentRuntime } from '../api/services/agent-runtime/CodexAgentRuntime';
import {
  createCodexEventMapperState,
  mapCodexThreadEvent,
  redactProviderEvent,
} from '../api/services/agent-runtime/codex-event-mapper';

describe('CodexAgentRuntime', () => {
  it('maps a fake assistant turn into runtime ledger events', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () =>
        fakeThread([
          { type: 'thread.started', thread_id: 'codex-thread-1' },
          { type: 'turn.started' },
          {
            type: 'item.updated',
            item: { id: 'item-1', type: 'agent_message', text: 'hello' },
          },
          {
            type: 'item.completed',
            item: { id: 'item-1', type: 'agent_message', text: 'hello world' },
          },
          {
            type: 'turn.completed',
            usage: {
              input_tokens: 10,
              cached_input_tokens: 2,
              output_tokens: 3,
              reasoning_output_tokens: 1,
            },
          },
        ]),
    });
    const events: any[] = [];

    const result = await runtime.start(buildContext(), {
      emit: async (event) => {
        events.push(event);
      },
    });

    expect(result.terminalState).toBe('completed');
    expect(result.finalReport).toBe('hello world');
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'runtime_started',
        'turn_started',
        'model_response_delta',
        'model_response_finished',
        'runtime_finished',
      ])
    );
  });

  it('returns cancelled when the run is stopped before the stream starts', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () => fakeThread([{ type: 'turn.started' }]),
    });
    await runtime.stop('run-codex');

    const result = await runtime.start(buildContext(), { emit: async () => {} });

    expect(result.terminalState).toBe('cancelled');
    expect(result.stoppedBy).toBe('cancelled');
  });

  it('maps runtime failure to failed result and runtime_error event', async () => {
    const runtime = new CodexAgentRuntime({
      threadFactory: () => fakeThread([{ type: 'turn.failed', error: { message: 'boom' } }]),
    });
    const events: any[] = [];

    const result = await runtime.start(buildContext(), {
      emit: async (event) => {
        events.push(event);
      },
    });

    expect(result.terminalState).toBe('failed');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runtime_error',
          payload: expect.objectContaining({ error: 'boom' }),
        }),
      ])
    );
  });

  it('maps command and MCP activity without rejecting provider activity', () => {
    const state = createCodexEventMapperState();
    const commandEvents = mapCodexThreadEvent(
      {
        type: 'item.completed',
        item: {
          id: 'cmd-1',
          type: 'command_execution',
          command: 'pnpm test',
          aggregated_output: 'ok',
          exit_code: 0,
          status: 'completed',
        },
      },
      state
    );
    const mcpEvents = mapCodexThreadEvent(
      {
        type: 'item.completed',
        item: {
          id: 'mcp-1',
          type: 'mcp_tool_call',
          server: 'nightworkers',
          tool: 'get_task_context',
          arguments: { taskId: 'task-1', Authorization: 'Bearer secret' },
          status: 'completed',
        },
      },
      state
    );

    expect(commandEvents[0]).toMatchObject({
      type: 'tool_call_finished',
      payload: { command: 'pnpm test', exitCode: 0 },
    });
    expect(mcpEvents[0]).toMatchObject({
      type: 'tool_call_finished',
      payload: { toolName: 'nightworkers.get_task_context' },
    });
  });

  it('maps in-progress command and MCP updates as tool progress', () => {
    const state = createCodexEventMapperState();

    expect(
      mapCodexThreadEvent(
        {
          type: 'item.updated',
          item: {
            id: 'cmd-progress',
            type: 'command_execution',
            command: 'pnpm test',
            aggregated_output: 'running',
            status: 'in_progress',
          },
        },
        state
      )[0]
    ).toMatchObject({
      type: 'tool_call_progress',
      payload: { toolName: 'command_execution', status: 'in_progress' },
    });
    expect(
      mapCodexThreadEvent(
        {
          type: 'item.updated',
          item: {
            id: 'mcp-progress',
            type: 'mcp_tool_call',
            server: 'nightworkers',
            tool: 'get_task_context',
            arguments: { taskId: 'task-1' },
            status: 'in_progress',
          },
        },
        state
      )[0]
    ).toMatchObject({
      type: 'tool_call_progress',
      payload: { toolName: 'nightworkers.get_task_context', status: 'in_progress' },
    });
  });

  it('redacts secret-like provider event fields', () => {
    expect(
      redactProviderEvent({
        headers: { Authorization: 'Bearer secret' },
        nested: { apiKey: 'secret' },
      })
    ).toEqual({
      headers: { Authorization: '[REDACTED]' },
      nested: { apiKey: '[REDACTED]' },
    });
  });
});

function buildContext() {
  return {
    runId: 'run-codex',
    taskId: 'task-codex',
    repositoryId: 'repo-codex',
    repoRoot: process.cwd(),
    compiledPrompt: 'do work',
    latestUserMessage: 'do work',
    timeoutSeconds: 60,
    contextSnapshot: {
      compiledPrompt: 'do work',
      source: 'fallback' as const,
    },
  };
}

function fakeThread(events: ThreadEvent[]) {
  return {
    runStreamed: vi.fn(async () => ({
      events: (async function* () {
        for (const event of events) yield event;
      })(),
    })),
  } as any;
}
