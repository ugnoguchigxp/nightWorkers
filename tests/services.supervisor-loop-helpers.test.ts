import { describe, expect, it } from 'vitest';
import {
  getRedundantTodoReplaceGap,
  getTodoDoneEvidenceGap,
} from '../api/services/supervisor/supervisor-loop-helpers';

describe('supervisor loop Todo helpers', () => {
  it('allows the first TodoList replace for a run', () => {
    expect(
      getRedundantTodoReplaceGap({
        currentTodos: [],
        toolResults: [],
      })
    ).toBeNull();
  });

  it('rejects repeated TodoList replace even after worker progress', () => {
    const gap = getRedundantTodoReplaceGap({
      currentTodos: [{ seq: 3, title: '実装する', status: 'running' }],
      toolResults: [
        {
          step: 1,
          toolName: 'todo_list',
          ok: true,
          arguments: { operation: 'replace' },
          summary: 'tool=todo_list operation=replace status=ok',
        },
        {
          step: 2,
          toolName: 'read_file',
          ok: true,
          arguments: { filePath: 'src/app.ts' },
          summary: 'tool=read_file status=ok',
        },
      ],
    });

    expect(gap).toContain('Execute the current Todo');
  });

  it('rejects TodoList replace after all items are already closed', () => {
    const gap = getRedundantTodoReplaceGap({
      currentTodos: [{ seq: 1, title: '実装する', status: 'passed' }],
      toolResults: [
        {
          step: 1,
          toolName: 'todo_list',
          ok: true,
          arguments: { operation: 'replace' },
          summary: 'tool=todo_list operation=replace status=ok',
        },
      ],
    });

    expect(gap).toContain('Finalize the run');
  });

  it('requires implementation evidence before an implementation Todo can be done', () => {
    const todo = {
      seq: 3,
      title: 'Todo UI を実装する',
      taskType: 'implementation',
      procedureId: null,
    };

    expect(
      getTodoDoneEvidenceGap({
        todo,
        toolResults: [
          {
            step: 1,
            toolName: 'todo_list',
            ok: true,
            arguments: { operation: 'replace' },
            summary: 'tool=todo_list operation=replace status=ok',
          },
          {
            step: 2,
            toolName: 'read_file',
            ok: true,
            arguments: { filePath: 'web/src/App.tsx' },
            summary: 'tool=read_file status=ok',
          },
        ],
      })
    ).toContain('implementation evidence');

    expect(
      getTodoDoneEvidenceGap({
        todo,
        toolResults: [
          {
            step: 1,
            toolName: 'todo_list',
            ok: true,
            arguments: { operation: 'replace' },
            summary: 'tool=todo_list operation=replace status=ok',
          },
          {
            step: 2,
            toolName: 'apply_patch',
            ok: true,
            arguments: { patchContent: '*** Begin Patch' },
            summary: 'tool=apply_patch status=ok',
          },
        ],
      })
    ).toBeNull();
  });

  it('requires verification evidence after the latest Todo transition', () => {
    const todo = {
      seq: 6,
      title: '品質ゲート verify を実施する',
      taskType: 'verification',
      procedureId: 'quality_gate_verify',
    };

    expect(
      getTodoDoneEvidenceGap({
        todo,
        toolResults: [
          {
            step: 1,
            toolName: 'run_verification',
            ok: true,
            arguments: { command: 'bun run typecheck' },
            summary: 'tool=run_verification status=ok',
          },
          {
            step: 2,
            toolName: 'todo_list',
            ok: true,
            arguments: { operation: 'done' },
            summary: 'tool=todo_list operation=done status=ok',
          },
        ],
      })
    ).toContain('verification evidence');

    expect(
      getTodoDoneEvidenceGap({
        todo,
        toolResults: [
          {
            step: 1,
            toolName: 'todo_list',
            ok: true,
            arguments: { operation: 'done' },
            summary: 'tool=todo_list operation=done status=ok',
          },
          {
            step: 2,
            toolName: 'run_verification',
            ok: true,
            arguments: { command: 'bun run typecheck' },
            summary: 'tool=run_verification status=ok',
          },
        ],
      })
    ).toBeNull();
  });
});
