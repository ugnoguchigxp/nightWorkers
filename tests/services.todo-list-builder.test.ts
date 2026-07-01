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

    expect(todos.map((todo) => todo.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(todos.map((todo) => todo.taskType)).toEqual([
      'initial_instructions',
      'context_compile',
      'code_edit',
      'test',
      'review',
      'verification',
      'knowledge_capture',
      'completion_report',
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
    expect(todos.at(-4)).toMatchObject({ taskType: 'review', dependsOn: [4] });
    expect(todos.at(-3)).toMatchObject({ taskType: 'verification', dependsOn: [5] });
    expect(todos.at(-2)).toMatchObject({
      title: '知識登録を行う',
      taskType: 'knowledge_capture',
      dependsOn: [6],
    });
    expect(todos.at(-2)?.description).toContain(
      'compile_eval は完了報告直前の closeout 評価でのみ処理する'
    );
    expect(todos.at(-1)).toMatchObject({
      title: '完了報告を行う',
      taskType: 'completion_report',
      dependsOn: [7],
    });
  });

  it('can create only the fixed gates when the LLM has no middle implementation Todos', () => {
    const todos = buildStandardImplementationTodoList({ todos: [], startFirst: false });

    expect(todos.map((todo) => todo.taskType)).toEqual([
      'initial_instructions',
      'context_compile',
      'review',
      'verification',
      'knowledge_capture',
      'completion_report',
    ]);
    expect(todos.every((todo) => todo.status === 'pending')).toBe(true);
  });

  it('can omit the knowledge capture gate for temporary debugging', () => {
    const todos = buildStandardImplementationTodoList({
      todos: [{ seq: 1, title: 'Implement feature' }],
      includeKnowledgeCapture: false,
    });

    expect(todos.map((todo) => `${todo.seq}:${todo.taskType}:${todo.title}`)).toEqual([
      '1:initial_instructions:initial_instructions を実行する',
      '2:context_compile:context_compile を実行する',
      '3:implementation:Implement feature',
      '4:review:LLM コードレビューを実施する',
      '5:verification:品質ゲート verify コマンドを通す',
      '6:completion_report:完了報告を行う',
    ]);
    expect(
      todos.filter((todo) => todo.procedureId === 'contextstill.register_candidates')
    ).toHaveLength(0);
    expect(todos.at(-1)).toMatchObject({
      taskType: 'completion_report',
      dependsOn: [5],
    });
  });

  it('rejects malformed LLM Todo items before writing to the database', () => {
    expect(() =>
      buildStandardImplementationTodoList({
        todos: [{ title: '   ', taskType: 'code_edit' }],
      })
    ).toThrow('Todo #1 requires title.');
  });

  it('fills the public Todo contract with internal defaults', () => {
    const todos = buildStandardImplementationTodoList({
      todos: [{ seq: 1, title: 'Implement feature' }],
    });

    expect(todos[2]).toMatchObject({
      seq: 3,
      title: 'Implement feature',
      taskType: 'implementation',
    });
  });

  it('merges LLM-generated closeout Todos into the fixed final closeout gate', () => {
    const todos = buildStandardImplementationTodoList({
      todos: [
        { seq: 1, title: 'Implement feature' },
        { seq: 2, title: 'closeout', description: 'Summarize the completed work.' },
        { seq: 3, title: 'Add focused tests', taskType: 'test', dependsOn: [1] },
      ],
    });

    expect(todos.map((todo) => `${todo.seq}:${todo.taskType}:${todo.title}`)).toEqual([
      '1:initial_instructions:initial_instructions を実行する',
      '2:context_compile:context_compile を実行する',
      '3:implementation:Implement feature',
      '4:test:Add focused tests',
      '5:review:LLM コードレビューを実施する',
      '6:verification:品質ゲート verify コマンドを通す',
      '7:knowledge_capture:知識登録を行う',
      '8:completion_report:完了報告を行う',
    ]);
    expect(todos[3]).toMatchObject({ title: 'Add focused tests', dependsOn: [3] });
    expect(todos.filter((todo) => todo.title.toLowerCase() === 'closeout')).toHaveLength(0);
    expect(
      todos.filter((todo) => todo.procedureId === 'contextstill.register_candidates')
    ).toHaveLength(1);
    expect(todos.filter((todo) => todo.procedureId === 'final_completion_report')).toHaveLength(1);
  });

  it('merges LLM-generated broad verification Todos into the fixed quality gate', () => {
    const todos = buildStandardImplementationTodoList({
      todos: [
        { seq: 1, title: 'Implement feature' },
        { seq: 2, title: '検証コマンドを実行する', taskType: 'verification' },
        { seq: 3, title: 'Add focused tests', taskType: 'test', dependsOn: [1] },
      ],
    });

    expect(todos.map((todo) => `${todo.seq}:${todo.taskType}:${todo.title}`)).toEqual([
      '1:initial_instructions:initial_instructions を実行する',
      '2:context_compile:context_compile を実行する',
      '3:implementation:Implement feature',
      '4:test:Add focused tests',
      '5:review:LLM コードレビューを実施する',
      '6:verification:品質ゲート verify コマンドを通す',
      '7:knowledge_capture:知識登録を行う',
      '8:completion_report:完了報告を行う',
    ]);
    expect(todos[3]).toMatchObject({ title: 'Add focused tests', dependsOn: [3] });
    expect(todos.filter((todo) => todo.title === '検証コマンドを実行する')).toHaveLength(0);
    expect(todos.filter((todo) => todo.procedureId === 'quality_gate_verify')).toHaveLength(1);
  });

  it('merges LLM-generated review Todos into the fixed LLM review gate', () => {
    const todos = buildStandardImplementationTodoList({
      todos: [
        { seq: 1, title: 'Implement feature' },
        { seq: 2, title: 'LLM コードレビューを実施する' },
        { seq: 3, title: 'Add focused tests', taskType: 'test', dependsOn: [1] },
      ],
    });

    expect(todos.map((todo) => `${todo.seq}:${todo.taskType}:${todo.title}`)).toEqual([
      '1:initial_instructions:initial_instructions を実行する',
      '2:context_compile:context_compile を実行する',
      '3:implementation:Implement feature',
      '4:test:Add focused tests',
      '5:review:LLM コードレビューを実施する',
      '6:verification:品質ゲート verify コマンドを通す',
      '7:knowledge_capture:知識登録を行う',
      '8:completion_report:完了報告を行う',
    ]);
    expect(todos[3]).toMatchObject({ title: 'Add focused tests', dependsOn: [3] });
    expect(todos.filter((todo) => todo.title === 'LLM コードレビューを実施する')).toHaveLength(1);
    expect(todos.filter((todo) => todo.procedureId === 'llm_code_review')).toHaveLength(1);
  });

  it('merges LLM-echoed first gates back into the fixed first gates', () => {
    const todos = buildStandardImplementationTodoList({
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
        { seq: 3, title: 'Implement feature', taskType: 'implementation' },
      ],
    });

    expect(todos.map((todo) => `${todo.seq}:${todo.taskType}:${todo.title}`)).toEqual([
      '1:initial_instructions:initial_instructions を実行する',
      '2:context_compile:context_compile を実行する',
      '3:implementation:Implement feature',
      '4:review:LLM コードレビューを実施する',
      '5:verification:品質ゲート verify コマンドを通す',
      '6:knowledge_capture:知識登録を行う',
      '7:completion_report:完了報告を行う',
    ]);
  });
});
