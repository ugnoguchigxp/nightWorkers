import { describe, expect, it } from 'vitest';
import { buildStandardImplementationTodoList } from '../api/services/todo-runtime';

describe('standard implementation TodoList builder', () => {
  it('adds fixed first and final gates around LLM-decomposed implementation Todos', () => {
    const todos = buildStandardImplementationTodoList({
      now: new Date('2026-06-11T00:00:00.000Z'),
      todos: [
        {
          title: 'Update MCP server',
          description: 'Expose the TodoList tool.',
          taskType: 'code_edit',
          procedureId: 'code',
        },
        {
          title: 'Add tests',
          taskType: 'test',
          dependsOn: [1],
        },
      ],
    });

    expect(todos.map((todo) => todo.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(todos.map((todo) => todo.taskType)).toEqual([
      'initial_instructions',
      'context_compile',
      'code_edit',
      'test',
      'review',
      'verification',
      'knowledge_capture',
    ]);
    expect(todos[0]).toMatchObject({
      status: 'running',
      procedureId: 'contextstill.initial_instructions',
    });
    expect(todos[1]).toMatchObject({
      status: 'pending',
      procedureId: 'contextstill.context_compile',
      dependsOn: [1],
    });
    expect(todos[3]).toMatchObject({ title: 'Add tests', dependsOn: [3] });
    expect(todos.at(-3)).toMatchObject({ taskType: 'review', dependsOn: [4] });
    expect(todos.at(-2)).toMatchObject({ taskType: 'verification', dependsOn: [5] });
    expect(todos.at(-1)).toMatchObject({ taskType: 'knowledge_capture', dependsOn: [6] });
  });

  it('can create only the fixed gates when the LLM has no middle implementation Todos', () => {
    const todos = buildStandardImplementationTodoList({ todos: [], startFirst: false });

    expect(todos.map((todo) => todo.taskType)).toEqual([
      'initial_instructions',
      'context_compile',
      'review',
      'verification',
      'knowledge_capture',
    ]);
    expect(todos.every((todo) => todo.status === 'pending')).toBe(true);
  });

  it('rejects malformed LLM Todo items before writing to the database', () => {
    expect(() =>
      buildStandardImplementationTodoList({
        todos: [{ title: '   ', taskType: 'code_edit' }],
      })
    ).toThrow('Todo #1 requires title.');
    expect(() =>
      buildStandardImplementationTodoList({
        todos: [{ title: 'Implement feature', taskType: '   ' }],
      })
    ).toThrow('Todo #1 requires taskType.');
  });
});
