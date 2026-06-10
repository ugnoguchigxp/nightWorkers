import { describe, expect, it } from 'vitest';
import {
  buildVisibleEditDiffSummary,
  getActivityCode,
} from '../../src/modules/nightworkers/components/ThreadTimeline';
import { getAgentEditSummary } from '../../src/modules/nightworkers/components/ThreadTimelineAgentCards';
import { getVisibleCliCommandSummary } from '../../src/modules/nightworkers/components/ThreadTimelineNormalTranscript';

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

  it('builds a visible command summary from Codex command_execution activity', () => {
    const summary = getVisibleCliCommandSummary({
      id: 'activity-codex-command',
      taskId: 'task-1',
      kind: 'tool.call',
      source: 'worker',
      seq: 1,
      text: 'command_execution | pnpm test | in_progress',
      payloadJson: {
        payload: {
          provider: 'codex',
          toolName: 'command_execution',
          command: 'pnpm test',
          status: 'in_progress',
          aggregatedOutput: 'running tests',
        },
      },
    } as any);

    expect(summary).toEqual({
      toolName: 'command_execution',
      command: 'pnpm test',
      output: 'running tests',
    });
  });

  it('shows changed file paths without rendering a fake diff when no diff is available', () => {
    const event = {
      id: 'activity-file-change',
      taskId: 'task-1',
      kind: 'file.diff',
      source: 'worker',
      seq: 1,
      text: 'Changed files (1)\nsrc/fizzbuzz.ts',
      payloadJson: {
        payload: {
          provider: 'codex',
          changedFiles: ['src/fizzbuzz.ts'],
        },
      },
    } as any;

    expect(buildVisibleEditDiffSummary(event)).toEqual([
      { path: 'src/fizzbuzz.ts', added: 0, deleted: 0, changedOnly: true },
    ]);
    expect(getActivityCode(event)).toBe('');
  });

  it('keeps rendering collected git diff when it is available', () => {
    const diff = [
      'diff --git a/src/fizzbuzz.ts b/src/fizzbuzz.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/fizzbuzz.ts',
      '@@ -0,0 +1 @@',
      '+export const fizzbuzz = true;',
    ].join('\n');
    const event = {
      id: 'activity-file-diff',
      taskId: 'task-1',
      kind: 'file.diff',
      source: 'worker',
      seq: 1,
      payloadJson: {
        payload: {
          provider: 'codex',
          changedFiles: ['src/fizzbuzz.ts'],
          diff,
        },
      },
    } as any;

    expect(buildVisibleEditDiffSummary(event)).toEqual([
      { path: 'src/fizzbuzz.ts', added: 1, deleted: 0 },
    ]);
    expect(getActivityCode(event)).toBe(diff);
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
});
