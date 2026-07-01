import crypto from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../../api/app';
import { ensureNightWorkersSchema } from '../../api/db/bootstrap';
import * as repo from '../../api/modules/nightworkers/nightworkers.repository';
import * as generalSettings from '../../api/services/settings/general-settings';
import { representativeMockBlueprint } from '../fixtures/mock-blueprint';

const sameOriginHeaders = { Origin: 'http://localhost:39174' };
const representativeDataModelArtifact = {
  artifactKind: 'plan_mode_dedicated_view',
  view: 'data_model',
  title: 'Kanban Data Model',
  summary: 'Kanban board persistence model.',
  canonicalSource: 'ddl',
  ddl: 'CREATE TABLE cards (id TEXT PRIMARY KEY, title TEXT NOT NULL);',
  derivedTables: [
    {
      name: 'cards',
      purpose: 'Stores board cards.',
      columns: [
        { name: 'id', type: 'TEXT', nullable: false, primaryKey: true },
        { name: 'title', type: 'TEXT', nullable: false },
      ],
      indexes: [],
    },
  ],
  relations: [],
  constraints: ['Keep cards scoped to a board in follow-up design.'],
  openQuestions: [],
};

beforeAll(async () => {
  await ensureNightWorkersSchema();
});

function buildMechanicalQuestionnaireAnswers(session: unknown) {
  const answerByQuestionId = new Map(
    (session.answers || []).map((answer: unknown) => [answer.questionId, answer.answer])
  );
  const questions = session.questionSets.flatMap((set: unknown) =>
    (set.questionnaire?.questionSets || []).flatMap((questionSet: unknown) => questionSet.questions)
  );
  const answers = [];
  for (const question of questions) {
    if (answerByQuestionId.has(question.id)) continue;
    if (!areQuestionDependenciesSatisfied(question, answerByQuestionId)) continue;
    const answer = buildMechanicalQuestionnaireAnswer(question);
    answerByQuestionId.set(question.id, answer);
    answers.push(answer);
  }
  return answers;
}

function buildMechanicalQuestionnaireAnswer(question: unknown) {
  const options = Array.isArray(question.options) ? question.options : [];
  const optionIds = options.map((option: unknown) => String(option.id)).filter(Boolean);
  const preferredOptionId =
    question.recommendedAnswerId && optionIds.includes(question.recommendedAnswerId)
      ? question.recommendedAnswerId
      : optionIds[0];
  return {
    questionId: question.id,
    selectedOptionIds:
      question.answerType === 'single_choice' && preferredOptionId
        ? [preferredOptionId]
        : question.answerType === 'multi_choice' && preferredOptionId
          ? [preferredOptionId]
          : [],
    booleanValue: question.answerType === 'boolean' ? true : undefined,
    freeText:
      question.answerType === 'free_text' ? `E2E synthetic answer for ${question.id}` : undefined,
    rankedOptionIds: question.answerType === 'ranked' ? optionIds : [],
    deferred: false,
  };
}

function areQuestionDependenciesSatisfied(
  question: unknown,
  answerByQuestionId: Map<string, unknown>
) {
  const dependencies = Array.isArray(question.dependsOn) ? question.dependsOn : [];
  return dependencies.every((dependency: unknown) => {
    const answer = answerByQuestionId.get(String(dependency.questionId));
    if (!answer) return false;
    return doesAnswerSatisfyDependency(answer, dependency);
  });
}

