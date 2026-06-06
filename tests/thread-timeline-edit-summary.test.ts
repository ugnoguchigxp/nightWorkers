import { describe, expect, it } from 'vitest';
import {
  buildNormalTranscriptItems,
  buildVisibleEditDiffSummary,
  findArtifactTaskMessage,
  findRuntimePromptSnapshotTranscriptAnchorId,
  getActivityCode,
  getAgentEditSummary,
  getVisibleCliCommandSummary,
  parseDiffMetadata,
} from '../src/modules/nightworkers/components/ThreadTimeline';

describe('ThreadTimeline edit summaries', () => {
  it('recovers Blueprint artifact messages from activity transcript metadata', () => {
    const message = {
      id: 'message-blueprint',
      taskId: 'task-1',
      role: 'assistant',
      content: '# ECサイトのトップページBlueprint\n\n## Blueprint Summary\nraw markdown',
      messageType: 'markdown_document',
      createdAt: '2026-06-05T00:00:00.000Z',
    };
    const metadata = {
      intent: 'app_blueprint',
      title: 'ECサイトのトップページBlueprint',
      appBlueprint: { id: 'ec-top-page-blueprint', name: 'ECサイトのトップページBlueprint' },
      validation: { valid: true, issues: [] },
    };

    const artifactMessage = findArtifactTaskMessage([
      {
        id: 'event-blueprint',
        taskId: 'task-1',
        kind: 'assistant.message',
        source: 'assistant',
        status: 'completed',
        seq: 1,
        text: message.content,
        payloadJson: { message, metadata },
        createdAt: '2026-06-05T00:00:00.000Z',
        visibility: 'visible',
      } as any,
    ]);

    expect(artifactMessage).toEqual(
      expect.objectContaining({
        id: message.id,
        messageType: 'markdown_document',
        metadataJson: expect.objectContaining({
          intent: 'app_blueprint',
          appBlueprint: expect.objectContaining({ name: 'ECサイトのトップページBlueprint' }),
        }),
      })
    );
  });

  it('keeps one apply_patch diff and the final assistant message in normal mode', () => {
    const patchContent = [
      '*** Begin Patch',
      '*** Add File: fizzbuzz.ts',
      '+export function fizzbuzz(n: number): string {',
      '+  return String(n);',
      '+}',
      '*** End Patch',
    ].join('\n');
    const items = buildNormalTranscriptItems([
      {
        kind: 'user_turn',
        id: 'user:1',
        turnId: 'user-1',
        events: [],
        text: 'fizzbuzz.tsを作ってください',
      },
      {
        kind: 'activity',
        id: 'activity:request',
        event: {
          id: 'request',
          taskId: 'task-1',
          kind: 'llm.request',
          source: 'supervisor',
          status: 'completed',
          seq: 1,
          text: 'Round 2 prompt',
          createdAt: '2026-06-05T00:00:00.000Z',
          visibility: 'visible',
        } as any,
      },
      {
        kind: 'activity',
        id: 'activity:raw',
        event: {
          id: 'raw',
          taskId: 'task-1',
          kind: 'assistant.raw_output',
          source: 'supervisor',
          status: 'completed',
          seq: 2,
          text: JSON.stringify({
            toolCall: {
              name: 'apply_patch',
              arguments: { patchContent },
            },
          }),
          createdAt: '2026-06-05T00:00:01.000Z',
          visibility: 'visible',
        } as any,
      },
      {
        kind: 'activity',
        id: 'activity:schema',
        event: {
          id: 'schema',
          taskId: 'task-1',
          kind: 'llm.schema_result',
          source: 'supervisor',
          status: 'completed',
          seq: 3,
          text: '',
          payloadJson: {
            payload: {
              toolCall: {
                name: 'apply_patch',
                arguments: { patchContent },
              },
            },
          },
          createdAt: '2026-06-05T00:00:02.000Z',
          visibility: 'visible',
        } as any,
      },
      {
        kind: 'activity',
        id: 'activity:tool-result',
        event: {
          id: 'tool-result',
          taskId: 'task-1',
          kind: 'tool.result',
          source: 'worker',
          status: 'completed',
          seq: 4,
          text: 'tool=apply_patch status=ok',
          createdAt: '2026-06-05T00:00:03.000Z',
          visibility: 'visible',
        } as any,
      },
      {
        kind: 'assistant_turn',
        id: 'assistant:final',
        turnId: 'assistant-final',
        events: [],
        text: '`fizzbuzz.ts` を作成しました。',
        children: [],
      },
    ]);

    expect(items.map((item) => item.id)).toEqual(['user:1', 'activity:raw', 'assistant:final']);
  });

  it('keeps CLI command tool calls in normal mode', () => {
    const items = buildNormalTranscriptItems([
      {
        kind: 'user_turn',
        id: 'user:1',
        turnId: 'user-1',
        events: [],
        text: 'テストを実行してください',
      },
      {
        kind: 'activity',
        id: 'activity:command',
        event: {
          id: 'command',
          taskId: 'task-1',
          kind: 'tool.result',
          source: 'worker',
          status: 'completed',
          seq: 1,
          runId: 'run-1',
          text: 'tool=run_command status=ok',
          payloadJson: {
            runEvent: {
              runId: 'run-1',
              type: 'tool.call_finished',
              data: {
                iteration: 1,
                toolName: 'run_command',
                arguments: { command: 'pnpm test -- --runInBand' },
                result: {
                  ok: true,
                  toolName: 'run_command',
                  payload: { exitCode: 0, command: 'pnpm test -- --runInBand' },
                },
              },
            },
          },
          createdAt: '2026-06-05T00:00:00.000Z',
          visibility: 'visible',
        } as any,
      },
      {
        kind: 'activity',
        id: 'activity:command-again',
        event: {
          id: 'command-again',
          taskId: 'task-1',
          runId: 'run-1',
          kind: 'tool.result',
          source: 'worker',
          status: 'completed',
          seq: 2,
          text: 'tool=run_command status=ok',
          payloadJson: {
            runEvent: {
              runId: 'run-1',
              type: 'tool.call_finished',
              data: {
                iteration: 2,
                toolName: 'run_command',
                arguments: { command: 'pnpm test -- --runInBand' },
                result: {
                  ok: true,
                  toolName: 'run_command',
                  payload: { exitCode: 0, command: 'pnpm test -- --runInBand' },
                },
              },
            },
          },
          createdAt: '2026-06-05T00:00:01.000Z',
          visibility: 'visible',
        } as any,
      },
      {
        kind: 'activity',
        id: 'activity:status',
        event: {
          id: 'status',
          taskId: 'task-1',
          kind: 'run.status',
          source: 'runtime',
          status: 'completed',
          seq: 3,
          text: 'run.completed',
          createdAt: '2026-06-05T00:00:02.000Z',
          visibility: 'visible',
        } as any,
      },
    ]);

    expect(items.map((item) => item.id)).toEqual([
      'user:1',
      'activity:command',
      'activity:command-again',
    ]);
  });

  it('anchors runtime prompt snapshots after the matching run.started activity', () => {
    const anchorId = findRuntimePromptSnapshotTranscriptAnchorId(
      [
        {
          kind: 'user_turn',
          id: 'user:first',
          turnId: 'user-first',
          text: 'fizzbuzz.js をプロジェクトルートに置いてください。',
          events: [
            {
              id: 'user-event',
              taskId: 'task-1',
              runId: null,
              kind: 'user.message',
              source: 'user',
              status: 'completed',
              seq: 1,
              text: 'fizzbuzz.js をプロジェクトルートに置いてください。',
              createdAt: '2026-06-05T00:00:00.000Z',
              visibility: 'visible',
            } as any,
          ],
        },
        {
          kind: 'activity',
          id: 'activity:run-started',
          event: {
            id: 'run-started',
            taskId: 'task-1',
            runId: 'run-1',
            kind: 'run.status',
            source: 'runtime',
            status: 'started',
            seq: 2,
            text: '[SchemaFirstAgent] run.started',
            payloadJson: {
              agentEventType: 'run.started',
            },
            createdAt: '2026-06-05T00:00:01.000Z',
            visibility: 'visible',
          } as any,
        },
      ],
      {
        id: 'run-1',
        taskId: 'task-1',
        status: 'running',
        workerKind: 'native-local',
        timeoutSeconds: 60,
        contextSnapshot: {
          conversationContext: {
            stateCardIncluded: true,
            stateCardText: '<STATE_CARD />',
            snapshotJson: { version: 1 },
          },
        },
        startedAt: '2026-06-05T00:00:01.000Z',
        createdAt: '2026-06-05T00:00:01.000Z',
        updatedAt: '2026-06-05T00:00:01.000Z',
      } as any
    );

    expect(anchorId).toBe('activity:run-started');
  });

  it('builds a compact file stat summary for normal apply_patch display', () => {
    const patchContent = [
      '*** Begin Patch',
      '*** Add File: src/modules/nightworkers/components/ThreadTimeline.tsx',
      '+first',
      '+second',
      '*** Update File: tests/thread-timeline-edit-summary.test.ts',
      '@@',
      '-old',
      '+new',
      '*** End Patch',
    ].join('\n');

    const summary = buildVisibleEditDiffSummary({
      id: 'raw',
      taskId: 'task-1',
      kind: 'assistant.raw_output',
      source: 'supervisor',
      status: 'completed',
      seq: 1,
      text: JSON.stringify({
        toolCall: {
          name: 'apply_patch',
          arguments: { patchContent },
        },
      }),
      createdAt: '2026-06-05T00:00:00.000Z',
      visibility: 'visible',
    } as any);

    expect(summary).toEqual([
      {
        path: 'src/modules/nightworkers/components/ThreadTimeline.tsx',
        added: 2,
        deleted: 0,
      },
      {
        path: 'tests/thread-timeline-edit-summary.test.ts',
        added: 1,
        deleted: 1,
      },
    ]);
  });

  it('extracts schema-first debug payloads for CodeBlock rendering', () => {
    expect(
      getActivityCode({
        id: 'response-finished',
        taskId: 'task-1',
        kind: 'llm.response_final',
        source: 'supervisor',
        status: 'completed',
        seq: 1,
        text: 'Supervisor LLM response received.',
        payloadJson: {
          agentEventType: 'model.response_finished',
          rawContent: '{"toolCall":{"name":"finalize_answer","arguments":{"message":"done"}}}',
        },
        createdAt: '2026-06-05T00:00:00.000Z',
        visibility: 'visible',
      } as any)
    ).toContain('finalize_answer');

    expect(
      getActivityCode({
        id: 'prompt-built',
        taskId: 'task-1',
        kind: 'llm.request',
        source: 'supervisor',
        status: 'completed',
        seq: 2,
        text: 'Round 2 prompt built.',
        payloadJson: {
          agentEventType: 'round2.prompt_built',
          systemPrompt: 'システム指示',
          userPrompt: 'ユーザー入力',
        },
        createdAt: '2026-06-05T00:00:01.000Z',
        visibility: 'visible',
      } as any)
    ).toBe('システム指示');

    expect(
      getActivityCode({
        id: 'skill-loaded',
        taskId: 'task-1',
        kind: 'runtime.state',
        source: 'runtime',
        status: 'completed',
        seq: 3,
        text: 'skills/minor_code_edit.md',
        payloadJson: {
          agentEventType: 'skill.loaded',
          payload: {
            skillPath: 'skills/minor_code_edit.md',
            skill: '# minor_code_edit\n\n## Procedure\n1. read_file',
          },
        },
        createdAt: '2026-06-05T00:00:02.000Z',
        visibility: 'visible',
      } as any)
    ).toBe('# minor_code_edit\n\n## Procedure\n1. read_file');
  });

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

  it('builds a CLI command summary from a persisted run_command event', () => {
    const summary = getVisibleCliCommandSummary({
      id: 'event-run-command-finished',
      taskId: 'task-1',
      kind: 'tool.result',
      source: 'worker',
      status: 'completed',
      seq: 1,
      text: '[Worker Tool Result] Tool run_command execution SUCCESS.',
      payloadJson: {
        runEvent: {
          type: 'tool.call_finished',
          data: {
            toolName: 'run_command',
            arguments: { command: 'pnpm test' },
            result: {
              ok: true,
              toolName: 'run_command',
              payload: { command: 'pnpm test', exitCode: 0 },
            },
          },
        },
      },
      createdAt: '2026-06-05T00:00:00.000Z',
      visibility: 'visible',
    } as any);

    expect(summary).toEqual({ toolName: 'run_command', command: 'pnpm test' });
  });

  it('builds a CLI command summary from a schema-first tool.started event', () => {
    const summary = getVisibleCliCommandSummary({
      id: 'event-run-verification-started',
      taskId: 'task-1',
      runId: 'run-1',
      kind: 'tool.call',
      source: 'worker',
      status: 'started',
      seq: 1,
      text: 'run_verification started',
      payloadJson: {
        runEvent: {
          runId: 'run-1',
          type: 'tool.call_started',
          data: {
            agentEventType: 'tool.started',
            iteration: 3,
          },
        },
        agentEventType: 'tool.started',
        payload: {
          toolName: 'run_verification',
          arguments: { command: 'pnpm typecheck', reason: 'type safety' },
        },
      },
      createdAt: '2026-06-05T00:00:00.000Z',
      visibility: 'visible',
    } as any);

    expect(summary).toEqual({ toolName: 'run_verification', command: 'pnpm typecheck' });
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
