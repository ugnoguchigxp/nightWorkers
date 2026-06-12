import { describe, expect, it } from 'vitest';
import { runEventToActivityText } from '../api/modules/nightworkers/nightworkers.activity.repository';

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
});
