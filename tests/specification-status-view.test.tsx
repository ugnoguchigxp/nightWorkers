import mermaid from 'mermaid';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  buildFlowchartFromMarkdown,
  buildMermaidErDiagram,
  DedicatedViewPanel,
  PLAN_MODE_SEQUENTIAL_AUTO_GENERATE_STORAGE_KEY,
  PlanWorkspaceStatusView,
  readPlanModeSequentialAutoGeneratePreference,
  WorkspaceDataModelPanel,
  writePlanModeSequentialAutoGeneratePreference,
} from '../src/modules/planMode';

describe('WorkspaceDataModelPanel', () => {
  it('renders Data Model artifacts as a Mermaid ER diagram while preserving DDL', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceDataModelPanel
        message={
          {
            id: 'data-model-message-1',
            content: '# Data Model',
            metadataJson: {
              dataModelArtifact: {
                title: 'Project Data Model',
                summary: 'Project and task persistence.',
                canonicalSource: 'ddl',
                ddl: 'CREATE TABLE projects (id TEXT PRIMARY KEY);',
                derivedTables: [
                  {
                    name: 'projects',
                    purpose: 'Stores projects.',
                    columns: [
                      { name: 'id', type: 'TEXT', nullable: false, primaryKey: true },
                      { name: 'name', type: 'TEXT', nullable: false, unique: true },
                    ],
                    indexes: [],
                  },
                  {
                    name: 'tasks',
                    purpose: 'Stores tasks.',
                    columns: [
                      { name: 'id', type: 'TEXT', nullable: false, primaryKey: true },
                      { name: 'project_id', type: 'TEXT', nullable: false },
                    ],
                    indexes: [],
                  },
                ],
                relations: [
                  {
                    from: 'tasks.project_id',
                    to: 'projects.id',
                    cardinality: 'many_to_one',
                    reason: 'Each task belongs to a project.',
                  },
                ],
                constraints: ['This constraint should stay out of the Data Model screen.'],
                openQuestions: ['This question should stay out of the Data Model screen.'],
              },
            },
          } as never
        }
      />
    );

    expect(markup).toContain('Mermaid ER diagram');
    expect(markup).toContain('Download Mermaid SVG');
    expect(markup).toContain('erDiagram');
    expect(markup).toContain('projects');
    expect(markup).toContain('tasks');
    expect(markup).toContain('project_id');
    expect(markup).toContain('id TEXT PK');
    expect(markup).toContain('name TEXT UK');
    expect(markup).not.toContain('TEXT id PK');
    expect(markup).toContain('FK');
    expect(markup).toContain('}o--||');
    expect(markup).toContain('CREATE TABLE projects');
    expect(markup).not.toContain('Constraints');
    expect(markup).not.toContain('Open questions');
    expect(markup).not.toContain('This constraint should stay out');
    expect(markup).not.toContain('This question should stay out');
  });

  it('builds Mermaid ER diagrams with parseable relationship labels', async () => {
    const chart = buildMermaidErDiagram(
      [
        {
          name: 'threads',
          columns: [{ name: 'id', type: 'TEXT', nullable: false, primaryKey: true }],
        },
        {
          name: 'actions',
          columns: [
            { name: 'id', type: 'TEXT', nullable: false, primaryKey: true },
            { name: 'thread_id', type: 'TEXT', nullable: false },
          ],
        },
      ],
      [
        {
          from: 'actions.thread_id',
          to: 'threads.id',
          cardinality: 'many_to_one',
          reason: '1つのスレッドに複数の編集履歴が属する',
        },
      ]
    );

    expect(chart).toContain('actions }o--|| threads : "1つのスレッドに複数の編集履歴が属する"');
    await expect(mermaid.parse(chart)).resolves.toBeTruthy();
  });
});