function doesAnswerSatisfyDependency(answer: unknown, dependency: unknown) {
  const expected = dependency.value;
  if (typeof expected === 'boolean') {
    if (dependency.operator === 'equals') return answer.booleanValue === expected;
    if (dependency.operator === 'not_equals') return answer.booleanValue !== expected;
    return false;
  }
  const selectedValues = [
    ...(answer.selectedOptionIds || []),
    ...(answer.rankedOptionIds || []),
    ...(answer.freeText?.trim() ? [answer.freeText.trim()] : []),
  ];
  const hasExpected = Array.isArray(expected)
    ? expected.some((value) => selectedValues.includes(String(value)))
    : selectedValues.includes(String(expected));
  if (dependency.operator === 'equals' || dependency.operator === 'includes') return hasExpected;
  if (dependency.operator === 'not_equals' || dependency.operator === 'excludes')
    return !hasExpected;
  return false;
}

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
      const dataModelMessage = await repo.createTaskMessage({
        taskId: task.id,
        role: 'assistant',
        content: '# Support Desk Data Model',
        messageType: 'markdown_document',
        payloadJson: {
          artifactKind: 'plan_mode_dedicated_view',
          view: 'data_model',
          source: 'data-model',
          title: 'Support Desk Data Model',
          intent: 'plan_mode_dedicated_view',
          artifactType: 'data_model',
          dataModelArtifact: representativeDataModelArtifact,
        },
      });
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
        dataModelHandoffNotes: [
          {
            id: 'ticket-state-constraint',
            summary: 'Ticket state history must be traceable.',
            sourceQuestionIds: ['triage-mode'],
            constraint:
              'Data Model should model state changes without committing table names here.',
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

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
        action: 'ready_for_design_assembly',
        rationale: 'Manual-first triage gives enough information for the first design assembly.',
        questionnaire: null,
      });

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
        dataModelHandoffNotes: [
          {
            id: 'ticket-state-constraint',
            summary: 'Ticket state history must be traceable.',
            sourceQuestionIds: ['triage-mode'],
            constraint:
              'Data Model should model state changes without committing table names here.',
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
        `http://localhost/api/tasks/${task.id}/plan-mode/workspace`,
        { headers: sameOriginHeaders }
      );
      expect(workspaceRes.status).toBe(200);
      const workspace = await workspaceRes.json();
      expect(workspace.blueprintArtifacts).toEqual(
        expect.arrayContaining([expect.objectContaining({ sourceMessageId: blueprintMessage.id })])
      );
      expect(workspace.dataModelArtifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceMessageId: dataModelMessage.id,
            kind: 'data_model',
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

      const planModeWorkspaceRes = await app.request(
        `http://localhost/api/tasks/${task.id}/plan-mode/workspace`,
        { headers: sameOriginHeaders }
      );
      expect(planModeWorkspaceRes.status).toBe(200);
      const planModeWorkspace = await planModeWorkspaceRes.json();
      expect(planModeWorkspace.questionnaireSessions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: session.id,
            status: 'accepted',
          }),
        ])
      );
      expect(planModeWorkspace.decisionReviews).toEqual(
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

  it('rejects Plan Mode questionnaire edits after the task is completed', async () => {
    const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
    const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
    const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
    process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';

    try {
      const createdRepo = await repo.createRepository({
        name: `TEST: Locked Plan Mode ${crypto.randomUUID()}`,
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      });
      const task = await repo.createTask({
        repositoryId: createdRepo.id,
        title: 'TEST: Locked questionnaire target',
        description: 'Generate questionnaire',
        status: 'draft',
      });
      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
        version: 1,
        source: {
          taskId: task.id,
          repositoryId: createdRepo.id,
          sourceKind: 'plan_mode_intake',
        },
        title: 'Locked Plan Questionnaire',
        questionSets: [
          {
            id: 'scope',
            title: 'Scope',
            questions: [
              {
                id: 'storage-mode',
                question: 'Storage mode?',
                answerType: 'single_choice',
                required: true,
                options: [{ id: 'local-only', label: 'Local only' }],
              },
            ],
          },
        ],
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

      await repo.updateTaskStatus(task.id, 'completed');

      const answersRes = await app.request(
        `http://localhost/api/tasks/${task.id}/design-questionnaire/${session.id}/answers`,
        {
          method: 'POST',
          headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers: [
              {
                questionId: 'storage-mode',
                selectedOptionIds: ['local-only'],
                rankedOptionIds: [],
                deferred: false,
              },
            ],
          }),
        }
      );
      expect(answersRes.status).toBe(409);
      expect((await answersRes.json()).code).toBe('PLAN_MODE_READ_ONLY');
    } finally {
      if (originalProvider === undefined) delete process.env.ACTIVE_LLM_PROVIDER;
      else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
      if (originalFixture === undefined) delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
      else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
      if (originalSettingsPath === undefined) delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
      else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
    }
  });

  it('rejects Questionnaire mutation when the Plan Mode capability is disabled', async () => {
    const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
    const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
    process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';
    vi.spyOn(generalSettings, 'readGeneralSettings').mockReturnValue({
      ...generalSettings.DEFAULT_GENERAL_SETTINGS,
      planMode: {
        capabilities: {
          ...generalSettings.DEFAULT_GENERAL_SETTINGS.planMode.capabilities,
          questionnaire: false,
        },
      },
    });

    try {
      const createdRepo = await repo.createRepository({
        name: `TEST: Disabled Questionnaire ${crypto.randomUUID()}`,
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      });
      const task = await repo.createTask({
        repositoryId: createdRepo.id,
        title: 'TEST: Disabled questionnaire target',
        description: 'Generate questionnaire',
        status: 'draft',
      });

      const createRes = await app.request(
        `http://localhost/api/tasks/${task.id}/design-questionnaire`,
        {
          method: 'POST',
          headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      expect(createRes.status).toBe(409);
      const body = await createRes.json();
      expect(body.error?.code ?? body.code).toBe('PLAN_MODE_CAPABILITY_DISABLED');

      const listRes = await app.request(
        `http://localhost/api/tasks/${task.id}/design-questionnaire`,
        { headers: sameOriginHeaders }
      );
      expect(listRes.status).toBe(200);
      expect(await listRes.json()).toEqual([]);
    } finally {
      vi.restoreAllMocks();
      if (originalProvider === undefined) delete process.env.ACTIVE_LLM_PROVIDER;
      else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
      if (originalSettingsPath === undefined) delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
      else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
    }
  });

  it.each([
    ['blueprint', 'plan-mode/blueprint'],
    ['data_model', 'plan-mode/data-model'],
    ['feature_plan', 'plan-mode/feature-plan'],
  ] as const)('rejects %s Status generation when the Plan Mode capability is disabled', async (capability, endpointPath) => {
    vi.spyOn(generalSettings, 'readGeneralSettings').mockReturnValue({
      ...generalSettings.DEFAULT_GENERAL_SETTINGS,
      planMode: {
        capabilities: {
          ...generalSettings.DEFAULT_GENERAL_SETTINGS.planMode.capabilities,
          [capability]: false,
        },
      },
    });

    try {
      const createdRepo = await repo.createRepository({
        name: `TEST: Disabled ${capability} ${crypto.randomUUID()}`,
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      });
      const task = await repo.createTask({
        repositoryId: createdRepo.id,
        title: `TEST: Disabled ${capability} target`,
        description: 'Generate Status artifact',
        status: 'draft',
      });

      const res = await app.request(`http://localhost/api/tasks/${task.id}/${endpointPath}`, {
        method: 'POST',
        headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error?.code ?? body.code).toBe('PLAN_MODE_CAPABILITY_DISABLED');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('generates Blueprint and Feature Plan without requiring a Questionnaire session', async () => {
    const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
    const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
    const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
    process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';

    try {
      const createdRepo = await repo.createRepository({
        name: `TEST: Optional Questionnaire ${crypto.randomUUID()}`,
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      });
      const task = await repo.createTask({
        repositoryId: createdRepo.id,
        title: 'TEST: Optional questionnaire target',
        description: 'Generate Plan Mode artifacts from task context only',
        status: 'draft',
      });

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify(representativeMockBlueprint);
      const blueprintRes = await app.request(
        `http://localhost/api/tasks/${task.id}/plan-mode/blueprint`,
        {
          method: 'POST',
          headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      expect(blueprintRes.status).toBe(200);
      const blueprintBody = await blueprintRes.json();
      expect(blueprintBody.message.metadataJson).toMatchObject({
        intent: 'mock_blueprint',
        source: 'status',
        questionnaireSessionId: null,
        generation: {
          llmUsage: expect.objectContaining({
            label: 'mock_blueprint',
            totalTokens: expect.any(Number),
          }),
        },
      });

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
        title: 'Questionnaire Optional Feature Plan',
        content: [
          '# Questionnaire Optional Feature Plan',
          '',
          '## Goal',
          'Task contextだけから初期実装可能なFeature Planを作る。',
        ].join('\n'),
      });
      const featurePlanRes = await app.request(
        `http://localhost/api/tasks/${task.id}/plan-mode/feature-plan`,
        {
          method: 'POST',
          headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ reviewAfterGenerate: false }),
        }
      );
      expect(featurePlanRes.status).toBe(200);
      const featurePlanBody = await featurePlanRes.json();
      expect(featurePlanBody.message.metadataJson).toMatchObject({
        intent: 'feature_plan',
        source: 'status',
        questionnaireSessionId: null,
      });
      expect(featurePlanBody.message.content).toContain('# Questionnaire Optional Feature Plan');
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

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
        action: 'ready_for_design_assembly',
        rationale: 'The selected release scope and roles are enough for design assembly.',
        questionnaire: null,
      });

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
      expect(
        answeredSession.answers.map((answer: unknown) => answer.answer.selectedOptionIds)
      ).toEqual([['q1-o1'], ['q2-o1', 'q2-o2']]);
    } finally {
      if (originalProvider === undefined) delete process.env.ACTIVE_LLM_PROVIDER;
      else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
      if (originalFixture === undefined) delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
      else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
      if (originalSettingsPath === undefined) delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
      else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
    }
  });

  it('continues Design Questionnaire with LLM follow-up questions before Design Assembly', async () => {
    const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
    const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
    const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
    process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';

    try {
      const createdRepo = await repo.createRepository({
        name: `TEST: Follow-up Questionnaire ${crypto.randomUUID()}`,
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      });
      const task = await repo.createTask({
        repositoryId: createdRepo.id,
        title: 'TEST: Follow-up questionnaire target',
        description: 'Generate follow-up questionnaire',
        status: 'draft',
      });

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
        title: '実装前に決めたいこと',
        questions: [
          {
            text: '初期リリースの主目的はどれですか？',
            type: 'radio',
            options: ['予約管理', '顧客管理', '売上確認'],
          },
        ],
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

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
        action: 'follow_up',
        rationale: 'The primary purpose is known, but the first slice boundary is still ambiguous.',
        questionnaire: {
          title: '追加で決めたいこと',
          questions: [
            {
              text: '初期リリースの予約範囲はどこまでにしますか？',
              type: 'radio',
              options: ['作成のみ', '作成と変更', '作成・変更・キャンセル'],
            },
          ],
        },
      });

      const firstAnswersRes = await app.request(
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
            ],
          }),
        }
      );
      expect(firstAnswersRes.status).toBe(200);
      const followUpSession = await firstAnswersRes.json();
      expect(followUpSession.status).toBe('answering');
      expect(followUpSession.questionSets).toHaveLength(2);
      expect(followUpSession.questionSets[1].questionnaire.questionSets[0].questions[0].id).toBe(
        'follow-up-2-q1'
      );

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
        action: 'ready_for_design_assembly',
        rationale: 'The initial release boundary is now clear enough.',
        questionnaire: null,
      });

      const followUpAnswersRes = await app.request(
        `http://localhost/api/tasks/${task.id}/design-questionnaire/${session.id}/answers`,
        {
          method: 'POST',
          headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers: [
              {
                questionId: 'follow-up-2-q1',
                selectedOptionIds: ['follow-up-2-q1-o2'],
                rankedOptionIds: [],
                deferred: false,
              },
            ],
          }),
        }
      );
      expect(followUpAnswersRes.status).toBe(200);
      expect((await followUpAnswersRes.json()).status).toBe('review_ready');
    } finally {
      if (originalProvider === undefined) delete process.env.ACTIVE_LLM_PROVIDER;
      else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
      if (originalFixture === undefined) delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
      else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
      if (originalSettingsPath === undefined) delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
      else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
    }
  });

  it('stops Design Questionnaire follow-up after four pages', async () => {
    const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
    const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
    const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
    process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';

    try {
      const createdRepo = await repo.createRepository({
        name: `TEST: Four Page Questionnaire ${crypto.randomUUID()}`,
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      });
      const task = await repo.createTask({
        repositoryId: createdRepo.id,
        title: 'TEST: Four page questionnaire target',
        description: 'Generate follow-up questionnaire until the page limit',
        status: 'draft',
      });

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
        title: '実装前に決めたいこと',
        questions: [
          {
            text: '初期スコープはどれですか？',
            type: 'radio',
            options: ['最小構成', '標準構成', '拡張構成'],
          },
        ],
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

      async function answerAndRequestFollowUp(questionId: string, optionId: string, page: number) {
        const options = [`${page}-A`, `${page}-B`, `${page}-C`];
        process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
          action: 'follow_up',
          rationale: `Page ${page} still leaves another dependent decision open.`,
          questionnaire: {
            title: `追加確認 ${page}`,
            questions: [
              {
                text: `追加確認 ${page} はどれですか？`,
                type: 'radio',
                options,
              },
            ],
          },
        });
        const res = await app.request(
          `http://localhost/api/tasks/${task.id}/design-questionnaire/${session.id}/answers`,
          {
            method: 'POST',
            headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              answers: [
                {
                  questionId,
                  selectedOptionIds: [optionId],
                  rankedOptionIds: [],
                  deferred: false,
                },
              ],
            }),
          }
        );
        expect(res.status).toBe(200);
        return res.json();
      }

      let currentSession = await answerAndRequestFollowUp('q1', 'q1-o1', 2);
      expect(currentSession.status).toBe('answering');
      expect(currentSession.questionSets).toHaveLength(2);

      currentSession = await answerAndRequestFollowUp('follow-up-2-q1', 'follow-up-2-q1-o1', 3);
      expect(currentSession.status).toBe('answering');
      expect(currentSession.questionSets).toHaveLength(3);

      currentSession = await answerAndRequestFollowUp('follow-up-3-q1', 'follow-up-3-q1-o1', 4);
      expect(currentSession.status).toBe('answering');
      expect(currentSession.questionSets).toHaveLength(4);

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
        action: 'follow_up',
        rationale: 'This should be ignored because the page limit is reached.',
        questionnaire: {
          title: '追加確認 5',
          questions: [
            {
              text: '5ページ目の質問は作られますか？',
              type: 'radio',
              options: ['はい', 'いいえ'],
            },
          ],
        },
      });
      const limitRes = await app.request(
        `http://localhost/api/tasks/${task.id}/design-questionnaire/${session.id}/answers`,
        {
          method: 'POST',
          headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers: [
              {
                questionId: 'follow-up-4-q1',
                selectedOptionIds: ['follow-up-4-q1-o1'],
                rankedOptionIds: [],
                deferred: false,
              },
            ],
          }),
        }
      );
      expect(limitRes.status).toBe(200);
      currentSession = await limitRes.json();
      expect(currentSession.status).toBe('review_ready');
      expect(currentSession.questionSets).toHaveLength(4);
    } finally {
      if (originalProvider === undefined) delete process.env.ACTIVE_LLM_PROVIDER;
      else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
      if (originalFixture === undefined) delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
      else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
      if (originalSettingsPath === undefined) delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
      else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
    }
  });

  it('treats empty checkbox answers as none-needed and blocks duplicate follow-up questions', async () => {
    const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
    const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
    const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
    process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';

    try {
      const createdRepo = await repo.createRepository({
        name: `TEST: Duplicate Follow-up ${crypto.randomUUID()}`,
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      });
      const task = await repo.createTask({
        repositoryId: createdRepo.id,
        title: 'TEST: Duplicate follow-up target',
        description: 'Avoid duplicate follow-up questions',
        status: 'draft',
      });

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
        title: '実装前に決めたいこと',
        questions: [
          {
            text: '初期リリースで含めたい運用機能はどれですか？',
            type: 'checkbox',
            options: ['並び順の保存', 'アーカイブ', 'ラベル', '期限日', 'コメント', '通知'],
          },
        ],
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

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
        action: 'follow_up',
        rationale: 'Duplicate question should be suppressed by the server.',
        questionnaire: {
          title: '追加確認フォーム',
          questions: [
            {
              text: '初期リリースに含める運用機能を選んでください。',
              type: 'checkbox',
              options: ['並び順の保存', 'アーカイブ', 'ラベル', '期限日', 'コメント', '通知'],
            },
          ],
        },
      });
      const answersRes = await app.request(
        `http://localhost/api/tasks/${task.id}/design-questionnaire/${session.id}/answers`,
        {
          method: 'POST',
          headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers: [
              {
                questionId: 'q1',
                selectedOptionIds: [],
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
      expect(answeredSession.questionSets).toHaveLength(1);
    } finally {
      if (originalProvider === undefined) delete process.env.ACTIVE_LLM_PROVIDER;
      else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
      if (originalFixture === undefined) delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
      else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
      if (originalSettingsPath === undefined) delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
      else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
    }
  });

  it('carries answered questions forward and drops same-axis follow-up questions', async () => {
    const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
    const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
    const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
    process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';

    try {
      const createdRepo = await repo.createRepository({
        name: `TEST: Answered Axis Follow-up ${crypto.randomUUID()}`,
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      });
      const task = await repo.createTask({
        repositoryId: createdRepo.id,
        title: 'TEST: Answered axis follow-up target',
        description: 'Avoid regenerating already answered questionnaire axes',
        status: 'draft',
      });

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
        title: '実装前に決めたいこと',
        questions: [
          {
            text: '運用・保存の前提はどれですか？',
            type: 'radio',
            options: [
              'ローカル開発のみ',
              'Docker 前提',
              'クラウド配置前提',
              'バックアップや移行も考慮',
              '未定',
            ],
          },
          {
            text: '今回の実装はどの技術スタックの前提ですか？',
            type: 'radio',
            options: [
              'Hono + React/Vite',
              'Python/FastAPI + React/Vite',
              '既存リポジトリの標準に合わせる',
            ],
          },
        ],
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

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
        action: 'follow_up',
        rationale:
          'The fixture intentionally repeats answered axes before one genuinely new question.',
        questionnaire: {
          title: '追加確認フォーム',
          questions: [
            {
              text: 'この機能の実行・配置先はどれですか？',
              type: 'radio',
              options: [
                'ローカル専用の Web アプリ',
                'Docker で動かす self-hosted',
                'クラウド配置前提',
                '将来切り替えられる前提',
                '未定',
              ],
            },
            {
              text: 'データの保存と復旧はどこまで必要ですか？',
              type: 'radio',
              options: [
                'ローカル SQLite の永続保存のみ',
                'エクスポート / インポートが必要',
                '定期バックアップや復元を考慮',
                '保存は最小限で、復旧は不要',
                '未定',
              ],
            },
            {
              text: '単一ユーザー前提は維持しますか？',
              type: 'radio',
              options: [
                '個人利用の単一ユーザー',
                '同一端末で複数プロフィール',
                '将来の複数ユーザーを見据える',
                '複数ユーザーは今回扱わない',
                '未定',
              ],
            },
          ],
        },
      });

      const answersRes = await app.request(
        `http://localhost/api/tasks/${task.id}/design-questionnaire/${session.id}/answers`,
        {
          method: 'POST',
          headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers: [
              {
                questionId: 'q1',
                selectedOptionIds: ['q1-o5'],
                rankedOptionIds: [],
                deferred: false,
              },
              {
                questionId: 'q2',
                selectedOptionIds: ['q2-o1'],
                rankedOptionIds: [],
                deferred: false,
              },
            ],
          }),
        }
      );
      expect(answersRes.status).toBe(200);
      const answeredSession = await answersRes.json();
      const followUpQuestions =
        answeredSession.questionSets[1]?.questionnaire?.questionSets[0]?.questions || [];

      expect(answeredSession.status).toBe('answering');
      expect(followUpQuestions.map((question: { question: unknown }) => question.question)).toEqual(
        ['単一ユーザー前提は維持しますか？']
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

  it('generates Blueprint, Data Model, and Specification from Status', async () => {
    const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
    const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
    const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
    process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';

    try {
      const createdRepo = await repo.createRepository({
        name: `TEST: Status ${crypto.randomUUID()}`,
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      });
      const task = await repo.createTask({
        repositoryId: createdRepo.id,
        title: 'TEST: Specification status target',
        description: 'Generate artifacts from completed questionnaire',
        status: 'draft',
      });

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
        title: '実装前に決めたいこと',
        questions: [
          {
            text: '最初に作る画面はどれですか？',
            type: 'radio',
            options: ['業務ダッシュボード', '入力フォーム', '一覧管理'],
          },
        ],
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

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
        action: 'ready_for_design_assembly',
        rationale: 'The first screen decision is enough to generate artifacts.',
        questionnaire: null,
      });
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
            ],
          }),
        }
      );
      expect(answersRes.status).toBe(200);
      expect((await answersRes.json()).status).toBe('review_ready');

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify(representativeMockBlueprint);
      const blueprintRes = await app.request(
        `http://localhost/api/tasks/${task.id}/plan-mode/blueprint`,
        {
          method: 'POST',
          headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionnaireSessionId: session.id }),
        }
      );
      expect(blueprintRes.status).toBe(200);
      const blueprintBody = await blueprintRes.json();
      expect(blueprintBody.message.metadataJson).toMatchObject({
        intent: 'mock_blueprint',
        source: 'status',
        questionnaireSessionId: session.id,
      });
      let messages = await repo.listTaskMessages(task.id);
      expect(messages.some((message) => message.metadataJson?.intent === 'draft_spec')).toBe(false);

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify(representativeDataModelArtifact);
      const dataModelRes = await app.request(
        `http://localhost/api/tasks/${task.id}/plan-mode/data-model`,
        {
          method: 'POST',
          headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            questionnaireSessionId: session.id,
            sourceBlueprintMessageId: blueprintBody.message.id,
          }),
        }
      );
      expect(dataModelRes.status).toBe(200);
      expect((await dataModelRes.json()).message.metadataJson).toMatchObject({
        intent: 'plan_mode_dedicated_view',
        source: 'data-model',
        view: 'data_model',
        artifactType: 'data_model',
        questionnaireSessionId: session.id,
      });
      messages = await repo.listTaskMessages(task.id);
      expect(messages.some((message) => message.metadataJson?.intent === 'draft_spec')).toBe(false);

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
        title: 'Kanban Specification',
        content: [
          '# Kanban Specification',
          '',
          '## 1. 目的',
          'Operations Command Center を初期実装する。',
          '',
          '## 3. 画面仕様',
          'Operations Command Center',
          '',
          '## 4. 機能要件',
          'カード操作を提供する。',
          '',
          '## 5. データ/API 方針',
          'CREATE TABLE decision_items (id TEXT PRIMARY KEY);',
          '',
          '## Appendix. Questionnaire Decisions',
          '最初に作る画面はどれですか？',
        ].join('\n'),
      });
      const docRes = await app.request(
        `http://localhost/api/tasks/${task.id}/plan-mode/feature-plan`,
        {
          method: 'POST',
          headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionnaireSessionId: session.id }),
        }
      );
      expect(docRes.status).toBe(200);
      const docBody = await docRes.json();
      expect(docBody.message).toMatchObject({
        messageType: 'markdown_document',
        metadataJson: {
          intent: 'feature_plan',
          source: 'status',
          questionnaireSessionId: session.id,
        },
      });
      expect(docBody.message.content).toContain('## 1. 目的');
      expect(docBody.message.content).toContain('## 3. 画面仕様');
      expect(docBody.message.content).toContain('Operations Command Center');
      expect(docBody.message.content).toContain('## 4. 機能要件');
      expect(docBody.message.content).toContain('## 5. データ/API 方針');
      expect(docBody.message.content).toContain('## Appendix. Questionnaire Decisions');
      expect(docBody.message.metadataJson.generation).toMatchObject({
        source: 'llm',
        context: {
          blueprintSummaryIncluded: true,
          dataModelReferenceIncluded: true,
        },
      });
      expect(docBody.reviewedMessage).toMatchObject({
        messageType: 'markdown_document',
        metadataJson: {
          intent: 'feature_plan',
          source: 'status_document_review',
          reviewedSourceMessageId: docBody.message.id,
          questionnaireSessionId: session.id,
        },
      });
      expect(docBody.reviewedMessage.metadataJson.generation.reviewPrompt).toBe(
        'ドキュメントレビューをしてください。改善するべき点が無くなるまで改善してください'
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

  it('mechanically answers generated questionnaire pages 1-4 before assembling a design document', async () => {
    const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
    const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
    const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
    process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';

    try {
      const createdRepo = await repo.createRepository({
        name: `TEST: Mechanical Design Flow ${crypto.randomUUID()}`,
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      });
      const task = await repo.createTask({
        repositoryId: createdRepo.id,
        title: 'TEST: Mechanical design document flow',
        description: 'Generate a design document after mechanically answering LLM questions',
        status: 'draft',
      });

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
        version: 1,
        source: {
          taskId: task.id,
          repositoryId: createdRepo.id,
          sourceKind: 'plan_mode_intake',
        },
        title: 'Mechanical Flow Questionnaire',
        summary: 'Synthetic questionnaire with all supported answer types.',
        questionSets: [
          {
            id: 'page-one',
            title: 'Page 1',
            category: 'Scope',
            purpose: 'Cover answer generation without semantic accuracy.',
            questions: [
              {
                id: 'primary-screen',
                topic: 'Screen',
                question: 'Which screen should be designed first?',
                why: 'The first screen drives the design document outline.',
                answerType: 'single_choice',
                recommendedAnswerId: 'dashboard',
                options: [
                  { id: 'dashboard', label: 'Dashboard', tradeoff: 'Fast overview.' },
                  { id: 'form', label: 'Form', tradeoff: 'More input detail.' },
                ],
                blocks: ['Initial screen specification'],
                outputSection: 'Screen design',
              },
              {
                id: 'included-features',
                topic: 'Features',
                question: 'Which supporting features should be included?',
                why: 'Feature selection affects scope.',
                answerType: 'multi_choice',
                options: [
                  { id: 'search', label: 'Search', tradeoff: 'Adds filtering work.' },
                  { id: 'archive', label: 'Archive', tradeoff: 'Adds lifecycle state.' },
                ],
                blocks: ['Feature list'],
                outputSection: 'Functional requirements',
              },
              {
                id: 'needs-auth',
                topic: 'Auth',
                question: 'Does the first version need authentication?',
                why: 'Authentication changes routes and data model assumptions.',
                answerType: 'boolean',
                blocks: ['Auth policy'],
                outputSection: 'Non-functional requirements',
              },
              {
                id: 'success-copy',
                topic: 'Copy',
                question: 'What short success copy should be shown?',
                why: 'Copy helps verify free text answers are accepted.',
                answerType: 'free_text',
                blocks: ['UI copy'],
                outputSection: 'UI details',
              },
              {
                id: 'priority-order',
                topic: 'Priority',
                question: 'Rank implementation priorities.',
                why: 'The sequence shapes the implementation section.',
                answerType: 'ranked',
                options: [
                  { id: 'model', label: 'Data model', tradeoff: 'Stabilizes API.' },
                  { id: 'ui', label: 'UI', tradeoff: 'Validates workflow.' },
                ],
                blocks: ['Implementation order'],
                outputSection: 'Implementation plan',
              },
            ],
          },
        ],
        openQuestions: [],
        dataModelHandoffNotes: [],
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
      let session = await createRes.json();
      expect(session.status).toBe('answering');
      expect(session.questionSets).toHaveLength(1);

      async function answerCurrentPageWith(nextFixture: unknown) {
        process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify(nextFixture);
        const answers = buildMechanicalQuestionnaireAnswers(session);
        expect(answers.length).toBeGreaterThan(0);
        const res = await app.request(
          `http://localhost/api/tasks/${task.id}/design-questionnaire/${session.id}/answers`,
          {
            method: 'POST',
            headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ answers }),
          }
        );
        expect(res.status).toBe(200);
        session = await res.json();
        return session;
      }

      await answerCurrentPageWith({
        action: 'follow_up',
        rationale: 'Page 2 is needed to cover a generated follow-up.',
        questionnaire: {
          title: 'Page 2',
          questions: [
            {
              text: 'Which density should the design use?',
              type: 'radio',
              options: ['Compact', 'Comfortable', 'Spacious'],
            },
          ],
        },
      });
      expect(session.status).toBe('answering');
      expect(session.questionSets).toHaveLength(2);

      await answerCurrentPageWith({
        action: 'follow_up',
        rationale: 'Page 3 is needed for another generated follow-up.',
        questionnaire: {
          title: 'Page 3',
          questions: [
            {
              text: 'Which states should be visible?',
              type: 'checkbox',
              options: ['Empty', 'Loading', 'Error', 'Success'],
            },
          ],
        },
      });
      expect(session.status).toBe('answering');
      expect(session.questionSets).toHaveLength(3);

      await answerCurrentPageWith({
        action: 'follow_up',
        rationale: 'Page 4 is the final follow-up page.',
        questionnaire: {
          title: 'Page 4',
          questions: [
            {
              text: 'Which implementation risk should the document mention?',
              type: 'radio',
              options: ['Data drift', 'Slow loading', 'Permission mismatch'],
            },
          ],
        },
      });
      expect(session.status).toBe('answering');
      expect(session.questionSets).toHaveLength(4);

      await answerCurrentPageWith({
        action: 'ready_for_design_assembly',
        rationale: 'The synthetic answers are enough for design assembly.',
        questionnaire: null,
      });
      expect(session.status).toBe('review_ready');
      expect(session.answers.length).toBeGreaterThanOrEqual(8);

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify(representativeMockBlueprint);
      const blueprintRes = await app.request(
        `http://localhost/api/tasks/${task.id}/plan-mode/blueprint`,
        {
          method: 'POST',
          headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionnaireSessionId: session.id }),
        }
      );
      expect(blueprintRes.status).toBe(200);
      const blueprintBody = await blueprintRes.json();
      expect(blueprintBody.message.metadataJson).toMatchObject({
        intent: 'mock_blueprint',
        questionnaireSessionId: session.id,
      });

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify(representativeDataModelArtifact);
      const dataModelRes = await app.request(
        `http://localhost/api/tasks/${task.id}/plan-mode/data-model`,
        {
          method: 'POST',
          headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            questionnaireSessionId: session.id,
            sourceBlueprintMessageId: blueprintBody.message.id,
          }),
        }
      );
      expect(dataModelRes.status).toBe(200);
      expect((await dataModelRes.json()).message.metadataJson).toMatchObject({
        source: 'data-model',
        view: 'data_model',
        questionnaireSessionId: session.id,
      });

      process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
        title: 'Mechanical Design Document',
        content: [
          '# Mechanical Design Document',
          '',
          '## 1. 目的',
          'Generated questionnaire answers are enough to assemble the first design document.',
          '',
          '## 2. 決定事項',
          'Mechanically selected answers are treated as provisional decisions.',
          '',
          '## 3. 画面仕様',
          'Operations Command Center',
          '',
          '## 4. 機能要件',
          'Search and lifecycle controls are included.',
          '',
          '## Appendix. Questionnaire Decisions',
          'Which screen should be designed first?',
        ].join('\n'),
      });
      const docRes = await app.request(
        `http://localhost/api/tasks/${task.id}/plan-mode/feature-plan`,
        {
          method: 'POST',
          headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionnaireSessionId: session.id }),
        }
      );
      expect(docRes.status).toBe(200);
      const docBody = await docRes.json();
      expect(docBody.message).toMatchObject({
        messageType: 'markdown_document',
        metadataJson: {
          intent: 'feature_plan',
          questionnaireSessionId: session.id,
        },
      });
      expect(docBody.message.content).toContain('## 1. 目的');
      expect(docBody.message.content).toContain('## 4. 機能要件');
      expect(docBody.message.content).toContain('## Appendix. Questionnaire Decisions');
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
        dataModelHandoffNotes: ['ボード、列、カードの正規化方針を Data Model で決める。'],
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
      expect(questionnaire.dataModelHandoffNotes[0]).toMatchObject({
        id: 'data-model-note-1',
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
