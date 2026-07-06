import { describe, expect, it } from 'vitest';
import {
  buildAssembledDesignContext,
  buildSpecificationDocumentContext,
  renderQuestionnaireAnswerMarkdown,
} from '../api/modules/specification/specification-document-renderer';
import type {
  DesignQuestionnaire,
  DesignQuestionnaireAnswer,
} from '../shared/schemas/design-questionnaire.schema';

// Helper to mock parsing functions that are imported by the module
// (which we can mock if needed, but the original parser has basic behaviors we can reuse or just pass compatible data)
describe('spec-document-renderer', () => {
  const mockTask = {
    title: 'Test Task',
    description: 'This is description',
    objective: 'This is objective',
  };

  const mockSession = {
    id: 'session-123',
    answers: [
      { questionId: 'q1', answer: { booleanValue: true } },
      { questionId: 'q2', answer: { selectedOptionIds: ['opt1', 'opt2'], rankedOptionIds: [] } },
      { questionId: 'q3', answer: { deferred: true } },
    ],
    questionSets: [
      {
        questionnaire: {
          questionSets: [
            {
              questions: [
                { id: 'q1', question: 'Question 1', why: 'Why 1', outputSection: 'sec1' },
                {
                  id: 'q2',
                  question: 'Question 2',
                  why: 'Why 2',
                  outputSection: 'sec2',
                  options: [
                    { id: 'opt1', label: 'Option 1' },
                    { id: 'opt2', label: 'Option 2' },
                  ],
                },
                { id: 'q3', question: 'Question 3', why: 'Why 3', outputSection: 'sec3' },
              ],
            },
          ],
        },
      },
    ],
  };

  const mockWorkspace = {
    featurePlanArtifacts: [],
    blueprintArtifacts: [{ id: 'art-bp' }],
    dataModelArtifacts: [],
    dedicatedViewArtifacts: [],
    questionnaireSessions: [],
    decisionReviews: [],
    implementationReferences: [],
  };

  const mockMessages = [
    {
      id: 'msg-blueprint',
      metadataJson: {
        intent: 'app_blueprint',
        source: 'blueprint-generation',
        appBlueprint: {
          id: 'bp-1',
          name: 'My App',
          description: 'A mock application',
          screens: [
            {
              id: 'screen-1',
              name: 'Dashboard',
              path: '/dashboard',
              componentName: 'DashboardPage',
              sections: [
                {
                  id: 'section-1',
                  name: 'Sales Card',
                  componentName: 'Card',
                  props: {
                    description: 'Shows sales data',
                    columns: [{ id: 'col1', title: 'Revenue' }],
                    items: [{ label: 'Sales' }],
                    tabs: [{ label: 'Weekly' }],
                    filters: [{ label: 'Region' }],
                  },
                },
              ],
            },
          ],
          implementationTasks: [{ title: 'Setup DB', description: 'Configure SQLite' }],
        },
      },
    },
    {
      id: 'msg-data-model',
      metadataJson: {
        intent: 'app_blueprint',
        source: 'data-model', // signals data-model message
        dataModelArtifact: {
          id: 'db-1',
          derivedTables: [
            {
              name: 'users',
              columns: [
                { name: 'id', type: 'number', primaryKey: true, nullable: false },
                { name: 'email', type: 'text', nullable: false, unique: true },
                { name: 'is_active', type: 'boolean' },
                { name: 'created_at', type: 'datetime' },
                { name: 'meta', type: 'json' },
              ],
              indexes: [['email']],
            },
          ],
          relations: [
            {
              fromTable: 'profiles',
              fromColumn: 'user_id',
              toTable: 'users',
              toColumn: 'id',
            },
          ],
        },
      },
    },
  ];

  describe('buildSpecificationDocumentContext', () => {
    it('generates context strings with full blueprint and database DDL details', () => {
      const result = buildSpecificationDocumentContext({
        task: mockTask,
        session: mockSession,
        workspace: mockWorkspace,
        messages: mockMessages,
      });

      expect(result.task).toContain('Title: Test Task');
      expect(result.task).toContain('Description: This is description');
      expect(result.task).toContain('Objective: This is objective');

      // Check blueprint summary formatting
      expect(result.blueprintSummary).toContain('Blueprint "My App" を採用しています。');
      expect(result.blueprintSummary).toContain('画面: Dashboard (/dashboard)。');
      expect(result.blueprintSummary).toContain('- 採用 section: Sales Card。');
      expect(result.blueprintSummary).toContain('列は Revenue。');
      expect(result.blueprintSummary).toContain('表示項目は Sales。');
      expect(result.blueprintSummary).toContain('Setup DB');

      // Check DDL generation
      expect(result.dataModelDdl).toContain('CREATE TABLE users (');
      expect(result.dataModelDdl).toContain('id INTEGER PRIMARY KEY NOT NULL');
      expect(result.dataModelDdl).toContain('email TEXT NOT NULL UNIQUE');
      expect(result.dataModelDdl).toContain('is_active BOOLEAN');
      expect(result.dataModelDdl).toContain('created_at DATETIME');
      expect(result.dataModelDdl).toContain('meta JSON');
      expect(result.dataModelDdl).toContain('CREATE INDEX idx_users_email ON users (email);');
      expect(result.dataModelDdl).toContain(
        'ALTER TABLE profiles ADD FOREIGN KEY (user_id) REFERENCES users (id);'
      );

      // Check traceability
      expect(result.traceability).toContain('Questionnaire decisions: included');
      expect(result.traceability).toContain('Blueprint summary: included');
      expect(result.traceability).toContain('Data Model DDL reference: included');
      expect(result.traceability).toContain('API Contract: none');
      expect(result.traceability).toContain('Zod Schema: none');
      expect(result.traceability).toContain('Workspace counts: blueprint=1');
    });

    it('includes dedicated plan view references and traceability', () => {
      const result = buildSpecificationDocumentContext({
        task: mockTask,
        session: mockSession,
        workspace: {
          ...mockWorkspace,
          dedicatedViewArtifacts: [
            {
              id: 'api_io_contract-msg-api',
              kind: 'api_io_contract',
              title: 'API Contract',
              sourceMessageId: 'msg-api',
              createdAt: new Date().toISOString(),
            },
            {
              id: 'zod_schema_design-msg-zod',
              kind: 'zod_schema_design',
              title: 'Zod Schema',
              sourceMessageId: 'msg-zod',
              createdAt: new Date().toISOString(),
            },
            {
              id: 'activity_flow-msg-activity',
              kind: 'activity_flow',
              title: 'Todo Activity Flow',
              sourceMessageId: 'msg-activity',
              createdAt: new Date().toISOString(),
            },
          ],
          decisionReviews: [
            {
              id: 'decision-review-msg-review',
              kind: 'decision_review',
              title: 'Decision Review',
              sourceMessageId: 'msg-review',
              createdAt: new Date().toISOString(),
            },
          ],
        },
        messages: [
          {
            id: 'msg-api',
            metadataJson: {
              intent: 'plan_mode_dedicated_view',
              artifactKind: 'plan_mode_api_contract',
              view: 'api_io_contract',
              apiContract: {
                artifactKind: 'plan_mode_api_contract',
                view: 'api_io_contract',
                title: 'Todo API Contract',
                summary: 'CRUD for todo tasks.',
                openapi: {
                  openapi: '3.1.0',
                  info: { title: 'Todo API', version: '0.1.0' },
                  paths: {
                    '/api/todos': {
                      post: {
                        operationId: 'createTodo',
                        summary: 'Create todo task',
                        requestBody: {
                          required: true,
                          content: {
                            'application/json': {
                              schema: { $ref: '#/components/schemas/CreateTodoRequest' },
                            },
                          },
                        },
                        responses: {
                          '201': {
                            description: 'Created',
                            content: {
                              'application/json': {
                                schema: { $ref: '#/components/schemas/TodoResponse' },
                              },
                            },
                          },
                          '400': {
                            description: 'Validation error',
                            content: {
                              'application/json': {
                                schema: { $ref: '#/components/schemas/TodoValidationError' },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                  components: {
                    schemas: {
                      CreateTodoRequest: {
                        type: 'object',
                        required: ['title'],
                        properties: {
                          title: { type: 'string' },
                          status: { type: 'string', enum: ['todo', 'done'] },
                        },
                      },
                      TodoResponse: {
                        type: 'object',
                        required: ['id', 'title'],
                        properties: {
                          id: { type: 'string' },
                          title: { type: 'string' },
                          status: { type: 'string', enum: ['todo', 'done'] },
                        },
                      },
                      TodoValidationError: {
                        type: 'object',
                        required: ['message'],
                        properties: {
                          message: { type: 'string' },
                          issues: { type: 'array' },
                        },
                      },
                    },
                  },
                },
                validation: [{ schemaName: 'TodoRequest', owner: 'request' }],
              },
            },
          },
          {
            id: 'msg-zod',
            metadataJson: {
              intent: 'plan_mode_dedicated_view',
              artifactKind: 'plan_mode_zod_schema',
              view: 'zod_schema_design',
              zodSchema: {
                artifactKind: 'plan_mode_zod_schema',
                view: 'zod_schema_design',
                title: 'Todo Zod Schema',
                summary: 'Validation for todo input.',
                schemaName: 'TodoInputSchema',
                owner: 'llm_json',
                zodSource: 'const TodoInputSchema = z.object({ title: z.string() });',
                fields: [
                  { name: 'title', type: 'string', required: true, zodExpression: 'z.string()' },
                ],
              },
            },
          },
          {
            id: 'msg-activity',
            content: '```mermaid\nflowchart TD\n  create --> persist\n```',
            metadataJson: {
              intent: 'plan_mode_dedicated_view',
              artifactKind: 'plan_mode_dedicated_view',
              view: 'activity_flow',
              title: 'Todo Activity Flow',
              markdown: '```mermaid\nflowchart TD\n  create --> persist\n```',
            },
          },
          {
            id: 'msg-review',
            content: 'Use the generated API contract as the source of truth.',
            metadataJson: {
              intent: 'design_decision_review',
              title: 'Decision Review',
              designDecisionReview: {
                decisions: ['Use the generated API contract as the source of truth.'],
              },
            },
          },
        ],
      });

      expect(result.planViewReferences).toContain('API Contract: Todo API Contract');
      expect(result.planViewReferences).toContain('POST /api/todos (createTodo)');
      expect(result.planViewReferences).toContain(
        'request: CreateTodoRequest; required; title:string, status:enum(todo|done)?'
      );
      expect(result.planViewReferences).toContain(
        'response/error: 201 TodoResponse {id:string, title:string, status:enum(todo|done)?} / 400 TodoValidationError {message:string, issues:array?}'
      );
      expect(result.planViewReferences).toContain('Validation: TodoRequest');
      expect(result.planViewReferences).toContain('Zod Schema: TodoInputSchema');
      expect(result.planViewReferences).toContain('title:string/required');
      expect(result.traceability).toContain('API Contract: included and indexed');
      expect(result.traceability).toContain('Zod Schema: included and indexed');
      expect(result.traceability).toContain('Workspace counts: blueprint=1, dataModel=0');
      expect(result.planModeReferences).toContain('Dedicated Views:');
      expect(result.planModeReferences).toContain('Todo Activity Flow');
      expect(result.planModeReferences).toContain('flowchart TD');
      expect(result.planModeReferences).toContain('Decision Reviews:');
      expect(result.planModeReferences).toContain(
        'Use the generated API contract as the source of truth.'
      );
      expect(result.traceability).not.toContain('activity_flow:activity_flow-msg-activity');
    });

    it('assembles artifact contracts outside the feature plan body', () => {
      const assembled = buildAssembledDesignContext({
        taskId: 'task-123',
        task: mockTask,
        session: mockSession,
        workspace: {
          ...mockWorkspace,
          dedicatedViewArtifacts: [
            {
              id: 'api_io_contract-msg-api',
              kind: 'api_io_contract',
              title: 'API Contract',
              sourceMessageId: 'msg-api',
              createdAt: new Date().toISOString(),
            },
            {
              id: 'zod_schema_design-msg-zod',
              kind: 'zod_schema_design',
              title: 'Zod Schema',
              sourceMessageId: 'msg-zod',
              createdAt: new Date().toISOString(),
            },
            {
              id: 'activity_flow-msg-activity',
              kind: 'activity_flow',
              title: 'Todo Activity Flow',
              sourceMessageId: 'msg-activity',
              createdAt: new Date().toISOString(),
            },
          ],
          decisionReviews: [
            {
              id: 'decision-review-msg-review',
              kind: 'decision_review',
              title: 'Decision Review',
              sourceMessageId: 'msg-review',
              createdAt: new Date().toISOString(),
            },
          ],
        },
        messages: [
          ...mockMessages,
          {
            id: 'msg-api',
            metadataJson: {
              intent: 'plan_mode_dedicated_view',
              artifactKind: 'plan_mode_api_contract',
              view: 'api_io_contract',
              apiContract: {
                artifactKind: 'plan_mode_api_contract',
                view: 'api_io_contract',
                title: 'Todo API Contract',
                summary: 'CRUD for todo tasks.',
                openapi: {
                  openapi: '3.1.0',
                  info: { title: 'Todo API', version: '0.1.0' },
                  paths: {
                    '/api/todos': {
                      post: {
                        operationId: 'createTodo',
                        summary: 'Create todo task',
                        requestBody: {
                          required: true,
                          content: {
                            'application/json': {
                              schema: { $ref: '#/components/schemas/CreateTodoRequest' },
                            },
                          },
                        },
                      },
                    },
                  },
                  components: {
                    schemas: {
                      CreateTodoRequest: {
                        type: 'object',
                        required: ['title'],
                        properties: { title: { type: 'string' } },
                      },
                    },
                  },
                },
                validation: [{ schemaName: 'TodoRequest', owner: 'request' }],
              },
            },
          },
          {
            id: 'msg-zod',
            metadataJson: {
              intent: 'plan_mode_dedicated_view',
              artifactKind: 'plan_mode_zod_schema',
              view: 'zod_schema_design',
              zodSchema: {
                artifactKind: 'plan_mode_zod_schema',
                view: 'zod_schema_design',
                title: 'Todo Zod Schema',
                summary: 'Validation for todo input.',
                schemaName: 'TodoInputSchema',
                owner: 'llm_json',
                zodSource: 'const TodoInputSchema = z.object({ title: z.string() });',
                fields: [
                  { name: 'title', type: 'string', required: true, zodExpression: 'z.string()' },
                ],
              },
            },
          },
          {
            id: 'msg-activity',
            content: '',
            metadataJson: {
              intent: 'plan_mode_dedicated_view',
              artifactKind: 'plan_mode_dedicated_view',
              view: 'activity_flow',
              title: 'Todo Activity Flow',
              markdown: '```mermaid\nflowchart TD\n  create --> persist\n```',
            },
          },
          {
            id: 'msg-review',
            content: 'Use the generated API contract as the source of truth.',
            metadataJson: {
              intent: 'design_decision_review',
              title: 'Decision Review',
              designDecisionReview: {
                decisions: ['Use the generated API contract as the source of truth.'],
              },
            },
          },
        ],
      });

      expect(assembled.summary).toContain('Sections:');
      expect(assembled.questionnaireSessionId).toBe('session-123');
      expect(assembled.sourceMessageIds).toEqual(
        expect.arrayContaining(['msg-blueprint', 'msg-data-model', 'msg-api', 'msg-zod'])
      );
      expect(assembled.sourceMessageIds).not.toContain('session-123');
      expect(assembled.sections.map((section) => section.kind)).toEqual(
        expect.arrayContaining([
          'questionnaire',
          'blueprint',
          'data_model',
          'api_io_contract',
          'zod_schema_design',
          'activity_flow',
          'decision_review',
        ])
      );
      expect(
        assembled.sections.find((section) => section.kind === 'api_io_contract')?.content
      ).toContain('POST /api/todos (createTodo)');
      expect(
        assembled.sections.find((section) => section.kind === 'zod_schema_design')?.content
      ).toContain('TodoInputSchema');
      expect(
        assembled.sections.find((section) => section.kind === 'data_model')?.content
      ).toContain('CREATE TABLE users');
      expect(
        assembled.sections.find((section) => section.kind === 'activity_flow')?.content
      ).toContain('flowchart TD');
    });

    it('handles missing blueprint and db design gracefully', () => {
      const result = buildSpecificationDocumentContext({
        task: { title: 'No Blueprint Task' },
        session: { id: 'session-2', answers: [], questionSets: [] },
        workspace: {
          featurePlanArtifacts: [],
          blueprintArtifacts: [],
          dataModelArtifacts: [],
          dedicatedViewArtifacts: [],
          questionnaireSessions: [],
          decisionReviews: [],
          implementationReferences: [],
        },
        messages: [],
      });

      expect(result.blueprintSummary).toContain('Blueprint は未生成です。');
      expect(result.dataModelDdl).toContain('Data Model は未生成です。');
    });

    it('handles empty tables in database schema', () => {
      const result = buildSpecificationDocumentContext({
        task: mockTask,
        session: mockSession,
        workspace: mockWorkspace,
        messages: [
          {
            id: 'msg-empty-db',
            metadataJson: {
              intent: 'app_blueprint',
              source: 'data-model',
              dataModelArtifact: {
                derivedTables: [],
              },
            },
          },
        ],
      });
      expect(result.dataModelDdl).toContain('Data Model には table が定義されていません。');
    });

    it('handles tables with empty columns', () => {
      const result = buildSpecificationDocumentContext({
        task: mockTask,
        session: mockSession,
        workspace: mockWorkspace,
        messages: [
          {
            id: 'msg-no-columns-db',
            metadataJson: {
              intent: 'app_blueprint',
              source: 'data-model',
              dataModelArtifact: {
                derivedTables: [
                  {
                    name: 'no_columns_table',
                    columns: [],
                  },
                ],
              },
            },
          },
        ],
      });
      expect(result.dataModelDdl).toContain('-- columns are not defined');
    });
  });

  describe('renderQuestionnaireAnswerMarkdown', () => {
    it('returns fallbacks when session has no answers', () => {
      const result = renderQuestionnaireAnswerMarkdown({
        id: 'sess-empty',
        answers: [],
        questionSets: [],
      });
      expect(result).toBe('- No questionnaire answers.');
    });

    it('renders structured questionnaire answers in markdown', () => {
      const result = renderQuestionnaireAnswerMarkdown(mockSession);
      expect(result).toContain('- Question 1');
      expect(result).toContain('- Answer: はい');
      expect(result).toContain('- Question 2');
      expect(result).toContain('- Answer: Option 1, Option 2');
      expect(result).toContain('- Question 3');
      expect(result).toContain('- Answer: 後で決める');
    });
  });

  describe('Edge cases and fallbacks for full renderer coverage', () => {
    it('handles compactText, missing props, and legacy databaseSchema format', () => {
      const result = buildSpecificationDocumentContext({
        task: {
          title: 'A'.repeat(100), // triggers compactText limit in title
          description: 'Desc',
          objective: 'Obj',
        },
        session: {
          id: 'session-edge',
          answers: [
            { questionId: 'q-empty', answer: {} as DesignQuestionnaireAnswer },
            { questionId: 'q-deferred', answer: { deferred: true } },
          ],
          questionSets: [
            {
              questionnaire: {
                questionSets: [
                  {
                    questions: [
                      { id: 'q-empty', question: 'Empty Q', text: 'Text Q' },
                      {
                        id: 'q-deferred',
                        question: 'Deferred Q',
                        why: 'Deferred Why',
                        outputSection: 'Deferred Sec',
                      },
                    ],
                  },
                ],
              } as unknown as DesignQuestionnaire,
            },
          ],
        },
        workspace: mockWorkspace,
        messages: [
          {
            id: 'msg-legacy-bp',
            metadataJson: {
              intent: 'app_blueprint',
              source: 'blueprint-generation',
              appBlueprint: {
                id: 'bp-legacy',
                name: '', // tests fallback name
                description: 'B'.repeat(300), // triggers compactText in blueprint description
                implementationTasks: [
                  { title: 'Task 1', description: 'C'.repeat(200) }, // triggers compactText in task description
                ],
                screens: [
                  {
                    id: 'screen-no-name',
                    // name is missing
                    path: '', // tests default '/' path
                    sections: [
                      {
                        id: 'section-no-props',
                        name: '', // tests fallback name
                        visualIntent: 'Visual Intent', // fallback description
                        // props is missing
                      },
                      {
                        id: 'section-non-obj-props',
                        name: 'Non Object Props',
                        props: 'not-an-object', // tests isRecord props fallback
                        intent: 'Intent Description', // fallback description
                      },
                    ],
                  },
                ],
              },
            },
          },
          {
            id: 'msg-legacy-dm',
            metadataJson: {
              intent: 'app_blueprint',
              source: 'data-model',
              dataModelArtifact: {
                derivedTables: [
                  {
                    name: 'legacy_users',
                    columns: [
                      { name: 'id', type: 'number', primaryKey: true, nullable: true },
                      { name: 'name', type: 'text', nullable: false },
                    ],
                  },
                ],
                relations: [
                  {
                    fromTable: 'legacy_profiles',
                    fromColumn: 'user_id',
                    toTable: 'legacy_users',
                    toColumn: 'id',
                  },
                ],
              },
            },
          },
        ],
      });

      // Assert compactText limits description length
      expect(result.blueprintSummary).toContain('…');

      // Assert legacy database schema renders tables
      expect(result.dataModelDdl).toContain('CREATE TABLE legacy_users (');
      expect(result.dataModelDdl).toContain('id INTEGER PRIMARY KEY');

      // Assert default sections and fallback names are printed
      expect(result.blueprintSummary).toContain('画面: screen-no-name。');
      expect(result.blueprintSummary).toContain('Visual Intent');
      expect(result.blueprintSummary).toContain('Intent Description');
    });
  });
});
