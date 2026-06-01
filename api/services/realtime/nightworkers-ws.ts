import type { WebSocket } from 'ws';
import { logEvent } from '../../lib/logger';

type SocketMessage = {
  type: string;
  taskId?: string;
  runId?: string;
  seq?: number;
  event?: unknown;
  payload?: unknown;
  timestamp: string;
};

class NightWorkersRealtimeBroker {
  private subscribers = new Map<string, Set<WebSocket>>();

  subscribe(taskId: string, ws: WebSocket) {
    if (!this.subscribers.has(taskId)) {
      this.subscribers.set(taskId, new Set());
    }
    this.subscribers.get(taskId)?.add(ws);
    logEvent({
      channel: 'ws',
      level: 'debug',
      message: 'subscribed',
      meta: { taskId, subscribers: this.subscribers.get(taskId)?.size ?? 0 },
    });
  }

  unsubscribe(taskId: string, ws: WebSocket) {
    const set = this.subscribers.get(taskId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
      this.subscribers.delete(taskId);
    }
    logEvent({
      channel: 'ws',
      level: 'debug',
      message: 'unsubscribed',
      meta: { taskId, subscribers: this.subscribers.get(taskId)?.size ?? 0 },
    });
  }

  unsubscribeAll(ws: WebSocket) {
    let removed = 0;
    for (const [taskId, set] of this.subscribers.entries()) {
      if (set.has(ws)) {
        set.delete(ws);
        removed += 1;
      }
      if (set.size === 0) {
        this.subscribers.delete(taskId);
      }
    }
    logEvent({
      channel: 'ws',
      level: 'debug',
      message: 'unsubscribeAll',
      meta: { removedSubscriptions: removed },
    });
  }

  publish(taskId: string, message: Omit<SocketMessage, 'taskId' | 'timestamp'>) {
    const set = this.subscribers.get(taskId);
    if (!set || set.size === 0) {
      logEvent({
        channel: 'ws',
        level: 'debug',
        message: 'publish skipped: no subscribers',
        meta: { taskId, type: message.type },
      });
      return;
    }
    const eventPayload = (message as { event?: any }).event;
    if (message.type === 'task_event_created') {
      if (
        !taskId ||
        !message.runId ||
        !eventPayload?.id ||
        typeof eventPayload?.seq !== 'number' ||
        !eventPayload?.timestamp
      ) {
        logEvent({
          channel: 'ws',
          level: 'warn',
          message: 'publish skipped: invalid task_event_created payload',
          meta: { taskId, runId: message.runId, event: eventPayload },
        });
        return;
      }
    }

    const wire = JSON.stringify({
      ...message,
      taskId,
      seq: eventPayload?.seq,
      timestamp: new Date().toISOString(),
    } satisfies SocketMessage);
    for (const ws of set) {
      if (ws.readyState === ws.OPEN) {
        ws.send(wire);
      }
    }
    logEvent({
      channel: 'ws',
      level: 'debug',
      message: 'published',
      meta: { taskId, type: message.type, subscribers: set.size },
    });
  }
}

export const nightWorkersRealtimeBroker = new NightWorkersRealtimeBroker();
