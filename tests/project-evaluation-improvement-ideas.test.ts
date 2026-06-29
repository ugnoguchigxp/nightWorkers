import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ProjectEvaluationImprovementInstructionField,
  projectEvaluationImprovementIdeas,
} from '../src/modules/project-evaluation/components/ProjectEvaluationMockScreen';

describe('project evaluation improvement ideas', () => {
  it('keeps visible summaries long enough to explain current problems and importance', () => {
    expect(projectEvaluationImprovementIdeas.length).toBeGreaterThan(0);

    for (const idea of projectEvaluationImprovementIdeas) {
      expect(idea.summary.length).toBeGreaterThanOrEqual(120);
      expect(idea.summary).toMatch(/現状|弱い|不足|分断|曖昧/);
      expect(idea.summary).toMatch(/重要|必要|判断|価値|信頼性|確実/);
    }
  });

  it('stores hidden natural-language implementation instructions for LLM task generation', () => {
    for (const idea of projectEvaluationImprovementIdeas) {
      expect(idea.implementationInstruction.length).toBeGreaterThanOrEqual(100);
      expect(idea.implementationInstruction).toContain('LLM');
      expect(idea.implementationInstruction).toMatch(/自然言語|記述|設計|作成/);
      expect(idea.implementationInstruction).toMatch(/実装|保存|draft|Queue|UI/);
    }
  });

  it('renders implementation instructions as a hidden field separate from visible text', () => {
    const idea = projectEvaluationImprovementIdeas[0];
    const markup = renderToStaticMarkup(
      createElement(ProjectEvaluationImprovementInstructionField, { idea })
    );

    expect(markup).toContain('type="hidden"');
    expect(markup).toContain('name="projectEvaluationLlmImplementationInstruction"');
    expect(markup).toContain('data-llm-implementation-instruction="project-evaluation"');
    expect(markup).toContain('LLM');
  });
});
