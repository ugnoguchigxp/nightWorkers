import { describe, expect, it } from 'vitest';
import {
  appendTodoSummaryToFinalReport,
  buildSkippedTodoGate,
  evaluateTodoCompletionGate,
} from '../api/services/todo-runtime';

const todo = {
  id: 'todo-1',
  seq: 1,
  title: 'Implement the change',
  taskType: 'code_change',
  status: 'running',
  procedureId: 'code-change',
};

describe('todo runtime gate', () => {
  it('passes a todo when runtime and outcome are both successful', () => {
    const result = evaluateTodoCompletionGate({
      todo,
      outcomeStatus: 'completed',
      runtimeResult: {
        terminalState: 'completed',
        stoppedBy: 'decision',
        riskLevel: 'low',
        summary: 'done',
        finalReport: 'done',
        diffPatch: 'diff --git a/a b/a',
      },
    });

    expect(result.status).toBe('passed');
    expect(result.passed).toBe(true);
    expect(result.evidence.diffBytes).toBeGreaterThan(0);
  });

  it('requires human attention for policy stopped todos', () => {
    const result = evaluateTodoCompletionGate({
      todo,
      outcomeStatus: 'needs_human',
      runtimeResult: {
        terminalState: 'needs_human',
        stoppedBy: 'policy',
        riskLevel: 'high',
        summary: 'blocked',
        finalReport: 'blocked',
      },
    });

    expect(result.status).toBe('needs_human');
    expect(result.passed).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: 'stop_reason', passed: false })
    );
  });

  it('builds skipped gate results for dependent todos', () => {
    const result = buildSkippedTodoGate({
      todo: { ...todo, id: 'todo-2', seq: 2 },
      reason: 'Previous todo did not pass.',
      runtimeResult: {
        terminalState: 'failed',
        stoppedBy: 'tool_failure',
        riskLevel: 'high',
        summary: 'failed',
        finalReport: 'failed',
      },
    });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('Previous todo did not pass.');
  });
});

describe('todo final report summary', () => {
  it('appends ordered todo status lines', () => {
    expect(
      appendTodoSummaryToFinalReport({
        finalReport: 'Finished',
        todos: [
          { ...todo, status: 'passed' },
          { ...todo, id: 'todo-2', seq: 2, title: 'Verify', status: 'skipped' },
        ],
      })
    ).toContain('#2 skipped: Verify');
  });
});
