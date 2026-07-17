import { BrainCircuit, MessageCircleMore, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
	MissionPilotControlSummary,
	PilotThoughtEntry,
} from "../../../../shared/modules/missionPilot";
import { AgentDebugEventCard } from "../../nightworkers/components/ThreadTimelineAgentCards";
import type {
	ActivityEvent,
	Task,
	TaskEvent,
	TaskMessage,
} from "../../nightworkers/types";
import { getRelativeTimestamp } from "../../nightworkers/utils/time";
import { fetchMissionPilotExecutionTrace } from "../missionPilotCommands";

type PilotThoughtSource =
	| "unified_entry"
	| "mission_pilot_event"
	| "activity_event"
	| "task_message"
	| "current_state";

export type PilotThoughtItem = {
	id: string;
	source: PilotThoughtSource;
	sourceId: string;
	sequence?: number;
	createdAt: unknown;
	event: TaskEvent;
};

export type MissionPilotStoredEvent = {
	id: string;
	eventType: string;
	phase: string;
	cycle?: number | null;
	contextRevision: number;
	sourceKind: string;
	sourceId?: string | null;
	payloadJson?: Record<string, unknown>;
	processStatus: string;
	attemptCount: number;
	lastError?: string | null;
	createdAt: unknown;
};

export type MissionPilotExecutionTrace = {
	events: MissionPilotStoredEvent[];
	activityEvents: ActivityEvent[];
	messages: TaskMessage[];
	entries?: PilotThoughtEntry[];
};

export function isMissionPilotActivityEvent(event: ActivityEvent) {
	return (
		event.traceOwner === "mission_pilot" &&
		event.traceChannel === "pilot_thought"
	);
}

export function isMissionPilotTaskMessage(message: TaskMessage) {
	return (
		message.traceOwner === "mission_pilot" &&
		message.traceChannel === "pilot_thought"
	);
}

function eventTimestamp(value: unknown) {
	const time = new Date(value as string | number | Date).getTime();
	return Number.isFinite(time) ? time : 0;
}

const PILOT_THOUGHT_SOURCE_ORDER: Record<PilotThoughtSource, number> = {
	unified_entry: 0,
	mission_pilot_event: 0,
	activity_event: 2,
	task_message: 3,
	current_state: 4,
};

export function comparePilotThoughtItems(
	a: PilotThoughtItem,
	b: PilotThoughtItem,
) {
	const timestampDifference =
		eventTimestamp(a.createdAt) - eventTimestamp(b.createdAt);
	if (timestampDifference !== 0) return timestampDifference;
	const sourceDifference =
		PILOT_THOUGHT_SOURCE_ORDER[a.source] - PILOT_THOUGHT_SOURCE_ORDER[b.source];
	if (sourceDifference !== 0) return sourceDifference;
	const sequenceDifference =
		(a.sequence ?? Number.MAX_SAFE_INTEGER) -
		(b.sequence ?? Number.MAX_SAFE_INTEGER);
	if (sequenceDifference !== 0) return sequenceDifference;
	return a.sourceId.localeCompare(b.sourceId);
}

function activityToTaskEvent(event: ActivityEvent): TaskEvent {
	return {
		id: event.id,
		runId: event.runId ?? undefined,
		seq: event.seq,
		type: event.kind,
		eventType: event.kind,
		actor: event.source,
		message: event.text?.trim() || event.kind,
		payloadJson:
			event.payloadJson && typeof event.payloadJson === "object"
				? (event.payloadJson as TaskEvent["payloadJson"])
				: undefined,
		createdAt: event.createdAt,
	};
}

function missionPilotEventToTaskEvent(
	event: MissionPilotStoredEvent,
): TaskEvent {
	return {
		id: event.id,
		eventType: event.eventType,
		actor: "mission_pilot",
		message: event.eventType,
		payloadJson: {
			phase: event.phase,
			cycle: event.cycle ?? null,
			contextRevision: event.contextRevision,
			sourceKind: event.sourceKind,
			sourceId: event.sourceId ?? null,
			processStatus: event.processStatus,
			attemptCount: event.attemptCount,
			lastError: event.lastError ?? null,
			...(event.payloadJson ?? {}),
		},
		createdAt: event.createdAt,
	};
}

