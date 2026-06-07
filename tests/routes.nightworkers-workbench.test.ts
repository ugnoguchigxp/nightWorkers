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
    callStructuredJsonLLM: vi.fn(),
  };
});

vi.mock('../api/services/agent-runtime/registry', () => ({
  resolveAgentRuntime: vi.fn(() => ({
    kind: 'native-local',
    start: vi.fn(async () => ({
      terminalState: 'completed',
      summary: 'Runtime completed.',
      finalReport: 'Runtime completed.',
      stoppedBy: 'decision',
      riskLevel: 'low',
      diffPatch: '',
      logContent: '',
    })),
    stop: vi.fn(),
  })),
}));

const sameOriginHeaders = { Origin: 'http://localhost:39174' };

function mockJobSelection(jobType: string, goal: string) {
  return { jobType, goal };
}

beforeAll(async () => {
  await ensureNightWorkersSchema();
});

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 25));
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
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('general_answer', '相談内容を整理して次の一手を提案します。')
    );
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

  it('starts a docs run for normal intake without persisting the round 1 response as chat', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('docs', 'Analyze the goal and propose the next implementation step.')
    );
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'ECサイトのトップページを作ってください' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(1);
    expect(body.run).toMatchObject({ taskId: task.id, status: 'running' });
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(1);
    const assistantMessage = body.messages.find(
      (message: any) => message.role === 'assistant' && message.metadataJson?.intent === 'intake'
    );
    expect(assistantMessage).toBeUndefined();
    const systemMessage = body.messages.find(
      (message: any) => message.role === 'system' && message.metadataJson?.intent === 'run_started'
    );
    expect(systemMessage?.metadataJson?.intakeJobSelection?.jobType).toBe('docs');
    expect(body.task.objective).toBe('ECサイトのトップページを作ってください');
    await vi.waitFor(async () => {
      const runs = await repo.listTaskRunsForTask(task.id);
      expect(runs[0]?.status).toBe('completed');
    });
  });

  it('starts a planning run instead of exposing the intake classification', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('planning', 'kanbanアプリの実装方針を整理し、主要機能と作業順を決める')
    );
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'kanbanアプリの実装計画を作ってください' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toMatchObject({ taskId: task.id, status: 'running' });
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(1);
    expect(
      body.messages.some(
        (message: any) => message.role === 'assistant' && message.content.includes('jobType:')
      )
    ).toBe(false);
    const systemMessage = body.messages.find(
      (message: any) => message.role === 'system' && message.metadataJson?.intent === 'run_started'
    );
    expect(systemMessage?.metadataJson?.intakeJobSelection).toMatchObject({
      jobType: 'planning',
      goal: 'kanbanアプリの実装方針を整理し、主要機能と作業順を決める',
    });
    await vi.waitFor(async () => {
      const runs = await repo.listTaskRunsForTask(task.id);
      expect(runs[0]?.status).toBe('completed');
    });
  });

  it('starts an implementation run for code-change intake without persisting the round 1 response as chat', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('minor_code_edit', '`fizzbuzz.ts` をプロジェクトルートに追加する。')
    );
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'fizzbuzz.tsをプロジェクトルートに作ってください' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toMatchObject({ taskId: task.id, status: 'running' });
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(1);
    const assistantMessage = body.messages.find(
      (message: any) => message.role === 'assistant' && message.metadataJson?.intent === 'intake'
    );
    expect(assistantMessage).toBeUndefined();
    const systemMessage = body.messages.find(
      (message: any) => message.role === 'system' && message.metadataJson?.intent === 'run_started'
    );
    expect(systemMessage?.content).toContain('Implementation run started');
    expect(systemMessage?.metadataJson?.intakeJobSelection?.goal).toContain('fizzbuzz.ts');
    expect(body.task.status).toBe('running');
    await vi.waitFor(async () => {
      const runs = await repo.listTaskRunsForTask(task.id);
      expect(runs[0]?.status).toBe('completed');
      const messages = await repo.listTaskMessages(task.id);
      expect(messages.some((message) => message.content === 'Runtime completed.')).toBe(true);
    });
  });

  it('does not fall back to fixed intake prose for non-running code-edit decisions', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('minor_code_edit', '`fizzbuzz.ts` をプロジェクトルートに追加する。')
    );
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({
        prompt: 'fizzbuzz.tsをプロジェクトルートに作ってください',
        intent: 'draft_spec',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toBeNull();
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
    const assistantMessage = body.messages.find(
      (message: any) => message.role === 'assistant' && message.metadataJson?.intent === 'intake'
    );
    expect(assistantMessage?.content).toContain('jobType: minor_code_edit');
    expect(assistantMessage?.content).toContain('fizzbuzz.ts');
  });

  it('records a visible intake message even when the LLM job selection has no goal text', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(mockJobSelection('general_answer', ''));
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
          content: expect.stringContaining('jobType: general_answer'),
          metadataJson: expect.objectContaining({
            intent: 'intake',
            jobSelection: expect.objectContaining({ jobType: 'general_answer', goal: '' }),
          }),
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
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('blueprint', 'Create an EC site top page Blueprint.')
    );
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
      JSON.stringify({
        ...representativeAppBlueprint,
        id: 'shop-home',
        name: 'EC Site Top Page',
        description: 'LLM generated storefront blueprint with commerce-specific sections.',
      })
    );
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'ECサイトのトップページをBlueprintで作って見てください' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(1);
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
    expect(vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[0]).toContain(
      '[Skill Document: references/work_kinds/blueprint.md]'
    );
    expect(vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[0]).toContain(
      '通常の Blueprint 生成では DB/DDL/data model/data binding を設計しない'
    );
    expect(vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[0]).toContain(
      'databaseSchema は必ず {"tables":[],"relations":[]}'
    );
    expect(vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[0]).toContain(
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
    expect(blueprintMessage?.metadataJson?.intakeJobSelection?.goal).toBe(
      'Create an EC site top page Blueprint.'
    );
  });

  it('shows an SFA dashboard request as an app blueprint artifact', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('blueprint', 'Create an SFA dashboard AppBlueprint artifact.')
    );
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
      JSON.stringify({
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
      })
    );
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'SFAのダッシュボードをblueprintで表示してください。' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(1);
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
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
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('blueprint', 'Create a Blueprint artifact.')
    );
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce('not json');
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'SFAのダッシュボードをblueprintで表示してください。' }),
    });

    expect(res.status).toBe(502);
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(1);
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
    expect(vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[0]).toContain(
      '[Skill Document: references/work_kinds/blueprint.md]'
    );
    expect(vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[0]).toContain(
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
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('blueprint', 'Create a Blueprint artifact.')
    );
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
      JSON.stringify({
        ...representativeAppBlueprint,
        designPreset: { ...representativeAppBlueprint.designPreset, theme: 'design_governance' },
      })
    );
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'SFAのダッシュボードをblueprintで表示してください。' }),
    });

    expect(res.status).toBe(502);
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(1);
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
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
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('blueprint', 'Create a Blueprint from the requested workbench spec.')
    );
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
      JSON.stringify(representativeAppBlueprint)
    );
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
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(1);
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
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

    await repo.updateImplementationQueueSettings({ processorCount: 1 });
    const { task: blockerTask } = await createWorkbenchTask({
      title: 'Processor blocker for draft queue',
      status: 'queued',
    });
    const blockerEntry = await repo.createImplementationQueueEntry({
      taskId: blockerTask.id,
      repositoryId: blockerTask.repositoryId,
    });
    await repo.updateImplementationQueueEntry(blockerEntry.id, {
      status: 'claimed',
      processorSlot: 1,
    });

    const queueRes = await app.request(`http://localhost/api/workbench/sessions/${task.id}/queue`, {
      method: 'POST',
      headers: sameOriginHeaders,
    });
    expect(queueRes.status).toBe(200);
    const queued = await queueRes.json();
    expect(queued.status).toBe('queued');
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
  });

  it('does not treat markdown titles as implementation plan evidence for queue admission', async () => {
    const { task } = await createWorkbenchTask();
    await repo.createTaskMessage({
      taskId: task.id,
      role: 'assistant',
      content: '# Implementation Plan',
      messageType: 'markdown_document',
      metadataJson: {
        title: 'Implementation Plan',
      },
    });

    const queueRes = await app.request(`http://localhost/api/workbench/sessions/${task.id}/queue`, {
      method: 'POST',
      headers: sameOriginHeaders,
    });

    expect(queueRes.status).toBe(422);
    const body = await queueRes.json();
    expect(body.code).toBe('IMPLEMENTATION_PLAN_REQUIRED');
    expect((await repo.getTask(task.id))?.status).toBe('draft');
  });

  it('admits ready sessions to the Implementation Queue without duplicating not-queued work', async () => {
    await repo.updateImplementationQueueSettings({ processorCount: 1 });
    const { task: blockerTask } = await createWorkbenchTask({
      title: 'Processor blocker',
      status: 'queued',
    });
    const blockerEntry = await repo.createImplementationQueueEntry({
      taskId: blockerTask.id,
      repositoryId: blockerTask.repositoryId,
    });
    await repo.updateImplementationQueueEntry(blockerEntry.id, {
      status: 'claimed',
      processorSlot: 1,
    });
    const { task } = await createWorkbenchTask({ status: 'ready' });

    const res = await app.request('http://localhost/api/implementation-queue/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ taskId: task.id }),
    });

    expect(res.status).toBe(201);
    const entry = await res.json();
    expect(entry).toMatchObject({ taskId: task.id, status: 'queued' });
    expect((await repo.getTask(task.id))?.status).toBe('queued');

    const dashboardRes = await app.request('http://localhost/api/implementation-queue', {
      headers: sameOriginHeaders,
    });
    expect(dashboardRes.status).toBe(200);
    const dashboard = await dashboardRes.json();
    expect(dashboard.queued.map((queueEntry: any) => queueEntry.task.id)).toContain(task.id);
    expect(dashboard.notQueued.map((item: any) => item.task.id)).not.toContain(task.id);

    const duplicateRes = await app.request(
      `http://localhost/api/workbench/sessions/${task.id}/queue`,
      {
        method: 'POST',
        headers: sameOriginHeaders,
      }
    );
    expect(duplicateRes.status).toBe(409);
    expect((await duplicateRes.json()).code).toBe('QUEUE_ENTRY_EXISTS');
  });

  it('removes a queued Implementation Queue Entry without leaving the Session queued', async () => {
    const { task } = await createWorkbenchTask({ status: 'ready' });
    const createRes = await app.request('http://localhost/api/implementation-queue/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ taskId: task.id }),
    });
    expect(createRes.status).toBe(201);
    const entry = await createRes.json();

    const cancelRes = await app.request(
      `http://localhost/api/implementation-queue/entries/${entry.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({ action: 'cancel' }),
      }
    );
    expect(cancelRes.status).toBe(200);
    expect((await cancelRes.json()).status).toBe('cancelled');
    expect((await repo.getTask(task.id))?.status).toBe('ready');

    const archiveRes = await app.request(
      `http://localhost/api/implementation-queue/entries/${entry.id}/archive`,
      {
        method: 'POST',
        headers: sameOriginHeaders,
      }
    );
    expect(archiveRes.status).toBe(200);
    expect((await archiveRes.json()).status).toBe('execution_archived');

    const dashboardRes = await app.request('http://localhost/api/implementation-queue', {
      headers: sameOriginHeaders,
    });
    expect(dashboardRes.status).toBe(200);
    const dashboard = await dashboardRes.json();
    expect(dashboard.queued.map((queueEntry: any) => queueEntry.task.id)).not.toContain(task.id);
    expect(dashboard.notQueued.map((item: any) => item.task.id)).toContain(task.id);
  });

  it('accepts a reviewed queue execution and archives the Queue Entry', async () => {
    const { task } = await createWorkbenchTask({ status: 'needs_review' });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: task.repositoryId,
      status: 'needs_review',
      workerKind: 'native-local',
      summary: 'Runtime result captured.',
      finalReport: 'Final report ready.',
      startedAt: new Date(),
      endedAt: new Date(),
      finishedAt: new Date(),
    });
    await repo.updateTaskRun(run.id, {
      diffPatch: 'diff --git a/file.ts b/file.ts',
      testResults: { passed: true },
    });
    const entry = await repo.createImplementationQueueEntry({
      taskId: task.id,
      repositoryId: task.repositoryId,
    });
    await repo.updateImplementationQueueEntry(entry.id, {
      status: 'execution_completed',
      activeRunId: run.id,
    });

    const reviewRes = await app.request(`http://localhost/api/runs/${run.id}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ action: 'complete', note: 'Accepted from test.' }),
    });

    expect(reviewRes.status).toBe(200);
    const reviewBody = await reviewRes.json();
    expect(reviewBody.reviewResult.verdict).toBe('approved');
    expect((await repo.getTask(task.id))?.status).toBe('completed');
    expect((await repo.getImplementationQueueEntry(entry.id))?.status).toBe('execution_archived');
  });

  it('requeues a stopped Queue Entry with its original priority', async () => {
    const { task } = await createWorkbenchTask({ status: 'needs_human' });
    await repo.updateTask(task.id, { priority: 9 });
    const entry = await repo.createImplementationQueueEntry({
      taskId: task.id,
      repositoryId: task.repositoryId,
      priority: 9,
      queuePosition: 2,
    });
    await repo.updateImplementationQueueEntry(entry.id, {
      status: 'needs_human',
      statusReason: 'Need human answer.',
    });

    const res = await app.request(
      `http://localhost/api/implementation-queue/entries/${entry.id}/requeue`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({ note: 'Answered by human.' }),
      }
    );

    expect(res.status).toBe(201);
    const nextEntry = await res.json();
    expect(nextEntry.id).not.toBe(entry.id);
    expect(nextEntry).toMatchObject({
      taskId: task.id,
      status: 'queued',
      priority: 9,
      queuePosition: 2,
    });
    expect((await repo.getImplementationQueueEntry(entry.id))?.status).toBe('execution_archived');
    expect((await repo.getTask(task.id))?.status).toBe('queued');
  });

  it('routes design tool intent through LLM intake instead of fixed component artifacts', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('docs', 'Analyze the requested component design.')
    );
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
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(JSON.stringify(revisedBlueprint));
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
    expect(llm.callSupervisorLLM).not.toHaveBeenCalled();
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
    expect(vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[0]).toContain(
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
      status: 'running',
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
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('blueprint', 'Update the queued plan as a Blueprint.')
    );
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
      JSON.stringify(representativeAppBlueprint)
    );
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
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(1);
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
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
