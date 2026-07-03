import { describe, expect, it } from 'vitest';
import {
  normalizePlanViewMermaidArtifact,
  parseGenericDedicatedViewOutput,
} from '../api/modules/planViews/planView-generation.service';
import {
  buildPlanDedicatedViewUserPrompt,
  genericDedicatedViewSchema,
} from '../api/services/structured-generation/prompts/plan-dedicated-view';

describe('Plan View generation helpers', () => {
  it('lists every strict object property in required for structured output compatibility', () => {
    expectStrictRequiredProperties(genericDedicatedViewSchema);
  });

  it('includes project stack context in Plan View input', () => {
    const prompt = buildPlanDedicatedViewUserPrompt({
      view: 'api_io_contract',
      task: 'Title: API',
      projectStackContext: '- 既存 Project stack: TypeScript + React + Vite + Hono',
      featurePlan: 'Feature Plan は未生成です。',
      questionnaire: 'Questionnaire は未生成です。',
      blueprint: 'Blueprint は未生成です。',
      dataModel: 'Data Model は未生成です。',
      prompt: 'API contract を作る',
    });

    expect(prompt).toContain('## Project Stack Context');
    expect(prompt).toContain('TypeScript + React + Vite + Hono');
  });

  it('includes Mermaid repair context in Plan View input', () => {
    const prompt = buildPlanDedicatedViewUserPrompt({
      view: 'user_flow',
      task: 'Title: Checkout',
      featurePlan: 'Feature Plan',
      questionnaire: 'Questionnaire',
      blueprint: 'Blueprint',
      dataModel: 'Data Model',
      prompt: 'User Flow を作る',
      repairContext: 'Parse error on line 2\n```mermaid\nflowchart TD\n  A -->\n```',
    });

    expect(prompt).toContain('## Mermaid Parse Repair');
    expect(prompt).toContain('Parse error on line 2');
    expect(prompt).toContain('最小修正');
  });

  it('accepts User Flow Mermaid flowchart artifacts', () => {
    const artifact = parseGenericDedicatedViewOutput(
      JSON.stringify({
        artifactKind: 'plan_mode_dedicated_view',
        view: 'user_flow',
        title: 'Checkout User Flow',
        markdown:
          '```mermaid\nflowchart TD\n  OpenCheckout[Open checkout] --> SubmitPayment[Submit payment]\n```',
        diagramKind: 'flowchart',
      }),
      'user_flow'
    );

    expect(artifact.view).toBe('user_flow');
    expect(artifact.diagramKind).toBe('flowchart');
  });

  it('sanitizes Markdown syntax inside generated flowchart labels before saving', () => {
    const artifact = normalizePlanViewMermaidArtifact({
      artifactKind: 'plan_mode_dedicated_view',
      view: 'user_flow',
      title: 'User Flow',
      markdown:
        '```mermaid\nflowchart TD\n  step29["`styles.css` で共通の余白、見出し間隔、ボタン優先度を調整する"]\n```',
      diagramKind: 'flowchart',
    });

    expect(artifact.markdown).toContain('styles.css');
    expect(artifact.markdown).not.toContain('`styles.css`');
  });

  it('rejects User Flow Markdown-only artifacts', () => {
    expect(() =>
      parseGenericDedicatedViewOutput(
        JSON.stringify({
          artifactKind: 'plan_mode_dedicated_view',
          view: 'user_flow',
          title: 'Checkout User Flow',
          markdown: '# Checkout User Flow\n\n1. User opens checkout.\n2. User submits payment.',
          diagramKind: null,
        }),
        'user_flow'
      )
    ).toThrow('Mermaid diagram');
  });

  it('normalizes null diagramKind from strict structured output', () => {
    const artifact = parseGenericDedicatedViewOutput(
      JSON.stringify({
        artifactKind: 'plan_mode_dedicated_view',
        view: 'api_io_contract',
        title: 'Task API Contract',
        markdown: '# Task API Contract\n\n## Request\n- id',
        diagramKind: null,
      }),
      'api_io_contract'
    );

    expect(artifact.diagramKind).toBeUndefined();
  });

  it('accepts API I/O contract Markdown artifacts', () => {
    const artifact = parseGenericDedicatedViewOutput(
      JSON.stringify({
        artifactKind: 'plan_mode_dedicated_view',
        view: 'api_io_contract',
        title: 'Task API Contract',
        markdown: '# Task API Contract\n\n## Request\n- id\n\n## Response\n- task',
      }),
      'api_io_contract'
    );

    expect(artifact.view).toBe('api_io_contract');
  });

  it('accepts state model with stateDiagram-v2 only', () => {
    const artifact = parseGenericDedicatedViewOutput(
      JSON.stringify({
        artifactKind: 'plan_mode_dedicated_view',
        view: 'state_model',
        title: 'Task State Model',
        markdown: '```mermaid\nstateDiagram-v2\n  draft --> ready\n```',
        diagramKind: 'stateDiagram-v2',
      }),
      'state_model'
    );

    expect(artifact.diagramKind).toBe('stateDiagram-v2');
  });

  it('rejects State Model Markdown-only artifacts', () => {
    expect(() =>
      parseGenericDedicatedViewOutput(
        JSON.stringify({
          artifactKind: 'plan_mode_dedicated_view',
          view: 'state_model',
          title: 'Task State Model',
          markdown: '# State Model\n\n- draft\n- ready',
          diagramKind: null,
        }),
        'state_model'
      )
    ).toThrow('Mermaid diagram');
  });

  it('rejects unsupported diagrams', () => {
    expect(() =>
      parseGenericDedicatedViewOutput(
        JSON.stringify({
          artifactKind: 'plan_mode_dedicated_view',
          view: 'activity_flow',
          title: 'Invalid Flow',
          markdown: `\`\`\`mermaid\n${'use' + 'case'}Diagram\n  actor User\n\`\`\``,
          diagramKind: 'flowchart',
        }),
        'activity_flow'
      )
    ).toThrow('not allowed');
  });

  it('rejects Activity Flow Markdown-only artifacts', () => {
    expect(() =>
      parseGenericDedicatedViewOutput(
        JSON.stringify({
          artifactKind: 'plan_mode_dedicated_view',
          view: 'activity_flow',
          title: 'Activity Flow',
          markdown: '# Activity Flow\n\n- Validate input\n- Save task',
          diagramKind: null,
        }),
        'activity_flow'
      )
    ).toThrow('Mermaid diagram');
  });

  it('requires diagramKind when a diagram view returns Mermaid', () => {
    expect(() =>
      parseGenericDedicatedViewOutput(
        JSON.stringify({
          artifactKind: 'plan_mode_dedicated_view',
          view: 'sequence_flow',
          title: 'Sequence Flow',
          markdown: '```mermaid\nsequenceDiagram\n  User->>API: submit\n```',
        }),
        'sequence_flow'
      )
    ).toThrow('diagramKind');
  });

  it('rejects Sequence Flow Markdown-only artifacts', () => {
    expect(() =>
      parseGenericDedicatedViewOutput(
        JSON.stringify({
          artifactKind: 'plan_mode_dedicated_view',
          view: 'sequence_flow',
          title: 'Sequence Flow',
          markdown: '# Sequence Flow\n\n- User submits request\n- API returns response',
          diagramKind: null,
        }),
        'sequence_flow'
      )
    ).toThrow('Mermaid diagram');
  });

  it('accepts Zod schema design without Mermaid diagram metadata', () => {
    const artifact = parseGenericDedicatedViewOutput(
      JSON.stringify({
        artifactKind: 'plan_mode_dedicated_view',
        view: 'zod_schema_design',
        title: 'Schema Design',
        markdown: '# Schema Design\n\n| schema | owner | consumer |\n| --- | --- | --- |',
      }),
      'zod_schema_design'
    );

    expect(artifact.view).toBe('zod_schema_design');
  });
});

function expectStrictRequiredProperties(schema: unknown) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return;
  const record = schema as Record<string, unknown>;
  if (record.additionalProperties === false && isRecord(record.properties)) {
    const required = Array.isArray(record.required) ? record.required.map(String) : [];
    expect(required.sort()).toEqual(Object.keys(record.properties).sort());
  }
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) expectStrictRequiredProperties(item);
    } else {
      expectStrictRequiredProperties(value);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