function pilotThoughtEntryToTaskEvent(entry: PilotThoughtEntry): TaskEvent {
	return {
		id: entry.id,
		seq: entry.sequence,
		eventType: entry.kind,
		type: entry.kind,
		actor: "mission_pilot",
		message: entry.summary,
		payloadJson: {
			status: entry.status ?? null,
			sourceRef: entry.sourceRef,
			...(entry.details ?? {}),
		},
		createdAt: entry.occurredAt,
	};
}

export function missionPilotTraceItems(
	trace: MissionPilotExecutionTrace | null,
): PilotThoughtItem[] {
	if (Array.isArray(trace?.entries))
		return trace.entries.map((entry) => ({
			id: `unified-entry:${entry.id}`,
			source: "unified_entry" as const,
			sourceId: entry.id,
			sequence: entry.sequence,
			createdAt: entry.occurredAt,
			event: pilotThoughtEntryToTaskEvent(entry),
		}));
	const persistedItems = [
		...(trace?.events ?? [])
			.filter((event) => event.sourceKind !== "task_run")
			.map((event) => ({
				id: `mission-pilot-event:${event.id}`,
				source: "mission_pilot_event" as const,
				sourceId: event.id,
				createdAt: event.createdAt,
				event: missionPilotEventToTaskEvent(event),
			})),
		...(trace?.activityEvents ?? [])
			.filter(isMissionPilotActivityEvent)
			.map((event) => ({
				id: `mission-pilot-activity:${event.id}`,
				source: "activity_event" as const,
				sourceId: event.id,
				sequence: event.seq,
				createdAt: event.createdAt,
				event: activityToTaskEvent(event),
			})),
		...(trace?.messages ?? [])
			.filter(isMissionPilotTaskMessage)
			.map((message) => ({
				id: `mission-pilot-message:${message.id}`,
				source: "task_message" as const,
				sourceId: message.id,
				createdAt: message.createdAt,
				event: {
					id: message.id,
					eventType: "pilot.message",
					actor: "mission_pilot",
					message: message.content,
					payloadJson: {
						messageType: message.messageType ?? null,
						metadata: message.metadataJson ?? null,
					},
					createdAt: message.createdAt,
				},
			})),
	];
	return [
		...new Map(persistedItems.map((item) => [item.id, item])).values(),
	].sort(comparePilotThoughtItems);
}

function mergePersistedRows<T extends { id: string }>(
	current: readonly T[],
	incoming: readonly T[],
) {
	const rowsById = new Map(current.map((row) => [row.id, row]));
	for (const row of incoming) rowsById.set(row.id, row);
	return [...rowsById.values()];
}

export function mergeMissionPilotExecutionTrace(
	current: MissionPilotExecutionTrace | null,
	incoming: MissionPilotExecutionTrace,
): MissionPilotExecutionTrace {
	if (!current) return incoming;
	return {
		events: mergePersistedRows(current.events, incoming.events),
		activityEvents: mergePersistedRows(
			current.activityEvents,
			incoming.activityEvents,
		),
		messages: mergePersistedRows(current.messages, incoming.messages),
		entries:
			Array.isArray(current.entries) || Array.isArray(incoming.entries)
				? mergePersistedRows(
						current.entries ?? [],
						incoming.entries ?? [],
					).sort((a, b) => a.sequence - b.sequence)
				: undefined,
	};
}

export function missionPilotStopThoughtItem(
	summary: MissionPilotControlSummary | null | undefined,
): PilotThoughtItem | null {
	if (summary?.desiredState !== "stopped" || summary.phase === "created")
		return null;
	const diagnostic = summary.preQueueDiagnostic;
	const reasonCode =
		diagnostic?.code ??
		summary.lastErrorCode ??
		(summary.phase === "paused"
			? "MISSION_PILOT_USER_STOPPED"
			: summary.phase === "archived"
				? "MISSION_PILOT_COMPLETED"
				: "MISSION_PILOT_STOPPED");
	const reason =
		summary.lastError?.trim() ||
		(diagnostic
			? diagnostic.code
			: summary.phase === "paused"
				? "ユーザーの停止操作を受け付けました。"
				: summary.phase === "archived"
					? "タスクの完了・アーカイブ処理が完了しました。"
					: `phase=${summary.phase} で停止状態へ遷移しました。`);
	const createdAt =
		diagnostic?.detectedAt ??
		(summary.phase === "paused" ? summary.stoppedAt : null) ??
		summary.updatedAt;
	const attention = summary.activityState === "attention";
	return {
		id: `stop:${reasonCode}:${eventTimestamp(createdAt)}`,
		source: "current_state",
		sourceId: `current-state:${reasonCode}`,
		createdAt,
		event: {
			id: `stop:${reasonCode}`,
			eventType: attention ? "runtime.attention" : "runtime.state",
			actor: "mission_pilot",
			message: `Mission Pilotを停止しました。${
				attention ? "自動再開されません。" : ""
			}理由: ${reason}`,
			payloadJson: {
				stopReasonCode: reasonCode,
				stopReason: reason,
				phase: summary.phase,
				lastErrorCode: summary.lastErrorCode ?? null,
				lastError: summary.lastError,
				stoppedAt: summary.stoppedAt ?? null,
				...(diagnostic
					? {
							taskStatus: diagnostic.taskStatus,
							runIds: diagnostic.runIds,
							queueEntryIds: diagnostic.queueEntryIds,
							detectedAt: diagnostic.detectedAt,
						}
					: {}),
			},
			createdAt,
		},
	};
}

