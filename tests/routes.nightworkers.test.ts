import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import app from '../api/app';
import { ensureNightWorkersSchema } from '../api/db/bootstrap';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import { recordLlmUsage } from '../api/services/llm-usage';
import { upsertPricingRow } from '../api/services/pricing';

const sameOriginHeaders = { Origin: 'http://localhost:39174' };

beforeAll(async () => {
  await ensureNightWorkersSchema();
});

describe('NightWorkers repositories routes', () => {
  it('registers a workspace repository successfully with valid data', async () => {
    const res = await app.request('http://localhost/api/repositories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'TEST: Valid Workspace',
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.name).toBe('TEST: Valid Workspace');
    expect(body.localPath).toBe('/Users/y.noguchi/Code/nightWorkers');
  });

  it('returns 400 Bad Request if name is missing', async () => {
    const res = await app.request('http://localhost/api/repositories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 Bad Request if localPath is missing', async () => {
    const res = await app.request('http://localhost/api/repositories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'TEST: Missing Path Workspace',
        branch: 'main',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('deletes a workspace repository successfully', async () => {
    const createRes = await app.request('http://localhost/api/repositories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'TEST: To Be Deleted',
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      }),
    });
    expect(createRes.status).toBe(201);
    const repo = await createRes.json();

    const deleteRes = await app.request(`http://localhost/api/repositories/${repo.id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    expect(deleteRes.status).toBe(200);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.id).toBe(repo.id);

    const getRes = await app.request(`http://localhost/api/repositories/${repo.id}`, {
      method: 'GET',
    });
    expect(getRes.status).toBe(404);
  });

  it('updates project external path grants through safety policy', async () => {
    const createRes = await app.request('http://localhost/api/repositories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `TEST: External grant ${crypto.randomUUID()}`,
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const patchRes = await app.request(`http://localhost/api/repositories/${created.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        safetyPolicy: {
          externalAllowedPaths: ['/Users/y.noguchi/Code/hono-standard'],
        },
      }),
    });

    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.safetyPolicy.externalAllowedPaths).toContain(
      '/Users/y.noguchi/Code/hono-standard'
    );
  });
});

describe('NightWorkers task routes', () => {
  it('returns an overview dashboard with usage, model mix, and estimated cost', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: Overview ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: Overview target',
      description: 'Overview usage',
      status: 'draft',
    });
    await upsertPricingRow({
      provider: 'openai',
      model: 'test-priced-model',
      currencyCode: 'JPY',
      inputPer1m: 100,
      cachedInputPer1m: 10,
      outputPer1m: 200,
      sourceLabel: 'test',
      manualOverride: true,
      enabled: true,
    });
    await recordLlmUsage({
      taskId: task.id,
      callId: crypto.randomUUID(),
      provider: 'openai',
      model: 'test-priced-model',
      label: 'test-call',
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        cachedInputTokens: 100,
        reasoningOutputTokens: null,
        totalTokens: 1500,
        mode: 'measured',
      },
      durationMs: 12,
    });

    const res = await app.request(
      `http://localhost/api/overview?range=30d&repositoryId=${createdRepo.id}&currency=JPY`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.usage.inputTokens).toBeGreaterThanOrEqual(1000);
    expect(body.usage.promptInputTokens).toBeGreaterThanOrEqual(0);
    expect(body.cost.estimatedTotal).toBeGreaterThan(0);
    expect(body.modelBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'openai',
          model: 'test-priced-model',
          pricingStatus: 'manual',
        }),
      ])
    );
  });

  it('persists task messages into activity ledger and replays them by task cursor', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: Activity Message ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: Activity message target',
      description: 'Persist activity message',
      status: 'draft',
    });

    const message = await repo.createTaskMessage({
      taskId: task.id,
      role: 'tool',
      content: 'tool output',
      messageType: 'text',
      payloadJson: { raw: 'result' },
    });

    const res = await app.request(`http://localhost/api/tasks/${task.id}/activity-events`);
    expect(res.status).toBe(200);
    const replay = await res.json();
    expect(replay.artifacts).toEqual([]);
    const events = replay.events;
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: task.id,
          kind: 'tool.result',
          source: 'tool',
          text: 'tool output',
          externalId: message.id,
        }),
      ])
    );

    const afterRes = await app.request(
      `http://localhost/api/tasks/${task.id}/activity-events?afterSeq=1`
    );
    expect(afterRes.status).toBe(200);
    expect(await afterRes.json()).toEqual({ events: [], artifacts: [] });
  });

  it('persists Blueprint document messages as activity artifacts', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: Activity Blueprint ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: Activity blueprint target',
      description: 'Persist activity blueprint',
      status: 'draft',
    });

    const message = await repo.createTaskMessage({
      taskId: task.id,
      role: 'assistant',
      content: '# App Blueprint',
      messageType: 'markdown_document',
      payloadJson: {
        intent: 'app_blueprint',
        title: 'Inventory App',
        appBlueprint: { id: 'inventory-app', name: 'Inventory App' },
        validation: { valid: true, issues: [] },
      },
    });

    const res = await app.request(`http://localhost/api/tasks/${task.id}/activity-events`);
    expect(res.status).toBe(200);
    const replay = await res.json();
    expect(replay.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'app_blueprint',
          path: `${message.id}.app-blueprint.json`,
          metadataJson: expect.objectContaining({
            messageId: message.id,
            intent: 'app_blueprint',
            appBlueprint: expect.objectContaining({ name: 'Inventory App' }),
          }),
        }),
      ])
    );
    expect(replay.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'system.info',
          source: 'assistant',
          artifactId: expect.any(String),
          payloadJson: expect.objectContaining({
            metadata: expect.objectContaining({ intent: 'app_blueprint' }),
          }),
        }),
      ])
    );
  });

  it('does not persist response deltas into the activity ledger', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: Activity Run Event ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: Activity run event target',
      description: 'Persist activity run event',
      status: 'draft',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'running',
    });

    await repo.createRunEvent({
      version: 1,
      runId: run.id,
      timestamp: new Date().toISOString(),
      type: 'model.response_delta',
      severity: 'info',
      actor: 'supervisor',
      message: 'delta text',
    });

    const res = await app.request(`http://localhost/api/runs/${run.id}/activity-events`);
    expect(res.status).toBe(200);
    const replay = await res.json();
    expect(replay.artifacts).toEqual([]);
    expect(replay.events).toEqual([]);
  });

  it('maps schema-first agent events into chat activity kinds without duplicating final answers', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: Schema-first Activity ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: Schema-first activity target',
      description: 'Persist schema-first activity',
      status: 'draft',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'running',
    });

    await repo.createRunEvent(
      {
        version: 1,
        runId: run.id,
        taskId: task.id,
        timestamp: new Date().toISOString(),
        type: 'supervisor.decision',
        severity: 'info',
        actor: 'supervisor',
        message: '[SchemaFirstAgent] round2.parsed',
      },
      {
        payloadJson: {
          agentEventType: 'round2.parsed',
          payload: {
            toolCall: {
              name: 'apply_patch',
              arguments: { patchContent: 'diff --git a/a b/a' },
            },
          },
        },
      }
    );
    await repo.createRunEvent(
      {
        version: 1,
        runId: run.id,
        taskId: task.id,
        timestamp: new Date().toISOString(),
        type: 'system.info',
        severity: 'debug',
        actor: 'runtime',
        message: '[SchemaFirstAgent] skill.loaded',
      },
      {
        payloadJson: {
          agentEventType: 'skill.loaded',
          payload: {
            skillPath: 'skills/minor_code_edit.md',
            skill: '# minor_code_edit\n\n## Procedure\n1. read_file',
          },
        },
      }
    );
    await repo.createRunEvent(
      {
        version: 1,
        runId: run.id,
        taskId: task.id,
        timestamp: new Date().toISOString(),
        type: 'system.info',
        severity: 'info',
        actor: 'runtime',
        message: '[SchemaFirstAgent] finalize.received',
      },
      {
        payloadJson: {
          agentEventType: 'finalize.received',
          payload: { message: '完了しました。' },
        },
      }
    );

    const res = await app.request(`http://localhost/api/runs/${run.id}/activity-events`);
    expect(res.status).toBe(200);
    const replay = await res.json();
    expect(replay.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: task.id,
          runId: run.id,
          kind: 'llm.schema_result',
          turnId: `assistant:${run.id}`,
          text: expect.stringContaining('apply_patch'),
          payloadJson: expect.objectContaining({
            agentEventType: 'round2.parsed',
          }),
        }),
        expect.objectContaining({
          taskId: task.id,
          runId: run.id,
          kind: 'runtime.state',
          turnId: `assistant:${run.id}`,
          text: 'skills/minor_code_edit.md',
          payloadJson: expect.objectContaining({
            agentEventType: 'skill.loaded',
            payload: expect.objectContaining({
              skillPath: 'skills/minor_code_edit.md',
              skill: expect.stringContaining('# minor_code_edit'),
            }),
          }),
        }),
      ])
    );
    expect(
      replay.events.some((event: any) => event.payloadJson?.agentEventType === 'finalize.received')
    ).toBe(false);
  });

  it('persists Blueprint design settings per session', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: Blueprint Design Settings ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: Blueprint design settings target',
      description: 'Persist design token settings',
      status: 'draft',
    });

    const settings = {
      theme: 'mint',
      density: 'comfortable',
      shape: 'pill',
      shadow: 'strong',
      shadowDirection: '135deg',
      font: 'mono',
      contrast: 'high',
      motion: 'reduced',
      componentVariants: {
        button: 'outline',
        card: 'elevated',
        table: 'dense-grid',
        input: 'filled',
      },
    };

    const saveRes = await app.request(
      `http://localhost/api/tasks/${task.id}/blueprint-design-settings`,
      {
        method: 'PUT',
        headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      }
    );
    expect(saveRes.status).toBe(200);
    expect(await saveRes.json()).toMatchObject({
      sessionId: task.id,
      settings,
    });

    const getRes = await app.request(
      `http://localhost/api/tasks/${task.id}/blueprint-design-settings`,
      { headers: sameOriginHeaders }
    );
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({
      sessionId: task.id,
      settings,
    });
  });

  it('persists independent Blueprint adoption decisions per session message', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: Blueprint Adoption ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: Blueprint adoption target',
      description: 'Persist adoption states',
      status: 'draft',
    });
    const message = await repo.createTaskMessage({
      taskId: task.id,
      role: 'assistant',
      content: '# Blueprint',
      messageType: 'markdown_document',
      payloadJson: { intent: 'app_blueprint' },
    });

    const endpoints = [
      'blueprint-adoption',
      'blueprint-db-design-adoption',
      'blueprint-design-token-adoption',
    ];

    for (const endpoint of endpoints) {
      const initialRes = await app.request(
        `http://localhost/api/tasks/${task.id}/${endpoint}?messageId=${message.id}`,
        { headers: sameOriginHeaders }
      );
      expect(initialRes.status).toBe(200);
      expect(await initialRes.json()).toMatchObject({
        sessionId: task.id,
        messageId: message.id,
        adopted: false,
      });
    }

    const saveDbDesignRes = await app.request(
      `http://localhost/api/tasks/${task.id}/blueprint-db-design-adoption`,
      {
        method: 'PUT',
        headers: { ...sameOriginHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: message.id, adopted: true }),
      }
    );
    expect(saveDbDesignRes.status).toBe(200);
    expect(await saveDbDesignRes.json()).toMatchObject({
      sessionId: task.id,
      messageId: message.id,
      adopted: true,
    });

    const getBlueprintRes = await app.request(
      `http://localhost/api/tasks/${task.id}/blueprint-adoption?messageId=${message.id}`,
      { headers: sameOriginHeaders }
    );
    const getDbDesignRes = await app.request(
      `http://localhost/api/tasks/${task.id}/blueprint-db-design-adoption?messageId=${message.id}`,
      { headers: sameOriginHeaders }
    );
    const getDesignTokenRes = await app.request(
      `http://localhost/api/tasks/${task.id}/blueprint-design-token-adoption?messageId=${message.id}`,
      { headers: sameOriginHeaders }
    );

    expect(await getBlueprintRes.json()).toMatchObject({ adopted: false });
    expect(await getDbDesignRes.json()).toMatchObject({ adopted: true });
    expect(await getDesignTokenRes.json()).toMatchObject({ adopted: false });
  });

  it('creates a Design Questionnaire, saves answers, accepts a Decision Review, and aggregates workspace refs', async () => {
    const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
    const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
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
    } finally {
      if (originalProvider === undefined) delete process.env.ACTIVE_LLM_PROVIDER;
      else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
      if (originalFixture === undefined) delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
      else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
    }
  });

  it('stores schema-invalid Design Questionnaire raw output without replacing it', async () => {
    const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
    const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
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
    }
  });

  it('deletes a task and its dependent workbench data', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: Task Delete Workspace ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: Task delete target',
      description: 'Delete target',
      status: 'draft',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'completed',
      workerKind: 'native-local',
      timeoutSeconds: 60,
    });
    await repo.createTaskMessage({
      taskId: task.id,
      runId: run.id,
      role: 'user',
      content: 'Delete this task',
      messageType: 'text',
    });
    await repo.createRunEvent({
      version: 1,
      runId: run.id,
      taskId: task.id,
      timestamp: '2026-06-03T00:00:00.000Z',
      type: 'verification.finished',
      severity: 'checkpoint',
      actor: 'verifier',
      message: 'Verification finished',
      payload: {},
    });

    const deleteRes = await app.request(`http://localhost/api/tasks/${task.id}`, {
      method: 'DELETE',
      headers: sameOriginHeaders,
    });

    expect(deleteRes.status).toBe(200);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.id).toBe(task.id);
    expect(await repo.getTask(task.id)).toBeUndefined();
    expect(await repo.listTaskRunsForTask(task.id)).toEqual([]);
    expect(await repo.listTaskMessages(task.id)).toEqual([]);
  });
});