describe('DedicatedViewPanel', () => {
  it('renders User Flow artifacts through the Mermaid diagram surface', () => {
    const markup = renderToStaticMarkup(
      <DedicatedViewPanel
        artifact={
          {
            id: 'user-flow-1',
            kind: 'user_flow',
            title: 'Checkout User Flow',
            sourceMessageId: '44444444-4444-4444-8444-444444447778',
            createdAt: '2026-07-02T00:00:00.000Z',
          } as never
        }
        message={
          {
            id: '44444444-4444-4444-8444-444444447778',
            content:
              '```mermaid\nflowchart TD\n  OpenCheckout[Open checkout] --> SubmitPayment[Submit payment]\n```',
            metadataJson: {
              artifactKind: 'plan_mode_dedicated_view',
              view: 'user_flow',
              diagramKind: 'flowchart',
            },
          } as never
        }
      />
    );

    expect(markup).toContain('Mermaid diagram');
    expect(markup).toContain('Download Mermaid SVG');
    expect(markup).toContain('flowchart TD');
    expect(markup).toContain('OpenCheckout');
    expect(markup).not.toContain('language-mermaid');
  });

  it('renders markdown-only User Flow artifacts as a Mermaid flowchart with notes', () => {
    const markup = renderToStaticMarkup(
      <DedicatedViewPanel
        artifact={
          {
            id: 'user-flow-1',
            kind: 'user_flow',
            title: 'Checkout User Flow',
            sourceMessageId: '44444444-4444-4444-8444-444444447778',
            createdAt: '2026-07-02T00:00:00.000Z',
          } as never
        }
        message={
          {
            id: '44444444-4444-4444-8444-444444447778',
            content: '# Checkout User Flow\n\n1. Open checkout\n2. Submit payment',
            metadataJson: {
              artifactKind: 'plan_mode_dedicated_view',
              view: 'user_flow',
            },
          } as never
        }
      />
    );

    expect(markup).toContain('Mermaid diagram');
    expect(markup).toContain('flowchart TD');
    expect(markup).toContain('step1');
    expect(markup).toContain('Open checkout');
    expect(markup).toContain('Submit payment');
    expect(markup).toContain('step1 --&gt; step2');
  });

  it('does not build User Flow fallback charts from implementation-only Markdown', () => {
    const chart = buildFlowchartFromMarkdown(
      [
        '# User Flow',
        '1. 画面を開く',
        '2. `styles.css` で共通の余白、見出し間隔、ボタン優先度を調整する',
      ].join('\n'),
      'user_flow'
    );

    expect(chart).toBeNull();
  });

  it('builds meaningful User Flow fallback charts from user-visible Markdown', () => {
    const chart = buildFlowchartFromMarkdown(
      ['# User Flow', '1. Checkout を開く', '2. 支払い内容を確認する', '3. 注文を送信する'].join(
        '\n'
      ),
      'user_flow'
    );

    expect(chart).toContain('Checkout を開く');
    expect(chart).toContain('支払い内容を確認する');
    expect(chart).toContain('step1 --> step2');
  });
});

