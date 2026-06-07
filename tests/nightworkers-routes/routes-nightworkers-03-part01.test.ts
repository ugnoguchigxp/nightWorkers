import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import app from '../../api/app';
import { ensureNightWorkersSchema } from '../../api/db/bootstrap';
import * as repo from '../../api/modules/nightworkers/nightworkers.repository';

const sameOriginHeaders = { Origin: 'http://localhost:39174' };

beforeAll(async () => {
  await ensureNightWorkersSchema();
});

describe('NightWorkers task routes', () => {
  it('creates a Design Questionnaire, saves answers, accepts a Decision Review, and aggregates workspace refs', async () => {
    const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
    const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
    const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
    process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';

    try {
      const createdRepo = await repo.createRepository({
        name: `TEST: Design Questionnaire ${crypto.randomUUID()}`,
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      });
      const task = await repo.createTask({
        repositoryId: createdRepo.id,
        title: 'TEST: Questionnaire target',
        description: 'Generate questionnaire',
        status: 'draft',
      });
      const blueprintMessage = await repo.createTaskMessage({
        taskId: task.id,
        role: 'assistant',
        content: '# Blueprint',
        messageType: 'markdown_document',
        payloadJson: {
          intent: 'app_blueprint',
          title: 'Support Desk',
          appBlueprint: {
            id: 'support-desk',
            name: 'Support Desk',
            screens: [{ id: 'inbox', name: 'Inbox', sections: [] }],
          },
          validation: { valid: true, issues: [] },
        },
      });
      const dbDesignMessage = await repo.createTaskMessage({
        taskId: task.id,
        role: 'assistant',
        content: '# DB Design Blueprint',
        messageType: 'markdown_document',
        payloadJson: {
          intent: 'app_blueprint',
          title: 'Support Desk DB Design',
          source: 'blueprint-db-design',
          dbDesignTarget: 'full',
          appBlueprint: {
            id: 'support-desk-db-design',
            name: 'Support Desk DB Design',
            screens: [{ id: 'inbox', name: 'Inbox', sections: [] }],
          },
          validation: { valid: true, issues: [] },
        },
      });
      await repo.upsertBlueprintDbDesignAdoption(task.id, dbDesignMessage.id, true);

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
        version: 1,
        source: {
          taskId: task.id,
          repositoryId: createdRepo.id,
          blueprintMessageId: blueprintMessage.id,
        },
        title: 'Support Desk Design Questionnaire',
        summary: 'Resolve support workflow choices before implementation.',
        questionSets: [
          {
            id: 'workflow',
            title: 'Workflow',
            category: 'Operations',
            purpose: 'Decide how agents process tickets.',
            questions: [
              {
                id: 'triage-mode',
                topic: 'Triage',
                question: 'How should incoming tickets be triaged?',
                why: 'The inbox layout and queue labels depend on this.',
                answerType: 'single_choice',
                recommendedAnswerId: 'manual-first',
                options: [
                  {
                    id: 'manual-first',
                    label: 'Manual first',
                    tradeoff: 'Lower automation risk, more agent effort.',
                    recommended: true,
                  },
                  {
                    id: 'auto-priority',
                    label: 'Auto priority',
                    tradeoff: 'Faster sorting, requires policy review.',
                  },
                ],
                allowsCustomAnswer: true,
                blocks: ['Inbox interaction design'],
                outputSection: 'Support workflow',
              },
              {
                id: 'automation-policy',
                topic: 'Automation',
                question: 'What policy should automatic priority use?',
                why: 'Automation needs a reviewed policy before implementation.',
                answerType: 'free_text',
                blocks: ['Automation policy'],
                outputSection: 'Support workflow',
                dependsOn: [
                  {
                    questionId: 'triage-mode',
                    operator: 'equals',
                    value: 'auto-priority',
                  },
                ],
              },
            ],
          },
        ],
        openQuestions: [],
        dbDesignHandoffNotes: [
          {
            id: 'ticket-state-constraint',
            summary: 'Ticket state history must be traceable.',
            sourceQuestionIds: ['triage-mode'],
            constraint: 'DB Design should model state changes without committing table names here.',
          },
        ],
      });

      const createRes = await app.request(
        `http://localhost/api/tasks/${task.id}/design-questionnaire`,
        {
          method: 'POST',
          headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceBlueprintMessageId: blueprintMessage.id }),
        }
      );
      expect(createRes.status).toBe(201);
      const session = await createRes.json();
      expect(session.status).toBe('answering');
      expect(session.questionSets[0].questionnaire.questionSets[0].questions[0].id).toBe(
        'triage-mode'
      );
      expect(session.questionSets[0].rawOutput).toContain('Support Desk Design Questionnaire');

      const answersRes = await app.request(
        `http://localhost/api/tasks/${task.id}/design-questionnaire/${session.id}/answers`,
        {
          method: 'POST',
          headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers: [
              {
                questionId: 'triage-mode',
                selectedOptionIds: ['manual-first'],
                rankedOptionIds: [],
                freeText: 'Start with manual triage.',
                deferred: false,
              },
            ],
          }),
        }
      );
      expect(answersRes.status).toBe(200);
      expect((await answersRes.json()).status).toBe('review_ready');

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
        version: 1,
        sessionId: session.id,
        sourceBlueprintMessageId: blueprintMessage.id,
        title: 'Support Desk Decision Review',
        summary: 'Manual triage is selected for the first implementation slice.',
        decisions: [
          {
            id: 'manual-triage',
            outputSection: 'Support workflow',
            decision: 'Use manual-first triage for incoming tickets.',
            rationale: 'It reduces automation policy risk for v1.',
            alternativesConsidered: ['Auto priority'],
            tradeoffs: ['More agent effort'],
            sourceQuestionIds: ['triage-mode'],
            unresolvedQuestionIds: [],
          },
        ],
        deferredItems: [],
        unresolvedQuestions: [],
        dbDesignHandoffNotes: [
          {
            id: 'ticket-state-constraint',
            summary: 'Ticket state history must be traceable.',
            sourceQuestionIds: ['triage-mode'],
            constraint: 'DB Design should model state changes without committing table names here.',
          },
        ],
      });

      const reviewRes = await app.request(
        `http://localhost/api/tasks/${task.id}/design-questionnaire/${session.id}/review`,
        { method: 'POST', headers: sameOriginHeaders }
      );
      expect(reviewRes.status).toBe(200);
      expect((await reviewRes.json()).validationStatus).toBe('valid');

      const acceptRes = await app.request(
        `http://localhost/api/tasks/${task.id}/design-questionnaire/${session.id}/review/accept`,
        { method: 'POST', headers: sameOriginHeaders }
      );
      expect(acceptRes.status).toBe(200);
      expect((await acceptRes.json()).status).toBe('accepted');

      const workspaceRes = await app.request(
        `http://localhost/api/tasks/${task.id}/blueprint-specification-workspace`,
        { headers: sameOriginHeaders }
      );
      expect(workspaceRes.status).toBe(200);
      const workspace = await workspaceRes.json();
      expect(workspace.blueprintArtifacts).toEqual(
        expect.arrayContaining([expect.objectContaining({ sourceMessageId: blueprintMessage.id })])
      );
      expect(workspace.dbDesignArtifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceMessageId: dbDesignMessage.id,
            adoptionState: 'adopted',
          }),
        ])
      );
      expect(workspace.questionnaireSessions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: session.id,
            status: 'accepted',
            answeredCount: 1,
            totalQuestionCount: 1,
          }),
        ])
      );
      expect(workspace.decisionReviews).toEqual(
        expect.arrayContaining([expect.objectContaining({ title: 'Support Desk Decision Review' })])
      );

      const specificationWorkspaceRes = await app.request(
        `http://localhost/api/tasks/${task.id}/specification-workspace`,
        { headers: sameOriginHeaders }
      );
      expect(specificationWorkspaceRes.status).toBe(200);
      const specificationWorkspace = await specificationWorkspaceRes.json();
      expect(specificationWorkspace.questionnaireSessions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: session.id,
            status: 'accepted',
          }),
        ])
      );
      expect(specificationWorkspace.decisionReviews).toEqual(
        expect.arrayContaining([expect.objectContaining({ title: 'Support Desk Decision Review' })])
      );
    } finally {
      if (originalProvider === undefined) delete process.env.ACTIVE_LLM_PROVIDER;
      else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
      if (originalFixture === undefined) delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
      else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
      if (originalSettingsPath === undefined) delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
      else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
    }
  });

  it('stores schema-invalid Design Questionnaire raw output without replacing it', async () => {
    const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
    const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
    const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
    process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';

    try {
      const createdRepo = await repo.createRepository({
        name: `TEST: Invalid Design Questionnaire ${crypto.randomUUID()}`,
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      });
      const task = await repo.createTask({
        repositoryId: createdRepo.id,
        title: 'TEST: Invalid questionnaire target',
        description: 'Generate invalid questionnaire',
        status: 'draft',
      });
      const blueprintMessage = await repo.createTaskMessage({
        taskId: task.id,
        role: 'assistant',
        content: '# Blueprint',
        messageType: 'markdown_document',
        payloadJson: {
          intent: 'app_blueprint',
          title: 'Invalid Output App',
          appBlueprint: { id: 'invalid-output-app', name: 'Invalid Output App' },
        },
      });
      process.env.SUPERVISOR_FIXTURE_OUTPUT =
        '質問票を作れませんでしたが、ここに未決定事項の説明があります。';

      const createRes = await app.request(
        `http://localhost/api/tasks/${task.id}/design-questionnaire`,
        {
          method: 'POST',
          headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceBlueprintMessageId: blueprintMessage.id }),
        }
      );
      expect(createRes.status).toBe(201);
      const session = await createRes.json();
      expect(session.status).toBe('needs_edit');
      expect(session.questionSets).toHaveLength(1);
      expect(session.questionSets[0]).toMatchObject({
        validationStatus: 'invalid',
        questionnaire: null,
        rawOutput: '質問票を作れませんでしたが、ここに未決定事項の説明があります。',
      });
    } finally {
      if (originalProvider === undefined) delete process.env.ACTIVE_LLM_PROVIDER;
      else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
      if (originalFixture === undefined) delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
      else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
      if (originalSettingsPath === undefined) delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
      else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
    }
  });

  it('creates and saves a repaired choice-form Design Questionnaire', async () => {
    const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
    const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
    const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
    process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';

    try {
      const createdRepo = await repo.createRepository({
        name: `TEST: Choice Form Questionnaire ${crypto.randomUUID()}`,
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      });
      const task = await repo.createTask({
        repositoryId: createdRepo.id,
        title: 'TEST: Choice questionnaire target',
        description: 'Generate choice questionnaire',
        status: 'draft',
      });
      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
        title: '実装前に決めたいこと',
        questions: [
          {
            text: '最初のリリース範囲はどれにしますか？',
            type: 'radio',
            options: ['最小CRUDのみ', '一覧・詳細・編集まで', '通知や履歴も含める'],
          },
          {
            text: '必要なユーザー権限を選んでください',
            type: 'checkbox',
            options: ['管理者', '編集者', '閲覧者'],
          },
        ],
      }).slice(0, -2);

      const createRes = await app.request(
        `http://localhost/api/tasks/${task.id}/design-questionnaire`,
        {
          method: 'POST',
          headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );

      expect(createRes.status).toBe(201);
      const session = await createRes.json();
      expect(session.status).toBe('answering');
      const questionnaire = session.questionSets[0].questionnaire;
      expect(questionnaire.source).toMatchObject({
        taskId: task.id,
        repositoryId: createdRepo.id,
        sourceKind: 'plan_mode_intake',
      });
      expect(questionnaire.questionSets[0].questions).toEqual([
        expect.objectContaining({
          id: 'q1',
          answerType: 'single_choice',
          options: expect.arrayContaining([expect.objectContaining({ id: 'q1-o1' })]),
        }),
        expect.objectContaining({
          id: 'q2',
          answerType: 'multi_choice',
          options: expect.arrayContaining([expect.objectContaining({ id: 'q2-o2' })]),
        }),
      ]);

      const unknownOptionRes = await app.request(
        `http://localhost/api/tasks/${task.id}/design-questionnaire/${session.id}/answers`,
        {
          method: 'POST',
          headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers: [
              {
                questionId: 'q1',
                selectedOptionIds: ['missing-option'],
                rankedOptionIds: [],
                deferred: false,
              },
            ],
          }),
        }
      );
      expect(unknownOptionRes.status).toBe(422);
      expect((await unknownOptionRes.json()).code).toBe('UNKNOWN_OPTION');

      const multipleRadioRes = await app.request(
        `http://localhost/api/tasks/${task.id}/design-questionnaire/${session.id}/answers`,
        {
          method: 'POST',
          headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers: [
              {
                questionId: 'q1',
                selectedOptionIds: ['q1-o1', 'q1-o2'],
                rankedOptionIds: [],
                deferred: false,
              },
            ],
          }),
        }
      );
      expect(multipleRadioRes.status).toBe(422);
      expect((await multipleRadioRes.json()).code).toBe('MULTIPLE_OPTIONS_FOR_SINGLE_CHOICE');

      const answersRes = await app.request(
        `http://localhost/api/tasks/${task.id}/design-questionnaire/${session.id}/answers`,
        {
          method: 'POST',
          headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers: [
              {
                questionId: 'q1',
                selectedOptionIds: ['q1-o1'],
                rankedOptionIds: [],
                deferred: false,
              },
              {
                questionId: 'q2',
                selectedOptionIds: ['q2-o1', 'q2-o2'],
                rankedOptionIds: [],
                deferred: false,
              },
            ],
          }),
        }
      );
      expect(answersRes.status).toBe(200);
      const answeredSession = await answersRes.json();
      expect(answeredSession.status).toBe('review_ready');
      expect(answeredSession.answers.map((answer: any) => answer.answer.selectedOptionIds)).toEqual(
        [['q1-o1'], ['q2-o1', 'q2-o2']]
      );
    } finally {
      if (originalProvider === undefined) delete process.env.ACTIVE_LLM_PROVIDER;
      else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
      if (originalFixture === undefined) delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
      else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
      if (originalSettingsPath === undefined) delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
      else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
    }
  });

  it('normalizes legacy flat Design Questionnaire output into grouped question sets', async () => {
    const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
    const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
    const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
    process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';

    try {
      const createdRepo = await repo.createRepository({
        name: `TEST: Legacy Design Questionnaire ${crypto.randomUUID()}`,
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      });
      const task = await repo.createTask({
        repositoryId: createdRepo.id,
        title: 'TEST: Legacy questionnaire target',
        description: 'Generate legacy questionnaire',
        status: 'draft',
      });
      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
        taskId: task.id,
        repositoryId: createdRepo.id,
        questions: [
          {
            id: 'product-scope-and-users',
            category: 'プロダクト範囲',
            question: 'この Kanban システムの対象ユーザーと利用範囲はどこまでですか？',
            why: '利用者の前提で必要な画面、権限、データモデル、認証有無が変わるためです。',
            blocks: ['認証方式の設計', '初期 MVP の機能範囲'],
            outputSection: 'scope',
            recommendedAnswer: '個人利用から始める',
            choices: [
              {
                label: '個人利用',
                description: '最小構成で始めやすい。',
              },
              {
                label: 'チーム利用',
                description: '共有や権限設計が必要になる。',
              },
            ],
            tradeoff: '共有を入れるほど初期実装は重くなります。',
          },
        ],
        dbDesignHandoffNotes: ['ボード、列、カードの正規化方針を DB Design で決める。'],
      });

      const createRes = await app.request(
        `http://localhost/api/tasks/${task.id}/design-questionnaire`,
        {
          method: 'POST',
          headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );

      expect(createRes.status).toBe(201);
      const session = await createRes.json();
      expect(session.status).toBe('answering');
      expect(session.questionSets[0]).toMatchObject({
        validationStatus: 'valid',
      });
      const questionnaire = session.questionSets[0].questionnaire;
      expect(questionnaire.source).toMatchObject({
        taskId: task.id,
        repositoryId: createdRepo.id,
        sourceKind: 'plan_mode_intake',
      });
      expect(questionnaire.questionSets[0].questions[0]).toMatchObject({
        id: 'product-scope-and-users',
        topic: 'プロダクト範囲',
        answerType: 'single_choice',
        recommendedAnswerId: 'option-1',
      });
      expect(questionnaire.questionSets[0].questions[0].options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'option-1',
            label: '個人利用',
            recommended: true,
          }),
        ])
      );
      expect(questionnaire.dbDesignHandoffNotes[0]).toMatchObject({
        id: 'db-note-1',
        sourceQuestionIds: ['product-scope-and-users'],
      });
    } finally {
      if (originalProvider === undefined) delete process.env.ACTIVE_LLM_PROVIDER;
      else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
      if (originalFixture === undefined) delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
      else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
      if (originalSettingsPath === undefined) delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
      else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
    }
  });
});
