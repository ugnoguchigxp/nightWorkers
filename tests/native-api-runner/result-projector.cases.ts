import { describe, expect, it } from 'vitest';
import { projectWorkerResultToNativeApiToolResult } from '../../api/services/agent-runtime/native-api-runner/native-api-tool-result-projector';
import './setup';

describe('NativeApiRunner result projection', () => {
  it('keeps native/API model-visible tool result content bounded while preserving payload', () => {
    const fullText = [
      'start',
      ...Array.from({ length: 1200 }, (_, index) => `verbose native payload ${index}`),
      'AssertionError: expected native result to be compacted',
      ...Array.from({ length: 1200 }, (_, index) => `tail native payload ${index}`),
    ].join('\n');
    const result = projectWorkerResultToNativeApiToolResult(
      {
        ok: true,
        toolName: 'read_file',
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(0).toISOString(),
        payload: { content: fullText },
      },
      { contentLimitChars: 1200 }
    );

    expect(result.content).toContain('[model-visible-payload-compressed]');
    expect(result.content).toContain('AssertionError: expected native result to be compacted');
    expect(result.content).not.toContain(fullText);
    expect(result.content.length).toBeLessThanOrEqual(1200);
    expect(result.modelVisibleSummary).toMatchObject({
      truncated: true,
      strategy: 'json_summary',
    });
    expect(result.payload).toEqual({ content: fullText });
  });

  it('projects high-volume worker tool payloads into compact model-visible views', () => {
    const todos = Array.from({ length: 25 }, (_, index) => ({
      id: `todo-${index + 1}`,
      seq: index + 1,
      title: `Todo ${index + 1}`,
      taskType: 'implementation',
      status: index === 2 ? 'running' : index < 2 ? 'passed' : 'pending',
    }));
    const todoResult = projectWorkerResultToNativeApiToolResult({
      ok: true,
      toolName: 'todo_list',
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(0).toISOString(),
      payload: {
        runId: 'run-1',
        taskId: 'task-1',
        action: 'todo_list',
        operation: 'done',
        todos,
        currentTodo: todos[2],
        nextTodo: todos[3],
        transition: { completedSeq: 2, nextCurrentSeq: 3 },
      },
    });
    const todoContent = JSON.parse(todoResult.content);

    expect(todoContent.modelVisiblePayload).toBe('compact');
    expect(todoContent.payload.todos).toBeUndefined();
    expect(todoContent.payload.counts).toMatchObject({ total: 25, pending: 22, running: 1 });
    expect(todoContent.payload.currentTodo).toMatchObject({ seq: 3, title: 'Todo 3' });
    expect(todoContent.payload.fullListAvailableVia).toBe('todo_list operation=list');
    expect(todoResult.payload).toMatchObject({ todos });

    const longSpec = `# Feature Plan\n${Array.from(
      { length: 900 },
      (_, index) => `## Section ${index}\nDetail ${index}`
    ).join('\n')}`;
    const specResult = projectWorkerResultToNativeApiToolResult({
      ok: true,
      toolName: 'read_current_specification',
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(0).toISOString(),
      payload: {
        taskId: 'task-1',
        found: true,
        title: 'Feature Plan',
        content: longSpec,
        digest: 'sha256:spec',
        assembledDesignContext: {
          taskId: 'task-1',
          generatedAt: '2026-07-06T00:00:00.000Z',
          questionnaireSessionId: 'questionnaire-1',
          summary: 'Task: Todo',
          sections: [
            {
              kind: 'api_io_contract',
              title: 'Todo API Contract',
              sourceMessageId: 'msg-api',
              digest: 'sha256:api',
              content: `POST /api/todos\n${'x'.repeat(2200)}`,
            },
          ],
          sourceMessageIds: ['msg-api'],
          omittedViews: [],
          warnings: [],
        },
        sources: {},
      },
    });
    const specContent = JSON.parse(specResult.content);

    expect(specContent.payload.content).toBeUndefined();
    expect(specContent.payload.compactContent).toContain('[specification-compact-view]');
    expect(specContent.payload.contentChars).toBe(longSpec.length);
    expect(specContent.payload.assembledDesignContext.sections[0]).toMatchObject({
      kind: 'api_io_contract',
      title: 'Todo API Contract',
      sourceMessageId: 'msg-api',
    });
    expect(specContent.payload.assembledDesignContext.questionnaireSessionId).toBe(
      'questionnaire-1'
    );
    expect(specContent.payload.assembledDesignContext.sections[0].content).toContain(
      '[section-truncated]'
    );
    expect(specContent.payload.fullViewAvailableVia).toBe("read_current_specification view='full'");
    expect(specResult.payload).toMatchObject({ content: longSpec });

    const longDiff = Array.from(
      { length: 900 },
      (_, index) => `diff --git a/file-${index}.ts b/file-${index}.ts\n@@ -1 +1 @@\n-old\n+new`
    ).join('\n');
    const diffResult = projectWorkerResultToNativeApiToolResult({
      ok: true,
      toolName: 'git_diff',
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(0).toISOString(),
      payload: {
        hasChanges: true,
        diffStat: '900 files changed',
        diff: longDiff,
      },
    });
    const diffContent = JSON.parse(diffResult.content);

    expect(diffContent.payload.diff).toBeUndefined();
    expect(diffContent.payload.compactDiff).toContain('[git-diff-compact-view]');
    expect(diffContent.payload.hunkCount).toBe(900);
    expect(diffContent.payload.fullDiffRetainedInPayload).toBe(true);
    expect(diffResult.payload).toMatchObject({ diff: longDiff });
  });
});
