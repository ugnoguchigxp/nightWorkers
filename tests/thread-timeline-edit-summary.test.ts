import { describe, expect, it } from 'vitest';
import { getAgentEditSummary } from '../src/modules/nightworkers/components/ThreadTimeline';

describe('ThreadTimeline edit summaries', () => {
  it('builds an apply_patch summary from a tool call start event', () => {
    const summary = getAgentEditSummary({
      id: 'event-apply-patch-start',
      message: '[Worker Tool Call] Invoking tool apply_patch...',
      payloadJson: {
        toolName: 'apply_patch',
        arguments: {
          patchContent: [
            '*** Begin Patch',
            '*** Update File: src/greeting.txt',
            '@@',
            '-hello',
            '+hello world',
            '*** End Patch',
          ].join('\n'),
        },
      },
    } as any);

    expect(summary).toEqual({
      toolName: 'apply_patch',
      sections: [{ path: 'src/greeting.txt', added: 1, deleted: 1 }],
    });
  });

  it('builds an apply_patch summary from a custom tool call shaped payload', () => {
    const summary = getAgentEditSummary({
      id: 'event-custom-apply-patch',
      message: 'custom_tool_call apply_patch',
      payloadJson: {
        toolCall: {
          name: 'apply_patch',
          arguments: {
            patchContent: [
              '*** Begin Patch',
              '*** Add File: src/new-file.txt',
              '+created',
              '*** End Patch',
            ].join('\n'),
          },
        },
      },
    } as any);

    expect(summary?.toolName).toBe('apply_patch');
    expect(summary?.sections).toEqual([{ path: 'src/new-file.txt', added: 1, deleted: 0 }]);
  });

  it('builds a replace_content summary from tool arguments', () => {
    const summary = getAgentEditSummary({
      id: 'event-replace-content-start',
      message: '[Worker Tool Call] Invoking tool replace_content...',
      payloadJson: {
        toolName: 'replace_content',
        arguments: {
          filePath: 'src/greeting.txt',
          needle: 'hello',
          replacement: 'hello world',
        },
      },
    } as any);

    expect(summary).toEqual({
      toolName: 'replace_content',
      sections: [
        {
          path: 'src/greeting.txt',
          added: 1,
          deleted: 1,
          detail: 'replacement requested',
        },
      ],
    });
  });

  it('builds a replace_content summary from a tool result event', () => {
    const summary = getAgentEditSummary({
      id: 'event-replace-content-finished',
      message: '[Worker Tool Result] Tool replace_content execution SUCCESS.',
      payloadJson: {
        iteration: 2,
        ok: true,
        toolName: 'replace_content',
        payload: {
          applied: true,
          occurrences: 2,
          filePath: 'src/greeting.txt',
        },
      },
    } as any);

    expect(summary).toEqual({
      toolName: 'replace_content',
      sections: [
        {
          path: 'src/greeting.txt',
          detail: '2 occurrences',
        },
      ],
    });
  });
});
