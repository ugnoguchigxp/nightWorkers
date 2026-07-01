import { describe, expect, it } from 'vitest';
import { parseGenericDedicatedViewOutput } from '../api/modules/planViews/planView-generation.service';

describe('Plan dedicated view generation helpers', () => {
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
