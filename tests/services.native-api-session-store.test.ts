import { describe, expect, it } from 'vitest';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import { NativeApiSessionStore } from '../api/services/agent-runtime/native-api-runner/native-api-session-store';

describe('NativeApiSessionStore', () => {
  it('persists native API turns and provider-native tool calls', async () => {
    const project = await repo.createRepository({
      name: `TEST: native api session ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: project.id,
      title: 'TEST: native API session store',
      status: 'running',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: project.id,
      workerKind: 'native-api-runner',
      status: 'running',
      timeoutSeconds: 60,
    });
    const store = new NativeApiSessionStore();

    const turn = await store.createTurn({
      runId: run.id,
      taskId: task.id,
      turnIndex: 1,
      provider: 'openai-compatible',
      model: 'api-model',
      history: [{ type: 'user', source: 'user', content: 'do the work' }],
    });
    const toolCall = await store.recordToolCallPending({
      runId: run.id,
      taskId: task.id,
      turnId: turn.id,
      toolCall: {
        id: 'call-1',
        name: 'read_current_specification',
        arguments: {},
      },
      todoSeq: 1,
    });

    await store.markToolCallRunning({ id: toolCall.id });
    await store.finishToolCall({
      id: toolCall.id,
      status: 'completed',
      result: { ok: true, content: '{"ok":true}' },
    });
    await store.finishTurn({
      turnId: turn.id,
      status: 'completed',
      history: [
        { type: 'user', source: 'user', content: 'do the work' },
        {
          type: 'tool_result',
          toolCallId: 'call-1',
          toolName: 'read_current_specification',
          result: { ok: true, content: '{"ok":true}' },
        },
      ],
      providerDebug: { providerEndpointId: 'endpoint-1' },
    });

    const turns = await store.listTurns(run.id);
    const toolCalls = await store.listToolCalls(run.id);

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      runId: run.id,
      taskId: task.id,
      turnIndex: 1,
      status: 'completed',
      provider: 'openai-compatible',
      model: 'api-model',
    });
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      runId: run.id,
      taskId: task.id,
      turnId: turn.id,
      toolCallId: 'call-1',
      toolName: 'read_current_specification',
      status: 'completed',
      todoSeq: 1,
    });
  });
});
