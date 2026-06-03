import crypto from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../api/app';
import { ensureNightWorkersSchema } from '../api/db/bootstrap';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import * as service from '../api/modules/nightworkers/nightworkers.service';
import * as llm from '../api/services/supervisor/llm-provider';
import { buildBlueprintDbDesignPrompt } from '../src/modules/nightworkers/components/blueprint-preview/dbDesignModel';
import { representativeAppBlueprint } from './fixtures/app-blueprint';

vi.mock('../api/services/supervisor/llm-provider', async () => {
  const actual = await vi.importActual<typeof import('../api/services/supervisor/llm-provider')>(
    '../api/services/supervisor/llm-provider'
  );
  return {
    ...actual,
    callSupervisorLLM: vi.fn(),
  };
});

const sameOriginHeaders = { Origin: 'http://localhost:39174' };

beforeAll(async () => {
  await ensureNightWorkersSchema();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('NightWorkers workbench routes', () => {
  it('creates a draft workbench session without starting a run', async () => {
    const project = await repo.createRepository({
      name: 'TEST: Workbench Project',
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });

    const res = await app.request('http://localhost/api/workbench/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({
        repositoryId: project.id,
        title: 'Workbench draft',
      }),
    });

    expect(res.status).toBe(201);
    const task = await res.json();
    expect(task.status).toBe('draft');
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
  });

  it('stores draft conversation messages without creating a run', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce({
      phase: 'plan',
      workflow: 'general',
      routingHypothesis: {
        primaryMode: 'planning',
        secondaryModes: [],
        phase: 'plan',
        workKinds: [],
        overlays: [],
        requiredEvidence: [],
        nextSkillFiles: [],
        confidence: 0.75,
      },
      instruction: '相談内容を整理して次の一手を提案します。',
      rationale: 'The user is asking for planning before implementation.',
      finalResponse: '',
      expectedEvidence: [],
      riskLevel: 'low',
      toolCall: null,
    });
    const { task } = await createWorkbenchTask();

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'まず方針を相談したい', intent: 'draft' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toBeNull();
    expect(body.task.status).toBe('draft');
    expect(body.messages.some((message: any) => message.role === 'user')).toBe(true);
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(1);
    expect(body.messages.some((message: any) => message.role === 'assistant')).toBe(true);
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
  });

  it('routes a normal prompt through LLM intake without starting a run', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce({
      phase: 'plan',
      workflow: 'code_change',
      routingHypothesis: {
        primaryMode: 'planning',
        secondaryModes: [],
        phase: 'plan',
        workKinds: ['ui_ux'],
        overlays: ['user_facing_change'],
        requiredEvidence: ['current UI structure'],
        nextSkillFiles: ['SKILL.md'],
        confidence: 0.82,
      },
      instruction: 'Analyze the goal and propose the next implementation step.',
      rationale: 'The prompt describes a user-facing UI change.',
      finalResponse: '',
      expectedEvidence: [],
      riskLevel: 'medium',
      toolCall: null,
    });
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'ECサイトのトップページを作ってください' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(1);
    expect(body.run).toBeNull();
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
    const assistantMessage = body.messages.find(
      (message: any) => message.role === 'assistant' && message.metadataJson?.intent === 'intake'
    );
    expect(assistantMessage?.metadataJson?.source).toBe('llm');
    expect(assistantMessage?.content).toContain(
      'Analyze the goal and propose the next implementation step.'
    );
    expect(assistantMessage?.content).not.toContain('GOAL分析を受け取りました');
    expect(body.task.objective).toBe('ECサイトのトップページを作ってください');
  });

  it('records a visible intake message even when the LLM decision has no display text', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce({
      phase: 'plan',
      workflow: 'general',
      routingHypothesis: {
        primaryMode: 'planning',
        secondaryModes: [],
        phase: 'plan',
        workKinds: [],
        overlays: [],
        requiredEvidence: [],
        nextSkillFiles: [],
        confidence: 0.75,
      },
      instruction: '',
      rationale: '',
      finalResponse: '',
      expectedEvidence: [],
      riskLevel: 'low',
      toolCall: null,
    });
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: '空のdecisionでも表示してください' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: expect.stringContaining('"phase": "plan"'),
          metadataJson: expect.objectContaining({ intent: 'intake' }),
        }),
      ])
    );
  });

  it('returns immediately when workbench intake is not explicitly awaited', async () => {
    vi.mocked(llm.callSupervisorLLM).mockImplementationOnce(() => new Promise(() => {}));
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const startedAt = Date.now();
    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({
        prompt: '同期で待たずに受付してください',
        waitForIntake: false,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Date.now() - startedAt).toBeLessThan(100);
    expect(body.run).toBeNull();
    expect(body.messages.some((message: any) => message.role === 'user')).toBe(true);
    expect(body.messages.some((message: any) => message.role === 'assistant')).toBe(false);
    expect(body.task.objective).toBe('同期で待たずに受付してください');
  });

  it('generates an app blueprint artifact when LLM intake classifies the prompt as blueprint work', async () => {
    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        phase: 'plan',
        workflow: 'general',
        routingHypothesis: {
          primaryMode: 'planning',
          secondaryModes: ['review'],
          phase: 'plan',
          workKinds: ['blueprint', 'ui_ux'],
          overlays: ['user_facing_change'],
          subtype: 'app_blueprint',
          requiredEvidence: ['screen structure'],
          nextSkillFiles: ['references/work_kinds/blueprint.md'],
          confidence: 0.9,
        },
        instruction: 'Create an EC site top page Blueprint.',
        rationale: 'The user asked to see a Blueprint before implementation.',
        finalResponse: '',
        expectedEvidence: [],
        riskLevel: 'medium',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'stop',
        workflow: 'general',
        routingHypothesis: undefined,
        instruction: '',
        rationale: 'Generated AppBlueprint JSON.',
        finalResponse: JSON.stringify({
          ...representativeAppBlueprint,
          id: 'shop-home',
          name: 'EC Site Top Page',
          description: 'LLM generated storefront blueprint with commerce-specific sections.',
        }),
        expectedEvidence: [],
        terminalState: 'completed',
        riskLevel: 'low',
        toolCall: null,
      });
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'ECサイトのトップページをBlueprintで作って見てください' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(2);
    expect(vi.mocked(llm.callSupervisorLLM).mock.calls[1]?.[0]).toContain(
      '[Skill Document: references/work_kinds/blueprint.md]'
    );
    expect(vi.mocked(llm.callSupervisorLLM).mock.calls[1]?.[0]).toContain(
      '通常の Blueprint 生成では DB/DDL/data model/data binding を設計しない'
    );
    expect(vi.mocked(llm.callSupervisorLLM).mock.calls[1]?.[0]).toContain(
      'databaseSchema は必ず {"tables":[],"relations":[]}'
    );
    expect(vi.mocked(llm.callSupervisorLLM).mock.calls[1]?.[0]).toContain(
      'DB table/column/relation/binding/DDL の考案は DB Design workflow の担当'
    );
    expect(body.run).toBeNull();
    expect(body.task.status).toBe('ready');
    const intakeMessage = body.messages.find(
      (message: any) => message.role === 'assistant' && message.metadataJson?.intent === 'intake'
    );
    expect(intakeMessage).toBeUndefined();
    const blueprintMessage = body.messages.find(
      (message: any) => message.metadataJson?.intent === 'app_blueprint'
    );
    expect(blueprintMessage?.messageType).toBe('markdown_document');
    expect(blueprintMessage?.metadataJson?.appBlueprint?.screens).toHaveLength(1);
    expect(blueprintMessage?.metadataJson?.appBlueprint?.name).toBe('EC Site Top Page');
    expect(blueprintMessage?.metadataJson?.validation?.valid).toBe(true);
    expect(blueprintMessage?.metadataJson?.generation?.source).toBe('llm');
    expect(blueprintMessage?.metadataJson?.generation?.skillDocuments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: 'references/work_kinds/blueprint.md' }),
      ])
    );
    expect(blueprintMessage?.metadataJson?.routingHypothesis?.subtype).toBe('app_blueprint');
    expect(blueprintMessage?.metadataJson?.intakeDecision?.instruction).toBe(
      'Create an EC site top page Blueprint.'
    );
  });

  it('shows an SFA dashboard request as an app blueprint artifact', async () => {
    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        phase: 'plan',
        workflow: 'general',
        routingHypothesis: {
          primaryMode: 'planning',
          secondaryModes: ['review'],
          phase: 'plan',
          workKinds: ['blueprint', 'ui_ux'],
          overlays: ['user_facing_change'],
          subtype: 'app_blueprint',
          requiredEvidence: ['SFA dashboard KPIs', 'sales activities', 'pipeline table'],
          nextSkillFiles: ['references/work_kinds/blueprint.md'],
          confidence: 0.96,
        },
        instruction: 'Create an SFA dashboard AppBlueprint artifact.',
        rationale: 'The user asked to display the dashboard as a Blueprint.',
        finalResponse: '',
        expectedEvidence: [],
        riskLevel: 'medium',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'stop',
        workflow: 'general',
        routingHypothesis: undefined,
        instruction: '',
        rationale: 'Generated AppBlueprint JSON.',
        finalResponse: JSON.stringify({
          ...representativeAppBlueprint,
          id: 'sfa-dashboard',
          name: 'SFA Dashboard',
          description: 'Sales force automation dashboard for pipeline, activity, and alerts.',
          screens: [
            {
              ...representativeAppBlueprint.screens[0],
              id: 'sales-dashboard',
              name: 'Sales Dashboard',
              componentName: 'DashboardPage',
              sections: [
                {
                  ...representativeAppBlueprint.screens[0].sections[0],
                  id: 'sales-kpis',
                  name: 'Sales KPIs',
                  componentName: 'KpiSummarySection',
                },
                {
                  ...representativeAppBlueprint.screens[0].sections[1],
                  id: 'pipeline-table',
                  name: 'Pipeline Table',
                  componentName: 'DataTableSection',
                },
              ],
            },
          ],
        }),
        expectedEvidence: [],
        terminalState: 'completed',
        riskLevel: 'low',
        toolCall: null,
      });
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'SFAのダッシュボードをblueprintで表示してください。' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(2);
    expect(body.messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metadataJson: expect.objectContaining({ intent: 'intake' }) }),
      ])
    );
    const blueprintMessage = body.messages.find(
      (message: any) => message.metadataJson?.intent === 'app_blueprint'
    );
    expect(blueprintMessage?.messageType).toBe('markdown_document');
    expect(blueprintMessage?.metadataJson?.appBlueprint?.id).toBe('sfa-dashboard');
    expect(blueprintMessage?.metadataJson?.appBlueprint?.screens[0]?.componentName).toBe(
      'DashboardPage'
    );
    expect(blueprintMessage?.content).toContain('Sales KPIs');
    expect(blueprintMessage?.content).toContain('Pipeline Table');
    expect(blueprintMessage?.metadataJson?.validation?.valid).toBe(true);
    expect(blueprintMessage?.metadataJson?.generation?.promptDiagnostics).toEqual(
      expect.objectContaining({
        schemaIncluded: true,
        catalogComponentCount: expect.any(Number),
        skillDocumentCount: expect.any(Number),
      })
    );
  });

  it('records raw LLM output when blueprint generation returns non-json', async () => {
    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        phase: 'plan',
        workflow: 'general',
        routingHypothesis: {
          primaryMode: 'planning',
          secondaryModes: ['review'],
          phase: 'plan',
          workKinds: ['blueprint', 'ui_ux'],
          overlays: ['user_facing_change'],
          subtype: 'app_blueprint',
          requiredEvidence: ['screen structure'],
          nextSkillFiles: ['references/work_kinds/blueprint.md'],
          confidence: 0.9,
        },
        instruction: 'Create a Blueprint artifact.',
        rationale: 'The request was classified as Blueprint work.',
        finalResponse: '',
        expectedEvidence: [],
        riskLevel: 'medium',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'stop',
        workflow: 'general',
        routingHypothesis: undefined,
        instruction: '',
        rationale: 'Invalid generation.',
        finalResponse: 'not json',
        expectedEvidence: [],
        terminalState: 'completed',
        riskLevel: 'low',
        toolCall: null,
      });
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'SFAのダッシュボードをblueprintで表示してください。' }),
    });

    expect(res.status).toBe(502);
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(2);
    expect(vi.mocked(llm.callSupervisorLLM).mock.calls[1]?.[0]).toContain(
      '[Skill Document: references/work_kinds/blueprint.md]'
    );
    expect(vi.mocked(llm.callSupervisorLLM).mock.calls[1]?.[0]).toContain(
      '[AppBlueprint JSON Schema]'
    );
    const messages = await repo.listTaskMessages(task.id);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: 'not json',
          metadataJson: expect.objectContaining({
            intent: 'blueprint_raw_output',
            promptDiagnostics: expect.objectContaining({
              schemaIncluded: true,
              skillDocumentCount: expect.any(Number),
            }),
          }),
        }),
        expect.objectContaining({
          role: 'system',
          metadataJson: expect.objectContaining({
            intent: 'blueprint_generation_failed',
            rawOutputRecorded: true,
          }),
        }),
      ])
    );
    expect(messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metadataJson: expect.objectContaining({ intent: 'intake' }) }),
      ])
    );
  });

  it('records raw LLM output when generated blueprint json fails catalog validation', async () => {
    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        phase: 'plan',
        workflow: 'general',
        routingHypothesis: {
          primaryMode: 'planning',
          secondaryModes: ['review'],
          phase: 'plan',
          workKinds: ['blueprint', 'ui_ux'],
          overlays: ['user_facing_change'],
          subtype: 'app_blueprint',
          requiredEvidence: ['screen structure'],
          nextSkillFiles: ['references/work_kinds/blueprint.md'],
          confidence: 0.9,
        },
        instruction: 'Create a Blueprint artifact.',
        rationale: 'The request was classified as Blueprint work.',
        finalResponse: '',
        expectedEvidence: [],
        riskLevel: 'medium',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'stop',
        workflow: 'general',
        routingHypothesis: undefined,
        instruction: '',
        rationale: 'Invalid generation.',
        finalResponse: JSON.stringify({
          ...representativeAppBlueprint,
          designPreset: { ...representativeAppBlueprint.designPreset, theme: 'design_governance' },
        }),
        expectedEvidence: [],
        terminalState: 'completed',
        riskLevel: 'low',
        toolCall: null,
      });
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'SFAのダッシュボードをblueprintで表示してください。' }),
    });

    expect(res.status).toBe(502);
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(2);
    const messages = await repo.listTaskMessages(task.id);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          metadataJson: expect.objectContaining({
            intent: 'blueprint_raw_output',
            validationStatus: 'failed',
          }),
        }),
        expect.objectContaining({
          role: 'system',
          metadataJson: expect.objectContaining({
            intent: 'blueprint_generation_failed',
            error: expect.stringContaining('designPreset.theme:design_governance'),
          }),
        }),
      ])
    );
  });

  it('drafts a markdown spec message and queues only after validation passes', async () => {
    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        phase: 'plan',
        workflow: 'general',
        routingHypothesis: {
          primaryMode: 'planning',
          secondaryModes: [],
          phase: 'plan',
          workKinds: ['blueprint'],
          overlays: [],
          subtype: 'app_blueprint',
          requiredEvidence: ['screen structure'],
          nextSkillFiles: ['references/work_kinds/blueprint.md'],
          confidence: 0.86,
        },
        instruction: 'Create a Blueprint from the requested workbench spec.',
        rationale: 'Round 1 classified the request as Blueprint planning.',
        finalResponse: '',
        expectedEvidence: [],
        riskLevel: 'low',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'stop',
        workflow: 'general',
        routingHypothesis: undefined,
        instruction: '',
        rationale: 'Generated AppBlueprint JSON.',
        finalResponse: JSON.stringify(representativeAppBlueprint),
        expectedEvidence: [],
        terminalState: 'completed',
        riskLevel: 'low',
        toolCall: null,
      });
    const { task } = await createWorkbenchTask();

    const draftRes = await app.request(
      `http://localhost/api/workbench/sessions/${task.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({ prompt: 'チャット中心の作業台を仕様にして', intent: 'draft_spec' }),
      }
    );

    expect(draftRes.status).toBe(200);
    const draftBody = await draftRes.json();
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(2);
    expect(draftBody.task.status).toBe('ready');
    expect(
      draftBody.messages.some((message: any) => message.messageType === 'markdown_document')
    ).toBe(true);
    const blueprintMessage = draftBody.messages.find(
      (message: any) => message.metadataJson?.intent === 'app_blueprint'
    );
    expect(blueprintMessage?.metadataJson?.appBlueprint?.screens).toHaveLength(1);
    expect(blueprintMessage?.metadataJson?.validation?.valid).toBe(true);
    expect(blueprintMessage?.metadataJson?.generation?.source).toBe('llm');

    const queueRes = await app.request(`http://localhost/api/workbench/sessions/${task.id}/queue`, {
      method: 'POST',
      headers: sameOriginHeaders,
    });
    expect(queueRes.status).toBe(200);
    const queued = await queueRes.json();
    expect(queued.status).toBe('queued');
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
  });

  it('routes design tool intent through LLM intake instead of fixed component artifacts', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce({
      phase: 'plan',
      workflow: 'general',
      routingHypothesis: {
        primaryMode: 'planning',
        secondaryModes: ['review'],
        phase: 'plan',
        workKinds: ['ui_ux'],
        overlays: ['user_facing_change'],
        requiredEvidence: ['component requirements'],
        nextSkillFiles: ['references/work_kinds/ui_ux.md'],
        confidence: 0.8,
      },
      instruction: 'Analyze the requested component design.',
      rationale: 'The user asked for design work.',
      finalResponse: '',
      expectedEvidence: [],
      riskLevel: 'medium',
      toolCall: null,
    });
    const { task } = await createWorkbenchTask({ title: 'Button design session' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({
        prompt: 'ボタンのデザインだけを見直したい',
        intent: 'design_component',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(
      body.messages.some((message: any) => message.metadataJson?.intent === 'component_design')
    ).toBe(false);
    const intakeMessage = body.messages.find(
      (message: any) => message.role === 'assistant' && message.metadataJson?.intent === 'intake'
    );
    expect(intakeMessage?.content).toContain('Analyze the requested component design.');
  });

  it('creates a revised Blueprint artifact from DB Design intent without round-1 intake', async () => {
    const revisedBlueprint = {
      ...representativeAppBlueprint,
      databaseSchema: {
        ...representativeAppBlueprint.databaseSchema,
        tables: [
          {
            ...representativeAppBlueprint.databaseSchema.tables[0],
            columns: [
              ...representativeAppBlueprint.databaseSchema.tables[0].columns,
              {
                name: 'priority',
                type: 'string',
                nullable: false,
                primaryKey: false,
                unique: false,
                label: 'Priority',
                uiHint: 'status',
              },
            ],
            indexes: [['status'], ['priority']],
          },
        ],
      },
      dataBindings: [
        {
          ...representativeAppBlueprint.dataBindings[0],
          fields: ['id', 'status', 'priority'],
        },
        representativeAppBlueprint.dataBindings[1],
      ],
    };
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce({
      phase: 'stop',
      workflow: 'general',
      routingHypothesis: undefined,
      instruction: '',
      rationale: 'Revised Blueprint data design.',
      finalResponse: JSON.stringify(revisedBlueprint),
      expectedEvidence: [],
      terminalState: 'completed',
      riskLevel: 'low',
      toolCall: null,
    });
    const { task } = await createWorkbenchTask({ title: 'DB Design task', objective: '' });
    const prompt = buildBlueprintDbDesignPrompt({
      blueprintId: representativeAppBlueprint.id,
      currentBlueprint: representativeAppBlueprint as unknown as Record<string, unknown>,
      prompt: 'priority column を追加してください',
      target: { kind: 'table', tableName: 'decision-items' },
      validationIssues: [],
    });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt, intent: 'design_blueprint_data' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(1);
    expect(vi.mocked(llm.callSupervisorLLM).mock.calls[0]?.[0]).toContain(
      'AppBlueprint の DB Design'
    );
    const userMessage = body.messages.find(
      (message: any) =>
        message.role === 'user' && message.metadataJson?.intent === 'design_blueprint_data'
    );
    expect(userMessage?.content).toContain('Target: Table decision-items');
    expect(userMessage?.content).toContain('Instruction: priority column を追加してください');
    expect(userMessage?.content).not.toContain('currentBlueprint');
    expect(userMessage?.metadataJson?.validation?.valid).toBe(true);
    const blueprintMessage = body.messages.find(
      (message: any) =>
        message.messageType === 'markdown_document' &&
        message.metadataJson?.source === 'blueprint-db-design'
    );
    expect(blueprintMessage?.metadataJson?.intent).toBe('app_blueprint');
    expect(blueprintMessage?.metadataJson?.dbDesignTarget).toEqual({
      kind: 'table',
      tableName: 'decision-items',
    });
    expect(
      blueprintMessage?.metadataJson?.appBlueprint?.databaseSchema?.tables?.[0]?.columns
    ).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'priority' })]));
    expect(blueprintMessage?.metadataJson?.validation?.valid).toBe(true);
    expect(body.task.status).toBe('ready');
  });

  it('returns a validation error instead of changing task status for incomplete drafts', async () => {
    const { task } = await createWorkbenchTask({ title: 'New Session' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/queue`, {
      method: 'POST',
      headers: sameOriginHeaders,
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('TASK_DRAFT_INCOMPLETE');
    expect((await repo.getTask(task.id))?.status).toBe('draft');
  });

  it('rejects workbench run requests until the task is ready or queued', async () => {
    const { task } = await createWorkbenchTask({ title: 'New Session' });

    const directRunRes = await app.request(
      `http://localhost/api/workbench/sessions/${task.id}/run`,
      {
        method: 'POST',
        headers: sameOriginHeaders,
      }
    );
    expect(directRunRes.status).toBe(409);
    expect((await directRunRes.json()).code).toBe('TASK_NOT_READY_TO_RUN');

    const intentRunRes = await app.request(
      `http://localhost/api/workbench/sessions/${task.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({ prompt: '実行して', intent: 'run_task' }),
      }
    );
    expect(intentRunRes.status).toBe(409);
    expect((await intentRunRes.json()).code).toBe('TASK_NOT_READY_TO_RUN');
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
  });

  it('allows workbench run requests for queued tasks through the runtime path', async () => {
    const { task } = await createWorkbenchTask({ status: 'queued' });
    const startSpy = vi.spyOn(service, 'startWorkbenchTaskRun').mockResolvedValue({
      id: crypto.randomUUID(),
      taskId: task.id,
      repositoryId: task.repositoryId,
      status: 'context_compiling',
      workerKind: 'native-local',
      timeoutSeconds: 3600,
      startedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/run`, {
      method: 'POST',
      headers: sameOriginHeaders,
    });

    expect(res.status).toBe(201);
    expect(startSpy).toHaveBeenCalledWith(task.id);
  });

  it('keeps plan-mode AI responses available for queued sessions without starting a run', async () => {
    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        phase: 'plan',
        workflow: 'general',
        routingHypothesis: {
          primaryMode: 'planning',
          secondaryModes: [],
          phase: 'plan',
          workKinds: ['blueprint'],
          overlays: [],
          subtype: 'app_blueprint',
          requiredEvidence: ['screen structure'],
          nextSkillFiles: ['references/work_kinds/blueprint.md'],
          confidence: 0.84,
        },
        instruction: 'Update the queued plan as a Blueprint.',
        rationale: 'Round 1 classified the queued session message as Blueprint planning.',
        finalResponse: '',
        expectedEvidence: [],
        riskLevel: 'low',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'stop',
        workflow: 'general',
        routingHypothesis: undefined,
        instruction: '',
        rationale: 'Generated AppBlueprint JSON.',
        finalResponse: JSON.stringify(representativeAppBlueprint),
        expectedEvidence: [],
        terminalState: 'completed',
        riskLevel: 'low',
        toolCall: null,
      });
    const { task } = await createWorkbenchTask({ status: 'queued' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({
        prompt: '実装前に計画をもう少し具体化して',
        intent: 'draft_spec',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toBeNull();
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(2);
    expect(body.task.status).toBe('queued');
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
    expect(
      body.messages.some((message: any) => message.metadataJson?.intent === 'app_blueprint')
    ).toBe(true);
  });

  it('prefers adopted Blueprint artifacts over newer generated Blueprint messages for planning', async () => {
    const { task } = await createWorkbenchTask({ status: 'ready' });
    const adoptedMessage = await repo.createTaskMessage({
      taskId: task.id,
      role: 'assistant',
      content: 'Adopted Blueprint',
      messageType: 'markdown_document',
      payloadJson: {
        intent: 'app_blueprint',
        appBlueprint: { ...representativeAppBlueprint, id: 'adopted-blueprint' },
      },
    });
    await repo.createTaskMessage({
      taskId: task.id,
      role: 'assistant',
      content: 'Newer generated Blueprint',
      messageType: 'markdown_document',
      payloadJson: {
        intent: 'app_blueprint',
        appBlueprint: { ...representativeAppBlueprint, id: 'newer-generated-blueprint' },
      },
    });
    await repo.upsertBlueprintArtifactAdoption(task.id, adoptedMessage.id, true);

    const readiness = await service.resolveBlueprintPlanningReadiness(task.id);

    expect(readiness).toMatchObject({
      source: 'adopted',
      diagnostic: 'adopted_blueprint',
      messageId: adoptedMessage.id,
      blueprint: { id: 'adopted-blueprint' },
    });
  });

  it('uses the latest generated Blueprint only when no artifact is adopted', async () => {
    const { task } = await createWorkbenchTask({ status: 'ready' });
    await repo.createTaskMessage({
      taskId: task.id,
      role: 'assistant',
      content: 'Older Blueprint',
      messageType: 'markdown_document',
      payloadJson: {
        intent: 'app_blueprint',
        appBlueprint: { ...representativeAppBlueprint, id: 'older-blueprint' },
      },
    });
    const latestMessage = await repo.createTaskMessage({
      taskId: task.id,
      role: 'assistant',
      content: 'Latest Blueprint',
      messageType: 'markdown_document',
      payloadJson: {
        intent: 'app_blueprint',
        appBlueprint: { ...representativeAppBlueprint, id: 'latest-blueprint' },
      },
    });

    const readiness = await service.resolveBlueprintPlanningReadiness(task.id);

    expect(readiness).toMatchObject({
      source: 'latest_generated',
      diagnostic: 'using_latest_generated_blueprint',
      messageId: latestMessage.id,
      blueprint: { id: 'latest-blueprint' },
    });
  });

  it('emits a stable diagnostic when no Blueprint artifact is available for planning', async () => {
    const { task } = await createWorkbenchTask({ status: 'ready' });

    const readiness = await service.resolveBlueprintPlanningReadiness(task.id);

    expect(readiness).toMatchObject({
      source: 'none',
      diagnostic: 'no_adopted_blueprint',
      messageId: null,
      blueprint: null,
    });
    expect(readiness.summary).toContain('No adopted Blueprint artifact');
  });
});

async function createWorkbenchTask(
  input: { title?: string; status?: string; objective?: string } = {}
) {
  const project = await repo.createRepository({
    name: `TEST: Workbench Project ${crypto.randomUUID()}`,
    localPath: '/Users/y.noguchi/Code/nightWorkers',
    branch: 'main',
  });
  const task = await repo.createTask({
    repositoryId: project.id,
    title: input.title || 'Workbench task',
    objective: input.objective ?? 'Implement chat-first workbench',
    acceptanceCriteria: 'Draft conversation, queue, and run are separate task-queue steps',
    status: input.status || 'draft',
  });
  return { project, task };
}
