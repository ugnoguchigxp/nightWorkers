import { describe, expect, it } from 'vitest';
import { buildNormalTranscriptItems } from '../src/modules/nightworkers/components/ThreadTimeline';
import { getContextStillToolCardModel } from '../src/modules/nightworkers/components/ThreadTimelineContextStillCards';

describe('ThreadTimeline ContextStill cards', () => {
  it('extracts initial_instructions result text from a finished MCP event', () => {
    const card = getContextStillToolCardModel({
      kind: 'tool.result',
      payloadJson: {
        runEvent: {
          type: 'tool.call_finished',
          data: {
            toolName: 'context-still.initial_instructions',
            result: {
              content: [{ type: 'text', text: '## 常用ルール\n- 日本語で返答する。' }],
            },
          },
        },
      },
    });

    expect(card).toEqual({
      kind: 'initial_instructions_result',
      title: 'initial_instructions result',
      toolName: 'context-still.initial_instructions',
      body: '## 常用ルール\n- 日本語で返答する。',
      format: 'markdown',
    });
  });

  it('extracts context_compile input from a started MCP event', () => {
    const card = getContextStillToolCardModel({
      kind: 'tool.call',
      payloadJson: {
        runEvent: {
          type: 'tool.call_started',
          data: {
            toolName: 'context-still.context_compile',
            arguments: {
              goal: 'timeline に ContextStill の入出力カードを表示する',
              changeTypes: ['ui', 'observability'],
              technologies: ['TypeScript', 'React'],
            },
          },
        },
      },
    });

    expect(card?.kind).toBe('context_compile_input');
    expect(card?.summary).toBe('timeline に ContextStill の入出力カードを表示する');
    expect(card?.body).toContain('"changeTypes"');
    expect(card?.body).toContain('"React"');
  });

  it('extracts context_compile output from a finished MCP event', () => {
    const card = getContextStillToolCardModel({
      kind: 'tool.result',
      payloadJson: {
        runEvent: {
          type: 'tool.call_finished',
          data: {
            toolName: 'context-still.context_compile',
            result: {
              content: [{ type: 'text', text: '## Workflow\n1. ログを確認する。' }],
            },
          },
        },
      },
    });

    expect(card).toEqual({
      kind: 'context_compile_output',
      title: 'context_compile output',
      toolName: 'context-still.context_compile',
      body: '## Workflow\n1. ログを確認する。',
      format: 'markdown',
    });
  });

  it('extracts compile_eval input from a started MCP event', () => {
    const card = getContextStillToolCardModel({
      kind: 'tool.call',
      payloadJson: {
        runEvent: {
          type: 'tool.call_started',
          data: {
            toolName: 'context-still.compile_eval',
            arguments: {
              title: 'context_compile timeline card',
              outcome: 'useful',
              actionability: 90,
            },
          },
        },
      },
    });

    expect(card?.kind).toBe('compile_eval_input');
    expect(card?.summary).toBe('context_compile timeline card');
    expect(card?.body).toContain('"outcome": "useful"');
  });

  it('keeps context-still cards visible in normal transcript mode', () => {
    const items = buildNormalTranscriptItems([
      {
        kind: 'user_turn',
        id: 'user:1',
        turnId: 'user-1',
        events: [],
        text: 'ログを表示して',
      },
      {
        kind: 'activity',
        id: 'activity:context-compile',
        event: {
          id: 'context-compile',
          taskId: 'task-1',
          kind: 'tool.result',
          source: 'worker',
          status: 'completed',
          seq: 1,
          payloadJson: {
            runEvent: {
              type: 'tool.call_finished',
              data: {
                toolName: 'context-still.context_compile',
                result: {
                  content: [{ type: 'text', text: '## Workflow\n1. ログを確認する。' }],
                },
              },
            },
          },
          createdAt: '2026-06-12T00:00:00.000Z',
          visibility: 'visible',
        } as any,
      },
    ]);

    expect(items.map((item) => item.id)).toEqual(['user:1', 'activity:context-compile']);
  });
});
