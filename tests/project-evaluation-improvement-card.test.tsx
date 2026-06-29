import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ImprovementIdeaCard } from '../src/modules/project-evaluation/components/ImprovementIdeaCard';
import type {
  ProjectEvaluationDimensionScore,
  ProjectImprovementIdea,
} from '../src/modules/project-evaluation/model/projectEvaluationTypes';

const dimensions: ProjectEvaluationDimensionScore[] = [
  {
    key: 'uiUx',
    label: 'UI / UX',
    score: 70,
    confidence: 0.8,
    rationale: 'UI evidence',
    evidence: [],
    concerns: [],
  },
  {
    key: 'marketCompetitiveness',
    label: '市場競争力',
    score: 62,
    confidence: 0.7,
    rationale: 'Market evidence',
    evidence: [],
    concerns: [],
  },
];

const idea: ProjectImprovementIdea = {
  id: '00000000-0000-4000-8000-000000000001',
  evaluationId: '00000000-0000-4000-8000-000000000002',
  title: 'Showcase を実用デモとして磨き込む',
  summary: 'Showcase を単なるサンプル集ではなく、機能の見え方と試し方が伝わる実用デモにする。',
  agentPrompt: 'Showcase を改善してください。',
  expectedOutcome: 'Showcase の価値が伝わる。',
  implementationFocus: ['Showcase のカテゴリ整理', 'デモ説明の追加'],
  targetDimensions: ['uiUx', 'marketCompetitiveness'],
  scoreImpacts: [
    {
      dimensionKey: 'uiUx',
      currentScore: 70,
      expectedScoreGain: 8,
      expectedScoreAfter: 78,
      rationale: 'Demo clarity improves UX.',
    },
    {
      dimensionKey: 'marketCompetitiveness',
      currentScore: 62,
      expectedScoreGain: 6,
      expectedScoreAfter: 68,
      rationale: 'Clearer showcase improves positioning.',
    },
  ],
};

describe('ImprovementIdeaCard', () => {
  it('shows implementation focus and per-axis score impacts instead of the footer gain', () => {
    const markup = renderToStaticMarkup(
      <ImprovementIdeaCard
        dimensions={dimensions}
        idea={idea}
        onToggle={vi.fn()}
        selected={false}
      />
    );

    expect(markup).toContain('Showcase のカテゴリ整理');
    expect(markup).toContain('デモ説明の追加');
    expect(markup).toContain('改善見込み');
    expect(markup).toContain('UI / UX');
    expect(markup).toContain('70 → 78');
    expect(markup).toContain('+8');
    expect(markup).toContain('市場競争力');
    expect(markup).toContain('62 → 68');
    expect(markup).toContain('+6');
    expect(markup).not.toContain('expected score gain');
  });
});
