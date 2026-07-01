import { describe, expect, it } from 'vitest';
import { parseSupervisorOutput } from '../api/services/supervisor/schema-first';

describe('Supervisor schema-first parser', () => {
  it('accepts planning output with planMode routing hints', () => {
    const parsed = parseSupervisorOutput(
      {
        jobType: 'planning',
        goal: 'Feature Plan を作成する',
        planMode: {
          primaryArtifact: 'feature_plan',
          dedicatedViews: [
            {
              view: 'blueprint',
              decision: 'include',
              reason: 'UI behavior needs a dedicated view',
            },
            {
              view: 'data_model',
              decision: 'omit',
              reason: 'No data structure changes are requested',
            },
          ],
          specificationLenses: ['functional_requirements', 'interface_contract'],
        },
      },
      1
    );

    expect(parsed).toMatchObject({
      jobType: 'planning',
      planMode: {
        primaryArtifact: 'feature_plan',
        dedicatedViews: [
          { view: 'blueprint', decision: 'include' },
          { view: 'data_model', decision: 'omit' },
        ],
        specificationLenses: ['functional_requirements', 'interface_contract'],
      },
    });
  });

  it('rejects planMode routing hints for non-planning output', () => {
    expect(() =>
      parseSupervisorOutput(
        {
          jobType: 'minor_code_edit',
          goal: '小さい修正を行う',
          planMode: {
            primaryArtifact: 'feature_plan',
            dedicatedViews: [],
            specificationLenses: [],
          },
        },
        1
      )
    ).toThrow(/planMode is only allowed/);
  });

  it('treats null planMode as absent for non-planning output', () => {
    const parsed = parseSupervisorOutput(
      {
        jobType: 'minor_code_edit',
        goal: '小さい修正を行う',
        planMode: null,
      },
      1
    );

    expect(parsed).toEqual({
      jobType: 'minor_code_edit',
      goal: '小さい修正を行う',
    });
  });

  it('accepts empty planMode reasons without falling back to fixed implementation text', () => {
    const parsed = parseSupervisorOutput(
      {
        jobType: 'planning',
        goal: 'Feature Plan を作成する',
        planMode: {
          primaryArtifact: 'feature_plan',
          dedicatedViews: [{ view: 'data_model', decision: 'omit', reason: '' }],
          specificationLenses: [],
        },
      },
      1
    );

    expect(parsed).toMatchObject({
      planMode: {
        dedicatedViews: [{ view: 'data_model', decision: 'omit', reason: '' }],
      },
    });
  });

  it('rejects non-feature-plan primary artifacts', () => {
    expect(() =>
      parseSupervisorOutput(
        {
          jobType: 'planning',
          goal: '計画を作る',
          planMode: {
            primaryArtifact: 'blueprint',
            dedicatedViews: [],
            specificationLenses: [],
          },
        },
        1
      )
    ).toThrow();
  });
});
