import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import app from '../../../api/app';
import * as repo from '../../../api/modules/nightworkers/nightworkers.repository';
import * as generalSettings from '../../../api/services/settings/general-settings';
import { representativeDataModelArtifact, sameOriginHeaders } from './helpers';
import './setup';

describe('NightWorkers task routes questionnaire core', () => {
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
});
