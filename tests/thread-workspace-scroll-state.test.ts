import { describe, expect, it } from 'vitest';
import {
  createScrollSnapshot,
  resolveRestoredScrollTop,
  shouldKeepPendingRestore,
} from '../src/modules/nightworkers/components/ThreadWorkspace';

describe('ThreadWorkspace scroll restoration', () => {
  it('keeps the viewport pinned to the bottom when the user was already near the latest message', () => {
    const snapshot = createScrollSnapshot({
      scrollTop: 752,
      scrollHeight: 1200,
      clientHeight: 400,
    });

    expect(snapshot.wasNearBottom).toBe(true);
    expect(
      resolveRestoredScrollTop(snapshot, {
        scrollHeight: 1680,
        clientHeight: 420,
      })
    ).toBe(1260);
  });

  it('preserves relative scroll progress when the user was reading earlier content', () => {
    const snapshot = createScrollSnapshot({
      scrollTop: 240,
      scrollHeight: 1200,
      clientHeight: 400,
    });

    expect(snapshot.wasNearBottom).toBe(false);
    expect(
      resolveRestoredScrollTop(snapshot, {
        scrollHeight: 1800,
        clientHeight: 400,
      })
    ).toBe(420);
  });

  it('keeps pending restoration active until the content height catches back up after reload', () => {
    const snapshot = createScrollSnapshot({
      scrollTop: 240,
      scrollHeight: 1200,
      clientHeight: 400,
    });

    expect(
      shouldKeepPendingRestore(
        {
          mode: 'manual',
          snapshot,
        },
        {
          scrollHeight: 900,
          clientHeight: 400,
        }
      )
    ).toBe(true);
    expect(
      shouldKeepPendingRestore(
        {
          mode: 'manual',
          snapshot,
        },
        {
          scrollHeight: 1200,
          clientHeight: 400,
        }
      )
    ).toBe(false);
  });

  it('keeps bottom lock pending across reload until the latest message area is available again', () => {
    expect(
      shouldKeepPendingRestore(
        {
          mode: 'bottom',
        },
        {
          scrollHeight: 600,
          clientHeight: 400,
        }
      )
    ).toBe(true);
  });
});
