import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectEvaluationImprovementInstructionField } from '../src/modules/project-evaluation/components/ImprovementIdeaCard';
import type { ProjectImprovementIdea } from '../src/modules/project-evaluation/model/projectEvaluationTypes';

const idea: ProjectImprovementIdea = {
  title: '評価結果から Task draft を生成する',
  summary:
    '評価結果を実装候補へ変換するため、選択された評価軸、rationale、期待 score impact を Task draft として扱える形にする。',
  agentPrompt:
    'LLM は保存済み Project Evaluation の選択評価軸、rationale、期待 score impact を読み取り、自然言語の Task draft を作成すること。',
  expectedOutcome: 'Project owner が次に実装へ移すべき改善を判断できる。',
  implementationFocus: ['評価軸と改善候補の対応を明確にする'],
  targetDimensions: ['implementation_readiness'],
  scoreImpacts: [],
};

describe('project evaluation improvement instruction field', () => {
  it('renders implementation instructions as a hidden field separate from visible text', () => {
    const markup = renderToStaticMarkup(
      createElement(ProjectEvaluationImprovementInstructionField, { idea })
    );

    expect(markup).toContain('type="hidden"');
    expect(markup).toContain('name="projectEvaluationLlmImplementationInstruction"');
    expect(markup).toContain('data-llm-implementation-instruction="project-evaluation"');
    expect(markup).toContain('LLM');
  });
});
