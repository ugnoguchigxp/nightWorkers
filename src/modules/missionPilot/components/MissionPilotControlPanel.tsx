import { Loader2, Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MissionPilotControlSummary } from "../../../../shared/modules/missionPilot";
import { missionPilotPresentation } from "../missionPilotPresentation";
import { useMissionPilotControls } from "../useMissionPilotControls";

export function MissionPilotControlPanel({
	taskId,
	summary,
	initialPrompt,
	placement,
}: {
	taskId: string;
	summary: MissionPilotControlSummary;
	initialPrompt?: string;
	placement: "sidebar" | "composer";
}) {
	const { t } = useTranslation();
	const controls = useMissionPilotControls(taskId, summary, initialPrompt);
	const state = missionPilotPresentation(summary);
	const stopping =
		controls.pending === "stop" || summary.activityState === "stopping";
	const running =
		!stopping && (controls.pending === "play" || state.busy || state.canStop);
	const controlLabel = stopping
		? "missionPilot.stopping"
		: running
			? "missionPilot.pause"
			: "missionPilot.play";
	const className =
		placement === "sidebar"
			? "mission-pilot-task-control"
			: "mission-pilot-composer-controls mission-pilot-composer-panel";

	return (
		<div className={className} aria-live="polite">
			<button
				type="button"
				className="mission-pilot-control-button"
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void (running ? controls.stop() : controls.play());
				}}
				disabled={stopping}
				aria-busy={Boolean(controls.pending) || state.busy}
				aria-label={t(controlLabel)}
				title={controls.error || t(controlLabel)}
			>
				{running ? (
					<span className="mission-pilot-starting-control">
						<Loader2 className="mission-pilot-starting-spinner h-5 w-5 animate-spin" />
						<span className="mission-pilot-starting-pause">
							<Pause className="h-4 w-4" />
						</span>
					</span>
				) : stopping ? (
					<Loader2 className="h-5 w-5 animate-spin" />
				) : (
					<Play className="h-6 w-6" />
				)}
			</button>
			<MissionPilotCountdown
				nextWakeAt={
					summary.desiredState === "playing" ? summary.nextWakeAt : null
				}
				disabled={stopping}
				onPause={() => controls.stop()}
			/>
			{controls.error ? (
				<span className="sr-only" role="status">
					{controls.error}
				</span>
			) : null}
		</div>
	);
}

function MissionPilotCountdown({
	nextWakeAt,
	disabled,
	onPause,
}: {
	nextWakeAt: string | Date | null;
	disabled: boolean;
	onPause: () => Promise<void>;
}) {
	const { t } = useTranslation();
	const [now, setNow] = useState(() => Date.now());
	const deadline = nextWakeAt ? new Date(nextWakeAt).getTime() : Number.NaN;
	const remainingMs = Number.isFinite(deadline)
		? Math.max(0, deadline - now)
		: 0;

	useEffect(() => {
		if (!Number.isFinite(deadline) || deadline <= Date.now()) return;
		setNow(Date.now());
		const timer = window.setInterval(() => {
			const nextNow = Date.now();
			setNow(nextNow);
			if (nextNow >= deadline) window.clearInterval(timer);
		}, 1000);
		return () => window.clearInterval(timer);
	}, [deadline]);

	if (remainingMs <= 0) return null;
	const label = formatCountdown(remainingMs);
	return (
		<button
			type="button"
			className="mission-pilot-countdown"
			disabled={disabled}
			onClick={() => void onPause()}
			aria-label={t("missionPilot.pauseCountdown", { time: label })}
			title={t("missionPilot.pauseCountdown", { time: label })}
		>
			{label}
		</button>
	);
}

export function formatCountdown(remainingMs: number) {
	const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const minuteSecond = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
	return hours > 0 ? `${hours}:${minuteSecond}` : minuteSecond;
}
