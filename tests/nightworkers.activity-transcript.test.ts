import { describe, expect, it } from 'vitest';
import {
  buildTranscriptItems,
  dedupeAndSortActivityEvents,
} from '../src/modules/nightworkers/activityTranscript';
import type { ActivityEvent } from '../src/modules/nightworkers/types';

function event(
  input: Partial<ActivityEvent> & Pick<ActivityEvent, 'id' | 'kind' | 'seq'>
): ActivityEvent {
  return {
    taskId: '00000000-0000-4000-8000-000000000001',
    source: 'system',
    visibility: 'visible',
    createdAt: new Date(0).toISOString(),
    ...input,
  };
}

describe('activity transcript reducer', () => {
  it('dedupes by id and sorts by task seq', () => {
    const first = event({ id: 'a', kind: 'system.info', seq: 2, text: 'old' });
    const replacement = event({ id: 'a', kind: 'system.info', seq: 2, text: 'new' });
    const sorted = dedupeAndSortActivityEvents([
      first,
      event({ id: 'b', kind: 'user.message', seq: 1, text: 'hello' }),
      replacement,
    ]);

    expect(sorted.map((item) => item.id)).toEqual(['b', 'a']);
    expect(sorted[1]?.text).toBe('new');
  });

  it('keeps pause and resume inside one assistant turn', () => {
    const items = buildTranscriptItems({
      events: [
        event({ id: 'd1', kind: 'assistant.delta', seq: 1, turnId: 'turn-a', text: 'first ' }),
        event({ id: 'p1', kind: 'assistant.pause', seq: 2, turnId: 'turn-a' }),
        event({ id: 'r1', kind: 'assistant.resume', seq: 3, turnId: 'turn-a' }),
        event({ id: 'd2', kind: 'assistant.delta', seq: 4, turnId: 'turn-a', text: 'second' }),
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('assistant_turn');
    if (items[0]?.kind !== 'assistant_turn') return;
    expect(items[0].text).toBe('first second');
    expect(items[0].children.map((child) => child.kind)).toEqual(['status', 'status']);
  });

  it('keeps tool and diff events as assistant children', () => {
    const items = buildTranscriptItems({
      events: [
        event({ id: 'd1', kind: 'assistant.delta', seq: 1, turnId: 'turn-a', text: 'working' }),
        event({ id: 't1', kind: 'tool.call', seq: 2, turnId: 'turn-a', text: 'apply_patch' }),
        event({ id: 'f1', kind: 'file.patch', seq: 3, turnId: 'turn-a', artifactId: 'art-1' }),
        event({ id: 'j1', kind: 'llm.decision_json', seq: 4, turnId: 'turn-a' }),
      ],
      artifacts: [
        {
          id: 'art-1',
          taskId: '00000000-0000-4000-8000-000000000001',
          kind: 'patch',
          contentText: 'diff --git a/a b/a',
          createdAt: new Date(0).toISOString(),
        },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('assistant_turn');
    if (items[0]?.kind !== 'assistant_turn') return;
    expect(items[0].children.map((child) => child.kind)).toEqual(['tool', 'diff', 'json']);
    const diffChild = items[0].children[1];
    expect(diffChild?.kind).toBe('diff');
    if (diffChild?.kind === 'diff') expect(diffChild.artifact?.id).toBe('art-1');
  });

  it('renders unknown activity instead of dropping it', () => {
    const items = buildTranscriptItems({
      events: [event({ id: 'u1', kind: 'unknown.activity', seq: 1, ingestError: 'unsupported' })],
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('unknown');
  });
});
