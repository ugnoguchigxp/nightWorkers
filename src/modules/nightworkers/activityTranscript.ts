import type { ActivityArtifact, ActivityEvent } from './types';

export type TranscriptChild =
  | { kind: 'tool'; events: ActivityEvent[] }
  | { kind: 'diff'; event: ActivityEvent; artifact?: ActivityArtifact }
  | { kind: 'json'; event: ActivityEvent }
  | { kind: 'log'; event: ActivityEvent; artifact?: ActivityArtifact }
  | { kind: 'status'; event: ActivityEvent }
  | { kind: 'unknown'; event: ActivityEvent; artifact?: ActivityArtifact };

export type TranscriptItem =
  | { kind: 'user_turn'; id: string; turnId: string; events: ActivityEvent[]; text: string }
  | {
      kind: 'assistant_turn';
      id: string;
      turnId: string;
      events: ActivityEvent[];
      text: string;
      children: TranscriptChild[];
    }
  | { kind: 'activity'; id: string; event: ActivityEvent }
  | { kind: 'unknown'; id: string; event: ActivityEvent; artifact?: ActivityArtifact };

export function dedupeAndSortActivityEvents(events: ActivityEvent[]): ActivityEvent[] {
  const byId = new Map<string, ActivityEvent>();
  const anonymous: ActivityEvent[] = [];
  for (const event of events) {
    if (event.id) {
      byId.set(event.id, event);
    } else {
      anonymous.push(event);
    }
  }
  return [...byId.values(), ...anonymous].sort((a, b) => {
    if (a.seq !== b.seq) return a.seq - b.seq;
    return toMs(a.createdAt) - toMs(b.createdAt);
  });
}

export function buildTranscriptItems(input: {
  events: ActivityEvent[];
  artifacts?: ActivityArtifact[];
}): TranscriptItem[] {
  const events = dedupeAndSortActivityEvents(input.events);
  const artifactsById = new Map((input.artifacts || []).map((artifact) => [artifact.id, artifact]));
  const items: TranscriptItem[] = [];
  const assistantByTurn = new Map<string, Extract<TranscriptItem, { kind: 'assistant_turn' }>>();
  const userByTurn = new Map<string, Extract<TranscriptItem, { kind: 'user_turn' }>>();

  for (const event of events) {
    if (event.kind === 'user.message') {
      const turnId = event.turnId || event.id;
      let item = userByTurn.get(turnId);
      if (!item) {
        item = { kind: 'user_turn', id: `user:${turnId}`, turnId, events: [], text: '' };
        userByTurn.set(turnId, item);
        items.push(item);
      }
      item.events.push(event);
      item.text = appendText(item.text, event.text);
      continue;
    }

    if (isAssistantTurnEvent(event)) {
      const turnId = event.turnId || `assistant:${event.runId || event.taskId}`;
      let item = assistantByTurn.get(turnId);
      if (!item) {
        item = {
          kind: 'assistant_turn',
          id: `assistant:${turnId}`,
          turnId,
          events: [],
          text: '',
          children: [],
        };
        assistantByTurn.set(turnId, item);
        items.push(item);
      }
      item.events.push(event);
      if (event.kind === 'assistant.delta' || event.kind === 'llm.response_delta') {
        item.text = `${item.text}${event.text || ''}`;
      } else if (event.kind === 'assistant.message') {
        item.text = event.text || item.text;
      } else if (event.kind !== 'assistant.raw_output') {
        item.children.push({ kind: 'status', event });
      } else {
        item.children.push({ kind: 'log', event, artifact: artifactFor(event, artifactsById) });
      }
      continue;
    }

    const targetTurn = event.turnId ? assistantByTurn.get(event.turnId) : undefined;
    const child = transcriptChildFor(event, artifactsById);
    if (targetTurn && child) {
      targetTurn.events.push(event);
      targetTurn.children.push(child);
      continue;
    }

    if (event.kind === 'unknown.activity') {
      items.push({
        kind: 'unknown',
        id: `unknown:${event.id}`,
        event,
        artifact: artifactFor(event, artifactsById),
      });
    } else {
      items.push({ kind: 'activity', id: `activity:${event.id}`, event });
    }
  }

  return items;
}

function isAssistantTurnEvent(event: ActivityEvent) {
  return [
    'assistant.delta',
    'assistant.message',
    'assistant.pause',
    'assistant.resume',
    'assistant.raw_output',
    'llm.response_delta',
  ].includes(event.kind);
}

function transcriptChildFor(
  event: ActivityEvent,
  artifactsById: Map<string, ActivityArtifact>
): TranscriptChild | null {
  if (event.kind.startsWith('tool.')) return { kind: 'tool', events: [event] };
  if (event.kind.startsWith('file.')) {
    return { kind: 'diff', event, artifact: artifactFor(event, artifactsById) };
  }
  if (event.kind.startsWith('llm.') || event.kind.startsWith('runtime.')) {
    return { kind: 'json', event };
  }
  if (event.kind === 'verification.output' || event.kind === 'command.output') {
    return { kind: 'log', event, artifact: artifactFor(event, artifactsById) };
  }
  if (
    event.kind.startsWith('transport.') ||
    event.kind === 'run.status' ||
    event.kind === 'todo.status' ||
    event.kind.startsWith('system.')
  ) {
    return { kind: 'status', event };
  }
  if (event.kind === 'unknown.activity') {
    return { kind: 'unknown', event, artifact: artifactFor(event, artifactsById) };
  }
  return null;
}

function artifactFor(event: ActivityEvent, artifactsById: Map<string, ActivityArtifact>) {
  return event.artifactId ? artifactsById.get(event.artifactId) : undefined;
}

function appendText(current: string, next?: string | null) {
  if (!next) return current;
  if (!current) return next;
  return `${current}\n${next}`;
}

function toMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
  }
  return Number.MAX_SAFE_INTEGER;
}
