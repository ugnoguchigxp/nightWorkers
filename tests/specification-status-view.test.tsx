import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PlanWorkspaceStatusView } from '../src/modules/planMode';

describe('PlanWorkspaceStatusView', () => {
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
        onQueueSession={vi.fn()}
        onAddToQueue={vi.fn()}
      />
    );

    expect(markup).toContain('アンケートを確認');
    expect(markup).toContain('Blueprintを再生成');
    expect(markup).toContain('Data Modelを再生成');
    expect(markup).toContain('Feature Planを再生成');
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
        onQueueSession={vi.fn()}
        onAddToQueue={vi.fn()}
      />
    );

    expect(markup).toContain('アンケートを確認');
    expect(markup).toContain('Blueprintを再生成');
    expect(markup).toContain('Data Modelを再生成');
    expect(markup).toContain('Feature Planを再生成');
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
      />
    );

    expect(markup).toContain('Data Model作成');
    expect(markup).not.toContain('アンケートへ');
    expect(markup).not.toContain('Blueprint作成');
    expect(markup).toContain('Data Model: include - storage contract needed');
    expect(markup).toContain('Questionnaire: omit - not needed');
    expect(markup).toMatch(/<button[^>]*>Data Model作成<\/button>/);
  });
});
