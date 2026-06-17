import { describe, expect, it } from 'vitest';
import {
  attachNativeToolEvidence,
  attributeToolResultToTodo,
  buildNativeToolEvidence,
  buildProgressContext,
  getRedundantTodoListGap,
  getRedundantTodoReplaceGap,
  getTodoDoneEvidenceGap,
  normalizeTodoListInput,
  selectToolResultsForPrompt,
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

  it('builds typed recovery evidence for patch mismatch failures', () => {
    const evidence = buildNativeToolEvidence({
      step: 7,
      toolName: 'apply_patch',
      ok: false,
      arguments: {
        patchContent:
          'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new',
      },
      summary: 'tool=apply_patch status=failed',
      error: {
        code: 'PATCH_DOES_NOT_APPLY',
        message: 'Patch did not match the current file content.',
      },
    });

    expect(evidence).toMatchObject({
      toolName: 'apply_patch',
      failureKind: 'patch_mismatch',
      targetPath: 'src/app.ts',
      recoveryDirective: {
        kind: 'read_target_once',
        targetPath: 'src/app.ts',
        maxRepeats: 1,
      },
      criticalEvidence: {
        kind: 'mutation_failure',
      },
    });
    expect(evidence?.doNotRepeat?.reason).toContain('同じ patch');
  });

  it('adds recoveryDirective and criticalEvidence to progress context from native evidence', () => {
    const context = buildProgressContext({
      currentJobType: 'major_code_edit',
      workspaceSnapshot: {
        isEmpty: false,
        topLevelDirs: ['src'],
        topLevelFiles: ['package.json'],
        truncated: false,
      },
      currentTodos: [
        {
          seq: 2,
          title: 'app を修正する',
          taskType: 'implementation',
          status: 'running',
          procedureId: null,
        },
      ],
      toolResults: [
        attachNativeToolEvidence({
          step: 3,
          toolName: 'apply_patch',
          ok: false,
          arguments: {
            patchContent:
              'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new',
          },
          summary: 'tool=apply_patch status=failed',
          error: {
            code: 'PATCH_DOES_NOT_APPLY',
            message: 'Patch did not match the current file content.',
          },
        }),
      ],
    });

    expect(context.recoveryDirective).toMatchObject({
      kind: 'read_target_once',
      targetPath: 'src/app.ts',
    });
    expect(context.criticalEvidence[0]).toMatchObject({
      failureKind: 'patch_mismatch',
      targetPath: 'src/app.ts',
    });
    expect(context.nextConcreteAction).toContain('src/app.ts');
    expect(context.nextConcreteAction).toContain('一度だけ読み直し');
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

  it('rejects TodoList list as a native Supervisor progress operation immediately', () => {
    const gap = getRedundantTodoListGap({
      currentTodo: {
        seq: 4,
        title: 'Todo List 画面の UI コンポーネントを実装する',
        taskType: 'implementation',
        status: 'running',
      },
      toolResults: [],
    });

    expect(gap).toContain('TodoList も作業状態も変更しません');
    expect(gap).toContain('apply_patch / replace_content');
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

  it('attributes mutation evidence produced during inspection to the next mutation Todo', () => {
    const attributed = attributeToolResultToTodo(
      {
        step: 2,
        toolName: 'import_project',
        ok: true,
        arguments: { source: 'starter', stack: 'hono' },
        summary: 'tool=import_project status=ok',
      },
      [
        {
          id: 'todo-3',
          seq: 3,
          title: '仕様と既存構成を確認する',
          taskType: 'inspection',
          status: 'running',
        },
        {
          id: 'todo-4',
          seq: 4,
          title: '対象画面の実装準備を行う',
          taskType: 'scaffold',
          status: 'pending',
        },
      ]
    );

    expect(attributed).toMatchObject({
      observedTodoSeq: 3,
      attributedTodoSeq: 4,
    });
    expect(
      getTodoDoneEvidenceGap({
        todo: {
          id: 'todo-4',
          seq: 4,
          title: '対象画面の実装準備を行う',
          taskType: 'scaffold',
        },
        toolResults: [
          attributed,
          {
            step: 3,
            toolName: 'todo_list',
            ok: true,
            arguments: { operation: 'done' },
            summary: 'tool=todo_list operation=done status=ok\nseq=3 todoStatus=passed',
          },
        ],
      })
    ).toBeNull();
  });

  it('keeps todo done evidence gaps recoverable without asking the user', () => {
    const result = attachNativeToolEvidence({
      step: 4,
      toolName: 'todo_list',
      ok: false,
      arguments: { operation: 'done' },
      summary:
        'tool=todo_list operation=done status=failed\nerror=Todo #4 needs implementation evidence.',
      error: 'Todo #4 needs implementation evidence.',
    });

    expect(result.evidence?.recoveryDirective).toMatchObject({
      kind: 'advance_current_todo',
    });
    expect(result.evidence?.doNotRepeat?.reason).toContain('done を繰り返さない');
  });

  it('allows read-only evidence to complete an inspection Todo', () => {
    const todo = {
      seq: 3,
      title: '仕様と既存構成を確認する',
      taskType: 'inspection',
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
            arguments: { filePath: 'web/src/routes/root-route.tsx' },
            summary: 'tool=read_file status=ok',
          },
        ],
      })
    ).toBeNull();
  });

  it('does not treat a failed Todo done attempt as the latest evidence boundary', () => {
    const gap = getTodoDoneEvidenceGap({
      todo: {
        seq: 3,
        title: '仕様と既存構成を確認する',
        taskType: 'inspection',
      },
      toolResults: [
        {
          step: 1,
          toolName: 'todo_list',
          ok: true,
          arguments: { operation: 'start' },
          summary: 'tool=todo_list operation=start status=ok',
        },
        {
          step: 2,
          toolName: 'read_current_specification',
          ok: true,
          arguments: {},
          summary: 'tool=read_current_specification status=ok cached=true',
        },
        attachNativeToolEvidence({
          step: 3,
          toolName: 'todo_list',
          ok: false,
          arguments: { operation: 'done' },
          summary:
            'Todo #3「仕様と既存構成を確認する」は inspection evidence なしでは done にできません。',
        }),
      ],
    });

    expect(gap).toBeNull();
  });

  it('clears stale Todo evidence-gap recovery after the current Todo has evidence', () => {
    const context = buildProgressContext({
      currentJobType: 'major_code_edit',
      workspaceSnapshot: {
        isEmpty: false,
        topLevelDirs: ['src'],
        topLevelFiles: ['package.json'],
        truncated: false,
      },
      currentTodos: [
        {
          seq: 3,
          title: '仕様と既存構成を確認する',
          taskType: 'inspection',
          status: 'running',
          procedureId: null,
        },
      ],
      toolResults: [
        {
          step: 1,
          toolName: 'todo_list',
          ok: true,
          arguments: { operation: 'start' },
          summary: 'tool=todo_list operation=start status=ok',
        },
        attachNativeToolEvidence({
          step: 2,
          toolName: 'todo_list',
          ok: false,
          arguments: { operation: 'done' },
          summary:
            'Todo #3「仕様と既存構成を確認する」は inspection evidence なしでは done にできません。',
        }),
        {
          step: 3,
          toolName: 'read_current_specification',
          ok: true,
          arguments: {},
          summary: 'tool=read_current_specification status=ok cached=true',
        },
      ],
    });

    expect(context.recoveryDirective).toBeNull();
    expect(context.nextConcreteAction).toContain('inspection evidence は揃っている');
    expect(context.nextConcreteAction).toContain('todo_list operation=done');
    expect(context.nextConcreteAction).toContain('read_current_specification');
    expect(context.doNotRepeat).toContainEqual(
      expect.stringContaining('read_current_specification を繰り返さず')
    );
  });

  it('preserves explicit Todo task metadata from replace input', () => {
    expect(
      normalizeTodoListInput({
        todos: [
          {
            seq: 1,
            title: '仕様と既存構成を確認する',
            taskType: 'inspection',
            procedureId: 'investigation',
            dependsOn: [1, 'spec'],
          },
        ],
      })
    ).toEqual([
      {
        seq: 1,
        title: '仕様と既存構成を確認する',
        description: null,
        taskType: 'inspection',
        procedureId: 'investigation',
        dependsOn: [1, 'spec'],
      },
    ]);
  });

  it('accepts product-owned fixed gate taskTypes in native replace input', () => {
    expect(
      normalizeTodoListInput({
        todos: [
          {
            seq: 1,
            title: 'initial_instructions を実行する',
            taskType: 'initial_instructions',
            procedureId: 'contextstill.initial_instructions',
          },
          {
            seq: 2,
            title: 'context_compile を実行する',
            taskType: 'context_compile',
            procedureId: 'contextstill.context_compile',
          },
          {
            seq: 3,
            title: '知識登録を行う',
            taskType: 'knowledge_capture',
            procedureId: 'contextstill.register_candidates',
          },
          {
            seq: 4,
            title: '完了報告を行う',
            taskType: 'completion_report',
            procedureId: 'final_completion_report',
          },
        ],
      }).map((todo) => todo.taskType)
    ).toEqual([
      'initial_instructions',
      'context_compile',
      'knowledge_capture',
      'completion_report',
    ]);
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

  it('directs implementation Todos toward mutation tools after enough read-only evidence', () => {
    const context = buildProgressContext({
      currentJobType: 'major_code_edit',
      workspaceSnapshot: {
        isEmpty: false,
        topLevelDirs: ['web'],
        topLevelFiles: ['package.json'],
        truncated: false,
      },
      currentTodos: [
        {
          seq: 4,
          title: 'Todo List 画面の UI コンポーネントを実装する',
          taskType: 'implementation',
          status: 'running',
          procedureId: null,
        },
      ],
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
          toolName: 'read_file',
          ok: true,
          arguments: { filePath: 'web/src/routes/root-route.tsx' },
          summary: 'tool=read_file status=ok',
        },
        {
          step: 3,
          toolName: 'list_dir',
          ok: true,
          arguments: { relativePath: 'web/src/routes' },
          summary: 'tool=list_dir status=ok',
        },
        {
          step: 4,
          toolName: 'read_file',
          ok: true,
          arguments: { filePath: 'web/src/views/home-view.tsx' },
          summary: 'tool=read_file status=ok',
        },
      ],
    });

    expect(context.nextConcreteAction).toContain(
      'read_current_specification / read_file / list_dir'
    );
    expect(context.nextConcreteAction).toContain('apply_patch / replace_content');
    expect(context.doNotRepeat).toContainEqual(
      expect.stringContaining('read-only evidence が 3 件')
    );
  });

  it('directs scaffold Todos toward mutation tools after enough read-only evidence', () => {
    const context = buildProgressContext({
      currentJobType: 'major_code_edit',
      workspaceSnapshot: {
        isEmpty: false,
        topLevelDirs: ['web'],
        topLevelFiles: ['package.json'],
        truncated: false,
      },
      currentTodos: [
        {
          seq: 4,
          title: 'Todo List 用の型定義とストアを作成する',
          taskType: 'scaffold',
          status: 'running',
          procedureId: null,
        },
      ],
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
          toolName: 'read_file',
          ok: true,
          arguments: { filePath: 'web/src/App.tsx' },
          summary: 'tool=read_file status=ok',
        },
        {
          step: 3,
          toolName: 'read_file',
          ok: true,
          arguments: { filePath: 'web/src/router.tsx' },
          summary: 'tool=read_file status=ok',
        },
        {
          step: 4,
          toolName: 'read_file',
          ok: true,
          arguments: { filePath: 'web/src/routes/root-route.tsx' },
          summary: 'tool=read_file status=ok',
        },
      ],
    });

    expect(context.nextConcreteAction).toContain('apply_patch / replace_content');
    expect(context.doNotRepeat).toContainEqual(expect.stringContaining('scaffold Todo'));
  });

  it('summarizes repeated missing paths and repeated reads in progress context', () => {
    const context = buildProgressContext({
      currentJobType: 'major_code_edit',
      workspaceSnapshot: {
        isEmpty: false,
        topLevelDirs: ['web'],
        topLevelFiles: ['package.json'],
        truncated: false,
      },
      currentTodos: [
        {
          seq: 4,
          title: 'Todo List 用の型定義とストアを作成する',
          taskType: 'scaffold',
          status: 'running',
          procedureId: null,
        },
      ],
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
          toolName: 'read_file',
          ok: false,
          arguments: { filePath: 'web/src/routes/_authenticated/dashboard/route.tsx' },
          summary: 'tool=read_file status=failed',
        },
        {
          step: 3,
          toolName: 'read_file',
          ok: false,
          arguments: { filePath: 'web/src/routes/_authenticated/dashboard/route.tsx' },
          summary: 'tool=read_file status=failed',
        },
        {
          step: 4,
          toolName: 'read_file',
          ok: true,
          arguments: { filePath: 'web/src/routes/root-route.tsx' },
          summary: 'tool=read_file status=ok',
        },
        {
          step: 5,
          toolName: 'read_file',
          ok: true,
          arguments: { filePath: 'web/src/routes/root-route.tsx', fresh: true },
          summary: 'tool=read_file status=ok',
        },
      ],
    });

    expect(context.nextConcreteAction).toContain(
      'web/src/routes/_authenticated/dashboard/route.tsx'
    );
    expect(context.doNotRepeat).toContainEqual(expect.stringContaining('(2 回)'));
    expect(context.doNotRepeat).toContainEqual(
      expect.stringContaining('web/src/routes/root-route.tsx')
    );
  });

  it('keeps recovery-critical tool evidence beyond the simple tail window', () => {
    const results = Array.from({ length: 12 }, (_, index) => ({
      step: index + 1,
      toolName: 'read_file',
      ok: true,
      arguments: { filePath: `src/file-${index}.ts` },
      summary: 'tool=read_file status=ok',
    }));
    results[1] = {
      step: 2,
      toolName: 'list_dir',
      ok: true,
      arguments: { relativePath: 'web/src/routes' },
      summary: 'tool=list_dir status=ok',
      payload: { files: ['web/src/routes/root-route.tsx'], dirs: [], truncated: false },
    };
    results[2] = {
      step: 3,
      toolName: 'read_file',
      ok: false,
      arguments: { filePath: 'web/src/routes/_authenticated/dashboard/route.tsx' },
      summary: 'tool=read_file status=failed',
    };

    const selected = selectToolResultsForPrompt(results);

    expect(selected.map((item) => item.step)).toContain(2);
    expect(selected.map((item) => item.step)).toContain(3);
    expect(selected.at(-1)?.step).toBe(12);
  });

  it('directs mutation failure recovery through a targeted read_file', () => {
    const context = buildProgressContext({
      currentJobType: 'major_code_edit',
      workspaceSnapshot: {
        isEmpty: false,
        topLevelDirs: ['web'],
        topLevelFiles: ['package.json'],
        truncated: false,
      },
      currentTodos: [
        {
          seq: 4,
          title: 'Todo List 画面の UI コンポーネントを実装する',
          taskType: 'implementation',
          status: 'running',
          procedureId: null,
        },
      ],
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
          toolName: 'read_file',
          ok: true,
          arguments: { filePath: 'web/src/views/home-view.tsx' },
          summary: 'tool=read_file status=ok',
        },
        {
          step: 3,
          toolName: 'apply_patch',
          ok: false,
          arguments: {
            patchContent:
              'diff --git a/web/src/views/home-view.tsx b/web/src/views/home-view.tsx\n--- a/web/src/views/home-view.tsx\n+++ b/web/src/views/home-view.tsx\n@@ -1 +1 @@\n-old\n+new',
          },
          summary: 'tool=apply_patch status=failed',
        },
      ],
    });

    expect(context.nextConcreteAction).toContain('apply_patch が失敗');
    expect(context.nextConcreteAction).toContain('web/src/views/home-view.tsx');
    expect(context.nextConcreteAction).toContain('read_file');
    expect(context.doNotRepeat).toContainEqual(
      expect.stringContaining('同じ patch/needle を繰り返さず')
    );
  });

  it('returns to mutation guidance after a failed mutation target is reread', () => {
    const context = buildProgressContext({
      currentJobType: 'major_code_edit',
      workspaceSnapshot: {
        isEmpty: false,
        topLevelDirs: ['web'],
        topLevelFiles: ['package.json'],
        truncated: false,
      },
      currentTodos: [
        {
          seq: 4,
          title: 'Todo List 画面の UI コンポーネントを実装する',
          taskType: 'implementation',
          status: 'running',
          procedureId: null,
        },
      ],
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
          toolName: 'apply_patch',
          ok: false,
          arguments: {
            patchContent:
              'diff --git a/web/src/views/home-view.tsx b/web/src/views/home-view.tsx\n--- a/web/src/views/home-view.tsx\n+++ b/web/src/views/home-view.tsx\n@@ -1 +1 @@\n-old\n+new',
          },
          summary: 'tool=apply_patch status=failed',
        },
        {
          step: 3,
          toolName: 'read_file',
          ok: true,
          arguments: { filePath: 'web/src/views/home-view.tsx' },
          summary: 'tool=read_file status=ok',
        },
        {
          step: 4,
          toolName: 'list_dir',
          ok: true,
          arguments: { relativePath: 'web/src' },
          summary: 'tool=list_dir status=ok',
        },
        {
          step: 5,
          toolName: 'read_file',
          ok: true,
          arguments: { filePath: 'web/src/routes.tsx' },
          summary: 'tool=read_file status=ok',
        },
      ],
    });

    expect(context.nextConcreteAction).toContain('apply_patch / replace_content');
    expect(context.nextConcreteAction).not.toContain('が失敗');
  });
});
