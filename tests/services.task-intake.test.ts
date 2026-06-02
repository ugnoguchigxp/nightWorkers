import { describe, expect, it } from 'vitest';
import { planTaskIntake } from '../api/services/task-intake';

const baseInput = {
  taskTitle: 'Implement task',
  taskDescription: 'Implement the requested change',
  latestUserMessage: 'Implement the feature',
};

describe('TaskIntakePlanner', () => {
  it('creates ordered heuristic todos from a numbered request', async () => {
    const plan = await planTaskIntake({
      ...baseInput,
      latestUserMessage: [
        '1. 調査してください',
        '2. 実装してください',
        '3. テストを追加してください',
      ].join('\n'),
    });

    expect(plan.source).toBe('heuristic');
    expect(plan.todos).toHaveLength(3);
    expect(plan.todos.map((todo) => todo.seq)).toEqual([1, 2, 3]);
    expect(plan.todos.map((todo) => todo.dependsOn)).toEqual([[], [1], [2]]);
    expect(plan.todos.map((todo) => todo.taskType)).toEqual([
      'investigation',
      'code_change',
      'test_change',
    ]);
  });

  it('normalizes valid generated todo plans', async () => {
    const plan = await planTaskIntake(baseInput, {
      generatePlan: async () => ({
        todos: [
          {
            title: 'Write docs',
            description: 'Update README',
            taskType: 'documentation',
          },
          {
            title: 'Verify behavior',
            taskType: 'verification',
            dependsOn: [1, 99],
          },
        ],
      }),
    });

    expect(plan.source).toBe('llm');
    expect(plan.warnings).toEqual([]);
    expect(plan.todos[0]).toMatchObject({
      seq: 1,
      title: 'Write docs',
      taskType: 'documentation',
      status: 'pending',
      dependsOn: [],
    });
    expect(plan.todos[1]).toMatchObject({
      seq: 2,
      taskType: 'verification',
      dependsOn: [1],
    });
  });

  it('falls back to a single todo when generated output is malformed', async () => {
    const plan = await planTaskIntake(baseInput, {
      generatePlan: async () => 'not-json',
    });

    expect(plan.source).toBe('fallback');
    expect(plan.warnings).toEqual(['intake_generator_invalid']);
    expect(plan.todos).toHaveLength(1);
    expect(plan.todos[0]).toMatchObject({
      seq: 1,
      title: 'Implement the feature',
      status: 'pending',
    });
  });

  it('compresses generated todo plans to the maximum todo count', async () => {
    const plan = await planTaskIntake(
      {
        ...baseInput,
        maxTodos: 3,
      },
      {
        generatePlan: async () => ({
          todos: Array.from({ length: 5 }, (_, index) => ({
            title: `Todo ${index + 1}`,
            taskType: 'code_change',
          })),
        }),
      }
    );

    expect(plan.todos).toHaveLength(3);
    expect(plan.warnings).toContain('todo_count_compressed');
  });

  it('marks ambiguous requests as needing human clarification', async () => {
    const plan = await planTaskIntake({
      ...baseInput,
      latestUserMessage: 'よろしく',
    });

    expect(plan.source).toBe('fallback');
    expect(plan.warnings).toContain('ambiguous_request');
    expect(plan.todos).toHaveLength(1);
    expect(plan.todos[0]).toMatchObject({
      status: 'needs_human',
      taskType: 'investigation',
    });
  });
});