describe('NightWorkers reviewer evaluation routes', () => {
  it('persists agent reviewer evaluations without changing run status', async () => {
    const createdRepo = await repo.createRepository({
      name: 'TEST: Reviewer Route Workspace',
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: Reviewer task',
      description: 'Reviewer task description',
      status: 'needs_review',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'needs_review',
      workerKind: 'native-local',
      timeoutSeconds: 60,
      summary: 'ready for reviewer',
      finalReport: 'Task finished',
      startedAt: new Date('2026-06-02T00:00:00.000Z'),
    });
    await repo.updateTaskRun(run.id, {
      diffPatch: 'diff --git a/file.txt b/file.txt\n+done',
    });
    await repo.createRunEvent({
      version: 1,
      runId: run.id,
      taskId: task.id,
      timestamp: '2026-06-02T00:00:01.000Z',
      type: 'verification.finished',
      severity: 'checkpoint',
      actor: 'verifier',
      message: 'Verification passed',
      data: { passed: true, command: 'pnpm test' },
    });

    const listRes = await app.request('http://localhost/api/review-rubrics');
    expect(listRes.status).toBe(200);
    expect((await listRes.json()).map((rubric: any) => rubric.id)).toContain('basic-coding-run');

    const reviewRes = await app.request(
      `http://localhost/api/runs/${run.id}/reviewer-evaluations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rubricId: 'basic-coding-run',
          mode: 'deterministic_only',
          persist: true,
        }),
      }
    );

    expect(reviewRes.status).toBe(200);
    const body = await reviewRes.json();
    expect(body.reviewResult.reviewer.type).toBe('agent');
    expect(body.finalReviewerVerdict).toBe('approved');
    expect(body.reviewResult.statusBefore).toBe('needs_review');
    expect(body.reviewResult.statusAfter).toBe('needs_review');

    const latestRun = await repo.getTaskRun(run.id);
    expect(latestRun?.status).toBe('needs_review');
    const events = await repo.listTaskEventsForRun(run.id);
    expect(
      events.some(
        (event) => (event.payloadJson as any)?.runEvent?.type === 'review.evaluation_finished'
      )
    ).toBe(true);

    const replayRes = await app.request(
      `http://localhost/api/runs/${run.id}/reviewer-evaluations/replay`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rubricId: 'basic-coding-run', mode: 'deterministic_only' }),
      }
    );
    expect(replayRes.status).toBe(200);
    const replayBody = await replayRes.json();
    expect(replayBody.reviewResult.reviewer.type).toBe('agent');
    expect(replayBody.reviewResult.statusAfter).toBe('needs_review');

    const invalidReplayRes = await app.request(
      `http://localhost/api/runs/${run.id}/reviewer-evaluations/replay`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonl: '{not-json' }),
      }
    );
    expect(invalidReplayRes.status).toBe(400);
    expect((await invalidReplayRes.json()).code).toBe('INVALID_REPLAY_JSONL');
  });
});

