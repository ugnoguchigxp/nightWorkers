import { describe, expect, it } from 'vitest';
import {
  buildSpecificationDocumentContext,
  renderQuestionnaireAnswerMarkdown,
} from '../api/modules/nightworkers/nightworkers.spec-document-renderer';

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
        appBlueprint: {
          id: 'db-1',
          databaseSchema: {
            tables: [
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
      expect(result.traceability).toContain('Questionnaire session: session-123');
      expect(result.traceability).toContain('Blueprint message: msg-blueprint');
      expect(result.traceability).toContain('Data Model message: msg-data-model');
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
              appBlueprint: {
                databaseSchema: {
                  tables: [],
                },
              },
            },
          },
        ],
      });
      expect(result.dataModelDdl).toContain('Data Model には table が定義されていません。');
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
  });
});
