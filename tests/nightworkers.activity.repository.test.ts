import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureNightWorkersSchema } from '../api/db/bootstrap';
import {
  enqueueActivityEvent,
  flushActivityEventQueue,
  listActivityEventsForTask,
  runEventToActivityText,
} from '../api/modules/nightworkers/nightworkers.activity.repository';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';

beforeAll(async () => {
  await ensureNightWorkersSchema();
});

describe('nightworkers activity repository', () => {
  it('includes MCP tool arguments and error details in activity text', () => {
    const text = runEventToActivityText({
      eventType: 'tool.call_finished',
      message: '[Codex] MCP tool finished: nightworkers.todo_list',
      agentEventType: null,
      payload: {
        payload: {
          toolName: 'nightworkers.todo_list',
          status: 'failed',
          arguments: {
            runId: 'run-1',
            operation: 'done',
            seq: 1,
          },
          error: 'CURRENT_TODO_NOT_UNIQUE',
          result: {
            content: [{ type: 'text', text: '{"error":{"code":"CURRENT_TODO_NOT_UNIQUE"}}' }],
          },
        },
      },
    });

    expect(text).toContain('nightworkers.todo_list | failed');
    expect(text).toContain('args: runId=run-1 operation=done seq=1');
    expect(text).toContain('error: CURRENT_TODO_NOT_UNIQUE');
    expect(text).toContain('result: ');
  });

  it('snapshots queued payloads before asynchronous flush', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: Activity Queue Snapshot ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: Activity queue snapshot target',
      description: 'Persist original queued payload',
      status: 'draft',
    });
    const payload = {
      nested: {
        text: 'before',
      },
    };

    enqueueActivityEvent({
      taskId: task.id,
      kind: 'system.info',
      source: 'system',
      text: 'queued snapshot test',
      payloadJson: payload,
      dedupeKey: `snapshot:${crypto.randomUUID()}`,
    });
    payload.nested.text = 'after';

    await flushActivityEventQueue();
    const events = await listActivityEventsForTask(task.id);
    const matched = events.find((event) => event.text === 'queued snapshot test');

    expect(matched?.payloadJson).toEqual({
      nested: {
        text: 'before',
      },
    });
  });
});