describe('PlanWorkspaceStatusView', () => {
  it('persists the sequential auto-generate preference in localStorage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } as Storage;

    expect(readPlanModeSequentialAutoGeneratePreference(storage)).toBe(false);
    writePlanModeSequentialAutoGeneratePreference(true, storage);
    expect(values.get(PLAN_MODE_SEQUENTIAL_AUTO_GENERATE_STORAGE_KEY)).toBe('true');
    expect(readPlanModeSequentialAutoGeneratePreference(storage)).toBe(true);
    writePlanModeSequentialAutoGeneratePreference(false, storage);
    expect(values.get(PLAN_MODE_SEQUENTIAL_AUTO_GENERATE_STORAGE_KEY)).toBe('false');
    expect(readPlanModeSequentialAutoGeneratePreference(storage)).toBe(false);
  });

  it('shows the sequential auto-generate checkbox on Status', () => {
    const markup = renderToStaticMarkup(
      <PlanWorkspaceStatusView
        workspace={null}
        questionnaireSession={null}
        busyAction={null}
        canGenerateDataModel={true}
        hasFeaturePlan={false}
        onOpenQuestionnaire={vi.fn()}
        onGenerateBlueprint={vi.fn()}
        onGenerateDataModel={vi.fn()}
        onGenerateFeaturePlan={vi.fn()}
        onGenerateDedicatedViews={vi.fn()}
      />
    );

    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('順次自動生成');
  });

  it('shows separate start-now and add-to-queue actions after the status flow is complete', () => {
    const markup = renderToStaticMarkup(
      <PlanWorkspaceStatusView
        workspace={
          {
            blueprintArtifacts: [{ id: 'blueprint-1', title: 'Blueprint' }],
            dataModelArtifacts: [{ id: 'data-model-1', title: 'Data Model' }],
          } as never
        }
        questionnaireSession={
          {
            id: 'questionnaire-1',
            status: 'accepted',
            answers: [],
            questionSets: [],
          } as never
        }
        busyAction={null}
        canGenerateDataModel={true}
        hasFeaturePlan={true}
        onOpenQuestionnaire={vi.fn()}
        onGenerateBlueprint={vi.fn()}
        onGenerateDataModel={vi.fn()}
        onGenerateFeaturePlan={vi.fn()}
        onGenerateDedicatedViews={vi.fn()}
        onQueueSession={vi.fn()}
        onAddToQueue={vi.fn()}
      />
    );

    expect(markup).toContain('今すぐ実装開始');
    expect(markup).toContain('キューに追加');
    expect(markup).not.toContain('night queueに登録');
  });

  it('disables regeneration and implementation actions for implemented tasks', () => {
    const markup = renderToStaticMarkup(
      <PlanWorkspaceStatusView
        workspace={
          {
            blueprintArtifacts: [{ id: 'blueprint-1', title: 'Blueprint' }],
            dataModelArtifacts: [{ id: 'data-model-1', title: 'Data Model' }],
          } as never
        }
        questionnaireSession={
          {
            id: 'questionnaire-1',
            status: 'accepted',
            answers: [],
            questionSets: [],
          } as never
        }
        busyAction={null}
        canGenerateDataModel={true}
        hasFeaturePlan={true}
        isImplementationLocked={true}
        onOpenQuestionnaire={vi.fn()}
        onGenerateBlueprint={vi.fn()}
        onGenerateDataModel={vi.fn()}
        onGenerateFeaturePlan={vi.fn()}
        onGenerateDedicatedViews={vi.fn()}
        onQueueSession={vi.fn()}
        onAddToQueue={vi.fn()}
      />
    );

    expect(markup).toContain('アンケートを確認');
    expect(markup).toContain('Blueprintを再生成');
    expect(markup).toContain('Data Modelを再生成');
    expect(markup).toContain('仕様書を再生成');
    expect(markup).toContain('4. 仕様書を作成します');
    expect(markup).not.toContain('5. 仕様書を作成します');
    expect(markup).toContain('今すぐ実装開始');
    expect(markup).toContain('キューに追加');
    expect(markup.match(/disabled=""/g) || []).toHaveLength(5);
  });

  it('disables Plan Mode capability actions while keeping read-only status visible', () => {
    const markup = renderToStaticMarkup(
      <PlanWorkspaceStatusView
        workspace={
          {
            blueprintArtifacts: [{ id: 'blueprint-1', title: 'Blueprint' }],
            dataModelArtifacts: [{ id: 'data-model-1', title: 'Data Model' }],
          } as never
        }
        questionnaireSession={
          {
            id: 'questionnaire-1',
            status: 'accepted',
            answers: [],
            questionSets: [],
          } as never
        }
        busyAction={null}
        canGenerateDataModel={true}
        hasFeaturePlan={true}
        planModeSettings={{
          capabilities: {
            questionnaire: true,
            feature_plan: false,
            user_flow: true,
            blueprint: false,
            data_model: false,
            api_io_contract: true,
            state_model: true,
            activity_flow: true,
            sequence_flow: true,
            zod_schema_design: true,
          },
        }}
        onOpenQuestionnaire={vi.fn()}
        onGenerateBlueprint={vi.fn()}
        onGenerateDataModel={vi.fn()}
        onGenerateFeaturePlan={vi.fn()}
        onGenerateDedicatedViews={vi.fn()}
        onQueueSession={vi.fn()}
        onAddToQueue={vi.fn()}
      />
    );

    expect(markup).toContain('アンケートを確認');
    expect(markup).toContain('Blueprintを再生成');
    expect(markup).toContain('Data Modelを再生成');
    expect(markup).toContain('仕様書を再生成');
    expect(markup).toContain('Plan Mode capability is disabled in Settings.');
    expect(markup.match(/disabled=""/g) || []).toHaveLength(3);
  });

  it('allows included Data Model work without forcing Questionnaire or Blueprint steps', () => {
    const markup = renderToStaticMarkup(
      <PlanWorkspaceStatusView
        workspace={null}
        questionnaireSession={null}
        busyAction={null}
        canGenerateDataModel={true}
        hasFeaturePlan={false}
        planModeSettings={{
          capabilities: {
            questionnaire: true,
            feature_plan: true,
            user_flow: true,
            blueprint: true,
            data_model: true,
            api_io_contract: true,
            state_model: true,
            activity_flow: true,
            sequence_flow: true,
            zod_schema_design: true,
          },
        }}
        viewDecisions={[
          { view: 'questionnaire', decision: 'omit', reason: 'not needed' },
          { view: 'blueprint', decision: 'omit', reason: 'no UI' },
          { view: 'data_model', decision: 'include', reason: 'storage contract needed' },
        ]}
        onOpenQuestionnaire={vi.fn()}
        onGenerateBlueprint={vi.fn()}
        onGenerateDataModel={vi.fn()}
        onGenerateFeaturePlan={vi.fn()}
        onGenerateDedicatedViews={vi.fn()}
      />
    );

    expect(markup).toContain('Data Model作成');
    expect(markup).not.toContain('アンケートへ');
    expect(markup).not.toContain('Blueprint作成');
    expect(markup).toContain('Data Model: include - storage contract needed');
    expect(markup).toContain('Questionnaire: omit - not needed');
    expect(markup).toMatch(/<button[^>]*>Data Model作成<\/button>/);
  });

  it('hides stale Blueprint artifacts when routing omits Frontend UI work', () => {
    const markup = renderToStaticMarkup(
      <PlanWorkspaceStatusView
        workspace={
          {
            blueprintArtifacts: [{ id: 'blueprint-1', title: 'Prior Blueprint' }],
            dataModelArtifacts: [],
            dedicatedViewArtifacts: [],
          } as never
        }
        questionnaireSession={
          {
            id: 'questionnaire-1',
            status: 'accepted',
            answers: [],
            questionSets: [],
          } as never
        }
        busyAction={null}
        canGenerateDataModel={true}
        hasFeaturePlan={false}
        viewDecisions={[
          { view: 'questionnaire', decision: 'omit', reason: 'not needed' },
          { view: 'blueprint', decision: 'omit', reason: 'documentation only' },
        ]}
        onOpenQuestionnaire={vi.fn()}
        onGenerateBlueprint={vi.fn()}
        onGenerateDataModel={vi.fn()}
        onGenerateFeaturePlan={vi.fn()}
        onGenerateDedicatedViews={vi.fn()}
      />
    );

    expect(markup).not.toContain('インスタントMockUpを作成し、大筋UIの方向性を決めます');
    expect(markup).not.toContain('Blueprint作成');
    expect(markup).not.toContain('Blueprintを再生成');
    expect(markup).toContain('1. 仕様書を作成します');
  });

  it('does not show Blueprint or Data Model creation by default when routing decisions are missing', () => {
    const markup = renderToStaticMarkup(
      <PlanWorkspaceStatusView
        workspace={
          {
            blueprintArtifacts: [],
            dataModelArtifacts: [],
            dedicatedViewArtifacts: [],
          } as never
        }
        questionnaireSession={
          {
            id: 'questionnaire-1',
            status: 'accepted',
            answers: [],
            questionSets: [],
          } as never
        }
        busyAction={null}
        canGenerateDataModel={true}
        hasFeaturePlan={false}
        onOpenQuestionnaire={vi.fn()}
        onGenerateBlueprint={vi.fn()}
        onGenerateDataModel={vi.fn()}
        onGenerateFeaturePlan={vi.fn()}
        onGenerateDedicatedViews={vi.fn()}
      />
    );

    expect(markup).toContain('アンケートを確認');
    expect(markup).toContain('仕様書作成');
    expect(markup).not.toContain('Blueprint作成');
    expect(markup).not.toContain('Data Model作成');
    expect(markup).toContain('2. 仕様書を作成します');
    expect(markup).not.toContain('3. 仕様書を作成します');
  });

  it('allows included Blueprint work without forcing Questionnaire first', () => {
    const markup = renderToStaticMarkup(
      <PlanWorkspaceStatusView
        workspace={null}
        questionnaireSession={null}
        busyAction={null}
        canGenerateDataModel={true}
        hasFeaturePlan={false}
        viewDecisions={[
          { view: 'questionnaire', decision: 'omit', reason: 'not needed' },
          { view: 'blueprint', decision: 'include', reason: 'UI exists' },
        ]}
        onOpenQuestionnaire={vi.fn()}
        onGenerateBlueprint={vi.fn()}
        onGenerateDataModel={vi.fn()}
        onGenerateFeaturePlan={vi.fn()}
        onGenerateDedicatedViews={vi.fn()}
      />
    );

    expect(markup).toContain('Blueprint作成');
    expect(markup).not.toContain('アンケートへ');
    expect(markup).toMatch(/<button[^>]*>Blueprint作成<\/button>/);
  });

  it('shows separate generation actions for included plan views', () => {
    const markup = renderToStaticMarkup(
      <PlanWorkspaceStatusView
        workspace={
          {
            blueprintArtifacts: [],
            dataModelArtifacts: [],
            dedicatedViewArtifacts: [],
          } as never
        }
        questionnaireSession={null}
        busyAction={null}
        canGenerateDataModel={true}
        hasFeaturePlan={true}
        viewDecisions={[
          { view: 'questionnaire', decision: 'omit', reason: 'not needed' },
          { view: 'blueprint', decision: 'omit', reason: 'no UI' },
          { view: 'user_flow', decision: 'include', reason: 'flow changes' },
          { view: 'api_io_contract', decision: 'include', reason: 'API changes' },
        ]}
        onOpenQuestionnaire={vi.fn()}
        onGenerateBlueprint={vi.fn()}
        onGenerateDataModel={vi.fn()}
        onGenerateFeaturePlan={vi.fn()}
        onGenerateDedicatedViews={vi.fn()}
      />
    );

    expect(markup).toContain('1. User Flowを作成します');
    expect(markup).toContain('2. API / I/Oを作成します');
    expect(markup).toContain('3. 仕様書を作成します');
    expect(markup).toContain('User Flow作成');
    expect(markup).toContain('API / I/O作成');
    expect(markup).not.toContain('追加の Plan View');
    expect(markup).not.toContain('追加Viewを生成');
    expect(markup).toContain('User Flow: include - flow changes');
    expect(markup).toContain('API / I/O: include - API changes');
  });

  it('shows regeneration actions for generated plan views', () => {
    const markup = renderToStaticMarkup(
      <PlanWorkspaceStatusView
        workspace={
          {
            blueprintArtifacts: [],
            dataModelArtifacts: [],
            dedicatedViewArtifacts: [
              { id: 'user-flow-1', kind: 'user_flow', title: 'User Flow' },
              { id: 'api-contract-1', kind: 'api_io_contract', title: 'API / I/O' },
            ],
          } as never
        }
        questionnaireSession={null}
        busyAction={null}
        canGenerateDataModel={true}
        hasFeaturePlan={true}
        viewDecisions={[
          { view: 'questionnaire', decision: 'omit', reason: 'not needed' },
          { view: 'blueprint', decision: 'omit', reason: 'no UI' },
          { view: 'user_flow', decision: 'include', reason: 'flow changes' },
          { view: 'api_io_contract', decision: 'include', reason: 'API changes' },
        ]}
        onOpenQuestionnaire={vi.fn()}
        onGenerateBlueprint={vi.fn()}
        onGenerateDataModel={vi.fn()}
        onGenerateFeaturePlan={vi.fn()}
        onGenerateDedicatedViews={vi.fn()}
      />
    );

    expect(markup).toContain('User Flowが作成済みです。');
    expect(markup).toContain('API / I/Oが作成済みです。');
    expect(markup).toContain('User Flowを再生成');
    expect(markup).toContain('API / I/Oを再生成');
    expect(markup).not.toContain('生成状況を確認');
    expect(markup).toMatch(/<button[^>]*>User Flowを再生成<\/button>/);
    expect(markup).toMatch(/<button[^>]*>API \/ I\/Oを再生成<\/button>/);
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>User Flowを再生成<\/button>/);
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>API \/ I\/Oを再生成<\/button>/);
  });

  it('disables plan view actions disabled in Plan Mode settings', () => {
    const markup = renderToStaticMarkup(
      <PlanWorkspaceStatusView
        workspace={
          {
            blueprintArtifacts: [],
            dataModelArtifacts: [],
            dedicatedViewArtifacts: [],
          } as never
        }
        questionnaireSession={null}
        busyAction={null}
        canGenerateDataModel={true}
        hasFeaturePlan={true}
        planModeSettings={{
          capabilities: {
            questionnaire: true,
            feature_plan: true,
            user_flow: false,
            blueprint: true,
            data_model: true,
            api_io_contract: false,
            state_model: true,
            activity_flow: true,
            sequence_flow: true,
            zod_schema_design: true,
          },
        }}
        viewDecisions={[
          { view: 'user_flow', decision: 'include', reason: 'flow changes' },
          { view: 'api_io_contract', decision: 'include', reason: 'API changes' },
        ]}
        onOpenQuestionnaire={vi.fn()}
        onGenerateBlueprint={vi.fn()}
        onGenerateDataModel={vi.fn()}
        onGenerateFeaturePlan={vi.fn()}
        onGenerateDedicatedViews={vi.fn()}
      />
    );

    expect(markup).toContain('1. User Flowを作成します');
    expect(markup).toContain('2. API / I/Oを作成します');
    expect(markup).toContain('Plan Mode capability is disabled in Settings.');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>User Flow作成<\/button>/);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>API \/ I\/O作成<\/button>/);
    expect(markup).not.toContain('生成状況を確認');
  });
});
