import { describe, expect, it } from 'vitest';
import { buildPersistedStreamingResponsePreview } from '../src/modules/nightworkers/components/ThreadTimeline';

describe('ThreadTimeline streaming persistence', () => {
  it('keeps the latest streamed finalResponse visible after a run stops', () => {
    const preview = buildPersistedStreamingResponsePreview({
      runId: 'run-1',
      taskMessages: [
        {
          id: 'msg-final',
          taskId: 'task-1',
          runId: 'run-1',
          role: 'assistant',
          content: '【人手確認が必要】 runtime summary',
          messageType: 'text',
          createdAt: '2026-06-04T00:00:00.000Z',
        },
      ] as any,
      events: [
        {
          id: 'event-1',
          runId: 'run-1',
          seq: 1,
          actor: 'supervisor',
          type: 'info',
          eventType: 'info',
          message: '{"phase":"stop","finalResponse":"古い stream 本文","toolCall":null}',
          payloadJson: {
            runEvent: {
              type: 'model.response_delta',
              data: {
                text: '{"phase":"stop","finalResponse":"古い stream 本文","toolCall":null}',
              },
            },
          },
          timestamp: '2026-06-04T00:00:00.000Z',
        },
        {
          id: 'event-2',
          runId: 'run-1',
          seq: 2,
          actor: 'supervisor',
          type: 'info',
          eventType: 'info',
          message:
            '{"phase":"stop","finalResponse":"`fizzbuzz.ts` を作成しようとしましたが、Operation not permitted で失敗しました。","toolCall":null}',
          payloadJson: {
            runEvent: {
              type: 'model.response_delta',
              data: {
                text: '{"phase":"stop","finalResponse":"`fizzbuzz.ts` を作成しようとしましたが、Operation not permitted で失敗しました。","toolCall":null}',
              },
            },
          },
          timestamp: '2026-06-04T00:00:01.000Z',
        },
      ] as any,
    });

    expect(preview?.visibleText).toContain('fizzbuzz.ts');
    expect(preview?.visibleText).toContain('Operation not permitted');
    expect(preview?.visibleText).not.toContain('古い stream 本文');
  });

  it('does not duplicate a streamed response that is already persisted for the same run', () => {
    const preview = buildPersistedStreamingResponsePreview({
      runId: 'run-1',
      taskMessages: [
        {
          id: 'msg-stream',
          taskId: 'task-1',
          runId: 'run-1',
          role: 'assistant',
          content: '`fizzbuzz.ts` は既に chat に残っています。',
          messageType: 'text',
          createdAt: '2026-06-04T00:00:00.000Z',
        },
      ] as any,
      events: [
        {
          id: 'event-1',
          runId: 'run-1',
          seq: 1,
          actor: 'supervisor',
          type: 'info',
          eventType: 'info',
          message:
            '{"phase":"stop","finalResponse":"`fizzbuzz.ts` は既に chat に残っています。","toolCall":null}',
          payloadJson: {
            runEvent: {
              type: 'model.response_delta',
              data: {
                text: '{"phase":"stop","finalResponse":"`fizzbuzz.ts` は既に chat に残っています。","toolCall":null}',
              },
            },
          },
          timestamp: '2026-06-04T00:00:00.000Z',
        },
      ] as any,
    });

    expect(preview).toBeNull();
  });
});
