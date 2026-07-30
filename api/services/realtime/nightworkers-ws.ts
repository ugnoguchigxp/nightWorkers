import type { WebSocket } from "ws";
import { toDeepRecord } from "../../../shared/json-record";
import { logEvent } from "../../lib/logger";

type SocketMessage = {
	type: string;
	taskId?: string;
	runId?: string;
	seq?: number;
	event?: unknown;
	payload?: unknown;
	timestamp: string;
	replayed?: boolean;
};

type OutboundSocketMessage = Omit<SocketMessage, "taskId" | "timestamp">;
type ReplayEntry = { message: SocketMessage; storedAtMs: number };

const REPLAYABLE_MESSAGE_TYPES = new Set([
	"activity_event_created",
	"task_llm_delta",
	"task_event_created",
	"task_run_updated",
	"task_status_updated",
	"mission_pilot.updated",
	"questionnaire.state_changed",
	"plan_mode.routing_changed",
]);
const MAX_REPLAY_MESSAGES_PER_TASK = 240;
const REPLAY_TTL_MS = 10 * 60 * 1000;

export class NightWorkersRealtimeBroker {
	private subscribers = new Map<string, Set<WebSocket>>();
	private replayHistory = new Map<string, ReplayEntry[]>();
	private nextSeqByTask = new Map<string, number>();
	private sockets = new Set<WebSocket>();

	subscribe(taskId: string, ws: WebSocket) {
		this.sockets.add(ws);
		if (!this.subscribers.has(taskId)) {
			this.subscribers.set(taskId, new Set());
		}
		this.subscribers.get(taskId)?.add(ws);
		logEvent({
			channel: "ws",
			level: "debug",
			message: "subscribed",
			meta: { taskId, subscribers: this.subscribers.get(taskId)?.size ?? 0 },
		});
	}

	replayRecent(taskId: string, ws: WebSocket) {
		const history = this.pruneReplayHistory(taskId);
		let replayed = 0;
		for (const entry of history) {
			if (this.send(ws, { ...entry.message, replayed: true })) replayed += 1;
		}
		logEvent({
			channel: "ws",
			level: "debug",
			message: "replayed recent messages",
			meta: { taskId, replayed },
		});
		return replayed;
	}

	unsubscribe(taskId: string, ws: WebSocket) {
		const set = this.subscribers.get(taskId);
		if (!set) return;
		set.delete(ws);
		if (set.size === 0) {
			this.subscribers.delete(taskId);
		}
		logEvent({
			channel: "ws",
			level: "debug",
			message: "unsubscribed",
			meta: { taskId, subscribers: this.subscribers.get(taskId)?.size ?? 0 },
		});
	}

	unsubscribeAll(ws: WebSocket) {
		this.sockets.delete(ws);
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
			channel: "ws",
			level: "debug",
			message: "unsubscribeAll",
			meta: { removedSubscriptions: removed },
		});
	}

	closeAll(code = 1001, reason = "server shutting down") {
		const sockets = [...this.sockets];
		for (const ws of sockets) {
			this.unsubscribeAll(ws);
			if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
				ws.close(code, reason);
			}
		}
		this.subscribers.clear();
		logEvent({
			channel: "ws",
			level: "info",
			message: "closed realtime sockets",
			meta: { sockets: sockets.length },
		});
	}

	publish(taskId: string, message: OutboundSocketMessage) {
		const eventPayload = (message as { event?: unknown }).event;
		const event = toDeepRecord(eventPayload);
		const eventSeq = event.seq as unknown;
		if (message.type === "task_event_created") {
			if (
				!taskId ||
				!message.runId ||
				!event.id ||
				typeof eventSeq !== "number" ||
				!event.timestamp
			) {
				logEvent({
					channel: "ws",
					level: "warn",
					message: "publish skipped: invalid task_event_created payload",
					meta: { taskId, runId: message.runId, event: eventPayload },
				});
				return;
			}
		}

		const wire = {
			...message,
			taskId,
			seq:
				(typeof eventSeq === "number" ? eventSeq : undefined) ??
				message.seq ??
				this.nextTaskSeq(taskId),
			timestamp: new Date().toISOString(),
		} satisfies SocketMessage;
		if (REPLAYABLE_MESSAGE_TYPES.has(message.type)) {
			this.remember(taskId, wire);
		}

		const set = this.subscribers.get(taskId);
		if (!set || set.size === 0) {
			logEvent({
				channel: "ws",
				level: "debug",
				message: "publish queued: no subscribers",
				meta: { taskId, type: message.type, seq: wire.seq },
			});
			return;
		}
		for (const ws of set) {
			this.send(ws, wire);
		}
		logEvent({
			channel: "ws",
			level: "debug",
			message: "published",
			meta: {
				taskId,
				type: message.type,
				seq: wire.seq,
				subscribers: set.size,
			},
		});
	}

	private nextTaskSeq(taskId: string) {
		const next = (this.nextSeqByTask.get(taskId) || 0) + 1;
		this.nextSeqByTask.set(taskId, next);
		return next;
	}

	private remember(taskId: string, message: SocketMessage) {
		const history = this.pruneReplayHistory(taskId);
		history.push({ message, storedAtMs: Date.now() });
		if (history.length > MAX_REPLAY_MESSAGES_PER_TASK) {
			history.splice(0, history.length - MAX_REPLAY_MESSAGES_PER_TASK);
		}
		this.replayHistory.set(taskId, history);
	}

	private pruneReplayHistory(taskId: string) {
		const expiresBefore = Date.now() - REPLAY_TTL_MS;
		const history = (this.replayHistory.get(taskId) || []).filter(
			(entry) => entry.storedAtMs >= expiresBefore,
		);
		if (history.length === 0) {
			this.replayHistory.delete(taskId);
		} else {
			this.replayHistory.set(taskId, history);
		}
		return history;
	}

	private send(ws: WebSocket, message: SocketMessage) {
		if (ws.readyState !== ws.OPEN) return false;
		ws.send(JSON.stringify(message));
		return true;
	}
}

export const nightWorkersRealtimeBroker = new NightWorkersRealtimeBroker();
