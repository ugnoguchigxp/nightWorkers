import { describe, expect, it } from 'vitest';
import {
  getAgentEditSummary,
  parseDiffMetadata,
} from '../src/modules/nightworkers/components/ThreadTimeline';

describe('ThreadTimeline edit summaries', () => {
  it('keeps diff hunk headers out of displayed code line numbers', () => {
    const metadata = parseDiffMetadata(
      [
        'diff --git a/src/new-file.txt b/src/new-file.txt',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/src/new-file.txt',
        '@@ -0,0 +1,3 @@',
        '+first',
        '+second',
        '+third',
      ].join('\n')
    );

    expect(metadata.filePath).toBe('b/src/new-file.txt');
    expect(metadata.lines).toEqual([
      { text: '@@ -0,0 +1,3 @@' },
      { text: '+first', lineNumber: 1 },
      { text: '+second', lineNumber: 2 },
      { text: '+third', lineNumber: 3 },
    ]);
  });

  it('uses new-file line numbers for unified diff context and additions', () => {
    const metadata = parseDiffMetadata(
      [
        '--- a/src/greeting.txt',
        '+++ b/src/greeting.txt',
        '@@ -8,3 +8,4 @@',
        ' unchanged',
        '-old',
        '+new',
        ' next',
      ].join('\n')
    );

    expect(metadata.lines).toEqual([
      { text: '@@ -8,3 +8,4 @@' },
      { text: ' unchanged', lineNumber: 8 },
      { text: '-old' },
      { text: '+new', lineNumber: 9 },
      { text: ' next', lineNumber: 10 },
    ]);
  });

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
      codeBlocks: [
        {
          code: [
            '*** Begin Patch',
            '*** Update File: src/greeting.txt',
            '@@',
            '-hello',
            '+hello world',
            '*** End Patch',
          ].join('\n'),
          filename: 'apply_patch.patch',
          language: 'diff',
        },
      ],
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
    expect(summary?.codeBlocks).toEqual([
      {
        code: [
          '*** Begin Patch',
          '*** Add File: src/new-file.txt',
          '+created',
          '*** End Patch',
        ].join('\n'),
        filename: 'apply_patch.patch',
        language: 'diff',
      },
    ]);
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
      codeBlocks: [
        {
          code: [
            '--- src/greeting.txt',
            '+++ src/greeting.txt',
            '# replacement requested',
            '- hello',
            '+ hello world',
          ].join('\n'),
          filename: 'src/greeting.txt.replace.diff',
          language: 'diff',
        },
      ],
    });
  });

  it('builds a replace_content summary from a tool result event with arguments', () => {
    const summary = getAgentEditSummary({
      id: 'event-replace-content-finished',
      message: '[Worker Tool Result] Tool replace_content execution SUCCESS.',
      payloadJson: {
        iteration: 2,
        ok: true,
        toolName: 'replace_content',
        arguments: {
          filePath: 'src/greeting.txt',
          needle: 'hello',
          replacement: 'hello world',
        },
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
          added: 2,
          deleted: 2,
          detail: '2 occurrences',
        },
      ],
      codeBlocks: [
        {
          code: [
            '--- src/greeting.txt',
            '+++ src/greeting.txt',
            '# occurrences: 2',
            '- hello',
            '+ hello world',
          ].join('\n'),
          filename: 'src/greeting.txt.replace.diff',
          language: 'diff',
        },
      ],
    });
  });

  it('builds an apply_patch summary from the persisted tool result run event shape', () => {
    const patchContent = [
      '*** Begin Patch',
      '*** Add File: src/new-file.txt',
      '+created',
      '*** End Patch',
    ].join('\n');

    const summary = getAgentEditSummary({
      id: 'event-apply-patch-run-event',
      message: '[Worker Tool Result] Tool apply_patch execution SUCCESS.',
      payloadJson: {
        runEvent: {
          type: 'tool.call_finished',
          data: {
            toolName: 'apply_patch',
            arguments: { patchContent },
            result: {
              ok: true,
              toolName: 'apply_patch',
              payload: { applied: true, changedFiles: ['src/new-file.txt'] },
            },
          },
        },
      },
    } as any);

    expect(summary).toEqual({
      toolName: 'apply_patch',
      sections: [{ path: 'src/new-file.txt', added: 1, deleted: 0 }],
      codeBlocks: [
        {
          code: patchContent,
          filename: 'apply_patch.patch',
          language: 'diff',
        },
      ],
    });
  });
});
