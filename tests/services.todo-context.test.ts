import { describe, expect, it } from 'vitest';
import { buildTodoContextSnapshot } from '../api/services/todo-context';

describe('Todo context snapshots', () => {
  it('captures todo, selected procedure, run context, and selected knowledge ids', () => {
    const snapshot = buildTodoContextSnapshot({
      todo: {
        id: 'todo-1',
        seq: 1,
        title: 'Implement feature',
        description: 'Feature details',
        taskType: 'code_change',
        procedureId: 'code-change',
        procedureSnapshot: {
          source: 'builtin',
          id: 'code-change',
          title: 'Code Change',
          version: 1,
          digest: 'sha256:procedure',
          sections: {
            'Use When': 'use',
            Workflow: 'flow',
            'Completion Gate': 'gate',
            'Verification Strategy': 'verify',
            'Report Contract': 'report',
          },
        },
      },
      runContext: {
        compiledPrompt: 'compiled',
        source: 'context-still',
        degraded: false,
        request: {
          repositoryPath: '/repo',
          taskTitle: 'Task',
          taskDescriptionDigest: 'digest',
        },
        result: {
          digest: 'run-context-digest',
          charCount: 8,
          includedMemoryRefs: [
            { kind: 'candidate', candidateId: 'candidate-1' },
            { kind: 'memory', externalId: 'memory-1' },
            { kind: 'candidate', candidateId: 'candidate-1' },
          ],
        },
      },
    });

    expect(snapshot).toMatchObject({
      version: 1,
      todo: {
        id: 'todo-1',
        seq: 1,
        title: 'Implement feature',
        taskType: 'code_change',
      },
      selectedProcedure: {
        id: 'code-change',
        digest: 'sha256:procedure',
      },
      runContext: {
        source: 'context-still',
        digest: 'run-context-digest',
        selectedKnowledgeIds: ['candidate-1', 'memory-1'],
      },
      previousTodoSummaries: [],
    });
  });
});