export function PilotThoughtDock({
	session,
	onClose,
}: {
	session: Task | null;
	onClose: () => void;
}) {
	const [executionTraceState, setExecutionTraceState] = useState<{
		taskId: string;
		trace: MissionPilotExecutionTrace;
	} | null>(null);
	useEffect(() => {
		if (!session?.id) {
			setExecutionTraceState(null);
			return;
		}
		let disposed = false;
		let timer: number | undefined;
		setExecutionTraceState((current) =>
			current?.taskId === session.id ? current : null,
		);
		const refresh = async () => {
			try {
				const response = await fetchMissionPilotExecutionTrace(session.id);
				if (!response.ok) return;
				const trace = (await response.json()) as MissionPilotExecutionTrace;
				if (!disposed) {
					setExecutionTraceState((current) => ({
						taskId: session.id,
						trace: mergeMissionPilotExecutionTrace(
							current?.taskId === session.id ? current.trace : null,
							trace,
						),
					}));
				}
			} catch {
				// 既に取得済みの証跡は、一時的な通信断でも表示したままにする。
			} finally {
				if (!disposed) timer = window.setTimeout(() => void refresh(), 2_000);
			}
		};
		void refresh();
		return () => {
			disposed = true;
			if (timer !== undefined) window.clearTimeout(timer);
		};
	}, [session?.id]);
	const currentStateItem = useMemo(
		() => missionPilotStopThoughtItem(session?.missionPilot),
		[session?.missionPilot],
	);
	const items = useMemo(
		() =>
			missionPilotTraceItems(
				executionTraceState && executionTraceState.taskId === session?.id
					? executionTraceState.trace
					: null,
			),
		[executionTraceState, session?.id],
	);

	return (
		<aside className="nightworkers-chat-dock flex h-full min-h-0 flex-col border-r border-slate-700/80 bg-[#0f172a]">
			<header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-700/80 px-4 py-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
						<MessageCircleMore className="h-4 w-4 text-slate-300" />
						<span>Pilot thought</span>
					</div>
					<p className="mt-1 truncate text-[11px] text-slate-500">
						{session?.title ?? "Mission Pilot"}
					</p>
				</div>
				<button
					type="button"
					className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-slate-100"
					onClick={onClose}
					aria-label="Pilot thoughtを閉じる"
					title="Pilot thoughtを閉じる"
				>
					<X className="h-4 w-4" />
				</button>
			</header>
			{currentStateItem ? (
				<section className="shrink-0 border-b border-slate-700/80 bg-slate-950/40">
					<p className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
						現在のSQLite状態（履歴外）
					</p>
					<AgentDebugEventCard
						event={currentStateItem.event}
						variant="dock"
						timestamp={getRelativeTimestamp(currentStateItem.createdAt)}
					/>
				</section>
			) : null}
			<div className="nightworkers-scrollbar min-h-0 flex-1 overflow-y-auto">
				{items.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-xs text-slate-500">
						<BrainCircuit className="h-7 w-7 text-slate-600" />
						<p>SQLiteに保存されたMission Pilot履歴はまだありません。</p>
					</div>
				) : (
					items.map((item) => (
						<AgentDebugEventCard
							key={item.id}
							event={item.event}
							variant="dock"
							timestamp={getRelativeTimestamp(item.createdAt)}
						/>
					))
				)}
			</div>
			<footer className="shrink-0 border-t border-slate-800 px-4 py-2 text-[10px] leading-relaxed text-slate-500">
				SQLiteに保存されたMission
				Pilotの判断、状態遷移、LLM証跡だけを表示します。
			</footer>
		</aside>
	);
}
