import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProjectEvaluationActivityPanel } from '../src/modules/project-evaluation/components/ProjectEvaluationActivityPanel';
import { ProjectEvaluationEmptyState } from '../src/modules/project-evaluation/components/ProjectEvaluationEmptyState';
import { ProjectEvaluationToolbar } from '../src/modules/project-evaluation/components/ProjectEvaluationToolbar';
import type { ProjectEvaluationActivityEvent } from '../src/modules/project-evaluation/model/projectEvaluationTypes';

const event = (
  input: Partial<ProjectEvaluationActivityEvent> &
    Pick<ProjectEvaluationActivityEvent, 'id' | 'seq'>
): ProjectEvaluationActivityEvent => ({
  evaluationId: '00000000-0000-4000-8000-000000000001',
  phase: 'judge',
  level: 'info',
  source: 'structured-llm',
  message: 'evaluation role の LLM に評価 JSON を依頼中です。',
  createdAt: new Date(0).toISOString(),
  ...input,
});

describe('ProjectEvaluationActivityPanel', () => {
  it('renders project evaluation activity as chat-style assistant messages', () => {
    const markup = renderToStaticMarkup(
      <ProjectEvaluationActivityPanel
        events={[
          event({ id: 'event-2', seq: 2, message: '評価を保存します: 70 / 100。' }),
          event({
            id: 'event-1',
            seq: 1,
            payload: {
              type: 'model.request_started',
              data: {
                provider: 'fixture',
                model: 'fixture-eval-model',
              },
            },
          }),
          event({
            id: 'event-3',
            seq: 3,
            message: 'fixture response delta',
            payload: {
              type: 'model.response_delta',
              data: {
                text: '{"schemaVersion"',
              },
            },
          }),
        ]}
        isRunning={false}
      />
    );

    expect(markup).toContain('LLM アクティビティ');
    expect(markup).toContain('<details');
    expect(markup).toContain('LLM request');
    expect(markup).toContain('schemaVersion');
    expect(markup).toContain('evaluation role の LLM に評価 JSON を依頼中です。');
    expect(markup).toContain('評価を保存します: 70 / 100。');
  });

  it('shows moving loading indicators while the evaluation request is running', () => {
    const toolbar = renderToStaticMarkup(
      <ProjectEvaluationToolbar
        error={null}
        evaluation={null}
        isRunning={true}
        onRun={vi.fn()}
        project={{
          id: 'repo-1',
          name: 'Project',
          localPath: '/tmp/project',
        }}
      />
    );
    const empty = renderToStaticMarkup(
      <ProjectEvaluationEmptyState isLoading={true} onRun={vi.fn()} />
    );

    expect(toolbar).toContain('animate-spin');
    expect(toolbar).toContain('LLMに依頼中');
    expect(empty).toContain('animate-spin');
    expect(empty).toContain('LLMに依頼中');
  });
});
