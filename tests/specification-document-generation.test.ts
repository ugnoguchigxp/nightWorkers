import { describe, expect, it } from 'vitest';
import {
  buildSpecificationDocumentContext,
  sanitizeSpecificationTargetNaming,
} from '../api/modules/specification/specification-document-renderer';
import {
  buildSpecificationDocumentSystemPrompt,
  buildSpecificationDocumentUserPrompt,
} from '../api/services/structured-generation/prompts/design-questionnaire';

describe('Specification document generation', () => {
  it('requires concise implementation-plan sections in the generation prompt', () => {
    const systemPrompt = buildSpecificationDocumentSystemPrompt();

    expect(systemPrompt).toContain('## タスク分類');
    expect(systemPrompt).toContain('## 実装計画');
    expect(systemPrompt).toContain('## 契約');
    expect(systemPrompt).toContain('## 検証計画');
    expect(systemPrompt).toContain('## 完了条件');
    expect(systemPrompt).toContain('必要な判断だけを短く');
    expect(systemPrompt).toContain('同じ内容の重複を避け');
    expect(systemPrompt).toContain('Questionnaire Decisions を採用判断の正');
    expect(systemPrompt).toContain('path/method/state/schema/error');
    expect(systemPrompt).toContain('採用 section 名');
    expect(systemPrompt).toContain('サンプルデータ');
    expect(systemPrompt).toContain('追加見出しは、重複になる場合は作らない');
    expect(systemPrompt).toContain('DB 変更が必要な場合');
    expect(systemPrompt).not.toContain('NightWorkers の Specification writer');
    expect(systemPrompt).toContain('NightWorkers / NightWorker を実装対象名として使わない');
    expect(systemPrompt).toContain('実装対象は Task と Target Project Context');
  });

  it('adds implementation plan guidance for DB/API/UI/test spanning tasks', () => {
    const context = buildSpecificationDocumentContext({
      task: {
        title: 'todo list 本体を実装する',
        description: 'Hono + React + SQLite 構成に todo list 本体を追加する。',
        objective: 'task の作成、編集、削除、完了切り替えを実装する。',
      },
      session: null,
      workspace: {
        blueprintArtifacts: [{ id: 'blueprint-1' }],
        dataModelArtifacts: [{ id: 'data-model-1' }],
        dedicatedViewArtifacts: [
          {
            id: 'api_io_contract-api-contract-message',
            kind: 'api_io_contract',
            title: 'Todo API Contract',
            sourceMessageId: 'api-contract-message',
            createdAt: '2026-07-05T00:00:00.000Z',
          },
          {
            id: 'zod_schema_design-zod-schema-message',
            kind: 'zod_schema_design',
            title: 'Todo Zod Schema',
            sourceMessageId: 'zod-schema-message',
            createdAt: '2026-07-05T00:00:00.000Z',
          },
          {
            id: 'user_flow-user-flow-message',
            kind: 'user_flow',
            title: 'Todo User Flow',
            sourceMessageId: 'user-flow-message',
            createdAt: '2026-07-05T00:00:00.000Z',
          },
        ],
        decisionReviews: [
          {
            id: 'decision-review-message',
            kind: 'decision_review',
            title: 'Todo Decision Review',
            sourceMessageId: 'decision-review-message',
            createdAt: '2026-07-05T00:00:00.000Z',
          },
        ],
        featurePlanArtifacts: [],
        questionnaireSessions: [],
        implementationReferences: [],
      } as never,
      messages: [
        {
          id: 'blueprint-message',
          metadataJson: {
            intent: 'mock_blueprint',
            mockBlueprint: {
              name: 'Todo List 本体',
              screens: [
                {
                  name: 'Todo List',
                  path: '/todo',
                  componentName: 'Page',
                  sections: [
                    {
                      name: 'Task List',
                      componentName: 'DataTableSection',
                      reason: 'task の一覧と行単位操作を中核にするため。',
                      props: {
                        title: 'task 一覧',
                        dataset: 'table',
                        sample: [
                          { title: '週次の買い出しをまとめる', status: 'todo' },
                          { title: '請求書の確認を終える', status: 'done' },
                        ],
                        columns: [{ title: 'Task' }, { title: 'Status' }, { title: 'Updated' }],
                      },
                    },
                    {
                      name: 'Task Form',
                      componentName: 'FormSection',
                      props: {
                        title: 'task を追加・編集する',
                        dataset: 'form',
                        items: [{ label: 'task 名' }, { label: '状態' }, { label: 'メモ' }],
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
        {
          id: 'data-model-message',
          metadataJson: {
            artifactKind: 'plan_mode_dedicated_view',
            view: 'data_model',
            dataModelArtifact: {
              ddl: 'CREATE TABLE todo_tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL);',
            },
          },
        },
        {
          id: 'api-contract-message',
          metadataJson: {
            intent: 'plan_mode_dedicated_view',
            artifactKind: 'plan_mode_api_contract',
            view: 'api_io_contract',
            title: 'Todo API Contract',
            apiContract: {
              artifactKind: 'plan_mode_api_contract',
              view: 'api_io_contract',
              title: 'Todo API Contract',
              summary: 'todo task CRUD contract',
              openapi: {
                openapi: '3.1.0',
                info: { title: 'Todo API', version: '0.1.0' },
                paths: {
                  '/api/todos': {
                    get: { operationId: 'listTodos', summary: 'todo task を一覧取得する' },
                    post: { operationId: 'createTodo', summary: 'todo task を作成する' },
                  },
                  '/api/todos/{id}': {
                    patch: { operationId: 'updateTodo', summary: 'todo task を更新する' },
                    delete: { operationId: 'deleteTodo', summary: 'todo task を削除する' },
                  },
                },
                components: { schemas: {} },
              },
              validation: [{ schemaName: 'CreateTodoRequest', owner: 'request' }],
            },
          },
        },
        {
          id: 'zod-schema-message',
          metadataJson: {
            intent: 'plan_mode_dedicated_view',
            artifactKind: 'plan_mode_zod_schema',
            view: 'zod_schema_design',
            title: 'Todo Zod Schema',
            zodSchema: {
              artifactKind: 'plan_mode_zod_schema',
              view: 'zod_schema_design',
              title: 'Todo Zod Schema',
              summary: 'todo task validation schema',
              schemaName: 'TodoTaskInputSchema',
              owner: 'llm_json',
              zodSource: 'const TodoTaskInputSchema = z.object({ title: z.string() });',
              fields: [
                { name: 'title', type: 'string', required: true, zodExpression: 'z.string()' },
                {
                  name: 'status',
                  type: 'enum',
                  required: true,
                  enumOptions: ['todo', 'done'],
                  zodExpression: "z.enum(['todo', 'done'])",
                },
              ],
            },
          },
        },
        {
          id: 'user-flow-message',
          content: '```mermaid\nflowchart TD\n  empty[Empty state] --> create[Create task]\n```',
          metadataJson: {
            intent: 'plan_mode_dedicated_view',
            artifactKind: 'plan_mode_dedicated_view',
            view: 'user_flow',
            title: 'Todo User Flow',
            markdown: '```mermaid\nflowchart TD\n  empty[Empty state] --> create[Create task]\n```',
          },
        },
        {
          id: 'decision-review-message',
          content: 'Todo 本体は単一画面で完結させる。',
          metadataJson: {
            intent: 'design_decision_review',
            title: 'Todo Decision Review',
            designDecisionReview: {
              decisions: ['Todo 本体は単一画面で完結させる'],
            },
          },
        },
      ],
      projectStackContext: [
        'Target Project Context',
        '- Project name: todolist',
        '- Project root: /Users/y.noguchi/Code/todolist',
        '',
        'TypeScript + React + Vite + Hono + SQLite + Drizzle ORM + Vitest + Playwright',
      ].join('\n'),
    });

    expect(context.implementationPlanGuidance).toContain('標準タスク（DB 変更部分は高リスク相当）');
    expect(context.implementationPlanGuidance).toContain('DB/schema');
    expect(context.implementationPlanGuidance).toContain('API/backend');
    expect(context.implementationPlanGuidance).toContain('UI/frontend');
    expect(context.implementationPlanGuidance).toContain('schema/migration');
    expect(context.implementationPlanGuidance).toContain('Questionnaire Decisions を優先');
    expect(context.implementationPlanGuidance).toContain('具体名で明記');
    expect(context.implementationPlanGuidance).toContain('背景説明より実装契約を優先');
    expect(context.implementationPlanGuidance).toContain('Blueprint Summary');
    expect(context.blueprintSummary).toContain('Task List');
    expect(context.blueprintSummary).toContain('DataTableSection');
    expect(context.blueprintSummary).toContain('表示文言は task 一覧');
    expect(context.blueprintSummary).toContain(
      'サンプルは 週次の買い出しをまとめる / 請求書の確認を終える'
    );
    expect(context.blueprintSummary).toContain('列は Task / Status / Updated');
    expect(context.blueprintSummary).toContain('Task Form');
    expect(context.blueprintSummary).toContain('表示項目は task 名 / 状態 / メモ');
    expect(context.planViewReferences).toContain('API Contract: Todo API Contract');
    expect(context.planViewReferences).toContain('GET /api/todos (listTodos)');
    expect(context.planViewReferences).toContain('PATCH /api/todos/{id} (updateTodo)');
    expect(context.planViewReferences).toContain('Validation: CreateTodoRequest');
    expect(context.planViewReferences).toContain('Zod Schema: TodoTaskInputSchema');
    expect(context.planViewReferences).toContain('status:enum/required(todo|done)');
    expect(context.traceability).toContain(
      'API Contract view: api_io_contract-api-contract-message; message: api-contract-message'
    );
    expect(context.traceability).toContain(
      'Zod Schema view: zod_schema_design-zod-schema-message; message: zod-schema-message'
    );
    expect(context.planModeReferences).toContain('Dedicated Views:');
    expect(context.planModeReferences).toContain('Todo User Flow');
    expect(context.planModeReferences).toContain('flowchart TD');
    expect(context.planModeReferences).toContain('Decision Reviews:');
    expect(context.planModeReferences).toContain('Todo 本体は単一画面で完結させる');
    expect(context.traceability).not.toContain('Plan Mode references:');
    expect(context.traceability).not.toContain('user_flow:user_flow-user-flow-message');

    const userPrompt = buildSpecificationDocumentUserPrompt(context);
    expect(userPrompt).toContain('## Implementation Plan Guidance');
    expect(userPrompt).toContain('## Target Project Context');
    expect(userPrompt).toContain('Project name: todolist');
    expect(userPrompt).toContain('Project root: /Users/y.noguchi/Code/todolist');
    expect(userPrompt).toContain('DB 変更の完了条件');
    expect(userPrompt).toContain('## Plan View References');
    expect(userPrompt).toContain('API Contract: Todo API Contract');
    expect(userPrompt).toContain('## Plan Mode References');
    expect(userPrompt).toContain('Todo User Flow');
    const systemPrompt = buildSpecificationDocumentSystemPrompt();
    expect(systemPrompt).toContain('最終文書に全件列挙せず');
    expect(systemPrompt).toContain('未決定事項は極力作らず');
    expect(systemPrompt).toContain('request / response / error / schema 名 / 適用先 / 主要 rule');
  });

  it('removes orchestration app names from generated target wording for other projects', () => {
    const content = [
      '# Todo List 本体 実装前設計書',
      '',
      '## 目的',
      'NightWorkers に Todo List 本体を追加する。',
      'NightWorker の既存画面ではなく todo ドメインを作る。',
    ].join('\n');
    const sanitized = sanitizeSpecificationTargetNaming(
      content,
      [
        'Target Project Context',
        '- Project name: todolist',
        '- Project root: /Users/y.noguchi/Code/todolist',
      ].join('\n')
    );

    expect(sanitized).not.toContain('NightWorkers');
    expect(sanitized).not.toContain('NightWorker');
    expect(sanitized).toContain('対象プロジェクト（todolist） に Todo List 本体を追加する。');
    expect(sanitized).toContain('対象プロジェクト（todolist） の既存画面');
  });

  it('keeps orchestration app names when the target project is NightWorkers itself', () => {
    const content = 'NightWorkers の Plan Mode を修正する。';
    const sanitized = sanitizeSpecificationTargetNaming(
      content,
      [
        'Target Project Context',
        '- Project name: nightWorkers',
        '- Project root: /Users/y.noguchi/Code/nightWorkers',
      ].join('\n')
    );

    expect(sanitized).toBe(content);
  });
});
