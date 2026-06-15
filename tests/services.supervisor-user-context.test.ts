import { describe, expect, it } from 'vitest';
import {
  extractRound2UserContextSection,
  parseRound2UserContextJsonSection,
  renderRound2UserContext,
} from '../api/services/supervisor/user-context';

describe('supervisor Round 2 user context', () => {
  it('labels user request, execution state, evidence, source refs, and safety separately', () => {
    const rendered = renderRound2UserContext({
      latestUserMessage: 'src/app.ts を直して',
      goal: 'app を修正する',
      currentJobType: 'minor_code_edit',
      workflow: 'minor_code_edit',
      safetyPolicy: { externalAllowedPaths: ['/template'] },
      todoPlan: [{ seq: 1, status: 'running' }],
      currentTodo: { seq: 1, status: 'running' },
      toolResults: [{ step: 1, toolName: 'read_file', ok: true }],
      loadedProcedureSummaries: [{ jobType: 'minor_code_edit', digest: 'sha256:abc' }],
      artifactContextRefs: [
        { kind: 'contextstill_context_pack', refId: 'ctx-1', status: 'evidence_only' },
      ],
    });

    expect(extractRound2UserContextSection(rendered, 'Latest User Request')).toBe(
      'src/app.ts を直して'
    );
    expect(parseRound2UserContextJsonSection<unknown>(rendered, 'Current Execution State')).toEqual(
      {
        todoPlan: [{ seq: 1, status: 'running' }],
        currentTodo: { seq: 1, status: 'running' },
      }
    );
    expect(
      parseRound2UserContextJsonSection<unknown[]>(rendered, 'Recent Tool Evidence')[0]
    ).toMatchObject({
      toolName: 'read_file',
    });
    expect(extractRound2UserContextSection(rendered, 'Artifact and Source References')).toContain(
      'kind=contextstill_context_pack status=evidence_only refId=ctx-1'
    );
    expect(parseRound2UserContextJsonSection<unknown>(rendered, 'Safety Context')).toEqual({
      externalAllowedPaths: ['/template'],
    });
  });
});
