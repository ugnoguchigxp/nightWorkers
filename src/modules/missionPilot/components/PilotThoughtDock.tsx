import { BrainCircuit, MessageCircleMore, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MissionPilotQuestionnaireDraft } from "../../../../shared/schemas/mission-pilot.schema";
import { AgentDebugEventCard } from "../../nightworkers/components/ThreadTimelineAgentCards";
import type { ActivityEvent, Task, TaskEvent } from "../../nightworkers/types";
import { getRelativeTimestamp } from "../../nightworkers/utils/time";
import { fetchMissionPilotQuestionnaireDraft } from "../missionPilotCommands";

type PilotThoughtItem = {
	id: string;
	createdAt: unknown;
	event: TaskEvent;
};

export function isMissionPilotActivityEvent(event: ActivityEvent) {
	return event.source === "mission_pilot";
}

export function isMissionPilotRunEvent(event: TaskEvent) {
	return event.actor === "mission_pilot";
}

function eventTimestamp(value: unknown) {
	const time = new Date(value as string | number | Date).getTime();
	return Number.isFinite(time) ? time : 0;
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

export function PilotThoughtDock({
	session,
	activityEvents,
	runEvents,
	onClose,
}: {
	session: Task | null;
	activityEvents: ActivityEvent[];
	runEvents: TaskEvent[];
	onClose: () => void;
}) {
	const [questionnaireDraft, setQuestionnaireDraft] =
		useState<MissionPilotQuestionnaireDraft | null>(null);
	useEffect(() => {
		if (!session?.id) {
			setQuestionnaireDraft(null);
			return;
		}
		const controller = new AbortController();
		void fetchMissionPilotQuestionnaireDraft(session.id)
			.then(async (response) =>
				response.ok
					? ((await response.json()) as MissionPilotQuestionnaireDraft | null)
					: null,
			)
			.then((draft) => {
				if (!controller.signal.aborted) setQuestionnaireDraft(draft);
			})
			.catch(() => undefined);
		return () => controller.abort();
	}, [session?.id]);
	const items = useMemo(() => {
		const merged: PilotThoughtItem[] = [
			...(questionnaireDraft
				? [
						{
							id: `questionnaire:${questionnaireDraft.id}:${questionnaireDraft.version}`,
							createdAt: questionnaireDraft.updatedAt,
							event: {
								id: `questionnaire:${questionnaireDraft.id}`,
								eventType: "runtime.state",
								actor: "mission_pilot",
								message:
									questionnaireDraft.state === "submitted"
										? `${questionnaireDraft.answers.length}件のQuestionnaire回答は確定済みです。`
										: `${questionnaireDraft.answers.length}件のQuestionnaire回答案は${questionnaireDraft.state}です。`,
								payloadJson: {
									questionnaireSessionId:
										questionnaireDraft.questionnaireSessionId,
									state: questionnaireDraft.state,
									answerCount: questionnaireDraft.answers.length,
									deadlineAt: questionnaireDraft.deadlineAt,
								},
								createdAt: questionnaireDraft.updatedAt,
							},
						},
					]
				: []),
			...activityEvents.filter(isMissionPilotActivityEvent).map((event) => ({
				id: `activity:${event.id}`,
				createdAt: event.createdAt,
				event: activityToTaskEvent(event),
			})),
			...runEvents.filter(isMissionPilotRunEvent).map((event) => ({
				id: `run:${event.id}`,
				createdAt: event.timestamp ?? event.createdAt,
				event,
			})),
		];
		return merged.sort(
			(a, b) => eventTimestamp(a.createdAt) - eventTimestamp(b.createdAt),
		);
	}, [activityEvents, questionnaireDraft, runEvents]);

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
			<div className="nightworkers-scrollbar min-h-0 flex-1 overflow-y-auto">
				{items.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-xs text-slate-500">
						<BrainCircuit className="h-7 w-7 text-slate-600" />
						<p>Mission Pilotの実行イベントを待っています。</p>
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
				判断要約、状態遷移、LLM呼び出し、ツール実行など、保存済みの実行証跡を時系列で表示します。
			</footer>
		</aside>
	);
}
