import { describe, expect, it } from 'vitest';
import { compileContext, registerCandidate } from '../api/services/context-still/adapter';

const runId = '11111111-1111-4111-8111-111111111111';
const taskId = '22222222-2222-4222-8222-222222222222';

describe('contextStill adapter contract', () => {
  it('returns a degraded fallback compile response when contextStill is disabled', async () => {
    const previous = process.env.CONTEXT_STILL_ENABLED;
    process.env.CONTEXT_STILL_ENABLED = 'false';

    const result = await compileContext({
      repositoryPath: '/tmp/repo',
      taskTitle: 'Fix bug',
      taskDescription: 'Make the failing test pass',
      taskId,
      runId,
    });

    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe('context_still_disabled');
    expect(result.includedMemoryRefs).toEqual([]);
    expect(result.compiledPromptText).toContain('Make the failing test pass');

    if (previous === undefined) delete process.env.CONTEXT_STILL_ENABLED;
    else process.env.CONTEXT_STILL_ENABLED = previous;
  });

  it('normalizes disabled registration as degraded instead of throwing', async () => {
    const previous = process.env.CONTEXT_STILL_ENABLED;
    process.env.CONTEXT_STILL_ENABLED = 'false';

    const result = await registerCandidate({
      id: '33333333-3333-4333-8333-333333333333',
      version: 1,
      sourceRunId: runId,
      sourceTaskId: taskId,
      sourceEventIds: ['event-1'],
      kind: 'procedure',
      title: 'Run verification before final answer',
      body: 'Always run the relevant verification command.',
      appliesTo: {},
      confidence: 'medium',
      status: 'approved',
      createdAt: '2026-06-02T00:00:00.000Z',
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'degraded',
        errorCode: 'context_still_disabled',
      })
    );

    if (previous === undefined) delete process.env.CONTEXT_STILL_ENABLED;
    else process.env.CONTEXT_STILL_ENABLED = previous;
  });
});
