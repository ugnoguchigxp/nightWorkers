import { describe, expect, it } from 'vitest';
import { planTaskIntake } from '../api/services/task-intake';

const baseInput = {
  taskTitle: 'Implement task',
  taskDescription: 'Implement the requested change',
  latestUserMessage: 'Implement the feature',
};

describe('TaskIntakePlanner', () => {
  it('requires an explicit generated plan instead of classifying user text heuristically', async () => {
    const plan = await planTaskIntake({
      ...baseInput,
      latestUserMessage: [
        '1. 調査してください',
        '2. 実装してください',
        '3. テストを追加してください',
      ].join('\n'),
    });

    expect(plan.source).toBe('fallback');
    expect(plan.warnings).toEqual(['intake_generator_required']);
    expect(plan.todos).toEqual([
      expect.objectContaining({
        seq: 1,
        taskType: 'investigation',
        status: 'needs_human',
      }),
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
      taskType: 'investigation',
      status: 'needs_human',
    });
  });

  it('does not infer taskType from generated todo text when taskType is missing', async () => {
    const plan = await planTaskIntake(baseInput, {
      generatePlan: async () => ({
        todos: [
          {
            title: 'テストを追加してください',
            description: 'Vitest coverage should improve',
          },
        ],
      }),
    });

    expect(plan.source).toBe('llm');
    expect(plan.todos).toEqual([
      expect.objectContaining({
        taskType: 'investigation',
        status: 'needs_human',
        statusReason: 'Generated todo is missing an explicit taskType.',
      }),
    ]);
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

  it('does not special-case fixed phrases as an ambiguous request classifier', async () => {
    const plan = await planTaskIntake({
      ...baseInput,
      latestUserMessage: 'よろしく',
    });

    expect(plan.source).toBe('fallback');
    expect(plan.warnings).toContain('intake_generator_required');
    expect(plan.todos).toHaveLength(1);
    expect(plan.todos[0]).toMatchObject({
      status: 'needs_human',
      taskType: 'investigation',
    });
  });
});
