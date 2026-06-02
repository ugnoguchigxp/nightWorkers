import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callSupervisorLLM } from '../api/services/supervisor/llm-provider';
import { buildRound2SystemPrompt } from '../api/services/supervisor/prompt';

describe('Supervisor LLM provider evidence fallback', () => {
  const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    if (originalProvider === undefined) {
      delete process.env.ACTIVE_LLM_PROVIDER;
    } else {
      process.env.ACTIVE_LLM_PROVIDER = originalProvider;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('infers read_file for file-path review tasks when round 2 omits a required tool call', async () => {
    const decision = await callSupervisorLLM(
      buildRound2SystemPrompt(),
      JSON.stringify({
        latestUserMessage:
          'spec/jsonl-replay-import-regression-implementation-plan.md のドキュメントレビューをしてください',
        round1Decision: {
          phase: 'plan',
          instruction: 'Review the requested specification document.',
          rationale: 'Need repository evidence.',
          finalResponse: '',
          expectedEvidence: ['spec document contents'],
          riskLevel: 'medium',
          toolCall: null,
        },
        observations: [],
      }),
      { round: 2, requireToolCall: true }
    );

    expect(decision.phase).toBe('act');
    expect(decision.toolCall).toEqual({
      name: 'read_file',
      arguments: {
        filePath: 'spec/jsonl-replay-import-regression-implementation-plan.md',
      },
    });
  });

  it('allows a stop decision after repository observations have been supplied', async () => {
    const decision = await callSupervisorLLM(
      buildRound2SystemPrompt(),
      JSON.stringify({
        latestUserMessage:
          'spec/jsonl-replay-import-regression-implementation-plan.md のドキュメントレビューをしてください',
        round1Decision: {
          phase: 'plan',
          instruction: 'Review the requested specification document.',
          rationale: 'Need repository evidence.',
          finalResponse: '',
          expectedEvidence: ['spec document contents'],
          riskLevel: 'medium',
          toolCall: null,
        },
        observations: ['tool=read_file status=ok\n# implementation plan'],
      }),
      { round: 2, requireToolCall: true }
    );

    expect(decision.phase).toBe('stop');
    expect(decision.toolCall).toBeNull();
    expect(decision.finalResponse).toContain('after reading repository evidence');
  });
});
