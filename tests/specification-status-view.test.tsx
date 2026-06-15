import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SpecificationStatusView } from '../src/modules/nightworkers/components/ArtifactWorkspacePanels';

describe('SpecificationStatusView', () => {
  it('shows separate start-now and add-to-queue actions after the status flow is complete', () => {
    const markup = renderToStaticMarkup(
      <SpecificationStatusView
        workspace={
          {
            blueprintArtifacts: [{ id: 'blueprint-1', title: 'Blueprint' }],
            dbDesignArtifacts: [{ id: 'db-design-1', title: 'DB Design' }],
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
        canGenerateDbDesign={true}
        hasSpecification={true}
        onOpenQuestionnaire={vi.fn()}
        onGenerateBlueprint={vi.fn()}
        onGenerateDbDesign={vi.fn()}
        onGenerateSpecification={vi.fn()}
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
      <SpecificationStatusView
        workspace={
          {
            blueprintArtifacts: [{ id: 'blueprint-1', title: 'Blueprint' }],
            dbDesignArtifacts: [{ id: 'db-design-1', title: 'DB Design' }],
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
        canGenerateDbDesign={true}
        hasSpecification={true}
        isImplementationLocked={true}
        onOpenQuestionnaire={vi.fn()}
        onGenerateBlueprint={vi.fn()}
        onGenerateDbDesign={vi.fn()}
        onGenerateSpecification={vi.fn()}
        onQueueSession={vi.fn()}
        onAddToQueue={vi.fn()}
      />
    );

    expect(markup).toContain('アンケートを確認');
    expect(markup).toContain('Blueprintを再生成');
    expect(markup).toContain('DBデザインを再生成');
    expect(markup).toContain('仕様書を再生成');
    expect(markup).toContain('今すぐ実装開始');
    expect(markup).toContain('キューに追加');
    expect(markup.match(/disabled=""/g) || []).toHaveLength(5);
  });
});
