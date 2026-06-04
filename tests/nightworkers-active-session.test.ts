import { describe, expect, it } from 'vitest';
import { resolveNextActiveSessionId } from '../src/modules/nightworkers/hooks/useNightWorkersWorkspace';

describe('resolveNextActiveSessionId', () => {
  it('keeps the current session when it still exists', () => {
    expect(
      resolveNextActiveSessionId('session-b', [{ id: 'session-a' }, { id: 'session-b' }])
    ).toBe('session-b');
  });

  it('moves to the first remaining session when the current one was deleted', () => {
    expect(resolveNextActiveSessionId('deleted-session', [{ id: 'session-a' }])).toBe('session-a');
  });

  it('clears the active session when no sessions remain', () => {
    expect(resolveNextActiveSessionId('deleted-session', [])).toBeNull();
  });
});
