import { describe, expect, it } from 'vitest';
import {
  buildPersistedStreamingResponsePreview,
  buildStreamingResponsePreview,
  formatVisibleAssistantText,
  isUserVisibleChatMessage,
} from '../src/modules/nightworkers/components/ThreadTimeline';

describe('ThreadTimeline streaming persistence', () => {
  it('keeps the latest streamed finalize_answer message visible after a run stops', () => {
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
          message:
            '{"toolCall":{"name":"finalize_answer","arguments":{"message":"古い stream 本文"}}}',
          payloadJson: {
            runEvent: {
              type: 'model.response_delta',
              data: {
                text: '{"toolCall":{"name":"finalize_answer","arguments":{"message":"古い stream 本文"}}}',
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
            '{"toolCall":{"name":"finalize_answer","arguments":{"message":"`fizzbuzz.ts` を作成しようとしましたが、Operation not permitted で失敗しました。"}}}',
          payloadJson: {
            runEvent: {
              type: 'model.response_delta',
              data: {
                text: '{"toolCall":{"name":"finalize_answer","arguments":{"message":"`fizzbuzz.ts` を作成しようとしましたが、Operation not permitted で失敗しました。"}}}',
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
            '{"toolCall":{"name":"finalize_answer","arguments":{"message":"`fizzbuzz.ts` は既に chat に残っています。"}}}',
          payloadJson: {
            runEvent: {
              type: 'model.response_delta',
              data: {
                text: '{"toolCall":{"name":"finalize_answer","arguments":{"message":"`fizzbuzz.ts` は既に chat に残っています。"}}}',
              },
            },
          },
          timestamp: '2026-06-04T00:00:00.000Z',
        },
      ] as any,
    });

    expect(preview).toBeNull();
  });

  it('renders schema-first finalize toolCall JSON as the message only', () => {
    const raw = JSON.stringify({
      toolCall: {
        name: 'finalize_answer',
        arguments: {
          message: 'fizzbuzz.ts を作成しました。',
        },
      },
    });

    expect(formatVisibleAssistantText(raw)).toBe('fizzbuzz.ts を作成しました。');
  });

  it('does not render structured artifact JSON as assistant chat text', () => {
    const raw = JSON.stringify({
      title: 'Specification',
      content: '# Specification\n\nWorkspace-only artifact.',
    });

    expect(formatVisibleAssistantText(raw)).toBe('');
    expect(
      buildStreamingResponsePreview({
        events: [],
        activeStreamingResponse: raw,
      })?.visibleText
    ).toBe('');
  });

  it('builds persisted previews from schema-first response delta events', () => {
    const preview = buildPersistedStreamingResponsePreview({
      runId: 'run-1',
      taskMessages: [] as any,
      events: [
        {
          id: 'event-1',
          runId: 'run-1',
          seq: 1,
          actor: 'supervisor',
          type: 'debug',
          eventType: 'debug',
          message: 'Supervisor LLM response delta received.',
          payloadJson: {
            agentEventType: 'model.response_delta',
            provider: 'openai',
            round: 2,
            text: '{"toolCall":{"name":"finalize_answer","arguments":{"message":"schema-first stream"}}}',
          },
          timestamp: '2026-06-04T00:00:00.000Z',
        },
      ] as any,
    });

    expect(preview?.visibleText).toBe('schema-first stream');
  });

  it('keeps blueprint raw diagnostics out of the normal chat timeline', () => {
    expect(
      isUserVisibleChatMessage({
        id: 'msg-raw',
        taskId: 'task-1',
        role: 'assistant',
        content: '{"id":"raw-blueprint"}',
        messageType: 'text',
        metadataJson: { intent: 'blueprint_raw_output' },
        createdAt: '2026-06-08T00:00:00.000Z',
      } as any)
    ).toBe(false);

    expect(
      isUserVisibleChatMessage({
        id: 'msg-normal',
        taskId: 'task-1',
        role: 'assistant',
        content: 'Blueprint を作成しました。',
        messageType: 'text',
        metadataJson: { intent: 'blueprint_created' },
        createdAt: '2026-06-08T00:00:01.000Z',
      } as any)
    ).toBe(true);

    expect(
      isUserVisibleChatMessage({
        id: 'msg-spec',
        taskId: 'task-1',
        role: 'assistant',
        content: '# Specification',
        messageType: 'markdown_document',
        metadataJson: { intent: 'draft_spec' },
        createdAt: '2026-06-08T00:00:02.000Z',
      } as any)
    ).toBe(false);

    expect(
      isUserVisibleChatMessage({
        id: 'msg-reviewed-spec',
        taskId: 'task-1',
        role: 'assistant',
        content: '# Reviewed Specification',
        messageType: 'markdown_document',
        metadataJson: {
          intent: 'draft_spec',
          source: 'status_document_review',
          reviewedSourceMessageId: 'msg-spec',
        },
        createdAt: '2026-06-08T00:00:03.000Z',
      } as any)
    ).toBe(false);
  });
});