describe('NightWorkers task run todo routes', () => {
  it('returns persisted todos with run details in sequence order', async () => {
    const createdRepo = await repo.createRepository({
      name: 'TEST: Todo Route Workspace',
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: Todo task',
      description: 'Todo task description',
      status: 'running',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'running',
      workerKind: 'native-local',
      timeoutSeconds: 60,
      startedAt: new Date('2026-06-02T00:00:00.000Z'),
    });

    const second = await repo.createTaskRunTodo({
      runId: run.id,
      seq: 2,
      title: 'Run verification',
      description: 'Check the implementation',
      taskType: 'verification',
      status: 'pending',
      dependsOn: [1],
    });
    const first = await repo.createTaskRunTodo({
      runId: run.id,
      seq: 1,
      title: 'Implement persistence',
      description: 'Add todo persistence',
      taskType: 'code_change',
      status: 'running',
      procedureId: 'code-change',
      procedureSnapshot: { id: 'code-change', digest: 'sha256:test' },
      contextSnapshot: { digest: 'context:test' },
    });

    await repo.updateTaskRunTodo(first.id, {
      status: 'passed',
      completionGateResult: { passed: true },
      completedAt: new Date('2026-06-02T00:01:00.000Z'),
    });

    const runDetailRes = await app.request(`http://localhost/api/runs/${run.id}`, {
      method: 'GET',
    });
    expect(runDetailRes.status).toBe(200);
    const runDetail = await runDetailRes.json();
    expect(runDetail.todos.map((todo: any) => todo.id)).toEqual([first.id, second.id]);
    expect(runDetail.todos[0]).toMatchObject({
      seq: 1,
      title: 'Implement persistence',
      taskType: 'code_change',
      status: 'passed',
      procedureId: 'code-change',
      procedureSnapshot: { id: 'code-change', digest: 'sha256:test' },
      contextSnapshot: { digest: 'context:test' },
      completionGateResult: { passed: true },
      dependsOn: [],
    });
    expect(runDetail.todos[1]).toMatchObject({
      seq: 2,
      taskType: 'verification',
      status: 'pending',
      dependsOn: [1],
    });
  });

  it('enforces one todo per run sequence and cascades todos with run deletion', async () => {
    const createdRepo = await repo.createRepository({
      name: 'TEST: Todo Constraint Workspace',
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: Todo constraint task',
      status: 'running',
    });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: createdRepo.id,
      status: 'running',
      workerKind: 'native-local',
      timeoutSeconds: 60,
    });

    await repo.createTaskRunTodo({
      runId: run.id,
      seq: 1,
      title: 'Only first seq',
      taskType: 'investigation',
    });

    await expect(
      repo.createTaskRunTodo({
        runId: run.id,
        seq: 1,
        title: 'Duplicate seq',
        taskType: 'verification',
      })
    ).rejects.toThrow();

    await repo.deleteTask(task.id);
    expect(await repo.listTaskRunTodosForRun(run.id)).toEqual([]);
  });

  it('returns task LLM token usage summary', async () => {
    const createdRepo = await repo.createRepository({
      name: `TEST: LLM Usage ${crypto.randomUUID()}`,
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });
    const task = await repo.createTask({
      repositoryId: createdRepo.id,
      title: 'TEST: LLM usage task',
      status: 'draft',
    });

    await recordLlmUsage({
      taskId: task.id,
      runId: null,
      callId: crypto.randomUUID(),
      provider: 'openai',
      model: 'gpt-test',
      label: 'supervisor',
      round: 1,
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 10,
        reasoningOutputTokens: 4,
        totalTokens: 120,
        mode: 'measured',
        rawUsage: { prompt_tokens: 100, completion_tokens: 20 },
      },
      promptPartTokenEstimates: {
        systemPromptTokens: 30,
        userPromptTokens: 70,
        stateCardTokens: 12,
      },
      durationMs: 42,
    });

    const res = await app.request(`http://localhost/api/tasks/${task.id}/llm-usage`, {
      headers: sameOriginHeaders,
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      taskId: task.id,
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 10,
      reasoningOutputTokens: 4,
      totalTokens: 120,
      stateCardTokens: 12,
      usageMode: 'mixed',
      callCount: 1,
      measuredCallCount: 1,
      estimatedCallCount: 0,
    });
  });
});
